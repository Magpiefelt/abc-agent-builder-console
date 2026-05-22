/**
 * BudgetPanel (Bot 15, Backlog B1)
 *
 * Admin panel listing per-user / ministry / global token budgets with edit /
 * delete / add actions. Tests mock the api + toast layer and drive the panel
 * via the Refresh button (matches sibling admin component test pattern —
 * onActivated does not fire on a bare mount in @vue/test-utils).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";

const listBudgetsMock = vi.hoisted(() => vi.fn());
const upsertBudgetMock = vi.hoisted(() => vi.fn());
const deleteBudgetMock = vi.hoisted(() => vi.fn());
const budgetUsageMock = vi.hoisted(() => vi.fn());
const toastPushMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({
  api: {
    admin: {
      listBudgets: listBudgetsMock,
      upsertBudget: upsertBudgetMock,
      deleteBudget: deleteBudgetMock,
      budgetUsage: budgetUsageMock,
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

import BudgetPanel from "../BudgetPanel.vue";

function clickRefresh(wrapper: VueWrapper): void {
  const refresh = wrapper.find('[data-testid="refresh"]');
  refresh.element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
}

beforeEach(() => {
  setActivePinia(createPinia());
  listBudgetsMock.mockReset();
  upsertBudgetMock.mockReset();
  deleteBudgetMock.mockReset();
  budgetUsageMock.mockReset();
  toastPushMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const sampleBudgets = [
  {
    id: "g-1",
    scopeType: "global" as const,
    scopeId: "global",
    monthlyTokenLimit: 100_000_000,
    notes: "Default ceiling",
    createdBy: null,
    createdAt: "2026-05-22T10:00:00Z",
    updatedAt: "2026-05-22T10:00:00Z",
  },
  {
    id: "m-1",
    scopeType: "ministry" as const,
    scopeId: "TBF",
    monthlyTokenLimit: 5_000_000,
    notes: null,
    createdBy: "admin-1",
    createdAt: "2026-05-22T10:00:00Z",
    updatedAt: "2026-05-22T10:00:00Z",
  },
  {
    id: "u-1",
    scopeType: "user" as const,
    scopeId: "11111111-1111-1111-1111-111111111111",
    monthlyTokenLimit: 10_000,
    notes: "Pilot user",
    createdBy: "admin-1",
    createdAt: "2026-05-22T10:00:00Z",
    updatedAt: "2026-05-22T10:00:00Z",
  },
];

const sampleUsage = [
  {
    userId: "11111111-1111-1111-1111-111111111111",
    userEmail: "pilot@gov.ab.ca",
    userDisplayName: "Pilot User",
    ministryCode: "TBF",
    used: 8000,
    effectiveLimit: 10_000,
    effectiveScope: "user" as const,
    remaining: 2000,
    exceeded: false,
  },
  {
    userId: "22222222-2222-2222-2222-222222222222",
    userEmail: "heavy@gov.ab.ca",
    userDisplayName: "Heavy User",
    ministryCode: "INFRA",
    used: 6_000_000,
    effectiveLimit: 5_000_000,
    effectiveScope: "ministry" as const,
    remaining: 0,
    exceeded: true,
  },
];

describe("BudgetPanel — load", () => {
  it("renders one row per scope with correctly-grouped sections", async () => {
    listBudgetsMock.mockResolvedValue({ budgets: sampleBudgets, count: 3 });
    budgetUsageMock.mockResolvedValue({ usage: sampleUsage, count: 2 });

    const wrapper = mount(BudgetPanel);
    clickRefresh(wrapper);
    await flushPromises();

    const text = wrapper.text();
    expect(text).toContain("Global default");
    expect(text).toContain("100,000,000");
    expect(text).toContain("TBF");
    expect(text).toContain("5,000,000");
    expect(text).toContain("Pilot user");
  });

  it("surfaces over-budget users in a callout", async () => {
    listBudgetsMock.mockResolvedValue({ budgets: sampleBudgets, count: 3 });
    budgetUsageMock.mockResolvedValue({ usage: sampleUsage, count: 2 });

    const wrapper = mount(BudgetPanel);
    clickRefresh(wrapper);
    await flushPromises();

    // The callout heading is a goa-callout attribute, not text content.
    const overBudgetCallout = wrapper.find("goa-callout[type='important']");
    expect(overBudgetCallout.exists()).toBe(true);
    expect(overBudgetCallout.attributes("heading")).toBe("Users over budget this month");
    expect(overBudgetCallout.text()).toContain("Heavy User");
    // Pilot user is under budget so should NOT appear in the callout list.
    expect(overBudgetCallout.text()).not.toContain("Pilot User");
  });

  it("shows an empty-state message for ministry overrides when none exist", async () => {
    listBudgetsMock.mockResolvedValue({
      budgets: [sampleBudgets[0]], // only global
      count: 1,
    });
    budgetUsageMock.mockResolvedValue({ usage: [], count: 0 });

    const wrapper = mount(BudgetPanel);
    clickRefresh(wrapper);
    await flushPromises();
    expect(wrapper.text()).toContain("No ministry overrides");
    expect(wrapper.text()).toContain("No per-user overrides");
  });

  it("surfaces a load error via callout", async () => {
    listBudgetsMock.mockRejectedValue(new Error("db gone"));
    budgetUsageMock.mockResolvedValue({ usage: [], count: 0 });

    const wrapper = mount(BudgetPanel);
    clickRefresh(wrapper);
    await flushPromises();
    const errorCallout = wrapper.find("goa-callout[type='emergency']");
    expect(errorCallout.exists()).toBe(true);
    expect(errorCallout.attributes("heading")).toBe("Couldn't load budgets");
    expect(errorCallout.text()).toContain("db gone");
  });
});

describe("BudgetPanel — add new budget", () => {
  beforeEach(() => {
    listBudgetsMock.mockResolvedValue({ budgets: sampleBudgets, count: 3 });
    budgetUsageMock.mockResolvedValue({ usage: [], count: 0 });
  });

  it("submits an upsert with the trimmed fields", async () => {
    upsertBudgetMock.mockResolvedValue({ budget: sampleBudgets[2] });

    const wrapper = mount(BudgetPanel);
    clickRefresh(wrapper);
    await flushPromises();

    await wrapper.find('[data-testid="scope-type"]').setValue("user");
    await wrapper.find('[data-testid="scope-id"]').setValue("  abc-user-1  ");
    await wrapper.find('[data-testid="limit"]').setValue("25000");
    await wrapper.find('[data-testid="notes"]').setValue("");

    const btn = wrapper.find('[data-testid="add-budget"]');
    btn.element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
    await flushPromises();

    expect(upsertBudgetMock).toHaveBeenCalledWith({
      scope_type: "user",
      scope_id: "abc-user-1",
      monthly_token_limit: 25000,
      notes: null,
    });
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "success" }),
    );
  });

  it("forces scope_id='global' when scope is global", async () => {
    upsertBudgetMock.mockResolvedValue({ budget: sampleBudgets[0] });

    const wrapper = mount(BudgetPanel);
    clickRefresh(wrapper);
    await flushPromises();

    await wrapper.find('[data-testid="scope-type"]').setValue("global");
    await wrapper.find('[data-testid="limit"]').setValue("999");

    wrapper
      .find('[data-testid="add-budget"]')
      .element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
    await flushPromises();

    expect(upsertBudgetMock).toHaveBeenCalledWith(
      expect.objectContaining({ scope_type: "global", scope_id: "global" }),
    );
  });

  it("disables submit for an invalid (negative / fractional) limit", async () => {
    const wrapper = mount(BudgetPanel);
    clickRefresh(wrapper);
    await flushPromises();

    await wrapper.find('[data-testid="scope-type"]').setValue("user");
    await wrapper.find('[data-testid="scope-id"]').setValue("u-1");
    await wrapper.find('[data-testid="limit"]').setValue("-1");

    const btn = wrapper.find('[data-testid="add-budget"]');
    // goa-button's disabled is a string attribute; presence implies disabled.
    expect(btn.attributes("disabled")).toBeDefined();
  });
});

describe("BudgetPanel — delete", () => {
  it("removes a non-global budget on confirm and toasts success", async () => {
    listBudgetsMock.mockResolvedValue({ budgets: sampleBudgets, count: 3 });
    budgetUsageMock.mockResolvedValue({ usage: [], count: 0 });
    deleteBudgetMock.mockResolvedValue({ deleted: true, scopeType: "user", scopeId: "u-1" });

    const wrapper = mount(BudgetPanel);
    clickRefresh(wrapper);
    await flushPromises();

    // Find the first "Remove" button — both ministry + user overrides have one.
    const removeButtons = wrapper.findAll("goa-button").filter(
      (b) => b.text().trim() === "Remove",
    );
    expect(removeButtons.length).toBeGreaterThan(0);
    removeButtons[0]!.element.dispatchEvent(
      new CustomEvent("_click", { bubbles: true }),
    );
    await flushPromises();

    expect(deleteBudgetMock).toHaveBeenCalledOnce();
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "success" }),
    );
  });
});
