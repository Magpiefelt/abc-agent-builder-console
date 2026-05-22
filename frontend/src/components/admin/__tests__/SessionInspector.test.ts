/**
 * SessionInspector lists recent free-agent sessions and supports a status
 * dropdown filter that re-queries the admin API.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

const sessionsMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({
  api: {
    admin: { sessions: sessionsMock },
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

import SessionInspector from "../SessionInspector.vue";

const sessions = [
  {
    id: "00000000-1111-2222-3333-444444444444",
    status: "running",
    model_id: "claude-sonnet-4-6",
    classification: "unclassified",
    current_iteration: 3,
    max_iterations: 10,
    user_id: "u1",
    user_display_name: "Alice",
    user_email: null,
    ministry_code: "TBF",
    created_at: "2026-05-22T10:00:00Z",
    completed_at: null,
  },
  {
    id: "55555555-6666-7777-8888-999999999999",
    status: "completed",
    model_id: "claude-opus-4-7",
    classification: "protected_a",
    current_iteration: 5,
    max_iterations: 5,
    user_id: "u2",
    user_display_name: null,
    user_email: "bob@example.com",
    ministry_code: null,
    created_at: "2026-05-22T11:00:00Z",
    completed_at: "2026-05-22T11:30:00Z",
  },
];

beforeEach(() => {
  sessionsMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SessionInspector", () => {
  it("loads all sessions when Refresh is clicked and renders rows", async () => {
    sessionsMock.mockResolvedValue({ sessions, count: sessions.length });

    const wrapper = mount(SessionInspector);
    wrapper
      .findAll("goa-button")
      .find((b) => b.text().trim() === "Refresh")!
      .element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
    await flushPromises();

    expect(sessionsMock).toHaveBeenCalledWith({ status: undefined, limit: 100 });
    const text = wrapper.text();
    expect(text).toContain("Alice");
    expect(text).toContain("bob@example.com");
    // Truncated session id with ellipsis.
    expect(text).toContain("00000000…");
    expect(text).toContain("claude-sonnet-4-6");
    expect(text).toContain("claude-opus-4-7");
    expect(text).toContain("3 / 10");
    expect(text).toContain("5 / 5");
    expect(text).toContain("TBF");
    // Ministry em-dash for the row without a ministry.
    expect(text).toContain("—");
    expect(text).toContain("2 sessions");
  });

  it("uses the status filter when the dropdown emits a value", async () => {
    sessionsMock.mockResolvedValue({ sessions: [sessions[0]], count: 1 });

    const wrapper = mount(SessionInspector);

    // Initial load via Refresh button.
    wrapper
      .findAll("goa-button")
      .find((b) => b.text().trim() === "Refresh")!
      .element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
    await flushPromises();
    expect(sessionsMock).toHaveBeenLastCalledWith({ status: undefined, limit: 100 });

    // Change dropdown to "running".
    wrapper.find('goa-dropdown[name="statusFilter"]').element.dispatchEvent(
      new CustomEvent("_change", { detail: { value: "running" }, bubbles: true }),
    );
    await flushPromises();

    expect(sessionsMock).toHaveBeenLastCalledWith({ status: "running", limit: 100 });
    expect(wrapper.text()).toContain("status: running");
    expect(wrapper.text()).toContain("1 session");
  });

  it("renders the empty hint when there are no sessions", async () => {
    sessionsMock.mockResolvedValue({ sessions: [], count: 0 });

    const wrapper = mount(SessionInspector);
    wrapper
      .findAll("goa-button")
      .find((b) => b.text().trim() === "Refresh")!
      .element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
    await flushPromises();

    expect(wrapper.text()).toContain("No sessions found");
  });

  it("surfaces a callout on fetch errors", async () => {
    sessionsMock.mockRejectedValue(new Error("nope"));

    const wrapper = mount(SessionInspector);
    wrapper
      .findAll("goa-button")
      .find((b) => b.text().trim() === "Refresh")!
      .element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
    await flushPromises();

    expect(wrapper.find('goa-callout[type="emergency"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("nope");
  });
});
