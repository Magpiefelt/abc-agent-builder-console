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
 */

import { Router, Request, Response } from "express";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { authenticate } from "../middleware/auth.js";
import { query, transaction } from "../config/database.js";
import { scanForPII } from "../services/piiDetector.js";
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

router.get("/library", (_req: Request, res: Response) => {
  res.json({
    agentTemplates: templates.templates,
    functionCatalog: getCatalog(),
    tools: toolsManifest.tools,
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

function piiBlockResponse(res: Response, scan: ReturnType<typeof scanForPII>): void {
  res.status(422).json({
    error: "Workflow content contains blocked data (potential PII or secrets).",
    detections: scan.detections
      .filter((d) => d.action === "blocked")
      .map((d) => ({ type: d.type, description: d.pattern })),
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

  const scan = scanForPII(JSON.stringify(canvas));
  if (scan.blockedCount > 0) {
    return piiBlockResponse(res, scan);
  }

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
      details: { name: name.trim(), classification: resolvedClassification },
    });

    const row = await query(
      `SELECT id, user_id, ministry_code, name, description, classification, canvas_data, is_template, version, created_at, updated_at
       FROM workflows WHERE id = $1`,
      [result]
    );
    res.status(201).json(row.rows[0]);
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

    // PII scan if canvasData supplied
    let versionBumped = false;
    if (canvasData !== undefined) {
      const scan = scanForPII(JSON.stringify(canvasData));
      if (scan.blockedCount > 0) {
        return piiBlockResponse(res, scan);
      }
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
      details: { versionBumped, newVersion: versionBumped ? wf.version + 1 : wf.version },
    });

    const refreshed = await query(
      `SELECT id, user_id, ministry_code, name, description, classification, canvas_data, is_template, version, created_at, updated_at
       FROM workflows WHERE id = $1`,
      [workflowId]
    );
    res.json(refreshed.rows[0]);
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
  if (!isProviderConfigured()) {
    res.status(503).json({ error: "LLM provider not configured." });
    return;
  }

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
      [req.params.id]
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

    // PII scan before streaming
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

    // Disconnect → abort
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
    });
  } catch (err) {
    logger.error("Failed to execute workflow", err, { id: req.params.id });
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

export default router;
