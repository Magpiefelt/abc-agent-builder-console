/**
 * Webhook Dispatcher (Backlog B3 — Bot 21)
 *
 * Delivers signed outbound HTTP POSTs to admin-registered subscribers when an
 * agent session or workflow execution reaches a terminal state. Every attempt
 * is persisted to `webhook_deliveries` for audit + replay.
 *
 * Design notes:
 *  - Fire-and-forget at the caller. `dispatchWebhookEvent` returns immediately;
 *    the actual fetch + retries happen on a detached Promise so the orchestrator
 *    / executor SSE stream is never blocked.
 *  - HMAC-SHA256 signature uses a derived secret: HMAC(SECRETS_VAULT_KEY, label).
 *    Rotation is one DB write (change the label); the actual key never moves.
 *    If the vault key is unset, the dispatcher logs a warning and skips
 *    delivery rather than throwing — webhook delivery is non-essential to the
 *    main request path.
 *  - Retry policy: 5xx / network / timeout → exponential backoff (base * 2^n).
 *    4xx other than 408 (timeout) and 429 (rate-limit) → give up immediately.
 *  - response_body_preview is capped at 4 KB to keep the audit table sane.
 *  - The dispatcher is provider-agnostic; the orchestrator and executor each
 *    call `dispatchWebhookEvent(eventType, payload)` with their own payload
 *    shape.
 */

import crypto from "node:crypto";
import { query } from "../config/database.js";
import { env } from "../config/env.js";
import { logger } from "./logger.js";
import { logAudit, AuditAction } from "./auditLogger.js";

const RESPONSE_PREVIEW_LIMIT = 4096;

export type WebhookEventType = "session.completed" | "workflow.completed";

/** Outcome statuses recorded on `webhook_subscriptions.last_delivery_status`. */
export type DeliveryOutcome = "success" | "client_error" | "exhausted" | "skipped";

export interface SubscriptionRow {
  id: string;
  ministry_code: string | null;
  event_type: WebhookEventType;
  url: string;
  secret_label: string;
  enabled: boolean;
  description: string | null;
}

export interface DispatchResult {
  subscriptionId: string;
  outcome: DeliveryOutcome;
  attempts: number;
  finalStatus: number | null;
  error: string | null;
}

interface SinglePostResult {
  status: number | null;
  bodyPreview: string | null;
  durationMs: number;
  error: string | null;
  /** True when the result should NOT be retried (success or non-retryable 4xx). */
  terminal: boolean;
}

// ============================================================================
// SIGNING
// ============================================================================

/**
 * Derive a per-subscription HMAC secret from the vault key + label. Two
 * subscriptions sharing a label get the same secret (intentional — admins can
 * rotate all webhook signatures by changing one label without restarting).
 */
export function deriveSecret(label: string): string | null {
  if (!env.SECRETS_VAULT_KEY) return null;
  return crypto
    .createHmac("sha256", env.SECRETS_VAULT_KEY)
    .update(label)
    .digest("hex");
}

/**
 * Sign a serialised body with the given derived secret.
 * Returns the `sha256=<hex>` form expected by GitHub-style webhook consumers.
 */
export function signBody(derivedSecret: string, body: string): string {
  const mac = crypto.createHmac("sha256", derivedSecret).update(body).digest("hex");
  return `sha256=${mac}`;
}

// ============================================================================
// PERSISTENCE
// ============================================================================

