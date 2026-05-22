/**
 * Webhook Subscription Admin Routes (Backlog B3 — Bot 21)
 *
 * Admin-gated CRUD for outbound webhook subscriptions, plus a manual
 * "send a test event" endpoint and a recent-deliveries history view.
 *
 * Mounted at `/api/admin/webhooks` from `index.ts`. Deliberately separate
 * from `routes/admin.ts` so Bot 15's in-progress edits to that file do not
 * collide with this slice.
 *
 * Endpoints:
 *   GET    /                       — list subscriptions (admin's ministry + global)
 *   POST   /                       — create
 *   GET    /:id                    — fetch single
 *   PUT    /:id                    — update
 *   DELETE /:id                    — delete (CASCADE wipes delivery history)
 *   POST   /:id/test               — fire a synthetic delivery to validate connectivity
 *   GET    /:id/deliveries         — recent delivery attempts (most-recent first)
 */

import express, { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { authenticate, requireRole } from "../middleware/auth.js";
import { env } from "../config/env.js";
import { query } from "../config/database.js";
import { auditAction, AuditAction, logAudit } from "../services/auditLogger.js";
import { logger } from "../services/logger.js";
import {
  deliverToSubscription,
  type SubscriptionRow,
  type WebhookEventType,
} from "../services/webhookDispatcher.js";

const router: express.Router = Router();

// ============================================================================
// MIDDLEWARE — mirrors the admin gate used in routes/admin.ts
// ============================================================================

function auditAdminAccess(req: Request, _res: Response, next: NextFunction): void {
  if (req.user) {
    auditAction(req.user.id, AuditAction.ADMIN_ACCESS, "webhook_admin", req.path, {
      method: req.method,
      ministryCode: req.user.ministryCode,
    });
  }
  next();
}

router.use(authenticate, requireRole("admin"), auditAdminAccess);

// ============================================================================
// SHARED VALIDATION
// ============================================================================

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EVENT_TYPES = ["session.completed", "workflow.completed"] as const;

const subscriptionInputSchema = z.object({
  eventType: z.enum(EVENT_TYPES),
  url: z.string().url().max(2048),
  secretLabel: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-zA-Z0-9_.-]+$/, "secretLabel may only contain letters, numbers, _, ., or -"),
  enabled: z.boolean().optional().default(true),
  description: z.string().max(500).nullable().optional(),
  ministryCode: z.string().max(32).nullable().optional(),
});

const subscriptionPatchSchema = subscriptionInputSchema.partial();

// Database row type — column casing as it lives in Postgres.
interface DbSubscriptionRow {
  id: string;
  ministry_code: string | null;
  event_type: WebhookEventType;
  url: string;
  secret_label: string;
  enabled: boolean;
  description: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  last_delivery_at: string | null;
  last_delivery_status: string | null;
}

function toDto(row: DbSubscriptionRow): Record<string, unknown> {
  return {
    id: row.id,
    ministryCode: row.ministry_code,
    eventType: row.event_type,
    url: row.url,
    secretLabel: row.secret_label,
    enabled: row.enabled,
    description: row.description,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastDeliveryAt: row.last_delivery_at,
    lastDeliveryStatus: row.last_delivery_status,
  };
}

function requireDb(res: Response): boolean {
  if (!env.DATABASE_URL) {
    res
      .status(503)
      .json({ error: "Webhook subscriptions require a configured database." });
    return false;
  }
  return true;
}

async function loadSubscriptionById(id: string): Promise<DbSubscriptionRow | null> {
  const result = await query<DbSubscriptionRow>(
    `SELECT id, ministry_code, event_type, url, secret_label, enabled, description,
            created_by, created_at, updated_at, last_delivery_at, last_delivery_status
       FROM webhook_subscriptions
      WHERE id = $1`,
    [id],
  );
  return result.rowCount === 0 ? null : result.rows[0];
}

// ============================================================================
// LIST
// ============================================================================

