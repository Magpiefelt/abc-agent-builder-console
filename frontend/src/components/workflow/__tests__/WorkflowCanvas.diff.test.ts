/**
 * WorkflowCanvas diff overlay tests (Backlog F1).
 *
 * These tests focus on the F1 surface — the `diffOverlay` prop and the
 * mapping from diff sets to CSS classes / ghost nodes — without booting
 * Vue Flow's heavy DOM machinery. We stub `@vue-flow/core` to a tiny
 * passthrough component that exposes whatever nodes and edges WorkflowCanvas
 * computes, so assertions can read them as DOM attributes.
 */

import { describe, it, expect, vi } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import type {
  CanvasEdge,
  CanvasNode,
} from "@/types/workflow";

// Stub Vue Flow before importing WorkflowCanvas. The stub renders each node /
// edge as a <div data-testid="vf-node" :data-id :class> so tests can inspect
// what WorkflowCanvas pushes through the computeds without rendering a real
// graph. The stub fires no events; we never exercise drag/connect/drop here.
vi.mock("@vue-flow/core", () => {
  return {
    VueFlow: defineComponent({
      name: "VueFlowStub",
      props: {
        nodes: { type: Array, default: () => [] },
        edges: { type: Array, default: () => [] },
      },
      setup(props) {
        return () =>
          h(
            "div",
            { class: "vue-flow-stub" },
            [
              ...(props.nodes as Array<{ id: string; class?: string }>).map((n) =>
                h("div", {
                  "data-testid": "vf-node",
                  "data-id": n.id,
                  class: ["vue-flow__node", n.class].filter(Boolean).join(" "),
                }),
              ),
              ...(props.edges as Array<{ id: string; class?: string }>).map((e) =>
                h("div", {
                  "data-testid": "vf-edge",
                  "data-id": e.id,
                  class: ["vue-flow__edge", e.class].filter(Boolean).join(" "),
                }),
              ),
            ],
          );
      },
    }),
    useVueFlow: () => ({ project: (p: { x: number; y: number }) => p }),
  };
});

// Vue Flow CSS side-effect imports are no-ops under jsdom + the stub.
vi.mock("@vue-flow/core/dist/style.css", () => ({}));
vi.mock("@vue-flow/core/dist/theme-default.css", () => ({}));

import WorkflowCanvas, {
  type CanvasDiffOverlay,
} from "../WorkflowCanvas.vue";

function agentNode(id: string, x = 0, y = 0): CanvasNode {
  return {
    id,
    type: "agent",
    position: { x, y },
    data: {
      kind: "agent",
      label: id,
      modelId: "claude-sonnet-4-6",
      classification: "unclassified",
      tools: [],
    },
  };
}

function edge(id: string, source: string, target: string): CanvasEdge {
  return { id, source, target };
}

function emptyOverlay(): CanvasDiffOverlay {
  return {
    removedNodeIds: new Set(),
    modifiedNodeIds: new Set(),
    addedNodes: [],
    removedEdgeIds: new Set(),
    modifiedEdgeIds: new Set(),
    addedEdges: [],
  };
}

