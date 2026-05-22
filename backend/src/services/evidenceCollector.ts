/**
 * Evidence Collector — daily SOC2 / ATO compliance posture snapshot
 *
 * Materializes the live compliance state into a single Markdown artifact under
 * `docs/compliance/evidence_YYYY-MM-DD.md`. Auditors and ATO reviewers can
 * read the artifact end-to-end instead of grepping `audit_log` rows or
 * screenshotting dashboards.
 *
 * Sections collected (each individually try/catch-wrapped so a missing table
 * or transient query failure degrades to `"not_applicable_yet"` rather than
 * failing the whole pass):
 *
 *  - Controls matrix      — counts of in-place / partial / outstanding controls
 *                           from `docs/security/controls_matrix.md`
 *  - Audit retention      — total rows, oldest entry, top action counts
 *  - PII detections       — counts by classification over trailing 30 days
 *  - Model registry       — active / inactive / per-classification cap
 *  - Retention job        — most recent run summary (action = admin.retention.run)
 *  - Webhook deliveries   — last-24h count by status (table optional)
 *  - Token budgets        — per-scope-type count (table optional)
 *
 * Gated by `EVIDENCE_JOB_ENABLED` (default false). When disabled the daily
 * scheduler is a no-op; admins can still trigger an on-demand pass via the
 * `POST /api/compliance/evidence/run` route.
 *
 * Output is plain Markdown for diff-ability and archival. Distinct from the
 * per-request audit log: this is a periodic posture snapshot — what the system
 * looked like at a moment in time, not a stream of events.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { query } from "../config/database.js";
import { env } from "../config/env.js";
import { logger } from "./logger.js";
import { AuditAction, logAudit } from "./auditLogger.js";

// ============================================================================
// TYPES
// ============================================================================

export interface NotApplicable {
  status: "not_applicable_yet";
  reason: string;
}

export interface ControlsMatrixSection {
  status: "ok";
  total: number;
  inPlace: number;
  partial: number;
  outstanding: number;
  sourceFile: string;
}

export interface AuditRetentionSection {
  status: "ok";
  totalRows: number;
  oldestEntry: string | null;
  topActions: Array<{ action: string; count: number }>;
}

export interface PiiDetectionsSection {
  status: "ok";
  windowDays: number;
  byClassification: Array<{ classification: string; count: number }>;
  total: number;
}

export interface ModelRegistrySection {
  status: "ok";
  active: number;
  inactive: number;
  byClassification: Array<{ classification: string; count: number }>;
}

export interface RetentionJobSection {
  status: "ok";
  lastRunAt: string | null;
  lastRunDetails: Record<string, unknown> | null;
}

export interface WebhookDeliveriesSection {
  status: "ok";
  windowHours: number;
  delivered: number;
  failed: number;
  exhausted: number;
}

export interface TokenBudgetsSection {
  status: "ok";
  byScopeType: Array<{ scopeType: string; count: number }>;
  total: number;
}

export interface EvidenceSnapshot {
  generatedAt: string;
  date: string;
  version: string;
  sections: {
    controlsMatrix: ControlsMatrixSection | NotApplicable;
    auditRetention: AuditRetentionSection | NotApplicable;
    piiDetections: PiiDetectionsSection | NotApplicable;
    modelRegistry: ModelRegistrySection | NotApplicable;
    retentionJob: RetentionJobSection | NotApplicable;
    webhookDeliveries: WebhookDeliveriesSection | NotApplicable;
    tokenBudgets: TokenBudgetsSection | NotApplicable;
  };
}

export interface PersistedEvidence {
  filename: string;
  filePath: string;
  snapshot: EvidenceSnapshot;
  markdown: string;
}

export interface LatestEvidence {
  filename: string;
  filePath: string;
  date: string;
  markdown: string;
}

/**
 * Row shape persisted to `evidence_collections`. Excludes the full Markdown
 * body for list-style endpoints so the response stays cheap; the body is
 * available via {@link getCollection}.
 */
export interface CollectionSummaryRow {
  id: string;
  collectedAt: string;
  periodStart: string;
  periodEnd: string;
  triggeredBy: string;
  userId: string | null;
  sourceVersion: string;
  rowCounts: Record<string, number>;
  /**
   * Lightweight indicators surfaced from `summary` JSON so the list view can
   * render badges without loading the full snapshot.
   */
  auditTotal: number;
  piiTotal: number;
  modelTotalActive: number;
}

