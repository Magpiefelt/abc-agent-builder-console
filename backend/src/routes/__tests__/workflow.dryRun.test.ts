/**
 * Route-level tests for POST /api/workflows/:id/execute dryRun semantics.
 *
 * These pin the small but load-bearing contract between the workflow route and
 * the executor service:
 *
 *  - `dryRun: true` in the request body propagates into the ExecutionContext.
 *  - When dryRun=true the provider-not-configured 503 is skipped (a dry run
 *    never calls the LLM).
 *  - When dryRun is absent the route still defaults to a real run.
 *  - Loose coercion: "true" and 1 also count, but "false" / undefined / null
 *    do not.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const queryMock = vi.hoisted(() => vi.fn());
const transactionMock = vi.hoisted(() => vi.fn());
vi.mock("../../config/database.js", () => ({
  query: queryMock,
  transaction: transactionMock,
}));

const isProviderConfiguredMock = vi.hoisted(() => vi.fn(() => true));
vi.mock("../../services/llmProvider.js", () => ({
  isProviderConfigured: isProviderConfiguredMock,
}));

const runWorkflowMock = vi.hoisted(() =>
  vi.fn(
    async (
      _wf: unknown,
      res: { write: (s: string) => void; end: () => void },
      _ctx: unknown,
    ) => {
      // Mock a real executor: emit one frame, then end the SSE response so
      // supertest can return.
      res.write("data: {\"type\":\"workflow_complete\",\"status\":\"completed\"}\n\n");
      res.end();
    },
  ),
);
const abortExecutionMock = vi.hoisted(() => vi.fn());
const isExecutionRunningMock = vi.hoisted(() => vi.fn(() => false));
vi.mock("../../services/workflowExecutor.js", () => ({
  runWorkflow: runWorkflowMock,
  abortExecution: abortExecutionMock,
  isExecutionRunning: isExecutionRunningMock,
}));

vi.mock("../../services/functionRegistry.js", () => ({
  getCatalog: vi.fn(() => []),
}));

vi.mock("../../config/env.js", () => ({
  env: {
    NODE_ENV: "development",
    PORT: 3000,
    DATABASE_URL: undefined,
    DB_SCHEMA: "test",
    SESSION_SECRET: "test",
    FRONTEND_URL: "http://localhost:5173",
  },
}));

import workflowRouter from "../workflow.js";

function makeApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use("/api/workflows", workflowRouter);
  return app;
}

const OWNER_ID = "00000000-0000-0000-0000-000000000001";
const WORKFLOW_ID = "11111111-1111-1111-1111-111111111111";

function workflowRow(canvas: object) {
  return {
    id: WORKFLOW_ID,
    user_id: OWNER_ID,
    ministry_code: "INFRA",
    name: "Test",
    classification: "unclassified" as const,
    canvas_data: canvas,
    version: 1,
  };
}

const AGENT_CANVAS = {
  version: 1,
  nodes: [
    {
      id: "a1",
      type: "agent",
      position: { x: 0, y: 0 },
      data: {
        kind: "agent",
        label: "Researcher",
        modelId: "claude-sonnet-4-6",
        classification: "unclassified",
        tools: [],
      },
    },
  ],
  edges: [],
};

const FUNCTION_CANVAS = {
  version: 1,
  nodes: [
    {
      id: "n1",
      type: "function",
      position: { x: 0, y: 0 },
      data: { kind: "function", label: "Upper", fnName: "to_upper", params: {} },
    },
  ],
  edges: [],
};

beforeEach(() => {
  queryMock.mockReset();
  transactionMock.mockReset();
  runWorkflowMock.mockClear();
  abortExecutionMock.mockReset();
  isExecutionRunningMock.mockReset().mockReturnValue(false);
  isProviderConfiguredMock.mockReset().mockReturnValue(true);
});

// ---------------------------------------------------------------------------
// dryRun: true → ExecutionContext.dryRun = true
// ---------------------------------------------------------------------------

describe("POST /api/workflows/:id/execute dryRun propagation", () => {
  it("threads dryRun: true into runWorkflow's ExecutionContext", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1, rows: [workflowRow(FUNCTION_CANVAS)] });

    await request(makeApp())
      .post(`/api/workflows/${WORKFLOW_ID}/execute`)
      .send({ dryRun: true })
      .set("Content-Type", "application/json");

    expect(runWorkflowMock).toHaveBeenCalledTimes(1);
    const ctxArg = runWorkflowMock.mock.calls[0][2] as { dryRun?: boolean };
    expect(ctxArg.dryRun).toBe(true);
  });

  it("threads dryRun: false (default) when the field is absent", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1, rows: [workflowRow(FUNCTION_CANVAS)] });

    await request(makeApp())
      .post(`/api/workflows/${WORKFLOW_ID}/execute`)
      .send({})
      .set("Content-Type", "application/json");

    const ctxArg = runWorkflowMock.mock.calls[0][2] as { dryRun?: boolean };
    expect(ctxArg.dryRun).toBe(false);
  });

  it("coerces string 'true' to dryRun true (forgiving client encoding)", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1, rows: [workflowRow(FUNCTION_CANVAS)] });

    await request(makeApp())
      .post(`/api/workflows/${WORKFLOW_ID}/execute`)
      .send({ dryRun: "true" })
      .set("Content-Type", "application/json");

    const ctxArg = runWorkflowMock.mock.calls[0][2] as { dryRun?: boolean };
    expect(ctxArg.dryRun).toBe(true);
  });

  it("does NOT coerce arbitrary truthy strings", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1, rows: [workflowRow(FUNCTION_CANVAS)] });

    await request(makeApp())
      .post(`/api/workflows/${WORKFLOW_ID}/execute`)
      .send({ dryRun: "yes please" })
      .set("Content-Type", "application/json");

    const ctxArg = runWorkflowMock.mock.calls[0][2] as { dryRun?: boolean };
    expect(ctxArg.dryRun).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Provider check skipped on dry-run
// ---------------------------------------------------------------------------

describe("POST /api/workflows/:id/execute provider gating", () => {
  it("real run with no provider configured + agent nodes → 503", async () => {
    isProviderConfiguredMock.mockReturnValue(false);
    queryMock.mockResolvedValueOnce({ rowCount: 1, rows: [workflowRow(AGENT_CANVAS)] });

    const res = await request(makeApp())
      .post(`/api/workflows/${WORKFLOW_ID}/execute`)
      .send({})
      .set("Content-Type", "application/json");

    expect(res.status).toBe(503);
    expect(runWorkflowMock).not.toHaveBeenCalled();
  });

  it("dry run with no provider configured + agent nodes → still runs", async () => {
    isProviderConfiguredMock.mockReturnValue(false);
    queryMock.mockResolvedValueOnce({ rowCount: 1, rows: [workflowRow(AGENT_CANVAS)] });

    const res = await request(makeApp())
      .post(`/api/workflows/${WORKFLOW_ID}/execute`)
      .send({ dryRun: true })
      .set("Content-Type", "application/json");

    expect(res.status).toBe(200);
    expect(runWorkflowMock).toHaveBeenCalledTimes(1);
    const ctxArg = runWorkflowMock.mock.calls[0][2] as { dryRun?: boolean };
    expect(ctxArg.dryRun).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Access control still applies
// ---------------------------------------------------------------------------

describe("POST /api/workflows/:id/execute access control during dry-run", () => {
  it("404s when the workflow does not exist (dry-run)", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const res = await request(makeApp())
      .post(`/api/workflows/${WORKFLOW_ID}/execute`)
      .send({ dryRun: true })
      .set("Content-Type", "application/json");

    expect(res.status).toBe(404);
    expect(runWorkflowMock).not.toHaveBeenCalled();
  });

  it("403s when the caller is neither owner nor in the same ministry (dry-run)", async () => {
    queryMock.mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        {
          ...workflowRow(FUNCTION_CANVAS),
          user_id: "99999999-9999-9999-9999-999999999999",
          ministry_code: "OTHER",
        },
      ],
    });

    const res = await request(makeApp())
      .post(`/api/workflows/${WORKFLOW_ID}/execute`)
      .send({ dryRun: true })
      .set("Content-Type", "application/json");

    expect(res.status).toBe(403);
    expect(runWorkflowMock).not.toHaveBeenCalled();
  });
});
