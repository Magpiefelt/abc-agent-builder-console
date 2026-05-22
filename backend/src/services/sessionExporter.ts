/**
 * Session Transcript Exporter
 *
 * Pure formatter that turns a Free Agent session — prompt, iterations, blackboard,
 * scratchpad, attributes, artifact metadata, and final report — into a single
 * Markdown document a public servant can attach to a briefing note as evidence.
 *
 * The exporter is deliberately decoupled from the DB layer: callers fetch the
 * rows (`agent_sessions`, `agent_iterations`, `artifacts`) and pass them in as
 * a plain object. That keeps this module trivially unit-testable and means
 * future use cases (e.g. an admin "export any session" endpoint, a workflow
 * execution exporter) can reuse the same formatter without duplicating SQL.
 *
 * Output convention: GitHub-flavored Markdown. Tables for tabular data
 * (artifacts, attributes), fenced code blocks for raw LLM content, and
 * level-1 / level-2 / level-3 headings so the document renders cleanly in
 * the GoA Word/PDF tooling that consumes Markdown.
 *
 * Security: the exporter never returns artifact `content` bytes — only
 * metadata. Artifact payloads (images, audio, base64 blobs) stay on the
 * server and require explicit follow-up calls to `/artifacts/:artifactId`.
 */

import type { AgentSession } from "./agentOrchestrator.js";
import type { BlackboardEntry } from "./promptBuilder.js";

// ============================================================================
// INPUT SHAPES
// ============================================================================

/**
 * Iteration row as returned by `GET /api/agent/sessions/:id/iterations`.
 * Re-declared here so the exporter doesn't reach into route-layer types.
 */
export interface ExporterIteration {
  iterationNumber: number;
  status: string;
  userPrompt: string | null;
  rawResponse: string | null;
  parsedResponse: unknown;
  toolCalls: unknown;
  toolResults: unknown;
  blackboardEntry: unknown;
  error: string | null;
  tokensUsed: number | null;
  durationMs: number | null;
  createdAt: Date | string;
}

/**
 * Artifact metadata row (subset of `artifacts` table — no `content`).
 */
export interface ExporterArtifact {
  id: string;
  artifact_type: string;
  title: string;
  description: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  iteration: number | null;
  created_at: Date | string;
}

export interface ExporterInput {
  session: AgentSession;
  iterations: ExporterIteration[];
  artifacts: ExporterArtifact[];
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Build a Markdown transcript of the session.
 * The output is intended to be served as `text/markdown` with a `.md` filename.
 */
export function buildSessionTranscript(input: ExporterInput): string {
  const { session, iterations, artifacts } = input;

  const sections: string[] = [];

  sections.push(renderHeader(session));
  sections.push(renderOriginalPrompt(session));

  if (iterations.length > 0) {
    sections.push(renderIterations(iterations));
  } else {
    sections.push("## Iterations\n\n_No iterations recorded._");
  }

  sections.push(renderBlackboard(session.blackboard));
  sections.push(renderScratchpad(session.scratchpad));
  sections.push(renderAttributes(session.attributes));
  sections.push(renderArtifacts(artifacts));
  sections.push(renderFinalReport(session.finalReport));

  // Trailing newline ensures POSIX-friendly output.
  return sections.join("\n\n") + "\n";
}

/**
 * Build a safe filename for the export. The session id may be a full UUID;
 * we truncate to the first 8 chars to keep filenames short while still
 * uniquely identifying the export at a glance.
 *
 * Returns a basename only — no path traversal possible because we strip every
 * non-alphanumeric character.
 */
export function buildExportFilename(sessionId: string): string {
  const sanitized = sessionId.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 8) || "session";
  return `abc-session-${sanitized}.md`;
}

// ============================================================================
// RENDERERS
// ============================================================================

function renderHeader(session: AgentSession): string {
  const createdAt = formatTimestamp(session.createdAt);
  // Compose a metadata table. Markdown tables render cleanly in GitHub, GoA
  // internal viewers, and Word.
  const rows: Array<[string, string]> = [
    ["Session ID", `\`${session.id}\``],
    ["Created", createdAt],
    ["Model", session.modelId],
    ["Classification", humanizeClassification(session.classification)],
    ["Status", humanizeStatus(session.status)],
    ["Iterations completed", `${session.currentIteration} of ${session.maxIterations}`],
  ];
  if (session.ministryCode) {
    rows.push(["Ministry", session.ministryCode]);
  }
  if (session.error) {
    rows.push(["Error", oneLine(session.error)]);
  }

  const table = ["| Field | Value |", "|-------|-------|", ...rows.map(([k, v]) => `| ${k} | ${v} |`)].join("\n");

  return [
    "# ABC Free Agent — Session Transcript",
    "",
    `_Exported ${new Date().toISOString()}_`,
    "",
    table,
  ].join("\n");
}

