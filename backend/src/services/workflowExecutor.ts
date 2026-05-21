/**
 * Workflow Executor (Stream C)
 *
 * Walks a Vue-Flow canvas graph topologically and executes each stage:
 *   - Agent nodes  → callLLM with upstream context
 *   - Function nodes → runFunction from functionRegistry (deterministic)
 *   - Tool nodes   → dispatchToolCalls (re-uses Free Agent infrastructure)
 *   - Note nodes   → skipped
 *
 * V1 limitations:
 *   - Sequential execution (no parallel branches even when topo allows).
 *   - Memory mutations from tools are discarded (workflows have no shared memory).
 *   - Branch is a Function category: returns { matched: boolean } and prunes the
 *     downstream subtree when matched=false.
 *   - ${nodeId} / ${nodeId.path} string templating in tool/function params only.
 */

import { Response } from "express";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { query } from "../config/database.js";
import { callLLM, validateModelClassification } from "./llmProvider.js";
import { dispatchToolCalls, type ToolCall } from "./toolDispatcher.js";
import { runFunction, isBranchFunction } from "./functionRegistry.js";
import { scanForPII } from "./piiDetector.js";
import { logAudit, AuditAction } from "./auditLogger.js";
import { logger } from "./logger.js";

// ============================================================================
// TYPES
// ============================================================================

type Classification = "unclassified" | "protected_a" | "protected_b";
type NodeKind = "agent" | "function" | "tool" | "note";

interface AgentNodeData {
  kind: "agent";
  label: string;
  templateId?: string;
  systemPromptOverride?: string;
  modelId: string;
  classification: Classification;
  tools: string[];
  temperature?: number;
  maxTokens?: number;
}

interface FunctionNodeData {
  kind: "function";
  label: string;
  fnName: string;
  params: Record<string, unknown>;
}

interface ToolNodeData {
  kind: "tool";
  label: string;
  toolName: string;
  params: Record<string, unknown>;
}

interface NoteNodeData {
  kind: "note";
  label: string;
  markdown: string;
}

type NodeData = AgentNodeData | FunctionNodeData | ToolNodeData | NoteNodeData;

interface CanvasNode {
  id: string;
  type: NodeKind;
  position: { x: number; y: number };
  data: NodeData;
}

interface CanvasEdge {
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

export interface WorkflowRecord {
  id: string;
  user_id: string;
  ministry_code: string | null;
  name: string;
  classification: Classification;
  canvas_data: CanvasData;
  version: number;
}

export interface ExecutionContext {
  userId: string;
  ministryCode: string | null;
  continueOnError: boolean;
  /** Called with the newly created workflow_executions.id once persisted. */
  onExecutionCreated?: (executionId: string) => void;
}

export interface SSEEvent {
  type: string;
  [key: string]: unknown;
}

interface StageOutput {
  nodeId: string;
  kind: NodeKind;
  value: unknown;
  durationMs: number;
  tokens?: number;
  status: "completed" | "skipped" | "error";
  error?: string;
  reason?: string;
}

// ============================================================================
// ACTIVE EXECUTIONS REGISTRY (abort on disconnect)
// ============================================================================

const activeExecutions: Map<string, { abort: boolean }> = new Map();

export function abortExecution(executionId: string): void {
  const e = activeExecutions.get(executionId);
  if (e) e.abort = true;
}

/** True when the executor is still iterating stages for this execution id. */
export function isExecutionRunning(executionId: string): boolean {
  return activeExecutions.has(executionId);
}

// ============================================================================
// AGENT TEMPLATE LOADING
// ============================================================================

const __dirname = dirname(fileURLToPath(import.meta.url));
const templatesPath = resolve(__dirname, "../data/agentTemplates.json");
const templatesFile: { templates: { id: string; systemPrompt: string }[] } =
  JSON.parse(readFileSync(templatesPath, "utf-8"));

function resolveSystemPrompt(node: AgentNodeData): string {
  if (node.systemPromptOverride && node.systemPromptOverride.trim()) {
    return node.systemPromptOverride;
  }
  if (node.templateId) {
    const t = templatesFile.templates.find((x) => x.id === node.templateId);
    if (t) return t.systemPrompt;
  }
  return "You are an assistant in a workflow pipeline. Use the upstream context to continue the pipeline.";
}

// ============================================================================
// SSE HELPERS
// ============================================================================

function sendSSE(res: Response, event: SSEEvent): void {
  try {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  } catch (err) {
    logger.error("Failed to send SSE", err);
  }
}

function sendHeartbeat(res: Response): void {
  try {
    if (!res.writableEnded) {
      res.write(`: heartbeat\n\n`);
    }
  } catch {
    /* connection closed */
  }
}

// ============================================================================
// GRAPH ALGORITHMS
// ============================================================================

interface GraphAnalysis {
  topoOrder: string[];
  cycle: string[] | null;
  parents: Map<string, string[]>;
  children: Map<string, string[]>;
}

function analyzeGraph(nodes: CanvasNode[], edges: CanvasEdge[]): GraphAnalysis {
  const nodeIds = new Set(nodes.map((n) => n.id));
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  const indegree = new Map<string, number>();

  for (const n of nodes) {
    parents.set(n.id, []);
    children.set(n.id, []);
    indegree.set(n.id, 0);
  }

  for (const e of edges) {
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue;
    parents.get(e.target)!.push(e.source);
    children.get(e.source)!.push(e.target);
    indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1);
  }

