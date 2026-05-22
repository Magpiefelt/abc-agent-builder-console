/**
 * Route-level tests for the F8 star/pin endpoints (Bot 19).
 *
 * Lives next to agent.test.ts but in its own file so the test boundary is
 * obvious — if anyone re-organises the star/pin schema later, every
 * relevant assertion is in one place. Mock surface mirrors agent.test.ts so
 * the suite can boot without DB, LLM, or orchestrator I/O.
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

const logAuditMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const auditAgentEventMock = vi.hoisted(() => vi.fn());
vi.mock("../../services/auditLogger.js", async (orig) => {
  const actual = await (orig as () => Promise<Record<string, unknown>>)();
  return {
    ...actual,
    logAudit: logAuditMock,
    auditAgentEvent: auditAgentEventMock,
  };
});

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

const SESSION_ID = "11111111-1111-4111-8111-111111111111";

function mockOwnedSession(): void {
  loadSessionMock.mockResolvedValueOnce({
    id: SESSION_ID,
    userId: "00000000-0000-0000-0000-000000000001",
    ministryCode: "INFRA",
    prompt: "test",
    modelId: "claude-sonnet-4-6",
    maxIterations: 10,
    currentIteration: 1,
    status: "completed",
    classification: "unclassified",
    blackboard: [],
    scratchpad: "",
    attributes: {},
    finalReport: null,
    error: null,
    createdAt: "2026-05-22T00:00:00Z",
  });
}

beforeEach(() => {
  queryMock.mockReset();
  loadSessionMock.mockReset();
  logAuditMock.mockReset();
  auditAgentEventMock.mockReset();
  isSessionRunningMock.mockReturnValue(false);
});

describe("PATCH /api/agent/sessions/:id/star", () => {
  it("rejects a non-boolean starred field with 400", async () => {
    const res = await request(makeApp())
      .patch(`/api/agent/sessions/${SESSION_ID}/star`)
      .send({ starred: "true" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/boolean/);
  });

  it("returns 404 when the session is not owned by the caller", async () => {
    loadSessionMock.mockResolvedValueOnce(null);
    const res = await request(makeApp())
      .patch(`/api/agent/sessions/${SESSION_ID}/star`)
      .send({ starred: true });
    expect(res.status).toBe(404);
  });

  it("stars a session, audits the action, returns the new state", async () => {
    mockOwnedSession();
    queryMock.mockResolvedValueOnce({ rows: [{ starred: true }], rowCount: 1 });

    const res = await request(makeApp())
      .patch(`/api/agent/sessions/${SESSION_ID}/star`)
      .send({ starred: true });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: SESSION_ID, starred: true });
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringMatching(/UPDATE agent_sessions SET starred/i),
      [true, SESSION_ID, "00000000-0000-0000-0000-000000000001"],
    );
    expect(auditAgentEventMock).toHaveBeenCalledWith(
      "00000000-0000-0000-0000-000000000001",
      "agent.session.starred",
      SESSION_ID,
      { starred: true },
    );
  });

  it("unstars a session", async () => {
    mockOwnedSession();
    queryMock.mockResolvedValueOnce({ rows: [{ starred: false }], rowCount: 1 });

    const res = await request(makeApp())
      .patch(`/api/agent/sessions/${SESSION_ID}/star`)
      .send({ starred: false });

    expect(res.status).toBe(200);
    expect(res.body.starred).toBe(false);
  });

  it("returns 404 when the UPDATE finds no row (race with delete)", async () => {
    mockOwnedSession();
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(makeApp())
      .patch(`/api/agent/sessions/${SESSION_ID}/star`)
      .send({ starred: true });

    expect(res.status).toBe(404);
  });

  it("returns 500 when the database throws", async () => {
    mockOwnedSession();
    queryMock.mockRejectedValueOnce(new Error("db down"));

    const res = await request(makeApp())
      .patch(`/api/agent/sessions/${SESSION_ID}/star`)
      .send({ starred: true });

    expect(res.status).toBe(500);
  });
});

describe("PATCH /api/agent/sessions/:id/iterations/:n/pin", () => {
  it("rejects a non-boolean pinned field with 400", async () => {
    const res = await request(makeApp())
      .patch(`/api/agent/sessions/${SESSION_ID}/iterations/3/pin`)
      .send({ pinned: 1 });
    expect(res.status).toBe(400);
  });

  it("rejects a negative iteration number with 400", async () => {
    const res = await request(makeApp())
      .patch(`/api/agent/sessions/${SESSION_ID}/iterations/-2/pin`)
      .send({ pinned: true });
    expect(res.status).toBe(400);
  });

  it("rejects a non-numeric iteration number with 400", async () => {
    const res = await request(makeApp())
      .patch(`/api/agent/sessions/${SESSION_ID}/iterations/abc/pin`)
      .send({ pinned: true });
    expect(res.status).toBe(400);
  });

  it("returns 404 when the session is not owned by the caller", async () => {
    loadSessionMock.mockResolvedValueOnce(null);
    const res = await request(makeApp())
      .patch(`/api/agent/sessions/${SESSION_ID}/iterations/3/pin`)
      .send({ pinned: true });
    expect(res.status).toBe(404);
  });

  it("returns 404 when the iteration row does not exist", async () => {
    mockOwnedSession();
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(makeApp())
      .patch(`/api/agent/sessions/${SESSION_ID}/iterations/999/pin`)
      .send({ pinned: true });

    expect(res.status).toBe(404);
  });

  it("pins an iteration, audits the action, returns the new state", async () => {
    mockOwnedSession();
    queryMock.mockResolvedValueOnce({ rows: [{ pinned: true }], rowCount: 1 });

    const res = await request(makeApp())
      .patch(`/api/agent/sessions/${SESSION_ID}/iterations/3/pin`)
      .send({ pinned: true });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sessionId: SESSION_ID, iterationNumber: 3, pinned: true });
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringMatching(/UPDATE agent_iterations SET pinned/i),
      [true, SESSION_ID, 3],
    );
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "00000000-0000-0000-0000-000000000001",
        action: "agent.iteration.pinned",
        resourceType: "agent_iteration",
        resourceId: `${SESSION_ID}:3`,
        details: { sessionId: SESSION_ID, iterationNumber: 3, pinned: true },
      }),
    );
  });
});

describe("GET /api/agent/sessions/:id (starred surfacing)", () => {
  it("includes starred=true when the side-query reports true", async () => {
    mockOwnedSession();
    queryMock.mockResolvedValueOnce({ rows: [{ starred: true }], rowCount: 1 });

    const res = await request(makeApp()).get(`/api/agent/sessions/${SESSION_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.starred).toBe(true);
  });

  it("falls back to starred=false when the side-query throws", async () => {
    mockOwnedSession();
    queryMock.mockRejectedValueOnce(new Error("schema not migrated"));

    const res = await request(makeApp()).get(`/api/agent/sessions/${SESSION_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.starred).toBe(false);
  });
});

describe("GET /api/agent/sessions/:id/iterations (pinned surfacing)", () => {
  it("returns pinned=true|false per iteration row", async () => {
    mockOwnedSession();
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          iteration_number: 1,
          status: "completed",
          user_prompt: null,
          raw_llm_response: null,
          parsed_response: null,
          tool_calls: [],
          tool_results: [],
          blackboard_entry: null,
          error: null,
          tokens_used: 100,
          duration_ms: 200,
          created_at: new Date("2026-05-22T00:00:00Z"),
          pinned: true,
        },
        {
          iteration_number: 2,
          status: "completed",
          user_prompt: null,
          raw_llm_response: null,
          parsed_response: null,
          tool_calls: [],
          tool_results: [],
          blackboard_entry: null,
          error: null,
          tokens_used: 50,
          duration_ms: 100,
          created_at: new Date("2026-05-22T00:01:00Z"),
          pinned: false,
        },
      ],
      rowCount: 2,
    });

    const res = await request(makeApp()).get(`/api/agent/sessions/${SESSION_ID}/iterations`);

    expect(res.status).toBe(200);
    expect(res.body.iterations).toHaveLength(2);
    expect(res.body.iterations[0]).toMatchObject({ iterationNumber: 1, pinned: true });
    expect(res.body.iterations[1]).toMatchObject({ iterationNumber: 2, pinned: false });
  });
});
