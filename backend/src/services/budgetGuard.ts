/**
 * Budget Guard — per-user / per-ministry / global monthly token budgets.
 *
 * Enforces a hard cap on LLM spend. The orchestrator and workflow executor
 * call `checkBudget(userId, ministryCode)` before each `callLLM` and fail
 * the session / stage if the caller has burned through their monthly
 * allotment.
 *
 * Resolution order (most specific wins):
 *   user override > ministry override > global default
 *
 * Usage is aggregated **on demand** from the existing
 *   `agent_iterations.tokens_used`           (Free Agent sessions)
 *   `workflow_executions.total_tokens`        (workflow runs, denormalized)
 * columns so the guard never gets out of sync with the source of truth.
 *
 * Month boundaries are calendar months in UTC (`date_trunc('month', NOW())`).
 * The dollar value of a token is intentionally NOT part of this service —
 * pricing lives in `workflowCostEstimator.ts` / `modelPricing.json` and the
 * UI converts limit→dollars there. The budget guard talks tokens only.
 *
 * Design notes:
 *  - The service is DB-aware but logging/audit/SSE concerns live at the
 *    call sites. Callers get a structured `BudgetStatus` back and decide
 *    whether to emit an event or terminate.
 *  - When DATABASE_URL is unset (dev smoke / mock mode) the guard returns a
 *    permissive status with `enforced: false` so we don't block local work.
 *  - The seeded `('global','global')` row in `token_budgets` is a safety
 *    net so `getEffectiveBudget` always returns a number even when no
 *    overrides exist.
 */

import { query } from "../config/database.js";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

// ============================================================================
// TYPES
// ============================================================================

export type BudgetScopeType = "user" | "ministry" | "global";

export interface BudgetRecord {
  id: string;
  scopeType: BudgetScopeType;
  scopeId: string;
  monthlyTokenLimit: number;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EffectiveBudget {
  /** Which row the resolver landed on. */
  resolvedScope: BudgetScopeType;
  /** The row's primary key, or null if no row exists at all (unlimited). */
  budgetId: string | null;
  monthlyTokenLimit: number | null;
  notes: string | null;
}

export interface BudgetPeriod {
  /** ISO 8601 of the first instant of the current month. */
  start: string;
  /** ISO 8601 of the first instant of the next month (exclusive). */
  end: string;
}

export interface BudgetStatus {
  userId: string;
  ministryCode: string | null;
  effective: EffectiveBudget;
  used: number;
  remaining: number | null;
  exceeded: boolean;
  /** True when the limit is in effect; false when no DB is configured or no
   *  budget row exists at all. */
  enforced: boolean;
  period: BudgetPeriod;
}

export interface UsageRow {
  userId: string;
  userEmail: string | null;
  userDisplayName: string | null;
  ministryCode: string | null;
  used: number;
  /** Effective limit for this user (per-user / ministry / global resolution). */
  effectiveLimit: number | null;
  effectiveScope: BudgetScopeType | null;
  remaining: number | null;
  exceeded: boolean;
}

// ============================================================================
// HELPERS
// ============================================================================

function isDbAvailable(): boolean {
  return Boolean(env.DATABASE_URL);
}

/** Calendar-month boundaries in UTC, computed in JS so the result lines up
 *  with the SQL `date_trunc('month', NOW())` the queries below use. */
export function currentMonthPeriod(at: Date = new Date()): BudgetPeriod {
  const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
  const end = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));
  return { start: start.toISOString(), end: end.toISOString() };
}

function permissiveStatus(
  userId: string,
  ministryCode: string | null,
  reason: "db_unavailable" | "no_row",
): BudgetStatus {
  return {
    userId,
    ministryCode,
    effective: {
      resolvedScope: "global",
      budgetId: null,
      monthlyTokenLimit: null,
      notes: reason === "db_unavailable" ? "Budget check skipped: no database configured." : null,
    },
    used: 0,
    remaining: null,
    exceeded: false,
    enforced: false,
    period: currentMonthPeriod(),
  };
}

function rowToRecord(row: Record<string, unknown>): BudgetRecord {
  return {
    id: row.id as string,
    scopeType: row.scope_type as BudgetScopeType,
    scopeId: row.scope_id as string,
    monthlyTokenLimit: Number(row.monthly_token_limit),
    notes: (row.notes as string | null) ?? null,
    createdBy: (row.created_by as string | null) ?? null,
    createdAt: (row.created_at as Date | string) instanceof Date
      ? (row.created_at as Date).toISOString()
      : String(row.created_at),
    updatedAt: (row.updated_at as Date | string) instanceof Date
      ? (row.updated_at as Date).toISOString()
      : String(row.updated_at),
  };
}

