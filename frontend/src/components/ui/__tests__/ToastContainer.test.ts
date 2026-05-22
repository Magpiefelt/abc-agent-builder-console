/**
 * ToastContainer renders one goa-notification per active toast and dismisses
 * a toast when the notification emits _dismiss or _close. The toast queue is
 * module-level state in useToast, so each test resets it manually.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";

import ToastContainer from "../ToastContainer.vue";
import { useToast } from "@/composables/useToast";

function clearToasts() {
  const { toasts, dismiss } = useToast();
  // Snapshot ids first because dismiss mutates the array.
  for (const id of toasts.value.map((t) => t.id)) {
    dismiss(id);
  }
}

beforeEach(() => {
  clearToasts();
});

describe("ToastContainer", () => {
  it("renders nothing when the queue is empty", () => {
    const wrapper = mount(ToastContainer);
    expect(wrapper.findAll("goa-notification").length).toBe(0);
  });

  it("renders one goa-notification per toast with the configured message", async () => {
    const { push } = useToast();
    push({ kind: "info", message: "Saved." });
    push({ kind: "success", message: "Created." });

    const wrapper = mount(ToastContainer);
    await wrapper.vm.$nextTick();

    const notifications = wrapper.findAll("goa-notification");
    expect(notifications.length).toBe(2);
    expect(wrapper.text()).toContain("Saved.");
    expect(wrapper.text()).toContain("Created.");
  });

  it("maps toast kinds to goa-notification types", async () => {
    const { push } = useToast();
    push({ kind: "info", message: "info-msg" });
    push({ kind: "warning", message: "warning-msg" });
    push({ kind: "error", message: "error-msg" });
    push({ kind: "success", message: "success-msg" });

    const wrapper = mount(ToastContainer);
    await wrapper.vm.$nextTick();

    const types = wrapper
      .findAll("goa-notification")
      .map((n) => n.attributes("type"));
    expect(types).toEqual(["information", "important", "emergency", "event"]);
  });

  it("dismisses a toast when goa-notification emits _dismiss", async () => {
    const { push, toasts } = useToast();
    const id = push({ kind: "info", message: "go away", ttlMs: 0 });

    const wrapper = mount(ToastContainer);
    await wrapper.vm.$nextTick();
    expect(toasts.value.find((t) => t.id === id)).toBeDefined();

    wrapper.find("goa-notification").element.dispatchEvent(
      new CustomEvent("_dismiss", { bubbles: true }),
    );
    await wrapper.vm.$nextTick();

    expect(toasts.value.find((t) => t.id === id)).toBeUndefined();
    expect(wrapper.findAll("goa-notification").length).toBe(0);
  });

  it("dismisses a toast when goa-notification emits _close", async () => {
    const { push, toasts } = useToast();
    const id = push({ kind: "warning", message: "warning", ttlMs: 0 });

    const wrapper = mount(ToastContainer);
    await wrapper.vm.$nextTick();
    expect(toasts.value.find((t) => t.id === id)).toBeDefined();

    wrapper.find("goa-notification").element.dispatchEvent(
      new CustomEvent("_close", { bubbles: true }),
    );
    await wrapper.vm.$nextTick();

    expect(toasts.value.find((t) => t.id === id)).toBeUndefined();
  });

  it("exposes an aria-live polite region", () => {
    const wrapper = mount(ToastContainer);
    const region = wrapper.find('[aria-live="polite"]');
    expect(region.exists()).toBe(true);
    expect(region.attributes("aria-atomic")).toBe("true");
  });

  it("each toast wrapper has role=status for assistive tech", async () => {
    const { push } = useToast();
    push({ kind: "info", message: "hello" });
    const wrapper = mount(ToastContainer);
    await wrapper.vm.$nextTick();

    const role = wrapper.findAll('[role="status"]');
    expect(role.length).toBe(1);
  });
});
