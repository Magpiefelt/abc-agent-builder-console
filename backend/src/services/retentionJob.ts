/**
 * Retention Job — classification-aware data lifecycle enforcement
 *
 * Runs on a daily schedule (configurable hour, default 02:00 local). Reads the
 * `retention_policy` table and applies the relevant retention window to each
 * data class:
 *
 *   - `agent_sessions` → HARD DELETE rows older than `sessions_days`.
 *     `agent_iterations` and `artifacts` are removed automatically by their
 *     `ON DELETE CASCADE` foreign-key constraints — we do not delete them
 *     directly. The cascade row counts are captured via SELECT-COUNT-before-DELETE.
 *
 *   - `audit_log`, `pii_detections` → ANONYMIZE rows older than the longest
 *     audit window (Protected B, 7 years). `user_id` is nulled, `ip_address`
 *     is nulled, and `details` are collapsed to a key-skeleton. Rows are
 *     preserved per FOIP audit-trail obligations.
 *
 * Strategy choice (anonymize vs hard-delete) is encoded in this file, not the
 * schema, so the migration stays faithful to the master plan SQL.
 *
 * Gated by `RETENTION_JOB_ENABLED`. Default OFF in development to avoid
 * accidental data loss during local testing. Turn on explicitly in production
 * once the policy has been reviewed.
 *
 * Manual trigger: `POST /api/admin/retention/run` (admin-only).
 */

import { query } from "../config/database.js";
import { env } from "../config/env.js";
import { logger } from "./logger.js";
import { logAudit, AuditAction } from "./auditLogger.js";

export interface RetentionTableReport {
  table: string;
  strategy: "hard_delete" | "anonymize" | "cascade";
  classification: string;
  cutoffDays: number;
  rowsAffected: number;
}

export interface RetentionReport {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  totalRowsAffected: number;
  byTable: RetentionTableReport[];
  errors: string[];
}

interface RetentionPolicyRow {
  classification: string;
  sessions_days: number;
  artifacts_days: number;
  audit_log_days: number;
}

/**
 * Execute one full retention pass across all classifications and tables.
 * Returns a structured report; safe to call repeatedly.
 */
export async function runRetentionPass(triggeredBy: string = "scheduler"): Promise<RetentionReport> {
  const startedAt = new Date();
  const report: RetentionReport = {
    startedAt: startedAt.toISOString(),
    finishedAt: "",
    durationMs: 0,
    totalRowsAffected: 0,
    byTable: [],
    errors: [],
  };

  logger.info("Retention pass started", { triggeredBy });

  let policies: RetentionPolicyRow[] = [];
  try {
    const result = await query<RetentionPolicyRow>(
      `SELECT classification, sessions_days, artifacts_days, audit_log_days
       FROM retention_policy
       ORDER BY classification`
    );
    policies = result.rows;
  } catch (err) {
    const msg = (err as Error).message;
    logger.error("Retention pass failed to load policy", err as Error);
    report.errors.push(`policy load failed: ${msg}`);
    finalize(report, startedAt);
    return report;
  }

  // Hard-delete sessions per classification. Iterations & artifacts cascade.
  for (const policy of policies) {
    await runSessionDelete(report, policy);
  }

  // Anonymize audit_log + pii_detections beyond the LONGEST window across
  // classifications (i.e. protected_b — 7 y). Conservative: never anonymizes
  // evidence too early when classifications differ.
  const maxAuditDays = policies.reduce((max, p) => Math.max(max, p.audit_log_days), 0);
  if (maxAuditDays > 0) {
    await anonymizeAuditLog(report, maxAuditDays);
    await anonymizePIIDetections(report, maxAuditDays);
  }

  finalize(report, startedAt);

  logAudit({
    action: AuditAction.ADMIN_RETENTION_RUN,
    resourceType: "retention_job",
    details: {
      triggeredBy,
      durationMs: report.durationMs,
      totalRowsAffected: report.totalRowsAffected,
      errorCount: report.errors.length,
      byTable: report.byTable,
    },
  }).catch(() => {});

  return report;
}

function finalize(report: RetentionReport, startedAt: Date): void {
  const finishedAt = new Date();
  report.finishedAt = finishedAt.toISOString();
  report.durationMs = finishedAt.getTime() - startedAt.getTime();
  report.totalRowsAffected = report.byTable.reduce((sum, r) => sum + r.rowsAffected, 0);
  logger.info("Retention pass complete", {
    durationMs: report.durationMs,
    totalRowsAffected: report.totalRowsAffected,
    errors: report.errors.length,
  });
}

/**
 * Hard-delete agent_sessions older than the classification's `sessions_days`.
 * `agent_iterations` and `artifacts` cascade automatically via foreign keys
 * defined in the schema. We capture cascade counts via a pre-DELETE COUNT(*)
 * so the report reflects the real impact.
 */
