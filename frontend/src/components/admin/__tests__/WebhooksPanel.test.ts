/**
 * WebhooksPanel admin UI tests (Bot 21, Backlog B3).
 *
 * The panel calls api.admin.webhooks.{list,create,update,remove,test,deliveries}.
 * Each test mocks just the helpers it needs and asserts on what the user sees.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import type { WebhookSubscription } from "@/types/admin";

const listMock = vi.hoisted(() => vi.fn());
const createMock = vi.hoisted(() => vi.fn());
const updateMock = vi.hoisted(() => vi.fn());
const removeMock = vi.hoisted(() => vi.fn());
const testMock = vi.hoisted(() => vi.fn());
const deliveriesMock = vi.hoisted(() => vi.fn());
const toastPushMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({
  api: {
    admin: {
      webhooks: {
        list: listMock,
        create: createMock,
        update: updateMock,
        remove: removeMock,
        test: testMock,
        deliveries: deliveriesMock,
      },
    },
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

import WebhooksPanel from "../WebhooksPanel.vue";

function makeSubscription(overrides: Partial<WebhookSubscription> = {}): WebhookSubscription {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    ministryCode: "TBF",
    eventType: "session.completed",
    url: "https://example.test/hook",
    secretLabel: "primary",
    enabled: true,
    description: "Pipes session completions to the briefing-note bot.",
    createdBy: "u1",
    createdAt: "2026-05-22T00:00:00.000Z",
    updatedAt: "2026-05-22T00:00:00.000Z",
    lastDeliveryAt: "2026-05-22T01:00:00.000Z",
    lastDeliveryStatus: "success",
    ...overrides,
  };
}

async function mountPanel() {
  const wrapper = mount(WebhooksPanel);
  // The panel only loads on onActivated, which doesn't fire on a plain mount.
  // Click Refresh to trigger the initial load.
  wrapper
    .findAll("goa-button")
    .find((b) => b.text().trim() === "Refresh")!
    .element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  setActivePinia(createPinia());
  listMock.mockReset();
  createMock.mockReset();
  updateMock.mockReset();
  removeMock.mockReset();
  testMock.mockReset();
  deliveriesMock.mockReset();
  toastPushMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("WebhooksPanel", () => {
  it("renders the empty hint when no subscriptions exist", async () => {
    listMock.mockResolvedValue({ subscriptions: [] });
    const wrapper = await mountPanel();
    expect(wrapper.text()).toContain("No webhook subscriptions yet");
  });

  it("renders one row per subscription with URL, event, and status", async () => {
    listMock.mockResolvedValue({
      subscriptions: [
        makeSubscription(),
        makeSubscription({
          id: "22222222-2222-3333-4444-555555555555",
          eventType: "workflow.completed",
          url: "https://workflows.test/hook",
          enabled: false,
          ministryCode: null,
          description: null,
          createdAt: "2026-05-21T00:00:00.000Z",
        }),
      ],
    });
    const wrapper = await mountPanel();
    const text = wrapper.text();
    expect(text).toContain("session.completed");
    expect(text).toContain("workflow.completed");
    expect(text).toContain("https://example.test/hook");
    expect(text).toContain("https://workflows.test/hook");
    expect(text).toContain("TBF");
    expect(text).toContain("— any —"); // ministryCode null fallback
  });

  it("opens the create form via the New webhook button", async () => {
    listMock.mockResolvedValue({ subscriptions: [] });
    const wrapper = await mountPanel();
    expect(wrapper.find('[data-testid="webhooks-form-modal"]').exists()).toBe(false);
    wrapper.find('[data-testid="webhooks-new"]').element.dispatchEvent(
      new CustomEvent("_click", { bubbles: true }),
    );
    await flushPromises();
    expect(wrapper.find('[data-testid="webhooks-form-modal"]').exists()).toBe(true);
  });

  it("calls the test endpoint and surfaces a success toast", async () => {
    const sub = makeSubscription();
    listMock.mockResolvedValue({ subscriptions: [sub] });
    testMock.mockResolvedValue({
      subscriptionId: sub.id,
      outcome: "success",
      attempts: 1,
      finalStatus: 200,
      error: null,
    });
    const wrapper = await mountPanel();
    wrapper
      .find(`[data-testid="webhook-test-${sub.id}"]`)
      .element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
    await flushPromises();
    expect(testMock).toHaveBeenCalledWith(sub.id);
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "success", message: expect.stringContaining("Test delivered") }),
    );
  });

  it("surfaces an error toast when test delivery returns a failure outcome", async () => {
    const sub = makeSubscription();
    listMock.mockResolvedValue({ subscriptions: [sub] });
    testMock.mockResolvedValue({
      subscriptionId: sub.id,
      outcome: "exhausted",
      attempts: 3,
      finalStatus: null,
      error: "ECONNREFUSED",
    });
    const wrapper = await mountPanel();
    wrapper
      .find(`[data-testid="webhook-test-${sub.id}"]`)
      .element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
    await flushPromises();
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "error", message: expect.stringContaining("ECONNREFUSED") }),
    );
  });

  it("toggles enabled via the update endpoint", async () => {
    const sub = makeSubscription({ enabled: true });
    listMock.mockResolvedValue({ subscriptions: [sub] });
    updateMock.mockResolvedValue({ ...sub, enabled: false });
    const wrapper = await mountPanel();
    wrapper
      .find(`[data-testid="webhook-toggle-${sub.id}"]`)
      .element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
    await flushPromises();
    expect(updateMock).toHaveBeenCalledWith(sub.id, { enabled: false });
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "success", message: expect.stringContaining("disabled") }),
    );
  });

  it("opens delete confirm modal and removes on confirm", async () => {
    const sub = makeSubscription();
    listMock.mockResolvedValue({ subscriptions: [sub] });
    removeMock.mockResolvedValue({ id: sub.id, deleted: true });
    const wrapper = await mountPanel();
    expect(wrapper.find('[data-testid="webhooks-delete-modal"]').exists()).toBe(false);
    wrapper
      .find(`[data-testid="webhook-delete-${sub.id}"]`)
      .element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
    await flushPromises();
    expect(wrapper.find('[data-testid="webhooks-delete-modal"]').exists()).toBe(true);
    wrapper
      .find('[data-testid="webhooks-delete-confirm"]')
      .element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
    await flushPromises();
    expect(removeMock).toHaveBeenCalledWith(sub.id);
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "success", message: expect.stringContaining("deleted") }),
    );
  });

  it("loads delivery history on demand", async () => {
    const sub = makeSubscription();
    listMock.mockResolvedValue({ subscriptions: [sub] });
    deliveriesMock.mockResolvedValue({
      deliveries: [
        {
          id: "d-1",
          subscription_id: sub.id,
          event_type: "session.completed",
          resource_id: "session-1",
          attempt: 1,
          signature: "sha256=abc",
          response_status: 200,
          response_body_preview: "ok",
          duration_ms: 12,
          error: null,
          delivered_at: "2026-05-22T01:00:00.000Z",
        },
      ],
    });
    const wrapper = await mountPanel();
    wrapper
      .find(`[data-testid="webhook-history-${sub.id}"]`)
      .element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
    await flushPromises();
    expect(deliveriesMock).toHaveBeenCalledWith(sub.id, { limit: 50 });
    expect(wrapper.find('[data-testid="webhooks-deliveries-modal"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("session.completed");
  });

  it("renders an error callout when list fails", async () => {
    listMock.mockRejectedValue(new Error("backend exploded"));
    const wrapper = await mountPanel();
    expect(wrapper.find('goa-callout[type="emergency"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("backend exploded");
  });
});
