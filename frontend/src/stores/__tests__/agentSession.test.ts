/**
 * Contract test scaffold for the agentSession Pinia store that Stream B will build.
 *
 * The store is expected to be a reducer-style consumer of SSE events from the
 * backend, mutating a normalized session state object. These `it.todo` entries
 * pin the event vocabulary and state transitions Stream B must implement.
 *
 * When Stream B lands `src/stores/agentSession.ts`, convert these into real
 * tests by importing the store and exercising each handleSseEvent path.
 *
 * Why scaffold: writing the real tests with a dynamic import path would force
 * Vite to resolve the missing module at scan time and fail the whole suite. The
 * todo form locks the contract without breaking CI.
 */

import { describe, it } from "vitest";

describe("useAgentSessionStore (Stream B contract — not yet implemented)", () => {
  it.todo("starts in idle state with empty memory");
  it.todo("session_start: sets sessionId and status=running");
  it.todo("iteration_start: increments iteration counter");
  it.todo("llm_response: stores latest thinking + token usage");
  it.todo("blackboard_update: appends new entries to the blackboard array");
  it.todo("scratchpad_update: replaces scratchpad content");
  it.todo("attributes_update: merges new attributes into the attributes object");
  it.todo("tool_calls: registers tool calls in 'running' status");
  it.todo("tool_result: transitions matching tool calls to success/failure");
  it.todo("session_complete: sets terminal status + final report");
  it.todo("error: surfaces error message in store.error");
  it.todo("reset(): clears all session state back to idle");
  it.todo("idempotent SSE replay: applying the same event twice does not double-count");
});