function renderOriginalPrompt(session: AgentSession): string {
  return ["## Original prompt", "", fence(session.prompt, "text")].join("\n");
}

function renderIterations(iterations: ExporterIteration[]): string {
  const out: string[] = ["## Iterations"];
  for (const it of iterations) {
    out.push("", renderSingleIteration(it));
  }
  return out.join("\n");
}

function renderSingleIteration(it: ExporterIteration): string {
  const parsed = parseObject(it.parsedResponse);
  const thinking = typeof parsed?.thinking === "string" ? parsed.thinking : null;
  const userMessage =
    typeof parsed?.userMessage === "string"
      ? parsed.userMessage
      : typeof parsed?.user_message === "string"
        ? (parsed.user_message as string)
        : null;
  const parsedStatus = typeof parsed?.status === "string" ? parsed.status : null;

  const lines: string[] = [];
  lines.push(`### Iteration ${it.iterationNumber}`);

  // Compact metadata line per iteration.
  const meta: string[] = [`status: \`${it.status}\``];
  if (parsedStatus && parsedStatus !== it.status) meta.push(`parsed: \`${parsedStatus}\``);
  if (typeof it.durationMs === "number") meta.push(`duration: ${it.durationMs} ms`);
  if (typeof it.tokensUsed === "number") meta.push(`tokens: ${it.tokensUsed}`);
  lines.push("", `_${meta.join(" · ")}_`);

  if (it.userPrompt) {
    lines.push("", "**Input prompt:**", "", fence(truncate(it.userPrompt, 4000), "text"));
  }

  if (thinking) {
    lines.push("", "**Thinking:**", "", blockquote(thinking));
  }

  if (userMessage) {
    lines.push("", "**Assistant message:**", "", blockquote(userMessage));
  }

  const toolCalls = parseArray(it.toolCalls);
  if (toolCalls.length > 0) {
    lines.push("", `**Tool calls (${toolCalls.length}):**`);
    for (const call of toolCalls) {
      const obj = parseObject(call);
      const toolName = typeof obj?.tool === "string" ? obj.tool : "unknown";
      const params = obj?.params ?? {};
      lines.push("", `- \`${toolName}\``);
      const json = safeJsonStringify(params);
      if (json !== "{}") {
        lines.push(fence(json, "json"));
      }
    }
  }

  const toolResults = parseArray(it.toolResults);
  if (toolResults.length > 0) {
    lines.push("", `**Tool results (${toolResults.length}):**`);
    lines.push("", "| Tool | Success | Duration | Error |", "|------|---------|----------|-------|");
    for (const res of toolResults) {
      const obj = parseObject(res);
      const toolName = typeof obj?.tool === "string" ? obj.tool : "unknown";
      const success = obj?.success === true ? "✅" : obj?.success === false ? "❌" : "?";
      const duration =
        typeof obj?.durationMs === "number" ? `${obj.durationMs} ms` : "—";
      const err = typeof obj?.error === "string" ? oneLine(obj.error) : "—";
      lines.push(`| \`${toolName}\` | ${success} | ${duration} | ${err} |`);
    }
  }

  if (it.error) {
    lines.push("", "**Iteration error:**", "", fence(it.error, "text"));
  }

  return lines.join("\n");
}

function renderBlackboard(blackboard: BlackboardEntry[]): string {
  if (!blackboard || blackboard.length === 0) {
    return "## Blackboard\n\n_No entries._";
  }

  // Group by category for readability.
  const byCategory = new Map<string, BlackboardEntry[]>();
  for (const entry of blackboard) {
    const key = entry.category || "general";
    const arr = byCategory.get(key) ?? [];
    arr.push(entry);
    byCategory.set(key, arr);
  }

  const out: string[] = ["## Blackboard"];
  for (const [category, entries] of byCategory) {
    out.push("", `### ${category}`);
    for (const entry of entries) {
      out.push(
        "",
        `**${entry.title || "(untitled)"}** _(iteration ${entry.iteration})_`,
        "",
        entry.content || "_empty_",
      );
    }
  }
  return out.join("\n");
}

