/**
 * Route-level tests for GET /api/users/me/budget.
 *
 * The budget endpoint reads the caller's effective budget + current usage
 * via `getBudgetStatus`. We mock the service to drive each shape
 * (enforced / unenforced / exceeded / error → fail-open).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const queryMock = vi.hoisted(() => vi.fn());
vi.mock("../../config/database.js", () => ({ query: queryMock }));

vi.mock("../../services/secretsVault.js", () => ({
  setSecret: vi.fn(),
  listLabels: vi.fn(),
  deleteSecret: vi.fn(),
  VaultNotConfigured: class VaultNotConfigured extends Error {},
}));

const getBudgetStatusMock = vi.hoisted(() => vi.fn());
vi.mock("../../services/budgetGuard.js", () => ({
  getBudgetStatus: getBudgetStatusMock,
}));

vi.mock("../../config/env.js", () => ({
  env: {
    NODE_ENV: "development",
    PORT: 3000,
    DATABASE_URL: undefined,
    DB_SCHEMA: "test",
    SESSION_SECRET: "test",
    FRONTEND_URL: "http://localhost:5173",
  },
}));

import userRouter from "../users.js";
import { authenticate } from "../../middleware/auth.js";

function makeApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use("/api/users", authenticate, userRouter);
  return app;
}

beforeEach(() => {
  queryMock.mockReset();
  getBudgetStatusMock.mockReset();
});

describe("GET /api/users/me/budget", () => {
  it("returns the caller's effective budget when enforced", async () => {
    getBudgetStatusMock.mockResolvedValueOnce({
      userId: "DEV_USER",
      ministryCode: null,
      effective: {
        resolvedScope: "global",
        budgetId: "g-1",
        monthlyTokenLimit: 100000,
        notes: null,
      },
      used: 12345,
      remaining: 87655,
      exceeded: false,
      enforced: true,
      period: { start: "2026-05-01T00:00:00Z", end: "2026-06-01T00:00:00Z" },
    });

    const res = await request(makeApp()).get("/api/users/me/budget");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      scope: "global",
      limit: 100000,
      used: 12345,
      remaining: 87655,
      exceeded: false,
      enforced: true,
      periodStart: "2026-05-01T00:00:00Z",
      periodEnd: "2026-06-01T00:00:00Z",
    });
  });

  it("returns enforced=false + null limit when no budget row exists", async () => {
    getBudgetStatusMock.mockResolvedValueOnce({
      userId: "DEV_USER",
      ministryCode: null,
      effective: { resolvedScope: "global", budgetId: null, monthlyTokenLimit: null, notes: null },
      used: 5000,
      remaining: null,
      exceeded: false,
      enforced: false,
      period: { start: "2026-05-01T00:00:00Z", end: "2026-06-01T00:00:00Z" },
    });
    const res = await request(makeApp()).get("/api/users/me/budget");
    expect(res.status).toBe(200);
    expect(res.body.limit).toBeNull();
    expect(res.body.enforced).toBe(false);
  });

  it("flags exceeded=true", async () => {
    getBudgetStatusMock.mockResolvedValueOnce({
      userId: "DEV_USER",
      ministryCode: null,
      effective: { resolvedScope: "user", budgetId: "u-1", monthlyTokenLimit: 100, notes: null },
      used: 200,
      remaining: 0,
      exceeded: true,
      enforced: true,
      period: { start: "2026-05-01T00:00:00Z", end: "2026-06-01T00:00:00Z" },
    });
    const res = await request(makeApp()).get("/api/users/me/budget");
    expect(res.status).toBe(200);
    expect(res.body.exceeded).toBe(true);
    expect(res.body.remaining).toBe(0);
  });

  it("fails open with a permissive response when the service throws", async () => {
    getBudgetStatusMock.mockRejectedValueOnce(new Error("db gone"));
    const res = await request(makeApp()).get("/api/users/me/budget");
    expect(res.status).toBe(200);
    expect(res.body.enforced).toBe(false);
    expect(res.body.limit).toBeNull();
    expect(res.body.used).toBe(0);
  });
});
