/**
 * FunctionNode renders a deterministic-function node card. Falls back through
 * label → fnName → 'Untitled Function'.
 */

import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";

vi.mock("@vue-flow/core", () => ({
  Handle: { name: "Handle", template: '<div data-testid="handle" />' },
  Position: { Left: "left", Right: "right", Top: "top", Bottom: "bottom" },
}));

import FunctionNode from "../FunctionNode.vue";
import type { FunctionNodeData } from "@/types/workflow";

function dataFor(partial: Partial<FunctionNodeData> = {}): FunctionNodeData {
  return { kind: "function", label: "", fnName: "concat", params: {}, ...partial };
}

describe("FunctionNode", () => {
  it("renders the label when set, falling back to fnName", () => {
    const labeled = mount(FunctionNode, {
      props: { id: "n1", data: dataFor({ label: "Combine strings", fnName: "concat" }) },
    });
    expect(labeled.text()).toContain("Combine strings");
    expect(labeled.text()).toContain("concat");

    const unlabeled = mount(FunctionNode, {
      props: { id: "n2", data: dataFor({ label: "", fnName: "uppercase" }) },
    });
    expect(unlabeled.text()).toContain("uppercase");
  });

  it("renders 'Untitled function' when both label and fnName are absent", () => {
    const wrapper = mount(FunctionNode, {
      props: { id: "n1", data: dataFor({ label: "", fnName: "" }) },
    });
    // The SFC lowercases "function" in the fallback — see FunctionNode.vue line ~32.
    expect(wrapper.text()).toContain("Untitled function");
  });

  it("renders the 'Function' kind chip", () => {
    const wrapper = mount(FunctionNode, {
      props: { id: "n1", data: dataFor() },
    });
    expect(wrapper.text()).toContain("Function");
  });

  it("highlights the border when selected", () => {
    const selected = mount(FunctionNode, {
      props: { id: "n1", data: dataFor(), selected: true },
    });
    expect(selected.html()).toContain("border-[var(--goa-color-primary)]");

    const unselected = mount(FunctionNode, {
      props: { id: "n2", data: dataFor(), selected: false },
    });
    // The SFC tints the unselected border with the greyscale-400 token to
    // visually quiet deterministic-function nodes. See FunctionNode.vue line ~20.
    expect(unselected.html()).toContain("border-[var(--goa-color-greyscale-400)]");
  });
});
