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
  /**
   * - `hard_delete`: direct DELETE of rows past their retention window.
   * - `anonymize`: rows kept (for audit-trail obligations) but PII / user
   *   linkage stripped.
   * - `cascade`: deletion count reported for a child table whose rows were
   *   removed by an ON DELETE CASCADE on a parent (e.g. `agent_iterations`
   *   when `agent_sessions` are hard-deleted).
   */
  strategy: "hard_delete" | "anonymize" | "cascade";
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

/**
 * A soft-deleted workflow as returned by `GET /api/admin/workflows/trash`.
 * `expiresAt` is the computed point at which the retention job will purge
 * the row (= `deletedAt + WORKFLOW_TRASH_RETENTION_DAYS`).
 */
export interface WorkflowTrashEntry {
  id: string;
  userId: string;
  userEmail: string | null;
  userDisplayName: string | null;
  ministryCode: string | null;
  name: string;
  description: string | null;
  classification: string;
  isTemplate: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string;
  expiresAt: string;
}

export interface WorkflowTrashResponse {
  workflows: WorkflowTrashEntry[];
  count: number;
  retentionDays: number;
}

// ============================================================================
// Operational dashboard
// ============================================================================
// Mirrors backend/src/routes/admin.ts GET /api/admin/dashboard payload. Keep in
// sync. Numbers are pre-aggregated by SQL — no need for client-side reduce.

export interface DashboardWindowCount {
  windowLabel: "24h" | "7d" | "30d";
  count: number;
}

export interface DashboardStatusBreakdown {
  status: string;
  count: number;
}

export interface DashboardClassificationBreakdown {
  classification: string;
  count: number;
}

export interface DashboardToolUsage {
  tool: string;
  calls: number;
  successes: number;
}

export interface DashboardModelUsage {
  modelId: string;
  sessions: number;
}

export interface DashboardSummary {
  generatedAt: string;
  sessions: {
    totals: DashboardWindowCount[];
    byStatus: DashboardStatusBreakdown[];
    byClassification: DashboardClassificationBreakdown[];
  };
  workflowExecutions: {
    totals: DashboardWindowCount[];
    byStatus: DashboardStatusBreakdown[];
  };
  tools: DashboardToolUsage[];
  models: DashboardModelUsage[];
  pii: {
    last7Days: number;
    byType: { detectionType: string; count: number }[];
    byAction: { action: string; count: number }[];
  };
}

// ============================================================================
// Token budgets (Bot 15, Backlog B1)
// ============================================================================

export type BudgetScopeType = "user" | "ministry" | "global";

export interface TokenBudget {
  id: string;
  scopeType: BudgetScopeType;
  scopeId: string;
  monthlyTokenLimit: number;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetUsageRow {
  userId: string;
  userEmail: string | null;
  userDisplayName: string | null;
  ministryCode: string | null;
  used: number;
  effectiveLimit: number | null;
  effectiveScope: BudgetScopeType | null;
  remaining: number | null;
  exceeded: boolean;
}

export interface MyBudgetStatus {
  scope: BudgetScopeType;
  limit: number | null;
  used: number;
  remaining: number | null;
  exceeded: boolean;
  enforced: boolean;
  periodStart: string | null;
  periodEnd: string | null;
}

// ============================================================================
// WEBHOOK SUBSCRIPTIONS (Bot 21 — Backlog B3)
// ============================================================================

export type WebhookEventType = "session.completed" | "workflow.completed";

export interface WebhookSubscription {
  id: string;
  ministryCode: string | null;
  eventType: WebhookEventType;
  url: string;
  secretLabel: string;
  enabled: boolean;
  description: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  lastDeliveryAt: string | null;
  lastDeliveryStatus: string | null;
}

export interface WebhookSubscriptionInput {
  eventType: WebhookEventType;
  url: string;
  secretLabel: string;
  enabled?: boolean;
  description?: string | null;
  ministryCode?: string | null;
}

export interface WebhookDelivery {
  id: string;
  subscription_id: string;
  event_type: WebhookEventType;
  resource_id: string | null;
  attempt: number;
  signature: string;
  response_status: number | null;
  response_body_preview: string | null;
  duration_ms: number | null;
  error: string | null;
  delivered_at: string;
}

export interface WebhookDispatchResult {
  subscriptionId: string;
  outcome: "success" | "client_error" | "exhausted" | "skipped";
  attempts: number;
  finalStatus: number | null;
  error: string | null;
}

// ============================================================================
// COMPLIANCE EVIDENCE (Bot 22 — Backlog S2)
// ============================================================================
// Mirrors backend/src/services/evidenceCollector.ts.

export interface EvidenceSectionNotApplicable {
  status: "not_applicable_yet";
  reason: string;
}

export interface EvidenceControlsMatrixSection {
  status: "ok";
  total: number;
  inPlace: number;
  partial: number;
  outstanding: number;
  sourceFile: string;
}

export interface EvidenceAuditRetentionSection {
  status: "ok";
  totalRows: number;
  oldestEntry: string | null;
  topActions: Array<{ action: string; count: number }>;
}

export interface EvidencePiiDetectionsSection {
  status: "ok";
  windowDays: number;
  byClassification: Array<{ classification: string; count: number }>;
  total: number;
}

export interface EvidenceModelRegistrySection {
  status: "ok";
  active: number;
  inactive: number;
  byClassification: Array<{ classification: string; count: number }>;
}

export interface EvidenceRetentionJobSection {
  status: "ok";
  lastRunAt: string | null;
  lastRunDetails: Record<string, unknown> | null;
}

export interface EvidenceWebhookDeliveriesSection {
  status: "ok";
  windowHours: number;
  delivered: number;
  failed: number;
  exhausted: number;
}

export interface EvidenceTokenBudgetsSection {
  status: "ok";
  byScopeType: Array<{ scopeType: string; count: number }>;
  total: number;
}

export interface EvidenceSnapshot {
  generatedAt: string;
  date: string;
  version: string;
  sections: {
    controlsMatrix: EvidenceControlsMatrixSection | EvidenceSectionNotApplicable;
    auditRetention: EvidenceAuditRetentionSection | EvidenceSectionNotApplicable;
    piiDetections: EvidencePiiDetectionsSection | EvidenceSectionNotApplicable;
    modelRegistry: EvidenceModelRegistrySection | EvidenceSectionNotApplicable;
    retentionJob: EvidenceRetentionJobSection | EvidenceSectionNotApplicable;
    webhookDeliveries: EvidenceWebhookDeliveriesSection | EvidenceSectionNotApplicable;
    tokenBudgets: EvidenceTokenBudgetsSection | EvidenceSectionNotApplicable;
  };
}

export interface EvidenceCollectionSummary {
  id: string;
  collectedAt: string;
  periodStart: string;
  periodEnd: string;
  triggeredBy: string;
  userId: string | null;
  sourceVersion: string;
  rowCounts: Record<string, number>;
  auditTotal: number;
  piiTotal: number;
  modelTotalActive: number;
}

export interface EvidenceCollectionDetail extends EvidenceCollectionSummary {
  summary: EvidenceSnapshot;
  markdown: string;
}

export interface EvidenceRunResult {
  filename: string;
  filePath: string;
  snapshot: EvidenceSnapshot;
  markdown: string;
}

export interface EvidenceLatest {
  filename: string;
  filePath: string;
  date: string;
  markdown: string;
}
