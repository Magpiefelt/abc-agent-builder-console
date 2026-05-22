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
 *   GET  /api/admin/dashboard                — pre-aggregated operational stats
 *
 * Note: detailed health diagnostics live at GET /api/health/detailed
 * (also admin-gated) to keep operational observability in one place.
 */

import express, { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { authenticate, requireRole } from "../middleware/auth.js";
import { env } from "../config/env.js";
import { query } from "../config/database.js";
import {
  auditAction,
  AuditAction,
} from "../services/auditLogger.js";
import { logger } from "../services/logger.js";
import { clearModelCache } from "../services/llmProvider.js";
import { runRetentionPass } from "../services/retentionJob.js";
import { exportUserData } from "../services/userDataExporter.js";
import {
  BudgetValidationError,
  deleteBudget,
  listBudgets,
  listMonthlyUsage,
  setBudget,
  type BudgetScopeType,
} from "../services/budgetGuard.js";

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

// ============================================================================
// WORKFLOW TRASH (soft-deleted workflows — restore / purge)
// ============================================================================
//
// `DELETE /api/workflows/:id` flips `deleted_at` to NOW(). Rows linger until
// the retention pass purges them after `WORKFLOW_TRASH_RETENTION_DAYS`. These
// endpoints let an admin (a) see what's in the Trash, (b) restore an item
// before it ages out, or (c) purge it immediately. Each action is audit-logged.

const WORKFLOW_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get("/workflows/trash", async (_req: Request, res: Response) => {
  try {
    const result = await query<{
      id: string;
      user_id: string;
      ministry_code: string | null;
      name: string;
      description: string | null;
      classification: string;
      is_template: boolean;
      version: number;
      created_at: Date;
      updated_at: Date;
      deleted_at: Date;
      user_email: string | null;
      user_display_name: string | null;
    }>(
      `SELECT w.id, w.user_id, w.ministry_code, w.name, w.description,
              w.classification, w.is_template, w.version,
              w.created_at, w.updated_at, w.deleted_at,
              u.email AS user_email, u.display_name AS user_display_name
         FROM workflows w
         LEFT JOIN users u ON u.id = w.user_id
        WHERE w.deleted_at IS NOT NULL
        ORDER BY w.deleted_at DESC
        LIMIT 500`,
    );
    const retentionMs = env.WORKFLOW_TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const trash = result.rows.map((r) => {
      const deletedAt = r.deleted_at instanceof Date ? r.deleted_at : new Date(r.deleted_at);
      const expiresAt = new Date(deletedAt.getTime() + retentionMs);
      return {
        id: r.id,
        userId: r.user_id,
        userEmail: r.user_email,
        userDisplayName: r.user_display_name,
        ministryCode: r.ministry_code,
        name: r.name,
        description: r.description,
        classification: r.classification,
        isTemplate: r.is_template,
        version: r.version,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        deletedAt: deletedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      };
    });
    res.json({
      workflows: trash,
      count: result.rowCount,
      retentionDays: env.WORKFLOW_TRASH_RETENTION_DAYS,
    });
  } catch (err) {
    logger.error("Failed to list workflow trash", err as Error);
    res.status(500).json({ error: "Failed to list workflow trash." });
  }
});

router.post("/workflows/:id/restore", async (req: Request, res: Response) => {
  const workflowId = req.params.id as string;
  if (!WORKFLOW_UUID_RE.test(workflowId)) {
    res.status(400).json({ error: "Invalid workflow id." });
    return;
  }
  try {
    const result = await query<{ id: string; name: string; user_id: string; ministry_code: string | null }>(
      `UPDATE workflows
          SET deleted_at = NULL
        WHERE id = $1 AND deleted_at IS NOT NULL
       RETURNING id, name, user_id, ministry_code`,
      [workflowId],
    );
    if (result.rowCount === 0) {
      res.status(404).json({ error: "Workflow not found in trash." });
      return;
    }
    const restored = result.rows[0];
    auditAction(req.user!.id, AuditAction.WORKFLOW_RESTORED, "workflow", workflowId, {
      ownerUserId: restored.user_id,
      name: restored.name,
      ministryCode: restored.ministry_code,
    });
    res.json({ id: workflowId, restored: true, name: restored.name });
  } catch (err) {
    logger.error("Failed to restore workflow", err as Error, { id: workflowId });
    res.status(500).json({ error: "Failed to restore workflow." });
  }
});

router.post("/workflows/:id/purge", async (req: Request, res: Response) => {
  const workflowId = req.params.id as string;
  if (!WORKFLOW_UUID_RE.test(workflowId)) {
    res.status(400).json({ error: "Invalid workflow id." });
    return;
  }
  try {
    // Only purge rows already in the trash. Live workflows must go through
    // the normal user delete flow first; this guards against an admin
    // accidentally hard-deleting a workflow that someone is actively using.
    const existing = await query<{ id: string; name: string; user_id: string; ministry_code: string | null }>(
      `SELECT id, name, user_id, ministry_code
         FROM workflows WHERE id = $1 AND deleted_at IS NOT NULL`,
      [workflowId],
    );
    if (existing.rowCount === 0) {
      res.status(404).json({ error: "Workflow not found in trash." });
      return;
    }
    const wf = existing.rows[0];
    await query(`DELETE FROM workflows WHERE id = $1`, [workflowId]);
    auditAction(req.user!.id, AuditAction.WORKFLOW_PURGED, "workflow", workflowId, {
      ownerUserId: wf.user_id,
      name: wf.name,
      ministryCode: wf.ministry_code,
    });
    res.json({ id: workflowId, purged: true, name: wf.name });
  } catch (err) {
    logger.error("Failed to purge workflow", err as Error, { id: workflowId });
    res.status(500).json({ error: "Failed to purge workflow." });
  }
});

// ============================================================================
// DASHBOARD — pre-aggregated operational stats
// ============================================================================
//
// One round-trip the admin dashboard panel uses to draw all of its tiles.
// Every numeric series is bucketed in SQL — aggregating thousands of audit
// rows in the browser would be slow and brittle. Windows are fixed to "last
// 24 hours", "last 7 days", and "last 30 days" so the SQL planner can use
// the existing created_at indexes without scanning the full table.

interface DashboardCount {
  windowLabel: "24h" | "7d" | "30d";
  count: number;
}

interface DashboardStatusBreakdown {
  status: string;
  count: number;
}

interface DashboardClassificationBreakdown {
  classification: string;
  count: number;
}

interface DashboardToolUsage {
  tool: string;
  calls: number;
  successes: number;
}

interface DashboardModelUsage {
  modelId: string;
  sessions: number;
}

interface DashboardPiiByType {
  detectionType: string;
  count: number;
}

interface DashboardResponse {
  generatedAt: string;
  sessions: {
    totals: DashboardCount[];
    byStatus: DashboardStatusBreakdown[];
    byClassification: DashboardClassificationBreakdown[];
  };
  workflowExecutions: {
    totals: DashboardCount[];
    byStatus: DashboardStatusBreakdown[];
  };
  tools: DashboardToolUsage[];
  models: DashboardModelUsage[];
  pii: {
    last7Days: number;
    byType: DashboardPiiByType[];
    byAction: { action: string; count: number }[];
  };
}

router.get("/dashboard", async (_req: Request, res: Response) => {
  try {
    const [
      sessionTotals,
      sessionByStatus,
      sessionByClassification,
      executionTotals,
      executionByStatus,
      toolUsage,
      modelUsage,
      piiTotal,
      piiByType,
      piiByAction,
    ] = await Promise.all([
      // Session totals across the three windows in a single row.
      query<{ d24h: string; d7d: string; d30d: string }>(
        `SELECT
           COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') AS d24h,
           COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')   AS d7d,
           COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')  AS d30d
         FROM agent_sessions`,
      ),
      query<{ status: string; count: string }>(
        `SELECT status, COUNT(*) AS count
           FROM agent_sessions
          WHERE created_at >= NOW() - INTERVAL '30 days'
          GROUP BY status
          ORDER BY count DESC`,
      ),
      query<{ classification: string; count: string }>(
        `SELECT classification, COUNT(*) AS count
           FROM agent_sessions
          WHERE created_at >= NOW() - INTERVAL '30 days'
          GROUP BY classification
          ORDER BY count DESC`,
      ),
      query<{ d24h: string; d7d: string; d30d: string }>(
        `SELECT
           COUNT(*) FILTER (WHERE started_at >= NOW() - INTERVAL '24 hours') AS d24h,
           COUNT(*) FILTER (WHERE started_at >= NOW() - INTERVAL '7 days')   AS d7d,
           COUNT(*) FILTER (WHERE started_at >= NOW() - INTERVAL '30 days')  AS d30d
         FROM workflow_executions`,
      ),
      query<{ status: string; count: string }>(
        `SELECT status, COUNT(*) AS count
           FROM workflow_executions
          WHERE started_at >= NOW() - INTERVAL '30 days'
          GROUP BY status
          ORDER BY count DESC`,
      ),
      // Tool usage from the last 7d of iteration logs. tool_results is a JSONB
      // array of { tool, success, ... }; jsonb_array_elements unrolls it so we
      // can group by tool name.
      query<{ tool: string; calls: string; successes: string }>(
        `SELECT
           tr->>'tool' AS tool,
           COUNT(*) AS calls,
           COUNT(*) FILTER (WHERE (tr->>'success')::boolean) AS successes
         FROM agent_iterations,
              jsonb_array_elements(COALESCE(tool_results, '[]'::jsonb)) AS tr
         WHERE created_at >= NOW() - INTERVAL '7 days'
           AND tr ? 'tool'
         GROUP BY tool
         ORDER BY calls DESC
         LIMIT 10`,
      ),
      query<{ model_id: string; sessions: string }>(
        `SELECT model_id, COUNT(*) AS sessions
           FROM agent_sessions
          WHERE created_at >= NOW() - INTERVAL '30 days'
          GROUP BY model_id
          ORDER BY sessions DESC
          LIMIT 10`,
      ),
      query<{ count: string }>(
        `SELECT COUNT(*) AS count
           FROM pii_detections
          WHERE created_at >= NOW() - INTERVAL '7 days'`,
      ),
      query<{ detection_type: string; count: string }>(
        `SELECT detection_type, COUNT(*) AS count
           FROM pii_detections
          WHERE created_at >= NOW() - INTERVAL '7 days'
          GROUP BY detection_type
          ORDER BY count DESC`,
      ),
      query<{ action_taken: string; count: string }>(
        `SELECT action_taken, COUNT(*) AS count
           FROM pii_detections
          WHERE created_at >= NOW() - INTERVAL '7 days'
          GROUP BY action_taken
          ORDER BY count DESC`,
      ),
    ]);

    const toInt = (s: string | number | undefined): number =>
      s === undefined || s === null ? 0 : Number(s);

    const body: DashboardResponse = {
      generatedAt: new Date().toISOString(),
      sessions: {
        totals: [
          { windowLabel: "24h", count: toInt(sessionTotals.rows[0]?.d24h) },
          { windowLabel: "7d", count: toInt(sessionTotals.rows[0]?.d7d) },
          { windowLabel: "30d", count: toInt(sessionTotals.rows[0]?.d30d) },
        ],
        byStatus: sessionByStatus.rows.map((r) => ({ status: r.status, count: toInt(r.count) })),
        byClassification: sessionByClassification.rows.map((r) => ({
          classification: r.classification,
          count: toInt(r.count),
        })),
      },
      workflowExecutions: {
        totals: [
          { windowLabel: "24h", count: toInt(executionTotals.rows[0]?.d24h) },
          { windowLabel: "7d", count: toInt(executionTotals.rows[0]?.d7d) },
          { windowLabel: "30d", count: toInt(executionTotals.rows[0]?.d30d) },
        ],
        byStatus: executionByStatus.rows.map((r) => ({ status: r.status, count: toInt(r.count) })),
      },
      tools: toolUsage.rows.map((r) => ({
        tool: r.tool,
        calls: toInt(r.calls),
        successes: toInt(r.successes),
      })),
      models: modelUsage.rows.map((r) => ({
        modelId: r.model_id,
        sessions: toInt(r.sessions),
      })),
      pii: {
        last7Days: toInt(piiTotal.rows[0]?.count),
        byType: piiByType.rows.map((r) => ({
          detectionType: r.detection_type,
          count: toInt(r.count),
        })),
        byAction: piiByAction.rows.map((r) => ({
          action: r.action_taken,
          count: toInt(r.count),
        })),
      },
    };
    res.json(body);
  } catch (err) {
    logger.error("Failed to build dashboard payload", err as Error);
    res.status(500).json({ error: "Failed to load dashboard." });
  }
});

// ============================================================================
// FOIP S.7 RIGHT-OF-ACCESS USER DATA EXPORT (Backlog B6)
// ============================================================================
//
// Bundles every row in every table that references the target user into a
// single ZIP. The heavy lifting lives in `services/userDataExporter.ts`; this
// route only validates the target user id, audits the action, and streams the
// archive.
//
// Why POST instead of GET? Right-of-access requests are operator actions, not
// idempotent queries — every export is a discrete event we want audit-logged
// with the requesting admin attribution. A GET would also bypass CSRF
// protection on browsers that prefetch admin URLs.

const USER_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.post("/users/:id/export", async (req: Request, res: Response) => {
  const targetUserId = req.params.id as string;
  if (!USER_UUID_RE.test(targetUserId)) {
    res.status(400).json({ error: "Invalid user id." });
    return;
  }

  try {
    const result = await exportUserData({
      userId: targetUserId,
      exportedBy: { userId: req.user!.id, role: req.user!.role },
      query,
    });

    if (!result) {
      res.status(404).json({ error: "User not found." });
      return;
    }

    auditAction(
      req.user!.id,
      AuditAction.USER_DATA_EXPORTED,
      "user",
      targetUserId,
      { rowCounts: result.manifest.rowCounts, archiveBytes: result.zip.length },
    );

    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${result.filename}"`,
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    res.send(result.zip);
  } catch (err) {
    logger.error("Failed to export user data", err as Error, { targetUserId });
    res.status(500).json({ error: "Failed to export user data." });
  }
});

// ============================================================================
// TOKEN BUDGETS (Bot 15, Backlog B1)
// ============================================================================
//
// Per-user, per-ministry, and global monthly token caps. The budget guard
// reads these rows before every LLM call and blocks runaway loops. Admins
// CRUD them here; the global default row can be tightened but never deleted.

const budgetScopeSchema = z.enum(["user", "ministry", "global"]);

const budgetUpsertSchema = z.object({
  scope_type: budgetScopeSchema,
  scope_id: z.string().min(1).max(200),
  monthly_token_limit: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  notes: z.string().max(500).optional().nullable(),
});

router.get("/budgets", async (_req: Request, res: Response) => {
  try {
    const budgets = await listBudgets();
    res.json({ budgets, count: budgets.length });
  } catch (err) {
    logger.error("Failed to list token budgets", err as Error);
    res.status(500).json({ error: "Failed to list budgets." });
  }
});

router.put("/budgets", async (req: Request, res: Response) => {
  const parsed = budgetUpsertSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten().fieldErrors });
    return;
  }
  try {
    const record = await setBudget({
      scopeType: parsed.data.scope_type,
      scopeId: parsed.data.scope_id,
      monthlyTokenLimit: parsed.data.monthly_token_limit,
      notes: parsed.data.notes ?? null,
      createdBy: req.user!.id,
    });
    auditAction(
      req.user!.id,
      AuditAction.BUDGET_SET,
      "token_budget",
      record.id,
      {
        scopeType: record.scopeType,
        scopeId: record.scopeId,
        monthlyTokenLimit: record.monthlyTokenLimit,
      },
    );
    res.json({ budget: record });
  } catch (err) {
    if (err instanceof BudgetValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    logger.error("Failed to upsert token budget", err as Error);
    res.status(500).json({ error: "Failed to set budget." });
  }
});

