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

vi.mock("../../services/workflowExecutor.js", () => ({
  runWorkflow: vi.fn(),
  abortExecution: vi.fn(),
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
