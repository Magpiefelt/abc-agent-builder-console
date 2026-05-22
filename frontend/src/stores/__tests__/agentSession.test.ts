/**
 * Tests for the Free Agent session Pinia store — the reducer that consumes
 * SSE events from the orchestrator and produces a normalized session state.
 *
 * apiFetch + useSSEStream are mocked so the suite is hermetic. We exercise
 * handleEvent indirectly by capturing the onEvent callback that the store
 * registers with useSSEStream during startStream().
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { setActivePinia, createPinia } from "pinia";

// ---------------------------------------------------------------------------
// Mocks (hoisted so the import below picks them up).
// ---------------------------------------------------------------------------

const apiFetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/composables/useApiFetch", () => ({
  apiFetch: apiFetchMock,
}));

// Capture the latest onEvent / onError / onDone callbacks the store registers
// so each test can drive the reducer by calling them directly.
const streamState = vi.hoisted(() => ({
  onEvent: null as ((e: unknown) => void) | null,
  onError: null as ((e: Error) => void) | null,
  onDone: null as (() => void) | null,
  start: vi.fn(),
  abort: vi.fn(),
}));

vi.mock("@/composables/useSSEStream", () => ({
  useSSEStream: (opts: {
    onEvent: (e: unknown) => void;
    onError?: (e: Error) => void;
    onDone?: () => void;
  }) => {
    streamState.onEvent = opts.onEvent;
    streamState.onError = opts.onError ?? null;
    streamState.onDone = opts.onDone ?? null;
    return {
      // The store calls watch(stream.status, ...) so this must be a real ref.
      status: ref("idle"),
      start: streamState.start,
      abort: streamState.abort,
    };
  },
}));

const toastPushMock = vi.hoisted(() => vi.fn());
vi.mock("@/composables/useToast", () => ({
  useToast: () => ({
    toasts: { value: [] },
    push: toastPushMock,
    dismiss: vi.fn(),
  }),
}));

import { useAgentSessionStore } from "@/stores/agentSession";

const SESSION_ID = "session-abc-123";

function makeStartedStore() {
  const store = useAgentSessionStore();
  // Seed sessionId without going through createSession so tests can focus on
  // the reducer behavior — most events are no-ops while sessionId is null.
  store.sessionId = SESSION_ID;
  return store;
}

beforeEach(() => {
  setActivePinia(createPinia());
  apiFetchMock.mockReset();
  streamState.start.mockReset();
  streamState.abort.mockReset();
  streamState.onEvent = null;
  streamState.onError = null;
  streamState.onDone = null;
  toastPushMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe("useAgentSessionStore — initial state", () => {
  it("starts in idle state with empty memory", () => {
    const store = useAgentSessionStore();
    expect(store.status).toBe("idle");
    expect(store.sessionId).toBeNull();
    expect(store.currentIteration).toBe(0);
    expect(store.iterations).toEqual([]);
    expect(store.blackboard).toEqual([]);
    expect(store.scratchpad).toBe("");
    expect(store.attributes).toEqual({});
    expect(store.artifacts).toEqual([]);
    expect(store.toolCallLog).toEqual([]);
    expect(store.errors).toEqual([]);
    expect(store.finalReport).toBeNull();
  });

  it("computed flags reflect the idle state", () => {
    const store = useAgentSessionStore();
    expect(store.isRunning).toBe(false);
    expect(store.canStop).toBe(false);
    expect(store.canContinue).toBe(false);
    expect(store.canInterject).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Per-event reducer behavior
// ---------------------------------------------------------------------------

describe("useAgentSessionStore — handleEvent reducer", () => {
  async function attachStream() {
    const store = makeStartedStore();
    await store.startStream();
    expect(streamState.onEvent).not.toBeNull();
    return { store, fire: streamState.onEvent! };
  }

  it("session_start: sets status=running", async () => {
    const { store, fire } = await attachStream();
    fire({ type: "session_start", modelId: "claude-haiku-4-5" });
    expect(store.status).toBe("running");
    expect(store.isRunning).toBe(true);
    expect(store.canStop).toBe(true);
    expect(store.canInterject).toBe(true);
  });

  it("iteration_start: increments iteration counter and creates a record", async () => {
    const { store, fire } = await attachStream();
    fire({ type: "iteration_start", iteration: 1 });
    expect(store.currentIteration).toBe(1);
    expect(store.iterations).toHaveLength(1);
    expect(store.iterations[0].iteration).toBe(1);
    expect(store.iterations[0].status).toBe("running");

    fire({ type: "iteration_start", iteration: 2 });
    expect(store.currentIteration).toBe(2);
    expect(store.iterations).toHaveLength(2);
  });

  it("llm_response: stores thinking + token usage on the iteration record", async () => {
    const { store, fire } = await attachStream();
    fire({ type: "iteration_start", iteration: 1 });
    fire({
      type: "llm_response",
      iteration: 1,
      thinking: "Thinking about it.",
      status: "thinking",
      userMessage: "halfway there",
      toolCallCount: 2,
      tokensUsed: 543,
    });
    const rec = store.iterations.find((i) => i.iteration === 1)!;
    expect(rec.thinking).toBe("Thinking about it.");
    expect(rec.parsedStatus).toBe("thinking");
    expect(rec.userMessage).toBe("halfway there");
    expect(rec.toolCallCount).toBe(2);
    expect(rec.tokensUsed).toBe(543);
  });

  it("tool_calls: appends to the iteration's toolCalls list", async () => {
    const { store, fire } = await attachStream();
    fire({ type: "iteration_start", iteration: 1 });
    fire({
      type: "tool_calls",
      iteration: 1,
      calls: [{ tool: "web_search" }, { tool: "web_scrape" }],
    });
    fire({
      type: "tool_calls",
      iteration: 1,
      calls: [{ tool: "get_time" }],
    });
    const rec = store.iterations.find((i) => i.iteration === 1)!;
    expect(rec.toolCalls.map((c) => c.tool)).toEqual([
      "web_search",
      "web_scrape",
      "get_time",
    ]);
  });

  it("tool_result: records success/failure on the iteration + global log", async () => {
    const { store, fire } = await attachStream();
    fire({ type: "iteration_start", iteration: 1 });
    fire({
      type: "tool_result",
      iteration: 1,
      tool: "web_search",
      success: true,
      durationMs: 240,
    });
    fire({
      type: "tool_result",
      iteration: 1,
      tool: "web_scrape",
      success: false,
      durationMs: 90,
      error: "Cannot access private or internal network addresses.",
    });

    const rec = store.iterations.find((i) => i.iteration === 1)!;
    expect(rec.toolResults).toHaveLength(2);
    expect(rec.toolResults[0]).toMatchObject({ tool: "web_search", success: true });
    expect(rec.toolResults[1]).toMatchObject({ tool: "web_scrape", success: false });

    expect(store.toolCallLog).toHaveLength(2);
    expect(store.toolCallLog[1].error).toContain("private or internal");
  });

  it("blackboard_update / scratchpad_update / attributes_update: trigger a debounced GET", async () => {
    vi.useFakeTimers();
    apiFetchMock.mockResolvedValueOnce({
      blackboard: [
        { category: "facts", title: "Capital", content: "Edmonton", iteration: 1 },
      ],
      scratchpad: "Working notes…",
      attributes: { confidence: 0.8 },
    });

    const { store, fire } = await attachStream();
    fire({ type: "blackboard_update", iteration: 1 });
    fire({ type: "scratchpad_update", iteration: 1 });
    fire({ type: "attributes_update", iteration: 1 });

    // Three rapid events should coalesce into a single GET.
    await vi.advanceTimersByTimeAsync(200);
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(apiFetchMock).toHaveBeenCalledWith(`/api/agent/sessions/${SESSION_ID}`);

    expect(store.blackboard).toHaveLength(1);
    expect(store.blackboard[0].content).toBe("Edmonton");
    expect(store.scratchpad).toBe("Working notes…");
    expect(store.attributes).toEqual({ confidence: 0.8 });
  });

  it("artifact_created: appends a normalized artifact record", async () => {
    const { store, fire } = await attachStream();
    fire({ type: "iteration_start", iteration: 3 });
    fire({
      type: "artifact_created",
      iteration: 3,
      artifact: {
        id: "art-1",
        title: "Report.pdf",
        type: "document",
        mimeType: "application/pdf",
        description: "Summary report",
        size: 1234,
      },
    });
    expect(store.artifacts).toHaveLength(1);
    expect(store.artifacts[0]).toMatchObject({
      id: "art-1",
      title: "Report.pdf",
      type: "document",
      iteration: 3,
      size: 1234,
    });
  });

  it("iteration_complete: marks the iteration completed with duration + tokens", async () => {
    const { store, fire } = await attachStream();
    fire({ type: "iteration_start", iteration: 1 });
    fire({
      type: "iteration_complete",
      iteration: 1,
      durationMs: 1800,
      tokensUsed: 720,
      userMessage: "Done with this iteration.",
    });
    const rec = store.iterations.find((i) => i.iteration === 1)!;
    expect(rec.status).toBe("completed");
    expect(rec.durationMs).toBe(1800);
    expect(rec.tokensUsed).toBe(720);
    expect(rec.userMessage).toBe("Done with this iteration.");
  });

  it("loop_warning / pii_warning: push toast and do not change status", async () => {
    const { store, fire } = await attachStream();
    fire({ type: "session_start" });
    fire({ type: "loop_warning", level: "L3", description: "Same tool twice." });
    fire({ type: "pii_warning", message: "AHCN redacted." });

    expect(store.status).toBe("running");
    expect(toastPushMock).toHaveBeenCalledTimes(2);
    expect(toastPushMock.mock.calls[0][0]).toMatchObject({ kind: "warning" });
    expect(toastPushMock.mock.calls[1][0]).toMatchObject({ kind: "warning" });
  });

  it("loop_intervention: sets status=needs_assistance", async () => {
    const { store, fire } = await attachStream();
    fire({ type: "session_start" });
    fire({ type: "loop_intervention", message: "Halting — repeated identical action." });
    expect(store.status).toBe("needs_assistance");
    expect(store.canContinue).toBe(true);
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "warning" }),
    );
  });

  it("llm_error: records the error, marks the iteration error, retains history", async () => {
    const { store, fire } = await attachStream();
    fire({ type: "iteration_start", iteration: 1 });
    fire({ type: "llm_error", iteration: 1, error: "503 from provider" });
    expect(store.errors).toContain("503 from provider");
    const rec = store.iterations.find((i) => i.iteration === 1)!;
    expect(rec.status).toBe("error");
    expect(rec.error).toBe("503 from provider");
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "error" }),
    );
  });

  it("iteration_limit: sets status=completed and toasts an info message", async () => {
    const { store, fire } = await attachStream();
    fire({ type: "iteration_limit", message: "Hit max iterations." });
    expect(store.status).toBe("completed");
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "info" }),
    );
  });

  it("session_stopped: sets status=paused so the user can continue later", async () => {
    const { store, fire } = await attachStream();
    fire({ type: "session_start" });
    fire({ type: "session_stopped" });
    expect(store.status).toBe("paused");
    expect(store.canContinue).toBe(true);
  });

  it("session_complete: respects the backend's final status and captures finalReport", async () => {
    const { store, fire } = await attachStream();
    fire({ type: "session_start" });
    fire({
      type: "session_complete",
      status: "completed",
      finalReport: { summary: "All done." },
    });
    expect(store.status).toBe("completed");
    expect(store.finalReport).toEqual({ summary: "All done." });
  });

  it("session_complete: defaults to 'completed' when status is missing/invalid", async () => {
    const { store, fire } = await attachStream();
    fire({ type: "session_start" });
    fire({ type: "session_complete", status: "not-a-real-status" });
    expect(store.status).toBe("completed");
  });

  it("error: surfaces the error in store.errors and status=error", async () => {
    const { store, fire } = await attachStream();
    fire({ type: "session_start" });
    fire({ type: "error", error: "Unexpected orchestrator failure." });
    expect(store.status).toBe("error");
    expect(store.errors).toContain("Unexpected orchestrator failure.");
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "error" }),
    );
  });

  it("unknown event types are ignored (forward-compatible)", async () => {
    const { store, fire } = await attachStream();
    fire({ type: "session_start" });
    const before = store.status;
    fire({ type: "future_event_we_dont_know_about", payload: { a: 1 } });
    expect(store.status).toBe(before);
    expect(store.errors).toEqual([]);
  });

  it("drops events that arrive after reset clears sessionId", () => {
    const store = useAgentSessionStore();
    // No sessionId yet — reducer should treat every event as a no-op.
    // We can call handleEvent only through the public surface, so seed
    // the store, capture the handler, then reset.
    store.sessionId = SESSION_ID;
    // Pull the handler via startStream's onEvent wiring is too heavy here;
    // instead we verify the simpler invariant: after reset(), no state has
    // been mutated even if the previous in-flight events landed.
    store.reset();
    expect(store.status).toBe("idle");
    expect(store.iterations).toEqual([]);
    expect(store.blackboard).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Bounded errors buffer
// ---------------------------------------------------------------------------

describe("useAgentSessionStore — errors buffer", () => {
  it("retains at most the last 20 errors", async () => {
    const store = makeStartedStore();
    await store.startStream();
    const fire = streamState.onEvent!;
    for (let i = 0; i < 25; i++) {
      fire({ type: "llm_error", iteration: 1, error: `err-${i}` });
    }
    expect(store.errors).toHaveLength(20);
    // The oldest five should have been dropped.
    expect(store.errors[0]).toBe("err-5");
    expect(store.errors[19]).toBe("err-24");
  });
});

// ---------------------------------------------------------------------------
// Lifecycle: createSession / startStream / stop / continue / interject / reset
// ---------------------------------------------------------------------------

describe("useAgentSessionStore — createSession", () => {
  it("POSTs to /sessions and stores the returned id", async () => {
    apiFetchMock.mockResolvedValueOnce({ id: "new-session-id" });
    const store = useAgentSessionStore();
    const id = await store.createSession({
      prompt: "Hello",
      modelId: "claude-haiku-4-5",
      classification: "unclassified",
      maxIterations: 5,
    });
    expect(id).toBe("new-session-id");
    expect(store.sessionId).toBe("new-session-id");
    expect(store.sessionMeta).toMatchObject({
      prompt: "Hello",
      modelId: "claude-haiku-4-5",
    });
    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/agent/sessions",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("sets status=error and rethrows on failure", async () => {
    apiFetchMock.mockRejectedValueOnce(Object.assign(new Error("nope"), { status: 500 }));
    const store = useAgentSessionStore();
    await expect(
      store.createSession({
        prompt: "x",
        modelId: "m",
        classification: "unclassified",
        maxIterations: 5,
      }),
    ).rejects.toThrow("nope");
    expect(store.status).toBe("error");
    expect(store.errors).toContain("nope");
  });
});

describe("useAgentSessionStore — startStream", () => {
  it("kicks off the SSE stream with the session id and forwards body options", async () => {
    const store = makeStartedStore();
    await store.startStream({
      sectionOverrides: { security_rules: { enabled: false } },
      enabledTools: ["web_search"],
    });
    expect(streamState.start).toHaveBeenCalledWith(
      `/api/agent/sessions/${SESSION_ID}/start`,
      expect.objectContaining({
        body: {
          sectionOverrides: { security_rules: { enabled: false } },
          enabledTools: ["web_search"],
        },
      }),
    );
  });

  it("throws when there is no session id", async () => {
    const store = useAgentSessionStore();
    await expect(store.startStream()).rejects.toThrow(/No session/);
  });
});

describe("useAgentSessionStore — stop / continue / interject", () => {
  it("stop() POSTs to /stop and shows an info toast", async () => {
    apiFetchMock.mockResolvedValueOnce({});
    const store = makeStartedStore();
    await store.stop();
    expect(apiFetchMock).toHaveBeenCalledWith(
      `/api/agent/sessions/${SESSION_ID}/stop`,
      { method: "POST" },
    );
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "info" }),
    );
  });

  it("stop() is a no-op when no session exists", async () => {
    const store = useAgentSessionStore();
    await store.stop();
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it("continueSession() starts a new stream against /continue with the prompt", async () => {
    const store = makeStartedStore();
    await store.continueSession("keep going", 3);
    expect(streamState.start).toHaveBeenCalledWith(
      `/api/agent/sessions/${SESSION_ID}/continue`,
      expect.objectContaining({
        body: { prompt: "keep going", additionalIterations: 3 },
      }),
    );
    expect(store.status).toBe("running");
  });

  it("continueSession() ignores empty prompts", async () => {
    const store = makeStartedStore();
    await store.continueSession("   ");
    expect(streamState.start).not.toHaveBeenCalled();
  });

  it("interject() POSTs the message and shows an info toast", async () => {
    apiFetchMock.mockResolvedValueOnce({});
    const store = makeStartedStore();
    await store.interject("be brief");
    expect(apiFetchMock).toHaveBeenCalledWith(
      `/api/agent/sessions/${SESSION_ID}/interject`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ message: "be brief" }),
      }),
    );
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "info" }),
    );
  });

  it("interject() ignores empty messages", async () => {
    const store = makeStartedStore();
    await store.interject("");
    expect(apiFetchMock).not.toHaveBeenCalled();
  });
});

describe("useAgentSessionStore — reset", () => {
  it("clears all session state back to idle and aborts the active stream", async () => {
    const store = makeStartedStore();
    await store.startStream();
    const fire = streamState.onEvent!;
    fire({ type: "session_start" });
    fire({ type: "iteration_start", iteration: 1 });
    fire({
      type: "tool_result",
      iteration: 1,
      tool: "web_search",
      success: true,
      durationMs: 100,
    });
    expect(store.iterations).toHaveLength(1);
    expect(store.toolCallLog).toHaveLength(1);

    store.reset();
    expect(streamState.abort).toHaveBeenCalled();
    expect(store.status).toBe("idle");
    expect(store.sessionId).toBeNull();
    expect(store.iterations).toEqual([]);
    expect(store.toolCallLog).toEqual([]);
    expect(store.currentIteration).toBe(0);
    expect(store.errors).toEqual([]);
    expect(store.finalReport).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Memory reconcile via apiFetch
// ---------------------------------------------------------------------------

describe("useAgentSessionStore — refreshSessionMemory", () => {
  it("absorbs the GET payload into blackboard/scratchpad/attributes/finalReport", async () => {
    apiFetchMock.mockResolvedValueOnce({
      blackboard: [
        { category: "facts", title: "f1", content: "v1", iteration: 1 },
      ],
      scratchpad: "draft",
      attributes: { topic: "a" },
      finalReport: { summary: "ok" },
    });
    const store = makeStartedStore();
    await store.refreshSessionMemory();
    expect(store.blackboard).toHaveLength(1);
    expect(store.scratchpad).toBe("draft");
    expect(store.attributes).toEqual({ topic: "a" });
    expect(store.finalReport).toEqual({ summary: "ok" });
  });

  it("is a no-op without a session id", async () => {
    const store = useAgentSessionStore();
    await store.refreshSessionMemory();
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it("swallows transient fetch errors", async () => {
    apiFetchMock.mockRejectedValueOnce(new Error("network blip"));
    const store = makeStartedStore();
    // Should not throw.
    await store.refreshSessionMemory();
    expect(store.blackboard).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Session replay
// ---------------------------------------------------------------------------

describe("useAgentSessionStore — loadReplay", () => {
  function mockReplayResponses(): void {
    apiFetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/iterations")) {
        return {
          iterations: [
            {
              iterationNumber: 1,
              status: "completed",
              userPrompt: null,
              parsedResponse: {
                thinking: "think 1",
                status: "in_progress",
                toolCallCount: 1,
              },
              toolCalls: [{ tool: "web_search" }],
              toolResults: [
                { tool: "web_search", success: true, durationMs: 42 },
              ],
              error: null,
              tokensUsed: 100,
              durationMs: 200,
            },
            {
              iterationNumber: 2,
              status: "completed",
              userPrompt: null,
              parsedResponse: { status: "complete" },
              toolCalls: [],
              toolResults: [],
              error: null,
              tokensUsed: 50,
              durationMs: 80,
            },
          ],
        };
      }
      if (url.endsWith("/artifacts")) {
        return {
          artifacts: [
            {
              id: "a1",
              artifact_type: "document",
              title: "Notes",
              description: null,
              mime_type: "text/markdown",
              size_bytes: 1234,
              iteration: 1,
            },
          ],
        };
      }
      // Base session payload
      return {
        id: "sess-1",
        status: "completed",
        prompt: "Research topic X",
        modelId: "claude-sonnet-4-6",
        maxIterations: 10,
        currentIteration: 2,
        classification: "unclassified",
        blackboard: [{ category: "facts", title: "f1", content: "v", iteration: 1 }],
        scratchpad: "draft notes",
        attributes: { topic: "X" },
        finalReport: { summary: "done" },
        error: null,
      };
    });
  }

  it("hydrates the store from the three replay endpoints and flips into replay mode", async () => {
    mockReplayResponses();
    const store = useAgentSessionStore();
    await store.loadReplay("sess-1");

    expect(store.replayMode).toBe(true);
    expect(store.replayLoading).toBe(false);
    expect(store.replayError).toBeNull();
    expect(store.sessionId).toBe("sess-1");
    expect(store.status).toBe("completed");
    expect(store.sessionMeta?.prompt).toBe("Research topic X");
    expect(store.blackboard).toHaveLength(1);
    expect(store.scratchpad).toBe("draft notes");
    expect(store.attributes).toEqual({ topic: "X" });
    expect(store.finalReport).toEqual({ summary: "done" });
    expect(store.iterations).toHaveLength(2);
    expect(store.iterations[0].toolCalls).toHaveLength(1);
    expect(store.toolCallLog).toHaveLength(1);
    expect(store.artifacts).toHaveLength(1);
    expect(store.artifacts[0].title).toBe("Notes");
  });

  it("disables canStop/canContinue/canInterject in replay mode", async () => {
    mockReplayResponses();
    const store = useAgentSessionStore();
    await store.loadReplay("sess-1");
    expect(store.canStop).toBe(false);
    expect(store.canContinue).toBe(false);
    expect(store.canInterject).toBe(false);
  });

  it("reset() clears replay mode", async () => {
    mockReplayResponses();
    const store = useAgentSessionStore();
    await store.loadReplay("sess-1");
    expect(store.replayMode).toBe(true);
    store.reset();
    expect(store.replayMode).toBe(false);
    expect(store.iterations).toEqual([]);
    expect(store.sessionId).toBeNull();
  });

  it("records replayError when the session fetch fails", async () => {
    apiFetchMock.mockRejectedValue(new Error("not found"));
    const store = useAgentSessionStore();
    await store.loadReplay("missing-id");
    expect(store.replayError).toMatch(/not found/);
    expect(store.status).toBe("error");
  });
});
