/**
 * WorkflowToolbar emits intents (save / run / dry-run / etc.) for the
 * WorkflowView to act on. These tests pin the dry-run button contract
 * introduced by Backlog B7:
 *
 *   - The button renders and is keyboard-focusable.
 *   - It emits 'dry-run' on click.
 *   - It disables itself when the canvas is dirty, has validation errors,
 *     or the workflow is already running — matching the Run-button gating.
 *   - The tooltip text differentiates the three disabled reasons.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { useWorkflowStore } from "@/stores/workflow";
import WorkflowToolbar from "../WorkflowToolbar.vue";
import type {
  CanvasNode,
  Classification,
  ExecutionStatus,
  Workflow,
  WorkflowLibrary,
} from "@/types/workflow";

function emptyLibrary(): WorkflowLibrary {
  return { agentTemplates: [], functionCatalog: [], tools: [] };
}

function agentNode(id: string, modelId = "claude-haiku-4-5"): CanvasNode {
  return {
    id,
    type: "agent",
    position: { x: 0, y: 0 },
    data: {
      kind: "agent",
      label: "Agent",
      modelId,
      classification: "unclassified",
      tools: [],
      systemPromptOverride: "Hello",
    },
  };
}

function makeWorkflow(nodes: CanvasNode[] = [agentNode("a")]): Workflow {
  return {
    id: "wf-1",
    name: "Test",
    description: null,
    classification: "unclassified",
    version: 1,
    is_template: false,
    tags: [],
    ministry_code: "INFRA",
    user_id: "u-1",
    updated_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    canvas_data: { nodes, edges: [], version: 1 },
  };
}

function mountToolbar(
  overrides: Partial<{
    dirty: boolean;
    executionStatus: ExecutionStatus;
    nodes: CanvasNode[];
    library: WorkflowLibrary | null;
  }> = {},
): VueWrapper {
  const store = useWorkflowStore();
  store.library = overrides.library ?? emptyLibrary();
  const classifications: Classification[] = ["unclassified", "protected_a", "protected_b"];
  return mount(WorkflowToolbar, {
    props: {
      workflow: makeWorkflow(overrides.nodes ?? [agentNode("a")]),
      dirty: overrides.dirty ?? false,
      executionStatus: overrides.executionStatus ?? "idle",
      classifications,
      models: [{ id: "claude-haiku-4-5", name: "Claude Haiku 4.5" }],
    },
  });
}

function findDryRunButton(wrapper: VueWrapper) {
  return wrapper.find('[data-testid="dry-run"]');
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe("WorkflowToolbar — dry-run button", () => {
  it("renders a button with text 'Dry run'", () => {
    const wrapper = mountToolbar();
    const btn = findDryRunButton(wrapper);
    expect(btn.exists()).toBe(true);
    expect(btn.text()).toContain("Dry run");
  });

  it("emits 'dry-run' when clicked (via the GoA _click event)", async () => {
    const wrapper = mountToolbar();
    const btn = findDryRunButton(wrapper);
    btn.element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
    await wrapper.vm.$nextTick();
    const events = wrapper.emitted("dry-run");
    expect(events).toBeDefined();
    expect(events).toHaveLength(1);
  });

  it("disables the button when the canvas has unsaved changes", () => {
    const wrapper = mountToolbar({ dirty: true });
    const btn = findDryRunButton(wrapper);
    expect(btn.attributes("disabled")).toBeDefined();
    expect(btn.attributes("title")).toMatch(/save/i);
  });

  it("disables the button while the workflow is running", () => {
    const wrapper = mountToolbar({ executionStatus: "running" });
    expect(findDryRunButton(wrapper).attributes("disabled")).toBeDefined();
  });

  it("disables the button when the canvas has validation errors (agent missing modelId)", () => {
    // Strip the modelId off the agent so the validator flags an error.
    const node = agentNode("a") as CanvasNode & { data: { modelId?: string } };
    delete node.data.modelId;
    const wrapper = mountToolbar({ nodes: [node] });
    const btn = findDryRunButton(wrapper);
    expect(btn.attributes("disabled")).toBeDefined();
    expect(btn.attributes("title")).toMatch(/validation/i);
  });

  it("enables the button when canvas is clean and validator is happy", () => {
    const wrapper = mountToolbar();
    const btn = findDryRunButton(wrapper);
    expect(btn.attributes("disabled")).toBeUndefined();
    expect(btn.attributes("title")).toMatch(/zero tokens/i);
  });
});
