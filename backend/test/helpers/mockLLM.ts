/**
 * Mock LLM response registry.
 *
 * Tests register a deterministic response sequence by sessionId or by a generic
 * "default" key, then point an agent session at the "mock-llm" model. The
 * MockProvider in llmProvider.ts reads from this registry on every call.
 *
 * Responses are consumed in order, one per LLM call.
 */

import type { LLMResponse, LLMStreamCallback, LLMStreamEvent } from "../../src/services/llmProvider.js";

export interface MockLLMResponseInput {
  /** Free-form thinking text the agent emits */
  thinking?: string;
  /** Tool calls the agent decides to make (the orchestrator merges these with parsed JSON tool_calls). */
  toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>;
  /** Blackboard updates the parsed JSON should announce */
  blackboardUpdates?: Array<{ category: string; title: string; content: string }>;
  /** Optional scratchpad write */
  scratchpad?: string | null;
  /** Optional attribute write */
  attributeUpdates?: Record<string, unknown> | null;
  /** Status — defaults to "running" */
  status?: "running" | "completed" | "needs_assistance" | "error";
  /** user_message echoed back through the SSE stream */
  userMessage?: string;
  /** Force the provider to throw an error instead */
  error?: string;
  /** Override token usage */
  usage?: { promptTokens: number; completionTokens: number };
}

interface RegistryBucket {
  responses: MockLLMResponseInput[];
  cursor: number;
}

const registry = new Map<string, RegistryBucket>();
const DEFAULT_KEY = "__default__";

function getKey(sessionId?: string): string {
  return sessionId || DEFAULT_KEY;
}

export function registerMockResponses(sessionId: string | undefined, responses: MockLLMResponseInput[]): void {
  registry.set(getKey(sessionId), { responses: [...responses], cursor: 0 });
}

export function appendMockResponse(sessionId: string | undefined, response: MockLLMResponseInput): void {
  const key = getKey(sessionId);
  const bucket = registry.get(key) || { responses: [], cursor: 0 };
  bucket.responses.push(response);
  registry.set(key, bucket);
}

export function clearMockResponses(): void {
  registry.clear();
}

export function getMockResponseCount(sessionId?: string): number {
  return registry.get(getKey(sessionId))?.responses.length || 0;
}

/**
 * Pull the next canned response for a session. Falls back to the default
 * bucket. If no responses are registered, returns a benign "completed" message
 * so a test that forgets to register doesn't hang forever.
 */
export function consumeMockResponse(sessionId: string): MockLLMResponseInput {
  for (const key of [sessionId, DEFAULT_KEY]) {
    const bucket = registry.get(key);
    if (bucket && bucket.cursor < bucket.responses.length) {
      const resp = bucket.responses[bucket.cursor];
      bucket.cursor++;
      return resp;
    }
  }
  return {
    thinking: "No mock response registered; finishing.",
    status: "completed",
    userMessage: "Mock fallback: no more responses registered.",
  };
}

/**
 * Render a mock response into the structured LLMResponse the orchestrator expects.
 * Content is a JSON string matching the system prompt's response_format schema.
 */
export function renderMockResponse(
  modelName: string,
  startTime: number,
  input: MockLLMResponseInput
): LLMResponse {
  if (input.error) {
    throw new Error(input.error);
  }

  const payload = {
    thinking: input.thinking || "",
    tool_calls: input.toolCalls?.map((tc) => ({ tool: tc.name, params: tc.arguments })) || [],
    blackboard_updates: input.blackboardUpdates || [],
    scratchpad: input.scratchpad ?? null,
    attribute_updates: input.attributeUpdates || null,
    status: input.status || "running",
    user_message: input.userMessage || null,
  };

  const content = JSON.stringify(payload);
  const usage = {
    promptTokens: input.usage?.promptTokens ?? 100,
    completionTokens: input.usage?.completionTokens ?? Math.ceil(content.length / 4),
  };

  return {
    content,
    toolCalls: (input.toolCalls || []).map((tc, idx) => ({
      id: `mock-tool-${idx}`,
      name: tc.name,
      arguments: tc.arguments,
    })),
    finishReason: (input.toolCalls?.length || 0) > 0 ? "tool_use" : "stop",
    usage: {
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.promptTokens + usage.completionTokens,
    },
    model: modelName,
    provider: "mock",
    latencyMs: Date.now() - startTime,
  };
}

/**
 * Stream a mock response over the onEvent callback. The orchestrator currently
 * uses callLLM (non-streaming), but the MockProvider must satisfy the
 * streaming interface anyway.
 */
export function emitMockStream(
  response: LLMResponse,
  onEvent: LLMStreamCallback
): void {
  const events: LLMStreamEvent[] = [
    { type: "text_delta", content: response.content },
    { type: "done" },
  ];
  for (const ev of events) onEvent(ev);
}
