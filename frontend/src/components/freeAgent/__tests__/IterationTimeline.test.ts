/**
 * IterationTimeline renders one card per session iteration in reverse order,
 * auto-expands the currently running iteration, and tracks user expand /
 * collapse choices.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";

import IterationTimeline from "../IterationTimeline.vue";
import { useAgentSessionStore, type IterationRecord } from "@/stores/agentSession";

function iter(
  n: number,
  partial: Partial<IterationRecord> = {},
): IterationRecord {
  return {
    iteration: n,
    status: "completed",
    toolCalls: [],
    toolResults: [],
    ...partial,
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe("IterationTimeline", () => {
  it("shows an empty hint when no iterations have streamed in yet", () => {
    const wrapper = mount(IterationTimeline);
    expect(wrapper.text()).toContain("No iterations yet");
  });

  it("renders iteration cards in descending iteration order", () => {
    const store = useAgentSessionStore();
    store.iterations = [
      iter(1, { userMessage: "first" }),
      iter(2, { userMessage: "second" }),
      iter(3, { userMessage: "third" }),
    ];

    const wrapper = mount(IterationTimeline);
    // Use the expand-toggle's aria-controls attribute to scope the selector
    // — Bot 19 added a sibling pin-toggle button per row, so the bare
    // "article button" selector now returns both buttons per iteration.
    const headings = wrapper
      .findAll('article button[aria-controls]')
      .map((b) => b.text());
    expect(headings[0]).toContain("#3");
    expect(headings[1]).toContain("#2");
    expect(headings[2]).toContain("#1");
    expect(wrapper.text()).toContain("3 total");
  });

  it("auto-expands the running iteration so the operator sees live state", () => {
    const store = useAgentSessionStore();
    store.iterations = [
      iter(1, { status: "completed", thinking: "first thought" }),
      iter(2, {
        status: "running",
        thinking: "second thought",
        toolCalls: [{ tool: "brave_search" }],
      }),
    ];
    store.status = "running";
    store.currentIteration = 2;

    const wrapper = mount(IterationTimeline);

    const running = wrapper.find('[id="iter-2"]');
    expect(running.exists()).toBe(true);
    expect(running.text()).toContain("second thought");
    expect(running.text()).toContain("brave_search");

    // Completed iteration should NOT be auto-expanded.
    expect(wrapper.find('[id="iter-1"]').exists()).toBe(false);
  });

  it("collapses an iteration when its header is clicked", async () => {
    const store = useAgentSessionStore();
    store.iterations = [
      iter(1, { status: "completed", thinking: "the thought" }),
    ];

    const wrapper = mount(IterationTimeline);
    expect(wrapper.find('[id="iter-1"]').exists()).toBe(false);

    // Expand it.
    await wrapper.find('button[aria-controls="iter-1"]').trigger("click");
    expect(wrapper.find('[id="iter-1"]').exists()).toBe(true);

    // Collapse it again.
    await wrapper.find('button[aria-controls="iter-1"]').trigger("click");
    expect(wrapper.find('[id="iter-1"]').exists()).toBe(false);
  });

  it("lets the user explicitly collapse a running iteration", async () => {
    const store = useAgentSessionStore();
    store.iterations = [
      iter(1, { status: "running", userMessage: "go" }),
    ];
    store.status = "running";
    store.currentIteration = 1;

    const wrapper = mount(IterationTimeline);
    // Auto-expanded.
    expect(wrapper.find('[id="iter-1"]').exists()).toBe(true);

    await wrapper.find('button[aria-controls="iter-1"]').trigger("click");
    expect(wrapper.find('[id="iter-1"]').exists()).toBe(false);
  });

  it("expand-all and collapse-all toggle every card", async () => {
    const store = useAgentSessionStore();
    store.iterations = [iter(1), iter(2), iter(3)];

    const wrapper = mount(IterationTimeline);

    // None expanded initially (no running iteration).
    expect(wrapper.findAll("[id^=iter-]").length).toBe(0);

    const toggle = wrapper.find("header button");
    expect(toggle.text()).toBe("Expand all");

    await toggle.trigger("click");
    expect(wrapper.findAll("[id^=iter-]").length).toBe(3);
    expect(wrapper.find("header button").text()).toBe("Collapse all");

    await wrapper.find("header button").trigger("click");
    expect(wrapper.findAll("[id^=iter-]").length).toBe(0);
  });

  it("renders tool calls and tool results when expanded", async () => {
    const store = useAgentSessionStore();
    store.iterations = [
      iter(1, {
        status: "completed",
        toolCalls: [{ tool: "brave_search" }, { tool: "web_scrape" }],
        toolResults: [
          { tool: "brave_search", success: true, durationMs: 350 },
          { tool: "web_scrape", success: false, durationMs: 1200, error: "timeout" },
        ],
      }),
    ];

    const wrapper = mount(IterationTimeline);
    await wrapper.find('button[aria-controls="iter-1"]').trigger("click");
    const body = wrapper.find('[id="iter-1"]');
    expect(body.text()).toContain("brave_search");
    expect(body.text()).toContain("web_scrape");
    expect(body.text()).toContain("350 ms");
    expect(body.text()).toContain("1.2 s");
    expect(body.text()).toContain("timeout");
  });

  it("renders an iteration error when one is recorded", async () => {
    const store = useAgentSessionStore();
    store.iterations = [
      iter(1, { status: "error", error: "llm refused" }),
    ];

    const wrapper = mount(IterationTimeline);
    await wrapper.find('button[aria-controls="iter-1"]').trigger("click");
    const body = wrapper.find('[id="iter-1"]');
    expect(body.text()).toContain("llm refused");
  });

  it("hides the Expand all toggle when there is only one iteration", () => {
    const store = useAgentSessionStore();
    store.iterations = [iter(1)];

    const wrapper = mount(IterationTimeline);
    expect(wrapper.find("header button").exists()).toBe(false);
  });

  it("clears tracked expanded/collapsed state when the session id changes", async () => {
    const store = useAgentSessionStore();
    store.sessionId = "session-1";
    store.iterations = [iter(1, { status: "completed", thinking: "hi" })];

    const wrapper = mount(IterationTimeline);
    await wrapper.find('button[aria-controls="iter-1"]').trigger("click");
    expect(wrapper.find('[id="iter-1"]').exists()).toBe(true);

    // Simulate "started a new session": new id + new iteration list.
    store.sessionId = "session-2";
    store.iterations = [iter(1, { status: "completed", thinking: "fresh" })];
    await wrapper.vm.$nextTick();
    // Watcher should have cleared manuallyExpanded, so the new iteration is
    // collapsed by default (no running iteration to auto-expand it).
    expect(wrapper.find('[id="iter-1"]').exists()).toBe(false);
  });

  // ============================================================================
  // PIN TOGGLE (Bot 19, F8)
  // ============================================================================

  describe("pin toggle", () => {
    it("renders a pin button per iteration row", () => {
      const store = useAgentSessionStore();
      store.iterations = [iter(1), iter(2)];

      const wrapper = mount(IterationTimeline);
      const pins = wrapper.findAll('[data-testid="iteration-pin-toggle"]');
      expect(pins.length).toBe(2);
      // Each pin button is keyboard-reachable (a real <button>) with
      // aria-pressed indicating current state. Default = false.
      pins.forEach((btn) => expect(btn.attributes("aria-pressed")).toBe("false"));
    });

    it("reflects pinned state in aria-pressed and label", () => {
      const store = useAgentSessionStore();
      store.iterations = [
        iter(1, { pinned: false }),
        iter(2, { pinned: true }),
      ];

      const wrapper = mount(IterationTimeline);
      const pins = wrapper.findAll('[data-testid="iteration-pin-toggle"]');
      // sortedIterations puts pinned iterations first — iter 2 is at index 0.
      expect(pins[0].attributes("aria-pressed")).toBe("true");
      expect(pins[0].attributes("aria-label")).toContain("Unpin iteration 2");
      expect(pins[1].attributes("aria-pressed")).toBe("false");
      expect(pins[1].attributes("aria-label")).toContain("Pin iteration 1");
    });

    it("sorts pinned iterations to the top of the timeline", () => {
      const store = useAgentSessionStore();
      store.iterations = [
        iter(1, { userMessage: "one" }),
        iter(2, { userMessage: "two", pinned: true }),
        iter(3, { userMessage: "three" }),
      ];

      const wrapper = mount(IterationTimeline);
      const headings = wrapper
        .findAll('article button[aria-controls]')
        .map((b) => b.text());
      // Pinned #2 first, then non-pinned by iteration desc (#3, #1).
      expect(headings[0]).toContain("#2");
      expect(headings[1]).toContain("#3");
      expect(headings[2]).toContain("#1");
    });

    it("renders a 'Pinned' indicator on pinned rows", () => {
      const store = useAgentSessionStore();
      store.iterations = [iter(1, { pinned: true })];

      const wrapper = mount(IterationTimeline);
      expect(wrapper.text()).toContain("Pinned");
    });

    it("calls toggleIterationPin with the inverse of current pinned state", async () => {
      const store = useAgentSessionStore();
      store.sessionId = "session-xyz";
      store.iterations = [iter(1, { pinned: false })];

      const toggleSpy = vi.fn().mockResolvedValue(undefined);
      // Override the store action so we can observe the call.
      store.toggleIterationPin = toggleSpy as typeof store.toggleIterationPin;

      const wrapper = mount(IterationTimeline);
      await wrapper.find('[data-testid="iteration-pin-toggle"]').trigger("click");

      expect(toggleSpy).toHaveBeenCalledWith("session-xyz", 1, true);
    });

    it("does not fire when no session id is set", async () => {
      const store = useAgentSessionStore();
      store.sessionId = null;
      store.iterations = [iter(1)];

      const toggleSpy = vi.fn().mockResolvedValue(undefined);
      store.toggleIterationPin = toggleSpy as typeof store.toggleIterationPin;

      const wrapper = mount(IterationTimeline);
      await wrapper.find('[data-testid="iteration-pin-toggle"]').trigger("click");

      expect(toggleSpy).not.toHaveBeenCalled();
    });

    it("does not expand or collapse the iteration when the pin button is clicked", async () => {
      const store = useAgentSessionStore();
      store.sessionId = "session-1";
      store.iterations = [iter(1, { status: "completed", thinking: "hidden" })];

      store.toggleIterationPin = vi.fn().mockResolvedValue(undefined);

      const wrapper = mount(IterationTimeline);
      // Body is collapsed before the pin click.
      expect(wrapper.find('[id="iter-1"]').exists()).toBe(false);
      await wrapper.find('[data-testid="iteration-pin-toggle"]').trigger("click");
      // Still collapsed: the pin click is `@click.stop`, it does not bubble
      // to the outer expand-toggle. (`stopPropagation` test surrogate.)
      expect(wrapper.find('[id="iter-1"]').exists()).toBe(false);
    });
  });
});