// ============================================================================
// CORE RESOLUTION
// ============================================================================

/**
 * Resolve the effective monthly budget for a `(userId, ministryCode)` pair.
 *
 * Picks the most specific row in `token_budgets`:
 *   1. user-scoped where scope_id = userId
 *   2. ministry-scoped where scope_id = ministryCode (only if non-null)
 *   3. global default (scope_type='global', scope_id='global')
 *
 * Returns a `EffectiveBudget` with `monthlyTokenLimit = null` only when
 * none of the three rows exist (no global default seeded). In production
 * this should never happen — the migration seeds the global row.
 */
export async function getEffectiveBudget(
  userId: string,
  ministryCode: string | null,
): Promise<EffectiveBudget> {
  if (!isDbAvailable()) {
    return { resolvedScope: "global", budgetId: null, monthlyTokenLimit: null, notes: null };
  }

  // Single query, ORDER BY priority so the first row is always the winner.
  // Avoids three round-trips and is read-only.
  const result = await query<{
    id: string;
    scope_type: BudgetScopeType;
    monthly_token_limit: string;
    notes: string | null;
  }>(
    `SELECT id, scope_type, monthly_token_limit, notes
       FROM token_budgets
      WHERE (scope_type = 'user'     AND scope_id = $1)
         OR (scope_type = 'ministry' AND scope_id = $2)
         OR (scope_type = 'global'   AND scope_id = 'global')
      ORDER BY CASE scope_type
                 WHEN 'user' THEN 1
                 WHEN 'ministry' THEN 2
                 WHEN 'global' THEN 3
               END
      LIMIT 1`,
    [userId, ministryCode ?? ""],
  );

  const row = result.rows[0];
  if (!row) {
    return { resolvedScope: "global", budgetId: null, monthlyTokenLimit: null, notes: null };
  }
  // Defensive: a row that doesn't actually shape like a token_budgets row
  // (e.g. a generic test stub) coerces to NaN, which would make every
  // comparison return false but leaves the EffectiveBudget in a confusing
  // state for callers. Normalize to null so `enforced=false` cleanly.
  const limit = Number(row.monthly_token_limit);
  return {
    resolvedScope: row.scope_type,
    budgetId: row.id,
    monthlyTokenLimit: Number.isFinite(limit) ? limit : null,
    notes: row.notes ?? null,
  };
}

// ============================================================================
// USAGE AGGREGATION
// ============================================================================

/**
 * Sum a user's token spend in the current calendar month across both Free
 * Agent (agent_iterations.tokens_used) and workflow executions
 * (workflow_executions.total_tokens). Returns 0 if no DB.
 */
export async function getMonthlyUsage(userId: string): Promise<number> {
  if (!isDbAvailable()) return 0;
  try {
    const result = await query<{ total: string | null }>(
      `SELECT COALESCE(SUM(t), 0) AS total
         FROM (
           SELECT COALESCE(ai.tokens_used, 0)::bigint AS t
             FROM agent_iterations ai
             JOIN agent_sessions s ON s.id = ai.session_id
            WHERE s.user_id = $1
              AND ai.created_at >= date_trunc('month', NOW() AT TIME ZONE 'UTC')
           UNION ALL
           SELECT COALESCE(we.total_tokens, 0)::bigint
             FROM workflow_executions we
            WHERE we.user_id = $1
              AND we.started_at >= date_trunc('month', NOW() AT TIME ZONE 'UTC')
         ) usage`,
      [userId],
    );
    return Number(result.rows[0]?.total ?? 0);
  } catch (err) {
    logger.error("Failed to compute monthly usage", err as Error, { userId });
    // Fail open: a usage-query error must not block real work. We return
    // 0 so the guard becomes permissive for this call. The error is logged.
    return 0;
  }
}

// ============================================================================
// PUBLIC: CHECK + STATUS
// ============================================================================

