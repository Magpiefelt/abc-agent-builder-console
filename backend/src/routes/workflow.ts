/**
 * Workflow Routes (Stream C)
 *
 * CRUD + execute for workflow canvases. Ministry-scoped on every read/write.
 * PII scan on save and on execute. workflow_versions snapshot inserted on
 * every canvas_data change.
 *
 * Routes:
 *   POST   /api/workflows          create
 *   GET    /api/workflows          list (ministry-scoped)
 *   GET    /api/workflows/library  aggregate library (templates, functions, tools)
 *   GET    /api/workflows/:id      load
 *   PUT    /api/workflows/:id      update (bump version only on canvas_data change)
 *   DELETE /api/workflows/:id      hard delete (CASCADE)
 *   POST   /api/workflows/:id/execute  SSE stream of stage progress
 *
 *   GET    /api/workflows/:id/versions                       list version history
 *   GET    /api/workflows/:id/versions/:version              load a specific version's canvas
 *   POST   /api/workflows/:id/versions/:version/restore      copy a past version into current
 *
 *   GET    /api/workflows/:id/executions                     list past executions (paginated)
 *   GET    /api/workflows/:id/executions/:executionId        load a single execution
 */

import { Router, Request, Response } from "express";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { authenticate } from "../middleware/auth.js";
import { query, transaction } from "../config/database.js";
import { scanForPII } from "../services/piiDetector.js";
import type { PIIScanResult } from "../services/piiDetector.js";
import { logAudit, AuditAction } from "../services/auditLogger.js";
import { logger } from "../services/logger.js";
import { isProviderConfigured } from "../services/llmProvider.js";
import { runWorkflow, abortExecution, type CanvasData, type WorkflowRecord } from "../services/workflowExecutor.js";
import { getCatalog } from "../services/functionRegistry.js";

const router: Router = Router();
router.use(authenticate);

// ============================================================================
// LIBRARY ENDPOINT
// ============================================================================

const __dirname = dirname(fileURLToPath(import.meta.url));
const templates = JSON.parse(
  readFileSync(resolve(__dirname, "../data/agentTemplates.json"), "utf-8")
);
const toolsManifest = JSON.parse(
  readFileSync(resolve(__dirname, "../data/toolsManifest.json"), "utf-8")
);

/**
 * Memory tools that read/write the agent-session-scoped blackboard,
 * scratchpad, or attributes do not work in a workflow context — the executor
 * runs each stage with empty memory and discards mutations. Only
 * create_artifact persists meaningfully (via workflow_execution_id).
 */
const WORKFLOW_INCOMPATIBLE_TOOLS = new Set([
  "read_blackboard",
  "write_blackboard",
  "read_scratchpad",
  "write_scratchpad",
  "read_attributes",
  "write_attribute",
]);

router.get("/library", (_req: Request, res: Response) => {
  interface ToolEntry { name: string; category: string }
  const tools = (toolsManifest.tools as ToolEntry[]).filter(
    (t) => !WORKFLOW_INCOMPATIBLE_TOOLS.has(t.name)
  );
  res.json({
    agentTemplates: templates.templates,
    functionCatalog: getCatalog(),
    tools,
  });
});

// ============================================================================
// HELPERS
// ============================================================================

type Classification = "unclassified" | "protected_a" | "protected_b";

function isValidClassification(v: unknown): v is Classification {
  return v === "unclassified" || v === "protected_a" || v === "protected_b";
}

function isValidCanvasData(v: unknown): v is CanvasData {
  if (!v || typeof v !== "object") return false;
  const c = v as Record<string, unknown>;
  if (c.version !== 1) return false;
  if (!Array.isArray(c.nodes)) return false;
  if (!Array.isArray(c.edges)) return false;
  return true;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + stableStringify((value as Record<string, unknown>)[k]))
      .join(",") +
    "}"
  );
}

function hashCanvas(canvas: unknown): string {
  return createHash("sha256").update(stableStringify(canvas)).digest("hex");
}

/**
 * Returns the workflow row when the caller has read access (owner or same
 * ministry), or null if the workflow doesn't exist. Throws on infrastructure
 * errors. Callers handle the response when null is returned.
 */