  // Kahn's algorithm
  const queue: string[] = [];
  for (const [id, deg] of indegree) {
    if (deg === 0) queue.push(id);
  }
  const topoOrder: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    topoOrder.push(id);
    for (const child of children.get(id) ?? []) {
      const d = (indegree.get(child) ?? 0) - 1;
      indegree.set(child, d);
      if (d === 0) queue.push(child);
    }
  }

  if (topoOrder.length !== nodes.length) {
    const remaining = nodes.map((n) => n.id).filter((id) => !topoOrder.includes(id));
    return { topoOrder: [], cycle: remaining, parents, children };
  }

  return { topoOrder, cycle: null, parents, children };
}

// ============================================================================
// TEMPLATE EXPANSION (${nodeId}, ${nodeId.path.to.field})
// ============================================================================

const TEMPLATE_RE = /\$\{([\w-]+)(?:\.([\w.]+))?\}/g;

function expandTemplates(
  params: Record<string, unknown>,
  outputs: Map<string, StageOutput>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    out[k] = expandValue(v, outputs);
  }
  return out;
}

function expandValue(v: unknown, outputs: Map<string, StageOutput>): unknown {
  if (typeof v === "string") {
    if (!v.includes("${")) return v;
    // If whole string is a single substitution and the upstream is non-string, return raw value
    const wholeMatch = v.match(/^\$\{([\w-]+)(?:\.([\w.]+))?\}$/);
    if (wholeMatch) {
      const [, nodeId, path] = wholeMatch;
      const resolved = resolveRef(nodeId, path, outputs);
      return resolved !== undefined ? resolved : v;
    }
    return v.replace(TEMPLATE_RE, (_, nodeId: string, path?: string) => {
      const resolved = resolveRef(nodeId, path, outputs);
      if (resolved === undefined) return "";
      return typeof resolved === "string" ? resolved : JSON.stringify(resolved);
    });
  }
  if (Array.isArray(v)) {
    return v.map((item) => expandValue(item, outputs));
  }
  if (v && typeof v === "object") {
    const obj: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      obj[k] = expandValue(val, outputs);
    }
    return obj;
  }
  return v;
}