export async function getBudgetStatus(
  userId: string,
  ministryCode: string | null,
): Promise<BudgetStatus> {
  if (!isDbAvailable()) {
    return permissiveStatus(userId, ministryCode, "db_unavailable");
  }

  const [effective, used] = await Promise.all([
    getEffectiveBudget(userId, ministryCode),
    getMonthlyUsage(userId),
  ]);

  if (effective.monthlyTokenLimit === null) {
    // No budget row at all — treat as unlimited. (Migration seeds one, so
    // this branch is defensive only.)
    return {
      userId,
      ministryCode,
      effective,
      used,
      remaining: null,
      exceeded: false,
      enforced: false,
      period: currentMonthPeriod(),
    };
  }

  const limit = effective.monthlyTokenLimit;
  const remaining = Math.max(0, limit - used);
  const exceeded = used >= limit;
  return {
    userId,
    ministryCode,
    effective,
    used,
    remaining,
    exceeded,
    enforced: true,
    period: currentMonthPeriod(),
  };
}

/**
 * Pre-flight: called immediately before an LLM call.
 *
 * This is intentionally a thin wrapper around `getBudgetStatus`. We do NOT
 * throw or short-circuit here — callers (orchestrator / workflow executor)
 * are better positioned to choose between "emit SSE + terminate" vs
 * "log + skip stage", and they own the audit-action surface.
 */
export async function checkBudget(
  userId: string,
  ministryCode: string | null,
): Promise<BudgetStatus> {
  return getBudgetStatus(userId, ministryCode);
}

// ============================================================================
// ADMIN: LIST / UPSERT / DELETE
// ============================================================================

export async function listBudgets(): Promise<BudgetRecord[]> {
  if (!isDbAvailable()) return [];
  const result = await query<Record<string, unknown>>(
    `SELECT id, scope_type, scope_id, monthly_token_limit, notes,
            created_by, created_at, updated_at
       FROM token_budgets
       ORDER BY CASE scope_type
                  WHEN 'user' THEN 1
                  WHEN 'ministry' THEN 2
                  WHEN 'global' THEN 3
                END,
                scope_id`,
  );
  return result.rows.map(rowToRecord);
}

export interface SetBudgetInput {
  scopeType: BudgetScopeType;
  scopeId: string;
  monthlyTokenLimit: number;
  notes?: string | null;
  createdBy?: string | null;
}

export class BudgetValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetValidationError";
  }
}

function normalizeInput(input: SetBudgetInput): SetBudgetInput {
  if (!["user", "ministry", "global"].includes(input.scopeType)) {
    throw new BudgetValidationError(`Invalid scopeType: ${input.scopeType}`);
  }
  if (!Number.isFinite(input.monthlyTokenLimit) || input.monthlyTokenLimit < 0) {
    throw new BudgetValidationError("monthlyTokenLimit must be a non-negative finite number");
  }
  if (!Number.isSafeInteger(input.monthlyTokenLimit)) {
    throw new BudgetValidationError("monthlyTokenLimit must be an integer");
  }
  // For global, scope_id is fixed to the literal "global" so we don't get
  // sibling rows like ('global','default'), ('global','main') by accident.
  const scopeId = input.scopeType === "global" ? "global" : (input.scopeId || "").trim();
  if (!scopeId) {
    throw new BudgetValidationError("scopeId is required for non-global scopes");
  }
  return { ...input, scopeId };
}

