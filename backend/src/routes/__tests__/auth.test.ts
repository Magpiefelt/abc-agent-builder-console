/**
 * Route-level tests for /api/auth/*.
 *
 * The Entra ID OIDC dependencies are mocked so we exercise routing logic,
 * guard conditions, and response shapes without any real OAuth flows.
 *
 * Dev mock auth is in effect (ENTRA_CLIENT_ID absent), so the `authenticate`
 * middleware auto-attaches a fixed test user for protected routes.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ---------------------------------------------------------------------------
// Module mocks (hoisted before imports)
// ---------------------------------------------------------------------------

const queryMock = vi.hoisted(() => vi.fn());
vi.mock("../../config/database.js", () => ({ query: queryMock }));

const logAuditMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("../../services/auditLogger.js", () => ({
  logAudit: logAuditMock,
  AuditAction: {
    AUTH_LOGIN: "auth.login",
    AUTH_LOGOUT: "auth.logout",
    AUTH_FAILED: "auth.failed",
  },
}));

vi.mock("../../services/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mocks for entraAuth service functions
const signOAuthStateMock = vi.hoisted(() => vi.fn().mockResolvedValue("signed-state-token"));
const buildAuthorizeUrlMock = vi.hoisted(() => vi.fn().mockReturnValue("https://entra.example.com/authorize?x=1"));
const verifyOAuthStateMock = vi.hoisted(() => vi.fn());
const exchangeCodeForTokenMock = vi.hoisted(() => vi.fn());
const verifyEntraTokenMock = vi.hoisted(() => vi.fn());
const upsertUserMock = vi.hoisted(() => vi.fn());
const signSessionTokenMock = vi.hoisted(() => vi.fn().mockResolvedValue("session-token-xyz"));
const safeReturnToMock = vi.hoisted(() =>
  vi.fn().mockImplementation((v: unknown) => (typeof v === "string" && v.startsWith("/") ? v : "/"))
);

const MockEntraConfigError = vi.hoisted(() => {
  return class EntraConfigError extends Error {
    constructor(msg = "not configured") {
      super(msg);
      this.name = "EntraConfigError";
    }
  };
});

vi.mock("../../services/entraAuth.js", () => ({
  COOKIE_OAUTH_STATE: "abc_oauth_state",
  COOKIE_SESSION: "abc_session",
  OAUTH_STATE_TTL_MS: 300000,
  SESSION_TTL_MS: 86400000,
  buildAuthorizeUrl: buildAuthorizeUrlMock,
  exchangeCodeForToken: exchangeCodeForTokenMock,
  safeReturnTo: safeReturnToMock,
  signOAuthState: signOAuthStateMock,
  signSessionToken: signSessionTokenMock,
  upsertUser: upsertUserMock,
  verifyEntraToken: verifyEntraTokenMock,
  verifyOAuthState: verifyOAuthStateMock,
  EntraConfigError: MockEntraConfigError,
  // Additional exports consumed by middleware/auth.ts
  extractMinistry: vi.fn().mockReturnValue(null),
  extractMinistryFromEntra: vi.fn().mockReturnValue(null),
  verifySessionToken: vi.fn().mockResolvedValue({ sub: "dev-user", role: "admin" }),
  loadUserById: vi.fn().mockResolvedValue(null),
  claimsToAuthUser: vi.fn(),
  SessionExpiredError: class SessionExpiredError extends Error { constructor() { super("expired"); this.name = "SessionExpiredError"; } },
  InvalidSignatureError: class InvalidSignatureError extends Error { constructor() { super("invalid"); this.name = "InvalidSignatureError"; } },
}));

vi.mock("../../config/env.js", () => ({
  env: {
    NODE_ENV: "development",
    PORT: 3000,
    DATABASE_URL: undefined,
    DB_SCHEMA: "test",
    SESSION_SECRET: "test",
    FRONTEND_URL: "http://localhost:5173",
    // Leave ENTRA_CLIENT_ID / ENTRA_TENANT_ID unset to trigger the 503 guard
  },
}));

// ---------------------------------------------------------------------------
// Import under test (after mocks)
// ---------------------------------------------------------------------------

import cookieParser from "cookie-parser";
import authRouter from "../auth.js";

// Build once — the app is stateless; mocks reset in beforeEach cover per-test isolation.
const app = (() => {
  const a = express();
  a.use(express.json());
  a.use(cookieParser());
  a.use("/api/auth", authRouter);
  return a;
})();

/** Normalise supertest's set-cookie header into a single string for assertions. */
function joinCookies(res: { headers: Record<string, unknown> }): string {
  const h = res.headers["set-cookie"] as string[] | string | undefined;
  return Array.isArray(h) ? h.join(";") : h ?? "";
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  queryMock.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
  logAuditMock.mockReset().mockResolvedValue(undefined);
  signOAuthStateMock.mockReset().mockResolvedValue("signed-state-token");
  buildAuthorizeUrlMock.mockReset().mockReturnValue("https://entra.example.com/authorize?x=1");
  verifyOAuthStateMock.mockReset();
  exchangeCodeForTokenMock.mockReset();
  verifyEntraTokenMock.mockReset();
  upsertUserMock.mockReset();
  signSessionTokenMock.mockReset().mockResolvedValue("session-token-xyz");
  safeReturnToMock.mockReset().mockImplementation((v: unknown) =>
    typeof v === "string" && v.startsWith("/") ? v : "/"
  );
});

