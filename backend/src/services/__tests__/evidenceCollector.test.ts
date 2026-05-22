/**
 * Unit tests for evidenceCollector.
 *
 * The collector queries several tables; we mock the `query` helper so a
 * single test can mix happy-path sections with missing-table sections. The
 * file system is exercised against a per-test scratch directory under the
 * OS tempdir so the real `docs/compliance/` is never touched.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// ---------------------------------------------------------------------------
// Module mocks (hoisted before imports)
// ---------------------------------------------------------------------------

const queryMock = vi.hoisted(() => vi.fn());
vi.mock("../../config/database.js", () => ({ query: queryMock }));

vi.mock("../../services/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    business: vi.fn(),
  },
}));

// The collector emits an EVIDENCE_COLLECTED audit entry on every pass.
// We stub `logAudit` so a missing DATABASE_URL (or the default-empty queryMock
// for the audit_log INSERT) doesn't leak warnings into the test output.
const logAuditMock = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock("../../services/auditLogger.js", async () => {
  const actual = await vi.importActual<typeof import("../../services/auditLogger.js")>(
    "../../services/auditLogger.js",
  );
  return {
    ...actual,
    logAudit: logAuditMock,
  };
});

const envMock = vi.hoisted(() => ({
  DATABASE_URL: "postgres://test",
  EVIDENCE_JOB_ENABLED: false,
  EVIDENCE_JOB_HOUR: 3,
  WEBHOOK_MAX_ATTEMPTS: 3,
}));
vi.mock("../../config/env.js", () => ({ env: envMock }));

// ---------------------------------------------------------------------------
// Import under test
// ---------------------------------------------------------------------------

import {
  collectEvidence,
  formatEvidenceMarkdown,
  persistDailyEvidence,
  readLatestEvidence,
  setControlsMatrixPath,
  setEvidenceOutputDir,
  startEvidenceScheduler,
  stopEvidenceScheduler,
  evidenceSchedulerRunning,
  listCollections,
  getCollection,
} from "../evidenceCollector.js";
import { AuditAction } from "../auditLogger.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let scratchDir: string;
let controlsMatrixFile: string;

async function makeScratch(): Promise<void> {
  scratchDir = await fs.mkdtemp(path.join(os.tmpdir(), "abc-evidence-"));
  controlsMatrixFile = path.join(scratchDir, "controls_matrix.md");
  setEvidenceOutputDir(path.join(scratchDir, "compliance"));
  setControlsMatrixPath(controlsMatrixFile);
}

async function cleanupScratch(): Promise<void> {
  if (scratchDir) {
    await fs.rm(scratchDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Helpful default: have queryMock answer each call in order with a benign empty
 * shape. Individual tests can layer more specific mocks via mockResolvedValueOnce.
 */
function withDefaultEmptyQueries(): void {
  queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
}

beforeEach(async () => {
  queryMock.mockReset();
  logAuditMock.mockReset();
  logAuditMock.mockResolvedValue(undefined as never);
  envMock.DATABASE_URL = "postgres://test";
  envMock.EVIDENCE_JOB_ENABLED = false;
  envMock.EVIDENCE_JOB_HOUR = 3;
  envMock.WEBHOOK_MAX_ATTEMPTS = 3;
  stopEvidenceScheduler();
  await makeScratch();
});

afterEach(async () => {
  stopEvidenceScheduler();
  vi.useRealTimers();
  await cleanupScratch();
});

// ---------------------------------------------------------------------------
// collectEvidence — section shape (all OK)
// ---------------------------------------------------------------------------

