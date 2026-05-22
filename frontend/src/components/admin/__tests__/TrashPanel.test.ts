/**
 * TrashPanel (Bot 10, Backlog B4)
 *
 * The admin panel that lists soft-deleted workflows and offers Restore /
 * Purge actions. Tests mock the api + toast layer and drive the panel via
 * the Refresh button (mirrors the Bot-4 / Bot-5 pattern used by sibling
 * admin component tests, since `onActivated` does not fire on bare mount).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";

const workflowTrashMock = vi.hoisted(() => vi.fn());
const restoreWorkflowMock = vi.hoisted(() => vi.fn());
const purgeWorkflowMock = vi.hoisted(() => vi.fn());
const toastPushMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({
  api: {
    admin: {
      workflowTrash: workflowTrashMock,
      restoreWorkflow: restoreWorkflowMock,
      purgeWorkflow: purgeWorkflowMock,
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

import TrashPanel from "../TrashPanel.vue";

function clickRefresh(wrapper: ReturnType<typeof mount>): void {
  const refresh = wrapper.findAll("goa-button").find((b) => b.text().trim() === "Refresh");
  refresh!.element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
}

const now = new Date("2026-05-22T12:00:00Z").getTime();

function trashEntry(overrides: Partial<{
  id: string;
  name: string;
  daysSinceDeletion: number;
  daysUntilExpiry: number;
}> = {}) {
  const days = overrides.daysSinceDeletion ?? 5;
  const deletedAt = new Date(now - days * 86_400_000);
  // expiresAt is measured from NOW, not from deletedAt, so the panel's
  // daysUntil() lands on exactly the value the test parametrizes.
  const expiresAt = new Date(now + (overrides.daysUntilExpiry ?? 25) * 86_400_000);
  return {
    id: overrides.id ?? "11111111-1111-1111-1111-111111111111",
    userId: "u1",
    userEmail: "owner@gov.ab.ca",
    userDisplayName: "Owner",
    ministryCode: "INFRA",
    name: overrides.name ?? "Old workflow",
    description: "a workflow",
    classification: "unclassified",
    isTemplate: false,
    version: 2,
    createdAt: new Date(now - 60 * 86_400_000).toISOString(),
    updatedAt: new Date(now - 10 * 86_400_000).toISOString(),
    deletedAt: deletedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  workflowTrashMock.mockReset();
  restoreWorkflowMock.mockReset();
  purgeWorkflowMock.mockReset();
  toastPushMock.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(now);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("TrashPanel", () => {
  it("renders one row per trashed workflow with owner + expiry badge", async () => {
    workflowTrashMock.mockResolvedValue({
      workflows: [
        trashEntry({ id: "a", name: "Alpha", daysSinceDeletion: 2, daysUntilExpiry: 28 }),
        trashEntry({ id: "b", name: "Beta", daysSinceDeletion: 25, daysUntilExpiry: 5 }),
      ],
      count: 2,
      retentionDays: 30,
    });

    const wrapper = mount(TrashPanel);
    clickRefresh(wrapper);
    await flushPromises();

    const text = wrapper.text();
    expect(text).toContain("Alpha");
    expect(text).toContain("Beta");
    expect(text).toContain("Owner");
    expect(text).toContain("INFRA");
    expect(text).toContain("30 days");

    // Days-until-expiry badges:  28 days (success) and 5 days (important).
    expect(wrapper.find('goa-badge[content="28 days"]').exists()).toBe(true);
    expect(wrapper.find('goa-badge[content="5 days"]').exists()).toBe(true);

    expect(text).toContain("2 workflows in trash");
  });

  it("shows the expiring-soon count when items have <= 7 days left", async () => {
    workflowTrashMock.mockResolvedValue({
      workflows: [
        trashEntry({ daysUntilExpiry: 4 }),
        trashEntry({ daysUntilExpiry: 25 }),
      ],
      count: 2,
      retentionDays: 30,
    });

    const wrapper = mount(TrashPanel);
    clickRefresh(wrapper);
    await flushPromises();

    expect(wrapper.text()).toContain("1 expiring within 7 days");
  });

  it("flags overdue items (expiresAt in the past) with an emergency badge", async () => {
    workflowTrashMock.mockResolvedValue({
      workflows: [trashEntry({ daysUntilExpiry: -2 })],
      count: 1,
      retentionDays: 30,
    });
    const wrapper = mount(TrashPanel);
    clickRefresh(wrapper);
    await flushPromises();
    expect(wrapper.find('goa-badge[content="overdue"]').exists()).toBe(true);
    expect(wrapper.find('goa-badge[type="emergency"]').exists()).toBe(true);
  });

  it("calls restoreWorkflow on Restore click and removes the row on success", async () => {
    workflowTrashMock.mockResolvedValue({
      workflows: [trashEntry({ id: "wf-1", name: "Important workflow" })],
      count: 1,
      retentionDays: 30,
    });
    restoreWorkflowMock.mockResolvedValue({
      id: "wf-1",
      restored: true,
      name: "Important workflow",
    });

    const wrapper = mount(TrashPanel);
    clickRefresh(wrapper);
    await flushPromises();

    const restoreBtn = wrapper
      .findAll("goa-button")
      .find((b) => b.text().trim() === "Restore");
    restoreBtn!.element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
    await flushPromises();

    expect(restoreWorkflowMock).toHaveBeenCalledWith("wf-1");
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "success",
        message: expect.stringContaining("Important workflow"),
      })
    );
    // Row removed from the table.
    expect(wrapper.text()).not.toContain("Important workflow");
    expect(wrapper.text()).toContain("Trash is empty");
  });

  it("shows an error toast when restore fails and keeps the row", async () => {
    workflowTrashMock.mockResolvedValue({
      workflows: [trashEntry({ id: "wf-1", name: "Brittle workflow" })],
      count: 1,
      retentionDays: 30,
    });
    restoreWorkflowMock.mockRejectedValue(new Error("server said no"));

    const wrapper = mount(TrashPanel);
    clickRefresh(wrapper);
    await flushPromises();

    const restoreBtn = wrapper
      .findAll("goa-button")
      .find((b) => b.text().trim() === "Restore");
    restoreBtn!.element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
    await flushPromises();

    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "error" })
    );
    // Row still present.
    expect(wrapper.text()).toContain("Brittle workflow");
  });

  it("requires confirmation before calling purgeWorkflow", async () => {
    workflowTrashMock.mockResolvedValue({
      workflows: [trashEntry({ id: "wf-1", name: "Disposable workflow" })],
      count: 1,
      retentionDays: 30,
    });
    purgeWorkflowMock.mockResolvedValue({
      id: "wf-1",
      purged: true,
      name: "Disposable workflow",
    });

    const wrapper = mount(TrashPanel);
    clickRefresh(wrapper);
    await flushPromises();

    // Step 1: click Purge -> confirmation modal opens, no API call yet.
    const purgeBtn = wrapper
      .findAll("goa-button")
      .find((b) => b.text().trim() === "Purge");
    purgeBtn!.element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
    await flushPromises();
    expect(purgeWorkflowMock).not.toHaveBeenCalled();
    const modal = wrapper.find("goa-modal");
    expect(modal.exists()).toBe(true);
    // goa-modal exposes the title as a `heading` attribute (Web Component),
    // so check it via attribute lookup rather than wrapper.text().
    expect(modal.attributes("heading")).toBe("Purge workflow permanently?");
    expect(wrapper.text()).toContain("Permanently delete workflow");

    // Step 2: click the confirmation button inside the modal.
    const confirmBtn = wrapper
      .findAll("goa-button")
      .find((b) => b.text().trim() === "Purge permanently");
    confirmBtn!.element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
    await flushPromises();

    expect(purgeWorkflowMock).toHaveBeenCalledWith("wf-1");
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "success",
        message: expect.stringContaining("Disposable workflow"),
      })
    );
    expect(wrapper.text()).toContain("Trash is empty");
  });

  it("shows the empty-trash hint when no workflows are deleted", async () => {
    workflowTrashMock.mockResolvedValue({ workflows: [], count: 0, retentionDays: 30 });
    const wrapper = mount(TrashPanel);
    clickRefresh(wrapper);
    await flushPromises();
    expect(wrapper.text()).toContain("Trash is empty");
  });

  it("surfaces the API error in the callout when the list call fails", async () => {
    workflowTrashMock.mockRejectedValue(new Error("network down"));
    const wrapper = mount(TrashPanel);
    clickRefresh(wrapper);
    await flushPromises();
    expect(wrapper.find('goa-callout[type="emergency"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("network down");
  });
});