// ---------------------------------------------------------------------------
// GET /api/auth/login — Entra not configured
// ---------------------------------------------------------------------------

describe("GET /api/auth/login — Entra not configured", () => {
  it("returns 503 when ENTRA_CLIENT_ID is absent", async () => {
    // env mock has no ENTRA_CLIENT_ID set
    const res = await request(app).get("/api/auth/login");
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/not configured/i);
  });
});

// ---------------------------------------------------------------------------
// GET /api/auth/callback — missing params
// ---------------------------------------------------------------------------

describe("GET /api/auth/callback — missing code or state", () => {
  it("redirects to /login?error= when code is missing", async () => {
    const res = await request(app)
      .get("/api/auth/callback")
      .query({ state: "some-state" });
    // No Accept header → route redirects (HTML client path)
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("error=");
  });

  it("redirects to /login?error= when state is missing", async () => {
    const res = await request(app)
      .get("/api/auth/callback")
      .query({ code: "some-code" });
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("error=");
  });

  it("returns 400 JSON when Entra signals error (user denied consent)", async () => {
    const res = await request(app)
      .get("/api/auth/callback")
      .query({ error: "access_denied", error_description: "The user cancelled" })
      .accept("application/json");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});

describe("GET /api/auth/callback — missing state cookie", () => {
  it("returns 400 JSON when state cookie is absent", async () => {
    const res = await request(app)
      .get("/api/auth/callback")
      .query({ code: "auth-code", state: "incoming-state" })
      .accept("application/json");
    // Accept: application/json → route returns JSON instead of redirecting
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});

describe("GET /api/auth/callback — invalid state cookie", () => {
  it("returns 400 JSON when verifyOAuthState throws", async () => {
    verifyOAuthStateMock.mockRejectedValueOnce(new Error("bad sig"));

    const res = await request(app)
      .get("/api/auth/callback")
      .set("Cookie", "abc_oauth_state=bad-token")
      .query({ code: "auth-code", state: "some-state" })
      .accept("application/json");

    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});

describe("GET /api/auth/callback — state mismatch", () => {
  it("returns 400 JSON when incoming state doesn't match cookie state", async () => {
    verifyOAuthStateMock.mockResolvedValueOnce({
      state: "expected-state",
      codeVerifier: "verifier",
      returnTo: "/",
    });

    const res = await request(app)
      .get("/api/auth/callback")
      .set("Cookie", "abc_oauth_state=valid-token")
      .query({ code: "auth-code", state: "DIFFERENT-state" })
      .accept("application/json");

    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});

describe("GET /api/auth/callback — successful login", () => {
  it("sets session cookie and redirects to frontend on success", async () => {
    verifyOAuthStateMock.mockResolvedValueOnce({
      state: "good-state",
      codeVerifier: "verifier-abc",
      returnTo: "/",
    });
    exchangeCodeForTokenMock.mockResolvedValueOnce({
      id_token: "id-token-xyz",
      access_token: "at",
    });
    verifyEntraTokenMock.mockResolvedValueOnce({
      oid: "entra-oid-1",
      email: "user@gov.ab.ca",
      name: "Test User",
    });
    upsertUserMock.mockResolvedValueOnce({
      id: "u-1",
      entraId: "entra-oid-1",
      email: "user@gov.ab.ca",
      displayName: "Test User",
      ministryCode: "INFRA",
      role: "user",
    });

    const res = await request(app)
      .get("/api/auth/callback")
      .set("Cookie", "abc_oauth_state=valid-state-token")
      .query({ code: "auth-code", state: "good-state" });

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("localhost:5173");
    expect(joinCookies(res)).toContain("abc_session");
  });
});

describe("GET /api/auth/callback — EntraConfigError", () => {
  it("returns 503 JSON when EntraConfigError is thrown", async () => {
    verifyOAuthStateMock.mockResolvedValueOnce({
      state: "good-state",
      codeVerifier: "v",
      returnTo: "/",
    });
    exchangeCodeForTokenMock.mockRejectedValueOnce(new MockEntraConfigError("not configured"));

    const res = await request(app)
      .get("/api/auth/callback")
      .set("Cookie", "abc_oauth_state=valid-state-token")
      .query({ code: "auth-code", state: "good-state" })
      .accept("application/json");

    expect(res.status).toBe(503);
    expect(res.body.error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/logout
// ---------------------------------------------------------------------------

describe("POST /api/auth/logout", () => {
  it("returns 204 and clears session cookie", async () => {
    const res = await request(app).post("/api/auth/logout");
    expect(res.status).toBe(204);
    const cookieString = joinCookies(res);
    expect(cookieString).toContain("abc_session");
    expect(cookieString.toLowerCase()).toMatch(/expires=|max-age=0/);
  });
});

// ---------------------------------------------------------------------------
// GET /api/auth/me
// ---------------------------------------------------------------------------

describe("GET /api/auth/me", () => {
  it("returns the authenticated user object", async () => {
    // Dev mock auth attaches the fixed dev user (cohen.mcleod@gov.ab.ca, admin)
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(200);
    expect(res.body.email).toBe("cohen.mcleod@gov.ab.ca");
    expect(res.body.role).toBe("admin");
    // No sensitive session fields should leak
    expect(res.body.passwordHash).toBeUndefined();
  });
});