async function loadWorkflowForRead(
  workflowId: string,
  userId: string,
  ministryCode: string | null,
): Promise<{ user_id: string; ministry_code: string | null; access: "owner" | "ministry" } | null> {
  const result = await query<{ user_id: string; ministry_code: string | null }>(
    `SELECT user_id, ministry_code FROM workflows WHERE id = $1`,
    [workflowId],
  );
  if (result.rowCount === 0) return null;
  const wf = result.rows[0];
  const isOwner = wf.user_id === userId;
  const sameMinistry =
    wf.ministry_code !== null && ministryCode !== null && wf.ministry_code === ministryCode;
  if (!isOwner && !sameMinistry) return null;
  return { ...wf, access: isOwner ? "owner" : "ministry" };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function piiBlockResponse(res: Response, scan: PIIScanResult): void {
  res.status(422).json({
    error: "Workflow content contains blocked data (potential PII or secrets).",
    detections: scan.detections
      .filter((d) => d.action === "blocked")
      .map((d) => ({ type: d.type, description: d.pattern })),
  });
}

/**
 * On save we audit PII detections but allow the write through. The user is
 * still drafting — Note nodes may legitimately discuss PII categories. The
 * execute endpoint blocks on the same scan so unsanitized workflows can't
 * actually run.
 */
async function auditPIIOnSave(
  scan: PIIScanResult,
  userId: string,
  ministryCode: string | undefined,
  resourceId: string | undefined,
  action: 'created' | 'updated'
): Promise<void> {
  if (scan.clean) return;
  await logAudit({
    userId,
    ministryCode,
    action: AuditAction.PII_DETECTED_OUTBOUND,
    resourceType: "workflow",
    resourceId,
    details: {
      stage: action,
      blockedCount: scan.blockedCount,
      detections: scan.detections.map((d) => ({ type: d.type, action: d.action })),
    },
  });
}

// ============================================================================
// CREATE
// ============================================================================

router.post("/", async (req: Request, res: Response) => {
  const { name, description, classification, canvasData } = req.body ?? {};

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    res.status(400).json({ error: "Workflow name is required." });
    return;
  }
  if (name.length > 200) {
    res.status(400).json({ error: "Workflow name must be 200 characters or less." });
    return;
  }
  const resolvedClassification: Classification = isValidClassification(classification)
    ? classification
    : "unclassified";
  if (canvasData !== undefined && !isValidCanvasData(canvasData)) {
    res.status(400).json({ error: "Invalid canvasData. Expected { nodes, edges, version: 1 }." });
    return;
  }

  const canvas: CanvasData = canvasData ?? { nodes: [], edges: [], version: 1 };

  // Save-time PII scan: audit but don't block. Execute will refuse to run
  // workflows that still contain blocked PII patterns.
  const scan = scanForPII(JSON.stringify(canvas));

  try {
    const result = await transaction(async (client) => {
      const insertRes = await client.query<{ id: string }>(
        `INSERT INTO workflows (user_id, ministry_code, name, description, classification, canvas_data, version)
         VALUES ($1, $2, $3, $4, $5, $6, 1)
         RETURNING id`,
        [
          req.user!.id,
          req.user!.ministryCode,
          name.trim(),
          description ?? null,
          resolvedClassification,
          JSON.stringify(canvas),
        ]
      );
      const workflowId = insertRes.rows[0].id;
      await client.query(
        `INSERT INTO workflow_versions (workflow_id, version, canvas_data, created_by)
         VALUES ($1, 1, $2, $3)`,
        [workflowId, JSON.stringify(canvas), req.user!.id]
      );
      return workflowId;
    });

    await logAudit({
      userId: req.user!.id,
      ministryCode: req.user!.ministryCode || undefined,
      action: AuditAction.WORKFLOW_CREATED,
      resourceType: "workflow",
      resourceId: result,
      details: { name: name.trim(), classification: resolvedClassification, piiBlockedOnSave: scan.blockedCount },
    });
    await auditPIIOnSave(scan, req.user!.id, req.user!.ministryCode || undefined, result, 'created');

    const row = await query(
      `SELECT id, user_id, ministry_code, name, description, classification, canvas_data, is_template, version, created_at, updated_at
       FROM workflows WHERE id = $1`,
      [result]
    );
    res.status(201).json({
      ...row.rows[0],
      piiWarning: scan.blockedCount > 0 ? { blockedCount: scan.blockedCount, message: 'Workflow saved but contains blocked PII patterns. It cannot be executed until they are removed.' } : undefined,
    });
  } catch (err) {
    logger.error("Failed to create workflow", err, { userId: req.user!.id });
    res.status(500).json({ error: "Failed to create workflow." });
  }
});