describe("WorkflowCanvas diff overlay (F1)", () => {
  it("renders without any diff classes when diffOverlay is null", () => {
    const wrapper = mount(WorkflowCanvas, {
      props: {
        nodes: [agentNode("n1"), agentNode("n2")],
        edges: [edge("e1", "n1", "n2")],
        diffOverlay: null,
      },
    });
    const nodeEls = wrapper.findAll('[data-testid="vf-node"]');
    expect(nodeEls).toHaveLength(2);
    for (const el of nodeEls) {
      expect(el.classes()).not.toContain("abc-diff-removed");
      expect(el.classes()).not.toContain("abc-diff-modified");
      expect(el.classes()).not.toContain("abc-diff-added");
    }
    const edgeEl = wrapper.find('[data-testid="vf-edge"]');
    expect(edgeEl.classes()).not.toContain("abc-diff-removed");
    expect(edgeEl.classes()).not.toContain("abc-diff-modified");
  });

  it("applies abc-diff-removed to nodes that are listed in removedNodeIds", () => {
    const overlay = emptyOverlay();
    (overlay.removedNodeIds as Set<string>).add("n2");
    const wrapper = mount(WorkflowCanvas, {
      props: {
        nodes: [agentNode("n1"), agentNode("n2")],
        edges: [],
        diffOverlay: overlay,
      },
    });
    const n1 = wrapper.find('[data-id="n1"]');
    const n2 = wrapper.find('[data-id="n2"]');
    expect(n1.classes()).not.toContain("abc-diff-removed");
    expect(n2.classes()).toContain("abc-diff-removed");
  });

  it("applies abc-diff-modified to nodes listed in modifiedNodeIds", () => {
    const overlay = emptyOverlay();
    (overlay.modifiedNodeIds as Set<string>).add("n1");
    const wrapper = mount(WorkflowCanvas, {
      props: {
        nodes: [agentNode("n1"), agentNode("n2")],
        edges: [],
        diffOverlay: overlay,
      },
    });
    expect(wrapper.find('[data-id="n1"]').classes()).toContain("abc-diff-modified");
    expect(wrapper.find('[data-id="n2"]').classes()).not.toContain("abc-diff-modified");
  });

  it("removed wins over modified when the same id appears in both sets (defensive)", () => {
    const overlay = emptyOverlay();
    (overlay.removedNodeIds as Set<string>).add("n1");
    (overlay.modifiedNodeIds as Set<string>).add("n1");
    const wrapper = mount(WorkflowCanvas, {
      props: { nodes: [agentNode("n1")], edges: [], diffOverlay: overlay },
    });
    const cls = wrapper.find('[data-id="n1"]').classes();
    expect(cls).toContain("abc-diff-removed");
    expect(cls).not.toContain("abc-diff-modified");
  });

  it("renders ghost nodes for addedNodes with abc-diff-added + abc-diff-ghost", () => {
    const overlay: CanvasDiffOverlay = {
      ...emptyOverlay(),
      addedNodes: [agentNode("g1", 100, 50), agentNode("g2", 200, 100)],
    };
    const wrapper = mount(WorkflowCanvas, {
      props: { nodes: [agentNode("n1")], edges: [], diffOverlay: overlay },
    });
    // 1 real node + 2 ghosts = 3 vf-node renders
    expect(wrapper.findAll('[data-testid="vf-node"]')).toHaveLength(3);
    const ghost1 = wrapper.find('[data-id="__diff-ghost-g1"]');
    const ghost2 = wrapper.find('[data-id="__diff-ghost-g2"]');
    expect(ghost1.exists()).toBe(true);
    expect(ghost2.exists()).toBe(true);
    expect(ghost1.classes()).toContain("abc-diff-added");
    expect(ghost1.classes()).toContain("abc-diff-ghost");
    expect(ghost2.classes()).toContain("abc-diff-added");
    expect(ghost2.classes()).toContain("abc-diff-ghost");
  });

  it("does not surface ghost nodes when addedNodes is empty", () => {
    const wrapper = mount(WorkflowCanvas, {
      props: { nodes: [agentNode("n1")], edges: [], diffOverlay: emptyOverlay() },
    });
    expect(wrapper.findAll('[data-testid="vf-node"]')).toHaveLength(1);
  });

  it("applies edge diff classes via diffClassForEdge", () => {
    const overlay = emptyOverlay();
    (overlay.removedEdgeIds as Set<string>).add("e1");
    (overlay.modifiedEdgeIds as Set<string>).add("e2");
    const wrapper = mount(WorkflowCanvas, {
      props: {
        nodes: [agentNode("a"), agentNode("b"), agentNode("c")],
        edges: [edge("e1", "a", "b"), edge("e2", "b", "c"), edge("e3", "a", "c")],
        diffOverlay: overlay,
      },
    });
    expect(wrapper.find('[data-id="e1"]').classes()).toContain("abc-diff-removed");
    expect(wrapper.find('[data-id="e2"]').classes()).toContain("abc-diff-modified");
    const e3 = wrapper.find('[data-id="e3"]');
    expect(e3.classes()).not.toContain("abc-diff-removed");
    expect(e3.classes()).not.toContain("abc-diff-modified");
  });

  it("renders ghost edges for addedEdges with abc-diff-added + abc-diff-ghost and a ghost id prefix", () => {
    // An added edge can hang off (a) two existing real nodes, (b) two added
    // (ghost) nodes, or (c) one of each. The component must rewrite endpoint
    // ids to the ghost prefix only when the endpoint itself is a ghost.
    const overlay: CanvasDiffOverlay = {
      ...emptyOverlay(),
      addedNodes: [agentNode("g1")],
      addedEdges: [
        edge("ae1", "g1", "real-b"), // ghost → real (g1 is added)
        edge("ae2", "real-a", "real-b"), // both real (e.g. a freshly drawn connection between existing nodes)
      ],
    };
    const wrapper = mount(WorkflowCanvas, {
      props: {
        nodes: [agentNode("real-a"), agentNode("real-b")],
        edges: [],
        diffOverlay: overlay,
      },
    });
    expect(wrapper.findAll('[data-testid="vf-edge"]')).toHaveLength(2);
    const ae1 = wrapper.find('[data-id="__diff-ghost-ae1"]');
    expect(ae1.exists()).toBe(true);
    expect(ae1.classes()).toContain("abc-diff-added");
    expect(ae1.classes()).toContain("abc-diff-ghost");
    expect(wrapper.find('[data-id="__diff-ghost-ae2"]').exists()).toBe(true);
  });

  it("preserves the existing execution status classes alongside diff classes", () => {
    const overlay = emptyOverlay();
    (overlay.modifiedNodeIds as Set<string>).add("n1");
    const wrapper = mount(WorkflowCanvas, {
      props: {
        nodes: [agentNode("n1")],
        edges: [],
        diffOverlay: overlay,
        executionStages: new Map([["n1", { status: "running" }]]),
      },
    });
    const cls = wrapper.find('[data-id="n1"]').classes();
    // Both the running-ring (from execution status) and the modified ring
    // (from the diff overlay) should co-exist on the node.
    expect(cls.join(" ")).toMatch(/ring-/);
    expect(cls).toContain("abc-diff-modified");
  });
});
