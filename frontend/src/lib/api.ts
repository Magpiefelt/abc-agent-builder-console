/**
 * Thin typed fetch helper for talking to the admin and health endpoints.
 *
 * Authentication: relies on Stream A's HttpOnly cookie session set up by
 * `/api/auth/login` / `/api/auth/callback`. `credentials: 'include'` ships
 * the cookie with every request. Stream A's `stores/auth.ts` handles `/api/auth/me`
 * directly (not via this helper) so this module focuses on admin + health.
 */

import type {
  AuditEntry,
  PIIDetection,
  ModelRegistryEntry,
  SessionSummary,
  HealthDetailed,
  RetentionReport,
  DashboardSummary,
  WorkflowTrashResponse,
  TokenBudget,
  BudgetUsageRow,
  BudgetScopeType,
  MyBudgetStatus,
  WebhookSubscription,
  WebhookSubscriptionInput,
  WebhookDelivery,
  WebhookDispatchResult,
  EvidenceCollectionSummary,
  EvidenceCollectionDetail,
  EvidenceRunResult,
  EvidenceLatest,
} from "@/types/admin";

// Same-origin in production; Vite proxies /api to localhost:3000 in dev.
// Override via VITE_API_BASE_URL if the backend lives elsewhere.
const BASE: string = import.meta.env.VITE_API_BASE_URL ?? "";

export class ApiError extends Error {
  status: number;
  payload: unknown;
  constructor(status: number, message: string, payload: unknown) {
    super(message);
    this.status = status;
    this.payload = payload;
    this.name = "ApiError";
  }
}

async function fetchJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    ...init,
  });

  let payload: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    const errorMsg =
      (typeof payload === "object" && payload !== null && "error" in payload
        ? String((payload as { error: unknown }).error)
        : null) || `${response.status} ${response.statusText}`;
    throw new ApiError(response.status, errorMsg, payload);
  }

  return payload as T;
}

function toQuery(params: Record<string, unknown>): string {
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => [k, String(v)] as [string, string]);
  return entries.length ? `?${new URLSearchParams(entries).toString()}` : "";
}

