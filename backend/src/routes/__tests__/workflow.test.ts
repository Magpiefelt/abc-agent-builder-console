/**
 * Route-level tests for /api/workflows/* execution-history endpoints.
 *
 * Scoped to the additive history endpoints — list executions, fetch an
 * execution's stage_results, list/fetch artifacts a workflow run produced.
 * Database calls are mocked; the executor itself is exercised in
 * services/__tests__.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const queryMock = vi.hoisted(() => vi.fn());
vi.mock("../../config/database.js", () => ({
  query: queryMock,
  transaction: vi.fn(),
}));

vi.mock("../../services/llmProvider.js", () => ({
  isProviderConfigured: () => true,
}));

vi.mock("../../services/workflowExecutor.js", () => ({
  runWorkflow: vi.fn(),
  abortExecution: vi.fn(),
}));

vi.mock("../../services/functionRegistry.js", () => ({
  getCatalog: () => [],
}));

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

import workflowRouter from "../workflow.js";

const VISIBLE_WORKFLOW_ID = "11111111-1111-1111-1111-111111111111";
const FOREIGN_WORKFLOW_ID = "22222222-2222-2222-2222-222222222222";
const EXECUTION_ID = "33333333-3333-3333-3333-333333333333";
const ARTIFACT_ID = "44444444-4444-4444-4444-444444444444";

// Match the dev mock user in middleware/auth.ts so ministry checks line up.
const MOCK_USER_ID = "00000000-0000-0000-0000-000000000001";
const MOCK_MINISTRY = "INFRA";

function makeApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use("/api/workflows", workflowRouter);
  return app;
}

beforeEach(() => {
  queryMock.mockReset();
});

describe("GET /api/workflows/:id/executions", () => {
  it("returns 404 when the workflow is missing", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(makeApp()).get(
      `/api/workflows/${VISIBLE_WORKFLOW_ID}/executions`,
    );
    expect(res.status).toBe(404);
  });

  it("returns 403 when a foreign-ministry workflow is requested", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ user_id: "someone-else", ministry_code: "OTHER" }],
      rowCount: 1,
    });
    const res = await request(makeApp()).get(
      `/api/workflows/${FOREIGN_WORKFLOW_ID}/executions`,
    );
    expect(res.status).toBe(403);
  });

  it("returns the execution history when caller is the owner", async () => {
    const startedAt = new Date("2026-05-21T10:00:00Z");
    const completedAt = new Date("2026-05-21T10:00:05Z");
    queryMock
      .mockResolvedValueOnce({
        rows: [{ user_id: MOCK_USER_ID, ministry_code: MOCK_MINISTRY }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: EXECUTION_ID,
            workflow_id: VISIBLE_WORKFLOW_ID,
            user_id: MOCK_USER_ID,
            user_email: "user@gov.ab.ca",
            user_display_name: "Dev User",
            classification: "unclassified",
            status: "completed",
            error: null,
            started_at: startedAt,
            completed_at: completedAt,
          },
        ],
        rowCount: 1,
      });

    const res = await request(makeApp()).get(
      `/api/workflows/${VISIBLE_WORKFLOW_ID}/executions`,
    );
    expect(res.status).toBe(200);
    expect(res.body.executions).toHaveLength(1);
    expect(res.body.executions[0].id).toBe(EXECUTION_ID);
    expect(res.body.executions[0].durationMs).toBe(5000);
  });

  it("clamps the limit parameter to the [1, 200] range", async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ user_id: MOCK_USER_ID, ministry_code: MOCK_MINISTRY }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await request(makeApp()).get(
      `/api/workflows/${VISIBLE_WORKFLOW_ID}/executions?limit=9999`,
    );
    const lastCall = queryMock.mock.calls[1];
    expect(lastCall[1]).toEqual([VISIBLE_WORKFLOW_ID, 200]);
  });
});

describe("GET /api/workflows/:id/executions/:executionId", () => {
  it("returns 404 when the execution does not belong to the workflow", async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ user_id: MOCK_USER_ID, ministry_code: MOCK_MINISTRY }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(makeApp()).get(
      `/api/workflows/${VISIBLE_WORKFLOW_ID}/executions/${EXECUTION_ID}`,
    );
    expect(res.status).toBe(404);
  });

  it("returns the stage_results payload on success", async () => {
    const stages = [
      { nodeId: "n1", kind: "agent", value: "hello", durationMs: 12, status: "completed" },
    ];
    queryMock
      .mockResolvedValueOnce({
        rows: [{ user_id: MOCK_USER_ID, ministry_code: MOCK_MINISTRY }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: EXECUTION_ID,
            workflow_id: VISIBLE_WORKFLOW_ID,
            user_id: MOCK_USER_ID,
            classification: "unclassified",
            status: "completed",
            error: null,
            started_at: new Date("2026-05-21T10:00:00Z"),
            completed_at: new Date("2026-05-21T10:00:05Z"),
            stage_results: stages,
          },
        ],
        rowCount: 1,
      });

    const res = await request(makeApp()).get(
      `/api/workflows/${VISIBLE_WORKFLOW_ID}/executions/${EXECUTION_ID}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.stageResults).toEqual(stages);
    expect(res.body.id).toBe(EXECUTION_ID);
  });
});

describe("GET /api/workflows/:id/executions/:executionId/artifacts", () => {
  it("returns 404 when the execution is not owned by the workflow", async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ user_id: MOCK_USER_ID, ministry_code: MOCK_MINISTRY }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(makeApp()).get(
      `/api/workflows/${VISIBLE_WORKFLOW_ID}/executions/${EXECUTION_ID}/artifacts`,
    );
    expect(res.status).toBe(404);
  });

  it("returns artifact metadata (no content) on success", async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ user_id: MOCK_USER_ID, ministry_code: MOCK_MINISTRY }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [{ id: EXECUTION_ID }], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [
          {
            id: ARTIFACT_ID,
            artifact_type: "image",
            title: "Diagram",
            description: null,
            mime_type: "image/png",
            size_bytes: 1024,
            iteration: null,
            created_at: new Date("2026-05-21T10:00:03Z"),
          },
        ],
        rowCount: 1,
      });

    const res = await request(makeApp()).get(
      `/api/workflows/${VISIBLE_WORKFLOW_ID}/executions/${EXECUTION_ID}/artifacts`,
    );
    expect(res.status).toBe(200);
    expect(res.body.artifacts).toHaveLength(1);
    expect(res.body.artifacts[0].id).toBe(ARTIFACT_ID);
    expect(res.body.artifacts[0].content).toBeUndefined();
  });
});

describe("GET /api/workflows/:id/executions/:executionId/artifacts/:artifactId", () => {
  it("returns 404 when the artifact is not in the execution", async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ user_id: MOCK_USER_ID, ministry_code: MOCK_MINISTRY }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(makeApp()).get(
      `/api/workflows/${VISIBLE_WORKFLOW_ID}/executions/${EXECUTION_ID}/artifacts/${ARTIFACT_ID}`,
    );
    expect(res.status).toBe(404);
  });

  it("returns the artifact content (joined to its execution + workflow)", async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ user_id: MOCK_USER_ID, ministry_code: MOCK_MINISTRY }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: ARTIFACT_ID,
            artifact_type: "image",
            title: "Diagram",
            description: null,
            content: "base64payload",
            mime_type: "image/png",
            size_bytes: 1024,
            iteration: null,
            created_at: new Date("2026-05-21T10:00:03Z"),
          },
        ],
        rowCount: 1,
      });

    const res = await request(makeApp()).get(
      `/api/workflows/${VISIBLE_WORKFLOW_ID}/executions/${EXECUTION_ID}/artifacts/${ARTIFACT_ID}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.artifact.id).toBe(ARTIFACT_ID);
    expect(res.body.artifact.content).toBe("base64payload");
  });
});
