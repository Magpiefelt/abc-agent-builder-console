/**
 * Unit tests for budgetGuard.
 *
 * All database calls are mocked via vi.hoisted so no live DB is needed.
 * Tests focus on:
 *  - Effective-budget resolution order (user > ministry > global)
 *  - Monthly-usage aggregation across both source tables
 *  - getBudgetStatus combines limit + used + exceeded correctly
 *  - Admin CRUD (list / set / delete) input validation + happy paths
 *  - Permissive behavior when DATABASE_URL is unset
 *  - currentMonthPeriod returns UTC month boundaries
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks (hoisted before any imports)
// ---------------------------------------------------------------------------

const queryMock = vi.hoisted(() => vi.fn());
vi.mock("../../config/database.js", () => ({ query: queryMock }));

vi.mock("../../services/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const envMock = vi.hoisted(() => ({ DATABASE_URL: "postgresql://stub/db" }));
vi.mock("../../config/env.js", () => ({ env: envMock }));

// ---------------------------------------------------------------------------
// Import under test
// ---------------------------------------------------------------------------

import {
  BudgetValidationError,
  checkBudget,
  currentMonthPeriod,
  deleteBudget,
  getBudgetStatus,
  getEffectiveBudget,
  getMonthlyUsage,
  listBudgets,
  listMonthlyUsage,
  recordWorkflowTokens,
  setBudget,
} from "../budgetGuard.js";

beforeEach(() => {
  queryMock.mockReset();
  envMock.DATABASE_URL = "postgresql://stub/db";
});

// ---------------------------------------------------------------------------
// currentMonthPeriod
// ---------------------------------------------------------------------------

describe("currentMonthPeriod", () => {
  it("returns UTC month boundaries", () => {
    const period = currentMonthPeriod(new Date("2026-05-15T13:00:00.000Z"));
    expect(period.start).toBe("2026-05-01T00:00:00.000Z");
    expect(period.end).toBe("2026-06-01T00:00:00.000Z");
  });

  it("wraps December → January", () => {
    const period = currentMonthPeriod(new Date("2026-12-31T23:59:59.000Z"));
    expect(period.start).toBe("2026-12-01T00:00:00.000Z");
    expect(period.end).toBe("2027-01-01T00:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// getEffectiveBudget — resolution order
// ---------------------------------------------------------------------------

describe("getEffectiveBudget", () => {
  it("returns a permissive shape when no DATABASE_URL is configured", async () => {
    envMock.DATABASE_URL = "";
    const eff = await getEffectiveBudget("u-1", "TBF");
    expect(eff).toEqual({
      resolvedScope: "global",
      budgetId: null,
      monthlyTokenLimit: null,
      notes: null,
    });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("prefers a user-scoped row when one exists", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: "row-user",
          scope_type: "user",
          monthly_token_limit: "5000",
          notes: "Pilot user cap",
        },
      ],
      rowCount: 1,
    });
    const eff = await getEffectiveBudget("u-1", "TBF");
    expect(eff).toEqual({
      resolvedScope: "user",
      budgetId: "row-user",
      monthlyTokenLimit: 5000,
      notes: "Pilot user cap",
    });
    expect(queryMock).toHaveBeenCalledOnce();
    expect(queryMock.mock.calls[0][1]).toEqual(["u-1", "TBF"]);
  });

  it("falls back to ministry then global via SQL ORDER BY", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: "row-min",
          scope_type: "ministry",
          monthly_token_limit: "200000",
          notes: null,
        },
      ],
      rowCount: 1,
    });
    const eff = await getEffectiveBudget("u-2", "TBF");
    expect(eff.resolvedScope).toBe("ministry");
    expect(eff.monthlyTokenLimit).toBe(200000);
  });

  it("returns a null-limit when no rows exist at all", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const eff = await getEffectiveBudget("u-3", null);
    expect(eff.monthlyTokenLimit).toBeNull();
    expect(eff.budgetId).toBeNull();
  });

  it("substitutes empty string for null ministry so SQL doesn't see NULL", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await getEffectiveBudget("u-4", null);
    expect(queryMock.mock.calls[0][1]).toEqual(["u-4", ""]);
  });
});

// ---------------------------------------------------------------------------
// getMonthlyUsage
// ---------------------------------------------------------------------------

describe("getMonthlyUsage", () => {
  it("returns 0 with no DATABASE_URL", async () => {
    envMock.DATABASE_URL = "";
    expect(await getMonthlyUsage("u-1")).toBe(0);
  });

  it("returns the summed value from the union query", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ total: "12500" }], rowCount: 1 });
    expect(await getMonthlyUsage("u-1")).toBe(12500);
    expect(queryMock).toHaveBeenCalledOnce();
    expect(queryMock.mock.calls[0][1]).toEqual(["u-1"]);
  });

  it("returns 0 when usage query throws (fail open)", async () => {
    queryMock.mockRejectedValueOnce(new Error("connection refused"));
    expect(await getMonthlyUsage("u-1")).toBe(0);
  });

  it("treats null total as 0", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ total: null }], rowCount: 1 });
    expect(await getMonthlyUsage("u-1")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getBudgetStatus / checkBudget
// ---------------------------------------------------------------------------

describe("getBudgetStatus", () => {
  it("returns enforced=false when DB is unavailable", async () => {
    envMock.DATABASE_URL = "";
    const status = await getBudgetStatus("u-1", "TBF");
    expect(status.enforced).toBe(false);
    expect(status.remaining).toBeNull();
    expect(status.exceeded).toBe(false);
  });

  it("computes used/remaining/exceeded against the effective limit", async () => {
    // First call: getEffectiveBudget
    queryMock.mockResolvedValueOnce({
      rows: [{ id: "row-1", scope_type: "user", monthly_token_limit: "10000", notes: null }],
      rowCount: 1,
    });
    // Second call: getMonthlyUsage
    queryMock.mockResolvedValueOnce({ rows: [{ total: "7500" }], rowCount: 1 });
    const status = await getBudgetStatus("u-1", "TBF");
    expect(status.enforced).toBe(true);
    expect(status.effective.resolvedScope).toBe("user");
    expect(status.effective.monthlyTokenLimit).toBe(10000);
    expect(status.used).toBe(7500);
    expect(status.remaining).toBe(2500);
    expect(status.exceeded).toBe(false);
  });

  it("flags exceeded=true when usage equals or exceeds limit", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ id: "row-1", scope_type: "ministry", monthly_token_limit: "1000", notes: null }],
      rowCount: 1,
    });
    queryMock.mockResolvedValueOnce({ rows: [{ total: "1200" }], rowCount: 1 });
    const status = await getBudgetStatus("u-1", "TBF");
    expect(status.exceeded).toBe(true);
    expect(status.remaining).toBe(0);
  });

  it("falls through to enforced=false when no budget row exists anywhere", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    queryMock.mockResolvedValueOnce({ rows: [{ total: "500" }], rowCount: 1 });
    const status = await getBudgetStatus("u-1", null);
    expect(status.enforced).toBe(false);
    expect(status.used).toBe(500);
    expect(status.remaining).toBeNull();
  });
});

describe("checkBudget", () => {
  it("is a thin wrapper over getBudgetStatus", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ id: "row-1", scope_type: "global", monthly_token_limit: "100000", notes: null }],
      rowCount: 1,
    });
    queryMock.mockResolvedValueOnce({ rows: [{ total: "0" }], rowCount: 1 });
    const status = await checkBudget("u-1", "TBF");
    expect(status.userId).toBe("u-1");
    expect(status.ministryCode).toBe("TBF");
    expect(status.exceeded).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Admin CRUD
// ---------------------------------------------------------------------------

describe("listBudgets", () => {
  it("returns [] when DB unavailable", async () => {
    envMock.DATABASE_URL = "";
    expect(await listBudgets()).toEqual([]);
  });

  it("maps rows to records with camelCase keys", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: "id-1",
          scope_type: "user",
          scope_id: "u-1",
          monthly_token_limit: "5000",
          notes: "VIP",
          created_by: "admin-1",
          created_at: new Date("2026-05-22T10:00:00Z"),
          updated_at: new Date("2026-05-22T11:00:00Z"),
        },
      ],
      rowCount: 1,
    });
    const out = await listBudgets();
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      id: "id-1",
      scopeType: "user",
      scopeId: "u-1",
      monthlyTokenLimit: 5000,
      notes: "VIP",
      createdBy: "admin-1",
      createdAt: "2026-05-22T10:00:00.000Z",
      updatedAt: "2026-05-22T11:00:00.000Z",
    });
  });
});

describe("setBudget", () => {
  it("rejects unknown scope types", async () => {
    await expect(
      setBudget({ scopeType: "team" as never, scopeId: "x", monthlyTokenLimit: 100 }),
    ).rejects.toBeInstanceOf(BudgetValidationError);
  });

  it("rejects negative or non-integer limits", async () => {
    await expect(
      setBudget({ scopeType: "user", scopeId: "u-1", monthlyTokenLimit: -1 }),
    ).rejects.toBeInstanceOf(BudgetValidationError);
    await expect(
      setBudget({ scopeType: "user", scopeId: "u-1", monthlyTokenLimit: 1.5 }),
    ).rejects.toBeInstanceOf(BudgetValidationError);
    await expect(
      setBudget({ scopeType: "user", scopeId: "u-1", monthlyTokenLimit: NaN }),
    ).rejects.toBeInstanceOf(BudgetValidationError);
  });

  it("requires non-empty scopeId for user/ministry scopes", async () => {
    await expect(
      setBudget({ scopeType: "user", scopeId: "  ", monthlyTokenLimit: 100 }),
    ).rejects.toBeInstanceOf(BudgetValidationError);
    await expect(
      setBudget({ scopeType: "ministry", scopeId: "", monthlyTokenLimit: 100 }),
    ).rejects.toBeInstanceOf(BudgetValidationError);
  });

  it("forces scope_id='global' for global scope regardless of input", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: "g-1",
          scope_type: "global",
          scope_id: "global",
          monthly_token_limit: "1000",
          notes: null,
          created_by: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ],
      rowCount: 1,
    });
    await setBudget({ scopeType: "global", scopeId: "main", monthlyTokenLimit: 1000 });
    expect(queryMock.mock.calls[0][1][1]).toBe("global");
  });

  it("upserts and returns the resulting record", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: "id-x",
          scope_type: "user",
          scope_id: "u-9",
          monthly_token_limit: "12345",
          notes: "test",
          created_by: "admin",
          created_at: new Date("2026-05-22T00:00:00Z"),
          updated_at: new Date("2026-05-22T00:00:00Z"),
        },
      ],
      rowCount: 1,
    });
    const out = await setBudget({
      scopeType: "user",
      scopeId: "u-9",
      monthlyTokenLimit: 12345,
      notes: "test",
      createdBy: "admin",
    });
    expect(out.monthlyTokenLimit).toBe(12345);
    expect(out.scopeId).toBe("u-9");
  });
});

describe("deleteBudget", () => {
  it("refuses to delete the global default", async () => {
    await expect(deleteBudget("global", "global")).rejects.toBeInstanceOf(BudgetValidationError);
  });

  it("returns true when a row was deleted", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    expect(await deleteBudget("user", "u-1")).toBe(true);
  });

  it("returns false when no row matched", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    expect(await deleteBudget("ministry", "TBF")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// listMonthlyUsage
// ---------------------------------------------------------------------------

describe("listMonthlyUsage", () => {
  it("returns [] when DB unavailable", async () => {
    envMock.DATABASE_URL = "";
    expect(await listMonthlyUsage()).toEqual([]);
  });

  it("maps rows + computes remaining/exceeded against effective_limit", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          user_id: "u-1",
          user_email: "a@gov.ab.ca",
          user_display_name: "Alice",
          ministry_code: "TBF",
          used: "8000",
          effective_limit: "10000",
          effective_scope: "user",
        },
        {
          user_id: "u-2",
          user_email: "b@gov.ab.ca",
          user_display_name: null,
          ministry_code: "TBF",
          used: "12000",
          effective_limit: "10000",
          effective_scope: "ministry",
        },
        {
          user_id: "u-3",
          user_email: null,
          user_display_name: null,
          ministry_code: null,
          used: "500",
          effective_limit: null,
          effective_scope: null,
        },
      ],
      rowCount: 3,
    });
    const out = await listMonthlyUsage();
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ userId: "u-1", used: 8000, remaining: 2000, exceeded: false });
    expect(out[1]).toMatchObject({ userId: "u-2", used: 12000, remaining: 0, exceeded: true });
    expect(out[2]).toMatchObject({ userId: "u-3", used: 500, remaining: null, exceeded: false });
  });
});

// ---------------------------------------------------------------------------
// recordWorkflowTokens
// ---------------------------------------------------------------------------

describe("recordWorkflowTokens", () => {
  it("no-ops without DB", async () => {
    envMock.DATABASE_URL = "";
    await recordWorkflowTokens("we-1", 100);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("writes the total to workflow_executions", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    await recordWorkflowTokens("we-1", 1234);
    expect(queryMock).toHaveBeenCalledOnce();
    expect(queryMock.mock.calls[0][1]).toEqual([1234, "we-1"]);
  });

  it("rounds fractional totals down", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    await recordWorkflowTokens("we-1", 1234.7);
    expect(queryMock.mock.calls[0][1]).toEqual([1234, "we-1"]);
  });

  it("ignores invalid totals", async () => {
    await recordWorkflowTokens("we-1", -1);
    await recordWorkflowTokens("we-1", NaN);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("swallows DB errors", async () => {
    queryMock.mockRejectedValueOnce(new Error("db gone"));
    await expect(recordWorkflowTokens("we-1", 100)).resolves.toBeUndefined();
  });
});
