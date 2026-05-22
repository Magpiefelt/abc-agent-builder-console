/**
 * ToolNode renders a tool-handler node card. Falls back through
 * label → toolName → 'Untitled Tool'.
 */

import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";

vi.mock("@vue-flow/core", () => ({
  Handle: { name: "Handle", template: '<div data-testid="handle" />' },
  Position: { Left: "left", Right: "right", Top: "top", Bottom: "bottom" },
}));

import ToolNode from "../ToolNode.vue";
import type { ToolNodeData } from "@/types/workflow";

function dataFor(partial: Partial<ToolNodeData> = {}): ToolNodeData {
  return { kind: "tool", label: "", toolName: "brave_search", params: {}, ...partial };
}

describe("ToolNode", () => {
  it("renders the label when set, otherwise the toolName", () => {
    const labeled = mount(ToolNode, {
      props: { id: "n1", data: dataFor({ label: "Web search", toolName: "brave_search" }) },
    });
    expect(labeled.text()).toContain("Web search");
    expect(labeled.text()).toContain("brave_search");

    const unlabeled = mount(ToolNode, {
      props: { id: "n2", data: dataFor({ label: "", toolName: "send_email" }) },
    });
    expect(unlabeled.text()).toContain("send_email");
  });

  it("renders 'Untitled tool' when both label and toolName are empty", () => {
    const wrapper = mount(ToolNode, {
      props: { id: "n1", data: dataFor({ label: "", toolName: "" }) },
    });
    // The SFC lowercases "tool" in the fallback — see ToolNode.vue.
    expect(wrapper.text()).toContain("Untitled tool");
  });

  it("renders the 'Tool' kind chip", () => {
    const wrapper = mount(ToolNode, {
      props: { id: "n1", data: dataFor() },
    });
    expect(wrapper.text()).toContain("Tool");
  });

  it("highlights the border when selected", () => {
    const selected = mount(ToolNode, {
      props: { id: "n1", data: dataFor(), selected: true },
    });
    expect(selected.html()).toContain("border-[var(--goa-color-primary)]");
  });
});
