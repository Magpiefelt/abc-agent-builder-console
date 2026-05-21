/**
 * Route-level tests for /api/workflows/*.
 *
 * Focus is on the read APIs added on top of the existing CRUD: workflow
 * version history (list / get-one / restore) and workflow executions
 * (list / get-one). The mocked dev user owns the workflow it queries, so
 * ministry-scoping is exercised separately.
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

vi.mock("../../services/llmProvider.js", () => ({
  isProviderConfigured: vi.fn(() => true),
}));

const abortExecutionMock = vi.hoisted(() => vi.fn());
const isExecutionRunningMock = vi.hoisted(() => vi.fn(() => false));
vi.mock("../../services/workflowExecutor.js", () => ({
  runWorkflow: vi.fn(),
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

// The dev mock user from middleware/auth.ts owns this UUID + ministry combo.
const OWNER_ID = "00000000-0000-0000-0000-000000000001";
const WORKFLOW_ID = "11111111-1111-1111-1111-111111111111";
const EXECUTION_ID = "22222222-2222-2222-2222-222222222222";
const FOREIGN_USER_ID = "00000000-0000-0000-0000-000000000099";

beforeEach(() => {
  queryMock.mockReset();
  transactionMock.mockReset();
  abortExecutionMock.mockReset();
  isExecutionRunningMock.mockReset();
  isExecutionRunningMock.mockReturnValue(false);
});

// ============================================================================
// VERSIONS — LIST
// ============================================================================

describe("GET /api/workflows/:id/versions", () => {
  it("400s on an invalid workflow id", async () => {
    const res = await request(makeApp()).get("/api/workflows/not-a-uuid/versions");
    expect(res.status).toBe(400);
  });

  it("404s when the workflow is not visible to the caller", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const res = await request(makeApp()).get(`/api/workflows/${WORKFLOW_ID}/versions`);
    expect(res.status).toBe(404);
  });

  it("403-equivalent (404) when the workflow belongs to another ministry", async () => {
    queryMock.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ user_id: FOREIGN_USER_ID, ministry_code: "OTHER" }],
    });
    const res = await request(makeApp()).get(`/api/workflows/${WORKFLOW_ID}/versions`);
    expect(res.status).toBe(404);
  });

  it("returns version metadata sorted newest first", async () => {
    queryMock
      // access check
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ user_id: OWNER_ID, ministry_code: "INFRA" }],
      })
      // current workflow version
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ version: 3 }] })
      // version list
      .mockResolvedValueOnce({
        rowCount: 2,
        rows: [
          {
            version: 3,
            created_by: OWNER_ID,
            created_at: new Date("2026-05-21T10:00:00Z"),
            created_by_email: "cohen.mcleod@gov.ab.ca",
            created_by_display_name: "Cohen McLeod",
          },
          {
            version: 2,
            created_by: OWNER_ID,
            created_at: new Date("2026-05-20T09:00:00Z"),
            created_by_email: "cohen.mcleod@gov.ab.ca",
            created_by_display_name: "Cohen McLeod",
          },
        ],
      });

    const res = await request(makeApp()).get(`/api/workflows/${WORKFLOW_ID}/versions`);
    expect(res.status).toBe(200);
    expect(res.body.currentVersion).toBe(3);
    expect(res.body.versions).toHaveLength(2);
    expect(res.body.versions[0].version).toBe(3);
    expect(res.body.versions[1].version).toBe(2);
    // canvas_data must not leak in the list payload
    expect(res.body.versions[0].canvasData).toBeUndefined();
  });
});

// ============================================================================
// VERSIONS — GET ONE
// ============================================================================

describe("GET /api/workflows/:id/versions/:version", () => {
  it("400s on a non-numeric version", async () => {
    const res = await request(makeApp()).get(
      `/api/workflows/${WORKFLOW_ID}/versions/oldest`,
    );
    expect(res.status).toBe(400);
  });

  it("400s on version <= 0", async () => {
    const res = await request(makeApp()).get(
      `/api/workflows/${WORKFLOW_ID}/versions/0`,
    );
    expect(res.status).toBe(400);
  });

  it("404s when the version row doesn't exist", async () => {
    queryMock
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ user_id: OWNER_ID, ministry_code: "INFRA" }],
      })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const res = await request(makeApp()).get(
      `/api/workflows/${WORKFLOW_ID}/versions/42`,
    );
    expect(res.status).toBe(404);
  });

  it("returns the historical canvas_data on the happy path", async () => {
    const canvas = { nodes: [], edges: [], version: 1 };
    queryMock
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ user_id: OWNER_ID, ministry_code: "INFRA" }],
      })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            version: 2,
            canvas_data: canvas,
            created_by: OWNER_ID,
            created_at: new Date("2026-05-20T09:00:00Z"),
          },
        ],
      });
    const res = await request(makeApp()).get(
      `/api/workflows/${WORKFLOW_ID}/versions/2`,
    );
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(2);
    expect(res.body.canvasData).toEqual(canvas);
  });
});

// ============================================================================
// VERSIONS — RESTORE
// ============================================================================

describe("POST /api/workflows/:id/versions/:version/restore", () => {
  it("404s when the target version does not exist", async () => {
    queryMock.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ user_id: OWNER_ID, ministry_code: "INFRA" }],
    });
    // transaction returns null when the version isn't found
    transactionMock.mockImplementationOnce(async (cb) => {
      const client = {
        query: vi.fn().mockResolvedValueOnce({ rowCount: 0, rows: [] }),
      };
      return cb(client as never);
    });
    const res = await request(makeApp()).post(
      `/api/workflows/${WORKFLOW_ID}/versions/9/restore`,
    );
    expect(res.status).toBe(404);
  });

  it("copies the target canvas, bumps the version, and writes a new snapshot", async () => {
    const oldCanvas = { nodes: [{ id: "a" }], edges: [], version: 1 };
    queryMock
      // access check
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ user_id: OWNER_ID, ministry_code: "INFRA" }],
      })
      // refreshed workflow after restore
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: WORKFLOW_ID,
            user_id: OWNER_ID,
            ministry_code: "INFRA",
            name: "wf",
            description: null,
            classification: "unclassified",
            canvas_data: oldCanvas,
            is_template: false,
            version: 4,
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      });

    const calls: { sql: string; params: unknown[] }[] = [];
    transactionMock.mockImplementationOnce(async (cb) => {
      const client = {
        query: vi.fn(async (sql: string, params: unknown[]) => {
          calls.push({ sql, params });
          if (sql.includes("FROM workflow_versions")) {
            return { rowCount: 1, rows: [{ canvas_data: oldCanvas }] };
          }
          if (sql.includes("SELECT version FROM workflows")) {
            return { rowCount: 1, rows: [{ version: 3 }] };
          }
          return { rowCount: 1, rows: [] };
        }),
      };
      return cb(client as never);
    });

    const res = await request(makeApp()).post(
      `/api/workflows/${WORKFLOW_ID}/versions/2/restore`,
    );
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(4);
    expect(res.body.restoredFromVersion).toBe(2);

    // The transaction must (a) update workflows.canvas_data + version,
    // and (b) insert a fresh workflow_versions row at the bumped version.
    const sawUpdate = calls.some(
      (c) => c.sql.includes("UPDATE workflows SET canvas_data") && c.params[1] === 4,
    );
    const sawInsert = calls.some(
      (c) => c.sql.includes("INSERT INTO workflow_versions") && c.params[1] === 4,
    );
    expect(sawUpdate).toBe(true);
    expect(sawInsert).toBe(true);
  });
});

// ============================================================================
// EXECUTIONS — LIST
// ============================================================================

describe("GET /api/workflows/:id/executions", () => {
  it("400s on an invalid status filter", async () => {
    const res = await request(makeApp()).get(
      `/api/workflows/${WORKFLOW_ID}/executions?status=garbage`,
    );
    expect(res.status).toBe(400);
  });

  it("404s when the workflow is not visible to the caller", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const res = await request(makeApp()).get(
      `/api/workflows/${WORKFLOW_ID}/executions`,
    );
    expect(res.status).toBe(404);
  });

  it("returns paginated execution metadata without stage_results", async () => {
    const started = new Date("2026-05-21T10:00:00Z");
    const completed = new Date("2026-05-21T10:00:05Z");
    queryMock
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ user_id: OWNER_ID, ministry_code: "INFRA" }],
      })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: EXECUTION_ID,
            workflow_id: WORKFLOW_ID,
            user_id: OWNER_ID,
            classification: "unclassified",
            status: "completed",
            error: null,
            started_at: started,
            completed_at: completed,
            stage_count: "3",
            user_email: "cohen.mcleod@gov.ab.ca",
            user_display_name: "Cohen McLeod",
          },
        ],
      });

    const res = await request(makeApp()).get(
      `/api/workflows/${WORKFLOW_ID}/executions?status=completed&limit=50`,
    );
    expect(res.status).toBe(200);
    expect(res.body.executions).toHaveLength(1);
    expect(res.body.executions[0].stageCount).toBe(3);
    expect(res.body.executions[0].durationMs).toBe(5000);
    expect(res.body.executions[0].stageResults).toBeUndefined();
  });

  it("clamps the limit to a sane upper bound", async () => {
    queryMock
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ user_id: OWNER_ID, ministry_code: "INFRA" }],
      })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });

    await request(makeApp()).get(`/api/workflows/${WORKFLOW_ID}/executions?limit=9999`);
    // The last queryMock call must have been issued with LIMIT in the SQL and
    // the value clamped to 100.
    const lastCall = queryMock.mock.calls.at(-1) as [string, unknown[]];
    expect(lastCall[0]).toMatch(/LIMIT/);
    expect(lastCall[1].at(-1)).toBe(100);
  });
});

// ============================================================================
// EXECUTIONS — GET ONE
// ============================================================================

describe("GET /api/workflows/:id/executions/:executionId", () => {
  it("400s on invalid ids", async () => {
    const res = await request(makeApp()).get(
      `/api/workflows/${WORKFLOW_ID}/executions/not-a-uuid`,
    );
    expect(res.status).toBe(400);
  });

  it("404s when the execution does not belong to the workflow", async () => {
    queryMock
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ user_id: OWNER_ID, ministry_code: "INFRA" }],
      })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const res = await request(makeApp()).get(
      `/api/workflows/${WORKFLOW_ID}/executions/${EXECUTION_ID}`,
    );
    expect(res.status).toBe(404);
  });

  it("returns the full stage_results JSON on the happy path", async () => {
    const stageResults = [
      { nodeId: "a", kind: "agent", status: "completed", durationMs: 200, value: "ok" },
    ];
    queryMock
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ user_id: OWNER_ID, ministry_code: "INFRA" }],
      })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: EXECUTION_ID,
            workflow_id: WORKFLOW_ID,
            user_id: OWNER_ID,
            classification: "unclassified",
            status: "completed",
            stage_results: stageResults,
            error: null,
            started_at: new Date("2026-05-21T10:00:00Z"),
            completed_at: new Date("2026-05-21T10:00:01Z"),
            user_email: "cohen.mcleod@gov.ab.ca",
            user_display_name: "Cohen McLeod",
          },
        ],
      });
    const res = await request(makeApp()).get(
      `/api/workflows/${WORKFLOW_ID}/executions/${EXECUTION_ID}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.stageResults).toEqual(stageResults);
    expect(res.body.durationMs).toBe(1000);
  });
});

// ============================================================================
// EXECUTION ARTIFACTS — LIST
// ============================================================================

const ARTIFACT_ID = "33333333-3333-3333-3333-333333333333";

describe("GET /api/workflows/:id/executions/:executionId/artifacts", () => {
  it("400s on an invalid workflow id", async () => {
    const res = await request(makeApp()).get(
      `/api/workflows/not-a-uuid/executions/${EXECUTION_ID}/artifacts`,
    );
    expect(res.status).toBe(400);
  });

  it("400s on an invalid execution id", async () => {
    const res = await request(makeApp()).get(
      `/api/workflows/${WORKFLOW_ID}/executions/bad-uuid/artifacts`,
    );
    expect(res.status).toBe(400);
  });

  it("404s when the workflow is not visible", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const res = await request(makeApp()).get(
      `/api/workflows/${WORKFLOW_ID}/executions/${EXECUTION_ID}/artifacts`,
    );
    expect(res.status).toBe(404);
  });

  it("404s when the execution does not belong to the workflow", async () => {
    queryMock
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ user_id: OWNER_ID, ministry_code: "INFRA" }],
      })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const res = await request(makeApp()).get(
      `/api/workflows/${WORKFLOW_ID}/executions/${EXECUTION_ID}/artifacts`,
    );
    expect(res.status).toBe(404);
  });

  it("returns artifact metadata without content", async () => {
    queryMock
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ user_id: OWNER_ID, ministry_code: "INFRA" }],
      })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: EXECUTION_ID }] })
      .mockResolvedValueOnce({
        rowCount: 1,
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
      });

    const res = await request(makeApp()).get(
      `/api/workflows/${WORKFLOW_ID}/executions/${EXECUTION_ID}/artifacts`,
    );
    expect(res.status).toBe(200);
    expect(res.body.artifacts).toHaveLength(1);
    expect(res.body.artifacts[0].id).toBe(ARTIFACT_ID);
    expect(res.body.artifacts[0].content).toBeUndefined();
    expect(res.body.count).toBe(1);
  });
});

// ============================================================================
// EXECUTION ARTIFACTS — GET ONE
// ============================================================================

describe("GET /api/workflows/:id/executions/:executionId/artifacts/:artifactId", () => {
  it("400s on an invalid artifact id", async () => {
    const res = await request(makeApp()).get(
      `/api/workflows/${WORKFLOW_ID}/executions/${EXECUTION_ID}/artifacts/not-a-uuid`,
    );
    expect(res.status).toBe(400);
  });

  it("404s when the workflow is not visible", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const res = await request(makeApp()).get(
      `/api/workflows/${WORKFLOW_ID}/executions/${EXECUTION_ID}/artifacts/${ARTIFACT_ID}`,
    );
    expect(res.status).toBe(404);
  });

  it("404s when the artifact does not belong to the execution", async () => {
    queryMock
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ user_id: OWNER_ID, ministry_code: "INFRA" }],
      })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const res = await request(makeApp()).get(
      `/api/workflows/${WORKFLOW_ID}/executions/${EXECUTION_ID}/artifacts/${ARTIFACT_ID}`,
    );
    expect(res.status).toBe(404);
  });

  it("returns the joined artifact content on success", async () => {
    queryMock
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ user_id: OWNER_ID, ministry_code: "INFRA" }],
      })
      .mockResolvedValueOnce({
        rowCount: 1,
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
      });

    const res = await request(makeApp()).get(
      `/api/workflows/${WORKFLOW_ID}/executions/${EXECUTION_ID}/artifacts/${ARTIFACT_ID}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.artifact.id).toBe(ARTIFACT_ID);
    expect(res.body.artifact.content).toBe("base64payload");
  });
});

// ============================================================================
// TEMPLATES — LIST FILTER
// ============================================================================

describe("GET /api/workflows?templates=...", () => {
  it("appends the is_template = true filter when templates=true", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    await request(makeApp()).get("/api/workflows?templates=true");
    const sql = queryMock.mock.calls[0][0] as string;
    expect(sql).toMatch(/is_template = true/);
  });

  it("appends the is_template = false filter when templates=false", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    await request(makeApp()).get("/api/workflows?templates=false");
    const sql = queryMock.mock.calls[0][0] as string;
    expect(sql).toMatch(/is_template = false/);
  });

  it("omits the filter when templates is not set", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    await request(makeApp()).get("/api/workflows");
    const sql = queryMock.mock.calls[0][0] as string;
    expect(sql).not.toMatch(/is_template =/);
  });
});

// ============================================================================
// DUPLICATE
// ============================================================================

describe("POST /api/workflows/:id/duplicate", () => {
  it("400s on an invalid workflow id", async () => {
    const res = await request(makeApp())
      .post("/api/workflows/not-a-uuid/duplicate")
      .send({});
    expect(res.status).toBe(400);
  });

  it("400s on an empty-string name override", async () => {
    const res = await request(makeApp())
      .post(`/api/workflows/${WORKFLOW_ID}/duplicate`)
      .send({ name: "   " });
    expect(res.status).toBe(400);
  });

  it("404s when the workflow is not visible to the caller", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const res = await request(makeApp())
      .post(`/api/workflows/${WORKFLOW_ID}/duplicate`)
      .send({});
    expect(res.status).toBe(404);
  });

  it("duplicates the workflow into a new row with default name", async () => {
    const newId = "55555555-5555-5555-5555-555555555555";
    queryMock
      // loadWorkflowForRead
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ user_id: OWNER_ID, ministry_code: "INFRA" }],
      })
      // SELECT source workflow
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            name: "Researcher",
            description: null,
            classification: "unclassified",
            canvas_data: { nodes: [], edges: [], version: 1 },
          },
        ],
      })
      // SELECT refreshed workflow row at the end
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: newId, name: "Researcher (copy)", version: 1, is_template: false }],
      });

    // transaction runs the callback against a mocked client that returns the new id
    transactionMock.mockImplementationOnce(async (fn: (c: unknown) => unknown) => {
      const clientMock = {
        query: vi
          .fn()
          // INSERT workflows RETURNING id
          .mockResolvedValueOnce({ rows: [{ id: newId }] })
          // INSERT workflow_versions
          .mockResolvedValueOnce({ rows: [] }),
      };
      return await fn(clientMock);
    });

    const res = await request(makeApp())
      .post(`/api/workflows/${WORKFLOW_ID}/duplicate`)
      .send({});
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(newId);
    expect(res.body.name).toBe("Researcher (copy)");
  });
});

// ============================================================================
// STOP EXECUTION
// ============================================================================

describe("POST /api/workflows/:id/executions/:executionId/stop", () => {
  it("400s on an invalid workflow id", async () => {
    const res = await request(makeApp()).post(
      `/api/workflows/not-a-uuid/executions/${EXECUTION_ID}/stop`,
    );
    expect(res.status).toBe(400);
  });

  it("404s when the workflow is not visible", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const res = await request(makeApp()).post(
      `/api/workflows/${WORKFLOW_ID}/executions/${EXECUTION_ID}/stop`,
    );
    expect(res.status).toBe(404);
    expect(abortExecutionMock).not.toHaveBeenCalled();
  });

  it("404s when the execution does not belong to the workflow", async () => {
    queryMock
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ user_id: OWNER_ID, ministry_code: "INFRA" }],
      })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const res = await request(makeApp()).post(
      `/api/workflows/${WORKFLOW_ID}/executions/${EXECUTION_ID}/stop`,
    );
    expect(res.status).toBe(404);
    expect(abortExecutionMock).not.toHaveBeenCalled();
  });

  it("404s when the execution is already completed (no longer running)", async () => {
    queryMock
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ user_id: OWNER_ID, ministry_code: "INFRA" }],
      })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: EXECUTION_ID }] });
    isExecutionRunningMock.mockReturnValueOnce(false);

    const res = await request(makeApp()).post(
      `/api/workflows/${WORKFLOW_ID}/executions/${EXECUTION_ID}/stop`,
    );
    expect(res.status).toBe(404);
    expect(abortExecutionMock).not.toHaveBeenCalled();
  });

  it("flips the abort flag and returns 200 when the execution is running", async () => {
    queryMock
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ user_id: OWNER_ID, ministry_code: "INFRA" }],
      })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: EXECUTION_ID }] });
    isExecutionRunningMock.mockReturnValueOnce(true);

    const res = await request(makeApp()).post(
      `/api/workflows/${WORKFLOW_ID}/executions/${EXECUTION_ID}/stop`,
    );
    expect(res.status).toBe(200);
    expect(res.body.aborted).toBe(true);
    expect(abortExecutionMock).toHaveBeenCalledWith(EXECUTION_ID);
  });
});
