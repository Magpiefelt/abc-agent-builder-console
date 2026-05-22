/**
 * Workflow Trash purge tests for the retention job (Bot 10, Backlog B4).
 *
 * `runRetentionPass` calls `purgeSoftDeletedWorkflows(report, days)` after
 * the existing per-classification session deletes + audit anonymization.
 * These tests pin the SQL shape, the report entry, and the configurable
 * day window.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());
vi.mock("../../config/database.js", () => ({ query: queryMock }));

vi.mock("../../services/auditLogger.js", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
  auditAction: vi.fn(),
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

const envMock = vi.hoisted(() => ({
  RETENTION_JOB_ENABLED: false,
  RETENTION_JOB_HOUR: 2,
  WORKFLOW_TRASH_RETENTION_DAYS: 30,
}));
vi.mock("../../config/env.js", () => ({ env: envMock }));

import { purgeSoftDeletedWorkflows, runRetentionPass } from "../retentionJob.js";
import type { RetentionReport } from "../retentionJob.js";

beforeEach(() => {
  queryMock.mockReset();
  envMock.WORKFLOW_TRASH_RETENTION_DAYS = 30;
});

function emptyReport(): RetentionReport {
  return {
    startedAt: new Date().toISOString(),
    finishedAt: "",
    durationMs: 0,
    totalRowsAffected: 0,
    byTable: [],
    errors: [],
  };
}

describe("purgeSoftDeletedWorkflows — unit", () => {
  it("issues a parameterized DELETE filtered on deleted_at age", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 4 });
    const report = emptyReport();
    await purgeSoftDeletedWorkflows(report, 30);

    expect(queryMock).toHaveBeenCalledOnce();
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/DELETE FROM workflows/);
    expect(sql).toMatch(/deleted_at IS NOT NULL/);
    expect(sql).toMatch(/deleted_at <\s*NOW\(\) - \(\$1::INTEGER \* INTERVAL '1 day'\)/);
    expect(params).toEqual([30]);
  });

  it("pushes a byTable entry with strategy=hard_delete and classification=trash", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 7 });
    const report = emptyReport();
    await purgeSoftDeletedWorkflows(report, 14);

    expect(report.byTable).toHaveLength(1);
    expect(report.byTable[0]).toEqual({
      table: "workflows",
      strategy: "hard_delete",
      classification: "trash",
      cutoffDays: 14,
      rowsAffected: 7,
    });
  });

  it("records 0 rowsAffected when the trash is empty", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const report = emptyReport();
    await purgeSoftDeletedWorkflows(report, 30);

    expect(report.byTable[0]?.rowsAffected).toBe(0);
    expect(report.errors).toHaveLength(0);
  });

  it("captures errors in report.errors when the DELETE throws", async () => {
    queryMock.mockRejectedValueOnce(new Error("statement timeout"));
    const report = emptyReport();
    await purgeSoftDeletedWorkflows(report, 30);

    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toMatch(/workflows\/trash:/);
    expect(report.errors[0]).toMatch(/statement timeout/);
    expect(report.byTable).toHaveLength(0);
  });
});

describe("runRetentionPass — integrates workflow trash purge with env override", () => {
  it("uses env.WORKFLOW_TRASH_RETENTION_DAYS as the cutoff window", async () => {
    envMock.WORKFLOW_TRASH_RETENTION_DAYS = 7;

    // Policy SELECT — empty so the per-classification loop does nothing.
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    // Workflow trash purge.
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 2 });

    const report = await runRetentionPass("test");
    const trashEntry = report.byTable.find((e) => e.table === "workflows");
    expect(trashEntry?.cutoffDays).toBe(7);
    expect(trashEntry?.rowsAffected).toBe(2);

    const params = queryMock.mock.calls[1][1] as unknown[];
    expect(params).toEqual([7]);
  });
});
