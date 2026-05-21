/**
 * Orchestrator unit tests.
 *
 * The orchestrator is the most complex service — it ties together LLM provider,
 * loop detector, tool dispatcher, audit, DB, and SSE streaming. These tests
 * focus on the iteration loop's behavior in isolation: happy path, abort,
 * interjection, repeated LLM failures.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import type { Response } from "express";

const queryMock = vi.hoisted(() => vi.fn());
vi.mock("../../config/database.js", () => ({
  query: queryMock,
}));

import {
  runOrchestrator,
  createSession,
  stopSession,
  interjectSession,
  isSessionRunning,
} from "../agentOrchestrator.js";
import type { AgentSession } from "../agentOrchestrator.js";
import { registerMockResponses, clearMockResponses } from "../../../test/helpers/mockLLM.js";
import { clearModelCache } from "../llmProvider.js";

/**
 * Fake Express Response that captures SSE writes into an event stream.
 * The orchestrator only calls res.write(), res.flushHeaders(), res.end(), and
 * checks res.writableEnded.
 */
class FakeRes extends EventEmitter {
  public chunks: string[] = [];
  public ended = false;
  public statusCode = 200;
  public headers: Record<string, unknown> = {};

  // The orchestrator reads writableEnded.
  get writableEnded(): boolean {
    return this.ended;
  }

  write(chunk: string): boolean {
    if (!this.ended) this.chunks.push(chunk);
    return true;
  }

  end(): this {
    this.ended = true;
    this.emit("close");
    return this;
  }

  flushHeaders(): this {
    return this;
  }

  setHeader(k: string, v: unknown): this {
    this.headers[k] = v;
    return this;
  }

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  json(body: unknown): this {
    this.chunks.push(JSON.stringify(body));
    return this;
  }

  /** Parse SSE events out of the chunk buffer. */
  events(): Array<Record<string, unknown>> {
    const out: Array<Record<string, unknown>> = [];
    const joined = this.chunks.join("");
    for (const line of joined.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      try {
        out.push(JSON.parse(line.slice(6).trim()));
      } catch { /* skip */ }
    }
    return out;
  }
}

const MOCK_MODEL_ROW = {
  id: 99,
  model_id: "mock-llm",
  display_name: "Mock LLM",
  provider: "anthropic",
  api_model_name: "mock-model",
  max_output_tokens: 8192,
  supports_streaming: true,
  supports_tools: true,
  data_residency: "canada",
  max_classification: "protected_b",
  is_active: true,
};

function freshSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: overrides.id || "sess-test-1",
    userId: "user-1",
    ministryCode: "INFRA",
    prompt: "Find the population of Edmonton.",
    modelId: "mock-llm",
    maxIterations: 3,
    currentIteration: 0,
    status: "idle",
    classification: "unclassified",
    blackboard: [],
    scratchpad: "",
    attributes: {},
    finalReport: null,
    error: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  queryMock.mockReset();
  // Default: every query (update_session, record_iteration, model registry) resolves.
  queryMock.mockResolvedValue({ rows: [MOCK_MODEL_ROW] });
  clearMockResponses();
  clearModelCache();
});

afterEach(() => {
  // Best-effort: ensure no leftover active session.
  stopSession("sess-test-1");
  stopSession("sess-test-2");
  stopSession("sess-test-3");
});

describe("orchestrator — happy path", () => {
  it("runs a one-iteration session that immediately completes", async () => {
    registerMockResponses("sess-test-1", [
      {
        thinking: "Edmonton has approximately 1 million people.",
        blackboardUpdates: [{ category: "research", title: "Edmonton population", content: "approximately 1M" }],
        status: "completed",
        userMessage: "Done.",
      },
    ]);

    const res = new FakeRes();
    const session = freshSession({ id: "sess-test-1" });

    await runOrchestrator(session, res as unknown as Response);

    const events = res.events();
    const types = events.map((e) => e.type);

    // Subsequence: session_start → iteration_start → llm_response → blackboard_update → iteration_complete → session_complete
    expect(types).toContain("session_start");
    expect(types).toContain("iteration_start");
    expect(types).toContain("llm_response");
    expect(types).toContain("blackboard_update");
    expect(types).toContain("iteration_complete");
    expect(types).toContain("session_complete");

    // Subsequence ordering check
    const positions = ["session_start", "iteration_start", "llm_response", "iteration_complete", "session_complete"]
      .map((t) => types.indexOf(t));
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }

    // Final state
    expect(session.status).toBe("completed");
    expect(session.currentIteration).toBe(1);
    expect(session.blackboard).toHaveLength(1);
    expect(session.finalReport).toBeTruthy();
  });

  it("respects maxIterations and ends with iteration_limit", async () => {
    // Register N responses that all say "running" so the loop runs to completion.
    registerMockResponses("sess-test-2", Array.from({ length: 5 }, (_, i) => ({
      thinking: `step ${i}`,
      blackboardUpdates: [{ category: "step", title: `t${i}`, content: `c${i}` }],
      status: "running",
    })));

    const res = new FakeRes();
    const session = freshSession({ id: "sess-test-2", maxIterations: 2 });

    await runOrchestrator(session, res as unknown as Response);

    const types = res.events().map((e) => e.type);
    expect(types).toContain("iteration_limit");
    expect(types).toContain("session_complete");
    expect(session.status).toBe("completed");
    expect(session.currentIteration).toBe(2);
  });
});

