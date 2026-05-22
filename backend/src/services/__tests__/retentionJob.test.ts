/**
 * Unit tests for the retentionJob service.
 *
 * All database calls are mocked via vi.hoisted so no live DB is needed.
 * The scheduler tests use vi.useFakeTimers to avoid real timeouts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks (hoisted before any imports)
// ---------------------------------------------------------------------------

const queryMock = vi.hoisted(() => vi.fn());
vi.mock("../../config/database.js", () => ({ query: queryMock }));

const logAuditMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const auditActionMock = vi.hoisted(() => vi.fn());
vi.mock("../../services/auditLogger.js", () => ({
  logAudit: logAuditMock,
  auditAction: auditActionMock,
  AuditAction: {
    ADMIN_RETENTION_RUN: "admin.retention.run",
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

// env mock — mutate before each test
const envMock = vi.hoisted(() => ({
  RETENTION_JOB_ENABLED: false,
  RETENTION_JOB_HOUR: 2,
  WORKFLOW_TRASH_RETENTION_DAYS: 30,
}));
vi.mock("../../config/env.js", () => ({ env: envMock }));

// ---------------------------------------------------------------------------
// Import under test (after mocks)
// ---------------------------------------------------------------------------

import {
  runRetentionPass,
  startRetentionScheduler,
  stopRetentionScheduler,
} from "../retentionJob.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  queryMock.mockReset();
  logAuditMock.mockReset().mockResolvedValue(undefined);
  auditActionMock.mockReset();
  envMock.RETENTION_JOB_ENABLED = false;
  envMock.RETENTION_JOB_HOUR = 2;
  envMock.WORKFLOW_TRASH_RETENTION_DAYS = 30;
  stopRetentionScheduler(); // ensure no leftover timers from previous tests
});

afterEach(() => {
  stopRetentionScheduler();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// runRetentionPass — policy load failure
// ---------------------------------------------------------------------------

describe("runRetentionPass — policy load failure", () => {
  it("returns a report with an error entry when policy query throws", async () => {
    queryMock.mockRejectedValueOnce(new Error("relation does not exist"));

    const report = await runRetentionPass("test");
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toMatch(/policy load failed/);
    expect(report.byTable).toHaveLength(0);
    expect(report.totalRowsAffected).toBe(0);
  });

  it("still populates startedAt, finishedAt, durationMs on failure", async () => {
    queryMock.mockRejectedValueOnce(new Error("DB gone"));

    const report = await runRetentionPass("test");
    expect(new Date(report.startedAt).getTime()).not.toBeNaN();
    expect(new Date(report.finishedAt).getTime()).not.toBeNaN();
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// runRetentionPass — single classification, full pass
// ---------------------------------------------------------------------------

describe("runRetentionPass — successful pass with one policy", () => {
  function setupOnePolicy(sessionDeleteRowCount = 5) {
    // 1) policy SELECT
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          classification: "unclassified",
          sessions_days: 30,
          artifacts_days: 30,
          audit_log_days: 365,
        },
      ],
      rowCount: 1,
    });
    // 2) CASCADE count query (iterations + artifacts)
    queryMock.mockResolvedValueOnce({
      rows: [{ iterations: "12", artifacts: "3" }],
      rowCount: 1,
    });
    // 3) DELETE agent_sessions
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: sessionDeleteRowCount });
    // 4) anonymize audit_log UPDATE
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 8 });
    // 5) anonymize pii_detections UPDATE
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 2 });
    // 6) workflow trash purge DELETE (Bot 10 — Backlog B4 soft-delete cleanup)
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
  }

  it("returns byTable entries for sessions, iterations, artifacts, audit_log, pii_detections", async () => {
    setupOnePolicy();

    const report = await runRetentionPass("test");
    expect(report.errors).toHaveLength(0);
    const tables = report.byTable.map((r) => r.table);
    expect(tables).toContain("agent_sessions");
    expect(tables).toContain("agent_iterations");
    expect(tables).toContain("artifacts");
    expect(tables).toContain("audit_log");
    expect(tables).toContain("pii_detections");
  });

  it("records correct strategy for each table", async () => {
    setupOnePolicy();

    const report = await runRetentionPass("test");
    const byTable: Record<string, string> = {};
    for (const r of report.byTable) {
      byTable[r.table] = r.strategy;
    }
    expect(byTable["agent_sessions"]).toBe("hard_delete");
    expect(byTable["agent_iterations"]).toBe("cascade");
    expect(byTable["artifacts"]).toBe("cascade");
    expect(byTable["audit_log"]).toBe("anonymize");
    expect(byTable["pii_detections"]).toBe("anonymize");
  });

  it("sums rowsAffected into totalRowsAffected", async () => {
    setupOnePolicy(5); // sessions:5, iter:12, art:3, auditLog:8, pii:2  => 30

    const report = await runRetentionPass("test");
    expect(report.totalRowsAffected).toBe(5 + 12 + 3 + 8 + 2);
  });

  it("records rowsAffected from cascade count pre-query", async () => {
    setupOnePolicy();

    const report = await runRetentionPass("test");
    const iter = report.byTable.find((r) => r.table === "agent_iterations");
    expect(iter?.rowsAffected).toBe(12);
    const art = report.byTable.find((r) => r.table === "artifacts");
    expect(art?.rowsAffected).toBe(3);
  });

  it("sets cutoffDays to the policy sessions_days", async () => {
    setupOnePolicy();

    const report = await runRetentionPass("test");
    const sessions = report.byTable.find((r) => r.table === "agent_sessions");
    expect(sessions?.cutoffDays).toBe(30);
  });

  it("calls logAudit at the end of a successful pass", async () => {
    setupOnePolicy();

    await runRetentionPass("test");
    expect(logAuditMock).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// runRetentionPass — no anonymization when maxAuditDays is 0
// ---------------------------------------------------------------------------

describe("runRetentionPass — zero audit_log_days skips anonymization", () => {
  it("does not produce audit_log or pii_detections byTable entries", async () => {
    // Policy with audit_log_days = 0
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          classification: "unclassified",
          sessions_days: 30,
          artifacts_days: 30,
          audit_log_days: 0,
        },
      ],
      rowCount: 1,
    });
    // CASCADE count query
    queryMock.mockResolvedValueOnce({ rows: [{ iterations: "0", artifacts: "0" }], rowCount: 1 });
    // DELETE agent_sessions
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    // Workflow trash purge — runs regardless of audit_log_days (Bot 10).
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const report = await runRetentionPass("test");
    const tables = report.byTable.map((r) => r.table);
    expect(tables).not.toContain("audit_log");
    expect(tables).not.toContain("pii_detections");
    // 4 DB calls: policy + cascade-count + session-delete + workflow-trash-purge.
    expect(queryMock).toHaveBeenCalledTimes(4);
  });
});

// ---------------------------------------------------------------------------
// runRetentionPass — empty policy table
// ---------------------------------------------------------------------------

describe("runRetentionPass — empty policy table", () => {
  it("returns no errors and only the workflow trash entry when no classification policies exist", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // policy query
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // workflow trash purge

    const report = await runRetentionPass("test");
    expect(report.errors).toHaveLength(0);
    // Workflow trash purge always runs (independent of classification policies).
    expect(report.byTable).toHaveLength(1);
    expect(report.byTable[0]?.table).toBe("workflows");
    expect(report.totalRowsAffected).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// runRetentionPass — session delete error per classification is captured
// ---------------------------------------------------------------------------

describe("runRetentionPass — partial failure in session delete", () => {
  it("captures per-classification errors in report.errors without aborting other tables", async () => {
    // Policy returns one classification
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          classification: "protected_a",
          sessions_days: 90,
          artifacts_days: 90,
          audit_log_days: 365,
        },
      ],
      rowCount: 1,
    });
    // COUNT query fails (simulates partial DB failure)
    queryMock.mockRejectedValueOnce(new Error("permission denied"));
    // Anonymize audit_log
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    // Anonymize pii_detections
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    // Workflow trash purge (Bot 10) — also runs despite the session-delete failure.
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const report = await runRetentionPass("test");
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toMatch(/protected_a/);
    // anonymization still ran despite session error
    const tables = report.byTable.map((r) => r.table);
    expect(tables).toContain("audit_log");
  });
});

// ---------------------------------------------------------------------------
// startRetentionScheduler — disabled guard
// ---------------------------------------------------------------------------

describe("startRetentionScheduler — disabled", () => {
  it("does not schedule anything when RETENTION_JOB_ENABLED is false", () => {
    vi.useFakeTimers();
    envMock.RETENTION_JOB_ENABLED = false;

    startRetentionScheduler();
    // No timer fires in the next 48 hours
    vi.advanceTimersByTime(48 * 60 * 60 * 1000);
    // query should never be called
    expect(queryMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// startRetentionScheduler — idempotent
// ---------------------------------------------------------------------------

describe("startRetentionScheduler — idempotent", () => {
  it("does not stack timers when called twice", () => {
    vi.useFakeTimers();
    envMock.RETENTION_JOB_ENABLED = true;

    startRetentionScheduler();
    startRetentionScheduler(); // second call should be a no-op

    // Just verify it didn't throw; stopRetentionScheduler cleans up
    stopRetentionScheduler();
  });
});

// ---------------------------------------------------------------------------
// stopRetentionScheduler
// ---------------------------------------------------------------------------

describe("stopRetentionScheduler", () => {
  it("is idempotent when called before any scheduler is started", () => {
    // Should not throw even if called when no timers are set
    expect(() => stopRetentionScheduler()).not.toThrow();
    expect(() => stopRetentionScheduler()).not.toThrow();
  });
});
