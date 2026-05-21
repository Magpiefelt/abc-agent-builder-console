/**
 * Thin typed fetch helper for talking to the backend.
 *
 * Stream A will replace the bearer-token interceptor below with a real
 * MSAL-issued access token once Entra ID is wired up. For now, the dev-mock
 * user middleware on the backend accepts any (or missing) token.
 */

import type {
  AuthUser,
  AuditEntry,
  PIIDetection,
  ModelRegistryEntry,
  SessionSummary,
  HealthDetailed,
  RetentionReport,
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
  me: () => fetchJson<{ user: AuthUser }>("/api/me"),

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
  },

  health: {
    detailed: () => fetchJson<HealthDetailed>("/api/health/detailed"),
  },
};
