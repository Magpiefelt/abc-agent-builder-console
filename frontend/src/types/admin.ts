/**
 * Frontend mirrors of backend DTOs. Kept hand-synced (no shared package).
 * See backend/src/services/auditLogger.ts, piiDetector.ts, llmProvider.ts.
 *
 * AuthUser lives in `@/types/auth` (Stream A); re-exported here for convenience.
 */

export type { AuthUser } from "@/types/auth";

export interface AuditEntry {
  id: number;
  user_id: string | null;
  ministry_code: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
}

export interface PIIDetection {
  id: number;
  user_id: string | null;
  session_id: string | null;
  detection_type: string;
  pattern_matched: string;
  action_taken: "blocked" | "redacted" | "flagged" | "allowed";
  context_snippet: string | null;
  created_at: string;
  user_email?: string | null;
  user_display_name?: string | null;
}

export interface ModelRegistryEntry {
  id: number;
  model_id: string;
  display_name: string;
  provider: "vertex_ai" | "openai" | "anthropic" | "xai" | "google";
  api_model_name: string;
  max_output_tokens: number;
  supports_streaming: boolean;
  supports_tools: boolean;
  data_residency: string;
  max_classification: "unclassified" | "protected_a" | "protected_b";
  is_active: boolean;
  created_at: string;
}

export type SessionStatus =
  | "idle"
  | "running"
  | "paused"
  | "completed"
  | "error"
  | "needs_assistance";

export interface SessionSummary {
  id: string;
  status: SessionStatus;
  model_id: string;
  classification: string;
  current_iteration: number;
  max_iterations: number;
  user_id: string;
  ministry_code: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  user_email?: string | null;
  user_display_name?: string | null;
}

export interface PoolStats {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
  queryCount: number;
  slowQueryCount: number;
  errorCount: number;
}

export interface TokenStats {
  totalPromptTokens: number;
  totalCompletionTokens: number;
  callCount: number;
  windowMinutes: number;
}

export interface MemoryStats {
  rssMb: number;
  heapTotalMb: number;
  heapUsedMb: number;
  externalMb: number;
}

export interface HealthDetailed {
  status: "healthy" | "degraded";
  timestamp: string;
  version: string;
  nodeVersion: string;
  environment: string;
  uptimeSeconds: number;
  memory: MemoryStats;
  pool: PoolStats;
  tokens: TokenStats;
  services: Record<string, string>;
  retention: { enabled: boolean; hour: number };
}

export interface RetentionTableReport {
  table: string;
  strategy: "hard_delete" | "anonymize";
  classification: string;
  cutoffDays: number;
  rowsAffected: number;
}

export interface RetentionReport {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  totalRowsAffected: number;
  byTable: RetentionTableReport[];
  errors: string[];
}
