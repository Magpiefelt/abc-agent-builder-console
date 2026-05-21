/**
 * Integration tests for /api/agent/*.
 *
 * Requires Postgres (testcontainers locally, GitHub Actions service container in CI)
 * and uses the env-gated MockProvider. Runs end-to-end through the Express app
 * including auth, rate limiting, request validation, route handlers, and the
 * full orchestrator iteration loop.
 *
 * Assertions on SSE event ordering use subsequence + predicate matching, never
 * full-equality, because heartbeats, attribute updates, and tool results
 * interleave non-deterministically.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { registerMockResponses, clearMockResponses } from "../helpers/mockLLM.js";
import { seedUser, seedMockModel, seedUsResidencyMockModel, truncateAll } from "../helpers/dbHelpers.js";
import { SSECollector } from "../helpers/sseConsumer.js";

let app: Express;
let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  // The orchestrator + router pull env at import time, so we must set the
  // dev-bypass env vars BEFORE the dynamic import.
  const expressMod = await import("express");
  const realExpress = expressMod.default;
  const healthRouter = (await import("../../src/routes/health.js")).default;
  const agentRouter = (await import("../../src/routes/agent.js")).default;
  const { registerAllTools } = await import("../../src/tools/register.js");
  registerAllTools();

  app = realExpress();
  app.use(realExpress.json({ limit: "5mb" }));
  app.use("/api/health", healthRouter);
  app.use("/api/agent", agentRouter);

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(async () => {
  await truncateAll();
  // No id arg: dbHelpers.seedUser defaults to the DEV_USER UUID,
  // matching what authenticate() injects on req.user.
  await seedUser();
  await seedMockModel();
  clearMockResponses();
});

interface SSEDriveResult {
  status: number;
  collector: SSECollector;
}

/** Drive an SSE endpoint and return collected events when it closes. */
async function driveSse(method: "POST", path: string, body?: Record<string, unknown>): Promise<SSEDriveResult> {
  const collector = new SSECollector();
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        method,
        path,
        hostname: "127.0.0.1",
        port: Number(baseUrl.split(":").pop()),
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        const status = res.statusCode || 0;
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => collector.feed(chunk));
        res.on("end", () => {
          collector.close("end");
          resolve({ status, collector });
        });
        res.on("error", (err) => {
          collector.close("error");
          reject(err);
        });
      }
    );
    req.on("error", (err) => {
      collector.close("error");
      reject(err);
    });
    if (payload) req.write(payload);
    req.end();
  });
}

