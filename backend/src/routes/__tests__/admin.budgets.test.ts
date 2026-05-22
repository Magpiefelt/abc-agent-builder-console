/**
 * Route-level tests for /api/admin/budgets/*.
 *
 * The dev mock auth user has role 'admin', so all requests automatically
 * pass `authenticate` + `requireRole('admin')`. Budget-service calls are
 * mocked so the route's wiring is what's under test.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const queryMock = vi.hoisted(() => vi.fn());
vi.mock("../../config/database.js", () => ({ query: queryMock }));

vi.mock("../../services/llmProvider.js", () => ({ clearModelCache: vi.fn() }));
vi.mock("../../services/retentionJob.js", () => ({ runRetentionPass: vi.fn() }));
vi.mock("../../services/userDataExporter.js", () => ({ exportUserData: vi.fn() }));

const listBudgetsMock = vi.hoisted(() => vi.fn());
const setBudgetMock = vi.hoisted(() => vi.fn());
const deleteBudgetMock = vi.hoisted(() => vi.fn());
const listMonthlyUsageMock = vi.hoisted(() => vi.fn());

vi.mock("../../services/budgetGuard.js", async () => {
  const actual = await vi.importActual<typeof import("../../services/budgetGuard.js")>(
    "../../services/budgetGuard.js",
  );
  return {
    ...actual,
    listBudgets: listBudgetsMock,
    setBudget: setBudgetMock,
    deleteBudget: deleteBudgetMock,
    listMonthlyUsage: listMonthlyUsageMock,
  };
});

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

import adminRouter from "../admin.js";

function makeApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use("/api/admin", adminRouter);
  return app;
}

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
  listBudgetsMock.mockReset();
  setBudgetMock.mockReset();
  deleteBudgetMock.mockReset();
  listMonthlyUsageMock.mockReset();
});

// ---------------------------------------------------------------------------
// GET /budgets
// ---------------------------------------------------------------------------

describe("GET /api/admin/budgets", () => {
  it("returns the budgets list", async () => {
    listBudgetsMock.mockResolvedValueOnce([
      {
        id: "g-1",
        scopeType: "global",
        scopeId: "global",
        monthlyTokenLimit: 100_000_000,
        notes: null,
        createdBy: null,
        createdAt: "2026-05-22T00:00:00.000Z",
        updatedAt: "2026-05-22T00:00:00.000Z",
      },
      {
        id: "u-1",
        scopeType: "user",
        scopeId: "u-cohen",
        monthlyTokenLimit: 50_000,
        notes: "Pilot",
        createdBy: "admin-1",
        createdAt: "2026-05-22T00:00:00.000Z",
        updatedAt: "2026-05-22T00:00:00.000Z",
      },
    ]);

    const res = await request(makeApp()).get("/api/admin/budgets");
    expect(res.status).toBe(200);
    expect(res.body.budgets).toHaveLength(2);
    expect(res.body.count).toBe(2);
    expect(res.body.budgets[1].scopeType).toBe("user");
  });

  it("returns 500 when the service throws", async () => {
    listBudgetsMock.mockRejectedValueOnce(new Error("db gone"));
    const res = await request(makeApp()).get("/api/admin/budgets");
    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// PUT /budgets
// ---------------------------------------------------------------------------

describe("PUT /api/admin/budgets", () => {
  it("upserts and returns the new record", async () => {
    setBudgetMock.mockResolvedValueOnce({
      id: "u-2",
      scopeType: "user",
      scopeId: "u-cohen",
      monthlyTokenLimit: 25_000,
      notes: null,
      createdBy: "DEV_USER",
      createdAt: "2026-05-22T10:00:00Z",
      updatedAt: "2026-05-22T10:00:00Z",
    });

    const res = await request(makeApp())
      .put("/api/admin/budgets")
      .send({ scope_type: "user", scope_id: "u-cohen", monthly_token_limit: 25_000 });

    expect(res.status).toBe(200);
    expect(res.body.budget.monthlyTokenLimit).toBe(25_000);
    expect(setBudgetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        scopeType: "user",
        scopeId: "u-cohen",
        monthlyTokenLimit: 25_000,
      }),
    );
  });

  it("rejects invalid scope_type with 400", async () => {
    const res = await request(makeApp())
      .put("/api/admin/budgets")
      .send({ scope_type: "team", scope_id: "x", monthly_token_limit: 100 });
    expect(res.status).toBe(400);
  });

  it("rejects a negative monthly_token_limit", async () => {
    const res = await request(makeApp())
      .put("/api/admin/budgets")
      .send({ scope_type: "user", scope_id: "u-1", monthly_token_limit: -1 });
    expect(res.status).toBe(400);
  });

  it("rejects a fractional limit", async () => {
    const res = await request(makeApp())
      .put("/api/admin/budgets")
      .send({ scope_type: "user", scope_id: "u-1", monthly_token_limit: 1.5 });
    expect(res.status).toBe(400);
  });

  it("rejects an empty body", async () => {
    const res = await request(makeApp()).put("/api/admin/budgets").send({});
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// DELETE /budgets/:scopeType/:scopeId
// ---------------------------------------------------------------------------

describe("DELETE /api/admin/budgets/:scopeType/:scopeId", () => {
  it("returns 200 when a row was deleted", async () => {
    deleteBudgetMock.mockResolvedValueOnce(true);
    const res = await request(makeApp()).delete("/api/admin/budgets/user/u-cohen");
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
  });

  it("returns 404 when no row matched", async () => {
    deleteBudgetMock.mockResolvedValueOnce(false);
    const res = await request(makeApp()).delete("/api/admin/budgets/user/u-cohen");
    expect(res.status).toBe(404);
  });

  it("rejects invalid scope_type with 400", async () => {
    const res = await request(makeApp()).delete("/api/admin/budgets/foo/bar");
    expect(res.status).toBe(400);
  });

  it("returns 400 when the service refuses (e.g., global)", async () => {
    const { BudgetValidationError } = await import("../../services/budgetGuard.js");
    deleteBudgetMock.mockRejectedValueOnce(new BudgetValidationError("nope"));
    const res = await request(makeApp()).delete("/api/admin/budgets/global/global");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("nope");
  });
});

// ---------------------------------------------------------------------------
// GET /budgets/usage
// ---------------------------------------------------------------------------

describe("GET /api/admin/budgets/usage", () => {
  it("returns the usage list", async () => {
    listMonthlyUsageMock.mockResolvedValueOnce([
      {
        userId: "u-1",
        userEmail: "a@gov.ab.ca",
        userDisplayName: "Alice",
        ministryCode: "TBF",
        used: 5000,
        effectiveLimit: 10000,
        effectiveScope: "user",
        remaining: 5000,
        exceeded: false,
      },
    ]);
    const res = await request(makeApp()).get("/api/admin/budgets/usage");
    expect(res.status).toBe(200);
    expect(res.body.usage).toHaveLength(1);
    expect(res.body.usage[0].userEmail).toBe("a@gov.ab.ca");
  });

  it("clamps an out-of-range limit", async () => {
    listMonthlyUsageMock.mockResolvedValueOnce([]);
    const res = await request(makeApp()).get("/api/admin/budgets/usage?limit=9999");
    expect(res.status).toBe(200);
    // The route caps the limit before forwarding; we don't expose the exact
    // clamped number to the client, but the underlying call should not have
    // received the unbounded 9999.
    const calledWith = listMonthlyUsageMock.mock.calls[0][0];
    expect(calledWith).toBeLessThanOrEqual(500);
  });
});
