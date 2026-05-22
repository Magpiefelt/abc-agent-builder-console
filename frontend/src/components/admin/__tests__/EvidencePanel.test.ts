/**
 * EvidencePanel (Bot 22, Backlog S2)
 *
 * Admin panel that lists historical compliance evidence snapshots, lets the
 * admin trigger a fresh snapshot on demand, and renders the Markdown body of
 * any snapshot in a modal viewer. Tests follow the established pattern: mock
 * the api + toast layer and drive the panel through the Refresh button (since
 * `onActivated` does not fire on bare mount in vue-test-utils).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";

const listMock = vi.hoisted(() => vi.fn());
const getMock = vi.hoisted(() => vi.fn());
const generateMock = vi.hoisted(() => vi.fn());
const toastPushMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({
  api: {
    compliance: {
      list: listMock,
      get: getMock,
      generate: generateMock,
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

import EvidencePanel from "../EvidencePanel.vue";

function clickRefresh(wrapper: ReturnType<typeof mount>): void {
  const refresh = wrapper.findAll("goa-button").find((b) => b.text().trim() === "Refresh");
  refresh!.element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
}

function clickGenerate(wrapper: ReturnType<typeof mount>): void {
  const btn = wrapper.find('[data-testid="generate-evidence"]');
  btn.element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
}

function summaryRow(overrides: Partial<{
  id: string;
  triggeredBy: string;
  auditTotal: number;
  piiTotal: number;
  modelTotalActive: number;
  collectedAt: string;
}> = {}) {
  return {
    id: overrides.id ?? "11111111-2222-3333-4444-555555555555",
    collectedAt: overrides.collectedAt ?? "2026-05-22T03:00:00Z",
    periodStart: "2026-05-21T03:00:00Z",
    periodEnd: "2026-05-22T03:00:00Z",
    triggeredBy: overrides.triggeredBy ?? "scheduler",
    userId: null,
    sourceVersion: "1",
    rowCounts: { audit_log: overrides.auditTotal ?? 99 },
    auditTotal: overrides.auditTotal ?? 99,
    piiTotal: overrides.piiTotal ?? 4,
    modelTotalActive: overrides.modelTotalActive ?? 3,
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  listMock.mockReset();
  getMock.mockReset();
  generateMock.mockReset();
  toastPushMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("EvidencePanel", () => {
  it("renders one row per snapshot with audit/pii/model totals", async () => {
    listMock.mockResolvedValue({
      collections: [
        summaryRow({ id: "a", auditTotal: 1234, piiTotal: 7, modelTotalActive: 5 }),
        summaryRow({ id: "b", auditTotal: 9, piiTotal: 0, modelTotalActive: 4 }),
      ],
    });
    const wrapper = mount(EvidencePanel);
    clickRefresh(wrapper);
    await flushPromises();

    const rows = wrapper.findAll('[data-testid="evidence-row"]');
    expect(rows).toHaveLength(2);
    const text = wrapper.text();
    expect(text).toContain("1,234");
    expect(text).toContain("scheduler");
    expect(text).toContain("v1");
    expect(text).toContain("2 snapshots on record");
  });

  it("renders the empty state when no snapshots exist", async () => {
    listMock.mockResolvedValue({ collections: [] });
    const wrapper = mount(EvidencePanel);
    clickRefresh(wrapper);
    await flushPromises();
    expect(wrapper.text()).toContain("No snapshots yet");
    expect(wrapper.text()).toContain("0 snapshots on record");
  });

  it("surfaces ApiError messages in the callout when list fails", async () => {
    const { ApiError } = await import("@/lib/api");
    listMock.mockRejectedValue(new ApiError(500, "DB on fire", null));
    const wrapper = mount(EvidencePanel);
    clickRefresh(wrapper);
    await flushPromises();
    const callout = wrapper.find("goa-callout");
    expect(callout.exists()).toBe(true);
    expect(callout.text()).toContain("DB on fire");
  });

  it("triggers Generate now and refreshes the list on success", async () => {
    listMock.mockResolvedValue({ collections: [] });
    generateMock.mockResolvedValue({
      filename: "evidence_2026-05-22.md",
      filePath: "/tmp/evidence_2026-05-22.md",
      snapshot: { generatedAt: "", date: "2026-05-22", version: "1", sections: {} },
      markdown: "# OK",
    });
    const wrapper = mount(EvidencePanel);
    clickRefresh(wrapper);
    await flushPromises();
    listMock.mockClear();
    listMock.mockResolvedValueOnce({ collections: [summaryRow()] });

    clickGenerate(wrapper);
    await flushPromises();

    expect(generateMock).toHaveBeenCalledTimes(1);
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "success",
        message: expect.stringContaining("evidence_2026-05-22.md"),
      }),
    );
    // The component reloads the list after a successful generate.
    expect(listMock).toHaveBeenCalledTimes(1);
  });

  it("toasts on Generate failure and leaves the list intact", async () => {
    listMock.mockResolvedValue({ collections: [summaryRow()] });
    const { ApiError } = await import("@/lib/api");
    generateMock.mockRejectedValue(new ApiError(500, "disk full", null));
    const wrapper = mount(EvidencePanel);
    clickRefresh(wrapper);
    await flushPromises();

    clickGenerate(wrapper);
    await flushPromises();

    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "error", message: expect.stringContaining("disk full") }),
    );
  });

  it("opens the snapshot modal and fetches the rendered Markdown when View is clicked", async () => {
    listMock.mockResolvedValue({ collections: [summaryRow({ id: "row-1" })] });
    getMock.mockResolvedValue({
      ...summaryRow({ id: "row-1" }),
      summary: { generatedAt: "", date: "2026-05-22", version: "1", sections: {} },
      markdown: "# Detail body\n\nSome **bold** content.",
    });
    const wrapper = mount(EvidencePanel);
    clickRefresh(wrapper);
    await flushPromises();

    const viewBtn = wrapper.find('[data-testid="view-evidence"]');
    viewBtn.element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
    await flushPromises();

    expect(getMock).toHaveBeenCalledWith("row-1");
    expect(wrapper.find('[data-testid="evidence-modal"]').exists()).toBe(true);
    const rendered = wrapper.find('[data-testid="evidence-markdown"]');
    expect(rendered.exists()).toBe(true);
    expect(rendered.html()).toContain("<strong>bold</strong>");
  });
});