// ============================================================================
// LIST (ministry-scoped)
// ============================================================================

router.get("/", async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT id, user_id, ministry_code, name, description, classification, is_template, version, created_at, updated_at
       FROM workflows
       WHERE ($1::text IS NULL AND user_id = $2) OR ministry_code = $1
       ORDER BY updated_at DESC
       LIMIT 500`,
      [req.user!.ministryCode, req.user!.id]
    );
    res.json({ workflows: result.rows });
  } catch (err) {
    logger.error("Failed to list workflows", err, { userId: req.user!.id });
    res.status(500).json({ error: "Failed to list workflows." });
  }
});

// ============================================================================
// LOAD (ministry-scoped)
// ============================================================================

router.get("/:id", async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT id, user_id, ministry_code, name, description, classification, canvas_data, is_template, version, created_at, updated_at
       FROM workflows WHERE id = $1`,
      [req.params.id]
    );
    if (result.rowCount === 0) {
      res.status(404).json({ error: "Workflow not found." });
      return;
    }
    const wf = result.rows[0] as { user_id: string; ministry_code: string | null };
    const isOwner = wf.user_id === req.user!.id;
    const sameMinistry =
      wf.ministry_code !== null &&
      req.user!.ministryCode !== null &&
      wf.ministry_code === req.user!.ministryCode;
    if (!isOwner && !sameMinistry) {
      res.status(403).json({ error: "Access denied." });
      return;
    }
    res.json(result.rows[0]);
  } catch (err) {
    logger.error("Failed to load workflow", err, { id: req.params.id });
    res.status(500).json({ error: "Failed to load workflow." });
  }
});

// ============================================================================
// UPDATE (bump version only on canvas_data change)
// ============================================================================

router.put("/:id", async (req: Request, res: Response) => {
  const workflowId = req.params.id as string;
  const { name, description, classification, canvasData } = req.body ?? {};

  if (classification !== undefined && !isValidClassification(classification)) {
    res.status(400).json({ error: "Invalid classification." });
    return;
  }
  if (canvasData !== undefined && !isValidCanvasData(canvasData)) {
    res.status(400).json({ error: "Invalid canvasData." });
    return;
  }

  try {
    // Load existing
    const existing = await query<{
      user_id: string;
      ministry_code: string | null;
      version: number;
      canvas_data: CanvasData;
    }>(
      `SELECT user_id, ministry_code, version, canvas_data FROM workflows WHERE id = $1`,
      [workflowId]
    );
    if (existing.rowCount === 0) {
      res.status(404).json({ error: "Workflow not found." });
      return;
    }
    const wf = existing.rows[0];
    const isOwner = wf.user_id === req.user!.id;
    const sameMinistry =
      wf.ministry_code !== null &&
      req.user!.ministryCode !== null &&
      wf.ministry_code === req.user!.ministryCode;
    if (!isOwner && !sameMinistry) {
      res.status(403).json({ error: "Access denied." });
      return;
    }

    // PII scan if canvasData supplied. Save-time audits but doesn't block.
    let versionBumped = false;
    let saveScan: PIIScanResult | null = null;
    if (canvasData !== undefined) {
      saveScan = scanForPII(JSON.stringify(canvasData));
      versionBumped = hashCanvas(canvasData) !== hashCanvas(wf.canvas_data);
    }

    await transaction(async (client) => {
      // Build SET clause dynamically
      const sets: string[] = [];
      const values: unknown[] = [];
      let idx = 1;
      if (name !== undefined) {
        sets.push(`name = $${idx++}`);
        values.push(String(name).trim());
      }
      if (description !== undefined) {
        sets.push(`description = $${idx++}`);
        values.push(description);
      }
      if (classification !== undefined) {
        sets.push(`classification = $${idx++}`);
        values.push(classification);
      }
      if (canvasData !== undefined) {
        sets.push(`canvas_data = $${idx++}`);
        values.push(JSON.stringify(canvasData));
        if (versionBumped) {
          sets.push(`version = $${idx++}`);
          values.push(wf.version + 1);
        }
      }
      if (sets.length === 0) return;
      values.push(workflowId);
      await client.query(
        `UPDATE workflows SET ${sets.join(", ")} WHERE id = $${idx}`,
        values
      );

      if (versionBumped && canvasData !== undefined) {
        await client.query(
          `INSERT INTO workflow_versions (workflow_id, version, canvas_data, created_by)
           VALUES ($1, $2, $3, $4)`,
          [workflowId, wf.version + 1, JSON.stringify(canvasData), req.user!.id]
        );
      }
    });

    await logAudit({
      userId: req.user!.id,
      ministryCode: req.user!.ministryCode || undefined,
      action: AuditAction.WORKFLOW_UPDATED,
      resourceType: "workflow",
      resourceId: workflowId,
      details: { versionBumped, newVersion: versionBumped ? wf.version + 1 : wf.version, piiBlockedOnSave: saveScan?.blockedCount ?? 0 },
    });
    if (saveScan) {
      await auditPIIOnSave(saveScan, req.user!.id, req.user!.ministryCode || undefined, workflowId, 'updated');
    }

    const refreshed = await query(
      `SELECT id, user_id, ministry_code, name, description, classification, canvas_data, is_template, version, created_at, updated_at
       FROM workflows WHERE id = $1`,
      [workflowId]
    );
    res.json({
      ...refreshed.rows[0],
      piiWarning: saveScan && saveScan.blockedCount > 0
        ? { blockedCount: saveScan.blockedCount, message: 'Workflow saved but contains blocked PII patterns. It cannot be executed until they are removed.' }
        : undefined,
    });
  } catch (err) {
    logger.error("Failed to update workflow", err, { id: workflowId });
    res.status(500).json({ error: "Failed to update workflow." });
  }
});

