/**
 * ControlBar shows session status / iteration count and exposes the
 * Stop / Interject / Continue actions. The agentSession store drives every
 * branch, so the tests seed the store and assert what the bar renders + emits.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";

// InterjectionModal mounts a real focus-trap into the DOM which is noisy in
// component tests for the bar. Stub it to a simple sentinel — we just need
// to confirm that the bar opens it.
vi.mock("@/components/freeAgent/InterjectionModal.vue", () => ({
  default: {
    name: "InterjectionModalStub",
    template: '<div data-testid="interject-modal-stub" />',
    emits: ["close"],
  },
}));

import ControlBar from "../ControlBar.vue";
import { useAgentSessionStore } from "@/stores/agentSession";

beforeEach(() => {
  setActivePinia(createPinia());
});

function meta(maxIterations = 10) {
  return {
    prompt: "do a thing",
    modelId: "claude-sonnet-4-6",
    classification: "unclassified",
    maxIterations,
  };
}

function statusBadge(wrapper: ReturnType<typeof mount>) {
  return wrapper.find('[data-testid="session-status-badge"]');
}

describe("ControlBar", () => {
  it("renders Idle by default and hides every action button", () => {
    const wrapper = mount(ControlBar);
    const badge = statusBadge(wrapper);
    expect(badge.exists()).toBe(true);
    expect(badge.attributes("content")).toBe("Idle");
    expect(badge.attributes("type")).toBe("midtone");
    // None of the three action buttons should appear in idle state.
    expect(wrapper.find("goa-button").exists()).toBe(false);
  });

  it("renders the running status label and shows Stop + Interject when running", async () => {
    const store = useAgentSessionStore();
    store.sessionId = "s-1";
    store.sessionMeta = meta(20);
    store.status = "running";
    store.currentIteration = 3;

    const wrapper = mount(ControlBar);
    const badge = statusBadge(wrapper);
    expect(badge.attributes("content")).toBe("Running");
    expect(badge.attributes("type")).toBe("information");
    expect(wrapper.text()).toContain("3 / 20");
    const buttons = wrapper.findAll("goa-button").map((b) => b.text().trim());
    expect(buttons).toContain("Stop");
    expect(buttons).toContain("Interject");
    expect(buttons).not.toContain("Continue");
  });

  it("shows Continue (but not Stop/Interject) once paused", () => {
    const store = useAgentSessionStore();
    store.sessionId = "s-1";
    store.sessionMeta = meta();
    store.status = "paused";

    const wrapper = mount(ControlBar);
    const badge = statusBadge(wrapper);
    expect(badge.attributes("content")).toBe("Paused");
    expect(badge.attributes("type")).toBe("important");
    const buttons = wrapper.findAll("goa-button").map((b) => b.text().trim());
    expect(buttons).toContain("Continue");
    expect(buttons).not.toContain("Stop");
    expect(buttons).not.toContain("Interject");
  });

  it("shows Continue when the session needs assistance", () => {
    const store = useAgentSessionStore();
    store.sessionId = "s-1";
    store.sessionMeta = meta();
    store.status = "needs_assistance";

    const wrapper = mount(ControlBar);
    const badge = statusBadge(wrapper);
    expect(badge.attributes("content")).toBe("Needs assistance");
    expect(badge.attributes("type")).toBe("important");
    const buttons = wrapper.findAll("goa-button").map((b) => b.text().trim());
    expect(buttons).toContain("Continue");
  });

  it("hides Continue / Interject in replay mode even when status would otherwise allow them", () => {
    const store = useAgentSessionStore();
    store.sessionId = "s-1";
    store.sessionMeta = meta();
    store.status = "completed";
    store.replayMode = true;

    const wrapper = mount(ControlBar);
    const badge = statusBadge(wrapper);
    expect(badge.attributes("content")).toBe("Completed");
    expect(badge.attributes("type")).toBe("success");
    const buttons = wrapper.findAll("goa-button").map((b) => b.text().trim());
    expect(buttons).not.toContain("Continue");
    expect(buttons).not.toContain("Interject");
  });

  it("uses the emergency badge variant when the session errored", () => {
    const store = useAgentSessionStore();
    store.sessionId = "s-1";
    store.sessionMeta = meta();
    store.status = "error";

    const wrapper = mount(ControlBar);
    const badge = statusBadge(wrapper);
    expect(badge.attributes("content")).toBe("Error");
    expect(badge.attributes("type")).toBe("emergency");
  });

  it("falls back to an em-dash when neither iteration nor max is known", () => {
    const store = useAgentSessionStore();
    store.sessionId = "s-1";
    store.status = "idle";
    store.currentIteration = 0;
    store.sessionMeta = null;

    const wrapper = mount(ControlBar);
    expect(wrapper.text()).toContain("—");
  });

  it("shows the raw iteration count when max is unknown", () => {
    const store = useAgentSessionStore();
    store.sessionId = "s-1";
    store.status = "running";
    store.currentIteration = 7;
    store.sessionMeta = null;

    const wrapper = mount(ControlBar);
    expect(wrapper.text()).toContain("7");
    expect(wrapper.text()).not.toContain("/ 0");
  });

  it("calls store.stop() when Stop is clicked", async () => {
    const store = useAgentSessionStore();
    store.sessionId = "s-1";
    store.status = "running";
    const stopSpy = vi.spyOn(store, "stop").mockResolvedValue(undefined);

    const wrapper = mount(ControlBar);
    const stopBtn = wrapper.findAll("goa-button").find((b) => b.text().trim() === "Stop");
    expect(stopBtn).toBeDefined();
    stopBtn!.element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(stopSpy).toHaveBeenCalledTimes(1);
  });

  it("opens the InterjectionModal stub when Interject is clicked", async () => {
    const store = useAgentSessionStore();
    store.sessionId = "s-1";
    store.status = "running";

    const wrapper = mount(ControlBar);
    expect(wrapper.find('[data-testid="interject-modal-stub"]').exists()).toBe(false);

    const btn = wrapper.findAll("goa-button").find((b) => b.text().trim() === "Interject");
    btn!.element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="interject-modal-stub"]').exists()).toBe(true);
  });

  it("reveals the continue form on click and posts the trimmed prompt", async () => {
    const store = useAgentSessionStore();
    store.sessionId = "s-1";
    store.status = "paused";
    const continueSpy = vi
      .spyOn(store, "continueSession")
      .mockResolvedValue(undefined);

    const wrapper = mount(ControlBar);
    expect(wrapper.find('goa-textarea[name="continuePrompt"]').exists()).toBe(false);

    const btn = wrapper.findAll("goa-button").find((b) => b.text().trim() === "Continue");
    btn!.element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
    await wrapper.vm.$nextTick();

    expect(wrapper.find('goa-textarea[name="continuePrompt"]').exists()).toBe(true);

    // Simulate the GoA textarea reporting a value, then the Continue-Session
    // primary button being clicked.
    const ta = wrapper.find('goa-textarea[name="continuePrompt"]');
    ta.element.dispatchEvent(
      new CustomEvent("_change", { detail: { value: "   next step  " }, bubbles: true }),
    );
    await wrapper.vm.$nextTick();

    const submit = wrapper
      .findAll("goa-button")
      .find((b) => b.text().trim() === "Continue Session");
    submit!.element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
    await wrapper.vm.$nextTick();
    // Microtask flush for the async handler.
    await Promise.resolve();

    expect(continueSpy).toHaveBeenCalledTimes(1);
    expect(continueSpy.mock.calls[0][0]).toBe("next step");
    expect(continueSpy.mock.calls[0][1]).toBeUndefined();
  });

  it("does not call continueSession when the prompt is whitespace-only", async () => {
    const store = useAgentSessionStore();
    store.sessionId = "s-1";
    store.status = "paused";
    const continueSpy = vi
      .spyOn(store, "continueSession")
      .mockResolvedValue(undefined);

    const wrapper = mount(ControlBar);
    const open = wrapper.findAll("goa-button").find((b) => b.text().trim() === "Continue");
    open!.element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
    await wrapper.vm.$nextTick();

    const submit = wrapper
      .findAll("goa-button")
      .find((b) => b.text().trim() === "Continue Session");
    // Prompt is still empty here, so submit should be a no-op.
    submit!.element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
    await wrapper.vm.$nextTick();
    await Promise.resolve();

    expect(continueSpy).not.toHaveBeenCalled();
  });

  it("passes additional iterations to continueSession when provided", async () => {
    const store = useAgentSessionStore();
    store.sessionId = "s-1";
    store.status = "paused";
    const continueSpy = vi
      .spyOn(store, "continueSession")
      .mockResolvedValue(undefined);

    const wrapper = mount(ControlBar);
    wrapper
      .findAll("goa-button")
      .find((b) => b.text().trim() === "Continue")!
      .element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
    await wrapper.vm.$nextTick();

    wrapper.find('goa-textarea[name="continuePrompt"]').element.dispatchEvent(
      new CustomEvent("_change", { detail: { value: "more please" }, bubbles: true }),
    );
    await wrapper.vm.$nextTick();

    wrapper.find('goa-input[name="continueAdditional"]').element.dispatchEvent(
      new CustomEvent("_change", { detail: { value: "5" }, bubbles: true }),
    );
    await wrapper.vm.$nextTick();

    wrapper
      .findAll("goa-button")
      .find((b) => b.text().trim() === "Continue Session")!
      .element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
    await wrapper.vm.$nextTick();
    await Promise.resolve();

    expect(continueSpy).toHaveBeenCalledWith("more please", 5);
  });

  it("surfaces a reconnect banner while the stream is reconnecting", () => {
    const store = useAgentSessionStore();
    store.sessionId = "s-1";
    store.status = "running";
    store.streamStatus = "reconnecting";

    const wrapper = mount(ControlBar);
    expect(wrapper.text()).toContain("Reconnecting to stream…");
  });
});
