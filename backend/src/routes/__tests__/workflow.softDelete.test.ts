/**
 * Soft-delete route behavior tests (Bot 10, Backlog B4).
 *
 * Verifies that:
 *   - DELETE /api/workflows/:id flips deleted_at instead of running a hard
 *     DELETE statement, and returns recoverableUntil.
 *   - 404 when the workflow is already soft-deleted (the access check
 *     filters deleted_at IS NULL).
 *   - 403 when the caller is neither owner nor admin.
 *   - The GET / list query filters deleted_at IS NULL.
 *   - The LOAD route 404s when deleted_at IS NOT NULL.
 *
 * The DB layer is fully mocked. We assert against the SQL strings the
 * route sends so the filter clauses can't silently regress.
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
  isExecutionRunning: vi.fn(() => false),
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

// Stub the auth middleware so we can drive `req.user.id` + `req.user.role`
// from each test. The real dev-mock middleware always injects an admin user
// whose id matches OWNER_ID — that combination silently bypasses every
// owner/admin RBAC gate this test exists to verify. The user reference is
// hoisted so the vi.mock factory (which is also hoisted) can read from it.
const CALLER_ID = "00000000-0000-0000-0000-0000000000aa";
const currentUser = vi.hoisted(() => ({
  id: "00000000-0000-0000-0000-0000000000aa",
  ministryCode: "INFRA" as string | null,
  role: "user" as "user" | "admin",
}));
vi.mock("../../middleware/auth.js", () => ({
  authenticate: (req: { user: typeof currentUser }, _res: unknown, next: () => void) => {
    req.user = { ...currentUser };
    next();
  },
  requireRole:
    (..._roles: string[]) =>
    (_req: unknown, _res: unknown, next: () => void) =>
      next(),
  DEV_USER: currentUser,
}));

import workflowRouter from "../workflow.js";

function makeApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use("/api/workflows", workflowRouter);
  return app;
}

const OWNER_ID = CALLER_ID;
const WORKFLOW_ID = "11111111-1111-1111-1111-111111111111";
const FOREIGN_USER_ID = "00000000-0000-0000-0000-000000000099";

beforeEach(() => {
  queryMock.mockReset();
  transactionMock.mockReset();
  // Reset to a non-admin caller so each test starts from a known baseline.
  currentUser.id = CALLER_ID;
  currentUser.role = "user";
  currentUser.ministryCode = "INFRA";
});

describe("DELETE /api/workflows/:id (soft-delete)", () => {
  it("404s when the workflow is already in the Trash", async () => {
    // Access check returns no rows because deleted_at IS NULL is filtered out.
    queryMock.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const res = await request(makeApp()).delete(`/api/workflows/${WORKFLOW_ID}`);
    expect(res.status).toBe(404);
    // The access-check SELECT MUST filter deleted_at IS NULL.
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(queryMock.mock.calls[0][0]).toMatch(/deleted_at IS NULL/);
  });

  it("403s when the caller is neither owner nor admin", async () => {
    queryMock.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ user_id: FOREIGN_USER_ID, ministry_code: "OTHER" }],
    });
    const res = await request(makeApp()).delete(`/api/workflows/${WORKFLOW_ID}`);
    expect(res.status).toBe(403);
    // Only the access SELECT — no UPDATE attempted.
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it("flips deleted_at via UPDATE (not DELETE) and returns recoverableUntil", async () => {
    const deletedAt = new Date("2026-05-22T12:00:00Z");
    queryMock
      // access check
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ user_id: OWNER_ID, ministry_code: "INFRA" }],
      })
      // soft-delete UPDATE
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ deleted_at: deletedAt }],
      });

    const res = await request(makeApp()).delete(`/api/workflows/${WORKFLOW_ID}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: WORKFLOW_ID,
      deleted: true,
      soft: true,
      deletedAt: deletedAt.toISOString(),
    });
    // recoverableUntil is exactly 30 days after deletedAt.
    const expected = new Date(deletedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
    expect(res.body.recoverableUntil).toBe(expected.toISOString());

    // The second query MUST be an UPDATE that sets deleted_at, not a DELETE.
    const secondCall = queryMock.mock.calls[1][0] as string;
    expect(secondCall).toMatch(/UPDATE workflows/);
    expect(secondCall).toMatch(/SET deleted_at = NOW\(\)/);
    expect(secondCall).not.toMatch(/^\s*DELETE FROM workflows/);
  });
});

describe("GET /api/workflows (list filters trash)", () => {
  it("includes AND deleted_at IS NULL in the list query", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const res = await request(makeApp()).get("/api/workflows");
    expect(res.status).toBe(200);
    const sql = queryMock.mock.calls[0][0] as string;
    expect(sql).toMatch(/deleted_at IS NULL/);
  });
});

describe("GET /api/workflows/:id (load filters trash)", () => {
  it("404s when the workflow is soft-deleted (filter excludes it)", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const res = await request(makeApp()).get(`/api/workflows/${WORKFLOW_ID}`);
    expect(res.status).toBe(404);
    const sql = queryMock.mock.calls[0][0] as string;
    expect(sql).toMatch(/deleted_at IS NULL/);
  });
});

describe("loadWorkflowForRead (via duplicate / versions / executions)", () => {
  it("treats soft-deleted rows as not found from duplicate", async () => {
    // First call is the access-check SELECT done by loadWorkflowForRead.
    queryMock.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const res = await request(makeApp())
      .post(`/api/workflows/${WORKFLOW_ID}/duplicate`)
      .send({ name: "copy" });
    expect(res.status).toBe(404);
    const sql = queryMock.mock.calls[0][0] as string;
    expect(sql).toMatch(/deleted_at IS NULL/);
  });
});