// ============================================================================
// DELETE
// ============================================================================

router.delete("/:id", async (req: Request, res: Response) => {
  const workflowId = req.params.id as string;
  try {
    const existing = await query<{ user_id: string; ministry_code: string | null }>(
      `SELECT user_id, ministry_code FROM workflows WHERE id = $1`,
      [workflowId]
    );
    if (existing.rowCount === 0) {
      res.status(404).json({ error: "Workflow not found." });
      return;
    }
    const wf = existing.rows[0];
    const isOwner = wf.user_id === req.user!.id;
    if (!isOwner && req.user!.role !== "admin") {
      res.status(403).json({ error: "Only the owner can delete this workflow." });
      return;
    }

    await query(`DELETE FROM workflows WHERE id = $1`, [workflowId]);

    await logAudit({
      userId: req.user!.id,
      ministryCode: req.user!.ministryCode || undefined,
      action: AuditAction.WORKFLOW_DELETED,
      resourceType: "workflow",
      resourceId: workflowId,
    });

    res.json({ id: workflowId, deleted: true });
  } catch (err) {
    logger.error("Failed to delete workflow", err, { id: workflowId });
    res.status(500).json({ error: "Failed to delete workflow." });
  }
});

// ============================================================================
// EXECUTE (SSE)
// ============================================================================

