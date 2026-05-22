/**
 * Unit tests for workflowCostEstimator.
 *
 * The estimator is a pure function — no DB, no LLM, no network. The only
 * external dependency is `modelPricing.json`, which we pass in directly as
 * a stub so tests stay deterministic and don't depend on the real file.
 */

import { describe, it, expect } from "vitest";
import {
  estimateWorkflowCost,
  loadPricing,
  type EstimatorAgentTemplate,
  type EstimatorCanvas,
} from "../workflowCostEstimator.js";

// Same constants used inside the estimator; reproduced here so the
// expected-value math is explicit and easy to audit.
const MAX_UPSTREAM_SERIALIZED_BYTES = 8 * 1024;
const CHARS_PER_TOKEN = 4;
const DEFAULT_MAX_TOKENS = 4096;

const stubPricing = {
  schemaVersion: 1 as const,
  currency: "USD",
  models: {
    "claude-sonnet-4-6": { inputPerMillion: 3.0, outputPerMillion: 15.0 },
    "claude-opus-4-7": { inputPerMillion: 15.0, outputPerMillion: 75.0 },
  },
};

const templates: EstimatorAgentTemplate[] = [
  {
    id: "researcher",
    systemPrompt:
      "You are a research assistant. Produce findings.".repeat(2), // 96 chars
  },
];

function buildCanvas(
  nodes: EstimatorCanvas["nodes"],
  edges: EstimatorCanvas["edges"] = [],
): EstimatorCanvas {
  return { nodes, edges };
}