async function plainPost(path: string, body: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function plainGet(path: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${path}`);
  return { status: res.status, body: await res.json() };
}

describe("GET /api/health", () => {
  it("reports healthy when DB is reachable", async () => {
    const res = await plainGet("/api/health");
    expect(res.status).toBe(200);
    expect((res.body as { status: string }).status).toBe("healthy");
  });
});

describe("POST /api/agent/sessions", () => {
  it("creates a session and persists it (201)", async () => {
    const res = await plainPost("/api/agent/sessions", {
      prompt: "Find the population of Edmonton.",
      modelId: "mock-llm",
      classification: "unclassified",
    });
    expect(res.status).toBe(201);
    const body = res.body as { id: string; status: string; prompt: string };
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.status).toBe("idle");
    expect(body.prompt).toMatch(/Edmonton/);
  });

  it("rejects PII (SIN) with 422 + detection details", async () => {
    const res = await plainPost("/api/agent/sessions", {
      prompt: "research alberta — my SIN is 046-454-286",
      modelId: "mock-llm",
    });
    expect(res.status).toBe(422);
    const body = res.body as { detections: Array<{ type: string }> };
    expect(body.detections.some((d) => d.type === "social_insurance_number")).toBe(true);
  });

  it("rejects empty prompts with 400", async () => {
    const res = await plainPost("/api/agent/sessions", { prompt: "" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/agent/sessions/:id/start — happy path SSE flow", () => {
  it("streams session_start → iteration_start → llm_response → blackboard_update → iteration_complete → session_complete as a subsequence", async () => {
    const created = await plainPost("/api/agent/sessions", {
      prompt: "Find the population of Edmonton.",
      modelId: "mock-llm",
      classification: "unclassified",
    });
    expect(created.status).toBe(201);
    const sessionId = (created.body as { id: string }).id;

    registerMockResponses(sessionId, [
      {
        thinking: "Edmonton is the capital of Alberta with ~1M people.",
        blackboardUpdates: [
          { category: "research", title: "Edmonton population", content: "approximately 1,010,000 (2024)" },
        ],
        status: "completed",
        userMessage: "Done.",
      },
    ]);

    const { status, collector } = await driveSse("POST", `/api/agent/sessions/${sessionId}/start`, {});
    expect(status).toBe(200);

    expect(collector.hasSubsequence([
      "session_start",
      "iteration_start",
      "llm_response",
      "blackboard_update",
      "iteration_complete",
      "session_complete",
    ])).toBe(true);

    const sessionStart = collector.byType("session_start")[0];
    const iterationComplete = collector.byType("iteration_complete")[0];
    const sessionComplete = collector.byType("session_complete")[0];
    expect((sessionStart as { sessionId: string }).sessionId).toBe(sessionId);
    expect((iterationComplete as { iteration: number }).iteration).toBe(1);
    expect((sessionComplete as { status: string }).status).toBe("completed");
  }, 30_000);

  it("returns 404 when session does not exist", async () => {
    const res = await fetch(`${baseUrl}/api/agent/sessions/00000000-0000-0000-0000-000000000000/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });
});

describe("Classification gating end-to-end", () => {
  it("rejects Protected B + US-residency model with 400", async () => {
    await seedUsResidencyMockModel();
    const res = await plainPost("/api/agent/sessions", {
      prompt: "research alberta",
      modelId: "mock-llm-us",
      classification: "protected_b",
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/protected_b|approved/);
  });

  it("ALLOWS Unclassified + US-residency model (negative control)", async () => {
    await seedUsResidencyMockModel();
    const res = await plainPost("/api/agent/sessions", {
      prompt: "research alberta",
      modelId: "mock-llm-us",
      classification: "unclassified",
    });
    expect(res.status).toBe(201);
  });
});

describe("Session retrieval", () => {
  it("GET /api/agent/sessions/:id returns the persisted state after a completed run", async () => {
    const created = await plainPost("/api/agent/sessions", {
      prompt: "Research task",
      modelId: "mock-llm",
    });
    const sessionId = (created.body as { id: string }).id;

    registerMockResponses(sessionId, [
      {
        thinking: "Doing the task.",
        blackboardUpdates: [{ category: "result", title: "answer", content: "42" }],
        scratchpad: "midway notes",
        attributeUpdates: { confidence: "high" },
        status: "completed",
        userMessage: "Done.",
      },
    ]);

    await driveSse("POST", `/api/agent/sessions/${sessionId}/start`, {});

    const get = await plainGet(`/api/agent/sessions/${sessionId}`);
    expect(get.status).toBe(200);
    const body = get.body as {
      status: string;
      blackboard: Array<{ title: string }>;
      scratchpad: string;
      attributes: Record<string, unknown>;
      finalReport: { message: string } | null;
    };
    expect(body.status).toBe("completed");
    expect(body.blackboard).toHaveLength(1);
    expect(body.blackboard[0].title).toBe("answer");
    expect(body.scratchpad).toBe("midway notes");
    expect(body.attributes.confidence).toBe("high");
    expect(body.finalReport).toBeTruthy();
  }, 30_000);
});

describe("GET /api/agent/models", () => {
  it("returns the registered models including the mock one", async () => {
    const res = await plainGet("/api/agent/models");
    expect(res.status).toBe(200);
    const body = res.body as { models: Array<{ id: string }> };
    expect(body.models.some((m) => m.id === "mock-llm")).toBe(true);
  });
});
