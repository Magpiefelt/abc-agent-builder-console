/**
 * HealthDiagnostics renders the detailed health payload across runtime / memory
 * / pool / token / services / retention cards and exposes a Run-Retention
 * button. The component uses onActivated which doesn't fire when mounted
 * standalone — we drive the lifecycle by clicking Refresh and asserting state
 * mutations from the api mock.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

const detailedMock = vi.hoisted(() => vi.fn());
const runRetentionMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({
  api: {
    health: { detailed: detailedMock },
    admin: { runRetention: runRetentionMock },
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

import HealthDiagnostics from "../HealthDiagnostics.vue";

const basePayload = {
  status: "healthy",
  uptimeSeconds: 90061, // 1d 1h 1m 1s
  version: "1.2.3",
  nodeVersion: "v22.10.0",
  environment: "test",
  memory: { rssMb: 100, heapUsedMb: 60, heapTotalMb: 90, externalMb: 5 },
  pool: {
    totalCount: 4,
    idleCount: 3,
    waitingCount: 0,
    queryCount: 137,
    slowQueryCount: 1,
    errorCount: 0,
  },
  tokens: {
    windowMinutes: 5,
    callCount: 12,
    totalPromptTokens: 1234,
    totalCompletionTokens: 5678,
  },
  services: { database: "connected", anthropic: "configured", entTools: "unconfigured" },
  retention: { enabled: true, hour: 3 },
};

beforeEach(() => {
  detailedMock.mockReset();
  runRetentionMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("HealthDiagnostics", () => {
  it("loads health data when Refresh is clicked and renders every panel", async () => {
    detailedMock.mockResolvedValue(basePayload);

    const wrapper = mount(HealthDiagnostics);

    const refresh = wrapper.findAll("goa-button").find((b) => b.text().trim() === "Refresh now");
    refresh!.element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
    await flushPromises();

    expect(detailedMock).toHaveBeenCalledTimes(1);
    const text = wrapper.text();
    expect(text).toContain("healthy");
    expect(text).toContain("1d 1h 1m 1s");
    expect(text).toContain("1.2.3");
    expect(text).toContain("v22.10.0");
    expect(text).toContain("100 MB");
    expect(text).toContain("60 MB");
    // pool values
    expect(text).toContain("137");
    // tokens (toLocaleString)
    expect(text).toContain("1,234");
    expect(text).toContain("5,678");
    // services
    expect(text).toContain("database");
    expect(text).toContain("connected");
    // retention
    expect(text).toContain("enabled");
    expect(text).toContain("3:00");
  });

  it("renders an error callout when the health fetch rejects", async () => {
    detailedMock.mockRejectedValue(new Error("boom"));

    const wrapper = mount(HealthDiagnostics);
    wrapper
      .findAll("goa-button")
      .find((b) => b.text().trim() === "Refresh now")!
      .element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
    await flushPromises();

    expect(wrapper.find('goa-callout[type="emergency"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("boom");
  });

  it("calls runRetention and renders the report", async () => {
    detailedMock.mockResolvedValue(basePayload);
    runRetentionMock.mockResolvedValue({
      report: {
        totalRowsAffected: 17,
        durationMs: 421,
        byTable: [{ table: "audit_log", classification: "unclassified", strategy: "delete", rowsAffected: 17 }],
        errors: [],
      },
    });

    const wrapper = mount(HealthDiagnostics);
    wrapper
      .findAll("goa-button")
      .find((b) => b.text().trim() === "Refresh now")!
      .element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
    await flushPromises();

    const runBtn = wrapper
      .findAll("goa-button")
      .find((b) => b.text().trim().startsWith("Run retention"));
    runBtn!.element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
    await flushPromises();

    expect(runRetentionMock).toHaveBeenCalledTimes(1);
    const text = wrapper.text();
    expect(text).toContain("Affected:");
    expect(text).toContain("17");
    expect(text).toContain("421ms");
    expect(text).toContain("audit_log / unclassified");
  });

  it("renders retention errors when the run reports them", async () => {
    detailedMock.mockResolvedValue(basePayload);
    runRetentionMock.mockResolvedValue({
      report: {
        totalRowsAffected: 0,
        durationMs: 5,
        byTable: [],
        errors: ["could not connect"],
      },
    });

    const wrapper = mount(HealthDiagnostics);
    wrapper
      .findAll("goa-button")
      .find((b) => b.text().trim() === "Refresh now")!
      .element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
    await flushPromises();

    wrapper
      .findAll("goa-button")
      .find((b) => b.text().trim().startsWith("Run retention"))!
      .element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
    await flushPromises();

    expect(wrapper.text()).toContain("Errors:");
    expect(wrapper.text()).toContain("could not connect");
  });

  it("colors the runtime status red when unhealthy", async () => {
    detailedMock.mockResolvedValue({ ...basePayload, status: "unhealthy" });
    const wrapper = mount(HealthDiagnostics);
    wrapper
      .findAll("goa-button")
      .find((b) => b.text().trim() === "Refresh now")!
      .element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
    await flushPromises();

    expect(wrapper.html()).toContain("text-[var(--goa-color-error)]");
    expect(wrapper.text()).toContain("unhealthy");
  });
});