async function runSessionDelete(
  report: RetentionReport,
  policy: RetentionPolicyRow
): Promise<void> {
  const days = policy.sessions_days;

  try {
    // Pre-count cascaded children so the report shows accurate impact.
    const countResult = await query<{ iterations: string; artifacts: string }>(
      `SELECT
         (SELECT COUNT(*) FROM agent_iterations
          WHERE session_id IN (
            SELECT id FROM agent_sessions
            WHERE classification = $1
              AND created_at < NOW() - ($2::INTEGER * INTERVAL '1 day')
          )) AS iterations,
         (SELECT COUNT(*) FROM artifacts
          WHERE session_id IN (
            SELECT id FROM agent_sessions
            WHERE classification = $1
              AND created_at < NOW() - ($2::INTEGER * INTERVAL '1 day')
          )) AS artifacts`,
      [policy.classification, days]
    );

    const iterationsCascaded = Number(countResult.rows[0]?.iterations ?? 0);
    const artifactsCascaded = Number(countResult.rows[0]?.artifacts ?? 0);

    const deleteResult = await query(
      `DELETE FROM agent_sessions
       WHERE classification = $1
         AND created_at < NOW() - ($2::INTEGER * INTERVAL '1 day')`,
      [policy.classification, days]
    );

    report.byTable.push({
      table: "agent_sessions",
      strategy: "hard_delete",
      classification: policy.classification,
      cutoffDays: days,
      rowsAffected: deleteResult.rowCount ?? 0,
    });
    report.byTable.push({
      table: "agent_iterations",
      strategy: "cascade",
      classification: policy.classification,
      cutoffDays: days,
      rowsAffected: iterationsCascaded,
    });
    // Artifacts are removed via ON DELETE CASCADE from agent_sessions, so
    // their effective cutoff is the session retention window — not
    // `policy.artifacts_days`, which only matters for direct artifact-table
    // deletes (none of which the cascade strategy performs).
    report.byTable.push({
      table: "artifacts",
      strategy: "cascade",
      classification: policy.classification,
      cutoffDays: days,
      rowsAffected: artifactsCascaded,
    });
  } catch (err) {
    const msg = (err as Error).message;
    logger.error("Retention session delete failed", err as Error, { classification: policy.classification });
    report.errors.push(`agent_sessions/${policy.classification}: ${msg}`);
  }
}

async function anonymizeAuditLog(report: RetentionReport, days: number): Promise<void> {
  try {
    const result = await query(
      `UPDATE audit_log
       SET user_id = NULL,
           ip_address = NULL,
           details = jsonb_build_object(
             'anonymized', true,
             'original_keys',
             COALESCE(
               (SELECT array_agg(k) FROM jsonb_object_keys(COALESCE(details, '{}'::jsonb)) k),
               ARRAY[]::text[]
             )
           )
       WHERE created_at < NOW() - ($1::INTEGER * INTERVAL '1 day')
         AND (user_id IS NOT NULL OR ip_address IS NOT NULL)`,
      [days]
    );
    report.byTable.push({
      table: "audit_log",
      strategy: "anonymize",
      classification: "all",
      cutoffDays: days,
      rowsAffected: result.rowCount ?? 0,
    });
  } catch (err) {
    const msg = (err as Error).message;
    logger.error("Retention anonymize failed for audit_log", err as Error);
    report.errors.push(`audit_log: ${msg}`);
  }
}

async function anonymizePIIDetections(report: RetentionReport, days: number): Promise<void> {
  try {
    const result = await query(
      `UPDATE pii_detections
       SET user_id = NULL,
           context_snippet = NULL
       WHERE created_at < NOW() - ($1::INTEGER * INTERVAL '1 day')
         AND (user_id IS NOT NULL OR context_snippet IS NOT NULL)`,
      [days]
    );
    report.byTable.push({
      table: "pii_detections",
      strategy: "anonymize",
      classification: "all",
      cutoffDays: days,
      rowsAffected: result.rowCount ?? 0,
    });
  } catch (err) {
    const msg = (err as Error).message;
    logger.error("Retention anonymize failed for pii_detections", err as Error);
    report.errors.push(`pii_detections: ${msg}`);
  }
}

// ============================================================================
// SCHEDULER
// ============================================================================

let schedulerTimer: NodeJS.Timeout | null = null;
let schedulerInterval: NodeJS.Timeout | null = null;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Start the daily retention scheduler.
 * - Computes the milliseconds until the next configured hour (default 02:00 local).
 * - Arms a one-shot timer to fire the first pass at that time.
 * - Then sets a 24-hour interval for subsequent passes.
 *
 * No-op if `RETENTION_JOB_ENABLED` is false.
 * Idempotent: calling twice does not stack timers.
 */
export function startRetentionScheduler(): void {
  if (!env.RETENTION_JOB_ENABLED) {
    logger.info("Retention scheduler disabled (RETENTION_JOB_ENABLED=false). Use POST /api/admin/retention/run for manual passes.");
    return;
  }

  if (schedulerTimer || schedulerInterval) {
    logger.debug("Retention scheduler already running; skipping start");
    return;
  }

  const now = new Date();
  const next = new Date(now);
  next.setHours(env.RETENTION_JOB_HOUR, 0, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  const msUntilNext = next.getTime() - now.getTime();

  logger.info("Retention scheduler armed", {
    firstRunAt: next.toISOString(),
    hour: env.RETENTION_JOB_HOUR,
    intervalHours: 24,
  });

  schedulerTimer = setTimeout(() => {
    runRetentionPass("scheduler").catch((err) => {
      logger.error("Scheduled retention pass failed", err as Error);
    });
    schedulerInterval = setInterval(() => {
      runRetentionPass("scheduler").catch((err) => {
        logger.error("Scheduled retention pass failed", err as Error);
      });
    }, ONE_DAY_MS);
  }, msUntilNext);
}

/**
 * Stop the scheduler. Used for graceful shutdown and tests.
 */
export function stopRetentionScheduler(): void {
  if (schedulerTimer) {
    clearTimeout(schedulerTimer);
    schedulerTimer = null;
  }
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}
