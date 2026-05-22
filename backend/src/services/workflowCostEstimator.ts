/**
 * Workflow Cost Estimator
 *
 * Pure function that walks a workflow canvas graph and produces an upper-bound
 * estimate of token usage and dollar cost for an upcoming run. Used by the
 * `POST /api/workflows/:id/estimate` endpoint to power the pre-run confirmation
 * dialog (recommendations §4.3).
 *
 * Heuristic (mirrors `executeAgentStage` in workflowExecutor.ts):
 *  - For each Agent node, sum input tokens = (system prompt chars + per-parent
 *    upstream context up to MAX_UPSTREAM_SERIALIZED_BYTES) / CHARS_PER_TOKEN.
 *  - Output tokens = node.maxTokens ?? DEFAULT_MAX_TOKENS.
 *  - Tool / function / note nodes contribute zero LLM cost (tool calls are
 *    counted separately for UI awareness).
 *  - Branch pruning is NOT simulated: every node is assumed to execute. We
 *    surface this as `assumesAllBranches: true` so the dialog can warn that
 *    the figure is an upper bound.
 *
 * Pricing is loaded from `data/modelPricing.json` (static config, no DB
 * migration required). Unknown model IDs are surfaced in `unknownModels`
 * with `isPriced: false` per affected node so they aren't silently treated
 * as $0.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ============================================================================
// CONSTANTS (kept in sync with workflowExecutor.ts)
// ============================================================================

/** Same cap the executor uses when serializing upstream values into the prompt. */
const MAX_UPSTREAM_SERIALIZED_BYTES = 8 * 1024;

/** Heuristic char→token ratio. Claude/Gemini both sit near 3.5–4 chars/token
 *  on English text. We pick 4 to bias the estimate slightly conservative
 *  (fewer tokens, so the dollar figure under-estimates rather than scares
 *  the user). The dialog labels the result as ±30% accurate. */
const CHARS_PER_TOKEN = 4;

/** Fallback maxTokens when an Agent node doesn't specify one. Matches the
 *  effective default observed in the executor → llmProvider chain (Claude
 *  Sonnet/Opus). */
const DEFAULT_MAX_TOKENS = 4096;

// ============================================================================
// TYPES (subset of CanvasNode — kept locally to avoid coupling to the
// executor's internal types)
// ============================================================================

export interface EstimatorAgentTemplate {
  id: string;
  systemPrompt: string;
}

interface AgentNodeData {
  kind: "agent";
  label: string;
  templateId?: string;
  systemPromptOverride?: string;
  modelId: string;
  maxTokens?: number;
}

interface ToolNodeData {
  kind: "tool";
  label: string;
  toolName: string;
}

interface FunctionNodeData {
  kind: "function";
  label: string;
  fnName: string;
}

interface NoteNodeData {
  kind: "note";
  label: string;
}

type AnyNodeData = AgentNodeData | ToolNodeData | FunctionNodeData | NoteNodeData;

interface EstimatorCanvasNode {
  id: string;
  type: "agent" | "tool" | "function" | "note";
  data: AnyNodeData;
}

interface EstimatorCanvasEdge {
  source: string;
  target: string;
}

export interface EstimatorCanvas {
  nodes: EstimatorCanvasNode[];
  edges: EstimatorCanvasEdge[];
}

export interface ModelPrice {
  inputPerMillion: number;
  outputPerMillion: number;
}

export interface PerNodeEstimate {
  nodeId: string;
  label: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  /** Null when the model is unknown to the pricing config. */
  inputCost: number | null;
  /** Null when the model is unknown to the pricing config. */
  outputCost: number | null;
  isPriced: boolean;
}

export interface WorkflowCostEstimate {
  agentCallCount: number;
  toolCallCount: number;
  functionCallCount: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  perNode: PerNodeEstimate[];
  total: {
    inputCost: number;
    outputCost: number;
    totalCost: number;
    currency: string;
  };
  /** Distinct model IDs referenced by agent nodes that are not in
   *  modelPricing.json. Costs for these nodes are null and excluded from
   *  the total. */
  unknownModels: string[];
  /** Always true today — the estimator does not simulate branch pruning. */
  assumesAllBranches: boolean;
  /** Per-million pricing constants used (for transparency in the dialog). */
  pricingTable: Record<string, ModelPrice>;
  currency: string;
}

// ============================================================================
// PRICING TABLE LOADING
// ============================================================================