router.get("/", async (_req: Request, res: Response) => {
  if (!requireDb(res)) return;
  try {
    const result = await query<DbSubscriptionRow>(
      `SELECT id, ministry_code, event_type, url, secret_label, enabled, description,
              created_by, created_at, updated_at, last_delivery_at, last_delivery_status
         FROM webhook_subscriptions
        ORDER BY created_at DESC`,
    );
    res.json({ subscriptions: result.rows.map(toDto) });
  } catch (err) {
    logger.error("Failed to list webhook subscriptions", err);
    res.status(500).json({ error: "Failed to list webhook subscriptions." });
  }
});

// ============================================================================
// CREATE
// ============================================================================

router.post("/", async (req: Request, res: Response) => {
  if (!requireDb(res)) return;
  const parsed = subscriptionInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten().fieldErrors });
    return;
  }
  const input = parsed.data;
  try {
    const result = await query<DbSubscriptionRow>(
      `INSERT INTO webhook_subscriptions
         (ministry_code, event_type, url, secret_label, enabled, description, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, ministry_code, event_type, url, secret_label, enabled, description,
                 created_by, created_at, updated_at, last_delivery_at, last_delivery_status`,
      [
        input.ministryCode ?? null,
        input.eventType,
        input.url,
        input.secretLabel,
        input.enabled,
        input.description ?? null,
        req.user!.id,
      ],
    );
    const row = result.rows[0];
    await logAudit({
      userId: req.user!.id,
      ministryCode: req.user!.ministryCode ?? undefined,
      action: AuditAction.WEBHOOK_SUBSCRIPTION_CREATED,
      resourceType: "webhook_subscription",
      resourceId: row.id,
      details: { eventType: row.event_type, url: row.url, enabled: row.enabled },
    });
    res.status(201).json(toDto(row));
  } catch (err) {
    logger.error("Failed to create webhook subscription", err);
    res.status(500).json({ error: "Failed to create webhook subscription." });
  }
});

// ============================================================================
// GET ONE
// ============================================================================

router.get("/:id", async (req: Request, res: Response) => {
  if (!requireDb(res)) return;
  const id = req.params.id as string;
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: "Invalid subscription id." });
    return;
  }
  try {
    const row = await loadSubscriptionById(id);
    if (!row) {
      res.status(404).json({ error: "Webhook subscription not found." });
      return;
    }
    res.json(toDto(row));
  } catch (err) {
    logger.error("Failed to load webhook subscription", err, { id });
    res.status(500).json({ error: "Failed to load webhook subscription." });
  }
});

// ============================================================================
// UPDATE
// ============================================================================

router.put("/:id", async (req: Request, res: Response) => {
  if (!requireDb(res)) return;
  const id = req.params.id as string;
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: "Invalid subscription id." });
    return;
  }
  const parsed = subscriptionPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten().fieldErrors });
    return;
  }
  const patch = parsed.data;
  // Build dynamic SET clause. Skip when no patch fields supplied.
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  if (patch.eventType !== undefined) {
    sets.push(`event_type = $${idx++}`);
    values.push(patch.eventType);
  }
  if (patch.url !== undefined) {
    sets.push(`url = $${idx++}`);
    values.push(patch.url);
  }
  if (patch.secretLabel !== undefined) {
    sets.push(`secret_label = $${idx++}`);
    values.push(patch.secretLabel);
  }
  if (patch.enabled !== undefined) {
    sets.push(`enabled = $${idx++}`);
    values.push(patch.enabled);
  }
  if (patch.description !== undefined) {
    sets.push(`description = $${idx++}`);
    values.push(patch.description);
  }
  if (patch.ministryCode !== undefined) {
    sets.push(`ministry_code = $${idx++}`);
    values.push(patch.ministryCode);
  }
  if (sets.length === 0) {
    res.status(400).json({ error: "No fields to update." });
    return;
  }
  values.push(id);
  try {
    const updated = await query<DbSubscriptionRow>(
      `UPDATE webhook_subscriptions
          SET ${sets.join(", ")}
        WHERE id = $${idx}
      RETURNING id, ministry_code, event_type, url, secret_label, enabled, description,
                created_by, created_at, updated_at, last_delivery_at, last_delivery_status`,
      values,
    );
    if (updated.rowCount === 0) {
      res.status(404).json({ error: "Webhook subscription not found." });
      return;
    }
    const row = updated.rows[0];
    await logAudit({
      userId: req.user!.id,
      ministryCode: req.user!.ministryCode ?? undefined,
      action: AuditAction.WEBHOOK_SUBSCRIPTION_UPDATED,
      resourceType: "webhook_subscription",
      resourceId: id,
      details: { patch },
    });
    res.json(toDto(row));
  } catch (err) {
    logger.error("Failed to update webhook subscription", err, { id });
    res.status(500).json({ error: "Failed to update webhook subscription." });
  }
});

