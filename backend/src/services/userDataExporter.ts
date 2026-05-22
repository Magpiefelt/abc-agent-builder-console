/**
 * FOIP s.7 Right-of-Access User Data Exporter (Backlog B6)
 *
 * Bundles every row in every table that references a specific user into a
 * single ZIP archive an admin can hand to the user (or their legal
 * representative) in fulfillment of a Freedom of Information and Protection
 * of Privacy Act s.7 access request.
 *
 * Design intent
 * -------------
 *   - **One stop, one shot.** The exporter is responsible for *every* table
 *     that holds user-attributable rows; admin route is a one-liner that
 *     calls in, audits, and streams the result. Adding a new user-scoped
 *     table is a one-line change to `collectUserData()`.
 *   - **Stable archive shape.** Every export contains the same set of files,
 *     even for empty tables (`[]` JSON). Downstream tools and reviewers can
 *     trust the structure.
 *   - **Privacy-respecting.** Encrypted secret *values* are NEVER included
 *     (the encrypted bytes are useless without the vault key, and including
 *     them risks leaking the ciphertext post-key-rotation). Artifact *content*
 *     is omitted for non-text mime types (a 100 MB PDF bundle would frustrate
 *     the right-of-access use case; admins can fetch specific artifacts
 *     through the session inspector).
 *   - **DB-agnostic.** The exporter takes its own `query` function for
 *     dependency injection; tests pass a mock that never touches Postgres.
 *
 * Output layout (inside the ZIP)
 * ------------------------------
 *   README.md
 *   manifest.json            # row counts per file + export metadata
 *   user.json
 *   preferences.json
 *   saved_prompts.json
 *   workflow_favorites.json
 *   workflows.json
 *   workflow_versions.json
 *   workflow_executions.json
 *   agent_sessions.json
 *   agent_iterations.json
 *   artifacts.json
 *   audit_log.json
 *   pii_detections.json
 *   secret_labels.json
 */

import type AdmZipType from "adm-zip";
import type { QueryResult, QueryResultRow } from "pg";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Minimum query surface the exporter needs. Lets tests pass a vi.fn() without
 * importing the real Postgres pool. Matches `config/database.ts#query` shape.
 */
export type ExporterQuery = <T extends QueryResultRow = Record<string, unknown>>(
  text: string,
  params?: unknown[],
) => Promise<QueryResult<T>>;

export interface ExportRowCounts {
  user: number;
  preferences: number;
  savedPrompts: number;
  workflowFavorites: number;
  workflows: number;
  workflowVersions: number;
  workflowExecutions: number;
  agentSessions: number;
  agentIterations: number;
  artifacts: number;
  auditLog: number;
  piiDetections: number;
  secretLabels: number;
}

export interface ExportManifest {
  exportedAt: string;
  schemaVersion: 1;
  userId: string;
  exportedBy: {
    userId: string;
    role: string;
  };
  rowCounts: ExportRowCounts;
  files: string[];
}