router.post("/:id/execute", async (req: Request, res: Response) => {
  const workflowId = req.params.id as string;
  const { continueOnError } = req.body ?? {};

  try {
    const result = await query<{
      id: string;
      user_id: string;
      ministry_code: string | null;
      name: string;
      classification: Classification;
      canvas_data: CanvasData;
      version: number;
    }>(
      `SELECT id, user_id, ministry_code, name, classification, canvas_data, version
       FROM workflows WHERE id = $1`,
      [workflowId]
    );
    if (result.rowCount === 0) {
      res.status(404).json({ error: "Workflow not found." });
      return;
    }
    const wf = result.rows[0];
    const isOwner = wf.user_id === req.user!.id;
    const sameMinistry =
      wf.ministry_code !== null &&
      req.user!.ministryCode !== null &&
      wf.ministry_code === req.user!.ministryCode;
    if (!isOwner && !sameMinistry) {
      res.status(403).json({ error: "Access denied." });
      return;
    }

    // LLM provider only required when the canvas contains agent nodes.
    const hasAgentNodes =
      Array.isArray(wf.canvas_data?.nodes) &&
      wf.canvas_data.nodes.some((n) => n.data?.kind === "agent");
    if (hasAgentNodes && !isProviderConfigured()) {
      res.status(503).json({ error: "LLM provider not configured. This workflow contains agent nodes." });
      return;
    }

    // PII scan before streaming (blocks at execute time)
    const scan = scanForPII(JSON.stringify(wf.canvas_data));
    if (scan.blockedCount > 0) {
      return piiBlockResponse(res, scan);
    }

    // SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    // Disconnect → abort. The executor calls back with the executionId
    // once it has persisted the workflow_executions row.
    let executionId: string | null = null;
    req.on("close", () => {
      if (executionId) abortExecution(executionId);
    });

    const record: WorkflowRecord = {
      id: wf.id,
      user_id: wf.user_id,
      ministry_code: wf.ministry_code,
      name: wf.name,
      classification: wf.classification,
      canvas_data: wf.canvas_data,
      version: wf.version,
    };

    await runWorkflow(record, res, {
      userId: req.user!.id,
      ministryCode: req.user!.ministryCode,
      continueOnError: !!continueOnError,
      onExecutionCreated: (id) => {
        executionId = id;
      },
    });
  } catch (err) {
    logger.error("Failed to execute workflow", err, { id: workflowId });
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to execute workflow." });
    } else {
      try {
        res.write(`data: ${JSON.stringify({ type: "error", error: "Internal error" })}\n\n`);
        res.end();
      } catch {
        /* ignore */
      }
    }
  }
});

// ============================================================================
// VERSIONS
// ============================================================================

/**
 * GET /:id/versions
 *
 * Lists the workflow's version history (newest first). canvas_data is omitted
 * to keep the payload small — clients can pull a specific version via
 * /:id/versions/:version. The current workflow.version is included so the UI
 * can flag which row is live.
 */
router.get("/:id/versions", async (req: Request, res: Response) => {
  const workflowId = req.params.id as string;
  if (!UUID_RE.test(workflowId)) {
    res.status(400).json({ error: "Invalid workflow id." });
    return;
  }
  try {
    const wf = await loadWorkflowForRead(workflowId, req.user!.id, req.user!.ministryCode);
    if (!wf) {
      res.status(404).json({ error: "Workflow not found." });
      return;
    }
    const current = await query<{ version: number }>(
      `SELECT version FROM workflows WHERE id = $1`,
      [workflowId],
    );
    const versions = await query<{
      version: number;
      created_by: string;
      created_at: Date;
      created_by_email: string | null;
      created_by_display_name: string | null;
    }>(
      `SELECT v.version, v.created_by, v.created_at,
              u.email AS created_by_email,
              u.display_name AS created_by_display_name
       FROM workflow_versions v
       LEFT JOIN users u ON u.id = v.created_by
       WHERE v.workflow_id = $1
       ORDER BY v.version DESC
       LIMIT 100`,
      [workflowId],
    );
    res.json({
      currentVersion: current.rows[0]?.version ?? null,
      versions: versions.rows.map((r) => ({
        version: r.version,
        createdBy: r.created_by,
        createdByEmail: r.created_by_email,
        createdByDisplayName: r.created_by_display_name,
        createdAt: r.created_at,
      })),
    });
  } catch (err) {
    logger.error("Failed to list workflow versions", err, { id: workflowId });
    res.status(500).json({ error: "Failed to list workflow versions." });
  }
});

/**
 * GET /:id/versions/:version
 *
 * Returns the canvas_data for a specific historical version so the UI can
 * preview or diff it before restoring.
 */
router.get("/:id/versions/:version", async (req: Request, res: Response) => {
  const workflowId = req.params.id as string;
  const versionParam = req.params.version as string;
  if (!UUID_RE.test(workflowId)) {
    res.status(400).json({ error: "Invalid workflow id." });
    return;
  }
  const version = Number.parseInt(versionParam, 10);
  if (!Number.isInteger(version) || version <= 0) {
    res.status(400).json({ error: "Version must be a positive integer." });
    return;
  }
  try {
    const wf = await loadWorkflowForRead(workflowId, req.user!.id, req.user!.ministryCode);
    if (!wf) {
      res.status(404).json({ error: "Workflow not found." });
      return;
    }
    const result = await query<{
      version: number;
      canvas_data: CanvasData;
      created_by: string;
      created_at: Date;
    }>(
      `SELECT version, canvas_data, created_by, created_at
       FROM workflow_versions
       WHERE workflow_id = $1 AND version = $2`,
      [workflowId, version],
    );
    if (result.rowCount === 0) {
      res.status(404).json({ error: "Version not found." });
      return;
    }
    const row = result.rows[0];
    res.json({
      workflowId,
      version: row.version,
      canvasData: row.canvas_data,
      createdBy: row.created_by,
      createdAt: row.created_at,
    });
  } catch (err) {
    logger.error("Failed to load workflow version", err, { id: workflowId, version });
    res.status(500).json({ error: "Failed to load workflow version." });
  }
});

