/**
 * WorkflowCostDialog renders the pre-run cost estimate, emits confirm/cancel,
 * and warns when models without published pricing are present.
 */

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import WorkflowCostDialog from "../WorkflowCostDialog.vue";
import type { WorkflowCostEstimate } from "@/types/workflow";

function buildEstimate(
  partial: Partial<WorkflowCostEstimate> = {},
): WorkflowCostEstimate {
  return {
    agentCallCount: 2,
    toolCallCount: 1,
    functionCallCount: 0,
    estimatedInputTokens: 8000,
    estimatedOutputTokens: 4000,
    perNode: [
      {
        nodeId: "a1",
        label: "Researcher",
        modelId: "claude-sonnet-4-6",
        inputTokens: 4000,
        outputTokens: 2000,
        inputCost: 0.012,
        outputCost: 0.03,
        isPriced: true,
      },
      {
        nodeId: "a2",
        label: "Summarizer",
        modelId: "claude-haiku-4-5",
        inputTokens: 4000,
        outputTokens: 2000,
        inputCost: 0.004,
        outputCost: 0.01,
        isPriced: true,
      },
    ],
    total: {
      inputCost: 0.016,
      outputCost: 0.04,
      totalCost: 0.056,
      currency: "USD",
    },
    unknownModels: [],
    assumesAllBranches: true,
    pricingTable: {
      "claude-sonnet-4-6": { inputPerMillion: 3.0, outputPerMillion: 15.0 },
      "claude-haiku-4-5": { inputPerMillion: 1.0, outputPerMillion: 5.0 },
    },
    currency: "USD",
    ...partial,
  };
}

describe("WorkflowCostDialog", () => {
  it("renders the total cost, call counts, and per-node breakdown", () => {
    const wrapper = mount(WorkflowCostDialog, {
      props: {
        estimate: buildEstimate(),
        loading: false,
        error: null,
      },
    });

    const body = wrapper.get('[data-testid="cost-estimate-body"]');
    expect(body.text()).toContain("2 agent calls");
    expect(body.text()).toContain("1 tool call");
    // Total is rendered with currency formatting; just check the number is in there.
    expect(wrapper.get('[data-testid="cost-total"]').text()).toMatch(/0\.0560/);
    // Per-node rows include the label + model id.
    const list = wrapper.get('[data-testid="per-node-list"]');
    expect(list.text()).toContain("Researcher");
    expect(list.text()).toContain("claude-sonnet-4-6");
    expect(list.text()).toContain("Summarizer");
    expect(list.text()).toContain("claude-haiku-4-5");
  });

  it("emits 'confirm' when the primary button is clicked", async () => {
    const wrapper = mount(WorkflowCostDialog, {
      props: {
        estimate: buildEstimate(),
        loading: false,
        error: null,
      },
    });

    const buttons = wrapper.findAll("goa-button");
    // [Cancel, Confirm and run]
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    const confirmBtn = buttons[buttons.length - 1]!;
    expect(confirmBtn.text()).toContain("Confirm and run");
    await confirmBtn.trigger("_click");
    expect(wrapper.emitted("confirm")).toHaveLength(1);
  });

  it("emits 'cancel' when the secondary button is clicked", async () => {
    const wrapper = mount(WorkflowCostDialog, {
      props: {
        estimate: buildEstimate(),
        loading: false,
        error: null,
      },
    });

    const cancelBtn = wrapper
      .findAll("goa-button")
      .find((b) => b.text().includes("Cancel"));
    expect(cancelBtn).toBeDefined();
    await cancelBtn!.trigger("_click");
    expect(wrapper.emitted("cancel")).toHaveLength(1);
  });

  it("emits 'cancel' when goa-modal fires _close", async () => {
    const wrapper = mount(WorkflowCostDialog, {
      props: {
        estimate: buildEstimate(),
        loading: false,
        error: null,
      },
    });
    await wrapper.get("goa-modal").trigger("_close");
    expect(wrapper.emitted("cancel")).toHaveLength(1);
  });

  it("shows a warning callout when unknownModels is non-empty", () => {
    const wrapper = mount(WorkflowCostDialog, {
      props: {
        estimate: buildEstimate({ unknownModels: ["custom-private-model"] }),
        loading: false,
        error: null,
      },
    });
    const html = wrapper.html();
    expect(html).toContain("Some models don't have a price");
    expect(html).toContain("custom-private-model");
  });

  it("disables the confirm button while loading", () => {
    const wrapper = mount(WorkflowCostDialog, {
      props: {
        estimate: null,
        loading: true,
        error: null,
      },
    });
    const buttons = wrapper.findAll("goa-button");
    const confirmBtn = buttons.find((b) =>
      b.text().includes("Confirm and run"),
    )!;
    // goa-button is a custom element so Vue serialises the bound value as a
    // string attribute rather than the boolean-attribute "" convention.
    expect(confirmBtn.attributes("disabled")).toBe("true");
    // The loading state shows the estimating message.
    expect(wrapper.text()).toContain("Estimating workflow cost");
  });

  it("renders the error state when estimate fails", () => {
    const wrapper = mount(WorkflowCostDialog, {
      props: {
        estimate: null,
        loading: false,
        error: "Server unavailable",
      },
    });
    // The "Couldn't estimate cost" string lives on the goa-callout's heading
    // attribute, not in text content; assert via the rendered HTML instead.
    const callout = wrapper.get("goa-callout");
    expect(callout.attributes("heading")).toBe("Couldn't estimate cost");
    expect(callout.attributes("type")).toBe("emergency");
    expect(wrapper.text()).toContain("Server unavailable");
  });

  it("renders 'unpriced' for nodes whose model is unknown", () => {
    const estimate = buildEstimate({
      perNode: [
        {
          nodeId: "a1",
          label: "Mystery",
          modelId: "made-up-model",
          inputTokens: 1000,
          outputTokens: 500,
          inputCost: null,
          outputCost: null,
          isPriced: false,
        },
      ],
      unknownModels: ["made-up-model"],
      total: { inputCost: 0, outputCost: 0, totalCost: 0, currency: "USD" },
    });
    const wrapper = mount(WorkflowCostDialog, {
      props: { estimate, loading: false, error: null },
    });
    expect(wrapper.get('[data-testid="per-node-list"]').text()).toContain(
      "unpriced",
    );
  });

  it("notes that the estimate is approximate and assumes all branches", () => {
    const wrapper = mount(WorkflowCostDialog, {
      props: { estimate: buildEstimate(), loading: false, error: null },
    });
    expect(wrapper.text()).toMatch(/±30%/);
    expect(wrapper.text()).toContain("Assumes all branches execute");
  });

  it("uses 4-decimal currency formatting for amounts under $1", () => {
    const wrapper = mount(WorkflowCostDialog, {
      props: {
        estimate: buildEstimate({
          total: {
            inputCost: 0.0001,
            outputCost: 0.0001,
            totalCost: 0.0002,
            currency: "USD",
          },
        }),
        loading: false,
        error: null,
      },
    });
    expect(wrapper.get('[data-testid="cost-total"]').text()).toMatch(/0\.000[12]/);
  });
});