describe("estimateWorkflowCost", () => {
  it("returns zeros for an empty canvas", () => {
    const result = estimateWorkflowCost(buildCanvas([]), templates, stubPricing);
    expect(result.agentCallCount).toBe(0);
    expect(result.toolCallCount).toBe(0);
    expect(result.functionCallCount).toBe(0);
    expect(result.estimatedInputTokens).toBe(0);
    expect(result.estimatedOutputTokens).toBe(0);
    expect(result.total.totalCost).toBe(0);
    expect(result.unknownModels).toEqual([]);
    expect(result.assumesAllBranches).toBe(true);
    expect(result.currency).toBe("USD");
  });

  it("estimates a single agent node with no parents", () => {
    const canvas = buildCanvas([
      {
        id: "a1",
        type: "agent",
        data: {
          kind: "agent",
          label: "Solo",
          modelId: "claude-sonnet-4-6",
          templateId: "researcher",
        },
      },
    ]);
    const result = estimateWorkflowCost(canvas, templates, stubPricing);

    const expectedInputTokens = Math.ceil(
      templates[0]!.systemPrompt.length / CHARS_PER_TOKEN,
    );
    const expectedOutputTokens = DEFAULT_MAX_TOKENS;
    const expectedInputCost = (expectedInputTokens / 1_000_000) * 3.0;
    const expectedOutputCost = (expectedOutputTokens / 1_000_000) * 15.0;

    expect(result.agentCallCount).toBe(1);
    expect(result.estimatedInputTokens).toBe(expectedInputTokens);
    expect(result.estimatedOutputTokens).toBe(expectedOutputTokens);
    expect(result.perNode).toHaveLength(1);
    expect(result.perNode[0]!.isPriced).toBe(true);
    expect(result.perNode[0]!.inputCost).toBeCloseTo(expectedInputCost, 8);
    expect(result.perNode[0]!.outputCost).toBeCloseTo(expectedOutputCost, 8);
    expect(result.total.totalCost).toBeCloseTo(
      expectedInputCost + expectedOutputCost,
      8,
    );
  });

  it("scales input tokens by the number of parent edges", () => {
    const canvas = buildCanvas(
      [
        {
          id: "a1",
          type: "agent",
          data: {
            kind: "agent",
            label: "Parent A",
            modelId: "claude-sonnet-4-6",
            templateId: "researcher",
          },
        },
        {
          id: "a2",
          type: "agent",
          data: {
            kind: "agent",
            label: "Parent B",
            modelId: "claude-sonnet-4-6",
            templateId: "researcher",
          },
        },
        {
          id: "child",
          type: "agent",
          data: {
            kind: "agent",
            label: "Child",
            modelId: "claude-sonnet-4-6",
            templateId: "researcher",
            maxTokens: 1000,
          },
        },
      ],
      [
        { source: "a1", target: "child" },
        { source: "a2", target: "child" },
      ],
    );
    const result = estimateWorkflowCost(canvas, templates, stubPricing);

    const child = result.perNode.find((n) => n.nodeId === "child");
    expect(child).toBeDefined();
    const expectedChildInputChars =
      templates[0]!.systemPrompt.length + 2 * MAX_UPSTREAM_SERIALIZED_BYTES;
    expect(child!.inputTokens).toBe(
      Math.ceil(expectedChildInputChars / CHARS_PER_TOKEN),
    );
    expect(child!.outputTokens).toBe(1000);
    expect(result.agentCallCount).toBe(3);
  });

  it("flags unknown models with null cost and surfaces them in unknownModels", () => {
    const canvas = buildCanvas([
      {
        id: "a1",
        type: "agent",
        data: {
          kind: "agent",
          label: "Mystery",
          modelId: "made-up-model",
          templateId: "researcher",
        },
      },
      {
        id: "a2",
        type: "agent",
        data: {
          kind: "agent",
          label: "Mystery 2",
          modelId: "made-up-model",
          templateId: "researcher",
        },
      },
      {
        id: "a3",
        type: "agent",
        data: {
          kind: "agent",
          label: "Real",
          modelId: "claude-sonnet-4-6",
          templateId: "researcher",
        },
      },
    ]);
    const result = estimateWorkflowCost(canvas, templates, stubPricing);

    expect(result.unknownModels).toEqual(["made-up-model"]);
    const mystery = result.perNode.find((n) => n.nodeId === "a1");
    expect(mystery!.isPriced).toBe(false);
    expect(mystery!.inputCost).toBeNull();
    expect(mystery!.outputCost).toBeNull();

    const real = result.perNode.find((n) => n.nodeId === "a3");
    expect(real!.isPriced).toBe(true);
    expect(real!.inputCost).not.toBeNull();

    // Total cost reflects only the priced node.
    expect(result.total.totalCost).toBeGreaterThan(0);
    expect(result.total.totalCost).toBeCloseTo(
      (real!.inputCost ?? 0) + (real!.outputCost ?? 0),
      8,
    );

    // Unknown-model tokens still counted in totals (so the user sees them).
    expect(result.estimatedInputTokens).toBeGreaterThan(real!.inputTokens);
  });

  it("excludes tool, function, and note nodes from LLM cost but counts them", () => {
    const canvas = buildCanvas([
      {
        id: "t1",
        type: "tool",
        data: { kind: "tool", label: "Search", toolName: "brave_search" },
      },
      {
        id: "f1",
        type: "function",
        data: { kind: "function", label: "Concat", fnName: "concat" },
      },
      {
        id: "n1",
        type: "note",
        data: { kind: "note", label: "Note" },
      },
    ]);
    const result = estimateWorkflowCost(canvas, templates, stubPricing);

    expect(result.agentCallCount).toBe(0);
    expect(result.toolCallCount).toBe(1);
    expect(result.functionCallCount).toBe(1);
    expect(result.estimatedInputTokens).toBe(0);
    expect(result.estimatedOutputTokens).toBe(0);
    expect(result.total.totalCost).toBe(0);
    expect(result.perNode).toHaveLength(0);
  });

  it("falls back to the default system prompt when no template/override is given", () => {
    const canvas = buildCanvas([
      {
        id: "a1",
        type: "agent",
        data: {
          kind: "agent",
          label: "Bare",
          modelId: "claude-sonnet-4-6",
        },
      },
    ]);
    const result = estimateWorkflowCost(canvas, templates, stubPricing);
    // 99-char default fallback (see resolveSystemPromptChars).
    expect(result.estimatedInputTokens).toBeGreaterThan(0);
    expect(result.perNode[0]!.isPriced).toBe(true);
  });

  it("prefers systemPromptOverride over templateId", () => {
    const overrideText = "x".repeat(800);
    const canvas = buildCanvas([
      {
        id: "a1",
        type: "agent",
        data: {
          kind: "agent",
          label: "Override",
          modelId: "claude-sonnet-4-6",
          templateId: "researcher",
          systemPromptOverride: overrideText,
        },
      },
    ]);
    const result = estimateWorkflowCost(canvas, templates, stubPricing);
    expect(result.estimatedInputTokens).toBe(
      Math.ceil(overrideText.length / CHARS_PER_TOKEN),
    );
  });

  it("respects the node's maxTokens for output token cap", () => {
    const canvas = buildCanvas([
      {
        id: "a1",
        type: "agent",
        data: {
          kind: "agent",
          label: "Capped",
          modelId: "claude-sonnet-4-6",
          maxTokens: 8000,
        },
      },
    ]);
    const result = estimateWorkflowCost(canvas, templates, stubPricing);
    expect(result.estimatedOutputTokens).toBe(8000);
  });

  it("marks assumesAllBranches true and exposes the pricing table", () => {
    const canvas = buildCanvas([
      {
        id: "a1",
        type: "agent",
        data: {
          kind: "agent",
          label: "Solo",
          modelId: "claude-opus-4-7",
        },
      },
    ]);
    const result = estimateWorkflowCost(canvas, templates, stubPricing);
    expect(result.assumesAllBranches).toBe(true);
    expect(result.pricingTable["claude-opus-4-7"]).toEqual({
      inputPerMillion: 15.0,
      outputPerMillion: 75.0,
    });
  });
});

describe("loadPricing", () => {
  it("reads modelPricing.json with the expected shape", () => {
    const pricing = loadPricing();
    expect(pricing.schemaVersion).toBe(1);
    expect(pricing.currency).toBe("USD");
    // The four seeded models must be present so the dialog has prices for them.
    expect(pricing.models["claude-opus-4-7"]).toBeDefined();
    expect(pricing.models["claude-sonnet-4-6"]).toBeDefined();
    expect(pricing.models["claude-haiku-4-5"]).toBeDefined();
    expect(pricing.models["gemini-2.5-flash"]).toBeDefined();
  });
});
