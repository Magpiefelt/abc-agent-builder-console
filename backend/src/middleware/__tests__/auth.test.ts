import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

vi.mock("../../config/env.js", () => ({
  env: {
    NODE_ENV: "development",
    PORT: 3000,
    DATABASE_URL: undefined,
    DB_SCHEMA: "test",
    SESSION_SECRET: "test",
    VERTEX_AI_REGION: "northamerica-northeast1",
    MAX_ITERATIONS_LIMIT: 100,
    LLM_TIMEOUT_MS: 120000,
    TOOL_TIMEOUT_MS: 30000,
    MAX_CONCURRENT_SESSIONS: 3,
    FRONTEND_URL: "http://localhost:5173",
  },
}));

import { authenticate, requireRole, requireMinistry } from "../auth.js";

function makeReq(headers: Record<string, string> = {}, user?: unknown): Request {
  return {
    headers,
    user,
  } as unknown as Request;
}

function makeRes(): Response & { _status: number; _body: unknown } {
  const res = {
    _status: 200,
    _body: null as unknown,
    status(code: number) {
      this._status = code;
      return this;
    },
    json(body: unknown) {
      this._body = body;
      return this;
    },
  };
  return res as unknown as Response & { _status: number; _body: unknown };
}

describe("auth.authenticate (env mocked as development)", () => {
  it("attaches the dev mock user when no Authorization header is present", () => {
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();
    authenticate(req, res, next as unknown as NextFunction);
    expect(next).toHaveBeenCalledOnce();
    expect(req.user).toBeDefined();
    expect(req.user?.email).toBe("cohen.mcleod@gov.ab.ca");
    expect(req.user?.ministryCode).toBe("INFRA");
    expect(req.user?.role).toBe("admin");
  });

  it("attaches the dev mock user when a Bearer token is provided in development", () => {
    const req = makeReq({ authorization: "Bearer anything" });
    const res = makeRes();
    const next = vi.fn();
    authenticate(req, res, next as unknown as NextFunction);
    expect(next).toHaveBeenCalledOnce();
    expect(req.user?.email).toBe("cohen.mcleod@gov.ab.ca");
  });
});

describe("auth.requireRole", () => {
  it("calls next() when user has the required role", () => {
    const req = makeReq({}, { role: "admin" });
    const res = makeRes();
    const next = vi.fn();
    requireRole("admin")(req, res, next as unknown as NextFunction);
    expect(next).toHaveBeenCalledOnce();
  });

  it("returns 403 when user does not have the required role", () => {
    const req = makeReq({}, { role: "viewer" });
    const res = makeRes();
    const next = vi.fn();
    requireRole("admin")(req, res, next as unknown as NextFunction);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(403);
  });

  it("returns 401 when no user is attached", () => {
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();
    requireRole("admin")(req, res, next as unknown as NextFunction);
    expect(res._status).toBe(401);
  });

  it("accepts a role list (one of several)", () => {
    const req = makeReq({}, { role: "user" });
    const res = makeRes();
    const next = vi.fn();
    requireRole("admin", "user")(req, res, next as unknown as NextFunction);
    expect(next).toHaveBeenCalledOnce();
  });
});

describe("auth.requireMinistry", () => {
  it("calls next when user has a ministry code", () => {
    const req = makeReq({}, { ministryCode: "INFRA" });
    const res = makeRes();
    const next = vi.fn();
    requireMinistry(req, res, next as unknown as NextFunction);
    expect(next).toHaveBeenCalledOnce();
  });

  it("returns 403 when user is missing ministry", () => {
    const req = makeReq({}, { ministryCode: null });
    const res = makeRes();
    const next = vi.fn();
    requireMinistry(req, res, next as unknown as NextFunction);
    expect(res._status).toBe(403);
  });

  it("returns 401 when no user is attached", () => {
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();
    requireMinistry(req, res, next as unknown as NextFunction);
    expect(res._status).toBe(401);
  });
});
