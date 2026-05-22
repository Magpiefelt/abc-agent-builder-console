/**
 * workflowExecutor — token-budget enforcement integration tests.
 *
 * Mocks `budgetGuard.checkBudget` so we can simulate over/under-cap states
 * without DB fixtures. Verifies that an agent stage:
 *   - emits `stage_error` + `budget_exceeded` + audits when over the cap
 *   - hard-stops the workflow (ignores continueOnError) on a budget hit
 *   - proceeds normally when under the cap
 *   - calls `recordWorkflowTokens` once at the end with the total
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());
vi.mock("../../config/database.js", () => ({ query: queryMock }));

const callLLMMock = vi.hoisted(() => vi.fn());
const validateModelClassificationMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ valid: true })
);
vi.mock("../../services/llmProvider.js", () => ({
  callLLM: callLLMMock,
  validateModelClassification: validateModelClassificationMock,
}));

const dispatchToolCallsMock = vi.hoisted(() => vi.fn());
vi.mock("../../services/toolDispatcher.js", () => ({
  dispatchToolCalls: dispatchToolCallsMock,
}));

const scanForPIIMock = vi.hoisted(() =>
  vi.fn().mockReturnValue({ blockedCount: 0, detections: [] })
);
vi.mock("../../services/piiDetector.js", () => ({ scanForPII: scanForPIIMock }));

const logAuditMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("../../services/auditLogger.js", () => ({
  logAudit: logAuditMock,
  AuditAction: {
    WORKFLOW_EXECUTED: "workflow.executed",
    WORKFLOW_DRY_RUN: "workflow.dry_run",
    BUDGET_EXCEEDED: "security.budget_exceeded",
  },
}));

vi.mock("../../services/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../config/env.js", () => ({
  env: { NODE_ENV: "development", DB_SCHEMA: "test" },
}));

// Mock M (metrics) so its inc/observe calls don't blow up.
vi.mock("../../services/metrics.js", () => ({
  M: {
    workflowStages: { inc: vi.fn() },
    workflowExecutions: { inc: vi.fn() },
    workflowDuration: { observe: vi.fn() },
  },
}));

const checkBudgetMock = vi.hoisted(() => vi.fn());
const recordWorkflowTokensMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("../budgetGuard.js", () => ({
  checkBudget: checkBudgetMock,
  recordWorkflowTokens: recordWorkflowTokensMock,
}));

// Mock agentTemplates JSON read — readFileSync resolves the data file at import time.
// We can't easily intercept the JSON in this test, but the default templates file
// exists in the repo so the import succeeds. The test agent node uses
// systemPromptOverride to avoid template lookup anyway.

import {
  runWorkflow,
  type WorkflowRecord,
  type CanvasData,
  type ExecutionContext,
} from "../workflowExecutor.js";

function makeMockRes() {
  const frames: string[] = [];
  return {
    write: vi.fn((chunk: string) => { frames.push(chunk); return true; }),
    end: vi.fn(),
    writableEnded: false,
    _frames: frames,
    events(): Record<string, unknown>[] {
      return frames
        .filter((f) => f.startsWith("data:"))
        .map((f) => JSON.parse(f.replace(/^data: /, "").trim()) as Record<string, unknown>);
    },
  };
}

function singleAgentCanvas(): CanvasData {
  return {
    version: 1,
    nodes: [
      {
        id: "agent-1",
        type: "agent",
        position: { x: 0, y: 0 },
        data: {
          kind: "agent",
          label: "Solo Agent",
          systemPromptOverride: "You are a helpful assistant.",
          modelId: "mock-llm",
          classification: "unclassified",
          tools: [],
        },
      },
    ],
    edges: [],
  };
}

function makeWorkflow(canvas: CanvasData): WorkflowRecord {
  return {
    id: "wf-1",
    user_id: "u-1",
    ministry_code: "INFRA",
    name: "Test Workflow",
    classification: "unclassified",
    canvas_data: canvas,
    version: 1,
  } as unknown as WorkflowRecord;
}

const ctx: ExecutionContext = {
  userId: "u-1",
  ministryCode: "INFRA",
  continueOnError: false,
};

const UNDER_BUDGET = {
  userId: "u-1",
  ministryCode: "INFRA",
  effective: { resolvedScope: "global" as const, budgetId: "g-1", monthlyTokenLimit: 1_000_000, notes: null },
  used: 5000,
  remaining: 995_000,
  exceeded: false,
  enforced: true,
  period: { start: "2026-05-01T00:00:00.000Z", end: "2026-06-01T00:00:00.000Z" },
};

const OVER_BUDGET = {
  userId: "u-1",
  ministryCode: "INFRA",
  effective: { resolvedScope: "user" as const, budgetId: "b-1", monthlyTokenLimit: 100, notes: null },
  used: 200,
  remaining: 0,
  exceeded: true,
  enforced: true,
  period: { start: "2026-05-01T00:00:00.000Z", end: "2026-06-01T00:00:00.000Z" },
};

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [{ id: "exec-1" }], rowCount: 1 });
  callLLMMock.mockReset();
  callLLMMock.mockResolvedValue({
    content: "agent output",
    toolCalls: [],
    usage: { promptTokens: 50, completionTokens: 25, totalTokens: 75 },
    finishReason: "end_turn",
    latencyMs: 10,
  });
  dispatchToolCallsMock.mockReset();
  scanForPIIMock.mockReset().mockReturnValue({ blockedCount: 0, detections: [] });
  logAuditMock.mockReset().mockResolvedValue(undefined);
  validateModelClassificationMock.mockReset().mockResolvedValue({ valid: true });
  checkBudgetMock.mockReset();
  recordWorkflowTokensMock.mockReset().mockResolvedValue(undefined);
});

describe("workflowExecutor — budget enforcement", () => {
  it("hard-stops on budget_exceeded for an agent stage, ignoring continueOnError", async () => {
    checkBudgetMock.mockResolvedValue(OVER_BUDGET);

    const res = makeMockRes();
    await runWorkflow(
      makeWorkflow(singleAgentCanvas()),
      res as never,
      { ...ctx, continueOnError: true }, // even with continueOnError, budget = hard stop
    );

    const events = res.events();
    const types = events.map((e) => e.type);

    expect(types).toContain("stage_error");
    expect(types).toContain("budget_exceeded");
    expect(types).toContain("workflow_complete");

    const stageErr = events.find((e) => e.type === "stage_error")!;
    expect(stageErr.errorCode).toBe("budget_exceeded");
    expect(stageErr.error).toMatch(/budget exceeded/i);

    const wfComplete = events.find((e) => e.type === "workflow_complete")!;
    expect(wfComplete.status).toBe("error");

    // callLLM must NOT have been invoked.
    expect(callLLMMock).not.toHaveBeenCalled();

    // Audit: BUDGET_EXCEEDED row for the workflow_execution.
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "security.budget_exceeded",
        resourceType: "workflow_execution",
      }),
    );
  });

  it("proceeds normally when under budget and tallies tokens at the end", async () => {
    checkBudgetMock.mockResolvedValue(UNDER_BUDGET);

    const res = makeMockRes();
    await runWorkflow(makeWorkflow(singleAgentCanvas()), res as never, ctx);

    const types = res.events().map((e) => e.type);
    expect(types).toContain("stage_complete");
    expect(types).toContain("workflow_complete");
    expect(types).not.toContain("budget_exceeded");

    // callLLM ran.
    expect(callLLMMock).toHaveBeenCalledOnce();

    // recordWorkflowTokens was called with the totalled token count (75 from
    // the mock LLM response).
    expect(recordWorkflowTokensMock).toHaveBeenCalledTimes(1);
    expect(recordWorkflowTokensMock).toHaveBeenCalledWith("exec-1", 75);
  });

  it("does not record tokens on a dry-run", async () => {
    checkBudgetMock.mockResolvedValue(UNDER_BUDGET);

    const res = makeMockRes();
    await runWorkflow(
      makeWorkflow(singleAgentCanvas()),
      res as never,
      { ...ctx, dryRun: true },
    );

    // Dry-run still emits workflow_complete + stage_complete (with a stub
    // value) but the budget pre-flight is skipped because dry-runs don't go
    // through executeAgentStage. checkBudget should NOT have been called.
    expect(checkBudgetMock).not.toHaveBeenCalled();
    expect(recordWorkflowTokensMock).not.toHaveBeenCalled();
  });
});