router.delete("/budgets/:scopeType/:scopeId", async (req: Request, res: Response) => {
  const scopeType = req.params.scopeType as BudgetScopeType;
  const scopeId = req.params.scopeId as string;

  const scopeParse = budgetScopeSchema.safeParse(scopeType);
  if (!scopeParse.success) {
    res.status(400).json({ error: "scopeType must be 'user', 'ministry', or 'global'." });
    return;
  }
  if (!scopeId || scopeId.length > 200) {
    res.status(400).json({ error: "Invalid scopeId." });
    return;
  }

  try {
    const deleted = await deleteBudget(scopeType, scopeId);
    if (!deleted) {
      res.status(404).json({ error: "Budget not found." });
      return;
    }
    auditAction(
      req.user!.id,
      AuditAction.BUDGET_DELETED,
      "token_budget",
      `${scopeType}:${scopeId}`,
      { scopeType, scopeId },
    );
    res.json({ scopeType, scopeId, deleted: true });
  } catch (err) {
    if (err instanceof BudgetValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    logger.error("Failed to delete token budget", err as Error);
    res.status(500).json({ error: "Failed to delete budget." });
  }
});

router.get("/budgets/usage", async (req: Request, res: Response) => {
  const limit = Math.min(parseInt((req.query.limit as string) || "200", 10) || 200, 500);
  try {
    const usage = await listMonthlyUsage(limit);
    res.json({ usage, count: usage.length });
  } catch (err) {
    logger.error("Failed to compute monthly usage", err as Error);
    res.status(500).json({ error: "Failed to compute usage." });
  }
});

export default router;
