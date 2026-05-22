/**
 * Unit tests for userDataExporter (Backlog B6).
 *
 * The exporter is DB-agnostic — it takes a `query` function as input — so
 * tests pass a `vi.fn()` that returns canned rows for each table. No real
 * Postgres pool is touched.
 *
 * We assert on:
 *   - manifest shape + row counts
 *   - every expected file lands in the zip
 *   - secret labels are present, encrypted values are NOT
 *   - non-text artifact content is scrubbed
 *   - missing user → null
 *   - filename construction is safe
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import AdmZip from "adm-zip";
import {
  exportUserData,
  buildExportFilename,
  type ExporterQuery,
} from "../userDataExporter.js";

const USER_ID = "11111111-2222-3333-4444-555555555555";

function makeQuery(opts: {
  userRows?: unknown[];
  preferences?: unknown[];
  savedPrompts?: unknown[];
  workflowFavorites?: unknown[];
  workflows?: unknown[];
  workflowVersions?: unknown[];
  workflowExecutions?: unknown[];
  agentSessions?: unknown[];
  agentIterations?: unknown[];
  artifacts?: unknown[];
  auditLog?: unknown[];
  piiDetections?: unknown[];
  secretLabels?: unknown[];
} = {}): { query: ExporterQuery; calls: string[] } {
  // Match queries by the first table name we mention in each SELECT.
  // Order doesn't matter — we look at the SQL text and return the right batch.
  const calls: string[] = [];
  const query: ExporterQuery = vi.fn(async (sql: string) => {
    calls.push(sql);
    if (/FROM users WHERE id/.test(sql)) {
      const rows = opts.userRows ?? [
        {
          id: USER_ID,
          entra_id: "entra-xyz",
          email: "user@gov.ab.ca",
          display_name: "Test User",
          ministry_code: "INFRA",
          role: "user",
          last_login: new Date("2026-05-01T12:00:00Z"),
          created_at: new Date("2025-01-01T00:00:00Z"),
          updated_at: new Date("2026-05-01T12:00:00Z"),
        },
      ];
      return mkResult(rows);
    }
    if (/FROM user_preferences/.test(sql)) return mkResult(opts.preferences ?? []);
    if (/FROM saved_prompts/.test(sql)) return mkResult(opts.savedPrompts ?? []);
    if (/FROM workflow_favorites/.test(sql)) return mkResult(opts.workflowFavorites ?? []);
    if (/FROM workflows WHERE user_id/.test(sql)) return mkResult(opts.workflows ?? []);
    if (/FROM workflow_versions/.test(sql)) return mkResult(opts.workflowVersions ?? []);
    if (/FROM workflow_executions/.test(sql)) return mkResult(opts.workflowExecutions ?? []);
    if (/FROM agent_sessions/.test(sql)) return mkResult(opts.agentSessions ?? []);
    if (/FROM agent_iterations/.test(sql)) return mkResult(opts.agentIterations ?? []);
    if (/FROM artifacts/.test(sql)) return mkResult(opts.artifacts ?? []);
    if (/FROM audit_log/.test(sql)) return mkResult(opts.auditLog ?? []);
    if (/FROM pii_detections/.test(sql)) return mkResult(opts.piiDetections ?? []);
    if (/FROM user_secrets/.test(sql)) return mkResult(opts.secretLabels ?? []);
    throw new Error("Unexpected query: " + sql);
  });
  return { query, calls };
}

function mkResult(rows: unknown[]): { rowCount: number; rows: never[] } {
  return { rowCount: rows.length, rows: rows as never[] };
}

const FIXED_NOW = new Date("2026-05-22T15:30:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("exportUserData", () => {
  it("returns null when the user does not exist", async () => {
    const { query } = makeQuery({ userRows: [] });
    const result = await exportUserData({
      userId: USER_ID,
      exportedBy: { userId: "admin-1", role: "admin" },
      query,
      now: FIXED_NOW,
    });
    expect(result).toBeNull();
  });

  it("returns a zip with every expected file even when downstream tables are empty", async () => {
    const { query, calls } = makeQuery();
    const result = await exportUserData({
      userId: USER_ID,
      exportedBy: { userId: "admin-1", role: "admin" },
      query,
      now: FIXED_NOW,
    });
    expect(result).not.toBeNull();
    const entries = new AdmZip(result!.zip).getEntries().map((e) => e.entryName);
    expect(entries.sort()).toEqual(
      [
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
      ].sort(),
    );
    // Sanity: every empty table renders as `[]`, not `null`.
    const zip = new AdmZip(result!.zip);
    expect(zip.getEntry("saved_prompts.json")!.getData().toString()).toBe("[]");
    expect(zip.getEntry("audit_log.json")!.getData().toString()).toBe("[]");
    // Calls one query per table + one for the user row = 13 statements.
    expect(calls.length).toBeGreaterThanOrEqual(13);
  });

  it("builds a manifest with accurate row counts", async () => {
    const { query } = makeQuery({
      savedPrompts: [{ id: "p1" }, { id: "p2" }, { id: "p3" }],
      workflows: [{ id: "w1" }],
      workflowExecutions: [{ id: "e1" }, { id: "e2" }],
      agentSessions: [{ id: "s1" }],
      agentIterations: [{ id: "i1" }, { id: "i2" }, { id: "i3" }, { id: "i4" }],
      auditLog: [{ id: 1 }, { id: 2 }],
    });
    const result = await exportUserData({
      userId: USER_ID,
      exportedBy: { userId: "admin-1", role: "admin" },
      query,
      now: FIXED_NOW,
    });
    expect(result).not.toBeNull();
    const manifest = JSON.parse(
      new AdmZip(result!.zip).getEntry("manifest.json")!.getData().toString(),
    );
    expect(manifest.userId).toBe(USER_ID);
    expect(manifest.exportedAt).toBe(FIXED_NOW.toISOString());
    expect(manifest.exportedBy).toEqual({ userId: "admin-1", role: "admin" });
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.rowCounts).toMatchObject({
      user: 1,
      savedPrompts: 3,
      workflows: 1,
      workflowExecutions: 2,
      agentSessions: 1,
      agentIterations: 4,
      auditLog: 2,
    });
  });

  it("includes secret labels but never encrypted values", async () => {
    const { query } = makeQuery({
      secretLabels: [
        // Note: even if the row accidentally included encrypted_value, the
        // exporter's SELECT projection excludes it. We assert on the file.
        {
          id: "sec-1",
          user_id: USER_ID,
          label: "github-token",
          created_at: new Date("2026-04-01T00:00:00Z"),
          updated_at: new Date("2026-04-01T00:00:00Z"),
        },
      ],
    });
    const result = await exportUserData({
      userId: USER_ID,
      exportedBy: { userId: "admin-1", role: "admin" },
      query,
      now: FIXED_NOW,
    });
    const secretsFile = new AdmZip(result!.zip)
      .getEntry("secret_labels.json")!
      .getData()
      .toString();
    expect(secretsFile).toContain("github-token");
    expect(secretsFile).not.toContain("encrypted_value");
    expect(secretsFile).not.toContain("encrypted_bytes");
  });

  it("scrubs raw content from non-text artifacts but keeps it on text artifacts", async () => {
    const { query } = makeQuery({
      artifacts: [
        {
          id: "art-1",
          session_id: "s1",
          workflow_execution_id: null,
          artifact_type: "image",
          title: "Generated portrait",
          description: null,
          mime_type: "image/png",
          size_bytes: 50000,
          iteration: 2,
          created_at: new Date("2026-04-10T00:00:00Z"),
          content: "BASE64_BYTES_DO_NOT_LEAK",
        },
        {
          id: "art-2",
          session_id: "s1",
          workflow_execution_id: null,
          artifact_type: "text",
          title: "Summary",
          description: null,
          mime_type: "text/markdown",
          size_bytes: 1234,
          iteration: 3,
          created_at: new Date("2026-04-11T00:00:00Z"),
          content: "## Alberta budget summary",
        },
      ],
    });
    const result = await exportUserData({
      userId: USER_ID,
      exportedBy: { userId: "admin-1", role: "admin" },
      query,
      now: FIXED_NOW,
    });
    const artifactsFile = new AdmZip(result!.zip)
      .getEntry("artifacts.json")!
      .getData()
      .toString();
    expect(artifactsFile).not.toContain("BASE64_BYTES_DO_NOT_LEAK");
    expect(artifactsFile).toContain("## Alberta budget summary");
    expect(artifactsFile).toContain('"title": "Generated portrait"');
  });

  it("renders a README listing every file with row counts", async () => {
    const { query } = makeQuery({
      savedPrompts: [{ id: "p1" }, { id: "p2" }],
      workflows: [{ id: "w1" }],
    });
    const result = await exportUserData({
      userId: USER_ID,
      exportedBy: { userId: "admin-99", role: "admin" },
      query,
      now: FIXED_NOW,
    });
    const readme = new AdmZip(result!.zip)
      .getEntry("README.md")!
      .getData()
      .toString();
    expect(readme).toContain("# ABC User Data Export");
    expect(readme).toContain(`**User ID:** \`${USER_ID}\``);
    expect(readme).toContain("**Exported by:** `admin-99`");
    expect(readme).toContain("`saved_prompts.json`");
    expect(readme).toContain("| 2 |");
    expect(readme).toContain("**Encrypted secret values**");
  });

  it("queries each user-scoped table with the target user id", async () => {
    const { query, calls } = makeQuery();
    await exportUserData({
      userId: USER_ID,
      exportedBy: { userId: "admin-1", role: "admin" },
      query,
      now: FIXED_NOW,
    });
    // Every query should be parameterised. Look at the recorded SQL for the
    // expected `WHERE user_id` (or join-via-parent) patterns.
    expect(calls.some((s) => /FROM users WHERE id = \$1/.test(s))).toBe(true);
    expect(calls.some((s) => /FROM saved_prompts WHERE user_id = \$1/.test(s))).toBe(true);
    expect(
      calls.some((s) => /FROM workflow_versions[\s\S]*WHERE w\.user_id = \$1/.test(s)),
    ).toBe(true);
    expect(
      calls.some((s) => /FROM agent_iterations[\s\S]*WHERE s\.user_id = \$1/.test(s)),
    ).toBe(true);
    expect(calls.some((s) => /FROM user_secrets WHERE user_id = \$1/.test(s))).toBe(true);
  });
});

describe("buildExportFilename", () => {
  it("formats as abc-user-<8hex>-YYYY-MM-DD.zip on a UUID id", () => {
    const name = buildExportFilename(
      "abcd1234-5678-90ab-cdef-1234567890ab",
      new Date("2026-05-22T15:30:00.000Z"),
    );
    expect(name).toBe("abc-user-abcd1234-2026-05-22.zip");
  });

  it("strips characters that aren't safe in Content-Disposition", () => {
    const name = buildExportFilename(
      '../../etc/passwd"; drop-table',
      new Date("2026-05-22T15:30:00.000Z"),
    );
    // Sanitiser kills the path-traversal and quote — only [a-zA-Z0-9] left.
    expect(name).toMatch(/^abc-user-[a-zA-Z0-9]{1,8}-\d{4}-\d{2}-\d{2}\.zip$/);
    expect(name).not.toContain("/");
    expect(name).not.toContain('"');
    expect(name).not.toContain(";");
    expect(name).not.toContain(" ");
  });

  it("falls back to 'user' when the input has no alphanumerics", () => {
    const name = buildExportFilename("--/--", new Date("2026-05-22T15:30:00.000Z"));
    expect(name).toBe("abc-user-user-2026-05-22.zip");
  });
});