/**
 * POST /:id/versions/:version/restore
 *
 * Copies the canvas_data from a historical version into the live workflow row
 * and bumps the version forward (never overwrites an existing version row).
 * The new snapshot is recorded in workflow_versions so the restore itself is
 * visible in history.
 */
router.post("/:id/versions/:version/restore", async (req: Request, res: Response) => {
  const workflowId = req.params.id as string;
  const versionParam = req.params.version as string;
  if (!UUID_RE.test(workflowId)) {
    res.status(400).json({ error: "Invalid workflow id." });
    return;
  }
  const version = Number.parseInt(versionParam, 10);
  if (!Number.isInteger(version) || version <= 0) {
    res.status(400).json({ error: "Version must be a positive integer." });
    return;
  }
  try {
    const wf = await loadWorkflowForRead(workflowId, req.user!.id, req.user!.ministryCode);
    if (!wf) {
      res.status(404).json({ error: "Workflow not found." });
      return;
    }

    const newVersion = await transaction(async (client) => {
      const target = await client.query<{ canvas_data: CanvasData }>(
        `SELECT canvas_data FROM workflow_versions
         WHERE workflow_id = $1 AND version = $2`,
        [workflowId, version],
      );
      if (target.rowCount === 0) {
        return null;
      }
      const current = await client.query<{ version: number }>(
        `SELECT version FROM workflows WHERE id = $1 FOR UPDATE`,
        [workflowId],
      );
      const next = (current.rows[0]?.version ?? 0) + 1;
      const canvas = target.rows[0].canvas_data;
      await client.query(
        `UPDATE workflows SET canvas_data = $1, version = $2 WHERE id = $3`,
        [JSON.stringify(canvas), next, workflowId],
      );
      await client.query(
        `INSERT INTO workflow_versions (workflow_id, version, canvas_data, created_by)
         VALUES ($1, $2, $3, $4)`,
        [workflowId, next, JSON.stringify(canvas), req.user!.id],
      );
      return next;
    });

    if (newVersion === null) {
      res.status(404).json({ error: "Version not found." });
      return;
    }

    await logAudit({
      userId: req.user!.id,
      ministryCode: req.user!.ministryCode || undefined,
      action: AuditAction.WORKFLOW_UPDATED,
      resourceType: "workflow",
      resourceId: workflowId,
      details: { restoredFromVersion: version, newVersion },
    });

    const refreshed = await query(
      `SELECT id, user_id, ministry_code, name, description, classification, canvas_data, is_template, version, created_at, updated_at
       FROM workflows WHERE id = $1`,
      [workflowId],
    );
    res.json({ ...refreshed.rows[0], restoredFromVersion: version });
  } catch (err) {
    logger.error("Failed to restore workflow version", err, { id: workflowId, version });
    res.status(500).json({ error: "Failed to restore workflow version." });
  }
});

// ============================================================================
// EXECUTIONS
// ============================================================================

/**
 * GET /:id/executions
 *
 * Lists past executions for a workflow (newest first). stage_results is
 * omitted to keep the payload bounded; callers fetch detail via
 * /:id/executions/:executionId. Query params:
 *   - status: filter by execution status
 *   - limit:  1-100, default 50
 */
