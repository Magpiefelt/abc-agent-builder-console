import { describe, it, expect, vi } from "vitest";
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
    ENTRA_CLIENT_ID: undefined,
  },
}));

// Stream A's auth pulls entraAuth helpers; stub the module so we don't need
// the full JWKS / DB infrastructure to test the dev-mode bypass.
vi.mock("../../services/entraAuth.js", () => ({
  COOKIE_SESSION: "abc_session",
  InvalidSignatureError: class extends Error {},
  SessionExpiredError: class extends Error {},
  loadUserById: vi.fn(),
  upsertUser: vi.fn(),
  verifyEntraToken: vi.fn(),
  verifySessionToken: vi.fn(),
  extractMinistry: vi.fn(),
}));

vi.mock("../../services/auditLogger.js", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
  AuditAction: { AUTH_FAILED: "auth.failed" },
}));

import { authenticate, requireRole, requireMinistry } from "../auth.js";

function makeReq(opts: { headers?: Record<string, string>; cookies?: Record<string, string>; user?: unknown } = {}): Request {
  return {
    headers: opts.headers ?? {},
    cookies: opts.cookies ?? {},
    user: opts.user,
    ip: "127.0.0.1",
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as Request;
}

function makeRes(): Response & { _status: number; _body: unknown } {
  const res = {
    _status: 200,
    _body: null as unknown,
    status(this: { _status: number }, code: number) {
      this._status = code;
      return this as unknown as Response;
    },
    json(this: { _body: unknown }, body: unknown) {
      this._body = body;
      return this as unknown as Response;
    },
  };
  return res as unknown as Response & { _status: number; _body: unknown };
}

describe("auth.authenticate — dev mock fallback", () => {
  it("attaches the DEV_USER when ENTRA_CLIENT_ID is unset and no credentials are presented", async () => {
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();
    await authenticate(req, res, next as unknown as NextFunction);
    expect(next).toHaveBeenCalledOnce();
    expect(req.user).toBeDefined();
    expect(req.user?.email).toBe("cohen.mcleod@gov.ab.ca");
    expect(req.user?.ministryCode).toBe("INFRA");
    expect(req.user?.role).toBe("admin");
  });
});

describe("auth.requireRole", () => {
  it("calls next() when user has the required role", () => {
    const req = makeReq({ user: { role: "admin" } });
    const res = makeRes();
    const next = vi.fn();
    requireRole("admin")(req, res, next as unknown as NextFunction);
    expect(next).toHaveBeenCalledOnce();
  });

  it("returns 403 when user does not have the required role", () => {
    const req = makeReq({ user: { role: "viewer" } });
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
    const req = makeReq({ user: { role: "user" } });
    const res = makeRes();
    const next = vi.fn();
    requireRole("admin", "user")(req, res, next as unknown as NextFunction);
    expect(next).toHaveBeenCalledOnce();
  });
});

describe("auth.requireMinistry", () => {
  it("calls next when user has a ministry code", () => {
    const req = makeReq({ user: { ministryCode: "INFRA" } });
    const res = makeRes();
    const next = vi.fn();
    requireMinistry(req, res, next as unknown as NextFunction);
    expect(next).toHaveBeenCalledOnce();
  });

  it("returns 403 when user is missing ministry", () => {
    const req = makeReq({ user: { ministryCode: null } });
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
