/**
 * Integration test for POST /api/admin/users/:id/export (Backlog B6, FOIP s.7).
 *
 * The admin route validates the user id, then delegates the heavy lifting to
 * `services/userDataExporter.ts`. We mock the exporter to keep this test
 * focused on the route contract (status codes, headers, auditing) — the
 * exporter itself has its own unit tests covering the zip contents.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import AdmZip from "adm-zip";

const queryMock = vi.hoisted(() => vi.fn());
vi.mock("../../config/database.js", () => ({ query: queryMock }));

const clearModelCacheMock = vi.hoisted(() => vi.fn());
vi.mock("../../services/llmProvider.js", () => ({ clearModelCache: clearModelCacheMock }));

const runRetentionPassMock = vi.hoisted(() => vi.fn());
vi.mock("../../services/retentionJob.js", () => ({ runRetentionPass: runRetentionPassMock }));

const exportUserDataMock = vi.hoisted(() => vi.fn());
vi.mock("../../services/userDataExporter.js", () => ({
  exportUserData: exportUserDataMock,
}));

// Spy on the audit logger so we can assert the route called it with the right
// action + resource ids. The real implementation early-returns when
// DATABASE_URL is unset (as in this test env), so observing the DB INSERT
// queryMock would be unreliable — observing the audit module directly is
// cleaner.
const auditActionMock = vi.hoisted(() => vi.fn());
vi.mock("../../services/auditLogger.js", async () => {
  const actual = await vi.importActual<typeof import("../../services/auditLogger.js")>(
    "../../services/auditLogger.js",
  );
  return {
    ...actual,
    auditAction: auditActionMock,
  };
});

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

const TARGET_USER_ID = "11111111-2222-3333-4444-555555555555";

beforeEach(() => {
  queryMock.mockReset();
  exportUserDataMock.mockReset();
  auditActionMock.mockReset();
  // Default audit mock so the auditAdminAccess insert in middleware doesn't blow up.
  queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe("POST /api/admin/users/:id/export", () => {
  it("400s on a non-UUID id without invoking the exporter", async () => {
    const res = await request(makeApp()).post("/api/admin/users/not-a-uuid/export");
    expect(res.status).toBe(400);
    expect(exportUserDataMock).not.toHaveBeenCalled();
  });

  it("404s when the exporter reports the user does not exist", async () => {
    exportUserDataMock.mockResolvedValueOnce(null);
    const res = await request(makeApp()).post(
      `/api/admin/users/${TARGET_USER_ID}/export`,
    );
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("User not found.");
    expect(exportUserDataMock).toHaveBeenCalledOnce();
  });

  it("returns 200 + application/zip on the happy path with a Content-Disposition attachment", async () => {
    // Build a tiny but valid zip in memory.
    const zip = new AdmZip();
    zip.addFile("README.md", Buffer.from("hello"));
    const buffer = zip.toBuffer();

    exportUserDataMock.mockResolvedValueOnce({
      zip: buffer,
      filename: "abc-user-11111111-2026-05-22.zip",
      manifest: {
        exportedAt: "2026-05-22T15:30:00.000Z",
        schemaVersion: 1,
        userId: TARGET_USER_ID,
        exportedBy: { userId: "DEV_USER", role: "admin" },
        rowCounts: {
          user: 1,
          preferences: 0,
          savedPrompts: 2,
          workflowFavorites: 0,
          workflows: 1,
          workflowVersions: 1,
          workflowExecutions: 0,
          agentSessions: 1,
          agentIterations: 3,
          artifacts: 0,
          auditLog: 12,
          piiDetections: 0,
          secretLabels: 0,
        },
        files: [],
      },
    });

    const res = await request(makeApp())
      .post(`/api/admin/users/${TARGET_USER_ID}/export`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (c: Buffer) => chunks.push(c));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/zip");
    expect(res.headers["content-disposition"]).toBe(
      'attachment; filename="abc-user-11111111-2026-05-22.zip"',
    );
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect(res.body.length).toBe(buffer.length);

    // Should have audited USER_DATA_EXPORTED with the target user id and
    // row-count metadata. The middleware also records an ADMIN_ACCESS event,
    // so we filter for the specific action we expect on this route.
    const exportCalls = auditActionMock.mock.calls.filter(
      (c) => c[1] === "user.data.exported",
    );
    expect(exportCalls).toHaveLength(1);
    expect(exportCalls[0][2]).toBe("user");
    expect(exportCalls[0][3]).toBe(TARGET_USER_ID);
    expect(exportCalls[0][4]).toMatchObject({
      rowCounts: expect.objectContaining({ savedPrompts: 2, auditLog: 12 }),
      archiveBytes: buffer.length,
    });
  });

  it("500s when the exporter throws (e.g. DB unavailable mid-collection)", async () => {
    exportUserDataMock.mockRejectedValueOnce(new Error("postgres down"));
    const res = await request(makeApp()).post(
      `/api/admin/users/${TARGET_USER_ID}/export`,
    );
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to export user data.");
  });

  it("passes the requesting admin's id and role to the exporter so the manifest names the operator", async () => {
    exportUserDataMock.mockResolvedValueOnce(null);
    await request(makeApp()).post(`/api/admin/users/${TARGET_USER_ID}/export`);
    expect(exportUserDataMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: TARGET_USER_ID,
        exportedBy: expect.objectContaining({ role: "admin" }),
      }),
    );
  });
});