router.get("/:id/executions", async (req: Request, res: Response) => {
  const workflowId = req.params.id as string;
  if (!UUID_RE.test(workflowId)) {
    res.status(400).json({ error: "Invalid workflow id." });
    return;
  }

  const allowedStatuses = new Set(["running", "completed", "error", "aborted"]);
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  if (status !== undefined && !allowedStatuses.has(status)) {
    res.status(400).json({
      error: `status must be one of: ${[...allowedStatuses].join(", ")}`,
    });
    return;
  }

  const rawLimit = Number.parseInt(String(req.query.limit ?? "50"), 10);
  const limit = Number.isInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 50;

  try {
    const wf = await loadWorkflowForRead(workflowId, req.user!.id, req.user!.ministryCode);
    if (!wf) {
      res.status(404).json({ error: "Workflow not found." });
      return;
    }

    const params: unknown[] = [workflowId];
    let statusClause = "";
    if (status) {
      params.push(status);
      statusClause = `AND status = $${params.length}`;
    }
    params.push(limit);

    const result = await query<{
      id: string;
      workflow_id: string;
      user_id: string;
      classification: string;
      status: string;
      error: string | null;
      started_at: Date;
      completed_at: Date | null;
      stage_count: string;
      user_email: string | null;
      user_display_name: string | null;
    }>(
      `SELECT e.id, e.workflow_id, e.user_id, e.classification, e.status, e.error,
              e.started_at, e.completed_at,
              jsonb_array_length(e.stage_results) AS stage_count,
              u.email AS user_email, u.display_name AS user_display_name
       FROM workflow_executions e
       LEFT JOIN users u ON u.id = e.user_id
       WHERE e.workflow_id = $1 ${statusClause}
       ORDER BY e.started_at DESC
       LIMIT $${params.length}`,
      params,
    );

    res.json({
      executions: result.rows.map((r) => ({
        id: r.id,
        workflowId: r.workflow_id,
        userId: r.user_id,
        userEmail: r.user_email,
        userDisplayName: r.user_display_name,
        classification: r.classification,
        status: r.status,
        error: r.error,
        stageCount: Number.parseInt(r.stage_count, 10),
        durationMs:
          r.completed_at && r.started_at
            ? new Date(r.completed_at).getTime() - new Date(r.started_at).getTime()
            : null,
        startedAt: r.started_at,
        completedAt: r.completed_at,
      })),
      count: result.rowCount,
    });
  } catch (err) {
    logger.error("Failed to list workflow executions", err, { id: workflowId });
    res.status(500).json({ error: "Failed to list workflow executions." });
  }
});

/**
 * GET /:id/executions/:executionId
 *
 * Returns a single execution with full stage_results JSON. Scoped to the
 * parent workflow so a leaked execution id can't be queried in isolation
 * against a workflow the user can't see.
 */
router.get("/:id/executions/:executionId", async (req: Request, res: Response) => {
  const workflowId = req.params.id as string;
  const executionId = req.params.executionId as string;
  if (!UUID_RE.test(workflowId) || !UUID_RE.test(executionId)) {
    res.status(400).json({ error: "Invalid id." });
    return;
  }
  try {
    const wf = await loadWorkflowForRead(workflowId, req.user!.id, req.user!.ministryCode);
    if (!wf) {
      res.status(404).json({ error: "Workflow not found." });
      return;
    }
    const result = await query<{
      id: string;
      workflow_id: string;
      user_id: string;
      classification: string;
      status: string;
      stage_results: unknown;
      error: string | null;
      started_at: Date;
      completed_at: Date | null;
      user_email: string | null;
      user_display_name: string | null;
    }>(
      `SELECT e.id, e.workflow_id, e.user_id, e.classification, e.status,
              e.stage_results, e.error, e.started_at, e.completed_at,
              u.email AS user_email, u.display_name AS user_display_name
       FROM workflow_executions e
       LEFT JOIN users u ON u.id = e.user_id
       WHERE e.id = $1 AND e.workflow_id = $2`,
      [executionId, workflowId],
    );
    if (result.rowCount === 0) {
      res.status(404).json({ error: "Execution not found." });
      return;
    }
    const row = result.rows[0];
    res.json({
      id: row.id,
      workflowId: row.workflow_id,
      userId: row.user_id,
      userEmail: row.user_email,
      userDisplayName: row.user_display_name,
      classification: row.classification,
      status: row.status,
      stageResults: row.stage_results,
      error: row.error,
      durationMs:
        row.completed_at && row.started_at
          ? new Date(row.completed_at).getTime() - new Date(row.started_at).getTime()
          : null,
      startedAt: row.started_at,
      completedAt: row.completed_at,
    });
  } catch (err) {
    logger.error("Failed to load workflow execution", err, {
      id: workflowId,
      executionId,
    });
    res.status(500).json({ error: "Failed to load workflow execution." });
  }
});

export default router;