// ============================================================================
// DELETE
// ============================================================================

router.delete("/:id", async (req: Request, res: Response) => {
  if (!requireDb(res)) return;
  const id = req.params.id as string;
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: "Invalid subscription id." });
    return;
  }
  try {
    const result = await query(`DELETE FROM webhook_subscriptions WHERE id = $1`, [id]);
    if (result.rowCount === 0) {
      res.status(404).json({ error: "Webhook subscription not found." });
      return;
    }
    await logAudit({
      userId: req.user!.id,
      ministryCode: req.user!.ministryCode ?? undefined,
      action: AuditAction.WEBHOOK_SUBSCRIPTION_DELETED,
      resourceType: "webhook_subscription",
      resourceId: id,
    });
    res.json({ id, deleted: true });
  } catch (err) {
    logger.error("Failed to delete webhook subscription", err, { id });
    res.status(500).json({ error: "Failed to delete webhook subscription." });
  }
});

// ============================================================================
// TEST DELIVERY
// ============================================================================

router.post("/:id/test", async (req: Request, res: Response) => {
  if (!requireDb(res)) return;
  const id = req.params.id as string;
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: "Invalid subscription id." });
    return;
  }
  try {
    const row = await loadSubscriptionById(id);
    if (!row) {
      res.status(404).json({ error: "Webhook subscription not found." });
      return;
    }
    // The dispatcher honors the `enabled` flag — we deliberately re-enable
    // the test path so admins can validate a disabled subscription before
    // turning it on. Conjure a transient SubscriptionRow with enabled=true.
    const subscription: SubscriptionRow = {
      id: row.id,
      ministry_code: row.ministry_code,
      event_type: row.event_type,
      url: row.url,
      secret_label: row.secret_label,
      enabled: true,
      description: row.description,
    };
    const result = await deliverToSubscription(subscription, {
      resourceId: null,
      body: {
        test: true,
        triggeredBy: req.user!.id,
        triggeredAt: new Date().toISOString(),
        note: "This is a synthetic ABC webhook delivery for connectivity testing.",
      },
    });
    res.json(result);
  } catch (err) {
    logger.error("Failed to send test webhook", err, { id });
    res.status(500).json({ error: "Failed to send test webhook." });
  }
});

// ============================================================================
// RECENT DELIVERIES
// ============================================================================

const deliveryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

router.get("/:id/deliveries", async (req: Request, res: Response) => {
  if (!requireDb(res)) return;
  const id = req.params.id as string;
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: "Invalid subscription id." });
    return;
  }
  const parsed = deliveryQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query parameters", details: parsed.error.flatten().fieldErrors });
    return;
  }
  try {
    const result = await query(
      `SELECT id, subscription_id, event_type, resource_id, attempt, signature,
              response_status, response_body_preview, duration_ms, error, delivered_at
         FROM webhook_deliveries
        WHERE subscription_id = $1
        ORDER BY delivered_at DESC
        LIMIT $2`,
      [id, parsed.data.limit],
    );
    res.json({ deliveries: result.rows });
  } catch (err) {
    logger.error("Failed to list webhook deliveries", err, { id });
    res.status(500).json({ error: "Failed to list webhook deliveries." });
  }
});

export default router;
