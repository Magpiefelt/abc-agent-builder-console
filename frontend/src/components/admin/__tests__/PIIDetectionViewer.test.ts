/**
 * PIIDetectionViewer lists recent PII detections with badges for action taken.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

const piiMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({
  api: {
    admin: { piiDetections: piiMock },
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

import PIIDetectionViewer from "../PIIDetectionViewer.vue";

const detections = [
  {
    id: "d1",
    created_at: "2026-05-22T10:00:00Z",
    detection_type: "sin",
    action_taken: "blocked",
    context_snippet: "1234****",
    user_id: "u1",
    user_display_name: "Alice",
    user_email: null,
    session_id: "s1",
  },
  {
    id: "d2",
    created_at: "2026-05-22T11:00:00Z",
    detection_type: "credit_card",
    action_taken: "redacted",
    context_snippet: "4111****",
    user_id: "u2",
    user_display_name: null,
    user_email: "bob@example.com",
    session_id: null,
  },
  {
    id: "d3",
    created_at: "2026-05-22T12:00:00Z",
    detection_type: "email",
    action_taken: "flagged",
    context_snippet: null,
    user_id: null,
    user_display_name: null,
    user_email: null,
    session_id: null,
  },
];

beforeEach(() => {
  piiMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PIIDetectionViewer", () => {
  it("renders one row per detection with the matching action badge", async () => {
    piiMock.mockResolvedValue({ detections, count: detections.length });

    const wrapper = mount(PIIDetectionViewer);
    wrapper
      .findAll("goa-button")
      .find((b) => b.text().trim() === "Refresh")!
      .element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
    await flushPromises();

    expect(piiMock).toHaveBeenCalledWith({ limit: 200 });
    const text = wrapper.text();
    expect(text).toContain("Alice");
    expect(text).toContain("bob@example.com");
    expect(text).toContain("sin");
    expect(text).toContain("credit_card");
    expect(text).toContain("email");
    expect(text).toContain("3 detections");

    expect(wrapper.find('goa-badge[content="blocked"]').attributes("type")).toBe("emergency");
    expect(wrapper.find('goa-badge[content="redacted"]').attributes("type")).toBe("important");
    expect(wrapper.find('goa-badge[content="flagged"]').attributes("type")).toBe("information");
  });

  it("renders an em-dash for missing snippet / session / user", async () => {
    piiMock.mockResolvedValue({ detections: [detections[2]], count: 1 });

    const wrapper = mount(PIIDetectionViewer);
    wrapper
      .findAll("goa-button")
      .find((b) => b.text().trim() === "Refresh")!
      .element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
    await flushPromises();

    // Three em-dashes expected — snippet, user (no name/email/id), session.
    expect(wrapper.text().match(/—/g)?.length).toBeGreaterThanOrEqual(3);
    expect(wrapper.text()).toContain("1 detection");
    expect(wrapper.text()).not.toContain("1 detections");
  });

  it("shows the empty hint when no detections exist", async () => {
    piiMock.mockResolvedValue({ detections: [], count: 0 });

    const wrapper = mount(PIIDetectionViewer);
    wrapper
      .findAll("goa-button")
      .find((b) => b.text().trim() === "Refresh")!
      .element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
    await flushPromises();

    expect(wrapper.text()).toContain("No PII detections recorded");
  });

  it("surfaces a callout when the fetch fails", async () => {
    piiMock.mockRejectedValue(new Error("forbidden"));

    const wrapper = mount(PIIDetectionViewer);
    wrapper
      .findAll("goa-button")
      .find((b) => b.text().trim() === "Refresh")!
      .element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
    await flushPromises();

    expect(wrapper.find('goa-callout[type="emergency"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("forbidden");
  });
});