describe("collectEvidence — happy paths", () => {
  it("returns a snapshot with all expected section keys", async () => {
    await fs.writeFile(
      controlsMatrixFile,
      "## Control 1\nIn place\n## Control 2\nPartial\n## Control 3\nOutstanding\n",
    );
    withDefaultEmptyQueries();
    const snapshot = await collectEvidence();
    expect(snapshot.sections).toMatchObject({
      controlsMatrix: expect.any(Object),
      auditRetention: expect.any(Object),
      piiDetections: expect.any(Object),
      modelRegistry: expect.any(Object),
      retentionJob: expect.any(Object),
      webhookDeliveries: expect.any(Object),
      tokenBudgets: expect.any(Object),
    });
    expect(snapshot.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(snapshot.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(snapshot.version).toBe("1");
  });

  it("parses In place / Partial / Outstanding counts from the controls matrix", async () => {
    await fs.writeFile(
      controlsMatrixFile,
      "In place\nIn-place\nIn place\nPartial\nOutstanding\nOutstanding\nOutstanding\n",
    );
    withDefaultEmptyQueries();
    const snapshot = await collectEvidence();
    const cm = snapshot.sections.controlsMatrix;
    expect(cm.status).toBe("ok");
    if (cm.status === "ok") {
      expect(cm.inPlace).toBe(3);
      expect(cm.partial).toBe(1);
      expect(cm.outstanding).toBe(3);
      expect(cm.total).toBe(7);
    }
  });

  it("summarises audit retention from query results", async () => {
    await fs.writeFile(controlsMatrixFile, "In place");
    // collectEvidence() runs every section in parallel via Promise.all so we
    // route each query by its SQL fragment rather than relying on call order.
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes("FROM audit_log") && sql.includes("COUNT(*)") && !sql.includes("GROUP BY")) {
        return Promise.resolve({ rows: [{ count: "1234" }], rowCount: 1 });
      }
      if (sql.includes("MIN(created_at)")) {
        return Promise.resolve({ rows: [{ oldest: "2024-01-01T00:00:00Z" }], rowCount: 1 });
      }
      if (sql.includes("FROM audit_log") && sql.includes("GROUP BY action")) {
        return Promise.resolve({
          rows: [
            { action: "auth.login", count: "500" },
            { action: "tool.executed", count: "200" },
          ],
          rowCount: 2,
        });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    const snapshot = await collectEvidence();
    const ar = snapshot.sections.auditRetention;
    expect(ar.status).toBe("ok");
    if (ar.status === "ok") {
      expect(ar.totalRows).toBe(1234);
      expect(ar.oldestEntry).toBe("2024-01-01T00:00:00Z");
      expect(ar.topActions).toEqual([
        { action: "auth.login", count: 500 },
        { action: "tool.executed", count: 200 },
      ]);
    }
  });
});

// ---------------------------------------------------------------------------
// collectEvidence — graceful degradation
// ---------------------------------------------------------------------------

describe("collectEvidence — graceful degradation", () => {
  it("reports not_applicable_yet for controls matrix when the file is missing", async () => {
    setControlsMatrixPath(path.join(scratchDir, "missing.md"));
    withDefaultEmptyQueries();
    const snapshot = await collectEvidence();
    expect(snapshot.sections.controlsMatrix.status).toBe("not_applicable_yet");
  });

  it("reports not_applicable_yet for every DB section when DATABASE_URL is unset", async () => {
    envMock.DATABASE_URL = "";
    await fs.writeFile(controlsMatrixFile, "In place");
    const snapshot = await collectEvidence();
    expect(snapshot.sections.auditRetention.status).toBe("not_applicable_yet");
    expect(snapshot.sections.piiDetections.status).toBe("not_applicable_yet");
    expect(snapshot.sections.modelRegistry.status).toBe("not_applicable_yet");
    expect(snapshot.sections.retentionJob.status).toBe("not_applicable_yet");
    expect(snapshot.sections.webhookDeliveries.status).toBe("not_applicable_yet");
    expect(snapshot.sections.tokenBudgets.status).toBe("not_applicable_yet");
    // The controls matrix is filesystem-based and still works.
    expect(snapshot.sections.controlsMatrix.status).toBe("ok");
  });

  it("reports not_applicable_yet on individual section query failure (e.g. missing table)", async () => {
    await fs.writeFile(controlsMatrixFile, "In place");
    // Make webhook_deliveries query throw "relation does not exist". The
    // collector should still complete all other sections.
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes("webhook_deliveries")) {
        return Promise.reject(new Error('relation "webhook_deliveries" does not exist'));
      }
      if (sql.includes("token_budgets")) {
        return Promise.reject(new Error('relation "token_budgets" does not exist'));
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const snapshot = await collectEvidence();
    expect(snapshot.sections.webhookDeliveries.status).toBe("not_applicable_yet");
    expect(snapshot.sections.tokenBudgets.status).toBe("not_applicable_yet");
    // Other DB sections still succeed (empty data, not failure).
    expect(snapshot.sections.auditRetention.status).toBe("ok");
    expect(snapshot.sections.modelRegistry.status).toBe("ok");
  });

  it("never throws even when every section fails", async () => {
    setControlsMatrixPath(path.join(scratchDir, "missing.md"));
    queryMock.mockRejectedValue(new Error("DB on fire"));
    await expect(collectEvidence()).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// formatEvidenceMarkdown
// ---------------------------------------------------------------------------

describe("formatEvidenceMarkdown", () => {
  it("renders a Markdown document with every section heading", async () => {
    await fs.writeFile(controlsMatrixFile, "In place");
    withDefaultEmptyQueries();
    const snapshot = await collectEvidence();
    const md = formatEvidenceMarkdown(snapshot);
    expect(md).toContain("# ABC Compliance Evidence");
    expect(md).toContain("## Controls matrix");
    expect(md).toContain("## Audit log retention");
    expect(md).toContain("## PII detections");
    expect(md).toContain("## Model registry");
    expect(md).toContain("## Retention job");
    expect(md).toContain("## Webhook deliveries");
    expect(md).toContain("## Token budgets");
    expect(md).toContain("Generated by evidenceCollector v1");
  });

  it("renders `not_applicable_yet` blocks for missing sections", async () => {
    envMock.DATABASE_URL = "";
    setControlsMatrixPath(path.join(scratchDir, "missing.md"));
    const snapshot = await collectEvidence();
    const md = formatEvidenceMarkdown(snapshot);
    expect(md).toMatch(/_not_applicable_yet: controls_matrix_unreadable_/);
    expect(md).toMatch(/_not_applicable_yet: database_not_configured_/);
  });
});

// ---------------------------------------------------------------------------
// persistDailyEvidence
// ---------------------------------------------------------------------------

describe("persistDailyEvidence", () => {
  it("writes the snapshot to disk under the configured output directory", async () => {
    await fs.writeFile(controlsMatrixFile, "In place");
    withDefaultEmptyQueries();
    const result = await persistDailyEvidence();
    expect(result.filename).toMatch(/^evidence_\d{4}-\d{2}-\d{2}\.md$/);
    expect(result.filePath).toContain(path.join(scratchDir, "compliance"));
    const onDisk = await fs.readFile(result.filePath, "utf8");
    expect(onDisk).toBe(result.markdown);
    expect(onDisk).toContain("# ABC Compliance Evidence");
  });

  it("creates the output directory if it does not exist", async () => {
    await fs.writeFile(controlsMatrixFile, "In place");
    withDefaultEmptyQueries();
    // outputDir is a fresh path that does not yet exist
    const outputDir = path.join(scratchDir, "compliance");
    await expect(fs.access(outputDir)).rejects.toBeDefined();
    await persistDailyEvidence();
    await expect(fs.access(outputDir)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// readLatestEvidence
// ---------------------------------------------------------------------------

describe("readLatestEvidence", () => {
  it("returns null when the compliance directory does not exist", async () => {
    setEvidenceOutputDir(path.join(scratchDir, "nonexistent"));
    const latest = await readLatestEvidence();
    expect(latest).toBeNull();
  });

  it("returns null when no evidence files have been generated yet", async () => {
    const outputDir = path.join(scratchDir, "compliance");
    await fs.mkdir(outputDir, { recursive: true });
    const latest = await readLatestEvidence();
    expect(latest).toBeNull();
  });

  it("returns the most recent file by lexical date sort", async () => {
    const outputDir = path.join(scratchDir, "compliance");
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(path.join(outputDir, "evidence_2026-04-01.md"), "old");
    await fs.writeFile(path.join(outputDir, "evidence_2026-05-22.md"), "new");
    await fs.writeFile(path.join(outputDir, "evidence_2026-05-01.md"), "middle");
    const latest = await readLatestEvidence();
    expect(latest).not.toBeNull();
    expect(latest!.filename).toBe("evidence_2026-05-22.md");
    expect(latest!.date).toBe("2026-05-22");
    expect(latest!.markdown).toBe("new");
  });

  it("ignores files that don't match the evidence_YYYY-MM-DD.md pattern", async () => {
    const outputDir = path.join(scratchDir, "compliance");
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(path.join(outputDir, "README.md"), "readme");
    await fs.writeFile(path.join(outputDir, "evidence_2026-05-22.md"), "valid");
    await fs.writeFile(path.join(outputDir, "evidence_bad.md"), "not a date");
    const latest = await readLatestEvidence();
    expect(latest!.filename).toBe("evidence_2026-05-22.md");
  });
});

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Webhook bucket query (regression: previous code referenced a nonexistent
// `status` column on webhook_deliveries — see the schema in
// docs/02_database_migrations.sql)
// ---------------------------------------------------------------------------

describe("collectEvidence — webhook bucket query", () => {
  it("groups deliveries into delivered / failed / exhausted by HTTP status & retry exhaustion", async () => {
    await fs.writeFile(controlsMatrixFile, "In place");
    queryMock.mockImplementation((sql: string, params?: unknown[]) => {
      if (sql.includes("FROM webhook_deliveries")) {
        // Assert the query no longer references a status column.
        expect(sql).not.toMatch(/SELECT\s+status,/);
        // Asserts WEBHOOK_MAX_ATTEMPTS was passed as the first parameter.
        expect(params?.[0]).toBe(3);
        return Promise.resolve({
          rows: [
            { bucket: "delivered", count: "7" },
            { bucket: "failed", count: "2" },
            { bucket: "exhausted", count: "1" },
          ],
          rowCount: 3,
        });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    const snapshot = await collectEvidence();
    expect(snapshot.sections.webhookDeliveries).toEqual({
      status: "ok",
      windowHours: 24,
      delivered: 7,
      failed: 2,
      exhausted: 1,
    });
  });
});

// ---------------------------------------------------------------------------
// persistDailyEvidence — DB persistence + audit log emission
// ---------------------------------------------------------------------------

describe("persistDailyEvidence — DB + audit", () => {
  it("writes a row to evidence_collections and emits an EVIDENCE_COLLECTED audit", async () => {
    await fs.writeFile(controlsMatrixFile, "In place");
    const insertedId = "11111111-2222-3333-4444-555555555555";
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes("INSERT INTO evidence_collections")) {
        return Promise.resolve({ rows: [{ id: insertedId }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    await persistDailyEvidence({ triggeredBy: "test-admin", userId: "user-xyz" });

    const insertCall = queryMock.mock.calls.find(
      ([sql]) => typeof sql === "string" && sql.includes("INSERT INTO evidence_collections"),
    );
    expect(insertCall).toBeDefined();
    // The INSERT params: collected_at, period_start, period_end, triggered_by, user_id,
    // source_version, summary, markdown, row_counts.
    const params = insertCall![1] as unknown[];
    expect(params[3]).toBe("test-admin");
    expect(params[4]).toBe("user-xyz");

    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-xyz",
        action: AuditAction.EVIDENCE_COLLECTED,
        resourceType: "evidence_collection",
        resourceId: insertedId,
      }),
    );
  });

  it("still writes the disk artifact when the DB insert fails", async () => {
    await fs.writeFile(controlsMatrixFile, "In place");
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes("INSERT INTO evidence_collections")) {
        return Promise.reject(new Error("DB unavailable"));
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const result = await persistDailyEvidence();
    const onDisk = await fs.readFile(result.filePath, "utf8");
    expect(onDisk).toContain("# ABC Compliance Evidence");
    // The audit still fires — resourceId falls back to the filename when the
    // DB id is unknown.
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.EVIDENCE_COLLECTED,
        resourceId: result.filename,
      }),
    );
  });

  it("does not attempt INSERT when DATABASE_URL is unset, but still emits audit + writes disk", async () => {
    envMock.DATABASE_URL = "";
    await fs.writeFile(controlsMatrixFile, "In place");
    await persistDailyEvidence();
    const insertSeen = queryMock.mock.calls.some(
      ([sql]) => typeof sql === "string" && sql.includes("INSERT INTO evidence_collections"),
    );
    expect(insertSeen).toBe(false);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditAction.EVIDENCE_COLLECTED }),
    );
  });
});

// ---------------------------------------------------------------------------
// listCollections / getCollection (DB-backed history)
// ---------------------------------------------------------------------------

describe("listCollections", () => {
  it("returns an empty array when DATABASE_URL is unset", async () => {
    envMock.DATABASE_URL = "";
    const rows = await listCollections();
    expect(rows).toEqual([]);
  });

  it("returns rows newest-first with derived audit/pii/model totals", async () => {
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes("FROM evidence_collections")) {
        return Promise.resolve({
          rows: [
            {
              id: "row-1",
              collected_at: "2026-05-22T03:00:00Z",
              period_start: "2026-05-21T03:00:00Z",
              period_end: "2026-05-22T03:00:00Z",
              triggered_by: "scheduler",
              user_id: null,
              source_version: "1",
              row_counts: { audit_log: 99 },
              summary: {
                generatedAt: "2026-05-22T03:00:00Z",
                date: "2026-05-22",
                version: "1",
                sections: {
                  controlsMatrix: { status: "not_applicable_yet", reason: "x" },
                  auditRetention: { status: "ok", totalRows: 99, oldestEntry: null, topActions: [] },
                  piiDetections: { status: "ok", windowDays: 30, byClassification: [], total: 4 },
                  modelRegistry: { status: "ok", active: 3, inactive: 1, byClassification: [] },
                  retentionJob: { status: "ok", lastRunAt: null, lastRunDetails: null },
                  webhookDeliveries: { status: "not_applicable_yet", reason: "x" },
                  tokenBudgets: { status: "not_applicable_yet", reason: "x" },
                },
              },
            },
          ],
          rowCount: 1,
        });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    const rows = await listCollections({ limit: 10 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "row-1",
      triggeredBy: "scheduler",
      auditTotal: 99,
      piiTotal: 4,
      modelTotalActive: 3,
    });
  });

  it("clamps limit into [1, 200]", async () => {
    queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
    await listCollections({ limit: 99999 });
    const lastCall = queryMock.mock.calls.at(-1)!;
    expect(lastCall[1]).toEqual([200]);
  });
});

describe("getCollection", () => {
  it("returns null when DATABASE_URL is unset", async () => {
    envMock.DATABASE_URL = "";
    expect(await getCollection("any")).toBeNull();
  });

  it("returns null when the row does not exist", async () => {
    queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
    expect(await getCollection("nope")).toBeNull();
  });

  it("returns the row including the rendered Markdown body", async () => {
    queryMock.mockResolvedValue({
      rows: [
        {
          id: "row-1",
          collected_at: "2026-05-22T03:00:00Z",
          period_start: "2026-05-21T03:00:00Z",
          period_end: "2026-05-22T03:00:00Z",
          triggered_by: "scheduler",
          user_id: null,
          source_version: "1",
          row_counts: {},
          summary: {
            generatedAt: "2026-05-22T03:00:00Z",
            date: "2026-05-22",
            version: "1",
            sections: {
              controlsMatrix: { status: "not_applicable_yet", reason: "x" },
              auditRetention: { status: "not_applicable_yet", reason: "x" },
              piiDetections: { status: "not_applicable_yet", reason: "x" },
              modelRegistry: { status: "not_applicable_yet", reason: "x" },
              retentionJob: { status: "not_applicable_yet", reason: "x" },
              webhookDeliveries: { status: "not_applicable_yet", reason: "x" },
              tokenBudgets: { status: "not_applicable_yet", reason: "x" },
            },
          },
          markdown: "# Hello",
        },
      ],
      rowCount: 1,
    });
    const row = await getCollection("row-1");
    expect(row).not.toBeNull();
    expect(row!.markdown).toBe("# Hello");
    expect(row!.summary.date).toBe("2026-05-22");
  });
});

describe("evidence scheduler", () => {
  it("is a no-op when EVIDENCE_JOB_ENABLED is false", () => {
    envMock.EVIDENCE_JOB_ENABLED = false;
    startEvidenceScheduler();
    expect(evidenceSchedulerRunning()).toBe(false);
  });

  it("arms a timer when EVIDENCE_JOB_ENABLED is true", () => {
    vi.useFakeTimers();
    envMock.EVIDENCE_JOB_ENABLED = true;
    envMock.EVIDENCE_JOB_HOUR = 3;
    startEvidenceScheduler();
    expect(evidenceSchedulerRunning()).toBe(true);
  });

  it("is idempotent — starting twice does not stack timers", () => {
    vi.useFakeTimers();
    envMock.EVIDENCE_JOB_ENABLED = true;
    startEvidenceScheduler();
    startEvidenceScheduler(); // should be a no-op
    expect(evidenceSchedulerRunning()).toBe(true);
    stopEvidenceScheduler();
    expect(evidenceSchedulerRunning()).toBe(false);
  });

  it("stopEvidenceScheduler clears the timer", () => {
    vi.useFakeTimers();
    envMock.EVIDENCE_JOB_ENABLED = true;
    startEvidenceScheduler();
    expect(evidenceSchedulerRunning()).toBe(true);
    stopEvidenceScheduler();
    expect(evidenceSchedulerRunning()).toBe(false);
  });
});
