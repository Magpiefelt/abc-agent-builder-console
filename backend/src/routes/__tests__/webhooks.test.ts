/**
 * Integration tests for /api/admin/webhooks (Bot 21, Backlog B3).
 *
 * The auth middleware is mocked so the DEV_USER mock-admin reaches the
 * handlers regardless of cookie state in test runs. The `query` function is
 * mocked so we can assert SQL contracts without a real database. The
 * `deliverToSubscription` dispatcher is mocked for the /test endpoint so
 * we never actually try to POST to a stub URL.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const queryMock = vi.hoisted(() => vi.fn());
vi.mock("../../config/database.js", () => ({ query: queryMock }));

const logAuditMock = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const auditActionMock = vi.hoisted(() => vi.fn());
vi.mock("../../services/auditLogger.js", async () => {
  const actual = await vi.importActual<typeof import("../../services/auditLogger.js")>(
    "../../services/auditLogger.js",
  );
  return {
    ...actual,
    logAudit: logAuditMock,
    auditAction: auditActionMock,
  };
});

const deliverMock = vi.hoisted(() => vi.fn());
vi.mock("../../services/webhookDispatcher.js", async () => {
  const actual = await vi.importActual<typeof import("../webhookDispatcher.js")>(
    "../../services/webhookDispatcher.js",
  );
  return {
    ...actual,
    deliverToSubscription: deliverMock,
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
  NODE_ENV: "development",
  SECRETS_VAULT_KEY: "test-vault-key-of-sufficient-length-32",
  WEBHOOK_TIMEOUT_MS: 5000,
  WEBHOOK_MAX_ATTEMPTS: 3,
  WEBHOOK_BASE_BACKOFF_MS: 1,
  WORKFLOW_TRASH_RETENTION_DAYS: 30,
}));
vi.mock("../../config/env.js", () => ({ env: envMock }));

// Auth middleware mocks — let admin role through, observe non-admin / unauth
// cases via separate test setups.
const authState = vi.hoisted(() => ({
  user: {
    id: "00000000-0000-0000-0000-000000000001",
    entraId: "dev-entra-id",
    email: "cohen.mcleod@gov.ab.ca",
    displayName: "Cohen McLeod",
    ministryCode: "INFRA",
    role: "admin" as "admin" | "user" | "viewer",
  } as { id: string; ministryCode: string | null; role: "admin" | "user" | "viewer" } | null,
}));
vi.mock("../../middleware/auth.js", async () => {
  const actual =
    await vi.importActual<typeof import("../../middleware/auth.js")>("../../middleware/auth.js");
  return {
    ...actual,
    authenticate: (req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (!authState.user) {
        res.status(401).json({ error: "UNAUTHENTICATED" });
        return;
      }
      req.user = authState.user as never;
      next();
    },
  };
});

import webhooksRouter from "../webhooks.js";

function makeApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use("/api/admin/webhooks", webhooksRouter);
  return app;
}

const SUB_ID = "11111111-2222-3333-4444-555555555555";

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rowCount: 0, rows: [] });
  logAuditMock.mockReset();
  logAuditMock.mockResolvedValue(undefined);
  auditActionMock.mockReset();
  deliverMock.mockReset();
  authState.user = {
    id: "00000000-0000-0000-0000-000000000001",
    entraId: "dev-entra-id",
    email: "cohen.mcleod@gov.ab.ca",
    displayName: "Cohen McLeod",
    ministryCode: "INFRA",
    role: "admin",
  };
});

// ---------------------------------------------------------------------------
// AUTH GATING
// ---------------------------------------------------------------------------

describe("auth gating", () => {
  it("401 when unauthenticated", async () => {
    authState.user = null;
    const res = await request(makeApp()).get("/api/admin/webhooks");
    expect(res.status).toBe(401);
  });

  it("403 when authenticated but non-admin", async () => {
    authState.user = {
      id: "u1",
      entraId: "x",
      email: "x",
      displayName: "x",
      ministryCode: "TBF",
      role: "user",
    } as never;
    const res = await request(makeApp()).get("/api/admin/webhooks");
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// LIST
// ---------------------------------------------------------------------------

describe("GET /", () => {
  it("returns all subscriptions", async () => {
    queryMock.mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        {
          id: SUB_ID,
          ministry_code: "TBF",
          event_type: "session.completed",
          url: "https://example.test/hook",
          secret_label: "primary",
          enabled: true,
          description: "Test hook",
          created_by: "u1",
          created_at: "2026-05-22T00:00:00.000Z",
          updated_at: "2026-05-22T00:00:00.000Z",
          last_delivery_at: null,
          last_delivery_status: null,
        },
      ],
    });
    const res = await request(makeApp()).get("/api/admin/webhooks");
    expect(res.status).toBe(200);
    expect(res.body.subscriptions).toHaveLength(1);
    expect(res.body.subscriptions[0]).toMatchObject({
      id: SUB_ID,
      eventType: "session.completed",
      url: "https://example.test/hook",
      enabled: true,
    });
  });

  it("503 when DATABASE_URL is unset", async () => {
    envMock.DATABASE_URL = "";
    const res = await request(makeApp()).get("/api/admin/webhooks");
    expect(res.status).toBe(503);
    envMock.DATABASE_URL = "postgresql://stub/db";
  });
});

// ---------------------------------------------------------------------------
// CREATE
// ---------------------------------------------------------------------------

describe("POST /", () => {
  it("400 on a missing url", async () => {
    const res = await request(makeApp())
      .post("/api/admin/webhooks")
      .send({ eventType: "session.completed", secretLabel: "primary" });
    expect(res.status).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("400 on an invalid event_type", async () => {
    const res = await request(makeApp())
      .post("/api/admin/webhooks")
      .send({
        eventType: "bogus.event",
        url: "https://example.test/hook",
        secretLabel: "primary",
      });
    expect(res.status).toBe(400);
  });

  it("400 on an invalid url", async () => {
    const res = await request(makeApp())
      .post("/api/admin/webhooks")
      .send({
        eventType: "session.completed",
        url: "not-a-url",
        secretLabel: "primary",
      });
    expect(res.status).toBe(400);
  });

  it("400 on a secret_label with disallowed characters", async () => {
    const res = await request(makeApp())
      .post("/api/admin/webhooks")
      .send({
        eventType: "session.completed",
        url: "https://example.test/hook",
        secretLabel: "bad label!",
      });
    expect(res.status).toBe(400);
  });

  it("201 + audit row on the happy path", async () => {
    queryMock.mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        {
          id: SUB_ID,
          ministry_code: "TBF",
          event_type: "workflow.completed",
          url: "https://example.test/hook",
          secret_label: "primary",
          enabled: true,
          description: null,
          created_by: "u1",
          created_at: "now",
          updated_at: "now",
          last_delivery_at: null,
          last_delivery_status: null,
        },
      ],
    });
    const res = await request(makeApp())
      .post("/api/admin/webhooks")
      .send({
        eventType: "workflow.completed",
        url: "https://example.test/hook",
        secretLabel: "primary",
        ministryCode: "TBF",
      });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(SUB_ID);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "webhook.subscription.created",
        resourceId: SUB_ID,
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// GET ONE
// ---------------------------------------------------------------------------

describe("GET /:id", () => {
  it("400 on a non-UUID id", async () => {
    const res = await request(makeApp()).get("/api/admin/webhooks/not-a-uuid");
    expect(res.status).toBe(400);
  });

  it("404 when no row matches", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const res = await request(makeApp()).get(`/api/admin/webhooks/${SUB_ID}`);
    expect(res.status).toBe(404);
  });

  it("returns the subscription", async () => {
    queryMock.mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        {
          id: SUB_ID,
          ministry_code: null,
          event_type: "session.completed",
          url: "https://example.test/hook",
          secret_label: "primary",
          enabled: true,
          description: null,
          created_by: null,
          created_at: "now",
          updated_at: "now",
          last_delivery_at: null,
          last_delivery_status: null,
        },
      ],
    });
    const res = await request(makeApp()).get(`/api/admin/webhooks/${SUB_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(SUB_ID);
  });
});

// ---------------------------------------------------------------------------
// UPDATE
// ---------------------------------------------------------------------------

describe("PUT /:id", () => {
  it("400 on a non-UUID id", async () => {
    const res = await request(makeApp())
      .put("/api/admin/webhooks/not-a-uuid")
      .send({ enabled: false });
    expect(res.status).toBe(400);
  });

  it("400 when no fields to update", async () => {
    const res = await request(makeApp()).put(`/api/admin/webhooks/${SUB_ID}`).send({});
    expect(res.status).toBe(400);
  });

  it("404 when the row does not exist", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const res = await request(makeApp())
      .put(`/api/admin/webhooks/${SUB_ID}`)
      .send({ enabled: false });
    expect(res.status).toBe(404);
  });

  it("updates and audits on the happy path", async () => {
    queryMock.mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        {
          id: SUB_ID,
          ministry_code: "TBF",
          event_type: "session.completed",
          url: "https://example.test/hook",
          secret_label: "primary",
          enabled: false,
          description: null,
          created_by: null,
          created_at: "now",
          updated_at: "now",
          last_delivery_at: null,
          last_delivery_status: null,
        },
      ],
    });
    const res = await request(makeApp())
      .put(`/api/admin/webhooks/${SUB_ID}`)
      .send({ enabled: false });
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "webhook.subscription.updated",
        resourceId: SUB_ID,
        details: { patch: { enabled: false } },
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------

describe("DELETE /:id", () => {
  it("400 on a non-UUID id", async () => {
    const res = await request(makeApp()).delete("/api/admin/webhooks/not-a-uuid");
    expect(res.status).toBe(400);
  });

  it("404 when no row matches", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const res = await request(makeApp()).delete(`/api/admin/webhooks/${SUB_ID}`);
    expect(res.status).toBe(404);
  });

  it("200 + audit on success", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    const res = await request(makeApp()).delete(`/api/admin/webhooks/${SUB_ID}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: SUB_ID, deleted: true });
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "webhook.subscription.deleted",
        resourceId: SUB_ID,
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// TEST DELIVERY
// ---------------------------------------------------------------------------

describe("POST /:id/test", () => {
  it("404 when no row matches", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const res = await request(makeApp()).post(`/api/admin/webhooks/${SUB_ID}/test`);
    expect(res.status).toBe(404);
    expect(deliverMock).not.toHaveBeenCalled();
  });

  it("delivers a synthetic event when the row exists", async () => {
    queryMock.mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        {
          id: SUB_ID,
          ministry_code: "TBF",
          event_type: "session.completed",
          url: "https://example.test/hook",
          secret_label: "primary",
          enabled: false, // Test path still delivers even when disabled
          description: null,
          created_by: null,
          created_at: "now",
          updated_at: "now",
          last_delivery_at: null,
          last_delivery_status: null,
        },
      ],
    });
    deliverMock.mockResolvedValueOnce({
      subscriptionId: SUB_ID,
      outcome: "success",
      attempts: 1,
      finalStatus: 200,
      error: null,
    });
    const res = await request(makeApp()).post(`/api/admin/webhooks/${SUB_ID}/test`);
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe("success");
    expect(deliverMock).toHaveBeenCalledOnce();
    const [sub, payload] = deliverMock.mock.calls[0] as [
      { enabled: boolean },
      { body: Record<string, unknown> },
    ];
    expect(sub.enabled).toBe(true); // Test path forces enabled=true
    expect(payload.body.test).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// DELIVERIES
// ---------------------------------------------------------------------------

describe("GET /:id/deliveries", () => {
  it("returns the recent delivery history", async () => {
    queryMock.mockResolvedValueOnce({
      rowCount: 2,
      rows: [
        {
          id: "d1",
          subscription_id: SUB_ID,
          event_type: "session.completed",
          resource_id: "session-1",
          attempt: 1,
          signature: "sha256=abc",
          response_status: 200,
          response_body_preview: "ok",
          duration_ms: 12,
          error: null,
          delivered_at: "2026-05-22T01:00:00.000Z",
        },
        {
          id: "d2",
          subscription_id: SUB_ID,
          event_type: "session.completed",
          resource_id: "session-1",
          attempt: 2,
          signature: "sha256=abc",
          response_status: 500,
          response_body_preview: "boom",
          duration_ms: 30,
          error: "Non-2xx response: 500",
          delivered_at: "2026-05-22T00:59:00.000Z",
        },
      ],
    });
    const res = await request(makeApp()).get(`/api/admin/webhooks/${SUB_ID}/deliveries`);
    expect(res.status).toBe(200);
    expect(res.body.deliveries).toHaveLength(2);
  });

  it("400 on an invalid limit", async () => {
    const res = await request(makeApp()).get(
      `/api/admin/webhooks/${SUB_ID}/deliveries?limit=10000`,
    );
    expect(res.status).toBe(400);
  });
});
