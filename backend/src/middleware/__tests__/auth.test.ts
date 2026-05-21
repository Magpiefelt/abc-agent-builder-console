import { describe, it, expect, vi } from "vitest";
import { requireRole, requireMinistry, type AuthUser } from "../auth.js";

const mockRes = () => {
  const res: { statusCode: number; body?: unknown; status: (n: number) => typeof res; json: (b: unknown) => typeof res } = {
    statusCode: 200,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
  return res as unknown as import("express").Response & { statusCode: number; body?: unknown };
};

const baseUser = (overrides: Partial<AuthUser> = {}): AuthUser => ({
  id: "u-1",
  entraId: "oid-1",
  email: "user@gov.ab.ca",
  displayName: "User",
  ministryCode: "INFRA",
  role: "user",
  ...overrides,
});

describe("requireRole", () => {
  it("401s when no user is attached to the request", () => {
    const next = vi.fn();
    const res = mockRes();
    const req = {} as import("express").Request;
    requireRole("admin")(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("403s when the user lacks the required role", () => {
    const next = vi.fn();
    const res = mockRes();
    const req = { user: baseUser({ role: "user" }) } as unknown as import("express").Request;
    requireRole("admin")(req, res, next);
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next() when the user has one of the required roles", () => {
    const next = vi.fn();
    const res = mockRes();
    const req = { user: baseUser({ role: "admin" }) } as unknown as import("express").Request;
    requireRole("admin", "viewer")(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });
});

describe("requireMinistry", () => {
  it("401s when no user is attached", () => {
    const next = vi.fn();
    const res = mockRes();
    const req = {} as import("express").Request;
    requireMinistry(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("403s when user has no ministry assigned", () => {
    const next = vi.fn();
    const res = mockRes();
    const req = { user: baseUser({ ministryCode: null }) } as unknown as import("express").Request;
    requireMinistry(req, res, next);
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next() when user has a ministry", () => {
    const next = vi.fn();
    const res = mockRes();
    const req = { user: baseUser({ ministryCode: "EDU" }) } as unknown as import("express").Request;
    requireMinistry(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
