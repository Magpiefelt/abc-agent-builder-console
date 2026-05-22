/**
 * Unit tests for the workflowExecutor service.
 *
 * runWorkflow accepts a WorkflowRecord, an Express Response (mock), and an
 * ExecutionContext. All DB, LLM, tool, and PII dependencies are mocked so
 * tests run without any live infrastructure.
 *
 * Strategy:
 *  - The SSE response is captured via a mock `res.write` that collects the
 *    raw `data: …\n\n` frames; helpers parse them back to objects.
 *  - Tests focus on the high-value control paths: canvas validation, cycle
 *    detection, function-node execution, abort-before-start, and workflow_complete
 *    status propagation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks (hoisted before imports)
// ---------------------------------------------------------------------------

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
  vi.fn().mockResolvedValue({ hasPII: false, findings: [] })
);
vi.mock("../../services/piiDetector.js", () => ({ scanForPII: scanForPIIMock }));

const logAuditMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("../../services/auditLogger.js", () => ({
  logAudit: logAuditMock,
  AuditAction: {
    WORKFLOW_EXECUTED: "workflow.executed",
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
  abortExecution,
  isExecutionRunning,
  type WorkflowRecord,
  type CanvasData,
  type ExecutionContext,
} from "../workflowExecutor.js";
import { AuditAction } from "../auditLogger.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Collect SSE frames written to a mock Response. */
function makeMockRes() {
  const frames: string[] = [];
  return {
    write: vi.fn((chunk: string) => { frames.push(chunk); return true; }),
    end: vi.fn(),
    writableEnded: false,
    _frames: frames,
    /** Parse all `data: {...}\n\n` frames into objects. */
    events(): Record<string, unknown>[] {
      return frames
        .filter((f) => f.startsWith("data:"))
        .map((f) => JSON.parse(f.replace(/^data: /, "").trim()) as Record<string, unknown>);
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
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
  } as unknown as WorkflowRecord;
}

const ctx: ExecutionContext = {
  userId: "u-1",
  ministryCode: "INFRA",
  continueOnError: false,
};

function emptyCanvas(): CanvasData {
  return { nodes: [], edges: [], version: 1 };
}

function singleFunctionCanvas(fnName = "to_upper"): CanvasData {
  return {
    version: 1,
    nodes: [
      {
        id: "n1",
        type: "function",
        position: { x: 0, y: 0 },
        data: {
          kind: "function",
          label: "Uppercase",
          fnName,
          params: {},
        },
      },
    ],
    edges: [],
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  queryMock.mockReset();
  callLLMMock.mockReset();
  dispatchToolCallsMock.mockReset();
  scanForPIIMock.mockReset().mockResolvedValue({ hasPII: false, findings: [] });
  logAuditMock.mockReset().mockResolvedValue(undefined);
  validateModelClassificationMock.mockReset().mockResolvedValue({ valid: true });

  // Default DB mocks for createExecutionRow and completeExecutionRow
  queryMock.mockResolvedValue({ rows: [{ id: "exec-1" }], rowCount: 1 });
});

// ---------------------------------------------------------------------------
// abortExecution / isExecutionRunning (pure state management)
// ---------------------------------------------------------------------------

describe("abortExecution / isExecutionRunning", () => {
  it("isExecutionRunning returns false for unknown ids", () => {
    expect(isExecutionRunning("no-such-id")).toBe(false);
  });

  it("abortExecution is safe to call on unknown ids", () => {
    expect(() => abortExecution("no-such-id")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// runWorkflow — canvas validation errors
// ---------------------------------------------------------------------------

describe("runWorkflow — canvas validation", () => {
  it("sends error SSE and ends response when canvas_data is absent", async () => {
    const res = makeMockRes();
    const wf = makeWorkflow(null as unknown as CanvasData);
    (wf as unknown as Record<string, unknown>).canvas_data = null;

    await runWorkflow(wf, res as never, ctx);

    const errEvent = res.events().find((e) => e.type === "error") as Record<string, unknown>;
    expect(errEvent).toBeDefined();
    expect(String(errEvent.error)).toMatch(/no canvas/i);
    expect(res.end).toHaveBeenCalled();
  });

  it("sends error SSE when canvas version is not 1", async () => {
    const res = makeMockRes();
    const canvas = { ...emptyCanvas(), version: 99 } as unknown as CanvasData;
    const wf = makeWorkflow(canvas);

    await runWorkflow(wf, res as never, ctx);

    const errEvent = res.events().find((e) => e.type === "error");
    expect(errEvent).toBeDefined();
    expect(String(errEvent!.code)).toBe("version");
  });

  it("sends error SSE when nodes is not an array", async () => {
    const res = makeMockRes();
    const canvas = { version: 1, nodes: null, edges: [] } as unknown as CanvasData;
    const wf = makeWorkflow(canvas);

    await runWorkflow(wf, res as never, ctx);

    const errEvent = res.events().find((e) => e.type === "error");
    expect(errEvent).toBeDefined();
    expect(String(errEvent!.code)).toBe("malformed");
  });

  it("sends error SSE when canvas is empty (no nodes)", async () => {
    const res = makeMockRes();
    const wf = makeWorkflow(emptyCanvas());

    await runWorkflow(wf, res as never, ctx);

    const errEvent = res.events().find((e) => e.type === "error");
    expect(errEvent).toBeDefined();
    expect(String(errEvent!.code)).toBe("empty");
  });

  it("sends cycle error SSE when canvas has a cycle", async () => {
    const res = makeMockRes();
    const canvas: CanvasData = {
      version: 1,
      nodes: [
        { id: "a", type: "function", position: { x: 0, y: 0 }, data: { kind: "function", label: "A", fnName: "to_upper", params: {} } },
        { id: "b", type: "function", position: { x: 0, y: 0 }, data: { kind: "function", label: "B", fnName: "to_lower", params: {} } },
      ],
      edges: [
        { id: "e1", source: "a", target: "b" },
        { id: "e2", source: "b", target: "a" }, // creates a cycle
      ],
    };

    await runWorkflow(makeWorkflow(canvas), res as never, ctx);

    const errEvent = res.events().find((e) => e.type === "error");
    expect(errEvent).toBeDefined();
    expect(String(errEvent!.code)).toBe("cycle");
  });
});

// ---------------------------------------------------------------------------
// runWorkflow — DB failure creating execution row
// ---------------------------------------------------------------------------

describe("runWorkflow — DB failure", () => {
  it("sends error SSE and ends response when createExecutionRow throws", async () => {
    // First query call is INSERT INTO workflow_executions
    queryMock.mockRejectedValueOnce(new Error("DB unavailable"));

    const res = makeMockRes();
    await runWorkflow(makeWorkflow(singleFunctionCanvas()), res as never, ctx);

    const errEvent = res.events().find((e) => e.type === "error");
    expect(errEvent).toBeDefined();
    expect(res.end).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// runWorkflow — single function node
// ---------------------------------------------------------------------------

describe("runWorkflow — single function node", () => {
  it("emits workflow_start, stage_start, stage_complete, workflow_complete", async () => {
    const res = makeMockRes();
    await runWorkflow(makeWorkflow(singleFunctionCanvas("to_upper")), res as never, ctx);

    const events = res.events();
    expect(events.some((e) => e.type === "workflow_start")).toBe(true);
    expect(events.some((e) => e.type === "stage_start")).toBe(true);
    expect(events.some((e) => e.type === "stage_complete")).toBe(true);
    expect(events.some((e) => e.type === "workflow_complete")).toBe(true);
  });

  it("workflow_complete status is 'completed' when all stages succeed", async () => {
    const res = makeMockRes();
    await runWorkflow(makeWorkflow(singleFunctionCanvas()), res as never, ctx);

    const complete = res.events().find((e) => e.type === "workflow_complete");
    expect(complete?.status).toBe("completed");
  });

  it("calls logAudit with WORKFLOW_EXECUTED", async () => {
    const res = makeMockRes();
    await runWorkflow(makeWorkflow(singleFunctionCanvas()), res as never, ctx);

    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditAction.WORKFLOW_EXECUTED })
    );
  });
});

// ---------------------------------------------------------------------------
// runWorkflow — two sequential function nodes
// ---------------------------------------------------------------------------

describe("runWorkflow — two sequential function nodes (chain)", () => {
  it("emits two stage_complete events in topo order", async () => {
    const canvas: CanvasData = {
      version: 1,
      nodes: [
        { id: "n1", type: "function", position: { x: 0, y: 0 }, data: { kind: "function", label: "Upper", fnName: "to_upper", params: {} } },
        { id: "n2", type: "function", position: { x: 0, y: 0 }, data: { kind: "function", label: "Lower", fnName: "to_lower", params: {} } },
      ],
      edges: [{ id: "e1", source: "n1", target: "n2" }],
    };

    const res = makeMockRes();
    await runWorkflow(makeWorkflow(canvas), res as never, ctx);

    const completes = res.events().filter((e) => e.type === "stage_complete");
    expect(completes).toHaveLength(2);
    // First node in topo order is n1
    expect(completes[0].nodeId).toBe("n1");
    expect(completes[1].nodeId).toBe("n2");
  });
});

// ---------------------------------------------------------------------------
// runWorkflow — note nodes are skipped
// ---------------------------------------------------------------------------

describe("runWorkflow — note nodes", () => {
  it("emits stage_skipped for note nodes and still runs other nodes", async () => {
    const canvas: CanvasData = {
      version: 1,
      nodes: [
        {
          id: "note1",
          type: "note",
          position: { x: 0, y: 0 },
          data: { kind: "note", label: "Info", markdown: "A note" },
        },
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
    await runWorkflow(makeWorkflow(canvas), res as never, ctx);

    const skipped = res.events().filter((e) => e.type === "stage_skipped");
    expect(skipped.some((e) => e.nodeId === "note1")).toBe(true);
    const complete = res.events().find((e) => e.type === "workflow_complete");
    expect(complete?.status).toBe("completed");
  });
});

// ---------------------------------------------------------------------------
// runWorkflow — continueOnError = false stops on first error
// ---------------------------------------------------------------------------

describe("runWorkflow — stage error halts execution", () => {
  it("stops after first error and workflow_complete has status error", async () => {
    const canvas: CanvasData = {
      version: 1,
      nodes: [
        // 'does_not_exist' will throw "Unknown function" from functionRegistry
        { id: "n1", type: "function", position: { x: 0, y: 0 }, data: { kind: "function", label: "Bad", fnName: "does_not_exist", params: {} } },
        { id: "n2", type: "function", position: { x: 0, y: 0 }, data: { kind: "function", label: "Upper", fnName: "to_upper", params: {} } },
      ],
      edges: [{ id: "e1", source: "n1", target: "n2" }],
    };

    const res = makeMockRes();
    await runWorkflow(makeWorkflow(canvas), res as never, { ...ctx, continueOnError: false });

    const complete = res.events().find((e) => e.type === "workflow_complete");
    expect(complete?.status).toBe("error");
    // n2 should NOT have a stage_complete event
    const stageCompletes = res.events().filter((e) => e.type === "stage_complete");
    expect(stageCompletes.every((e) => e.nodeId !== "n2")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// runWorkflow — continueOnError = true processes all stages
// ---------------------------------------------------------------------------

describe("runWorkflow — continueOnError = true", () => {
  it("processes all stages and still reports error status if any stage failed", async () => {
    const canvas: CanvasData = {
      version: 1,
      nodes: [
        { id: "n1", type: "function", position: { x: 0, y: 0 }, data: { kind: "function", label: "Bad", fnName: "does_not_exist", params: {} } },
        { id: "n2", type: "function", position: { x: 0, y: 0 }, data: { kind: "function", label: "Upper", fnName: "to_upper", params: {} } },
      ],
      edges: [], // No edges — both nodes run independently
    };

    const res = makeMockRes();
    await runWorkflow(makeWorkflow(canvas), res as never, { ...ctx, continueOnError: true });

    // Both stage_start events should appear
    const starts = res.events().filter((e) => e.type === "stage_start");
    expect(starts).toHaveLength(2);
    // n2 should have stage_complete since it doesn't error
    const n2Complete = res.events().find((e) => e.type === "stage_complete" && e.nodeId === "n2");
    expect(n2Complete).toBeDefined();
    // Overall status should still be error
    const complete = res.events().find((e) => e.type === "workflow_complete");
    expect(complete?.status).toBe("error");
  });
});

// ---------------------------------------------------------------------------
// runWorkflow — classification validation failure
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// runWorkflow — parallel layer execution
// ---------------------------------------------------------------------------

describe("runWorkflow — parallel layer execution", () => {
  it("emits stage_start for every independent sibling before any stage_complete", async () => {
    // Three roots with no edges should all enter the running state together.
    const canvas: CanvasData = {
      version: 1,
      nodes: [
        { id: "p1", type: "function", position: { x: 0, y: 0 }, data: { kind: "function", label: "A", fnName: "to_upper", params: {} } },
        { id: "p2", type: "function", position: { x: 0, y: 0 }, data: { kind: "function", label: "B", fnName: "to_upper", params: {} } },
        { id: "p3", type: "function", position: { x: 0, y: 0 }, data: { kind: "function", label: "C", fnName: "to_upper", params: {} } },
      ],
      edges: [],
    };

    const res = makeMockRes();
    await runWorkflow(makeWorkflow(canvas), res as never, ctx);

    const events = res.events();
    // The first three "stage_*" events must be stage_starts (not interleaved with completes).
    const stageEvents = events.filter((e) => e.type === "stage_start" || e.type === "stage_complete");
    expect(stageEvents.slice(0, 3).every((e) => e.type === "stage_start")).toBe(true);
    // And we should see exactly three of each.
    expect(stageEvents.filter((e) => e.type === "stage_start")).toHaveLength(3);
    expect(stageEvents.filter((e) => e.type === "stage_complete")).toHaveLength(3);
  });

  it("runs siblings concurrently and dependents wait for the prior layer", async () => {
    // Diamond: a → (b1, b2) → c
    // b1 and b2 should run together, finishing before c starts.
    let activeFnCalls = 0;
    let maxConcurrent = 0;
    callLLMMock.mockImplementation(async () => {
      activeFnCalls++;
      maxConcurrent = Math.max(maxConcurrent, activeFnCalls);
      await new Promise((r) => setTimeout(r, 10));
      activeFnCalls--;
      return { content: "ok", usage: { totalTokens: 5 } };
    });

    const agentNode = (id: string) => ({
      id,
      type: "agent" as const,
      position: { x: 0, y: 0 },
      data: {
        kind: "agent" as const,
        label: id,
        modelId: "claude-sonnet-4-6",
        classification: "unclassified" as const,
        tools: [],
        temperature: 0.7,
        maxTokens: 100,
      },
    });
    const canvas: CanvasData = {
      version: 1,
      nodes: [agentNode("a"), agentNode("b1"), agentNode("b2"), agentNode("c")],
      edges: [
        { id: "e1", source: "a", target: "b1" },
        { id: "e2", source: "a", target: "b2" },
        { id: "e3", source: "b1", target: "c" },
        { id: "e4", source: "b2", target: "c" },
      ],
    };

    const res = makeMockRes();
    await runWorkflow(makeWorkflow(canvas), res as never, ctx);

    // b1 and b2 ran in the same layer, so the executor should have launched
    // them concurrently.
    expect(maxConcurrent).toBeGreaterThanOrEqual(2);

    // All four stages completed.
    const completes = res.events().filter((e) => e.type === "stage_complete");
    expect(completes).toHaveLength(4);
    // c is the last to complete (depends on b1 and b2).
    expect(completes[completes.length - 1].nodeId).toBe("c");
  });
});

describe("runWorkflow — classification validation", () => {
  it("sends classification error SSE when model is not allowed for workflow classification", async () => {
    validateModelClassificationMock.mockResolvedValueOnce({
      valid: false,
      reason: "model not rated for Protected B",
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
            label: "Agent",
            modelId: "claude-haiku-4-5",
            classification: "protected_b",
            tools: [],
            temperature: 0.7,
            maxTokens: 1000,
          },
        },
      ],
      edges: [],
    };

    const wf = makeWorkflow(canvas);
    wf.classification = "protected_b";
    const res = makeMockRes();

    await runWorkflow(wf, res as never, ctx);

    const errEvent = res.events().find((e) => e.type === "error");
    expect(errEvent).toBeDefined();
    expect(String(errEvent!.code)).toBe("classification");
    expect(res.end).toHaveBeenCalled();
  });
});
