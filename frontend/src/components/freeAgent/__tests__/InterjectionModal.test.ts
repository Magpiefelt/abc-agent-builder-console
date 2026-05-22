/**
 * InterjectionModal renders a goa-modal with a textarea, posts the trimmed
 * message via session.interject, then emits close.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";

import InterjectionModal from "../InterjectionModal.vue";
import { useAgentSessionStore } from "@/stores/agentSession";

beforeEach(() => {
  setActivePinia(createPinia());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("InterjectionModal", () => {
  it("renders a modal with cancel + send buttons", () => {
    const wrapper = mount(InterjectionModal);
    expect(wrapper.find("goa-modal").exists()).toBe(true);
    const labels = wrapper.findAll("goa-button").map((b) => b.text().trim());
    expect(labels).toContain("Cancel");
    expect(labels).toContain("Send");
  });

  it("emits close when the modal's cancel emits", async () => {
    const wrapper = mount(InterjectionModal);
    const cancel = wrapper.findAll("goa-button").find((b) => b.text().trim() === "Cancel");
    cancel!.element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("emits close when goa-modal emits _close", async () => {
    const wrapper = mount(InterjectionModal);
    wrapper.find("goa-modal").element.dispatchEvent(new CustomEvent("_close", { bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("does not call session.interject when the message is empty", async () => {
    const store = useAgentSessionStore();
    const spy = vi.spyOn(store, "interject").mockResolvedValue(undefined);

    const wrapper = mount(InterjectionModal);
    const send = wrapper.findAll("goa-button").find((b) => b.text().trim() === "Send");
    send!.element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
    await wrapper.vm.$nextTick();
    await Promise.resolve();
    expect(spy).not.toHaveBeenCalled();
  });

  it("posts the trimmed message and emits close", async () => {
    const store = useAgentSessionStore();
    const spy = vi.spyOn(store, "interject").mockResolvedValue(undefined);

    const wrapper = mount(InterjectionModal);
    wrapper.find('goa-textarea[name="interject-msg"]').element.dispatchEvent(
      new CustomEvent("_change", { detail: { value: "   focus on Section 3   " }, bubbles: true }),
    );
    await wrapper.vm.$nextTick();

    const send = wrapper.findAll("goa-button").find((b) => b.text().trim() === "Send");
    send!.element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
    await wrapper.vm.$nextTick();
    await Promise.resolve();
    await Promise.resolve();

    expect(spy).toHaveBeenCalledWith("focus on Section 3");
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("submits on Ctrl+Enter and removes the listener on unmount", async () => {
    const store = useAgentSessionStore();
    const spy = vi.spyOn(store, "interject").mockResolvedValue(undefined);

    const wrapper = mount(InterjectionModal, { attachTo: document.body });
    wrapper.find('goa-textarea[name="interject-msg"]').element.dispatchEvent(
      new CustomEvent("_change", { detail: { value: "hi" }, bubbles: true }),
    );
    await wrapper.vm.$nextTick();

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true }));
    await wrapper.vm.$nextTick();
    await Promise.resolve();
    await Promise.resolve();
    expect(spy).toHaveBeenCalledTimes(1);

    wrapper.unmount();
    // After unmount, the listener should be gone — another keydown should be ignored.
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true }));
    await Promise.resolve();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
