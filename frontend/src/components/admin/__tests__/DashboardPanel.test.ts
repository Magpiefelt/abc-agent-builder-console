/**
 * DashboardPanel renders pre-aggregated operational stats from
 * `GET /api/admin/dashboard`. The component owns the fetch + a 60s polling
 * timer; tests inject a fake `api.admin.dashboard` so the network never
 * leaves the test process.
 *
 * Pattern: each test mounts the component with mocked timers and a single
 * `api.admin.dashboard` mock that resolves (or rejects) with a controlled
 * payload, then asserts against the rendered DOM.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { ApiError } from "@/lib/api";
import type { DashboardSummary } from "@/types/admin";

// Hoisted mock so the component sees it via the @/lib/api alias.
const dashboardMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      admin: {
        dashboard: dashboardMock,
      },
    },
  };
});

import DashboardPanel from "../DashboardPanel.vue";

function makeSummary(overrides: Partial<DashboardSummary> = {}): DashboardSummary {
  return {
    generatedAt: new Date("2026-05-22T10:00:00Z").toISOString(),
    sessions: {
      totals: [
        { windowLabel: "24h", count: 5 },
        { windowLabel: "7d", count: 33 },
        { windowLabel: "30d", count: 121 },
      ],
      byStatus: [
        { status: "completed", count: 80 },
        { status: "error", count: 4 },
      ],
      byClassification: [
        { classification: "unclassified", count: 60 },
        { classification: "protected_a", count: 24 },
      ],
    },
    workflowExecutions: {
      totals: [
        { windowLabel: "24h", count: 2 },
        { windowLabel: "7d", count: 12 },
        { windowLabel: "30d", count: 41 },
      ],
      byStatus: [{ status: "completed", count: 38 }],
    },
    tools: [
      { tool: "brave_search", calls: 100, successes: 98 },
      { tool: "web_scrape", calls: 40, successes: 32 },
    ],
    models: [
      { modelId: "claude-sonnet-4-6", sessions: 70 },
      { modelId: "claude-haiku-4-5", sessions: 30 },
    ],
    pii: {
      last7Days: 6,
      byType: [
        { detectionType: "email", count: 4 },
        { detectionType: "phone", count: 2 },
      ],
      byAction: [
        { action: "blocked", count: 2 },
        { action: "redacted", count: 4 },
      ],
    },
    ...overrides,
  };
}

beforeEach(() => {
  dashboardMock.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("DashboardPanel", () => {
  it("renders a loading placeholder before the first fetch resolves", async () => {
    // Pending promise — never resolves so the loading branch stays visible.
    dashboardMock.mockReturnValue(new Promise(() => {}));
    const wrapper = mount(DashboardPanel);
    expect(wrapper.text()).toContain("Refreshing…");
  });

  it("renders the session, workflow, tool, and model breakdowns once data arrives", async () => {
    dashboardMock.mockResolvedValueOnce(makeSummary());
    const wrapper = mount(DashboardPanel);
    await flushPromises();

    // "Today" tile — the 24h window count for sessions.
    expect(wrapper.text()).toContain("5");

    // Sessions tab is active by default: status + classification breakdowns.
    expect(wrapper.text().toLowerCase()).toContain("completed");
    expect(wrapper.text().toLowerCase()).toContain("protected a");

    // The remaining breakdowns each live behind their own tab — click through
    // them so each section actually renders before asserting.
    const tabs = wrapper.findAll('[role="tab"]');
    const tabByLabel = (label: string) =>
      tabs.find((t) => t.text() === label)!;

    // Workflows tab carries the tools breakdown.
    await tabByLabel("Workflows").trigger("click");
    expect(wrapper.text()).toContain("Top tools");
    expect(wrapper.text()).toContain("brave_search");
    expect(wrapper.text()).toContain("98%"); // 98 / 100

    // Models tab — header includes a known model id.
    await tabByLabel("Models").trigger("click");
    expect(wrapper.text()).toContain("claude-sonnet-4-6");

    // PII tab — type + action breakdowns.
    await tabByLabel("PII").trigger("click");
    expect(wrapper.text()).toContain("email");
    expect(wrapper.text().toLowerCase()).toContain("blocked");
  });

  it("shows the empty placeholders when there is no recent activity", async () => {
    dashboardMock.mockResolvedValueOnce(
      makeSummary({
        sessions: {
          totals: [
            { windowLabel: "24h", count: 0 },
            { windowLabel: "7d", count: 0 },
            { windowLabel: "30d", count: 0 },
          ],
          byStatus: [],
          byClassification: [],
        },
        workflowExecutions: {
          totals: [
            { windowLabel: "24h", count: 0 },
            { windowLabel: "7d", count: 0 },
            { windowLabel: "30d", count: 0 },
          ],
          byStatus: [],
        },
        tools: [],
        models: [],
        pii: { last7Days: 0, byType: [], byAction: [] },
      }),
    );

    const wrapper = mount(DashboardPanel);
    await flushPromises();

    // Sessions tab is active by default.
    expect(wrapper.text()).toContain("No sessions in the last 30 days.");

    // Each remaining empty placeholder lives behind its own tab.
    const tabs = wrapper.findAll('[role="tab"]');
    const tabByLabel = (label: string) =>
      tabs.find((t) => t.text() === label)!;

    await tabByLabel("Workflows").trigger("click");
    expect(wrapper.text()).toContain("No workflow runs in the last 30 days.");

    await tabByLabel("Models").trigger("click");
    expect(wrapper.text()).toContain("No model usage in the last 30 days.");

    await tabByLabel("PII").trigger("click");
    expect(wrapper.text()).toContain(
      "No PII patterns matched in the last 7 days.",
    );
  });

  it("surfaces ApiError.message through the dedicated callout", async () => {
    dashboardMock.mockRejectedValueOnce(
      new ApiError(500, "Aggregation failed — Postgres timeout", { error: "Aggregation failed — Postgres timeout" }),
    );
    const wrapper = mount(DashboardPanel);
    await flushPromises();

    // The GoA web component renders its `heading` as an attribute (jsdom
    // doesn't materialize the shadow DOM); assert the prop is wired up
    // correctly and the inner error message lands in the slot text.
    const callout = wrapper.find("goa-callout");
    expect(callout.exists()).toBe(true);
    expect(callout.attributes("heading")).toBe("Couldn't load dashboard");
    expect(callout.attributes("type")).toBe("emergency");
    expect(callout.text()).toContain("Aggregation failed — Postgres timeout");
  });

  it("stringifies non-ApiError failures so the UI never leaks `[object Object]`", async () => {
    dashboardMock.mockRejectedValueOnce(new Error("network down"));
    const wrapper = mount(DashboardPanel);
    await flushPromises();
    expect(wrapper.text()).toContain("network down");
  });

  it("polls every 60s while mounted and stops polling on unmount", async () => {
    dashboardMock.mockResolvedValue(makeSummary());
    const wrapper = mount(DashboardPanel);
    await flushPromises();
    expect(dashboardMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60_000);
    await flushPromises();
    expect(dashboardMock).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(60_000);
    await flushPromises();
    expect(dashboardMock).toHaveBeenCalledTimes(3);

    wrapper.unmount();
    vi.advanceTimersByTime(120_000);
    await flushPromises();
    // No additional calls after unmount.
    expect(dashboardMock).toHaveBeenCalledTimes(3);
  });

  it("re-fetches when the Refresh button fires the GoA `_click` event", async () => {
    dashboardMock.mockResolvedValue(makeSummary());
    const wrapper = mount(DashboardPanel);
    await flushPromises();
    expect(dashboardMock).toHaveBeenCalledTimes(1);

    const refresh = wrapper
      .findAll("goa-button")
      .find((b) => b.text().toLowerCase().includes("refresh"));
    expect(refresh).toBeDefined();
    refresh!.element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
    await flushPromises();
    expect(dashboardMock).toHaveBeenCalledTimes(2);
  });

  it("clears prior error text when a refresh succeeds", async () => {
    dashboardMock
      .mockRejectedValueOnce(new Error("transient blip"))
      .mockResolvedValueOnce(makeSummary());

    const wrapper = mount(DashboardPanel);
    await flushPromises();
    expect(wrapper.text()).toContain("transient blip");

    vi.advanceTimersByTime(60_000);
    await flushPromises();
    expect(wrapper.text()).not.toContain("transient blip");
    // The sessions tab header is the visible signal that the dashboard body
    // rendered after the refresh succeeded.
    expect(wrapper.text()).toContain("Sessions · last 30 days");
  });
});
