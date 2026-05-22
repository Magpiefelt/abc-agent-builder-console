/**
 * Route-level tests for /api/compliance/*.
 *
 * The dev mock auth user has role 'admin', so all requests automatically
 * pass `authenticate` + `requireRole('admin')` in development mode. The
 * evidence collector is mocked so no DB or filesystem is touched.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ---------------------------------------------------------------------------
// Module mocks (hoisted before imports)
// ---------------------------------------------------------------------------

const persistDailyEvidenceMock = vi.hoisted(() => vi.fn());
const readLatestEvidenceMock = vi.hoisted(() => vi.fn());
const listCollectionsMock = vi.hoisted(() => vi.fn());
const getCollectionMock = vi.hoisted(() => vi.fn());
vi.mock("../../services/evidenceCollector.js", () => ({
  persistDailyEvidence: persistDailyEvidenceMock,
  readLatestEvidence: readLatestEvidenceMock,
  listCollections: listCollectionsMock,
  getCollection: getCollectionMock,
}));

const auditActionMock = vi.hoisted(() => vi.fn());
vi.mock("../../services/auditLogger.js", () => ({
  auditAction: auditActionMock,
  AuditAction: {
    ADMIN_ACCESS: "admin.access",
    ADMIN_AUDIT_EXPORTED: "admin.audit.exported",
  },
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

vi.mock("../../services/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Import under test (after mocks)
// ---------------------------------------------------------------------------

import complianceRouter from "../compliance.js";

function makeApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use("/api/compliance", complianceRouter);
  return app;
}

beforeEach(() => {
  persistDailyEvidenceMock.mockReset();
  readLatestEvidenceMock.mockReset();
  listCollectionsMock.mockReset();
  getCollectionMock.mockReset();
  auditActionMock.mockReset();
});

// ---------------------------------------------------------------------------
// POST /api/compliance/evidence/run
// ---------------------------------------------------------------------------

describe("POST /api/compliance/evidence/run", () => {
  it("returns 200 with the persisted snapshot when generation succeeds", async () => {
    const fakeResult = {
      filename: "evidence_2026-05-22.md",
      filePath: "/tmp/evidence_2026-05-22.md",
      snapshot: {
        generatedAt: "2026-05-22T03:00:00Z",
        date: "2026-05-22",
        version: "1",
        sections: {},
      },
      markdown: "# ABC Compliance Evidence — 2026-05-22\n",
    };
    persistDailyEvidenceMock.mockResolvedValueOnce(fakeResult);
    const res = await request(makeApp()).post("/api/compliance/evidence/run");
    expect(res.status).toBe(200);
    expect(res.body.filename).toBe("evidence_2026-05-22.md");
    expect(res.body.markdown).toContain("ABC Compliance Evidence");
    expect(res.body.snapshot.date).toBe("2026-05-22");
  });

  it("invokes the collector exactly once per request", async () => {
    persistDailyEvidenceMock.mockResolvedValueOnce({
      filename: "evidence_2026-05-22.md",
      filePath: "/tmp/e.md",
      snapshot: { generatedAt: "", date: "2026-05-22", version: "1", sections: {} },
      markdown: "",
    });
    await request(makeApp()).post("/api/compliance/evidence/run");
    expect(persistDailyEvidenceMock).toHaveBeenCalledTimes(1);
  });

  it("forwards admin context (triggeredBy + userId) into the collector", async () => {
    persistDailyEvidenceMock.mockResolvedValueOnce({
      filename: "evidence_2026-05-22.md",
      filePath: "/tmp/e.md",
      snapshot: { generatedAt: "", date: "2026-05-22", version: "1", sections: {} },
      markdown: "",
    });
    await request(makeApp()).post("/api/compliance/evidence/run");
    // The route tags the admin trigger with the user's id so audit reviewers
    // can attribute on-demand snapshots to a specific operator. The scheduler
    // path uses the literal string "scheduler" instead.
    expect(persistDailyEvidenceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        triggeredBy: expect.any(String),
        userId: expect.any(String),
      }),
    );
    const opts = persistDailyEvidenceMock.mock.calls[0][0];
    expect(opts.triggeredBy).toBe(opts.userId);
  });

  it("returns 500 when the collector throws", async () => {
    persistDailyEvidenceMock.mockRejectedValueOnce(new Error("disk full"));
    const res = await request(makeApp()).post("/api/compliance/evidence/run");
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/Failed to generate evidence snapshot/);
  });
});

// ---------------------------------------------------------------------------
// GET /api/compliance/evidence/latest
// ---------------------------------------------------------------------------

describe("GET /api/compliance/evidence/latest", () => {
  it("returns 200 with the most-recent snapshot's contents", async () => {
    readLatestEvidenceMock.mockResolvedValueOnce({
      filename: "evidence_2026-05-22.md",
      filePath: "/tmp/evidence_2026-05-22.md",
      date: "2026-05-22",
      markdown: "# Snapshot body",
    });
    const res = await request(makeApp()).get("/api/compliance/evidence/latest");
    expect(res.status).toBe(200);
    expect(res.body.filename).toBe("evidence_2026-05-22.md");
    expect(res.body.date).toBe("2026-05-22");
    expect(res.body.markdown).toBe("# Snapshot body");
  });

  it("returns 404 when no snapshot exists yet", async () => {
    readLatestEvidenceMock.mockResolvedValueOnce(null);
    const res = await request(makeApp()).get("/api/compliance/evidence/latest");
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/No evidence snapshots/);
  });

  it("returns 500 when the file read throws", async () => {
    readLatestEvidenceMock.mockRejectedValueOnce(new Error("permission denied"));
    const res = await request(makeApp()).get("/api/compliance/evidence/latest");
    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// GET /api/compliance/evidence (list)
// ---------------------------------------------------------------------------

describe("GET /api/compliance/evidence", () => {
  it("returns 200 with the collections array", async () => {
    listCollectionsMock.mockResolvedValueOnce([
      { id: "c1", collected_at: "2026-05-22T03:00:00Z", triggered_by: "scheduler" },
      { id: "c2", collected_at: "2026-05-21T03:00:00Z", triggered_by: "scheduler" },
    ]);
    const res = await request(makeApp()).get("/api/compliance/evidence");
    expect(res.status).toBe(200);
    expect(res.body.collections).toHaveLength(2);
    expect(res.body.collections[0].id).toBe("c1");
  });

  it("forwards the limit query parameter to listCollections", async () => {
    listCollectionsMock.mockResolvedValueOnce([]);
    await request(makeApp()).get("/api/compliance/evidence?limit=10");
    expect(listCollectionsMock).toHaveBeenCalledWith({ limit: 10 });
  });

  it("rejects an out-of-range limit with 400", async () => {
    const res = await request(makeApp()).get("/api/compliance/evidence?limit=9999");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid query parameters/);
  });

  it("returns 500 when listCollections throws", async () => {
    listCollectionsMock.mockRejectedValueOnce(new Error("DB on fire"));
    const res = await request(makeApp()).get("/api/compliance/evidence");
    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// GET /api/compliance/evidence/:id
// ---------------------------------------------------------------------------

describe("GET /api/compliance/evidence/:id", () => {
  const validId = "12345678-1234-1234-1234-123456789012";

  it("returns 400 for a non-UUID id", async () => {
    const res = await request(makeApp()).get("/api/compliance/evidence/not-a-uuid");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid collection id/);
  });

  it("returns 404 when the collection does not exist", async () => {
    getCollectionMock.mockResolvedValueOnce(null);
    const res = await request(makeApp()).get(`/api/compliance/evidence/${validId}`);
    expect(res.status).toBe(404);
  });

  it("returns 200 with the collection row when found", async () => {
    const collection = {
      id: validId,
      collected_at: "2026-05-22T03:00:00Z",
      markdown: "# Body",
      summary: { date: "2026-05-22" },
    };
    getCollectionMock.mockResolvedValueOnce(collection);
    const res = await request(makeApp()).get(`/api/compliance/evidence/${validId}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(validId);
    expect(res.body.markdown).toBe("# Body");
  });

  it("returns 500 when getCollection throws", async () => {
    getCollectionMock.mockRejectedValueOnce(new Error("DB on fire"));
    const res = await request(makeApp()).get(`/api/compliance/evidence/${validId}`);
    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Audit middleware
// ---------------------------------------------------------------------------

describe("audit middleware", () => {
  it("writes an ADMIN_ACCESS audit entry on each admin call", async () => {
    persistDailyEvidenceMock.mockResolvedValueOnce({
      filename: "x.md",
      filePath: "/tmp/x.md",
      snapshot: { generatedAt: "", date: "2026-05-22", version: "1", sections: {} },
      markdown: "",
    });
    await request(makeApp()).post("/api/compliance/evidence/run");
    const accessCall = auditActionMock.mock.calls.find((c) => c[1] === "admin.access");
    expect(accessCall).toBeDefined();
  });
});