export interface UserExportResult {
  /** zip bytes, ready for `res.send(buffer)`. */
  zip: Buffer;
  manifest: ExportManifest;
  filename: string;
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Build the user-data ZIP. Returns null when the user does not exist (so the
 * admin route can respond with 404 cleanly).
 *
 * The returned Buffer is fully materialised in memory. User data is small
 * enough (a few MB at the high end, mostly JSON) that streaming would add
 * complexity without saving meaningful memory; if exports ever exceed 50 MB
 * we'll revisit.
 */
export async function exportUserData(opts: {
  userId: string;
  exportedBy: { userId: string; role: string };
  query: ExporterQuery;
  /** Allow tests to inject a stable timestamp. */
  now?: Date;
}): Promise<UserExportResult | null> {
  const { userId, exportedBy, query: q } = opts;
  const now = opts.now ?? new Date();

  const data = await collectUserData(userId, q);
  if (!data) return null;

  const manifest: ExportManifest = {
    exportedAt: now.toISOString(),
    schemaVersion: 1,
    userId,
    exportedBy: { userId: exportedBy.userId, role: exportedBy.role },
    rowCounts: countRows(data),
    files: EXPECTED_FILES,
  };

  // adm-zip is loaded lazily so the import doesn't crash if the dep is ever
  // pruned in a slimmed-down build (the document tool handlers already use
  // this idiom).
  const AdmZip = (await import("adm-zip")).default;
  const zip = new AdmZip();

  zip.addFile("README.md", Buffer.from(buildReadme(manifest), "utf-8"));
  zip.addFile("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2), "utf-8"));

  zip.addFile("user.json", jsonBuf([data.user]));
  zip.addFile("preferences.json", jsonBuf(data.preferences));
  zip.addFile("saved_prompts.json", jsonBuf(data.savedPrompts));
  zip.addFile("workflow_favorites.json", jsonBuf(data.workflowFavorites));
  zip.addFile("workflows.json", jsonBuf(data.workflows));
  zip.addFile("workflow_versions.json", jsonBuf(data.workflowVersions));
  zip.addFile("workflow_executions.json", jsonBuf(data.workflowExecutions));
  zip.addFile("agent_sessions.json", jsonBuf(data.agentSessions));
  zip.addFile("agent_iterations.json", jsonBuf(data.agentIterations));
  zip.addFile("artifacts.json", jsonBuf(data.artifacts));
  zip.addFile("audit_log.json", jsonBuf(data.auditLog));
  zip.addFile("pii_detections.json", jsonBuf(data.piiDetections));
  zip.addFile("secret_labels.json", jsonBuf(data.secretLabels));

  return {
    zip: zip.toBuffer(),
    manifest,
    filename: buildExportFilename(userId, now),
  };
}

/**
 * Build a safe filename for the export. Pattern:
 *   abc-user-<short-id>-<YYYY-MM-DD>.zip
 *
 * Short-id is the first 8 hex chars of the user UUID; if the id isn't UUID-
 * shaped we fall back to "user". Strips every character that isn't safe in
 * a Content-Disposition filename so the header can't be smuggled.
 */
export function buildExportFilename(userId: string, now: Date): string {
  const sanitized = userId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) || "user";
  const date = now.toISOString().slice(0, 10);
  return `abc-user-${sanitized}-${date}.zip`;
}

// ============================================================================
// DATA COLLECTION
// ============================================================================

interface UserRow extends QueryResultRow {
  id: string;
  entra_id: string;
  email: string;
  display_name: string;
  ministry_code: string | null;
  role: string;
  last_login: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface ArtifactMetaRow extends QueryResultRow {
  id: string;
  session_id: string | null;
  workflow_execution_id: string | null;
  artifact_type: string;
  title: string;
  description: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  iteration: number | null;
  created_at: Date;
  /** Included only for text/data artifacts; null otherwise (see scrubArtifact). */
  content: string | null;
}

interface CollectedUserData {
  user: UserRow;
  preferences: Record<string, unknown>[];
  savedPrompts: Record<string, unknown>[];
  workflowFavorites: Record<string, unknown>[];
  workflows: Record<string, unknown>[];
  workflowVersions: Record<string, unknown>[];
  workflowExecutions: Record<string, unknown>[];
  agentSessions: Record<string, unknown>[];
  agentIterations: Record<string, unknown>[];
  artifacts: ArtifactMetaRow[];
  auditLog: Record<string, unknown>[];
  piiDetections: Record<string, unknown>[];
  secretLabels: Record<string, unknown>[];
}

async function collectUserData(
  userId: string,
  q: ExporterQuery,
): Promise<CollectedUserData | null> {
  const userResult = await q<UserRow>(
    `SELECT id, entra_id, email, display_name, ministry_code, role,
            last_login, created_at, updated_at
       FROM users WHERE id = $1`,
    [userId],
  );
  if (userResult.rowCount === 0) return null;
  const user = userResult.rows[0];

  // Each query reads only user-attributable rows. Some tables (workflow_versions,
  // agent_iterations) don't reference user_id directly — they hang off
  // workflows/sessions — so they're filtered via the parent row's id.
  const [
    preferences,
    savedPrompts,
    workflowFavorites,
    workflows,
    workflowVersions,
    workflowExecutions,
    agentSessions,
    agentIterations,
    artifactsRaw,
    auditLog,
    piiDetections,
    secretLabels,
  ] = await Promise.all([
    q(`SELECT user_id, default_model_id, default_classification, theme,
                notification_preferences, updated_at
           FROM user_preferences WHERE user_id = $1`, [userId]),
    q(`SELECT id, user_id, ministry_code, title, prompt, tags, is_public,
                created_at, updated_at
           FROM saved_prompts WHERE user_id = $1
           ORDER BY created_at DESC`, [userId]),
    q(`SELECT user_id, workflow_id, favorited_at
           FROM workflow_favorites WHERE user_id = $1
           ORDER BY favorited_at DESC`, [userId]),
    q(`SELECT id, user_id, ministry_code, name, description, classification,
                canvas_data, is_template, tags, version, deleted_at,
                created_at, updated_at
           FROM workflows WHERE user_id = $1
           ORDER BY created_at DESC`, [userId]),
    q(`SELECT v.id, v.workflow_id, v.version, v.canvas_data,
                v.created_by, v.created_at
           FROM workflow_versions v
           JOIN workflows w ON w.id = v.workflow_id
          WHERE w.user_id = $1
          ORDER BY v.created_at DESC`, [userId]),
    q(`SELECT id, workflow_id, user_id, classification, status,
                stage_results, error, started_at, completed_at
           FROM workflow_executions WHERE user_id = $1
           ORDER BY started_at DESC`, [userId]),
    q(`SELECT id, user_id, ministry_code, prompt, model_id, max_iterations,
                current_iteration, status, classification, blackboard,
                scratchpad, attributes, final_report, error,
                created_at, updated_at, completed_at
           FROM agent_sessions WHERE user_id = $1
           ORDER BY created_at DESC`, [userId]),
    q(`SELECT i.id, i.session_id, i.iteration_number, i.system_prompt_hash,
                i.user_prompt, i.raw_llm_response, i.parsed_response,
                i.tool_calls, i.tool_results, i.blackboard_entry, i.status,
                i.error, i.tokens_used, i.duration_ms, i.created_at
           FROM agent_iterations i
           JOIN agent_sessions s ON s.id = i.session_id
          WHERE s.user_id = $1
          ORDER BY i.created_at DESC`, [userId]),
    q<ArtifactMetaRow>(
      `SELECT id, session_id, workflow_execution_id, artifact_type, title,
                description, mime_type, size_bytes, iteration,
                created_at, content
           FROM artifacts WHERE user_id = $1
           ORDER BY created_at DESC`,
      [userId],
    ),
    q(`SELECT id, user_id, ministry_code, action, resource_type,
                resource_id, details, ip_address, created_at
           FROM audit_log WHERE user_id = $1
           ORDER BY created_at DESC
           LIMIT 10000`, [userId]),
    q(`SELECT id, user_id, session_id, detection_type, pattern_matched,
                action_taken, context_snippet, created_at
           FROM pii_detections WHERE user_id = $1
           ORDER BY created_at DESC`, [userId]),
    // Secret VALUES are encrypted bytea. We never include them: post-rotation
    // they become noise that wastes archive space, and including ciphertext
    // alongside the schema gives a future attacker a target. Labels + dates
    // are still meaningful so the user knows what's stored on their behalf.
    q(`SELECT id, user_id, label, created_at, updated_at
           FROM user_secrets WHERE user_id = $1
           ORDER BY created_at DESC`, [userId]),
  ]);

  return {
    user,
    preferences: preferences.rows,
    savedPrompts: savedPrompts.rows,
    workflowFavorites: workflowFavorites.rows,
    workflows: workflows.rows,
    workflowVersions: workflowVersions.rows,
    workflowExecutions: workflowExecutions.rows,
    agentSessions: agentSessions.rows,
    agentIterations: agentIterations.rows,
    artifacts: artifactsRaw.rows.map(scrubArtifact),
    auditLog: auditLog.rows,
    piiDetections: piiDetections.rows,
    secretLabels: secretLabels.rows,
  };
}

/**
 * Strip raw bytes from non-text artifacts. The `content` column stores either
 * UTF-8 (for text/data artifacts) or base64 (for files/images/audio); the
 * latter can be megabytes per row and isn't useful for a FOIP review. Text
 * content is preserved because that's where prompt outputs and structured
 * data sit — and that's exactly what a user has a right to access.
 */
function scrubArtifact(row: ArtifactMetaRow): ArtifactMetaRow {
  const kind = row.artifact_type;
  if (kind === "text" || kind === "data") return row;
  return { ...row, content: null };
}

// ============================================================================
// MANIFEST / README HELPERS
// ============================================================================

const EXPECTED_FILES = [
  "README.md",
  "manifest.json",
  "user.json",
  "preferences.json",
  "saved_prompts.json",
  "workflow_favorites.json",
  "workflows.json",
  "workflow_versions.json",
  "workflow_executions.json",
  "agent_sessions.json",
  "agent_iterations.json",
  "artifacts.json",
  "audit_log.json",
  "pii_detections.json",
  "secret_labels.json",
];

function countRows(d: CollectedUserData): ExportRowCounts {
  return {
    user: 1,
    preferences: d.preferences.length,
    savedPrompts: d.savedPrompts.length,
    workflowFavorites: d.workflowFavorites.length,
    workflows: d.workflows.length,
    workflowVersions: d.workflowVersions.length,
    workflowExecutions: d.workflowExecutions.length,
    agentSessions: d.agentSessions.length,
    agentIterations: d.agentIterations.length,
    artifacts: d.artifacts.length,
    auditLog: d.auditLog.length,
    piiDetections: d.piiDetections.length,
    secretLabels: d.secretLabels.length,
  };
}

function buildReadme(m: ExportManifest): string {
  return [
    "# ABC User Data Export",
    "",
    "This archive contains every row attributable to a single user across the",
    "Agent Builder Console databases, packaged for a FOIP s.7 right-of-access",
    "request.",
    "",
    "## Export metadata",
    "",
    `- **User ID:** \`${m.userId}\``,
    `- **Exported at:** ${m.exportedAt}`,
    `- **Exported by:** \`${m.exportedBy.userId}\` (role: ${m.exportedBy.role})`,
    `- **Schema version:** ${m.schemaVersion}`,
    "",
    "## What's in here",
    "",
    "| File | Description | Rows |",
    "|------|-------------|------|",
    `| \`user.json\` | The user record itself (id, entra_id, email, display_name, ministry, role, login timestamps). | ${m.rowCounts.user} |`,
    `| \`preferences.json\` | Per-user UI preferences (theme, default model, default classification, notification settings). | ${m.rowCounts.preferences} |`,
    `| \`saved_prompts.json\` | Prompts the user explicitly saved (private + ministry-shared). | ${m.rowCounts.savedPrompts} |`,
    `| \`workflow_favorites.json\` | Workflows the user starred. | ${m.rowCounts.workflowFavorites} |`,
    `| \`workflows.json\` | Workflows the user authored (including soft-deleted via the \`deleted_at\` column). | ${m.rowCounts.workflows} |`,
    `| \`workflow_versions.json\` | Every snapshot in the user's workflows' version history. | ${m.rowCounts.workflowVersions} |`,
    `| \`workflow_executions.json\` | Every execution the user triggered, including stage outputs. | ${m.rowCounts.workflowExecutions} |`,
    `| \`agent_sessions.json\` | Free Agent sessions the user opened (prompt, blackboard, scratchpad, attributes, final report). | ${m.rowCounts.agentSessions} |`,
    `| \`agent_iterations.json\` | Per-iteration details for the user's sessions (LLM input/output, tool calls + results). | ${m.rowCounts.agentIterations} |`,
    `| \`artifacts.json\` | Artifact metadata + text content. Non-text payloads (images, audio, large files) are omitted; admins can fetch them via the session inspector if requested. | ${m.rowCounts.artifacts} |`,
    `| \`audit_log.json\` | Audit-log entries attributed to this user (capped at 10,000 rows; admins can pull older history directly from \`audit_log\`). | ${m.rowCounts.auditLog} |`,
    `| \`pii_detections.json\` | PII detection events the user triggered. | ${m.rowCounts.piiDetections} |`,
    `| \`secret_labels.json\` | Labels + timestamps for the user's vault entries. **Encrypted values are intentionally omitted** — they would be unreadable without the vault key, and including them could leak ciphertext after key rotation. | ${m.rowCounts.secretLabels} |`,
    "",
    "## What's intentionally NOT included",
    "",
    "- **Encrypted secret values** — ciphertext-only is useless to the user and",
    "  retaining it in exports is a long-tail risk after key rotation.",
    "- **Large artifact payloads** (images, audio, file content) — these can be",
    "  many megabytes per row and are not part of a typical access request. An",
    "  admin can hand them over separately if specifically asked.",
    "- **Other users' data** — every query in the export is scoped to",
    `  \`user_id = '${m.userId}'\` or transitively (versions → workflows,`,
    "  iterations → sessions).",
    "",
    "## How this archive was generated",
    "",
    "`POST /api/admin/users/<user_id>/export` invokes",
    "`backend/src/services/userDataExporter.ts#exportUserData`. The action is",
    "logged in `audit_log` with action `user.data.exported`.",
    "",
  ].join("\n");
}

function jsonBuf(rows: unknown): Buffer {
  return Buffer.from(JSON.stringify(rows, null, 2), "utf-8");
}

// Re-export the AdmZip type so route-layer tests can use it without importing
// the dependency directly. Marked as a type-only export so the runtime import
// stays lazy.
export type { AdmZipType };