export const api = {
  admin: {
    audit: (params: {
      action?: string;
      user_id?: string;
      from?: string;
      to?: string;
      limit?: number;
    }) =>
      fetchJson<{ entries: AuditEntry[]; count: number }>(
        `/api/admin/audit${toQuery(params)}`
      ),

    piiDetections: (params: { limit?: number } = {}) =>
      fetchJson<{ detections: PIIDetection[]; count: number }>(
        `/api/admin/pii-detections${toQuery(params)}`
      ),

    models: () =>
      fetchJson<{ models: ModelRegistryEntry[]; count: number }>(
        "/api/admin/models"
      ),

    updateModel: (id: number, body: { is_active: boolean }) =>
      fetchJson<{ model: ModelRegistryEntry }>(`/api/admin/models/${id}`, {
        method: "PUT",
        body: JSON.stringify(body),
      }),

    sessions: (params: { status?: string; limit?: number } = {}) =>
      fetchJson<{ sessions: SessionSummary[]; count: number }>(
        `/api/admin/sessions${toQuery(params)}`
      ),

    runRetention: () =>
      fetchJson<{ report: RetentionReport }>("/api/admin/retention/run", {
        method: "POST",
      }),

    dashboard: () => fetchJson<DashboardSummary>("/api/admin/dashboard"),

    workflowTrash: () =>
      fetchJson<WorkflowTrashResponse>("/api/admin/workflows/trash"),

    restoreWorkflow: (id: string) =>
      fetchJson<{ id: string; restored: true; name: string }>(
        `/api/admin/workflows/${id}/restore`,
        { method: "POST" }
      ),

    purgeWorkflow: (id: string) =>
      fetchJson<{ id: string; purged: true; name: string }>(
        `/api/admin/workflows/${id}/purge`,
        { method: "POST" }
      ),

    /**
     * FOIP s.7 right-of-access export. The backend already audit-logs the
     * action (`USER_DATA_EXPORTED`); admins must reach this through the
     * AuditLogViewer's confirmation modal so the request is intentional.
     * Returns the raw `Blob` + the server-supplied filename so the caller
     * can trigger a browser download without going through fetchJson (which
     * is JSON-only).
     */
    exportUserData: async (
      userId: string,
    ): Promise<{ blob: Blob; filename: string }> => {
      const response = await fetch(`${BASE}/api/admin/users/${userId}/export`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        // Try to surface the server's structured error message ({ error: "..." })
        // before falling back to the HTTP status line. If the body isn't JSON
        // (e.g. an HTML 502 from a reverse proxy) we still get a useful string.
        let payload: unknown = null;
        try {
          payload = await response.json();
        } catch {
          payload = await response.text().catch(() => null);
        }
        const message =
          (typeof payload === "object" &&
          payload !== null &&
          "error" in payload
            ? String((payload as { error: unknown }).error)
            : null) || `${response.status} ${response.statusText}`;
        throw new ApiError(response.status, message, payload);
      }

      // Prefer the server-supplied filename; fall back to a date-stamped name
      // if the header is missing or malformed so the download still works.
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const match = /filename="?([^";]+)"?/i.exec(disposition);
      const filename =
        match?.[1] ??
        `abc-user-${userId.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.zip`;

      const blob = await response.blob();
      return { blob, filename };
    },

    /**
     * Per-user / per-ministry / global monthly token budgets (Bot 15, B1).
     * The budget guard reads these rows before every LLM call to prevent
     * runaway loops from burning unbounded tokens.
     */
    listBudgets: () =>
      fetchJson<{ budgets: TokenBudget[]; count: number }>("/api/admin/budgets"),

    upsertBudget: (body: {
      scope_type: BudgetScopeType;
      scope_id: string;
      monthly_token_limit: number;
      notes?: string | null;
    }) =>
      fetchJson<{ budget: TokenBudget }>("/api/admin/budgets", {
        method: "PUT",
        body: JSON.stringify(body),
      }),

    deleteBudget: (scopeType: BudgetScopeType, scopeId: string) =>
      fetchJson<{ deleted: true; scopeType: BudgetScopeType; scopeId: string }>(
        `/api/admin/budgets/${scopeType}/${encodeURIComponent(scopeId)}`,
        { method: "DELETE" },
      ),

    budgetUsage: (params: { limit?: number } = {}) =>
      fetchJson<{ usage: BudgetUsageRow[]; count: number }>(
        `/api/admin/budgets/usage${toQuery(params)}`,
      ),

    /**
     * Webhook subscriptions for outbound session/workflow completion events
     * (Bot 21, Backlog B3). Signing scheme uses the secrets vault key + a
     * per-subscription label so rotation is one DB write.
     */
    webhooks: {
      list: () =>
        fetchJson<{ subscriptions: WebhookSubscription[] }>(
          "/api/admin/webhooks",
        ),

      get: (id: string) =>
        fetchJson<WebhookSubscription>(
          `/api/admin/webhooks/${encodeURIComponent(id)}`,
        ),

      create: (body: WebhookSubscriptionInput) =>
        fetchJson<WebhookSubscription>("/api/admin/webhooks", {
          method: "POST",
          body: JSON.stringify(body),
        }),

      update: (id: string, body: Partial<WebhookSubscriptionInput>) =>
        fetchJson<WebhookSubscription>(
          `/api/admin/webhooks/${encodeURIComponent(id)}`,
          {
            method: "PUT",
            body: JSON.stringify(body),
          },
        ),

      remove: (id: string) =>
        fetchJson<{ id: string; deleted: true }>(
          `/api/admin/webhooks/${encodeURIComponent(id)}`,
          { method: "DELETE" },
        ),

      test: (id: string) =>
        fetchJson<WebhookDispatchResult>(
          `/api/admin/webhooks/${encodeURIComponent(id)}/test`,
          { method: "POST" },
        ),

      deliveries: (id: string, params: { limit?: number } = {}) =>
        fetchJson<{ deliveries: WebhookDelivery[] }>(
          `/api/admin/webhooks/${encodeURIComponent(id)}/deliveries${toQuery(params)}`,
        ),
    },
  },

  /**
   * SOC2 / ATO compliance-evidence snapshots (Bot 22, Backlog S2). The
   * collector aggregates audit-log totals, PII detections, model registry
   * state, retention pass history, webhook delivery outcomes, and the
   * controls-matrix file hash into a single Markdown artifact per pass.
   */
  compliance: {
    list: (params: { limit?: number } = {}) =>
      fetchJson<{ collections: EvidenceCollectionSummary[] }>(
        `/api/compliance/evidence${toQuery(params)}`,
      ),

    get: (id: string) =>
      fetchJson<EvidenceCollectionDetail>(
        `/api/compliance/evidence/${encodeURIComponent(id)}`,
      ),

    latest: () =>
      fetchJson<EvidenceLatest>("/api/compliance/evidence/latest"),

    generate: () =>
      fetchJson<EvidenceRunResult>("/api/compliance/evidence/run", {
        method: "POST",
      }),
  },

  users: {
    myBudget: () => fetchJson<MyBudgetStatus>("/api/users/me/budget"),
  },

  health: {
    detailed: () => fetchJson<HealthDetailed>("/api/health/detailed"),
  },
};
