/**
 * Unit tests for runWorkflow dry-run mode (Backlog B7).
 *
 * Dry-run mode is meant to walk the real graph and emit the same SSE event
 * sequence as a real run, but with every expensive leaf-level call (LLM,
 * tool, non-branch function) replaced by a deterministic stub. These tests
 * pin the contract:
 *
 *   1. Zero calls to callLLM, dispatchToolCalls, runFunction-for-non-branch.
 *   2. The same SSE shape (workflow_start, stage_start, stage_complete,
 *      workflow_complete) with a `dryRun: true` flag on the bracketing events.
 *   3. Branch functions still actually evaluate (prune behavior preserved).
 *   4. PII scan still fires and can block.
 *   5. Cycle detection still works.
 *   6. Audit log uses WORKFLOW_DRY_RUN, not WORKFLOW_EXECUTED.
 *   7. Template expansion still runs (the stub echoes expanded params).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks (hoisted before imports)
// ---------------------------------------------------------------------------

const queryMock = vi.hoisted(() => vi.fn());
vi.mock("../../config/database.js", () => ({ query: queryMock }));

const callLLMMock = vi.hoisted(() => vi.fn());
const validateModelClassificationMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ valid: true }),
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
  vi.fn().mockReturnValue({ hasPII: false, blockedCount: 0, findings: [] }),
);
vi.mock("../../services/piiDetector.js", () => ({ scanForPII: scanForPIIMock }));

const logAuditMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("../../services/auditLogger.js", () => ({
  logAudit: logAuditMock,
  AuditAction: {
    WORKFLOW_EXECUTED: "workflow.executed",
    WORKFLOW_DRY_RUN: "workflow.dry_run",
  },
}));

vi.mock("../../services/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../config/env.js", () => ({
  env: {
    NODE_ENV: "development",
    DB_SCHEMA: "test",
  },
}));

// ---------------------------------------------------------------------------
// Import under test (after mocks)
// ---------------------------------------------------------------------------

import {
  runWorkflow,
  type WorkflowRecord,
  type CanvasData,
  type ExecutionContext,
} from "../workflowExecutor.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockRes() {
  const frames: string[] = [];
  return {
    write: vi.fn((chunk: string) => {
      frames.push(chunk);
      return true;
    }),
    end: vi.fn(),
    writableEnded: false,
    _frames: frames,
    events(): Record<string, unknown>[] {
      return frames
        .filter((f) => f.startsWith("data:"))
        .map(
          (f) => JSON.parse(f.replace(/^data: /, "").trim()) as Record<string, unknown>,
        );
    },
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
  } as WorkflowRecord;
}

const dryCtx: ExecutionContext = {
  userId: "u-1",
  ministryCode: "INFRA",
  continueOnError: false,
  dryRun: true,
};

beforeEach(() => {
  queryMock.mockReset();
  callLLMMock.mockReset();
  dispatchToolCallsMock.mockReset();
  scanForPIIMock
    .mockReset()
    .mockReturnValue({ hasPII: false, blockedCount: 0, findings: [] });
  logAuditMock.mockReset().mockResolvedValue(undefined);
  validateModelClassificationMock.mockReset().mockResolvedValue({ valid: true });

  queryMock.mockResolvedValue({ rows: [{ id: "exec-1" }], rowCount: 1 });
});

// ---------------------------------------------------------------------------
// Dry-run never calls expensive paths
// ---------------------------------------------------------------------------

describe("runWorkflow dry-run — leaf-level isolation", () => {
  it("does not call callLLM for any agent node", async () => {
    const canvas: CanvasData = {
      version: 1,
      nodes: [
        {
          id: "a1",
          type: "agent",
          position: { x: 0, y: 0 },
          data: {
            kind: "agent",
            label: "Researcher",
            modelId: "claude-sonnet-4-6",
            classification: "unclassified",
            tools: [],
            temperature: 0.7,
            maxTokens: 100,
          },
        },
      ],
      edges: [],
    };

    const res = makeMockRes();
    await runWorkflow(makeWorkflow(canvas), res as never, dryCtx);

    expect(callLLMMock).not.toHaveBeenCalled();
  });

  it("does not call dispatchToolCalls for any tool node", async () => {
    const canvas: CanvasData = {
      version: 1,
      nodes: [
        {
          id: "t1",
          type: "tool",
          position: { x: 0, y: 0 },
          data: {
            kind: "tool",
            label: "Web search",
            toolName: "web_search",
            params: { query: "Alberta budget 2026" },
          },
        },
      ],
      edges: [],
    };

    const res = makeMockRes();
    await runWorkflow(makeWorkflow(canvas), res as never, dryCtx);

    expect(dispatchToolCallsMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// SSE shape parity with real run
// ---------------------------------------------------------------------------

describe("runWorkflow dry-run — SSE shape", () => {
  it("emits workflow_start with dryRun: true", async () => {
    const canvas: CanvasData = {
      version: 1,
      nodes: [
        {
          id: "a1",
          type: "agent",
          position: { x: 0, y: 0 },
          data: {
            kind: "agent",
            label: "A",
            modelId: "claude-sonnet-4-6",
            classification: "unclassified",
            tools: [],
          },
        },
      ],
      edges: [],
    };
    const res = makeMockRes();
    await runWorkflow(makeWorkflow(canvas), res as never, dryCtx);

    const start = res.events().find((e) => e.type === "workflow_start");
    expect(start).toBeDefined();
    expect(start!.dryRun).toBe(true);
  });

  it("emits stage_complete with a stub value carrying the [dry-run] marker for agent stages", async () => {
    const canvas: CanvasData = {
      version: 1,
      nodes: [
        {
          id: "a1",
          type: "agent",
          position: { x: 0, y: 0 },
          data: {
            kind: "agent",
            label: "Researcher",
            modelId: "claude-sonnet-4-6",
            classification: "unclassified",
            tools: [],
          },
        },
      ],
      edges: [],
    };
    const res = makeMockRes();
    await runWorkflow(makeWorkflow(canvas), res as never, dryCtx);

    const complete = res.events().find(
      (e) => e.type === "stage_complete" && e.nodeId === "a1",
    );
    expect(complete).toBeDefined();
    expect(typeof complete!.value).toBe("string");
    expect(String(complete!.value)).toContain("[dry-run]");
    expect(String(complete!.value)).toContain("claude-sonnet-4-6");
    expect(complete!.tokens).toBe(0);
  });

  it("emits stage_complete with __dryRun marker for tool stages, echoing expanded params", async () => {
    const canvas: CanvasData = {
      version: 1,
      nodes: [
        {
          id: "t1",
          type: "tool",
          position: { x: 0, y: 0 },
          data: {
            kind: "tool",
            label: "Web search",
            toolName: "web_search",
            params: { query: "literal" },
          },
        },
      ],
      edges: [],
    };
    const res = makeMockRes();
    await runWorkflow(makeWorkflow(canvas), res as never, dryCtx);

    const complete = res.events().find(
      (e) => e.type === "stage_complete" && e.nodeId === "t1",
    );
    expect(complete).toBeDefined();
    const value = complete!.value as { __dryRun: boolean; toolName: string; params: { query: string } };
    expect(value.__dryRun).toBe(true);
    expect(value.toolName).toBe("web_search");
    expect(value.params.query).toBe("literal");
  });

  it("emits workflow_complete with dryRun: true and status completed", async () => {
    const canvas: CanvasData = {
      version: 1,
      nodes: [
        {
          id: "a1",
          type: "agent",
          position: { x: 0, y: 0 },
          data: {
            kind: "agent",
            label: "A",
            modelId: "claude-sonnet-4-6",
            classification: "unclassified",
            tools: [],
          },
        },
      ],
      edges: [],
    };
    const res = makeMockRes();
    await runWorkflow(makeWorkflow(canvas), res as never, dryCtx);

    const complete = res.events().find((e) => e.type === "workflow_complete");
    expect(complete).toBeDefined();
    expect(complete!.dryRun).toBe(true);
    expect(complete!.status).toBe("completed");
  });
});

// ---------------------------------------------------------------------------
// Branch functions still execute (prune behavior preserved)
// ---------------------------------------------------------------------------

describe("runWorkflow dry-run — branch pruning preserved", () => {
  it("downstream of a branch node is pruned when the branch matches false", async () => {
    // Use the real branch function `equals` (category: "branch" in
    // functionCatalog.json). With no upstream input, asString(undefined) is
    // "" which never equals "must-not-match", so matched=false and the
    // downstream node prunes.
    const canvas: CanvasData = {
      version: 1,
      nodes: [
        {
          id: "b1",
          type: "function",
          position: { x: 0, y: 0 },
          data: {
            kind: "function",
            label: "Always false",
            fnName: "equals",
            params: { value: "must-not-match" },
          },
        },
        {
          id: "after",
          type: "agent",
          position: { x: 0, y: 0 },
          data: {
            kind: "agent",
            label: "Pruned",
            modelId: "claude-sonnet-4-6",
            classification: "unclassified",
            tools: [],
          },
        },
      ],
      edges: [{ id: "e1", source: "b1", target: "after" }],
    };
    const res = makeMockRes();
    await runWorkflow(makeWorkflow(canvas), res as never, dryCtx);

    // The branch stage itself completes (real evaluation, not a stub)
    const branchComplete = res.events().find(
      (e) => e.type === "stage_complete" && e.nodeId === "b1",
    );
    expect(branchComplete).toBeDefined();
    expect(branchComplete!.value).toMatchObject({ matched: false });

    // The downstream node is pruned, not stub-executed
    const pruned = res.events().find(
      (e) => e.type === "stage_skipped" && e.nodeId === "after",
    );
    expect(pruned).toBeDefined();
    expect(pruned!.reason).toBe("pruned");
    // And no stage_complete should have fired for it
    const afterComplete = res.events().find(
      (e) => e.type === "stage_complete" && e.nodeId === "after",
    );
    expect(afterComplete).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// PII still blocks
// ---------------------------------------------------------------------------

describe("runWorkflow dry-run — PII scan still applies", () => {
  it("PII scan on the system prompt still blocks the agent stage in dry-run", async () => {
    // First call: scanForPII on the full canvas (route-level, not invoked here).
    // We're invoking runWorkflow directly so the only scanForPII calls are the
    // per-agent-stage outbound scans inside dryRunAgentStage.
    scanForPIIMock.mockReturnValue({
      hasPII: true,
      blockedCount: 1,
      findings: [{ kind: "sin", value: "123" }],
    });

    const canvas: CanvasData = {
      version: 1,
      nodes: [
        {
          id: "a1",
          type: "agent",
          position: { x: 0, y: 0 },
          data: {
            kind: "agent",
            label: "Leaky",
            modelId: "claude-sonnet-4-6",
            classification: "unclassified",
            tools: [],
          },
        },
      ],
      edges: [],
    };
    const res = makeMockRes();
    await runWorkflow(makeWorkflow(canvas), res as never, dryCtx);

    const stageError = res.events().find(
      (e) => e.type === "stage_error" && e.nodeId === "a1",
    );
    expect(stageError).toBeDefined();
    expect(String(stageError!.error)).toMatch(/PII/i);
  });
});

// ---------------------------------------------------------------------------
// Cycles still error
// ---------------------------------------------------------------------------

describe("runWorkflow dry-run — cycle detection still applies", () => {
  it("emits cycle error event when canvas has a cycle, even in dry-run", async () => {
    const canvas: CanvasData = {
      version: 1,
      nodes: [
        {
          id: "a",
          type: "function",
          position: { x: 0, y: 0 },
          data: { kind: "function", label: "A", fnName: "to_upper", params: {} },
        },
        {
          id: "b",
          type: "function",
          position: { x: 0, y: 0 },
          data: { kind: "function", label: "B", fnName: "to_lower", params: {} },
        },
      ],
      edges: [
        { id: "e1", source: "a", target: "b" },
        { id: "e2", source: "b", target: "a" },
      ],
    };
    const res = makeMockRes();
    await runWorkflow(makeWorkflow(canvas), res as never, dryCtx);

    const err = res.events().find((e) => e.type === "error");
    expect(err).toBeDefined();
    expect(String(err!.code)).toBe("cycle");
  });
});

// ---------------------------------------------------------------------------
// Audit log distinguishes dry-run
// ---------------------------------------------------------------------------

describe("runWorkflow dry-run — audit log", () => {
  it("logs WORKFLOW_DRY_RUN action, not WORKFLOW_EXECUTED", async () => {
    const canvas: CanvasData = {
      version: 1,
      nodes: [
        {
          id: "n1",
          type: "function",
          position: { x: 0, y: 0 },
          data: { kind: "function", label: "Upper", fnName: "to_upper", params: {} },
        },
      ],
      edges: [],
    };
    const res = makeMockRes();
    await runWorkflow(makeWorkflow(canvas), res as never, dryCtx);

    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "workflow.dry_run",
        details: expect.objectContaining({ dryRun: true }),
      }),
    );
  });

  it("real run still logs WORKFLOW_EXECUTED", async () => {
    const canvas: CanvasData = {
      version: 1,
      nodes: [
        {
          id: "n1",
          type: "function",
          position: { x: 0, y: 0 },
          data: { kind: "function", label: "Upper", fnName: "to_upper", params: {} },
        },
      ],
      edges: [],
    };
    const res = makeMockRes();
    await runWorkflow(makeWorkflow(canvas), res as never, {
      userId: "u-1",
      ministryCode: "INFRA",
      continueOnError: false,
    });

    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "workflow.executed",
        details: expect.objectContaining({ dryRun: false }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Template expansion is exercised
// ---------------------------------------------------------------------------

describe("runWorkflow dry-run — template expansion", () => {
  it("expands ${upstream} references in tool params before stubbing", async () => {
    const canvas: CanvasData = {
      version: 1,
      nodes: [
        {
          id: "src",
          type: "function",
          position: { x: 0, y: 0 },
          // Real to_upper function evaluated even in dry-run for non-branch?
          // No — non-branch functions are stubbed too. Use a value that is
          // visible in the stub output via __dryRun.params.
          data: { kind: "function", label: "Upper", fnName: "to_upper", params: {} },
        },
        {
          id: "sink",
          type: "tool",
          position: { x: 0, y: 0 },
          data: {
            kind: "tool",
            label: "Sink",
            toolName: "web_search",
            params: { query: "from ${src}" },
          },
        },
      ],
      edges: [{ id: "e1", source: "src", target: "sink" }],
    };
    const res = makeMockRes();
    await runWorkflow(makeWorkflow(canvas), res as never, dryCtx);

    const sinkComplete = res.events().find(
      (e) => e.type === "stage_complete" && e.nodeId === "sink",
    );
    expect(sinkComplete).toBeDefined();
    const value = sinkComplete!.value as {
      __dryRun: boolean;
      params: { query: string };
    };
    // Template expansion happened — the substituted ${src} contains "from "
    // followed by the JSON-encoded upstream stub value.
    expect(value.params.query.startsWith("from ")).toBe(true);
    expect(value.params.query).not.toBe("from ${src}");
  });
});