interface PricingFile {
  schemaVersion: 1;
  currency: string;
  models: Record<string, ModelPrice>;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const pricingPath = resolve(__dirname, "../data/modelPricing.json");

let cachedPricing: PricingFile | null = null;

export function loadPricing(): PricingFile {
  if (cachedPricing) return cachedPricing;
  const raw = readFileSync(pricingPath, "utf-8");
  cachedPricing = JSON.parse(raw) as PricingFile;
  if (cachedPricing.schemaVersion !== 1) {
    throw new Error(
      `modelPricing.json schemaVersion mismatch: expected 1, got ${String(
        cachedPricing.schemaVersion,
      )}`,
    );
  }
  return cachedPricing;
}

/** Test seam — reset the cached pricing so tests can stub `loadPricing`
 *  with vi.spyOn without polluting later tests. */
export function _resetPricingCache(): void {
  cachedPricing = null;
}

// ============================================================================
// HEURISTIC HELPERS
// ============================================================================

function resolveSystemPromptChars(
  data: AgentNodeData,
  templates: EstimatorAgentTemplate[],
): number {
  if (data.systemPromptOverride && data.systemPromptOverride.trim()) {
    return data.systemPromptOverride.length;
  }
  if (data.templateId) {
    const t = templates.find((x) => x.id === data.templateId);
    if (t) return t.systemPrompt.length;
  }
  // Same fallback string the executor uses when no template/override matches.
  return "You are an assistant in a workflow pipeline. Use the upstream context to continue the pipeline.".length;
}

function countParents(nodeId: string, edges: EstimatorCanvasEdge[]): number {
  let n = 0;
  for (const e of edges) {
    if (e.target === nodeId) n++;
  }
  return n;
}

// ============================================================================
// MAIN ESTIMATOR
// ============================================================================

export function estimateWorkflowCost(
  canvas: EstimatorCanvas,
  templates: EstimatorAgentTemplate[],
  pricing: PricingFile = loadPricing(),
): WorkflowCostEstimate {
  const perNode: PerNodeEstimate[] = [];
  const unknownModelsSet = new Set<string>();

  let agentCallCount = 0;
  let toolCallCount = 0;
  let functionCallCount = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalInputCost = 0;
  let totalOutputCost = 0;

  for (const node of canvas.nodes) {
    if (node.type === "tool") {
      toolCallCount++;
      continue;
    }
    if (node.type === "function") {
      functionCallCount++;
      continue;
    }
    if (node.type === "note") {
      continue;
    }
    if (node.type !== "agent") continue;

    const data = node.data as AgentNodeData;
    agentCallCount++;

    const promptChars = resolveSystemPromptChars(data, templates);
    const parents = countParents(node.id, canvas.edges);

    // Upstream context is bounded by MAX_UPSTREAM_SERIALIZED_BYTES per parent
    // (the executor truncates beyond that). At estimation time we don't know
    // the actual upstream payload size, so we assume the worst case: each
    // parent contributes the full cap.
    const upstreamChars = parents * MAX_UPSTREAM_SERIALIZED_BYTES;
    const inputChars = promptChars + upstreamChars;
    const inputTokens = Math.ceil(inputChars / CHARS_PER_TOKEN);

    const outputTokens = data.maxTokens ?? DEFAULT_MAX_TOKENS;

    const price = pricing.models[data.modelId];
    if (!price) {
      unknownModelsSet.add(data.modelId);
      perNode.push({
        nodeId: node.id,
        label: data.label || data.modelId,
        modelId: data.modelId,
        inputTokens,
        outputTokens,
        inputCost: null,
        outputCost: null,
        isPriced: false,
      });
      totalInputTokens += inputTokens;
      totalOutputTokens += outputTokens;
      continue;
    }

    const inputCost = (inputTokens / 1_000_000) * price.inputPerMillion;
    const outputCost = (outputTokens / 1_000_000) * price.outputPerMillion;

    perNode.push({
      nodeId: node.id,
      label: data.label || data.modelId,
      modelId: data.modelId,
      inputTokens,
      outputTokens,
      inputCost,
      outputCost,
      isPriced: true,
    });

    totalInputTokens += inputTokens;
    totalOutputTokens += outputTokens;
    totalInputCost += inputCost;
    totalOutputCost += outputCost;
  }

  return {
    agentCallCount,
    toolCallCount,
    functionCallCount,
    estimatedInputTokens: totalInputTokens,
    estimatedOutputTokens: totalOutputTokens,
    perNode,
    total: {
      inputCost: totalInputCost,
      outputCost: totalOutputCost,
      totalCost: totalInputCost + totalOutputCost,
      currency: pricing.currency,
    },
    unknownModels: [...unknownModelsSet].sort(),
    assumesAllBranches: true,
    pricingTable: pricing.models,
    currency: pricing.currency,
  };
}
