/**
 * Workflow canvas type definitions (Stream C).
 *
 * `canvas_data` is persisted as JSONB on the `workflows` table. Shape:
 *   { nodes: CanvasNode[], edges: CanvasEdge[], version: 1 }
 *
 * V1 keeps edges as pure adjacency. `sourceHandle` / `targetHandle` are
 * reserved for V2 handle-based branch routing.
 */

export type Classification = 'unclassified' | 'protected_a' | 'protected_b';

export type NodeKind = 'agent' | 'function' | 'tool' | 'note';

export interface AgentNodeData {
  kind: 'agent';
  label: string;
  templateId?: string;
  systemPromptOverride?: string;
  modelId: string;
  classification: Classification;
  tools: string[];
  temperature?: number;
  maxTokens?: number;
}

export interface FunctionNodeData {
  kind: 'function';
  label: string;
  fnName: string;
  params: Record<string, unknown>;
}

export interface ToolNodeData {
  kind: 'tool';
  label: string;
  toolName: string;
  params: Record<string, unknown>;
}

export interface NoteNodeData {
  kind: 'note';
  label: string;
  markdown: string;
}

export type NodeData = AgentNodeData | FunctionNodeData | ToolNodeData | NoteNodeData;

export interface CanvasNode {
  id: string;
  type: NodeKind;
  position: { x: number; y: number };
  data: NodeData;
}

export interface CanvasEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  label?: string;
}

export interface CanvasData {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  version: 1;
}

export interface WorkflowSummary {
  id: string;
  name: string;
  description: string | null;
  classification: Classification;
  version: number;
  is_template: boolean;
  /**
   * Free-form discovery tags (Bot 17, F5). Always present as an array; the
   * backend normalises to lowercase and dedupes, so list/search code can
   * compare strings directly. Empty array when a workflow has no tags.
   */
  tags: string[];
  ministry_code: string | null;
  user_id: string;
  updated_at: string;
  created_at: string;
}

export interface Workflow extends WorkflowSummary {
  canvas_data: CanvasData;
}

export interface AgentTemplate {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  defaultModel: string;
  defaultTools: string[];
}

export interface FunctionCatalogParam {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  required: boolean;
  default?: unknown;
  description?: string;
}

export interface FunctionCatalogEntry {
  name: string;
  category: 'text-transform' | 'math' | 'parse' | 'format' | 'branch';
  description: string;
  params: FunctionCatalogParam[];
  outputType: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'any';
}

export interface ToolManifestEntry {
  name: string;
  category: string;
  description: string;
  parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
}

export interface WorkflowLibrary {
  agentTemplates: AgentTemplate[];
  functionCatalog: FunctionCatalogEntry[];
  tools: ToolManifestEntry[];
}

export type StageStatus = 'pending' | 'running' | 'completed' | 'skipped' | 'error';

export interface StageState {
  nodeId: string;
  kind: NodeKind;
  status: StageStatus;
  stageIndex?: number;
  startedAt?: number;
  durationMs?: number;
  value?: unknown;
  tokens?: number;
  error?: string;
  reason?: string;
  piiBlockedCount?: number;
}

export type ExecutionStatus = 'idle' | 'running' | 'completed' | 'error' | 'aborted';

export interface ExecutionState {
  id: string;
  status: ExecutionStatus;
  stages: Map<string, StageState>;
  startedAt: number;
  completedAt?: number;
  error?: string;
  piiBlockedTotal: number;
  /**
   * True when the active execution was launched in dry-run mode. The UI uses
   * this to render a clear banner so an operator never confuses stub stage
   * output with real output. Set on workflow_start; cleared on clearExecution.
   */
  dryRun?: boolean;
}

export interface WorkflowVersionSummary {
  version: number;
  createdBy: string;
  createdByEmail: string | null;
  createdByDisplayName: string | null;
  createdAt: string;
}

export interface WorkflowVersionListResponse {
  currentVersion: number | null;
  versions: WorkflowVersionSummary[];
}

export interface WorkflowVersionDetail {
  workflowId: string;
  version: number;
  canvasData: CanvasData;
  createdBy: string;
  createdAt: string;
}

export type ExecutionRecordStatus = 'running' | 'completed' | 'error' | 'aborted';

export interface WorkflowExecutionSummary {
  id: string;
  workflowId: string;
  userId: string;
  userEmail: string | null;
  userDisplayName: string | null;
  classification: Classification;
  status: ExecutionRecordStatus;
  error: string | null;
  stageCount: number;
  durationMs: number | null;
  startedAt: string;
  completedAt: string | null;
}

export interface WorkflowExecutionListResponse {
  executions: WorkflowExecutionSummary[];
  count: number;
}

export interface WorkflowExecutionStageResult {
  nodeId: string;
  kind: NodeKind;
  status: 'completed' | 'skipped' | 'error';
  value?: unknown;
  durationMs?: number;
  tokens?: number;
  error?: string;
  reason?: string;
}

export interface WorkflowExecutionDetail extends WorkflowExecutionSummary {
  stageResults: WorkflowExecutionStageResult[];
}

export interface ModelPrice {
  inputPerMillion: number;
  outputPerMillion: number;
}

export interface PerNodeCostEstimate {
  nodeId: string;
  label: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  inputCost: number | null;
  outputCost: number | null;
  isPriced: boolean;
}

export interface WorkflowCostEstimate {
  agentCallCount: number;
  toolCallCount: number;
  functionCallCount: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  perNode: PerNodeCostEstimate[];
  total: {
    inputCost: number;
    outputCost: number;
    totalCost: number;
    currency: string;
  };
  unknownModels: string[];
  assumesAllBranches: boolean;
  pricingTable: Record<string, ModelPrice>;
  currency: string;
}

export type SSEEvent =
  | { type: 'workflow_start'; executionId: string; workflowId: string; totalStages: number; classification: Classification; dryRun?: boolean }
  | { type: 'stage_start'; executionId: string; nodeId: string; kind: NodeKind; stageIndex: number }
  | { type: 'stage_complete'; executionId: string; nodeId: string; kind: NodeKind; stageIndex: number; durationMs: number; value: unknown; tokens?: number }
  | { type: 'stage_skipped'; executionId: string; nodeId: string; reason: 'branch_unmatched' | 'note' | 'pruned' }
  | { type: 'stage_error'; executionId: string; nodeId: string; error: string; stageIndex: number }
  | { type: 'pii_warning'; executionId: string; nodeId: string; blockedCount: number }
  | { type: 'workflow_complete'; executionId: string; status: ExecutionStatus; stageCount: number; durationMs: number; error?: string; dryRun?: boolean }
  | { type: 'error'; error: string; code?: string; nodeIds?: string[] };
