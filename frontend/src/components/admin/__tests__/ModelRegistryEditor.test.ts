/**
 * ModelRegistryEditor lists every registered model with a per-row toggle that
 * flips the `is_active` flag via the admin API.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";

const modelsMock = vi.hoisted(() => vi.fn());
const updateModelMock = vi.hoisted(() => vi.fn());
const toastPushMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({
  api: {
    admin: { models: modelsMock, updateModel: updateModelMock },
  },
  ApiError: class ApiError extends Error {
    status: number;
    payload: unknown;
    constructor(status: number, message: string, payload: unknown) {
      super(message);
      this.status = status;
      this.payload = payload;
    }
  },
}));

vi.mock("@/composables/useToast", () => ({
  useToast: () => ({ toasts: { value: [] }, push: toastPushMock, dismiss: vi.fn() }),
}));

import ModelRegistryEditor from "../ModelRegistryEditor.vue";

const models = [
  {
    id: 1,
    model_id: "claude-opus-4-7",
    display_name: "Claude Opus 4.7",
    provider: "vertex_ai",
    api_model_name: "claude-opus-4-7",
    max_output_tokens: 16384,
    supports_streaming: true,
    supports_tools: true,
    data_residency: "canada",
    max_classification: "protected_b",
    is_active: true,
  },
  {
    id: 2,
    model_id: "claude-haiku-4-5",
    display_name: "Claude Haiku 4.5",
    provider: "vertex_ai",
    api_model_name: "claude-haiku-4-5",
    max_output_tokens: 8192,
    supports_streaming: true,
    supports_tools: true,
    data_residency: "canada",
    max_classification: "protected_a",
    is_active: false,
  },
  {
    id: 3,
    model_id: "gemini-2.5-flash",
    display_name: "Gemini 2.5 Flash",
    provider: "google",
    api_model_name: "gemini-2.5-flash",
    max_output_tokens: 8192,
    supports_streaming: true,
    supports_tools: true,
    data_residency: "us",
    max_classification: "unclassified",
    is_active: true,
  },
];

beforeEach(() => {
  setActivePinia(createPinia());
  modelsMock.mockReset();
  updateModelMock.mockReset();
  toastPushMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ModelRegistryEditor", () => {
  it("renders one row per model with id, provider, residency, classification, and active state", async () => {
    modelsMock.mockResolvedValue({ models, count: models.length });

    const wrapper = mount(ModelRegistryEditor);
    wrapper
      .findAll("goa-button")
      .find((b) => b.text().trim() === "Refresh")!
      .element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
    await flushPromises();

    const text = wrapper.text();
    expect(text).toContain("Claude Opus 4.7");
    expect(text).toContain("claude-opus-4-7");
    expect(text).toContain("vertex_ai");
    expect(text).toContain("canada");
    expect(text).toContain("us");

    // Active count: 2 of 3.
    expect(text).toContain("2 of 3 active");

    // Classification badges use distinct types.
    expect(wrapper.find('goa-badge[content="protected_b"]').exists()).toBe(true);
    expect(wrapper.find('goa-badge[content="protected_a"]').exists()).toBe(true);
    expect(wrapper.find('goa-badge[content="unclassified"]').exists()).toBe(true);
  });

  it("toggles a model's active flag and pushes a toast", async () => {
    modelsMock.mockResolvedValue({ models, count: models.length });
    updateModelMock.mockResolvedValue({ model: { ...models[1], is_active: true } });

    const wrapper = mount(ModelRegistryEditor);
    wrapper
      .findAll("goa-button")
      .find((b) => b.text().trim() === "Refresh")!
      .element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
    await flushPromises();

    // The Haiku row should show "Inactive" — click it.
    const inactiveBtn = wrapper.findAll("goa-button").find((b) => b.text().trim() === "Inactive");
    expect(inactiveBtn).toBeDefined();
    inactiveBtn!.element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
    await flushPromises();

    expect(updateModelMock).toHaveBeenCalledWith(2, { is_active: true });
    expect(toastPushMock).toHaveBeenCalledTimes(1);
    expect(toastPushMock.mock.calls[0][0]).toMatchObject({
      kind: "success",
      message: expect.stringContaining("Claude Haiku 4.5 activated"),
    });
  });

  it("shows an error toast and callout when the toggle fails", async () => {
    modelsMock.mockResolvedValue({ models, count: models.length });
    updateModelMock.mockRejectedValue(new Error("server said no"));

    const wrapper = mount(ModelRegistryEditor);
    wrapper
      .findAll("goa-button")
      .find((b) => b.text().trim() === "Refresh")!
      .element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
    await flushPromises();

    const activeBtn = wrapper.findAll("goa-button").find((b) => b.text().trim() === "Active");
    activeBtn!.element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
    await flushPromises();

    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "error" }),
    );
    expect(wrapper.find('goa-callout[type="emergency"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("server said no");
  });

  it("shows the empty hint when no models are returned", async () => {
    modelsMock.mockResolvedValue({ models: [], count: 0 });

    const wrapper = mount(ModelRegistryEditor);
    wrapper
      .findAll("goa-button")
      .find((b) => b.text().trim() === "Refresh")!
      .element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
    await flushPromises();

    expect(wrapper.text()).toContain("No models registered");
  });
});