describe("orchestrator — abort", () => {
  it("stops cleanly when stopSession is called between iterations", async () => {
    registerMockResponses("sess-test-1", [
      { thinking: "iter 1", blackboardUpdates: [{ category: "r", title: "a", content: "x" }], status: "running" },
      { thinking: "iter 2 — should not run", status: "running" },
    ]);

    const res = new FakeRes();
    const session = freshSession({ id: "sess-test-1", maxIterations: 5 });

    // Stop the session before the loop even starts. The orchestrator schedules the abort
    // check at the top of every iteration, so it will run 0 iterations before bailing.
    const runPromise = runOrchestrator(session, res as unknown as Response);
    stopSession("sess-test-1");
    await runPromise;

    const types = res.events().map((e) => e.type);
    expect(types).toContain("session_complete");
    expect(session.status === "paused" || session.status === "completed").toBe(true);
  });
});

describe("orchestrator — interjection", () => {
  it("injects user guidance into the next iteration", async () => {
    registerMockResponses("sess-test-1", [
      {
        thinking: "first iteration thinking",
        blackboardUpdates: [{ category: "r", title: "t", content: "c" }],
        status: "running",
      },
      {
        thinking: "second iteration thinking after interjection",
        blackboardUpdates: [{ category: "r", title: "t2", content: "c2" }],
        status: "completed",
        userMessage: "Done.",
      },
    ]);

    const res = new FakeRes();
    const session = freshSession({ id: "sess-test-1", maxIterations: 5 });

    // Queue the interjection before the loop starts; it will be picked up on iteration 2.
    interjectSession("sess-test-1", "Focus on Calgary instead.");

    await runOrchestrator(session, res as unknown as Response);

    const events = res.events();
    expect(events.some((e) => e.type === "iteration_complete")).toBe(true);
    expect(session.status).toBe("completed");
  });
});

describe("orchestrator — LLM failure handling", () => {
  it("transitions to error state after MAX_CONSECUTIVE_FAILURES LLM errors", async () => {
    // Use 4xx errors so they aren't retried; each iteration consumes one canned response.
    registerMockResponses("sess-test-1", [
      { error: "(400) bad request" },
      { error: "(400) bad request" },
      { error: "(400) bad request" },
      { error: "(400) bad request" },
    ]);

    const res = new FakeRes();
    const session = freshSession({ id: "sess-test-1", maxIterations: 10 });

    await runOrchestrator(session, res as unknown as Response);

    const types = res.events().map((e) => e.type);
    expect(types.some((t) => t === "llm_error")).toBe(true);
    expect(session.status).toBe("error");
    expect(session.error).toMatch(/LLM failed/);
  });
});

describe("orchestrator — session lifecycle", () => {
  it("createSession persists a new session and returns the loaded state", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ id: "new-uuid-1", created_at: new Date() }],
    });

    const session = await createSession({
      userId: "user-1",
      ministryCode: "INFRA",
      prompt: "do something",
      modelId: "mock-llm",
      maxIterations: 5,
      classification: "unclassified",
    });
    expect(session.id).toBe("new-uuid-1");
    expect(session.status).toBe("idle");
    expect(session.blackboard).toEqual([]);
  });

  it("isSessionRunning is false for an unknown session id", () => {
    expect(isSessionRunning("does-not-exist")).toBe(false);
  });
});
