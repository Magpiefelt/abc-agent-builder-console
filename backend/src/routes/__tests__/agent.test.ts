/**
 * Route-level tests for /api/agent/*.
 * Mocks the database + orchestrator so we exercise Zod / validation / classification gating /
 * PII blocking branches without firing up an integration environment.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const queryMock = vi.hoisted(() => vi.fn());
vi.mock("../../config/database.js", () => ({ query: queryMock }));

const isProviderConfiguredMock = vi.hoisted(() => vi.fn(() => true));
const validateModelClassificationMock = vi.hoisted(() => vi.fn());
const getActiveModelsMock = vi.hoisted(() => vi.fn());
vi.mock("../../services/llmProvider.js", () => ({
  isProviderConfigured: isProviderConfiguredMock,
  validateModelClassification: validateModelClassificationMock,
  getActiveModels: getActiveModelsMock,
}));

const createSessionMock = vi.hoisted(() => vi.fn());
const loadSessionMock = vi.hoisted(() => vi.fn());
const getSessionSummaryMock = vi.hoisted(() => vi.fn());
const runOrchestratorMock = vi.hoisted(() => vi.fn());
const stopSessionMock = vi.hoisted(() => vi.fn());
const interjectSessionMock = vi.hoisted(() => vi.fn());
const isSessionRunningMock = vi.hoisted(() => vi.fn(() => false));
vi.mock("../../services/agentOrchestrator.js", () => ({
  createSession: createSessionMock,
  loadSession: loadSessionMock,
  getSessionSummary: getSessionSummaryMock,
  runOrchestrator: runOrchestratorMock,
  stopSession: stopSessionMock,
  interjectSession: interjectSessionMock,
  isSessionRunning: isSessionRunningMock,
}));

// env mock so the dev auth path is active
vi.mock("../../config/env.js", () => ({
  env: {
    NODE_ENV: "development",
    PORT: 3000,
    DATABASE_URL: undefined,
    DB_SCHEMA: "test",
    SESSION_SECRET: "test",
    VERTEX_AI_REGION: "northamerica-northeast1",
    MAX_ITERATIONS_LIMIT: 100,
    LLM_TIMEOUT_MS: 120000,
    TOOL_TIMEOUT_MS: 30000,
    MAX_CONCURRENT_SESSIONS: 3,
    FRONTEND_URL: "http://localhost:5173",
  },
}));

import agentRouter from "../agent.js";

function makeApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use("/api/agent", agentRouter);
  return app;
}

beforeEach(() => {
  queryMock.mockReset();
  isProviderConfiguredMock.mockReturnValue(true);
  validateModelClassificationMock.mockReset();
  getActiveModelsMock.mockReset();
  createSessionMock.mockReset();
  loadSessionMock.mockReset();
  runOrchestratorMock.mockReset();
  stopSessionMock.mockReset();
  interjectSessionMock.mockReset();
  isSessionRunningMock.mockReturnValue(false);
});

describe("POST /api/agent/sessions", () => {
  it("rejects an empty prompt with 400", async () => {
    const res = await request(makeApp()).post("/api/agent/sessions").send({ prompt: "" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/prompt/i);
  });

  it("rejects an oversized prompt (> 50K chars) with 400", async () => {
    const res = await request(makeApp())
      .post("/api/agent/sessions")
      .send({ prompt: "x".repeat(60_000) });
    expect(res.status).toBe(400);
  });

  it("rejects a prompt containing a blocked PII pattern (SIN) with 422", async () => {
    const res = await request(makeApp())
      .post("/api/agent/sessions")
      .send({ prompt: "research Edmonton; my SIN is 046-454-286" });
    expect(res.status).toBe(422);
    expect(res.body.detections).toBeDefined();
    expect(res.body.detections.length).toBeGreaterThan(0);
  });

  it("rejects when classification validation fails with 400", async () => {
    validateModelClassificationMock.mockResolvedValueOnce({
      valid: false,
      reason: "Protected B requires Canadian residency",
    });
    const res = await request(makeApp())
      .post("/api/agent/sessions")
      .send({ prompt: "research alberta", modelId: "gemini-2.5-flash", classification: "protected_b" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Canadian residency/);
  });

  it("creates a session and returns 201 on the happy path", async () => {
    validateModelClassificationMock.mockResolvedValueOnce({ valid: true });
    createSessionMock.mockResolvedValueOnce({
      id: "new-sess",
      status: "idle",
      prompt: "research alberta",
      modelId: "claude-sonnet-4.5",
      maxIterations: 50,
      classification: "unclassified",
      createdAt: "2026-05-21T12:00:00Z",
    });
    const res = await request(makeApp())
      .post("/api/agent/sessions")
      .send({ prompt: "research alberta" });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe("new-sess");
  });
});

describe("POST /api/agent/sessions/:id/stop", () => {
  it("returns 400 if session is not running", async () => {
    isSessionRunningMock.mockReturnValueOnce(false);
    const res = await request(makeApp()).post("/api/agent/sessions/12345/stop");
    expect(res.status).toBe(400);
  });

  it("acknowledges the stop request when session is running", async () => {
    isSessionRunningMock.mockReturnValueOnce(true);
    const res = await request(makeApp()).post("/api/agent/sessions/12345/stop");
    expect(res.status).toBe(200);
    expect(stopSessionMock).toHaveBeenCalled();
  });
});

describe("POST /api/agent/sessions/:id/interject", () => {
  it("rejects empty messages with 400", async () => {
    const res = await request(makeApp())
      .post("/api/agent/sessions/12345/interject")
      .send({ message: "" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when no session is running", async () => {
    isSessionRunningMock.mockReturnValueOnce(false);
    const res = await request(makeApp())
      .post("/api/agent/sessions/12345/interject")
      .send({ message: "focus on the calgary part instead" });
    expect(res.status).toBe(400);
  });

  it("rejects an interjection containing PII with 422", async () => {
    isSessionRunningMock.mockReturnValueOnce(true);
    const res = await request(makeApp())
      .post("/api/agent/sessions/12345/interject")
      .send({ message: "Also include my SIN 046-454-286." });
    expect(res.status).toBe(422);
  });

  it("queues the interjection on a clean message", async () => {
    isSessionRunningMock.mockReturnValueOnce(true);
    const res = await request(makeApp())
      .post("/api/agent/sessions/12345/interject")
      .send({ message: "Focus on Calgary instead" });
    expect(res.status).toBe(200);
    expect(interjectSessionMock).toHaveBeenCalledWith("12345", "Focus on Calgary instead");
  });
});

describe("GET /api/agent/sessions/:id", () => {
  it("returns 404 when the session is not found", async () => {
    loadSessionMock.mockResolvedValueOnce(null);
    const res = await request(makeApp()).get("/api/agent/sessions/missing");
    expect(res.status).toBe(404);
  });

  it("returns the loaded session state", async () => {
    loadSessionMock.mockResolvedValueOnce({
      id: "sess-1",
      status: "completed",
      prompt: "test",
      modelId: "claude-sonnet-4.5",
      maxIterations: 50,
      currentIteration: 3,
      classification: "unclassified",
      blackboard: [],
      scratchpad: "",
      attributes: {},
      finalReport: { message: "done" },
      error: null,
      createdAt: "2026-05-21T12:00:00Z",
    });
    const res = await request(makeApp()).get("/api/agent/sessions/sess-1");
    expect(res.status).toBe(200);
    expect(res.body.id).toBe("sess-1");
    expect(res.body.finalReport.message).toBe("done");
  });
});

describe("GET /api/agent/models", () => {
  it("returns mapped model data", async () => {
    getActiveModelsMock.mockResolvedValueOnce([
      {
        id: 1,
        model_id: "claude-sonnet-4.5",
        display_name: "Claude Sonnet 4.5",
        provider: "anthropic",
        api_model_name: "claude-sonnet-4-20250514",
        max_output_tokens: 16384,
        supports_streaming: true,
        supports_tools: true,
        data_residency: "canada",
        max_classification: "protected_b",
        is_active: true,
      },
    ]);
    const res = await request(makeApp()).get("/api/agent/models");
    expect(res.status).toBe(200);
    expect(res.body.models).toHaveLength(1);
    expect(res.body.models[0].id).toBe("claude-sonnet-4.5");
    expect(res.body.models[0].dataResidency).toBe("canada");
  });

  it("returns 500 on registry failure", async () => {
    getActiveModelsMock.mockRejectedValueOnce(new Error("db down"));
    const res = await request(makeApp()).get("/api/agent/models");
    expect(res.status).toBe(500);
  });
});

describe("POST /api/agent/sessions/:id/start", () => {
  it("returns 503 when LLM provider not configured", async () => {
    isProviderConfiguredMock.mockReturnValueOnce(false);
    const res = await request(makeApp()).post("/api/agent/sessions/12345/start").send({});
    expect(res.status).toBe(503);
  });

  it("returns 404 when session does not exist", async () => {
    loadSessionMock.mockResolvedValueOnce(null);
    const res = await request(makeApp()).post("/api/agent/sessions/12345/start").send({});
    expect(res.status).toBe(404);
  });

  it("returns 409 when session is already running", async () => {
    loadSessionMock.mockResolvedValueOnce({
      id: "sess-1",
      status: "idle",
      prompt: "test",
      modelId: "claude-sonnet-4.5",
      maxIterations: 50,
      currentIteration: 0,
      classification: "unclassified",
      blackboard: [],
      scratchpad: "",
      attributes: {},
      finalReport: null,
      error: null,
      createdAt: "2026-05-21T12:00:00Z",
      userId: "user-1",
      ministryCode: "INFRA",
    });
    isSessionRunningMock.mockReturnValueOnce(true);
    const res = await request(makeApp()).post("/api/agent/sessions/sess-1/start").send({});
    expect(res.status).toBe(409);
  });

  it("returns 400 when session status is incompatible", async () => {
    loadSessionMock.mockResolvedValueOnce({
      id: "sess-1",
      status: "completed",
      prompt: "test",
      modelId: "claude-sonnet-4.5",
      maxIterations: 50,
      currentIteration: 3,
      classification: "unclassified",
      blackboard: [],
      scratchpad: "",
      attributes: {},
      finalReport: { message: "done" },
      error: null,
      createdAt: "2026-05-21T12:00:00Z",
      userId: "user-1",
      ministryCode: "INFRA",
    });
    const res = await request(makeApp()).post("/api/agent/sessions/sess-1/start").send({});
    expect(res.status).toBe(400);
  });
});

describe("POST /api/agent/sessions/:id/continue", () => {
  it("rejects empty continuation prompt with 400", async () => {
    const res = await request(makeApp())
      .post("/api/agent/sessions/12345/continue")
      .send({ prompt: "" });
    expect(res.status).toBe(400);
  });

  it("returns 404 when session does not exist", async () => {
    loadSessionMock.mockResolvedValueOnce(null);
    const res = await request(makeApp())
      .post("/api/agent/sessions/12345/continue")
      .send({ prompt: "continue please" });
    expect(res.status).toBe(404);
  });

  it("rejects when continuation prompt contains PII with 422", async () => {
    loadSessionMock.mockResolvedValueOnce({
      id: "sess-1",
      status: "paused",
      prompt: "test",
      modelId: "claude-sonnet-4.5",
      maxIterations: 50,
      currentIteration: 3,
      classification: "unclassified",
      blackboard: [],
      scratchpad: "",
      attributes: {},
      finalReport: null,
      error: null,
      createdAt: "2026-05-21T12:00:00Z",
      userId: "user-1",
      ministryCode: "INFRA",
    });
    const res = await request(makeApp())
      .post("/api/agent/sessions/sess-1/continue")
      .send({ prompt: "consider my SIN: 046-454-286" });
    expect(res.status).toBe(422);
  });
});

describe("GET /api/agent/sessions/:id/iterations", () => {
  it("returns 404 when the session is not found", async () => {
    loadSessionMock.mockResolvedValueOnce(null);
    const res = await request(makeApp()).get("/api/agent/sessions/missing/iterations");
    expect(res.status).toBe(404);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("returns the persisted iterations for a visible session", async () => {
    loadSessionMock.mockResolvedValueOnce({
      id: "sess-1",
      status: "completed",
      userId: "user-1",
      ministryCode: "INFRA",
    });
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          iteration_number: 1,
          status: "completed",
          user_prompt: "go",
          raw_llm_response: "{}",
          parsed_response: { action: "done" },
          tool_calls: null,
          tool_results: null,
          blackboard_entry: { category: "fact", value: "x" },
          error: null,
          tokens_used: 42,
          duration_ms: 100,
          created_at: new Date("2026-05-21T12:00:00Z"),
        },
      ],
      rowCount: 1,
    });

    const res = await request(makeApp()).get("/api/agent/sessions/sess-1/iterations");
    expect(res.status).toBe(200);
    expect(res.body.iterations).toHaveLength(1);
    expect(res.body.iterations[0].iterationNumber).toBe(1);
    expect(res.body.iterations[0].tokensUsed).toBe(42);
    expect(res.body.iterations[0].blackboardEntry.category).toBe("fact");
  });

  it("returns 500 on DB error", async () => {
    loadSessionMock.mockResolvedValueOnce({ id: "sess-1", userId: "user-1" });
    queryMock.mockRejectedValueOnce(new Error("connection refused"));
    const res = await request(makeApp()).get("/api/agent/sessions/sess-1/iterations");
    expect(res.status).toBe(500);
  });
});

describe("GET /api/agent/sessions/:id/export", () => {
  it("returns 404 when the session is not found", async () => {
    loadSessionMock.mockResolvedValueOnce(null);
    const res = await request(makeApp()).get("/api/agent/sessions/missing/export");
    expect(res.status).toBe(404);
    // The exporter must never run any DB query for a session that's invisible
    // to the requesting user.
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("returns the markdown transcript with correct headers on the happy path", async () => {
    loadSessionMock.mockResolvedValueOnce({
      id: "11111111-2222-3333-4444-555555555555",
      userId: "user-1",
      ministryCode: "INFRA",
      prompt: "summarize the speech",
      modelId: "claude-sonnet-4-6",
      maxIterations: 50,
      currentIteration: 2,
      status: "completed",
      classification: "unclassified",
      blackboard: [{ category: "facts", title: "Date", content: "2026", iteration: 1 }],
      scratchpad: "thinking…",
      attributes: { goal_met: true },
      finalReport: { ok: true },
      error: null,
      createdAt: "2026-05-22T10:00:00.000Z",
    });
    // First query → iterations, second → artifacts. Both empty for this happy-path case.
    queryMock
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(makeApp()).get(
      "/api/agent/sessions/11111111-2222-3333-4444-555555555555/export",
    );

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/markdown/);
    expect(res.headers["content-disposition"]).toBe(
      'attachment; filename="abc-session-11111111.md"',
    );
    expect(res.headers["cache-control"]).toBe("private, no-store");
    // Body should include the core sections produced by the exporter.
    expect(res.text).toContain("# ABC Free Agent — Session Transcript");
    expect(res.text).toContain("summarize the speech");
    expect(res.text).toContain('| `goal_met` | true |');
    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  it("returns 500 on DB error during export", async () => {
    loadSessionMock.mockResolvedValueOnce({
      id: "sess-1",
      userId: "user-1",
      ministryCode: null,
      prompt: "",
      modelId: "claude-sonnet-4-6",
      maxIterations: 50,
      currentIteration: 0,
      status: "completed",
      classification: "unclassified",
      blackboard: [],
      scratchpad: "",
      attributes: {},
      finalReport: null,
      error: null,
      createdAt: "2026-05-21T12:00:00Z",
    });
    queryMock.mockRejectedValueOnce(new Error("connection refused"));
    const res = await request(makeApp()).get("/api/agent/sessions/sess-1/export");
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/export/i);
  });
});