/** Full collection row including the Markdown body and structured summary. */
export interface CollectionDetailRow extends CollectionSummaryRow {
  summary: EvidenceSnapshot;
  markdown: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const COLLECTOR_VERSION = "1";
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Where snapshot Markdown files land. Resolved relative to the repo root so
 * the file lives in the docs tree where reviewers expect it. Tests override
 * via `setEvidenceOutputDir` to avoid littering the real docs/ directory.
 */
let outputDir = path.resolve(process.cwd(), "..", "docs", "compliance");

export function setEvidenceOutputDir(dir: string): void {
  outputDir = dir;
}

export function getEvidenceOutputDir(): string {
  return outputDir;
}

/**
 * Where to look for the controls matrix when summarising it. Override for
 * tests so the section can be exercised against a fixture file.
 */
let controlsMatrixPath = path.resolve(process.cwd(), "..", "docs", "security", "controls_matrix.md");

export function setControlsMatrixPath(p: string): void {
  controlsMatrixPath = p;
}

// ============================================================================
// SECTION COLLECTORS
// ============================================================================

async function collectControlsMatrix(): Promise<ControlsMatrixSection | NotApplicable> {
  try {
    const text = await fs.readFile(controlsMatrixPath, "utf8");
    // The controls matrix uses bullet/row markers like "In place", "Partial",
    // "Outstanding". Count occurrences case-insensitively. The matrix file is
    // hand-maintained; this is best-effort.
    const inPlace = countMatches(text, /\bin[- ]place\b/gi);
    const partial = countMatches(text, /\bpartial(?:ly)?\b/gi);
    const outstanding = countMatches(text, /\boutstanding\b/gi);
    return {
      status: "ok",
      total: inPlace + partial + outstanding,
      inPlace,
      partial,
      outstanding,
      sourceFile: path.basename(controlsMatrixPath),
    };
  } catch (err) {
    return notApplicable("controls_matrix_unreadable", err);
  }
}

async function collectAuditRetention(): Promise<AuditRetentionSection | NotApplicable> {
  if (!env.DATABASE_URL) return notApplicable("database_not_configured");
  try {
    const total = await query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM audit_log`);
    const oldest = await query<{ oldest: string | null }>(
      `SELECT MIN(created_at)::text AS oldest FROM audit_log`,
    );
    const top = await query<{ action: string; count: string }>(
      `SELECT action, COUNT(*)::text AS count
       FROM audit_log
       GROUP BY action
       ORDER BY COUNT(*) DESC
       LIMIT 10`,
    );
    return {
      status: "ok",
      totalRows: Number(total.rows[0]?.count ?? 0),
      oldestEntry: oldest.rows[0]?.oldest ?? null,
      topActions: top.rows.map((r) => ({ action: r.action, count: Number(r.count) })),
    };
  } catch (err) {
    return notApplicable("audit_log_query_failed", err);
  }
}

async function collectPiiDetections(): Promise<PiiDetectionsSection | NotApplicable> {
  if (!env.DATABASE_URL) return notApplicable("database_not_configured");
  const windowDays = 30;
  try {
    const result = await query<{ classification: string | null; count: string }>(
      `SELECT classification, COUNT(*)::text AS count
       FROM pii_detections
       WHERE created_at >= NOW() - INTERVAL '${windowDays} days'
       GROUP BY classification
       ORDER BY classification`,
    );
    const byClassification = result.rows.map((r) => ({
      classification: r.classification ?? "unclassified",
      count: Number(r.count),
    }));
    const total = byClassification.reduce((sum, row) => sum + row.count, 0);
    return { status: "ok", windowDays, byClassification, total };
  } catch (err) {
    return notApplicable("pii_detections_query_failed", err);
  }
}

async function collectModelRegistry(): Promise<ModelRegistrySection | NotApplicable> {
  if (!env.DATABASE_URL) return notApplicable("database_not_configured");
  try {
    const activeRow = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM model_registry WHERE is_active = true`,
    );
    const inactiveRow = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM model_registry WHERE is_active = false`,
    );
    const byCls = await query<{ max_classification: string; count: string }>(
      `SELECT max_classification, COUNT(*)::text AS count
       FROM model_registry
       WHERE is_active = true
       GROUP BY max_classification
       ORDER BY max_classification`,
    );
    return {
      status: "ok",
      active: Number(activeRow.rows[0]?.count ?? 0),
      inactive: Number(inactiveRow.rows[0]?.count ?? 0),
      byClassification: byCls.rows.map((r) => ({
        classification: r.max_classification,
        count: Number(r.count),
      })),
    };
  } catch (err) {
    return notApplicable("model_registry_query_failed", err);
  }
}

async function collectRetentionJob(): Promise<RetentionJobSection | NotApplicable> {
  if (!env.DATABASE_URL) return notApplicable("database_not_configured");
  try {
    const row = await query<{ created_at: string; details: Record<string, unknown> | null }>(
      `SELECT created_at::text, details
       FROM audit_log
       WHERE action = 'admin.retention.run'
       ORDER BY created_at DESC
       LIMIT 1`,
    );
    if (row.rowCount === 0) {
      return { status: "ok", lastRunAt: null, lastRunDetails: null };
    }
    return {
      status: "ok",
      lastRunAt: row.rows[0].created_at,
      lastRunDetails: row.rows[0].details ?? null,
    };
  } catch (err) {
    return notApplicable("retention_job_query_failed", err);
  }
}

async function collectWebhookDeliveries(): Promise<WebhookDeliveriesSection | NotApplicable> {
  if (!env.DATABASE_URL) return notApplicable("database_not_configured");
  const windowHours = 24;
  // The webhook_deliveries table has no `status` column — outcome is derived
  // from `response_status` (HTTP code), `error` (failure description), and
  // `attempt` vs. WEBHOOK_MAX_ATTEMPTS. Bucket each row at query time so the
  // result mirrors the dispatcher's own DeliveryOutcome semantics
  // ("success", "client_error", "exhausted") that admins see elsewhere.
  try {
    const result = await query<{ bucket: string; count: string }>(
      `SELECT CASE
                WHEN response_status BETWEEN 200 AND 299           THEN 'delivered'
                WHEN attempt >= $1 AND error IS NOT NULL           THEN 'exhausted'
                ELSE                                                    'failed'
              END AS bucket,
              COUNT(*)::text AS count
         FROM webhook_deliveries
        WHERE delivered_at >= NOW() - INTERVAL '${windowHours} hours'
        GROUP BY bucket`,
      [env.WEBHOOK_MAX_ATTEMPTS],
    );
    const byBucket: Record<string, number> = {};
    for (const row of result.rows) {
      byBucket[row.bucket] = Number(row.count);
    }
    return {
      status: "ok",
      windowHours,
      delivered: byBucket.delivered ?? 0,
      failed: byBucket.failed ?? 0,
      exhausted: byBucket.exhausted ?? 0,
    };
  } catch (err) {
    return notApplicable("webhook_deliveries_table_missing", err);
  }
}

async function collectTokenBudgets(): Promise<TokenBudgetsSection | NotApplicable> {
  if (!env.DATABASE_URL) return notApplicable("database_not_configured");
  try {
    const result = await query<{ scope_type: string; count: string }>(
      `SELECT scope_type, COUNT(*)::text AS count
       FROM token_budgets
       GROUP BY scope_type
       ORDER BY scope_type`,
    );
    const byScopeType = result.rows.map((r) => ({
      scopeType: r.scope_type,
      count: Number(r.count),
    }));
    const total = byScopeType.reduce((sum, row) => sum + row.count, 0);
    return { status: "ok", byScopeType, total };
  } catch (err) {
    return notApplicable("token_budgets_table_missing", err);
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function notApplicable(reason: string, err?: unknown): NotApplicable {
  if (err) {
    logger.debug("Evidence section degraded", { reason, error: errorMessage(err) });
  } else {
    logger.debug("Evidence section degraded", { reason });
  }
  return { status: "not_applicable_yet", reason };
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function countMatches(text: string, pattern: RegExp): number {
  const matches = text.match(pattern);
  return matches ? matches.length : 0;
}

function isOk<T extends { status: string }>(section: T | NotApplicable): section is T {
  return section.status === "ok";
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

// ============================================================================
// PUBLIC: COLLECT
// ============================================================================

/**
 * Take a snapshot of the current compliance posture. Always resolves; never
 * throws. Each section degrades to `not_applicable_yet` on failure.
 */
export async function collectEvidence(): Promise<EvidenceSnapshot> {
  const generatedAt = new Date().toISOString();
  const date = generatedAt.slice(0, 10);

  const [
    controlsMatrix,
    auditRetention,
    piiDetections,
    modelRegistry,
    retentionJob,
    webhookDeliveries,
    tokenBudgets,
  ] = await Promise.all([
    collectControlsMatrix(),
    collectAuditRetention(),
    collectPiiDetections(),
    collectModelRegistry(),
    collectRetentionJob(),
    collectWebhookDeliveries(),
    collectTokenBudgets(),
  ]);

  return {
    generatedAt,
    date,
    version: COLLECTOR_VERSION,
    sections: {
      controlsMatrix,
      auditRetention,
      piiDetections,
      modelRegistry,
      retentionJob,
      webhookDeliveries,
      tokenBudgets,
    },
  };
}

// ============================================================================
// PUBLIC: FORMAT
// ============================================================================

/**
 * Render a snapshot to human-readable Markdown. Output is stable so two
 * snapshots taken on the same DB state diff cleanly.
 */
export function formatEvidenceMarkdown(snapshot: EvidenceSnapshot): string {
  const lines: string[] = [];
  lines.push(`# ABC Compliance Evidence — ${snapshot.date}`);
  lines.push("");
  lines.push(`- **Generated at:** ${snapshot.generatedAt}`);
  lines.push(`- **Snapshot version:** v${snapshot.version}`);
  lines.push("");
  lines.push(`> Audit-grade posture snapshot of the ABC Agent Builder Console. Each section is collected independently; \`not_applicable_yet\` indicates the relevant table or source was not present at collection time.`);
  lines.push("");

  // Controls matrix
  lines.push("## Controls matrix");
  lines.push("");
  const cm = snapshot.sections.controlsMatrix;
  if (isOk(cm)) {
    lines.push(`Source: \`${cm.sourceFile}\``);
    lines.push("");
    lines.push("| Status | Count |");
    lines.push("|--------|-------|");
    lines.push(`| In place | ${cm.inPlace} |`);
    lines.push(`| Partial | ${cm.partial} |`);
    lines.push(`| Outstanding | ${cm.outstanding} |`);
    lines.push(`| **Total** | **${cm.total}** |`);
  } else {
    lines.push(`_${cm.status}: ${cm.reason}_`);
  }
  lines.push("");

  // Audit retention
  lines.push("## Audit log retention");
  lines.push("");
  const ar = snapshot.sections.auditRetention;
  if (isOk(ar)) {
    lines.push(`- **Total rows:** ${ar.totalRows}`);
    lines.push(`- **Oldest entry:** ${ar.oldestEntry ?? "—"}`);
    lines.push("");
    lines.push("### Top actions");
    lines.push("");
    if (ar.topActions.length === 0) {
      lines.push("_No audit entries yet._");
    } else {
      lines.push("| Action | Count |");
      lines.push("|--------|-------|");
      for (const row of ar.topActions) {
        lines.push(`| \`${row.action}\` | ${row.count} |`);
      }
    }
  } else {
    lines.push(`_${ar.status}: ${ar.reason}_`);
  }
  lines.push("");

  // PII detections
  lines.push("## PII detections (trailing 30 days)");
  lines.push("");
  const pd = snapshot.sections.piiDetections;
  if (isOk(pd)) {
    lines.push(`- **Window:** ${pd.windowDays} days`);
    lines.push(`- **Total:** ${pd.total}`);
    lines.push("");
    if (pd.byClassification.length === 0) {
      lines.push("_No PII detections in the window._");
    } else {
      lines.push("| Classification | Count |");
      lines.push("|----------------|-------|");
      for (const row of pd.byClassification) {
        lines.push(`| ${row.classification} | ${row.count} |`);
      }
    }
  } else {
    lines.push(`_${pd.status}: ${pd.reason}_`);
  }
  lines.push("");

  // Model registry
  lines.push("## Model registry");
  lines.push("");
  const mr = snapshot.sections.modelRegistry;
  if (isOk(mr)) {
    lines.push(`- **Active models:** ${mr.active}`);
    lines.push(`- **Inactive models:** ${mr.inactive}`);
    lines.push("");
    if (mr.byClassification.length === 0) {
      lines.push("_No active models registered._");
    } else {
      lines.push("### Active models by classification cap");
      lines.push("");
      lines.push("| Max classification | Count |");
      lines.push("|--------------------|-------|");
      for (const row of mr.byClassification) {
        lines.push(`| ${row.classification} | ${row.count} |`);
      }
    }
  } else {
    lines.push(`_${mr.status}: ${mr.reason}_`);
  }
  lines.push("");

  // Retention job
  lines.push("## Retention job");
  lines.push("");
  const rj = snapshot.sections.retentionJob;
  if (isOk(rj)) {
    if (rj.lastRunAt === null) {
      lines.push("_No retention pass recorded yet._");
    } else {
      lines.push(`- **Last run at:** ${rj.lastRunAt}`);
      if (rj.lastRunDetails) {
        lines.push("");
        lines.push("```json");
        lines.push(JSON.stringify(rj.lastRunDetails, null, 2));
        lines.push("```");
      }
    }
  } else {
    lines.push(`_${rj.status}: ${rj.reason}_`);
  }
  lines.push("");

  // Webhook deliveries
  lines.push("## Webhook deliveries (last 24 hours)");
  lines.push("");
  const wd = snapshot.sections.webhookDeliveries;
  if (isOk(wd)) {
    lines.push("| Status | Count |");
    lines.push("|--------|-------|");
    lines.push(`| Delivered | ${wd.delivered} |`);
    lines.push(`| Failed | ${wd.failed} |`);
    lines.push(`| Exhausted | ${wd.exhausted} |`);
  } else {
    lines.push(`_${wd.status}: ${wd.reason}_`);
  }
  lines.push("");

  // Token budgets
  lines.push("## Token budgets");
  lines.push("");
  const tb = snapshot.sections.tokenBudgets;
  if (isOk(tb)) {
    lines.push(`- **Total budgets configured:** ${tb.total}`);
    lines.push("");
    if (tb.byScopeType.length === 0) {
      lines.push("_No budgets configured._");
    } else {
      lines.push("| Scope type | Count |");
      lines.push("|------------|-------|");
      for (const row of tb.byScopeType) {
        lines.push(`| ${row.scopeType} | ${row.count} |`);
      }
    }
  } else {
    lines.push(`_${tb.status}: ${tb.reason}_`);
  }
  lines.push("");

  lines.push("---");
  lines.push("");
  lines.push(`_Generated by evidenceCollector v${snapshot.version}_`);
  lines.push("");

  return lines.join("\n");
}

// ============================================================================
// PUBLIC: PERSIST
// ============================================================================

/**
 * Collect a fresh snapshot, render it to Markdown, write the artifact to
 * disk under `docs/compliance/`, persist a row to `evidence_collections`
 * (when a database is configured), and emit an `EVIDENCE_COLLECTED` audit
 * entry. Returns the path + contents for the caller to surface (e.g. an
 * admin endpoint that streams the result back).
 *
 * Failures in DB persistence or audit emission are logged but do NOT fail
 * the disk write — the on-disk Markdown is the canonical artifact, and the
 * DB row is a convenience for the admin UI's list view.
 */
export async function persistDailyEvidence(opts: {
  triggeredBy?: string;
  userId?: string;
} = {}): Promise<PersistedEvidence> {
  const triggeredBy = opts.triggeredBy ?? "scheduler";
  const snapshot = await collectEvidence();
  const markdown = formatEvidenceMarkdown(snapshot);
  const filename = `evidence_${snapshot.date}.md`;
  const filePath = path.join(outputDir, filename);
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(filePath, markdown, "utf8");

  let collectionId: string | null = null;
  if (env.DATABASE_URL) {
    collectionId = await persistCollectionRow(snapshot, markdown, triggeredBy, opts.userId ?? null);
  }

  logger.info("Evidence snapshot persisted", {
    filePath,
    sections: Object.keys(snapshot.sections).length,
    collectionId,
    triggeredBy,
  });

  logAudit({
    userId: opts.userId,
    action: AuditAction.EVIDENCE_COLLECTED,
    resourceType: "evidence_collection",
    resourceId: collectionId ?? filename,
    details: {
      filename,
      triggeredBy,
      collectionId,
      sections: Object.keys(snapshot.sections).length,
    },
  }).catch(() => {});

  return { filename, filePath, snapshot, markdown };
}

/**
 * Read the most-recently-generated snapshot file. Returns null if none exist.
 * Only the Markdown content is preserved on disk — the structured snapshot
 * is regenerated per pass and is not archived as JSON.
 */
export async function readLatestEvidence(): Promise<LatestEvidence | null> {
  let entries: string[];
  try {
    entries = await fs.readdir(outputDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  const evidenceFiles = entries
    .filter((name) => /^evidence_\d{4}-\d{2}-\d{2}\.md$/.test(name))
    .sort();
  const latest = evidenceFiles[evidenceFiles.length - 1];
  if (!latest) return null;
  const filePath = path.join(outputDir, latest);
  const markdown = await fs.readFile(filePath, "utf8");
  const date = latest.slice("evidence_".length, "evidence_".length + 10);
  return { filename: latest, filePath, date, markdown };
}

// ============================================================================
// PUBLIC: DB-BACKED HISTORY (evidence_collections)
// ============================================================================

/**
 * Recent persisted collections, newest first. Returns an empty array when no
 * database is configured (so the admin UI can render an empty state rather
 * than a hard error). Never throws.
 */
export async function listCollections(opts: { limit?: number } = {}): Promise<CollectionSummaryRow[]> {
  if (!env.DATABASE_URL) return [];
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 200));
  try {
    const result = await query<{
      id: string;
      collected_at: string;
      period_start: string;
      period_end: string;
      triggered_by: string;
      user_id: string | null;
      source_version: string;
      row_counts: Record<string, number> | null;
      summary: EvidenceSnapshot | null;
    }>(
      `SELECT id,
              collected_at::text AS collected_at,
              period_start::text AS period_start,
              period_end::text   AS period_end,
              triggered_by,
              user_id,
              source_version,
              row_counts,
              summary
         FROM evidence_collections
        ORDER BY collected_at DESC
        LIMIT $1`,
      [limit],
    );
    return result.rows.map(toCollectionSummaryRow);
  } catch (err) {
    logger.error("Failed to list evidence collections", err as Error);
    return [];
  }
}

/**
 * Fetch a single collection row, including the rendered Markdown body and
 * structured summary. Returns null when the id does not match a row or when
 * no database is configured.
 */
export async function getCollection(id: string): Promise<CollectionDetailRow | null> {
  if (!env.DATABASE_URL) return null;
  try {
    const result = await query<{
      id: string;
      collected_at: string;
      period_start: string;
      period_end: string;
      triggered_by: string;
      user_id: string | null;
      source_version: string;
      row_counts: Record<string, number> | null;
      summary: EvidenceSnapshot;
      markdown: string;
    }>(
      `SELECT id,
              collected_at::text AS collected_at,
              period_start::text AS period_start,
              period_end::text   AS period_end,
              triggered_by,
              user_id,
              source_version,
              row_counts,
              summary,
              markdown
         FROM evidence_collections
        WHERE id = $1`,
      [id],
    );
    if (result.rowCount === 0) return null;
    const row = result.rows[0];
    return {
      ...toCollectionSummaryRow(row),
      summary: row.summary,
      markdown: row.markdown,
    };
  } catch (err) {
    logger.error("Failed to load evidence collection", err as Error, { id });
    return null;
  }
}

function toCollectionSummaryRow(row: {
  id: string;
  collected_at: string;
  period_start: string;
  period_end: string;
  triggered_by: string;
  user_id: string | null;
  source_version: string;
  row_counts: Record<string, number> | null;
  summary: EvidenceSnapshot | null;
}): CollectionSummaryRow {
  const snapshot = row.summary ?? null;
  const pii = snapshot && snapshot.sections.piiDetections.status === "ok"
    ? snapshot.sections.piiDetections.total
    : 0;
  const audit = snapshot && snapshot.sections.auditRetention.status === "ok"
    ? snapshot.sections.auditRetention.totalRows
    : 0;
  const modelActive = snapshot && snapshot.sections.modelRegistry.status === "ok"
    ? snapshot.sections.modelRegistry.active
    : 0;
  return {
    id: row.id,
    collectedAt: row.collected_at,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    triggeredBy: row.triggered_by,
    userId: row.user_id,
    sourceVersion: row.source_version,
    rowCounts: row.row_counts ?? {},
    auditTotal: audit,
    piiTotal: pii,
    modelTotalActive: modelActive,
  };
}

async function persistCollectionRow(
  snapshot: EvidenceSnapshot,
  markdown: string,
  triggeredBy: string,
  userId: string | null,
): Promise<string | null> {
  try {
    const periodEnd = new Date(snapshot.generatedAt);
    const periodStart = new Date(periodEnd.getTime() - ONE_DAY_MS);
    const rowCountsSnapshot: Record<string, number> = {};
    if (snapshot.sections.auditRetention.status === "ok") {
      rowCountsSnapshot.audit_log = snapshot.sections.auditRetention.totalRows;
    }
    if (snapshot.sections.piiDetections.status === "ok") {
      rowCountsSnapshot.pii_detections = snapshot.sections.piiDetections.total;
    }
    if (snapshot.sections.modelRegistry.status === "ok") {
      rowCountsSnapshot.models_active = snapshot.sections.modelRegistry.active;
      rowCountsSnapshot.models_inactive = snapshot.sections.modelRegistry.inactive;
    }
    if (snapshot.sections.webhookDeliveries.status === "ok") {
      rowCountsSnapshot.webhooks_delivered_24h = snapshot.sections.webhookDeliveries.delivered;
      rowCountsSnapshot.webhooks_failed_24h = snapshot.sections.webhookDeliveries.failed;
    }
    const result = await query<{ id: string }>(
      `INSERT INTO evidence_collections
         (collected_at, period_start, period_end, triggered_by, user_id,
          source_version, summary, markdown, row_counts)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        snapshot.generatedAt,
        periodStart.toISOString(),
        periodEnd.toISOString(),
        triggeredBy,
        userId,
        snapshot.version,
        JSON.stringify(snapshot),
        markdown,
        JSON.stringify(rowCountsSnapshot),
      ],
    );
    return result.rows[0]?.id ?? null;
  } catch (err) {
    logger.error("Failed to persist evidence collection row", err as Error);
    return null;
  }
}

// ============================================================================
// SCHEDULER
// ============================================================================

let evidenceTimer: NodeJS.Timeout | null = null;
let evidenceInterval: NodeJS.Timeout | null = null;

/**
 * Arm the daily scheduler. Mirrors `retentionJob.startRetentionScheduler`:
 * computes ms-until-next-configured-hour, fires a one-shot timer, then sets a
 * 24h interval. No-op when `EVIDENCE_JOB_ENABLED` is false. Idempotent.
 */
export function startEvidenceScheduler(): void {
  if (!env.EVIDENCE_JOB_ENABLED) {
    logger.info("Evidence scheduler disabled (EVIDENCE_JOB_ENABLED=false). Trigger manually via POST /api/compliance/evidence/run.");
    return;
  }
  if (evidenceTimer || evidenceInterval) {
    logger.debug("Evidence scheduler already running; skipping start");
    return;
  }
  const now = new Date();
  const next = new Date(now);
  next.setHours(env.EVIDENCE_JOB_HOUR, 0, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  const msUntilNext = next.getTime() - now.getTime();
  logger.info("Evidence scheduler armed", {
    firstRunAt: next.toISOString(),
    hour: env.EVIDENCE_JOB_HOUR,
    intervalHours: 24,
  });
  // `persistDailyEvidence()` already emits the canonical EVIDENCE_COLLECTED
  // audit entry for both manual and scheduled passes, so the scheduler just
  // needs to invoke it and log any unhandled error.
  const runScheduledPass = (): void => {
    persistDailyEvidence({ triggeredBy: "scheduler" }).catch((err) =>
      logger.error("Scheduled evidence pass failed", err as Error),
    );
  };
  evidenceTimer = setTimeout(() => {
    runScheduledPass();
    evidenceInterval = setInterval(runScheduledPass, ONE_DAY_MS);
  }, msUntilNext);
}

export function stopEvidenceScheduler(): void {
  if (evidenceTimer) {
    clearTimeout(evidenceTimer);
    evidenceTimer = null;
  }
  if (evidenceInterval) {
    clearInterval(evidenceInterval);
    evidenceInterval = null;
  }
}

export function evidenceSchedulerRunning(): boolean {
  return evidenceTimer !== null || evidenceInterval !== null;
}

// Export for tests
export { todayDate as _todayDate };
