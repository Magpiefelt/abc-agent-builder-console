/**
 * Route-level tests for /api/admin/*.
 *
 * The dev mock auth user has role 'admin', so all requests automatically
 * pass `authenticate` + `requireRole('admin')` in development mode.
 * Database calls are mocked so no live DB is needed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ---------------------------------------------------------------------------
// Module mocks (hoisted before imports)
// ---------------------------------------------------------------------------

const queryMock = vi.hoisted(() => vi.fn());
vi.mock("../../config/database.js", () => ({ query: queryMock }));

const clearModelCacheMock = vi.hoisted(() => vi.fn());
vi.mock("../../services/llmProvider.js", () => ({ clearModelCache: clearModelCacheMock }));

const runRetentionPassMock = vi.hoisted(() => vi.fn());
vi.mock("../../services/retentionJob.js", () => ({ runRetentionPass: runRetentionPassMock }));

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

// ---------------------------------------------------------------------------
// Import under test (after mocks)
// ---------------------------------------------------------------------------

import adminRouter from "../admin.js";

function makeApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use("/api/admin", adminRouter);
  return app;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  queryMock.mockReset();
  clearModelCacheMock.mockReset();
  runRetentionPassMock.mockReset();
  // Default audit mock: audit_log inserts from middleware/auditAdminAccess
  queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
});

// ---------------------------------------------------------------------------
// GET /api/admin/audit
// ---------------------------------------------------------------------------

describe("GET /api/admin/audit", () => {
  it("returns 200 with entries array", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ id: "a1", action: "AUTH_LOGIN", created_at: "2026-01-01T00:00:00Z" }],
      rowCount: 1,
    });

    const res = await request(makeApp()).get("/api/admin/audit");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.entries)).toBe(true);
    expect(res.body.count).toBe(1);
  });

  it("accepts optional filter parameters", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(makeApp()).get("/api/admin/audit?action=AUTH_LOGIN&limit=10");
    expect(res.status).toBe(200);
  });

  it("rejects an invalid limit parameter", async () => {
    const res = await request(makeApp()).get("/api/admin/audit?limit=-5");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid query parameters/i);
  });

  it("rejects a limit above 500", async () => {
    const res = await request(makeApp()).get("/api/admin/audit?limit=999");
    expect(res.status).toBe(400);
  });

  it("rejects an invalid datetime for 'from'", async () => {
    const res = await request(makeApp()).get("/api/admin/audit?from=not-a-date");
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /api/admin/pii-detections
// ---------------------------------------------------------------------------

describe("GET /api/admin/pii-detections", () => {
  it("returns 200 with detections array", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ id: "p1", detection_type: "social_insurance_number" }],
      rowCount: 1,
    });

    const res = await request(makeApp()).get("/api/admin/pii-detections");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.detections)).toBe(true);
    expect(res.body.count).toBe(1);
  });

  it("caps the limit at 500", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    // Should not throw; the route silently caps to 500.
    const res = await request(makeApp()).get("/api/admin/pii-detections?limit=9999");
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// GET /api/admin/models
// ---------------------------------------------------------------------------

describe("GET /api/admin/models", () => {
  it("returns 200 with models array", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ id: 1, model_id: "claude-sonnet-4-6", is_active: true }],
      rowCount: 1,
    });

    const res = await request(makeApp()).get("/api/admin/models");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.models)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PUT /api/admin/models/:id
// ---------------------------------------------------------------------------

describe("PUT /api/admin/models/:id", () => {
  it("returns 400 for a non-integer model id", async () => {
    const res = await request(makeApp())
      .put("/api/admin/models/not-a-number")
      .send({ is_active: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/positive integer/i);
  });

  it("returns 400 for a missing is_active body field", async () => {
    const res = await request(makeApp()).put("/api/admin/models/1").send({});
    expect(res.status).toBe(400);
  });

  it("returns 404 when the model is not found", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(makeApp())
      .put("/api/admin/models/999")
      .send({ is_active: false });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("returns 200 and clears model cache on successful update", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ id: 1, model_id: "claude-sonnet-4-6", is_active: false }],
      rowCount: 1,
    });

    const res = await request(makeApp())
      .put("/api/admin/models/1")
      .send({ is_active: false });
    expect(res.status).toBe(200);
    expect(res.body.model.is_active).toBe(false);
    expect(clearModelCacheMock).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// GET /api/admin/sessions
// ---------------------------------------------------------------------------

describe("GET /api/admin/sessions", () => {
  it("returns 200 with sessions array", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ id: "s1", status: "completed" }],
      rowCount: 1,
    });

    const res = await request(makeApp()).get("/api/admin/sessions");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.sessions)).toBe(true);
  });

  it("accepts an optional status filter", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(makeApp()).get("/api/admin/sessions?status=running");
    expect(res.status).toBe(200);
  });

  it("rejects an invalid status filter value", async () => {
    const res = await request(makeApp()).get("/api/admin/sessions?status=invalid_status");
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/retention/run
// ---------------------------------------------------------------------------

describe("POST /api/admin/retention/run", () => {
  it("returns 200 and a report object when the retention pass succeeds", async () => {
    runRetentionPassMock.mockResolvedValueOnce({ deletedSessions: 3, deletedArtifacts: 12 });

    const res = await request(makeApp()).post("/api/admin/retention/run");
    expect(res.status).toBe(200);
    // The route returns { report: <result> } not { result: ... }
    expect(res.body.report).toBeDefined();
    expect(runRetentionPassMock).toHaveBeenCalledOnce();
  });

  it("returns 500 if the retention job throws", async () => {
    runRetentionPassMock.mockRejectedValueOnce(new Error("DB error"));

    const res = await request(makeApp()).post("/api/admin/retention/run");
    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });
});
