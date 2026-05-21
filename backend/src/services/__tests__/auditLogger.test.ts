import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());
vi.mock("../../config/database.js", () => ({
  query: queryMock,
}));

import {
  logAudit,
  auditAction,
  auditAgentEvent,
  auditToolExecution,
  auditSecurityEvent,
  getAuditTrail,
  getUserActivity,
  getSecurityEvents,
  AuditAction,
} from "../auditLogger.js";

beforeEach(() => {
  queryMock.mockReset();
});

describe("auditLogger — logAudit", () => {
  it("inserts a row with all fields preserved", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await logAudit({
      userId: "u-1",
      ministryCode: "INFRA",
      action: AuditAction.AGENT_SESSION_CREATED,
      resourceType: "agent_session",
      resourceId: "sess-1",
      details: { foo: "bar" },
      ipAddress: "192.168.1.1",
    });
    expect(queryMock).toHaveBeenCalledOnce();
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO audit_log/);
    expect(params[0]).toBe("u-1");
    expect(params[1]).toBe("INFRA");
    expect(params[2]).toBe(AuditAction.AGENT_SESSION_CREATED);
    expect(params[5]).toBe(JSON.stringify({ foo: "bar" }));
  });

  it("uses null for missing optional fields", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await logAudit({ action: AuditAction.AUTH_LOGIN });
    const [, params] = queryMock.mock.calls[0];
    expect(params[0]).toBeNull();
    expect(params[1]).toBeNull();
    expect(params[5]).toBeNull();
    expect(params[6]).toBeNull();
  });

  it("never throws when the database query rejects", async () => {
    queryMock.mockRejectedValueOnce(new Error("connection refused"));
    await expect(logAudit({ action: AuditAction.AUTH_FAILED })).resolves.toBeUndefined();
  });
});

describe("auditLogger — convenience helpers", () => {
  it("auditAction triggers an insert (fire-and-forget)", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    auditAction("u-1", AuditAction.ADMIN_ACCESS, "settings", "general", { theme: "dark" });
    await new Promise((r) => setImmediate(r));
    expect(queryMock).toHaveBeenCalled();
  });

  it("auditAgentEvent populates resource_type as agent_session", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    auditAgentEvent("u-1", AuditAction.AGENT_SESSION_STARTED, "sess-99", { modelId: "x" });
    await new Promise((r) => setImmediate(r));
    const [, params] = queryMock.mock.calls[0];
    expect(params[3]).toBe("agent_session");
    expect(params[4]).toBe("sess-99");
  });

  it("auditToolExecution maps success to TOOL_EXECUTED, failure to TOOL_FAILED", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    auditToolExecution("u-1", "sess-1", "brave_search", true, 150);
    auditToolExecution("u-1", "sess-1", "web_scrape", false, 75, { reason: "ssrf" });
    await new Promise((r) => setImmediate(r));
    expect(queryMock).toHaveBeenCalledTimes(2);
    const actions = queryMock.mock.calls.map((c) => c[1][2]);
    expect(actions).toContain(AuditAction.TOOL_EXECUTED);
    expect(actions).toContain(AuditAction.TOOL_FAILED);
  });

  it("auditSecurityEvent persists an entry with ip_address", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    auditSecurityEvent(AuditAction.SECURITY_RATE_LIMITED, "10.0.0.1", { method: "POST" });
    await new Promise((r) => setImmediate(r));
    const [, params] = queryMock.mock.calls[0];
    expect(params[2]).toBe(AuditAction.SECURITY_RATE_LIMITED);
    expect(params[6]).toBe("10.0.0.1");
  });
});

describe("auditLogger — query helpers", () => {
  it("getAuditTrail returns rows from the DB", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: 1, action: AuditAction.AGENT_SESSION_CREATED }] });
    const trail = await getAuditTrail("agent_session", "sess-1");
    expect(trail).toHaveLength(1);
  });

  it("getAuditTrail returns [] on DB failure", async () => {
    queryMock.mockRejectedValueOnce(new Error("boom"));
    const trail = await getAuditTrail("agent_session", "sess-1");
    expect(trail).toEqual([]);
  });

  it("getUserActivity returns [] on DB failure", async () => {
    queryMock.mockRejectedValueOnce(new Error("boom"));
    expect(await getUserActivity("u-1")).toEqual([]);
  });

  it("getSecurityEvents returns [] on DB failure", async () => {
    queryMock.mockRejectedValueOnce(new Error("boom"));
    expect(await getSecurityEvents()).toEqual([]);
  });
});

describe("auditLogger — every AuditAction is a string", () => {
  it("AuditAction enum members are unique strings (no accidental collisions)", () => {
    const values = Object.values(AuditAction);
    expect(new Set(values).size).toBe(values.length);
    for (const v of values) {
      expect(typeof v).toBe("string");
      expect(v.length).toBeGreaterThan(0);
    }
  });
});
