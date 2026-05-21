/**
 * Retention Job — classification-aware data lifecycle enforcement
 *
 * Runs on a daily schedule (configurable hour, default 02:00 local). Reads the
 * `retention_policy` table and applies the relevant retention window to each
 * data class:
 *
 *   - `agent_sessions`, `agent_iterations`, `artifacts`  → HARD DELETE
 *     (rows older than `sessions_days` / `artifacts_days` are physically removed)
 *
 *   - `audit_log`, `pii_detections`                       → ANONYMIZE
 *     (rows older than `audit_log_days` keep their skeleton — user_id is
 *     nulled, ip_address is hashed — for compliance counts; the row itself
 *     persists per FOIP audit-trail obligations)
 *
 * Strategy choice (anonymize vs hard-delete) is encoded in this file, not
 * the schema, so the migration stays faithful to the master plan SQL.
 *
 * Each pass writes a summary entry to the audit log with row counts.
 *
 * Gated by `RETENTION_JOB_ENABLED`. Default OFF in development to avoid
 * accidental data loss during local testing. Turn on explicitly in production
 * once the policy has been reviewed.
 *
 * Manual trigger: `POST /api/admin/retention/run` (admin-only).
 */

import { query, transaction } from "../config/database.js";
import { env } from "../config/env.js";
import { logger } from "./logger.js";
import { logAudit, AuditAction } from "./auditLogger.js";

export interface RetentionTableReport {
  table: string;
  strategy: "hard_delete" | "anonymize";
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

  // Hard-delete: classification-scoped tables (agent_sessions, agent_iterations, artifacts)
  for (const policy of policies) {
    await runDelete(report, policy, "agent_sessions", "sessions_days");
    await runDeleteByJoin(report, policy);
    await runDelete(report, policy, "artifacts", "artifacts_days");
  }

  // Anonymize: audit_log and pii_detections beyond the maximum window.
  // We pick the LONGEST audit_log_days across classifications (i.e. protected_b
  // 7y) so we never anonymize evidence too early. Conservative on purpose.
  const maxAuditDays = Math.max(...policies.map((p) => p.audit_log_days), 0);
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

async function runDelete(
  report: RetentionReport,
  policy: RetentionPolicyRow,
  table: "agent_sessions" | "artifacts",
  daysField: "sessions_days" | "artifacts_days"
): Promise<void> {
  const days = policy[daysField];
  try {
    const result = await query(
      `DELETE FROM ${table}
       WHERE classification = $1
         AND created_at < NOW() - ($2::INTEGER * INTERVAL '1 day')`,
      [policy.classification, days]
    );
    report.byTable.push({
      table,
      strategy: "hard_delete",
      classification: policy.classification,
      cutoffDays: days,
      rowsAffected: result.rowCount ?? 0,
    });
  } catch (err) {
    const msg = (err as Error).message;
    logger.error(`Retention delete failed for ${table}`, err as Error, { classification: policy.classification });
    report.errors.push(`${table}/${policy.classification}: ${msg}`);
  }
}

/**
 * agent_iterations has no classification column — delete by joining its parent session.
 */
async function runDeleteByJoin(
  report: RetentionReport,
  policy: RetentionPolicyRow
): Promise<void> {
  const days = policy.sessions_days;
  try {
    const result = await query(
      `DELETE FROM agent_iterations
       WHERE session_id IN (
         SELECT id FROM agent_sessions
         WHERE classification = $1
           AND created_at < NOW() - ($2::INTEGER * INTERVAL '1 day')
       )`,
      [policy.classification, days]
    );
    report.byTable.push({
      table: "agent_iterations",
      strategy: "hard_delete",
      classification: policy.classification,
      cutoffDays: days,
      rowsAffected: result.rowCount ?? 0,
    });
  } catch (err) {
    const msg = (err as Error).message;
    logger.error("Retention delete failed for agent_iterations", err as Error, { classification: policy.classification });
    report.errors.push(`agent_iterations/${policy.classification}: ${msg}`);
  }
}

async function anonymizeAuditLog(report: RetentionReport, days: number): Promise<void> {
  try {
    const result = await transaction(async (client) => {
      return await client.query(
        `UPDATE audit_log
         SET user_id = NULL,
             ip_address = NULL,
             details = jsonb_build_object('anonymized', true, 'original_keys', (SELECT array_agg(k) FROM jsonb_object_keys(details) k))
         WHERE created_at < NOW() - ($1::INTEGER * INTERVAL '1 day')
           AND user_id IS NOT NULL`,
        [days]
      );
    });
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
         AND user_id IS NOT NULL`,
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