function resolveRef(
  nodeId: string,
  path: string | undefined,
  outputs: Map<string, StageOutput>
): unknown {
  const stage = outputs.get(nodeId);
  if (!stage) return undefined;
  let cur: unknown = stage.value;
  if (!path) return cur;
  for (const seg of path.split(".")) {
    if (cur && typeof cur === "object" && seg in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return cur;
}

// ============================================================================
// STAGE EXECUTORS
// ============================================================================

const MAX_UPSTREAM_SERIALIZED_BYTES = 8 * 1024;
const MAX_SSE_VALUE_BYTES = 4 * 1024;

function serializeForPrompt(value: unknown): string {
  const s = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (s.length <= MAX_UPSTREAM_SERIALIZED_BYTES) return s;
  return s.slice(0, MAX_UPSTREAM_SERIALIZED_BYTES) + `\n…[truncated ${s.length - MAX_UPSTREAM_SERIALIZED_BYTES} bytes]`;
}

function truncateForSSE(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  const s = typeof value === "string" ? value : JSON.stringify(value);
  if (s.length <= MAX_SSE_VALUE_BYTES) return value;
  return {
    __truncated: true,
    originalType: typeof value,
    originalLength: s.length,
    preview: s.slice(0, MAX_SSE_VALUE_BYTES),
  };
}

function mergedUpstream(
  parentIds: string[],
  outputs: Map<string, StageOutput>
): Record<string, unknown> {
  return Object.fromEntries(
    parentIds
      .map((pid) => [pid, outputs.get(pid)?.value])
      .filter(([, v]) => v !== undefined)
  );
}

async function executeAgentStage(
  node: CanvasNode & { data: AgentNodeData },
  parentIds: string[],
  outputs: Map<string, StageOutput>,
  workflowClassification: Classification
): Promise<StageOutput> {
  const start = Date.now();
  const systemPrompt = resolveSystemPrompt(node.data);

  let upstreamContext = "";
  for (const pid of parentIds) {
    const out = outputs.get(pid);
    if (!out || out.status !== "completed") continue;
    upstreamContext += `\n--- Upstream node ${pid} (${out.kind}) ---\n${serializeForPrompt(out.value)}\n`;
  }

  const fullSystemPrompt = upstreamContext
    ? `${systemPrompt}\n\nUpstream context:${upstreamContext}`
    : systemPrompt;

  // PII scan outbound
  const piiScan = scanForPII(fullSystemPrompt);
  if (piiScan.blockedCount > 0) {
    return {
      nodeId: node.id,
      kind: "agent",
      value: null,
      durationMs: Date.now() - start,
      status: "error",
      error: "Outbound content blocked by PII scan.",
    };
  }

  const userMessage = parentIds.length > 0
    ? "Continue the pipeline using the upstream context above."
    : "Begin the workflow.";
  const response = await callLLM(node.data.modelId, {
    systemPrompt: fullSystemPrompt,
    messages: [{ role: "user", content: userMessage }],
    maxTokens: node.data.maxTokens,
    temperature: node.data.temperature,
  });

  return {
    nodeId: node.id,
    kind: "agent",
    value: response.content,
    durationMs: Date.now() - start,
    tokens: response.usage.totalTokens,
    status: "completed",
  };
}

async function executeFunctionStage(
  node: CanvasNode & { data: FunctionNodeData },
  parentIds: string[],
  outputs: Map<string, StageOutput>
): Promise<StageOutput> {
  const start = Date.now();
  const input =
    parentIds.length === 1
      ? outputs.get(parentIds[0])?.value
      : mergedUpstream(parentIds, outputs);
  const expandedParams = expandTemplates(node.data.params, outputs);
  const value = await runFunction(node.data.fnName, input, expandedParams);
  return {
    nodeId: node.id,
    kind: "function",
    value,
    durationMs: Date.now() - start,
    status: "completed",
  };
}

async function executeToolStage(
  node: CanvasNode & { data: ToolNodeData },
  outputs: Map<string, StageOutput>,
  executionId: string,
  userId: string,
  ministryCode: string | null,
  stageIndex: number
): Promise<StageOutput> {
  const start = Date.now();
  const expandedParams = expandTemplates(node.data.params, outputs);
  const toolCall: ToolCall = { tool: node.data.toolName, params: expandedParams };
  const { results } = await dispatchToolCalls([toolCall], {
    sessionId: executionId,
    userId,
    ministryCode,
    iteration: stageIndex,
    memory: { blackboard: [], scratchpad: "", attributes: {} },
    workflowExecutionId: executionId,
  });
  const result = results[0];
  if (!result.success) {
    return {
      nodeId: node.id,
      kind: "tool",
      value: null,
      durationMs: Date.now() - start,
      status: "error",
      error: result.error || "Tool failed",
    };
  }
  return {
    nodeId: node.id,
    kind: "tool",
    value: result.result,
    durationMs: Date.now() - start,
    status: "completed",
  };
}

// ============================================================================
// PERSISTENCE
// ============================================================================

async function createExecutionRow(
  workflowId: string,
  userId: string,
  classification: Classification
): Promise<string> {
  const result = await query<{ id: string }>(
    `INSERT INTO workflow_executions (workflow_id, user_id, classification, status)
     VALUES ($1, $2, $3, 'running')
     RETURNING id`,
    [workflowId, userId, classification]
  );
  return result.rows[0].id;
}

async function persistStageResults(
  executionId: string,
  outputs: StageOutput[]
): Promise<void> {
  await query(
    `UPDATE workflow_executions SET stage_results = $2 WHERE id = $1`,
    [executionId, JSON.stringify(outputs)]
  );
}

async function completeExecutionRow(
  executionId: string,
  status: "completed" | "error" | "aborted",
  outputs: StageOutput[],
  error?: string
): Promise<void> {
  await query(
    `UPDATE workflow_executions
       SET status = $2, stage_results = $3, error = $4, completed_at = NOW()
     WHERE id = $1`,
    [executionId, status, JSON.stringify(outputs), error ?? null]
  );
}

// ============================================================================
// MAIN ENTRY
// ============================================================================

export async function runWorkflow(
  workflow: WorkflowRecord,
  res: Response,
  ctx: ExecutionContext
): Promise<void> {
  const canvas = workflow.canvas_data;
  if (!canvas || typeof canvas !== "object") {
    sendSSE(res, { type: "error", error: "Workflow has no canvas data. Add nodes and save before running.", code: "no_canvas" });
    res.end();
    return;
  }
  if (canvas.version !== 1) {
    sendSSE(res, { type: "error", error: `Unsupported canvas version: ${canvas.version}. Expected 1.`, code: "version" });
    res.end();
    return;
  }
  if (!Array.isArray(canvas.nodes) || !Array.isArray(canvas.edges)) {
    sendSSE(res, { type: "error", error: "Canvas data is malformed: nodes and edges must be arrays.", code: "malformed" });
    res.end();
    return;
  }
  if (canvas.nodes.length === 0) {
    sendSSE(res, { type: "error", error: "Workflow is empty. Add at least one node before running.", code: "empty" });
    res.end();
    return;
  }

  // Build executable set (exclude notes)
  const executableNodes = canvas.nodes.filter((n) => n.data.kind !== "note");
  const noteNodeIds = new Set(canvas.nodes.filter((n) => n.data.kind === "note").map((n) => n.id));

  const { topoOrder, cycle, parents, children } = analyzeGraph(executableNodes, canvas.edges);
  if (cycle) {
    sendSSE(res, { type: "error", error: "Workflow contains a cycle", code: "cycle", nodeIds: cycle });
    res.end();
    return;
  }

  // Upfront classification validation for every agent node
  for (const node of executableNodes) {
    if (node.data.kind !== "agent") continue;
    const v = await validateModelClassification(node.data.modelId, workflow.classification);
    if (!v.valid) {
      sendSSE(res, {
        type: "error",
        error: `Agent node "${node.id}" model ${node.data.modelId} is not allowed for classification ${workflow.classification}: ${v.reason}`,
        code: "classification",
      });
      res.end();
      return;
    }
  }

  // Persist execution row
  let executionId: string;
  try {
    executionId = await createExecutionRow(workflow.id, ctx.userId, workflow.classification);
  } catch (err) {
    sendSSE(res, { type: "error", error: "Failed to create execution record" });
    logger.error("Failed to create workflow_executions row", err, { workflowId: workflow.id });
    res.end();
    return;
  }

  activeExecutions.set(executionId, { abort: false });
  ctx.onExecutionCreated?.(executionId);

  await logAudit({
    userId: ctx.userId,
    ministryCode: ctx.ministryCode || undefined,
    action: AuditAction.WORKFLOW_EXECUTED,
    resourceType: "workflow",
    resourceId: workflow.id,
    details: { executionId, stageCount: topoOrder.length },
  });

  // SSE headers should already be set by the route; emit start event.
  const totalStages = topoOrder.length + noteNodeIds.size;
  sendSSE(res, {
    type: "workflow_start",
    executionId,
    workflowId: workflow.id,
    totalStages,
    classification: workflow.classification,
  });

  // Emit skipped events for notes (presented as stages in the UI).
  for (const noteId of noteNodeIds) {
    sendSSE(res, { type: "stage_skipped", executionId, nodeId: noteId, reason: "note" });
  }

  const heartbeat = setInterval(() => sendHeartbeat(res), 15000);
  const workflowStart = Date.now();
  const outputs: Map<string, StageOutput> = new Map();
  const pruned: Set<string> = new Set();
  let finalStatus: "completed" | "error" | "aborted" = "completed";
  let finalError: string | undefined;
  let sawStageError = false;

  try {
    for (let i = 0; i < topoOrder.length; i++) {
      const nodeId = topoOrder[i];

      // Abort check
      if (activeExecutions.get(executionId)?.abort) {
        finalStatus = "aborted";
        break;
      }

      // Pruned by branch ancestor?
      if (pruned.has(nodeId)) {
        sendSSE(res, { type: "stage_skipped", executionId, nodeId, reason: "pruned" });
        outputs.set(nodeId, {
          nodeId,
          kind: executableNodes.find((n) => n.id === nodeId)!.data.kind,
          value: null,
          durationMs: 0,
          status: "skipped",
          reason: "pruned",
        });
        continue;
      }

      const node = executableNodes.find((n) => n.id === nodeId)!;
      const parentIds = parents.get(nodeId) ?? [];

      sendSSE(res, { type: "stage_start", executionId, nodeId, kind: node.data.kind, stageIndex: i });

      const stageStart = Date.now();
      let stageOutput: StageOutput;
      try {
        if (node.data.kind === "agent") {
          stageOutput = await executeAgentStage(
            node as CanvasNode & { data: AgentNodeData },
            parentIds,
            outputs,
            workflow.classification
          );
        } else if (node.data.kind === "function") {
          stageOutput = await executeFunctionStage(
            node as CanvasNode & { data: FunctionNodeData },
            parentIds,
            outputs
          );
        } else if (node.data.kind === "tool") {
          stageOutput = await executeToolStage(
            node as CanvasNode & { data: ToolNodeData },
            outputs,
            executionId,
            ctx.userId,
            ctx.ministryCode,
            i
          );
        } else {
          // Defensive: notes already filtered out
          continue;
        }
      } catch (err) {
        // Record the elapsed time so the report doesn't claim instantaneous
        // failures for stages that actually ran for seconds before throwing.
        stageOutput = {
          nodeId,
          kind: node.data.kind,
          value: null,
          durationMs: Date.now() - stageStart,
          status: "error",
          error: (err as Error).message,
        };
      }

      outputs.set(nodeId, stageOutput);

      if (stageOutput.status === "error") {
        sawStageError = true;
        sendSSE(res, {
          type: "stage_error",
          executionId,
          nodeId,
          error: stageOutput.error || "Stage failed",
          stageIndex: i,
        });
        if (!ctx.continueOnError) {
          finalStatus = "error";
          finalError = stageOutput.error;
          break;
        }
      } else {
        sendSSE(res, {
          type: "stage_complete",
          executionId,
          nodeId,
          kind: node.data.kind,
          stageIndex: i,
          durationMs: stageOutput.durationMs,
          value: truncateForSSE(stageOutput.value),
          tokens: stageOutput.tokens,
        });

        // Branch handling: prune descendants when matched=false
        if (
          node.data.kind === "function" &&
          isBranchFunction(node.data.fnName) &&
          stageOutput.value &&
          typeof stageOutput.value === "object" &&
          (stageOutput.value as { matched?: boolean }).matched === false
        ) {
          collectDescendants(nodeId, children, pruned);
        }
      }

      // Checkpoint every 5 stages
      if ((i + 1) % 5 === 0) {
        await persistStageResults(executionId, Array.from(outputs.values())).catch((err) => {
          logger.error("Failed to checkpoint stage results", err, { executionId });
        });
      }
    }
  } catch (err) {
    finalStatus = "error";
    finalError = (err as Error).message;
    logger.error("Workflow execution failed", err, { executionId, workflowId: workflow.id });
  } finally {
    clearInterval(heartbeat);
    activeExecutions.delete(executionId);
  }

  // Promote to error status if continueOnError swallowed stage errors.
  if (finalStatus === "completed" && sawStageError) {
    finalStatus = "error";
    finalError = finalError ?? "One or more stages failed";
  }

  try {
    await completeExecutionRow(executionId, finalStatus, Array.from(outputs.values()), finalError);
  } catch (err) {
    logger.error("Failed to finalize workflow_executions row", err, { executionId });
  }

  sendSSE(res, {
    type: "workflow_complete",
    executionId,
    status: finalStatus,
    stageCount: outputs.size,
    durationMs: Date.now() - workflowStart,
    error: finalError,
  });

  res.end();
}

function collectDescendants(
  rootId: string,
  children: Map<string, string[]>,
  pruned: Set<string>
): void {
  const stack = [...(children.get(rootId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (pruned.has(id)) continue;
    pruned.add(id);
    for (const c of children.get(id) ?? []) stack.push(c);
  }
}
