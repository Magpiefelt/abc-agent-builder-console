/**
 * AgentNode renders one Vue Flow custom node card for an agent in a workflow.
 * The label/template/model strings come from the node's data payload.
 *
 * Vue Flow's Handle component requires a node registry from a parent VueFlow
 * canvas — when we mount one node in isolation, the registry is absent and
 * the real Handle throws. Stub it down to a sentinel so the test focuses on
 * the node's own template.
 */

import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";

vi.mock("@vue-flow/core", () => ({
  Handle: { name: "Handle", template: '<div data-testid="handle" />' },
  Position: { Left: "left", Right: "right", Top: "top", Bottom: "bottom" },
}));

import AgentNode from "../AgentNode.vue";
import type { AgentNodeData } from "@/types/workflow";

function dataFor(partial: Partial<AgentNodeData> = {}): AgentNodeData {
  return {
    kind: "agent",
    label: "Researcher",
    modelId: "claude-sonnet-4-6",
    classification: "unclassified",
    tools: [],
    ...partial,
  };
}

describe("AgentNode", () => {
  it("renders the label and model id", () => {
    const wrapper = mount(AgentNode, {
      props: { id: "n1", data: dataFor({ label: "Policy Researcher" }) },
    });
    expect(wrapper.text()).toContain("Policy Researcher");
    expect(wrapper.text()).toContain("claude-sonnet-4-6");
    expect(wrapper.text()).toContain("Agent");
  });

  it("falls back to 'Untitled agent' when label is empty", () => {
    const wrapper = mount(AgentNode, {
      props: { id: "n1", data: dataFor({ label: "" }) },
    });
    // The SFC was restyled and lowercased "agent" — tests now match the
    // actual production output. See `AgentNode.vue` line ~32.
    expect(wrapper.text()).toContain("Untitled agent");
  });

  it("shows the modelId or 'no model selected' as the secondary line", () => {
    const withModel = mount(AgentNode, {
      props: { id: "n1", data: dataFor({ modelId: "claude-sonnet-4-6" }) },
    });
    expect(withModel.text()).toContain("claude-sonnet-4-6");

    const noModel = mount(AgentNode, {
      // Cast to AgentNodeData — modelId is required by the type but we want to
      // exercise the empty-string fallback the SFC handles.
      props: { id: "n2", data: dataFor({ modelId: "" }) },
    });
    expect(noModel.text()).toContain("no model selected");
  });

  it("highlights the border when selected", () => {
    const unselected = mount(AgentNode, {
      props: { id: "n1", data: dataFor(), selected: false },
    });
    // The SFC tints the unselected border with the GoA info token (sibling of
    // the info-light background fill). See `AgentNode.vue` line ~20.
    expect(unselected.html()).toContain("border-[var(--goa-color-info)]");

    const selected = mount(AgentNode, {
      props: { id: "n2", data: dataFor(), selected: true },
    });
    expect(selected.html()).toContain("border-[var(--goa-color-primary)]");
  });
});
