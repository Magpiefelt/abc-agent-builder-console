/**
 * ExecutionPanel renders live workflow execution state from the workflow store.
 * The store is seeded directly so these tests don't depend on the SSE stream.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { useWorkflowStore } from "@/stores/workflow";
import ExecutionPanel from "../ExecutionPanel.vue";
import type { CanvasNode, ExecutionState, StageState } from "@/types/workflow";

function seedNode(id: string, label: string, kind: CanvasNode["type"] = "agent"): CanvasNode {
  const data = (() => {
    if (kind === "agent") {
      return {
        kind: "agent" as const,
        label,
        modelId: "claude-sonnet-4-6",
        classification: "unclassified" as const,
        tools: [],
      };
    }
    if (kind === "function") {
      return { kind: "function" as const, label, fnName: "concat", params: {} };
    }
    if (kind === "tool") {
      return { kind: "tool" as const, label, toolName: "brave_search", params: {} };
    }
    return { kind: "note" as const, label, markdown: "" };
  })();
  return { id, type: kind, position: { x: 0, y: 0 }, data };
}

function seedStage(partial: Partial<StageState> & Pick<StageState, "nodeId" | "kind" | "status">): StageState {
  return { ...partial };
}

function seedExecution(stages: StageState[], extras: Partial<ExecutionState> = {}): ExecutionState {
  const map = new Map<string, StageState>();
  for (const s of stages) map.set(s.nodeId, s);
  return {
    id: "exec-1",
    status: "running",
    stages: map,
    startedAt: Date.now() - 1000,
    piiBlockedTotal: 0,
    ...extras,
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe("ExecutionPanel", () => {
  it("renders nothing when there is no active execution", () => {
    const wrapper = mount(ExecutionPanel);
    expect(wrapper.find('[aria-label="Workflow execution results"]').exists()).toBe(false);
  });

  it("renders one row per stage and uses the node label", () => {
    const store = useWorkflowStore();
    store.current = {
      id: "wf-1",
      name: "Demo",
      description: null,
      classification: "unclassified",
      version: 1,
      is_template: false,
      tags: [],
      ministry_code: null,
      user_id: "u-1",
      updated_at: "",
      created_at: "",
      canvas_data: {
        nodes: [seedNode("n1", "Researcher"), seedNode("n2", "Summarize", "function")],
        edges: [],
        version: 1,
      },
    };
    store.execution = seedExecution([
      seedStage({ nodeId: "n1", kind: "agent", status: "completed", stageIndex: 0, durationMs: 1234, value: "Hello world" }),
      seedStage({ nodeId: "n2", kind: "function", status: "running", stageIndex: 1 }),
    ]);

    const wrapper = mount(ExecutionPanel);
    expect(wrapper.text()).toContain("Researcher");
    expect(wrapper.text()).toContain("Summarize");
    expect(wrapper.find('goa-badge[content="completed"]').exists()).toBe(true);
    expect(wrapper.find('goa-badge[content="running"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("1.2 s");
  });

  it("auto-expands the running stage so the user sees live progress", () => {
    const store = useWorkflowStore();
    store.execution = seedExecution([
      seedStage({ nodeId: "n1", kind: "agent", status: "running", stageIndex: 0 }),
    ]);

    const wrapper = mount(ExecutionPanel);
    const expanded = wrapper.find('[id="stage-n1"]');
    expect(expanded.exists()).toBe(true);
    expect(expanded.text()).toContain("Running");
  });

  it("auto-expands failed stages and renders the error", () => {
    const store = useWorkflowStore();
    store.execution = seedExecution(
      [seedStage({ nodeId: "n1", kind: "agent", status: "error", stageIndex: 0, error: "Model refused" })],
      { status: "error", error: "Stage failed", completedAt: Date.now() },
    );

    const wrapper = mount(ExecutionPanel);
    expect(wrapper.find('[id="stage-n1"]').text()).toContain("Model refused");
  });

  it("renders agent string output as markdown", async () => {
    const store = useWorkflowStore();
    store.execution = seedExecution(
      [seedStage({ nodeId: "n1", kind: "agent", status: "completed", stageIndex: 0, value: "# Heading\n\nBody" })],
      { status: "completed", completedAt: Date.now() },
    );

    const wrapper = mount(ExecutionPanel);
    // Expand the completed stage
    await wrapper.find('button[aria-controls="stage-n1"]').trigger("click");
    const detail = wrapper.find('[id="stage-n1"]');
    expect(detail.html()).toContain("<h1>Heading</h1>");
    expect(detail.html()).toContain("<p>Body</p>");
  });

  it("renders structured output as pretty JSON", async () => {
    const store = useWorkflowStore();
    store.execution = seedExecution(
      [seedStage({ nodeId: "n1", kind: "function", status: "completed", stageIndex: 0, value: { ok: true, count: 3 } })],
      { status: "completed", completedAt: Date.now() },
    );

    const wrapper = mount(ExecutionPanel);
    await wrapper.find('button[aria-controls="stage-n1"]').trigger("click");
    const detail = wrapper.find('[id="stage-n1"]');
    expect(detail.text()).toContain('"count": 3');
    expect(detail.text()).toContain('"ok": true');
  });

  it("shows the PII-blocked chip when warnings accumulate", () => {
    const store = useWorkflowStore();
    store.execution = seedExecution(
      [
        seedStage({
          nodeId: "n1",
          kind: "agent",
          status: "completed",
          stageIndex: 0,
          piiBlockedCount: 2,
        }),
      ],
      { piiBlockedTotal: 2 },
    );

    const wrapper = mount(ExecutionPanel);
    expect(wrapper.find('goa-badge[content="2 PII blocked"]').exists()).toBe(true);
  });

  it("disables the Clear button while execution is running", () => {
    const store = useWorkflowStore();
    store.execution = seedExecution([
      seedStage({ nodeId: "n1", kind: "agent", status: "running", stageIndex: 0 }),
    ]);

    const wrapper = mount(ExecutionPanel);
    const clear = wrapper.findAll("goa-button").find((b) => b.text().trim() === "Clear");
    expect(clear).toBeDefined();
    expect(clear!.attributes("disabled")).toBeDefined();
  });

  it("renders a 'Dry run' badge while execution.dryRun is true", () => {
    const store = useWorkflowStore();
    store.execution = seedExecution(
      [seedStage({ nodeId: "n1", kind: "agent", status: "running", stageIndex: 0 })],
      { dryRun: true },
    );

    const wrapper = mount(ExecutionPanel);
    const badge = wrapper.find('[data-testid="dry-run-badge"]');
    expect(badge.exists()).toBe(true);
    expect(badge.attributes("content")).toBe("Dry run");
  });

  it("omits the 'Dry run' badge for a real run (execution.dryRun is falsy)", () => {
    const store = useWorkflowStore();
    store.execution = seedExecution([
      seedStage({ nodeId: "n1", kind: "agent", status: "running", stageIndex: 0 }),
    ]);

    const wrapper = mount(ExecutionPanel);
    expect(wrapper.find('[data-testid="dry-run-badge"]').exists()).toBe(false);
  });

  it("clears execution state when the Clear button is clicked after completion", async () => {
    const store = useWorkflowStore();
    store.execution = seedExecution(
      [seedStage({ nodeId: "n1", kind: "agent", status: "completed", stageIndex: 0 })],
      { status: "completed", completedAt: Date.now() },
    );

    const wrapper = mount(ExecutionPanel);
    const clear = wrapper.findAll("goa-button").find((b) => b.text().trim() === "Clear");
    expect(clear).toBeDefined();
    // GoA web components emit `_click` instead of `click`; the store handler is
    // bound via @_click, so dispatch that on the underlying element.
    clear!.element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(store.execution).toBeNull();
  });
});
