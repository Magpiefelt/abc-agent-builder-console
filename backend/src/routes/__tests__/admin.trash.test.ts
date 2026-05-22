/**
 * Admin Trash route tests (Bot 10, Backlog B4).
 *
 * Verifies:
 *   - GET  /api/admin/workflows/trash returns soft-deleted rows with
 *     deletedAt + computed expiresAt and the retentionDays the backend
 *     used for the calculation.
 *   - POST /api/admin/workflows/:id/restore flips deleted_at to NULL via
 *     `UPDATE ... WHERE deleted_at IS NOT NULL` (so an already-live workflow
 *     can't be "restored").
 *   - POST /api/admin/workflows/:id/purge hard-deletes only rows already
 *     in the trash, and refuses on a live workflow.
 *   - Both mutating endpoints validate the UUID shape.
 *
 * The dev mock auth user has role 'admin', so authenticate + requireRole
 * pass automatically.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const queryMock = vi.hoisted(() => vi.fn());
vi.mock("../../config/database.js", () => ({ query: queryMock }));

vi.mock("../../services/llmProvider.js", () => ({ clearModelCache: vi.fn() }));
vi.mock("../../services/retentionJob.js", () => ({ runRetentionPass: vi.fn() }));

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

import adminRouter from "../admin.js";

function makeApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use("/api/admin", adminRouter);
  return app;
}

const WORKFLOW_ID = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  queryMock.mockReset();
});

describe("GET /api/admin/workflows/trash", () => {
  it("returns soft-deleted workflows with expiresAt computed from deletedAt + retentionDays", async () => {
    const deletedAt = new Date("2026-05-01T12:00:00Z");
    queryMock.mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        {
          id: WORKFLOW_ID,
          user_id: "u1",
          ministry_code: "INFRA",
          name: "Old workflow",
          description: "desc",
          classification: "unclassified",
          is_template: false,
          version: 2,
          created_at: new Date("2026-04-01T00:00:00Z"),
          updated_at: new Date("2026-04-15T00:00:00Z"),
          deleted_at: deletedAt,
          user_email: "owner@gov.ab.ca",
          user_display_name: "Owner",
        },
      ],
    });

    const res = await request(makeApp()).get("/api/admin/workflows/trash");
    expect(res.status).toBe(200);
    expect(res.body.retentionDays).toBe(30);
    expect(res.body.count).toBe(1);
    expect(res.body.workflows).toHaveLength(1);

    const item = res.body.workflows[0];
    expect(item.id).toBe(WORKFLOW_ID);
    expect(item.userEmail).toBe("owner@gov.ab.ca");
    expect(item.userDisplayName).toBe("Owner");
    expect(item.ministryCode).toBe("INFRA");
    expect(item.deletedAt).toBe(deletedAt.toISOString());

    const expectedExpiry = new Date(deletedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
    expect(item.expiresAt).toBe(expectedExpiry.toISOString());

    const sql = queryMock.mock.calls[0][0] as string;
    expect(sql).toMatch(/deleted_at IS NOT NULL/);
    expect(sql).toMatch(/ORDER BY w\.deleted_at DESC/);
  });

  it("returns an empty list when the trash is empty", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const res = await request(makeApp()).get("/api/admin/workflows/trash");
    expect(res.status).toBe(200);
    expect(res.body.workflows).toEqual([]);
    expect(res.body.count).toBe(0);
  });
});

describe("POST /api/admin/workflows/:id/restore", () => {
  it("400s on an invalid UUID", async () => {
    const res = await request(makeApp()).post("/api/admin/workflows/not-a-uuid/restore");
    expect(res.status).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("404s when the row isn't in the trash (UPDATE matches zero rows)", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const res = await request(makeApp()).post(
      `/api/admin/workflows/${WORKFLOW_ID}/restore`
    );
    expect(res.status).toBe(404);
    const sql = queryMock.mock.calls[0][0] as string;
    expect(sql).toMatch(/UPDATE workflows/);
    expect(sql).toMatch(/SET deleted_at = NULL/);
    expect(sql).toMatch(/WHERE id = \$1 AND deleted_at IS NOT NULL/);
  });

  it("restores and returns the workflow on the happy path", async () => {
    queryMock.mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        {
          id: WORKFLOW_ID,
          name: "Restored workflow",
          user_id: "u1",
          ministry_code: "INFRA",
        },
      ],
    });
    const res = await request(makeApp()).post(
      `/api/admin/workflows/${WORKFLOW_ID}/restore`
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: WORKFLOW_ID,
      restored: true,
      name: "Restored workflow",
    });
  });
});

describe("POST /api/admin/workflows/:id/purge", () => {
  it("400s on an invalid UUID", async () => {
    const res = await request(makeApp()).post("/api/admin/workflows/not-a-uuid/purge");
    expect(res.status).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("404s when the row isn't in the trash (refuses to hard-delete a live workflow)", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const res = await request(makeApp()).post(
      `/api/admin/workflows/${WORKFLOW_ID}/purge`
    );
    expect(res.status).toBe(404);
    expect(queryMock).toHaveBeenCalledTimes(1);
    const sql = queryMock.mock.calls[0][0] as string;
    expect(sql).toMatch(/SELECT/);
    expect(sql).toMatch(/deleted_at IS NOT NULL/);
  });

  it("hard-deletes the row when it is in the trash", async () => {
    queryMock
      // existence check
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: WORKFLOW_ID,
            name: "Stale workflow",
            user_id: "u1",
            ministry_code: "INFRA",
          },
        ],
      })
      // DELETE
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const res = await request(makeApp()).post(
      `/api/admin/workflows/${WORKFLOW_ID}/purge`
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: WORKFLOW_ID,
      purged: true,
      name: "Stale workflow",
    });
    expect(queryMock).toHaveBeenCalledTimes(2);
    const deleteSql = queryMock.mock.calls[1][0] as string;
    expect(deleteSql).toMatch(/DELETE FROM workflows WHERE id = \$1/);
  });
});
