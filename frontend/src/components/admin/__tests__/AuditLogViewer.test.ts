/**
 * AuditLogViewer renders the GoA audit table and lets administrators
 * search by action / user / date range. Tests stub the `api.admin.audit`
 * helper and exercise: initial empty state, search submission, error
 * surfacing, CSV export, and the live "entries count" announcement.
 *
 * The component calls `load()` from `onActivated`. Vue's `onActivated`
 * fires only inside a `<KeepAlive>` boundary, so we drive load() via the
 * primary Search button rather than depending on activation hooks.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { ApiError } from "@/lib/api";
import type { AuditEntry } from "@/types/admin";

const auditMock = vi.hoisted(() => vi.fn());
const exportUserDataMock = vi.hoisted(() => vi.fn());
const toastPushMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      admin: {
        audit: auditMock,
        exportUserData: exportUserDataMock,
      },
    },
  };
});

vi.mock("@/composables/useToast", () => ({
  useToast: () => ({ push: toastPushMock }),
}));

import AuditLogViewer from "../AuditLogViewer.vue";

function makeEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: 1,
    user_id: "11111111-1111-1111-1111-111111111111",
    ministry_code: "INFRA",
    action: "agent.session.created",
    resource_type: "agent_session",
    resource_id: "22222222-2222-2222-2222-222222222222",
    details: { foo: "bar" },
    ip_address: "10.0.0.42",
    created_at: "2026-05-21T15:00:00Z",
    ...overrides,
  };
}

function findGoaButton(
  wrapper: ReturnType<typeof mount>,
  label: string,
): { dispatch: () => void } | undefined {
  const btn = wrapper.findAll("goa-button").find((b) => b.text().trim() === label);
  if (!btn) return undefined;
  return {
    dispatch: () =>
      btn.element.dispatchEvent(new CustomEvent("_click", { bubbles: true })),
  };
}

beforeEach(() => {
  auditMock.mockReset();
  exportUserDataMock.mockReset();
  toastPushMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AuditLogViewer", () => {
  it("renders the empty-state row before any load happens", () => {
    const wrapper = mount(AuditLogViewer);
    expect(wrapper.text()).toContain("No audit entries match the filters.");
    // The initial CTA reads "Search" (not "Apply filters") until results land.
    const searchBtn = findGoaButton(wrapper, "Search");
    expect(searchBtn).toBeDefined();
  });

  it("calls api.admin.audit with current filters when Search is clicked", async () => {
    auditMock.mockResolvedValueOnce({ entries: [makeEntry()], count: 1 });
    const wrapper = mount(AuditLogViewer);

    findGoaButton(wrapper, "Search")!.dispatch();
    await flushPromises();

    expect(auditMock).toHaveBeenCalledTimes(1);
    expect(auditMock).toHaveBeenCalledWith({
      action: undefined,
      user_id: undefined,
      from: undefined,
      to: undefined,
      limit: 100,
    });

    // Once entries land the CTA flips to "Apply filters".
    expect(findGoaButton(wrapper, "Apply filters")).toBeDefined();
  });

  it("renders one row per audit entry with timestamp + action", async () => {
    auditMock.mockResolvedValueOnce({
      entries: [
        makeEntry({ id: 10, action: "agent.session.created" }),
        makeEntry({ id: 11, action: "workflow.execute", resource_type: "workflow" }),
      ],
      count: 2,
    });
    const wrapper = mount(AuditLogViewer);
    findGoaButton(wrapper, "Search")!.dispatch();
    await flushPromises();

    expect(wrapper.text()).toContain("agent.session.created");
    expect(wrapper.text()).toContain("workflow.execute");
    expect(wrapper.text()).toContain("2 entries");
  });

  it("shows '1 entry' (singular) when exactly one result lands", async () => {
    auditMock.mockResolvedValueOnce({ entries: [makeEntry()], count: 1 });
    const wrapper = mount(AuditLogViewer);
    findGoaButton(wrapper, "Search")!.dispatch();
    await flushPromises();
    expect(wrapper.text()).toContain("1 entry");
    expect(wrapper.text()).not.toContain("1 entries");
  });

  it("displays the 'limit reached' hint when results equal the limit", async () => {
    const entries = Array.from({ length: 100 }, (_, i) =>
      makeEntry({ id: 1000 + i, resource_id: `r-${i}` }),
    );
    auditMock.mockResolvedValueOnce({ entries, count: 100 });

    const wrapper = mount(AuditLogViewer);
    findGoaButton(wrapper, "Search")!.dispatch();
    await flushPromises();

    expect(wrapper.text()).toContain("limit reached");
  });

  it("surfaces ApiError messages through the goa-callout", async () => {
    auditMock.mockRejectedValueOnce(new ApiError(500, "DB unavailable", { error: "DB unavailable" }));
    const wrapper = mount(AuditLogViewer);
    findGoaButton(wrapper, "Search")!.dispatch();
    await flushPromises();

    // GoA web components render their heading via an attribute, not slot
    // text, so assert the wiring + body separately.
    const callout = wrapper.find("goa-callout");
    expect(callout.exists()).toBe(true);
    expect(callout.attributes("heading")).toBe("Audit query failed");
    expect(callout.attributes("type")).toBe("emergency");
    expect(callout.text()).toContain("DB unavailable");
  });

  it("stringifies non-ApiError failures so the UI never shows `[object Object]`", async () => {
    auditMock.mockRejectedValueOnce(new Error("timeout"));
    const wrapper = mount(AuditLogViewer);
    findGoaButton(wrapper, "Search")!.dispatch();
    await flushPromises();
    expect(wrapper.text()).toContain("timeout");
  });

  it("disables CSV export until entries are loaded", async () => {
    auditMock.mockResolvedValueOnce({ entries: [makeEntry()], count: 1 });
    const wrapper = mount(AuditLogViewer);
    const exportBefore = wrapper
      .findAll("goa-button")
      .find((b) => b.text().includes("Export"));
    expect(exportBefore).toBeDefined();
    expect(exportBefore!.attributes("disabled")).toBeDefined();

    findGoaButton(wrapper, "Search")!.dispatch();
    await flushPromises();

    const exportAfter = wrapper
      .findAll("goa-button")
      .find((b) => b.text().includes("Export"));
    expect(exportAfter!.attributes("disabled")).toBeUndefined();
  });

  it("triggers a CSV download when Export CSV is clicked", async () => {
    auditMock.mockResolvedValueOnce({
      entries: [
        makeEntry({
          id: 7,
          action: "admin.access",
          details: { route: "/admin", note: 'has a "quote"' },
        }),
      ],
      count: 1,
    });

    const createObjectURL = vi.fn().mockReturnValue("blob:fake-url");
    const revokeObjectURL = vi.fn();
    (URL as unknown as { createObjectURL: typeof createObjectURL }).createObjectURL = createObjectURL;
    (URL as unknown as { revokeObjectURL: typeof revokeObjectURL }).revokeObjectURL = revokeObjectURL;

    // Anchor click is invoked imperatively in the component — spy on it to
    // confirm the download was actually triggered.
    const anchorClick = vi.fn();
    const originalCreate = document.createElement.bind(document);
    const spy = vi.spyOn(document, "createElement").mockImplementation((tagName: string) => {
      const el = originalCreate(tagName) as HTMLElement;
      if (tagName === "a") {
        (el as HTMLAnchorElement).click = anchorClick;
      }
      return el as HTMLAnchorElement;
    });

    const wrapper = mount(AuditLogViewer);
    findGoaButton(wrapper, "Search")!.dispatch();
    await flushPromises();

    findGoaButton(wrapper, "Export CSV")!.dispatch();
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);

    spy.mockRestore();
  });

  it("forwards user-supplied filters to api.admin.audit", async () => {
    auditMock.mockResolvedValueOnce({ entries: [], count: 0 });
    const wrapper = mount(AuditLogViewer);

    // The component listens for the GoA `_change` CustomEvent on each input.
    const inputs = wrapper.findAll("goa-input");
    const inputByName = (name: string) =>
      inputs.find((i) => i.attributes("name") === name);

    inputByName("filterAction")!.element.dispatchEvent(
      new CustomEvent("_change", { detail: { value: "agent.session.created" }, bubbles: true }),
    );
    inputByName("filterUserId")!.element.dispatchEvent(
      new CustomEvent("_change", { detail: { value: "u-1" }, bubbles: true }),
    );
    inputByName("filterLimit")!.element.dispatchEvent(
      new CustomEvent("_change", { detail: { value: "25" }, bubbles: true }),
    );
    await wrapper.vm.$nextTick();

    findGoaButton(wrapper, "Search")!.dispatch();
    await flushPromises();

    expect(auditMock).toHaveBeenCalledWith({
      action: "agent.session.created",
      user_id: "u-1",
      from: undefined,
      to: undefined,
      limit: 25,
    });
  });

  // ---------------------------------------------------------------------------
  // FOIP s.7 right-of-access export (Bot 13 backend, Bot 15 UI wire-up)
  // ---------------------------------------------------------------------------

  describe("FOIP s.7 export", () => {
    const VALID_USER_ID = "11111111-1111-1111-1111-111111111111";

    function setUserIdFilter(wrapper: ReturnType<typeof mount>, value: string) {
      const input = wrapper
        .findAll("goa-input")
        .find((i) => i.attributes("name") === "filterUserId")!;
      input.element.dispatchEvent(
        new CustomEvent("_change", { detail: { value }, bubbles: true }),
      );
    }

    it("disables 'Export user data' until the user ID filter holds a valid UUID", async () => {
      const wrapper = mount(AuditLogViewer);
      const btn = wrapper.find('[data-testid="export-user-data"]');
      expect(btn.exists()).toBe(true);
      // No user ID → disabled
      expect(btn.attributes("disabled")).toBeDefined();

      // Looks-like-a-uuid but isn't → still disabled
      setUserIdFilter(wrapper, "not-a-uuid");
      await wrapper.vm.$nextTick();
      expect(
        wrapper.find('[data-testid="export-user-data"]').attributes("disabled"),
      ).toBeDefined();

      // Valid UUID → enabled
      setUserIdFilter(wrapper, VALID_USER_ID);
      await wrapper.vm.$nextTick();
      expect(
        wrapper.find('[data-testid="export-user-data"]').attributes("disabled"),
      ).toBeUndefined();
    });

    it("opens the confirmation modal (only) when the button is clicked with a valid user ID", async () => {
      const wrapper = mount(AuditLogViewer);
      setUserIdFilter(wrapper, VALID_USER_ID);
      await wrapper.vm.$nextTick();

      expect(wrapper.find('[data-testid="export-user-data-modal"]').exists()).toBe(false);
      wrapper
        .find('[data-testid="export-user-data"]')
        .element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
      await wrapper.vm.$nextTick();

      const modal = wrapper.find('[data-testid="export-user-data-modal"]');
      expect(modal.exists()).toBe(true);
      // The modal heading should explicitly reference FOIP s.7.
      expect(modal.attributes("heading")).toContain("FOIP s.7");
      // And echo the user ID being exported so the admin can sanity-check it.
      expect(modal.text()).toContain(VALID_USER_ID);
      // No fetch yet — the click only opens the modal.
      expect(exportUserDataMock).not.toHaveBeenCalled();
    });

    it("downloads the ZIP when the user confirms inside the modal", async () => {
      const fakeBlob = new Blob(["zipbytes"], { type: "application/zip" });
      exportUserDataMock.mockResolvedValueOnce({
        blob: fakeBlob,
        filename: "abc-user-11111111-2026-05-22.zip",
      });

      const createObjectURL = vi.fn().mockReturnValue("blob:fake");
      const revokeObjectURL = vi.fn();
      (URL as unknown as { createObjectURL: typeof createObjectURL }).createObjectURL = createObjectURL;
      (URL as unknown as { revokeObjectURL: typeof revokeObjectURL }).revokeObjectURL = revokeObjectURL;

      // Spy on the anchor.click() that drives the download.
      const anchorClick = vi.fn();
      const originalCreate = document.createElement.bind(document);
      const spy = vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
        const el = originalCreate(tag) as HTMLElement;
        if (tag === "a") (el as HTMLAnchorElement).click = anchorClick;
        return el as HTMLAnchorElement;
      });

      const wrapper = mount(AuditLogViewer);
      setUserIdFilter(wrapper, VALID_USER_ID);
      await wrapper.vm.$nextTick();
      wrapper
        .find('[data-testid="export-user-data"]')
        .element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
      await wrapper.vm.$nextTick();
      wrapper
        .find('[data-testid="export-user-data-confirm"]')
        .element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
      await flushPromises();

      expect(exportUserDataMock).toHaveBeenCalledWith(VALID_USER_ID);
      expect(createObjectURL).toHaveBeenCalledWith(fakeBlob);
      expect(anchorClick).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).toHaveBeenCalledTimes(1);
      // Modal closes after a successful export.
      expect(wrapper.find('[data-testid="export-user-data-modal"]').exists()).toBe(false);
      // Success toast surfaces the server-supplied filename so the admin can
      // refer to the export by name in their audit ticket.
      expect(toastPushMock).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "success",
          message: expect.stringContaining("abc-user-11111111-2026-05-22.zip"),
        }),
      );

      spy.mockRestore();
    });

    it("trims whitespace around the user ID before validating + calling the API", async () => {
      exportUserDataMock.mockResolvedValueOnce({
        blob: new Blob(["x"], { type: "application/zip" }),
        filename: "x.zip",
      });
      (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:x";
      (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
      const originalCreate = document.createElement.bind(document);
      const spy = vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
        const el = originalCreate(tag) as HTMLElement;
        if (tag === "a") (el as HTMLAnchorElement).click = vi.fn();
        return el as HTMLAnchorElement;
      });

      const wrapper = mount(AuditLogViewer);
      setUserIdFilter(wrapper, `  ${VALID_USER_ID}  `);
      await wrapper.vm.$nextTick();

      // Button is enabled despite the surrounding whitespace.
      expect(
        wrapper.find('[data-testid="export-user-data"]').attributes("disabled"),
      ).toBeUndefined();

      wrapper
        .find('[data-testid="export-user-data"]')
        .element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
      await wrapper.vm.$nextTick();
      wrapper
        .find('[data-testid="export-user-data-confirm"]')
        .element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
      await flushPromises();

      expect(exportUserDataMock).toHaveBeenCalledWith(VALID_USER_ID);
      spy.mockRestore();
    });

    it("surfaces an error toast and keeps the modal open when the export fails", async () => {
      exportUserDataMock.mockRejectedValueOnce(new ApiError(403, "Admin role required", null));

      const wrapper = mount(AuditLogViewer);
      setUserIdFilter(wrapper, VALID_USER_ID);
      await wrapper.vm.$nextTick();
      wrapper
        .find('[data-testid="export-user-data"]')
        .element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
      await wrapper.vm.$nextTick();
      wrapper
        .find('[data-testid="export-user-data-confirm"]')
        .element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
      await flushPromises();

      // Modal stays open so the admin can retry without re-finding the button.
      expect(wrapper.find('[data-testid="export-user-data-modal"]').exists()).toBe(true);
      expect(toastPushMock).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "error",
          message: expect.stringContaining("Admin role required"),
        }),
      );
    });

    it("cancels cleanly without calling the API", async () => {
      const wrapper = mount(AuditLogViewer);
      setUserIdFilter(wrapper, VALID_USER_ID);
      await wrapper.vm.$nextTick();
      wrapper
        .find('[data-testid="export-user-data"]')
        .element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
      await wrapper.vm.$nextTick();
      expect(wrapper.find('[data-testid="export-user-data-modal"]').exists()).toBe(true);

      // Click the Cancel button (which uses standard text)
      const cancelBtn = wrapper
        .findAll("goa-button")
        .find((b) => b.text().trim() === "Cancel")!;
      cancelBtn.element.dispatchEvent(new CustomEvent("_click", { bubbles: true }));
      await wrapper.vm.$nextTick();

      expect(wrapper.find('[data-testid="export-user-data-modal"]').exists()).toBe(false);
      expect(exportUserDataMock).not.toHaveBeenCalled();
    });
  });
});
