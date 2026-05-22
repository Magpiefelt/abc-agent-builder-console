/**
 * Unit tests for webhookDispatcher (Bot 21).
 *
 * Everything is mocked so no real network or DB is hit:
 *   - global.fetch is stubbed per test
 *   - the database query function is hoisted and inspected
 *   - SECRETS_VAULT_KEY is set via the env mock for signing tests
 *
 * Tests cover:
 *   - signing is deterministic + uses the derived secret
 *   - happy-path 200 stops after one attempt
 *   - 500 → 200 retries and succeeds
 *   - permanent 4xx gives up immediately
 *   - 408 / 429 are retried
 *   - network/timeout failures retry up to the configured cap
 *   - disabled subscription is skipped (no fetch)
 *   - missing vault key skips delivery rather than crashing
 *   - every attempt is persisted to webhook_deliveries
 *   - subscription status is updated to the final outcome
 *   - audit row is written exactly once per delivery
 *   - loadSubscriptions filters on event_type, enabled, and ministry
 *   - dispatchWebhookEvent fans out to every matching subscription
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks (hoisted before any imports)
// ---------------------------------------------------------------------------

const queryMock = vi.hoisted(() => vi.fn());
vi.mock("../../config/database.js", () => ({ query: queryMock }));

const logAuditMock = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock("../../services/auditLogger.js", async () => {
  const actual = await vi.importActual<typeof import("../auditLogger.js")>(
    "../../services/auditLogger.js",
  );
  return {
    ...actual,
    logAudit: logAuditMock,
  };
});

vi.mock("../../services/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    business: vi.fn(),
  },
}));

const envMock = vi.hoisted(() => ({
  DATABASE_URL: "postgresql://stub/db",
  SECRETS_VAULT_KEY: "test-vault-key-of-sufficient-length-32",
  WEBHOOK_TIMEOUT_MS: 1000,
  WEBHOOK_MAX_ATTEMPTS: 3,
  WEBHOOK_BASE_BACKOFF_MS: 1, // keep tests fast; backoff is exercised by the loop count
}));
vi.mock("../../config/env.js", () => ({ env: envMock }));

// ---------------------------------------------------------------------------
// Import under test
// ---------------------------------------------------------------------------

import {
  deliverToSubscription,
  deriveSecret,
  dispatchWebhookEvent,
  loadSubscriptions,
  signBody,
  type SubscriptionRow,
} from "../webhookDispatcher.js";

function makeSubscription(overrides: Partial<SubscriptionRow> = {}): SubscriptionRow {
  return {
    id: "sub-1",
    ministry_code: "TBF",
    event_type: "session.completed",
    url: "https://example.test/hook",
    secret_label: "primary",
    enabled: true,
    description: null,
    ...overrides,
  };
}

function jsonResponse(status: number, body: string = "{}"): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "application/json" },
  });
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rowCount: 0, rows: [] });
  logAuditMock.mockReset();
  logAuditMock.mockResolvedValue(undefined);
  envMock.SECRETS_VAULT_KEY = "test-vault-key-of-sufficient-length-32";
  envMock.WEBHOOK_MAX_ATTEMPTS = 3;
  envMock.DATABASE_URL = "postgresql://stub/db";
  fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

describe("deriveSecret + signBody", () => {
  it("returns null when the vault key is unset", () => {
    envMock.SECRETS_VAULT_KEY = "";
    expect(deriveSecret("primary")).toBeNull();
  });

  it("derives a stable hex secret from the vault key + label", () => {
    const a = deriveSecret("primary");
    const b = deriveSecret("primary");
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it("different labels produce different secrets", () => {
    expect(deriveSecret("primary")).not.toBe(deriveSecret("rotated"));
  });

  it("signBody returns sha256=<hex> using HMAC of the body", () => {
    const sig = signBody("deadbeef", "hello");
    expect(sig).toMatch(/^sha256=[a-f0-9]{64}$/);
    // Same input → same signature
    expect(signBody("deadbeef", "hello")).toBe(sig);
  });
});

// ---------------------------------------------------------------------------
// deliverToSubscription
// ---------------------------------------------------------------------------

describe("deliverToSubscription", () => {
  it("skips disabled subscriptions without firing fetch", async () => {
    const result = await deliverToSubscription(makeSubscription({ enabled: false }), {
      resourceId: "session-1",
      body: { foo: "bar" },
    });
    expect(result.outcome).toBe("skipped");
    expect(result.attempts).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("skips delivery when the vault key is unset", async () => {
    envMock.SECRETS_VAULT_KEY = "";
    const result = await deliverToSubscription(makeSubscription(), {
      resourceId: null,
      body: { hello: "world" },
    });
    expect(result.outcome).toBe("skipped");
    expect(result.attempts).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("succeeds on a 200 response and stops after one attempt", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, "ok"));
    const result = await deliverToSubscription(makeSubscription(), {
      resourceId: "session-1",
      body: { hello: "world" },
    });
    expect(result.outcome).toBe("success");
    expect(result.attempts).toBe(1);
    expect(result.finalStatus).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const [callUrl, callInit] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(callUrl).toBe("https://example.test/hook");
    expect(callInit.method).toBe("POST");
    const headers = callInit.headers as Record<string, string>;
    expect(headers["X-ABC-Signature"]).toMatch(/^sha256=[a-f0-9]{64}$/);
    expect(headers["X-ABC-Event"]).toBe("session.completed");
    expect(headers["X-ABC-Subscription"]).toBe("sub-1");
    expect(headers["X-ABC-Delivery"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    // Audit row written exactly once
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    expect(logAuditMock.mock.calls[0][0]).toMatchObject({
      action: "webhook.delivered",
      resourceType: "webhook_subscription",
      resourceId: "sub-1",
      details: expect.objectContaining({ outcome: "success", attempts: 1, finalStatus: 200 }),
    });
  });

  it("retries on 500 then succeeds on the next attempt", async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(500, "boom"))
      .mockResolvedValueOnce(jsonResponse(200, "ok"));
    const result = await deliverToSubscription(makeSubscription(), {
      resourceId: null,
      body: {},
    });
    expect(result.outcome).toBe("success");
    expect(result.attempts).toBe(2);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("gives up immediately on 404 (non-retryable 4xx)", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(404, "missing"));
    const result = await deliverToSubscription(makeSubscription(), {
      resourceId: null,
      body: {},
    });
    expect(result.outcome).toBe("client_error");
    expect(result.attempts).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("retries on 408 (request timeout)", async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(408, "timeout"))
      .mockResolvedValueOnce(jsonResponse(200, "ok"));
    const result = await deliverToSubscription(makeSubscription(), {
      resourceId: null,
      body: {},
    });
    expect(result.outcome).toBe("success");
    expect(result.attempts).toBe(2);
  });

  it("retries on 429 (rate-limit)", async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(429, "slow down"))
      .mockResolvedValueOnce(jsonResponse(200, "ok"));
    const result = await deliverToSubscription(makeSubscription(), {
      resourceId: null,
      body: {},
    });
    expect(result.outcome).toBe("success");
    expect(result.attempts).toBe(2);
  });

  it("retries network failures up to the configured maximum, then gives up", async () => {
    fetchSpy.mockRejectedValue(new Error("ECONNRESET"));
    const result = await deliverToSubscription(makeSubscription(), {
      resourceId: null,
      body: {},
    });
    expect(result.outcome).toBe("exhausted");
    expect(result.attempts).toBe(3);
    expect(result.error).toBe("ECONNRESET");
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("persists one webhook_deliveries row per attempt", async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(500, "fail"))
      .mockResolvedValueOnce(jsonResponse(200, "ok"));
    await deliverToSubscription(makeSubscription(), {
      resourceId: "session-99",
      body: { ok: true },
    });
    const inserts = queryMock.mock.calls.filter(([sql]) =>
      String(sql).includes("INSERT INTO webhook_deliveries"),
    );
    expect(inserts).toHaveLength(2);
    expect(inserts[0][1]).toEqual(
      expect.arrayContaining(["sub-1", "session.completed", "session-99", 1]),
    );
    expect(inserts[1][1]).toEqual(
      expect.arrayContaining(["sub-1", "session.completed", "session-99", 2]),
    );
  });

  it("updates the subscription's last_delivery_status to the final outcome", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, "ok"));
    await deliverToSubscription(makeSubscription(), { resourceId: null, body: {} });
    const updates = queryMock.mock.calls.filter(([sql]) =>
      String(sql).includes("UPDATE webhook_subscriptions"),
    );
    expect(updates).toHaveLength(1);
    expect(updates[0][1]).toEqual(["sub-1", "success"]);
  });

  it("truncates oversize response bodies before persisting", async () => {
    const huge = "x".repeat(10_000);
    fetchSpy.mockResolvedValueOnce(new Response(huge, { status: 200 }));
    await deliverToSubscription(makeSubscription(), { resourceId: null, body: {} });
    const insert = queryMock.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO webhook_deliveries"),
    );
    expect(insert).toBeDefined();
    const preview = (insert![1] as unknown[])[7] as string;
    expect(preview.length).toBe(4096);
  });
});

// ---------------------------------------------------------------------------
// loadSubscriptions
// ---------------------------------------------------------------------------

describe("loadSubscriptions", () => {
  it("returns an empty list when the database is unconfigured", async () => {
    envMock.DATABASE_URL = "";
    const rows = await loadSubscriptions("session.completed", "TBF");
    expect(rows).toEqual([]);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("filters by event_type, enabled=true, and ministry (or NULL)", async () => {
    queryMock.mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        {
          id: "sub-2",
          ministry_code: "TBF",
          event_type: "workflow.completed",
          url: "https://x.test/hook",
          secret_label: "primary",
          enabled: true,
          description: null,
        },
      ],
    });
    const rows = await loadSubscriptions("workflow.completed", "TBF");
    expect(rows).toHaveLength(1);
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringMatching(/event_type = \$1\s+AND enabled = true\s+AND \(ministry_code IS NULL OR ministry_code = \$2\)/),
      ["workflow.completed", "TBF"],
    );
  });
});

// ---------------------------------------------------------------------------
// dispatchWebhookEvent (fan-out)
// ---------------------------------------------------------------------------

describe("dispatchWebhookEvent", () => {
  it("returns immediately and dispatches in the background", async () => {
    queryMock.mockImplementation((sql: string) => {
      if (String(sql).includes("FROM webhook_subscriptions")) {
        return Promise.resolve({
          rowCount: 2,
          rows: [
            { id: "a", ministry_code: "TBF", event_type: "session.completed", url: "https://a.test", secret_label: "primary", enabled: true, description: null },
            { id: "b", ministry_code: null, event_type: "session.completed", url: "https://b.test", secret_label: "primary", enabled: true, description: null },
          ],
        });
      }
      return Promise.resolve({ rowCount: 0, rows: [] });
    });
    fetchSpy.mockResolvedValue(jsonResponse(200, "ok"));

    const result = dispatchWebhookEvent("session.completed", {
      resourceId: "session-42",
      ministryCode: "TBF",
      body: { sessionId: "session-42", status: "completed" },
    });
    // Synchronous return — does not block on fetch
    expect(result).toBeUndefined();

    // Wait for the detached promise chain to settle
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("is a no-op when no subscriptions match", async () => {
    queryMock.mockResolvedValue({ rowCount: 0, rows: [] });
    dispatchWebhookEvent("workflow.completed", {
      resourceId: "exec-1",
      ministryCode: null,
      body: {},
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
