/**
 * FinalReportPanel renders the session's terminal report. Markdown when the
 * report is a string, pretty-printed JSON otherwise. Provides copy + download
 * buttons.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";

import FinalReportPanel from "../FinalReportPanel.vue";
import { useAgentSessionStore } from "@/stores/agentSession";

beforeEach(() => {
  setActivePinia(createPinia());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("FinalReportPanel", () => {
  it("renders a string final report as markdown", () => {
    const store = useAgentSessionStore();
    store.finalReport = "# Done\n\nAll good.";

    const wrapper = mount(FinalReportPanel);
    expect(wrapper.html()).toContain("<h1>Done</h1>");
    expect(wrapper.html()).toContain("<p>All good.</p>");
    // No <pre> for the JSON branch.
    expect(wrapper.find("pre").exists()).toBe(false);
  });

  it("renders an object final report as pretty JSON", () => {
    const store = useAgentSessionStore();
    store.finalReport = { summary: "ok", items: 3 };

    const wrapper = mount(FinalReportPanel);
    const pre = wrapper.find("pre");
    expect(pre.exists()).toBe(true);
    const text = pre.text();
    expect(text).toContain('"summary": "ok"');
    expect(text).toContain('"items": 3');
  });

  it("copies the report text to the clipboard and flips the label briefly", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    // jsdom doesn't ship navigator.clipboard, so install one.
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    const store = useAgentSessionStore();
    store.finalReport = "the report text";

    const wrapper = mount(FinalReportPanel);
    const copy = wrapper.findAll("goa-button").find((b) => b.text().trim() === "Copy");
    expect(copy).toBeDefined();
    copy!.element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
    // Wait for the awaited writeText to settle.
    await Promise.resolve();
    await Promise.resolve();
    await wrapper.vm.$nextTick();

    expect(writeText).toHaveBeenCalledWith("the report text");
    expect(
      wrapper.findAll("goa-button").find((b) => b.text().trim() === "Copied!"),
    ).toBeDefined();

    // After 1.5s the label flips back to "Copy".
    vi.advanceTimersByTime(1600);
    await wrapper.vm.$nextTick();
    expect(
      wrapper.findAll("goa-button").find((b) => b.text().trim() === "Copy"),
    ).toBeDefined();

    vi.useRealTimers();
  });

  it("triggers a blob download with .md extension for string reports", () => {
    const store = useAgentSessionStore();
    store.finalReport = "report body";

    const createObjectURL = vi.fn(() => "blob:fake");
    const revokeObjectURL = vi.fn();
    // jsdom's URL doesn't implement these by default.
    (URL as unknown as { createObjectURL: typeof createObjectURL }).createObjectURL =
      createObjectURL;
    (URL as unknown as { revokeObjectURL: typeof revokeObjectURL }).revokeObjectURL =
      revokeObjectURL;

    // Capture the dynamically-created <a> so we can inspect its download attr.
    const createElement = document.createElement.bind(document);
    const created: HTMLAnchorElement[] = [];
    vi.spyOn(document, "createElement").mockImplementation((tag) => {
      const el = createElement(tag);
      if (tag === "a") {
        // Click is a no-op in jsdom anyway; just observe.
        (el as HTMLAnchorElement).click = vi.fn();
        created.push(el as HTMLAnchorElement);
      }
      return el;
    });

    const wrapper = mount(FinalReportPanel);
    const dl = wrapper.findAll("goa-button").find((b) => b.text().trim() === "Download");
    dl!.element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(created.length).toBe(1);
    expect(created[0].href).toContain("blob:fake");
    expect(created[0].download).toMatch(/^final-report-.*\.md$/);
  });

  it("triggers a blob download with .json extension for object reports", () => {
    const store = useAgentSessionStore();
    store.finalReport = { ok: true };

    (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:x";
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};

    const createElement = document.createElement.bind(document);
    const created: HTMLAnchorElement[] = [];
    vi.spyOn(document, "createElement").mockImplementation((tag) => {
      const el = createElement(tag);
      if (tag === "a") {
        (el as HTMLAnchorElement).click = vi.fn();
        created.push(el as HTMLAnchorElement);
      }
      return el;
    });

    const wrapper = mount(FinalReportPanel);
    const dl = wrapper.findAll("goa-button").find((b) => b.text().trim() === "Download");
    dl!.element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
    expect(created[0].download).toMatch(/\.json$/);
  });

  it("silently absorbs a clipboard rejection", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
      configurable: true,
    });

    const store = useAgentSessionStore();
    store.finalReport = "anything";

    const wrapper = mount(FinalReportPanel);
    const copy = wrapper.findAll("goa-button").find((b) => b.text().trim() === "Copy");
    copy!.element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    await wrapper.vm.$nextTick();

    // No throw, label stays as Copy.
    expect(
      wrapper.findAll("goa-button").find((b) => b.text().trim() === "Copy"),
    ).toBeDefined();
  });
});