async function persistAttempt(args: {
  subscriptionId: string;
  eventType: WebhookEventType;
  resourceId: string | null;
  attempt: number;
  requestBody: unknown;
  signature: string;
  result: SinglePostResult;
}): Promise<void> {
  if (!env.DATABASE_URL) return;
  try {
    await query(
      `INSERT INTO webhook_deliveries
         (subscription_id, event_type, resource_id, attempt, request_body,
          signature, response_status, response_body_preview, duration_ms, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        args.subscriptionId,
        args.eventType,
        args.resourceId,
        args.attempt,
        JSON.stringify(args.requestBody),
        args.signature,
        args.result.status,
        args.result.bodyPreview,
        args.result.durationMs,
        args.result.error,
      ],
    );
  } catch (err) {
    logger.error("Failed to persist webhook delivery attempt", err, {
      subscriptionId: args.subscriptionId,
      attempt: args.attempt,
    });
  }
}

async function updateSubscriptionStatus(
  subscriptionId: string,
  outcome: DeliveryOutcome,
): Promise<void> {
  if (!env.DATABASE_URL) return;
  try {
    await query(
      `UPDATE webhook_subscriptions
         SET last_delivery_at = NOW(), last_delivery_status = $2
       WHERE id = $1`,
      [subscriptionId, outcome],
    );
  } catch (err) {
    logger.error("Failed to update webhook subscription status", err, { subscriptionId });
  }
}

// ============================================================================
// SINGLE-ATTEMPT POST
// ============================================================================

async function singlePost(
  url: string,
  body: string,
  signature: string,
  headers: Record<string, string>,
): Promise<SinglePostResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.WEBHOOK_TIMEOUT_MS);
  const start = Date.now();
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "ABC-Webhook/1.0",
        "X-ABC-Signature": signature,
        ...headers,
      },
      body,
      signal: controller.signal,
    });
    const status = response.status;
    const text = await response.text().catch(() => "");
    const preview = text.slice(0, RESPONSE_PREVIEW_LIMIT);
    const durationMs = Date.now() - start;
    if (status >= 200 && status < 300) {
      return { status, bodyPreview: preview, durationMs, error: null, terminal: true };
    }
    // 408 (Request Timeout) and 429 (Too Many Requests) are retryable; other
    // 4xx are caller errors and a retry will not help.
    const retryable = status === 408 || status === 429 || status >= 500;
    return {
      status,
      bodyPreview: preview,
      durationMs,
      error: `Non-2xx response: ${status}`,
      terminal: !retryable,
    };
  } catch (err) {
    const durationMs = Date.now() - start;
    const isAbort = (err as { name?: string })?.name === "AbortError";
    return {
      status: null,
      bodyPreview: null,
      durationMs,
      error: isAbort ? "Request timed out" : (err as Error).message,
      terminal: false,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Deliver a single event to one subscription with retry. Returns the final
 * outcome plus attempt count. Always resolves — never throws.
 *
 * Exported for unit tests; production callers go through `dispatchWebhookEvent`
 * which fans out to every enabled subscription.
 */
export async function deliverToSubscription(
  subscription: SubscriptionRow,
  payload: { resourceId: string | null; body: Record<string, unknown> },
): Promise<DispatchResult> {
  if (!subscription.enabled) {
    return {
      subscriptionId: subscription.id,
      outcome: "skipped",
      attempts: 0,
      finalStatus: null,
      error: "Subscription disabled",
    };
  }

  const secret = deriveSecret(subscription.secret_label);
  if (!secret) {
    logger.warn("Webhook delivery skipped: SECRETS_VAULT_KEY not configured", {
      subscriptionId: subscription.id,
    });
    return {
      subscriptionId: subscription.id,
      outcome: "skipped",
      attempts: 0,
      finalStatus: null,
      error: "Vault key not configured",
    };
  }

  const deliveryId = crypto.randomUUID();
  const envelope = {
    event: subscription.event_type,
    deliveryId,
    subscriptionId: subscription.id,
    deliveredAt: new Date().toISOString(),
    payload: payload.body,
  };
  const body = JSON.stringify(envelope);
  const signature = signBody(secret, body);
  const headers = {
    "X-ABC-Event": subscription.event_type,
    "X-ABC-Delivery": deliveryId,
    "X-ABC-Subscription": subscription.id,
  };

  const maxAttempts = env.WEBHOOK_MAX_ATTEMPTS;
  let lastResult: SinglePostResult | null = null;
  let attempts = 0;

  for (let i = 0; i < maxAttempts; i++) {
    attempts++;
    const result = await singlePost(subscription.url, body, signature, headers);
    lastResult = result;
    await persistAttempt({
      subscriptionId: subscription.id,
      eventType: subscription.event_type,
      resourceId: payload.resourceId,
      attempt: attempts,
      requestBody: envelope,
      signature,
      result,
    });
    if (result.terminal) break;
    if (i < maxAttempts - 1) {
      const backoff = env.WEBHOOK_BASE_BACKOFF_MS * Math.pow(2, i);
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
  }

  // Categorise the outcome for the subscription status column. The audit log
  // gets a `WEBHOOK_DELIVERED` row regardless of success/failure so the trail
  // is complete.
  let outcome: DeliveryOutcome;
  const status = lastResult?.status ?? null;
  if (status !== null && status >= 200 && status < 300) {
    outcome = "success";
  } else if (status !== null && status >= 400 && status < 500 && status !== 408 && status !== 429) {
    outcome = "client_error";
  } else {
    outcome = "exhausted";
  }

  await updateSubscriptionStatus(subscription.id, outcome);
  await logAudit({
    action: AuditAction.WEBHOOK_DELIVERED,
    ministryCode: subscription.ministry_code ?? undefined,
    resourceType: "webhook_subscription",
    resourceId: subscription.id,
    details: {
      event: subscription.event_type,
      deliveryId,
      outcome,
      attempts,
      finalStatus: status,
      resourceId: payload.resourceId,
    },
  });

  return {
    subscriptionId: subscription.id,
    outcome,
    attempts,
    finalStatus: status,
    error: lastResult?.error ?? null,
  };
}

/**
 * Load all enabled subscriptions for an event type. Ministry filter is
 * optional — when set, only subscriptions for that ministry (or unscoped
 * subscriptions with `ministry_code IS NULL`) are returned.
 */
export async function loadSubscriptions(
  eventType: WebhookEventType,
  ministryCode: string | null,
): Promise<SubscriptionRow[]> {
  if (!env.DATABASE_URL) return [];
  const result = await query<SubscriptionRow>(
    `SELECT id, ministry_code, event_type, url, secret_label, enabled, description
       FROM webhook_subscriptions
      WHERE event_type = $1
        AND enabled = true
        AND (ministry_code IS NULL OR ministry_code = $2)`,
    [eventType, ministryCode],
  );
  return result.rows;
}

/**
 * Fire all matching webhook deliveries for an event. Returns immediately;
 * the actual fetches happen on a detached Promise so callers (orchestrator,
 * executor) never block on outbound HTTP.
 *
 * In tests / when the database is unconfigured, this becomes a no-op.
 */
export function dispatchWebhookEvent(
  eventType: WebhookEventType,
  payload: {
    resourceId: string | null;
    ministryCode: string | null;
    body: Record<string, unknown>;
  },
): void {
  void (async () => {
    try {
      const subscriptions = await loadSubscriptions(eventType, payload.ministryCode);
      if (subscriptions.length === 0) return;
      await Promise.all(
        subscriptions.map((sub) =>
          deliverToSubscription(sub, {
            resourceId: payload.resourceId,
            body: payload.body,
          }).catch((err) => {
            logger.error("Webhook delivery threw unexpectedly", err, {
              subscriptionId: sub.id,
              eventType,
            });
          }),
        ),
      );
    } catch (err) {
      logger.error("Failed to dispatch webhook event", err, { eventType });
    }
  })();
}