export async function setBudget(input: SetBudgetInput): Promise<BudgetRecord> {
  const normalized = normalizeInput(input);
  const result = await query<Record<string, unknown>>(
    `INSERT INTO token_budgets
       (scope_type, scope_id, monthly_token_limit, notes, created_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (scope_type, scope_id)
       DO UPDATE SET
         monthly_token_limit = EXCLUDED.monthly_token_limit,
         notes = EXCLUDED.notes,
         updated_at = NOW()
     RETURNING id, scope_type, scope_id, monthly_token_limit, notes,
               created_by, created_at, updated_at`,
    [
      normalized.scopeType,
      normalized.scopeId,
      normalized.monthlyTokenLimit,
      normalized.notes ?? null,
      normalized.createdBy ?? null,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error("setBudget: row not returned from upsert");
  return rowToRecord(row);
}

/**
 * Delete a budget row. The global default row cannot be deleted — admins
 * tighten it instead.
 *
 * Returns true if a row was deleted, false if not found, throws on
 * attempted deletion of the global default.
 */
export async function deleteBudget(scopeType: BudgetScopeType, scopeId: string): Promise<boolean> {
  if (scopeType === "global") {
    throw new BudgetValidationError("Cannot delete the global default. Update it instead.");
  }
  const result = await query(
    `DELETE FROM token_budgets WHERE scope_type = $1 AND scope_id = $2`,
    [scopeType, scopeId],
  );
  return (result.rowCount ?? 0) > 0;
}

// ============================================================================
// ADMIN: AGGREGATE USAGE
// ============================================================================

/**
 * One-shot list of every user who has used any tokens this month, plus the
 * effective budget that applies to them. Used by the admin Budgets panel
 * to surface "who is close to their cap" without a per-user round trip.
 *
 * `limit` caps the result set; defaults to 200.
 */
export async function listMonthlyUsage(limit: number = 200): Promise<UsageRow[]> {
  if (!isDbAvailable()) return [];

  // Build a unified per-user usage CTE then LATERAL-join to the budget
  // resolver. The CTE pulls from both source tables; LIMIT applies after
  // ranking by usage so admins see the heaviest users first.
  const result = await query<{
    user_id: string;
    user_email: string | null;
    user_display_name: string | null;
    ministry_code: string | null;
    used: string;
    effective_limit: string | null;
    effective_scope: BudgetScopeType | null;
  }>(
    `WITH usage AS (
       SELECT s.user_id, COALESCE(SUM(ai.tokens_used), 0)::bigint AS tokens
         FROM agent_iterations ai
         JOIN agent_sessions s ON s.id = ai.session_id
        WHERE ai.created_at >= date_trunc('month', NOW() AT TIME ZONE 'UTC')
        GROUP BY s.user_id
       UNION ALL
       SELECT we.user_id, COALESCE(SUM(we.total_tokens), 0)::bigint
         FROM workflow_executions we
        WHERE we.started_at >= date_trunc('month', NOW() AT TIME ZONE 'UTC')
        GROUP BY we.user_id
     ),
     agg AS (
       SELECT user_id, SUM(tokens)::bigint AS used
         FROM usage
        GROUP BY user_id
     )
     SELECT
       u.id AS user_id,
       u.email AS user_email,
       u.display_name AS user_display_name,
       u.ministry_code,
       agg.used AS used,
       (SELECT monthly_token_limit FROM token_budgets b
          WHERE (b.scope_type = 'user'     AND b.scope_id = u.id::text)
             OR (b.scope_type = 'ministry' AND b.scope_id = u.ministry_code)
             OR (b.scope_type = 'global'   AND b.scope_id = 'global')
          ORDER BY CASE b.scope_type
                     WHEN 'user' THEN 1
                     WHEN 'ministry' THEN 2
                     WHEN 'global' THEN 3
                   END
          LIMIT 1) AS effective_limit,
       (SELECT scope_type FROM token_budgets b
          WHERE (b.scope_type = 'user'     AND b.scope_id = u.id::text)
             OR (b.scope_type = 'ministry' AND b.scope_id = u.ministry_code)
             OR (b.scope_type = 'global'   AND b.scope_id = 'global')
          ORDER BY CASE b.scope_type
                     WHEN 'user' THEN 1
                     WHEN 'ministry' THEN 2
                     WHEN 'global' THEN 3
                   END
          LIMIT 1) AS effective_scope
     FROM agg
     JOIN users u ON u.id = agg.user_id
     ORDER BY agg.used DESC
     LIMIT $1`,
    [limit],
  );

  return result.rows.map((r) => {
    const used = Number(r.used ?? 0);
    const limit = r.effective_limit === null ? null : Number(r.effective_limit);
    return {
      userId: r.user_id,
      userEmail: r.user_email,
      userDisplayName: r.user_display_name,
      ministryCode: r.ministry_code,
      used,
      effectiveLimit: limit,
      effectiveScope: r.effective_scope,
      remaining: limit === null ? null : Math.max(0, limit - used),
      exceeded: limit !== null && used >= limit,
    };
  });
}

// ============================================================================
// WORKFLOW HELPER
// ============================================================================

/**
 * Record the final token spend for a workflow execution. The executor calls
 * this once at the end of a run so the denormalized column matches reality
 * even when stage_results doesn't carry per-stage totals.
 */
export async function recordWorkflowTokens(
  workflowExecutionId: string,
  totalTokens: number,
): Promise<void> {
  if (!isDbAvailable()) return;
  if (!Number.isFinite(totalTokens) || totalTokens < 0) return;
  try {
    await query(
      `UPDATE workflow_executions
          SET total_tokens = $1
        WHERE id = $2`,
      [Math.floor(totalTokens), workflowExecutionId],
    );
  } catch (err) {
    logger.error("Failed to update workflow_executions.total_tokens", err as Error, {
      workflowExecutionId,
      totalTokens,
    });
  }
}
