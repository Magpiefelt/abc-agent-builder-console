/**
 * PromptCustomizer loads the prompt template from /api/agent/prompt-template,
 * tracks which sections the user toggled/edited, and emits a save event with
 * only the diffs.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";

const apiFetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/composables/useApiFetch", () => ({
  apiFetch: apiFetchMock,
}));

import PromptCustomizer from "../PromptCustomizer.vue";

const baseSections = [
  { id: "identity", title: "Identity", enabled: true, content: "You are an analyst.", priority: 1 },
  { id: "tone", title: "Tone", enabled: true, content: "Be concise.", priority: 3 },
  { id: "trailer", title: "Trailer", enabled: false, content: "End with a summary.", priority: 4 },
];

beforeEach(() => {
  setActivePinia(createPinia());
  apiFetchMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mountReady(initialOverrides: Record<string, { enabled?: boolean; content?: string }> = {}) {
  apiFetchMock.mockResolvedValue({ sections: baseSections });
  return mount(PromptCustomizer, { props: { initialOverrides } });
}

describe("PromptCustomizer", () => {
  it("loads sections from the API and renders one row per section", async () => {
    const wrapper = mountReady();
    await flushPromises();

    expect(apiFetchMock).toHaveBeenCalledWith("/api/agent/prompt-template");
    expect(wrapper.findAll("article").length).toBe(3);
    // Titles ride on the goa-checkbox `text` attribute (web component) rather
    // than as text nodes, so assert via attribute presence.
    expect(wrapper.find('goa-checkbox[text="Identity"]').exists()).toBe(true);
    expect(wrapper.find('goa-checkbox[text="Tone"]').exists()).toBe(true);
    expect(wrapper.find('goa-checkbox[text="Trailer"]').exists()).toBe(true);
  });

  it("seeds enabled/content from initialOverrides when present", async () => {
    const wrapper = mountReady({ tone: { enabled: false, content: "Be terse." } });
    await flushPromises();

    // The override count should be 1 because `tone` differs from base.
    expect(wrapper.find('goa-badge[content="1 change"]').exists()).toBe(true);
  });

  it("emits save with only the changed sections", async () => {
    const wrapper = mountReady();
    await flushPromises();

    // Disable Tone.
    const toneCheckbox = wrapper.find('goa-checkbox[name="enabled-tone"]');
    toneCheckbox.element.dispatchEvent(
      new CustomEvent("_change", { detail: { checked: false }, bubbles: true }),
    );
    await wrapper.vm.$nextTick();

    // Edit Trailer content. The article containing the trailer checkbox is the
    // one whose own Edit button we want to click.
    const trailerArticle = wrapper.findAll("article").find((a) =>
      a.find('goa-checkbox[name="enabled-trailer"]').exists(),
    );
    expect(trailerArticle).toBeDefined();
    const trailerEdit = trailerArticle!.findAll("goa-button").find((b) => b.text().trim() === "Edit");
    expect(trailerEdit).toBeDefined();
    trailerEdit!.element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
    await wrapper.vm.$nextTick();

    const ta = wrapper.find('goa-textarea[name="textarea-trailer"]');
    ta.element.dispatchEvent(
      new CustomEvent("_change", { detail: { value: "End with bullet points." }, bubbles: true }),
    );
    await wrapper.vm.$nextTick();

    // Save.
    const saveBtn = wrapper.findAll("goa-button").find((b) => b.text().trim().startsWith("Save"));
    saveBtn!.element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
    await wrapper.vm.$nextTick();

    const emitted = wrapper.emitted("save");
    expect(emitted).toBeTruthy();
    const overrides = emitted![0][0] as Record<string, { enabled?: boolean; content?: string }>;
    expect(overrides.tone).toEqual({ enabled: false });
    expect(overrides.trailer).toEqual({ content: "End with bullet points." });
    expect(overrides.identity).toBeUndefined();
  });

  it("Reset returns all sections to their base values and zeroes the change count", async () => {
    const wrapper = mountReady({ tone: { enabled: false } });
    await flushPromises();
    expect(wrapper.find('goa-badge[content="1 change"]').exists()).toBe(true);

    // Reset button is rendered only when overrideCount > 0.
    const reset = wrapper.find("header button");
    // Actually, look for a button labeled Reset specifically.
    const resetBtn = wrapper.findAll("button").find((b) => b.text().trim() === "Reset");
    expect(resetBtn).toBeDefined();
    await resetBtn!.trigger("click");

    expect(wrapper.find('goa-badge[content="1 change"]').exists()).toBe(false);
  });

  it("renders the loading hint then the sections", async () => {
    let resolver!: (v: unknown) => void;
    apiFetchMock.mockReturnValue(new Promise((r) => (resolver = r)));

    const wrapper = mount(PromptCustomizer, { props: { initialOverrides: {} } });
    // onMounted is async; loading.value = true takes a tick to be reflected.
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain("Loading sections…");

    resolver({ sections: baseSections });
    await flushPromises();
    expect(wrapper.text()).not.toContain("Loading sections…");
    expect(wrapper.findAll("article").length).toBe(3);
  });

  it("surfaces an error callout when the API fails", async () => {
    apiFetchMock.mockRejectedValue(new Error("network down"));
    const wrapper = mount(PromptCustomizer, { props: { initialOverrides: {} } });
    await flushPromises();

    expect(wrapper.find('goa-callout[type="emergency"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("network down");
  });

  it("Ctrl+Enter triggers save", async () => {
    const wrapper = mountReady();
    await flushPromises();

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true }));
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted("save")).toBeTruthy();
  });

  it("emits close when the modal _close fires", async () => {
    const wrapper = mountReady();
    await flushPromises();

    wrapper.find("goa-modal").element.dispatchEvent(new CustomEvent("_close", { bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("disables the checkbox for priority-1 (critical) sections", async () => {
    const wrapper = mountReady();
    await flushPromises();

    const identityCheckbox = wrapper.find('goa-checkbox[name="enabled-identity"]');
    expect(identityCheckbox.attributes("disabled")).toBeDefined();
    const toneCheckbox = wrapper.find('goa-checkbox[name="enabled-tone"]');
    expect(toneCheckbox.attributes("disabled")).toBeUndefined();
  });
});