function renderScratchpad(scratchpad: string): string {
  if (!scratchpad || scratchpad.trim().length === 0) {
    return "## Scratchpad\n\n_Empty._";
  }
  return ["## Scratchpad", "", fence(scratchpad, "text")].join("\n");
}

function renderAttributes(attributes: Record<string, unknown>): string {
  const keys = Object.keys(attributes ?? {});
  if (keys.length === 0) {
    return "## Attributes\n\n_None._";
  }
  const out = ["## Attributes", "", "| Key | Value |", "|-----|-------|"];
  for (const key of keys) {
    const raw = attributes[key];
    const value = typeof raw === "string" ? oneLine(raw) : safeJsonStringify(raw);
    out.push(`| \`${key}\` | ${escapeTableCell(value)} |`);
  }
  return out.join("\n");
}

function renderArtifacts(artifacts: ExporterArtifact[]): string {
  if (!artifacts || artifacts.length === 0) {
    return "## Artifacts\n\n_None generated._";
  }
  const out = [
    "## Artifacts",
    "",
    `_${artifacts.length} artifact${artifacts.length === 1 ? "" : "s"} (metadata only — payload bytes excluded)._`,
    "",
    "| # | Title | Type | MIME | Size (bytes) | Iteration | Created |",
    "|---|-------|------|------|--------------|-----------|---------|",
  ];
  artifacts.forEach((a, idx) => {
    out.push(
      `| ${idx + 1} | ${escapeTableCell(a.title || "(untitled)")} | ${a.artifact_type} | ${
        a.mime_type ?? "—"
      } | ${a.size_bytes ?? "—"} | ${a.iteration ?? "—"} | ${formatTimestamp(a.created_at)} |`,
    );
  });

  // Per-artifact descriptions, if present, are rendered after the table.
  const described = artifacts.filter((a) => a.description && a.description.trim().length > 0);
  if (described.length > 0) {
    out.push("", "### Artifact descriptions");
    for (const a of described) {
      out.push("", `**${a.title || a.id}**`, "", a.description as string);
    }
  }

  return out.join("\n");
}

function renderFinalReport(finalReport: unknown): string {
  if (finalReport == null) {
    return "## Final report\n\n_No final report was produced for this session._";
  }
  // Final reports today are JSON-shaped; serialize as a fenced block so the
  // exact structure is preserved. If a future iteration produces narrative
  // markdown we'd want to keep that pass-through as well.
  if (typeof finalReport === "string") {
    return ["## Final report", "", finalReport].join("\n");
  }
  return ["## Final report", "", fence(safeJsonStringify(finalReport), "json")].join("\n");
}

// ============================================================================
// HELPERS
// ============================================================================

function fence(content: string, language: string): string {
  // Choose a fence length that won't collide with any sequence of backticks
  // already inside `content`. Default to 3, expand if necessary.
  let fenceLen = 3;
  const pattern = /`{3,}/g;
  for (const match of content.matchAll(pattern)) {
    const len = match[0].length;
    if (len >= fenceLen) fenceLen = len + 1;
  }
  const ticks = "`".repeat(fenceLen);
  return `${ticks}${language}\n${content}\n${ticks}`;
}

function blockquote(content: string): string {
  return content
    .split(/\r?\n/)
    .map((line) => (line.length === 0 ? ">" : `> ${line}`))
    .join("\n");
}

function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}… [truncated at ${max} chars]`;
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function escapeTableCell(value: string): string {
  // Pipes and newlines break Markdown tables; replace them with safe equivalents.
  return oneLine(value).replace(/\|/g, "\\|");
}

function formatTimestamp(ts: Date | string | null | undefined): string {
  if (ts == null) return "—";
  try {
    const d = ts instanceof Date ? ts : new Date(ts);
    if (Number.isNaN(d.getTime())) return String(ts);
    return d.toISOString();
  } catch {
    return String(ts);
  }
}

function humanizeClassification(value: string): string {
  switch (value) {
    case "unclassified":
      return "Unclassified";
    case "protected_a":
      return "Protected A";
    case "protected_b":
      return "Protected B";
    default:
      return value;
  }
}

function humanizeStatus(value: string): string {
  switch (value) {
    case "completed":
      return "Completed";
    case "error":
      return "Error";
    case "running":
      return "Running";
    case "paused":
      return "Paused";
    case "needs_assistance":
      return "Needs assistance";
    case "idle":
      return "Idle";
    default:
      return value;
  }
}

function parseObject(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Fall through.
    }
  }
  return null;
}

function parseArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Fall through.
    }
  }
  return [];
}
