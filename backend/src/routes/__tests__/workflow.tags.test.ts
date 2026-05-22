/**
 * Workflow tag system tests (Bot 17, F5).
 *
 * Covers the tag-handling additions to the existing workflow routes:
 *   - POST  /api/workflows           accepts/validates/normalises `tags`
 *   - PUT   /api/workflows/:id       partial update of `tags`
 *   - GET   /api/workflows?tag=...   array-overlap filter
 *   - POST  /api/workflows/:id/duplicate  inherits source tags
 *
 * Existing tests in workflow.test.ts already exercise the surrounding CRUD,
 * version history, executions, and PII paths — this file only adds the new
 * surface so it lands cleanly against any concurrent fixes to the older
 * tests.
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
    WORKFLOW_TRASH_RETENTION_DAYS: 30,
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

beforeEach(() => {
  queryMock.mockReset();
  transactionMock.mockReset();
});

// ============================================================================
// POST — tag validation + normalisation
// ============================================================================

describe("POST /api/workflows — tags", () => {
  function stubCreateTransaction(): {
    inserts: { sql: string; params: unknown[] }[];
  } {
    const inserts: { sql: string; params: unknown[] }[] = [];
    transactionMock.mockImplementationOnce(async (cb) => {
      const client = {
        query: vi.fn(async (sql: string, params: unknown[]) => {
          inserts.push({ sql, params });
          if (sql.startsWith("INSERT INTO workflows")) {
            return { rowCount: 1, rows: [{ id: WORKFLOW_ID }] };
          }
          return { rowCount: 1, rows: [] };
        }),
      };
      return cb(client as never);
    });
    return { inserts };
  }

  it("accepts a valid tags array and forwards it to the INSERT", async () => {
    const { inserts } = stubCreateTransaction();
    // Final SELECT after insert.
    queryMock.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: WORKFLOW_ID, tags: ["education", "research"] }],
    });

    const res = await request(makeApp())
      .post("/api/workflows")
      .send({ name: "Tagged workflow", tags: ["education", "research"] });

    expect(res.status).toBe(201);
    expect(res.body.tags).toEqual(["education", "research"]);
    const workflowInsert = inserts.find((c) => c.sql.startsWith("INSERT INTO workflows"));
    expect(workflowInsert).toBeDefined();
    // The 8th positional parameter (0-indexed 7) is `tags`.
    expect(workflowInsert!.params[7]).toEqual(["education", "research"]);
  });

  it("lowercases, trims, and dedupes tags before storage", async () => {
    const { inserts } = stubCreateTransaction();
    queryMock.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: WORKFLOW_ID, tags: ["education", "research"] }],
    });

    const res = await request(makeApp())
      .post("/api/workflows")
      .send({
        name: "Tagged workflow",
        tags: ["  EDUCATION ", "Research", "education", ""],
      });

    expect(res.status).toBe(201);
    const workflowInsert = inserts.find((c) => c.sql.startsWith("INSERT INTO workflows"));
    expect(workflowInsert!.params[7]).toEqual(["education", "research"]);
  });

  it("400s when tags is not an array", async () => {
    const res = await request(makeApp())
      .post("/api/workflows")
      .send({ name: "Tagged workflow", tags: "education" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/tags must be an array/i);
  });

  it("400s on a tag with whitespace or invalid characters", async () => {
    const res = await request(makeApp())
      .post("/api/workflows")
      .send({ name: "Tagged workflow", tags: ["with space"] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/lowercase alphanumeric/i);
  });

  it("400s on a tag longer than 32 characters", async () => {
    const tooLong = "a".repeat(33);
    const res = await request(makeApp())
      .post("/api/workflows")
      .send({ name: "Tagged workflow", tags: [tooLong] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/32 characters/);
  });

  it("400s when more than 12 distinct tags are supplied", async () => {
    const many = Array.from({ length: 13 }, (_, i) => `tag-${i}`);
    const res = await request(makeApp())
      .post("/api/workflows")
      .send({ name: "Tagged workflow", tags: many });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Too many tags/i);
  });

  it("defaults to an empty tag list when tags is omitted", async () => {
    const { inserts } = stubCreateTransaction();
    queryMock.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: WORKFLOW_ID, tags: [] }],
    });

    const res = await request(makeApp())
      .post("/api/workflows")
      .send({ name: "Untagged" });

    expect(res.status).toBe(201);
    const workflowInsert = inserts.find((c) => c.sql.startsWith("INSERT INTO workflows"));
    expect(workflowInsert!.params[7]).toEqual([]);
  });
});

// ============================================================================
// PUT — partial update + version-bump rules
// ============================================================================

describe("PUT /api/workflows/:id — tags", () => {
  function stubExistingRow(tags: string[]): void {
    queryMock.mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        {
          user_id: OWNER_ID,
          ministry_code: "INFRA",
          version: 5,
          canvas_data: { nodes: [], edges: [], version: 1 },
          tags,
        },
      ],
    });
  }

  function stubRefreshRow(tags: string[]): void {
    queryMock.mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        {
          id: WORKFLOW_ID,
          user_id: OWNER_ID,
          ministry_code: "INFRA",
          name: "wf",
          description: null,
          classification: "unclassified",
          canvas_data: { nodes: [], edges: [], version: 1 },
          is_template: false,
          tags,
          version: 5,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ],
    });
  }

  function captureUpdate(): { sql: string | null; params: unknown[] | null } {
    const captured: { sql: string | null; params: unknown[] | null } = {
      sql: null,
      params: null,
    };
    transactionMock.mockImplementationOnce(async (cb) => {
      const client = {
        query: vi.fn(async (sql: string, params: unknown[]) => {
          if (sql.startsWith("UPDATE workflows SET")) {
            captured.sql = sql;
            captured.params = params;
          }
          return { rowCount: 1, rows: [] };
        }),
      };
      return cb(client as never);
    });
    return captured;
  }

  it("updates only `tags` when supplied without other fields", async () => {
    stubExistingRow(["education"]);
    const captured = captureUpdate();
    stubRefreshRow(["education", "research"]);

    const res = await request(makeApp())
      .put(`/api/workflows/${WORKFLOW_ID}`)
      .send({ tags: ["education", "research"] });

    expect(res.status).toBe(200);
    expect(res.body.tags).toEqual(["education", "research"]);
    expect(captured.sql).toMatch(/tags = \$1/);
    expect(captured.params![0]).toEqual(["education", "research"]);
  });

  it("does not touch tags when the body omits them", async () => {
    stubExistingRow(["education"]);
    const captured = captureUpdate();
    stubRefreshRow(["education"]);

    const res = await request(makeApp())
      .put(`/api/workflows/${WORKFLOW_ID}`)
      .send({ name: "Renamed" });

    expect(res.status).toBe(200);
    // No `tags = $N` fragment in the SET clause.
    expect(captured.sql).not.toMatch(/tags = /);
  });

  it("400s on an invalid tag in a PUT", async () => {
    stubExistingRow(["education"]);
    const res = await request(makeApp())
      .put(`/api/workflows/${WORKFLOW_ID}`)
      .send({ tags: ["NOT VALID"] });
    expect(res.status).toBe(400);
  });
});

// ============================================================================
// GET — tag filter
// ============================================================================

describe("GET /api/workflows?tag=…", () => {
  it("appends an array-overlap predicate for a single tag", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    await request(makeApp()).get("/api/workflows?tag=education");
    const call = queryMock.mock.calls[0];
    const sql = call[0] as string;
    const params = call[1] as unknown[];
    expect(sql).toMatch(/tags && \$\d+::text\[]/);
    expect(params[params.length - 1]).toEqual(["education"]);
  });

  it("collects multiple tag values into the same array predicate", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    await request(makeApp()).get("/api/workflows?tag=education&tag=research");
    const params = queryMock.mock.calls[0][1] as unknown[];
    expect(params[params.length - 1]).toEqual(["education", "research"]);
  });

  it("omits the predicate when no tag query string is provided", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    await request(makeApp()).get("/api/workflows");
    const sql = queryMock.mock.calls[0][0] as string;
    expect(sql).not.toMatch(/tags && /);
  });

  it("400s when a query tag is invalid", async () => {
    const res = await request(makeApp()).get("/api/workflows?tag=NOT%20VALID");
    expect(res.status).toBe(400);
  });
});

// ============================================================================
// DUPLICATE — tags inherit, is_template is reset
// ============================================================================

describe("POST /api/workflows/:id/duplicate — tags", () => {
  it("copies source tags into the new row but resets is_template", async () => {
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
            tags: ["education", "research"],
          },
        ],
      })
      // SELECT refreshed row
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: newId,
            name: "Researcher (copy)",
            version: 1,
            is_template: false,
            tags: ["education", "research"],
          },
        ],
      });

    let inheritedTagsParam: unknown = null;
    transactionMock.mockImplementationOnce(async (cb) => {
      const client = {
        query: vi.fn(async (sql: string, params: unknown[]) => {
          if (sql.startsWith("INSERT INTO workflows")) {
            inheritedTagsParam = params[6]; // tags column position
            return { rowCount: 1, rows: [{ id: newId }] };
          }
          return { rowCount: 1, rows: [] };
        }),
      };
      return cb(client as never);
    });

    const res = await request(makeApp())
      .post(`/api/workflows/${WORKFLOW_ID}/duplicate`)
      .send({});
    expect(res.status).toBe(201);
    expect(inheritedTagsParam).toEqual(["education", "research"]);
    expect(res.body.tags).toEqual(["education", "research"]);
    expect(res.body.is_template).toBe(false);
  });
});
