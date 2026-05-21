/**
 * Admin Routes — observability + governance UI backend.
 *
 * All routes here require:
 *   1. `authenticate` — valid Entra ID JWT (dev: mock user)
 *   2. `requireRole('admin')` — user.role === 'admin'
 *   3. `auditAdminAccess` — every admin call writes an ADMIN_ACCESS entry
 *
 * Endpoints:
 *   GET  /api/admin/audit?action=&user_id=&from=&to=&limit=
 *   GET  /api/admin/pii-detections
 *   GET  /api/admin/models
 *   PUT  /api/admin/models/:id              { is_active: boolean }
 *   GET  /api/admin/sessions?status=&limit=
 *   POST /api/admin/retention/run
 *
 * Note: detailed health diagnostics live at GET /api/health/detailed
 * (also admin-gated) to keep operational observability in one place.
 */

import express, { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { authenticate, requireRole } from "../middleware/auth.js";
import { query } from "../config/database.js";
import {
  auditAction,
  AuditAction,
} from "../services/auditLogger.js";
import { logger } from "../services/logger.js";
import { clearModelCache } from "../services/llmProvider.js";
import { runRetentionPass } from "../services/retentionJob.js";

const router: express.Router = Router();

// ============================================================================
// MIDDLEWARE
// ============================================================================

function auditAdminAccess(req: Request, _res: Response, next: NextFunction): void {
  if (req.user) {
    auditAction(req.user.id, AuditAction.ADMIN_ACCESS, "admin_route", req.path, {
      method: req.method,
      ministryCode: req.user.ministryCode,
    });
  }
  next();
}

router.use(authenticate, requireRole("admin"), auditAdminAccess);

// ============================================================================
// AUDIT LOG
// ============================================================================

const auditQuerySchema = z.object({
  action: z.string().min(1).max(100).optional(),
  user_id: z.string().min(1).max(100).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

router.get("/audit", async (req: Request, res: Response) => {
  const parsed = auditQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query parameters", details: parsed.error.flatten().fieldErrors });
    return;
  }

  const { action, user_id, from, to, limit } = parsed.data;
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (action) {
    params.push(action);
    conditions.push(`action = $${params.length}`);
  }
  if (user_id) {
    params.push(user_id);
    conditions.push(`user_id = $${params.length}`);
  }
  if (from) {
    params.push(from);
    conditions.push(`created_at >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    conditions.push(`created_at <= $${params.length}`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(limit);

  try {
    const result = await query(
      `SELECT id, user_id, ministry_code, action, resource_type, resource_id,
              details, ip_address, created_at
       FROM audit_log
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
      params
    );
    res.json({ entries: result.rows, count: result.rowCount });
  } catch (err) {
    logger.error("Failed to query audit log", err as Error);
    res.status(500).json({ error: "Failed to query audit log." });
  }
});

// ============================================================================
// PII DETECTIONS
// ============================================================================

router.get("/pii-detections", async (req: Request, res: Response) => {
  const limit = Math.min(parseInt((req.query.limit as string) || "200"), 500);

  try {
    const result = await query(
      `SELECT p.id, p.user_id, p.session_id, p.detection_type, p.pattern_matched,
              p.action_taken, p.context_snippet, p.created_at,
              u.email AS user_email, u.display_name AS user_display_name
       FROM pii_detections p
       LEFT JOIN users u ON u.id = p.user_id
       ORDER BY p.created_at DESC
       LIMIT $1`,
      [limit]
    );

    if (req.user) {
      auditAction(req.user.id, AuditAction.ADMIN_PII_VIEWED, "pii_detections", undefined, {
        rowsReturned: result.rowCount,
      });
    }

    res.json({ detections: result.rows, count: result.rowCount });
  } catch (err) {
    logger.error("Failed to query PII detections", err as Error);
    res.status(500).json({ error: "Failed to query PII detections." });
  }
});

// ============================================================================
// MODEL REGISTRY
// ============================================================================

router.get("/models", async (_req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT id, model_id, display_name, provider, api_model_name,
              max_output_tokens, supports_streaming, supports_tools,
              data_residency, max_classification, is_active, created_at
       FROM model_registry
       ORDER BY is_active DESC, display_name ASC`
    );
    res.json({ models: result.rows, count: result.rowCount });
  } catch (err) {
    logger.error("Failed to query model registry", err as Error);
    res.status(500).json({ error: "Failed to query model registry." });
  }
});

const modelUpdateSchema = z.object({
  is_active: z.boolean(),
});

router.put("/models/:id", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Model id must be a positive integer." });
    return;
  }

  const parsed = modelUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten().fieldErrors });
    return;
  }

  try {
    const result = await query(
      `UPDATE model_registry
       SET is_active = $1
       WHERE id = $2
       RETURNING id, model_id, display_name, is_active`,
      [parsed.data.is_active, id]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: "Model not found." });
      return;
    }

    clearModelCache();

    auditAction(req.user!.id, AuditAction.ADMIN_MODEL_UPDATED, "model_registry", String(id), {
      is_active: parsed.data.is_active,
      model: result.rows[0],
    });

    res.json({ model: result.rows[0] });
  } catch (err) {
    logger.error("Failed to update model registry", err as Error);
    res.status(500).json({ error: "Failed to update model." });
  }
});

// ============================================================================
// SESSIONS
// ============================================================================

const sessionQuerySchema = z.object({
  status: z.enum(["idle", "running", "paused", "completed", "error", "needs_assistance"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

router.get("/sessions", async (req: Request, res: Response) => {
  const parsed = sessionQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query parameters", details: parsed.error.flatten().fieldErrors });
    return;
  }

  const { status, limit } = parsed.data;
  const params: unknown[] = [];
  let whereClause = "";

  if (status) {
    params.push(status);
    whereClause = `WHERE s.status = $${params.length}`;
  }
  params.push(limit);

  try {
    const result = await query(
      `SELECT s.id, s.status, s.model_id, s.classification, s.current_iteration,
              s.max_iterations, s.user_id, s.ministry_code, s.error,
              s.created_at, s.updated_at, s.completed_at,
              u.email AS user_email, u.display_name AS user_display_name
       FROM agent_sessions s
       LEFT JOIN users u ON u.id = s.user_id
       ${whereClause}
       ORDER BY s.created_at DESC
       LIMIT $${params.length}`,
      params
    );

    if (req.user) {
      auditAction(req.user.id, AuditAction.ADMIN_SESSION_VIEWED, "agent_sessions", undefined, {
        rowsReturned: result.rowCount,
        filterStatus: status,
      });
    }

    res.json({ sessions: result.rows, count: result.rowCount });
  } catch (err) {
    logger.error("Failed to query agent sessions", err as Error);
    res.status(500).json({ error: "Failed to query agent sessions." });
  }
});

// ============================================================================
// WORKFLOW EXECUTIONS (cross-system)
// ============================================================================

const workflowExecQuerySchema = z.object({
  status: z.enum(["running", "completed", "error", "aborted"]).optional(),
  workflow_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

router.get("/workflow-executions", async (req: Request, res: Response) => {
  const parsed = workflowExecQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query parameters", details: parsed.error.flatten().fieldErrors });
    return;
  }

  const { status, workflow_id, limit } = parsed.data;
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (status) {
    params.push(status);
    conditions.push(`e.status = $${params.length}`);
  }
  if (workflow_id) {
    params.push(workflow_id);
    conditions.push(`e.workflow_id = $${params.length}`);
  }
  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(limit);

  try {
    const result = await query(
      `SELECT e.id, e.workflow_id, w.name AS workflow_name, e.user_id,
              u.email AS user_email, u.display_name AS user_display_name,
              w.ministry_code, e.classification, e.status, e.error,
              e.started_at, e.completed_at
         FROM workflow_executions e
         JOIN workflows w ON w.id = e.workflow_id
         LEFT JOIN users u ON u.id = e.user_id
         ${whereClause}
         ORDER BY e.started_at DESC
         LIMIT $${params.length}`,
      params,
    );

    if (req.user) {
      auditAction(
        req.user.id,
        AuditAction.ADMIN_WORKFLOW_EXECUTION_VIEWED,
        "workflow_executions",
        undefined,
        { rowsReturned: result.rowCount, filterStatus: status, filterWorkflowId: workflow_id },
      );
    }

    res.json({ executions: result.rows, count: result.rowCount });
  } catch (err) {
    logger.error("Failed to query workflow executions", err as Error);
    res.status(500).json({ error: "Failed to query workflow executions." });
  }
});

// ============================================================================
// AUDIT LOG CSV EXPORT
// ============================================================================

const auditExportSchema = z.object({
  action: z.string().min(1).max(100).optional(),
  user_id: z.string().min(1).max(100).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(10000).default(1000),
});

/**
 * CSV-escape a field per RFC 4180:
 *   - Always wrap in double quotes
 *   - Double any embedded double quotes
 *   - Embedded newlines / commas are fine inside quotes
 */
function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '""';
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return `"${s.replace(/"/g, '""')}"`;
}

router.get("/audit/export.csv", async (req: Request, res: Response) => {
  const parsed = auditExportSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query parameters", details: parsed.error.flatten().fieldErrors });
    return;
  }

  const { action, user_id, from, to, limit } = parsed.data;
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (action) {
    params.push(action);
    conditions.push(`action = $${params.length}`);
  }
  if (user_id) {
    params.push(user_id);
    conditions.push(`user_id = $${params.length}`);
  }
  if (from) {
    params.push(from);
    conditions.push(`created_at >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    conditions.push(`created_at <= $${params.length}`);
  }
  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(limit);

  try {
    const result = await query<{
      id: string;
      user_id: string | null;
      ministry_code: string | null;
      action: string;
      resource_type: string | null;
      resource_id: string | null;
      details: unknown;
      ip_address: string | null;
      created_at: Date;
    }>(
      `SELECT id, user_id, ministry_code, action, resource_type, resource_id,
              details, ip_address, created_at
         FROM audit_log
         ${whereClause}
         ORDER BY created_at DESC
         LIMIT $${params.length}`,
      params,
    );

    auditAction(req.user!.id, AuditAction.ADMIN_AUDIT_EXPORTED, "audit_log", undefined, {
      rowsExported: result.rowCount,
      filters: { action, user_id, from, to },
    });

    const header = [
      "id",
      "created_at",
      "user_id",
      "ministry_code",
      "action",
      "resource_type",
      "resource_id",
      "ip_address",
      "details",
    ].join(",");
    const lines = [header];
    for (const row of result.rows) {
      lines.push(
        [
          csvEscape(row.id),
          csvEscape(row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at),
          csvEscape(row.user_id),
          csvEscape(row.ministry_code),
          csvEscape(row.action),
          csvEscape(row.resource_type),
          csvEscape(row.resource_id),
          csvEscape(row.ip_address),
          csvEscape(row.details),
        ].join(","),
      );
    }
    const body = lines.join("\n") + "\n";

    const filename = `audit-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(body);
  } catch (err) {
    logger.error("Failed to export audit log", err as Error);
    res.status(500).json({ error: "Failed to export audit log." });
  }
});

// ============================================================================
// RETENTION JOB (manual trigger)
// ============================================================================

router.post("/retention/run", async (req: Request, res: Response) => {
  try {
    const report = await runRetentionPass(`admin:${req.user!.id}`);
    res.json({ report });
  } catch (err) {
    logger.error("Manual retention pass failed", err as Error);
    res.status(500).json({ error: "Retention pass failed.", message: (err as Error).message });
  }
});

export default router;
