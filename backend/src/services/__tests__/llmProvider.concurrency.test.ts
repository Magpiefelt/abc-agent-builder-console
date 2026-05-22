/**
 * Per-provider concurrency isolation test (B8).
 *
 * Verifies that a stalled call against one provider does NOT block
 * in-flight calls against a different provider. The original
 * `withRetry` loop could hold the caller for up to ~2 minutes on a
 * Vertex AI 429 storm; without per-provider semaphores a Gemini call
 * issued by the same Node process could be queued behind that retry
 * loop on a single shared mutex.
 *
 * Strategy:
 *   - Mock the database query so `getModel` returns two distinct registry
 *     entries (one Vertex AI, one Gemini).
 *   - Replace `provider.call` with a fake that resolves after a controllable
 *     delay so we can drive timing deterministically.
 *   - Block the Vertex AI provider with a long-running call, fire a Gemini
 *     call concurrently, and verify the Gemini call completes BEFORE the
 *     Vertex AI one — which only happens if the two providers do not share
 *     a queue.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());
vi.mock("../../config/database.js", () => ({
  query: queryMock,
  checkConnection: vi.fn(),
}));

// Mock the env so we don't need the real .env.
vi.mock("../../config/env.js", () => ({
  env: {
    NODE_ENV: "test",
    LLM_MOCK: "0",
    ANTHROPIC_API_KEY: "test",
    VERTEX_AI_API_KEY: "test",
    GOOGLE_AI_API_KEY: "test",
    LLM_TIMEOUT_MS: 60_000,
  },
}));

import {
  callLLM,
  _resetProviderSemaphores,
  clearModelCache,
} from "../llmProvider.js";

// Fake provider classes used to substitute the real Anthropic/Gemini fetch.
// We can't patch the un-exported `getProviderInstance` directly, so we
// monkey-patch the module-internal `providers` Map using globalThis access
// via a small ESM-friendly indirection. Instead of jumping through hoops, we
// just stub the `fetch` calls — the real providers go through `fetch`, so
// returning a fake Response with controllable timing gives us the same
// effect with less invasive plumbing.

interface FakeResponseInit {
  status: number;
  body: unknown;
  delayMs: number;
}

function fakeFetchResponse(init: FakeResponseInit): Promise<Response> {
  return new Promise((resolve) => {
    setTimeout(() => {
      const body = JSON.stringify(init.body);
      resolve(
        new Response(body, {
          status: init.status,
          headers: { "content-type": "application/json" },
        }) as unknown as Response,
      );
    }, init.delayMs);
  });
}

beforeEach(() => {
  queryMock.mockReset();
  _resetProviderSemaphores();
  clearModelCache();

  // Stub the model registry: two models on different providers.
  queryMock.mockImplementation((sql: string) => {
    if (typeof sql === "string" && sql.includes("model_registry")) {
      return Promise.resolve({
        rows: [
          {
            id: 1,
            model_id: "claude-sonnet-4.5",
            display_name: "Claude Sonnet 4.5 (Vertex AI)",
            provider: "vertex_ai",
            api_model_name: "claude-sonnet-4-5-20250929",
            max_output_tokens: 8192,
            supports_streaming: true,
            supports_tools: true,
            data_residency: "canada",
            max_classification: "protected_b",
            is_active: true,
          },
          {
            id: 2,
            model_id: "gemini-2.5-flash",
            display_name: "Gemini 2.5 Flash",
            provider: "google",
            api_model_name: "gemini-2.5-flash",
            max_output_tokens: 8192,
            supports_streaming: true,
            supports_tools: true,
            data_residency: "us",
            max_classification: "unclassified",
            is_active: true,
          },
        ],
      });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Per-provider concurrency isolation (B8)", () => {
  it("a stalled Vertex AI call does not block a concurrent Gemini call", async () => {
    // Both providers are stubbed via global fetch. Vertex AI responds slowly;
    // Gemini responds quickly. If the queue were shared, Gemini would have to
    // wait for Vertex.
    let vertexResolved = -1;
    let geminiResolved = -1;
    let counter = 0;

    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (typeof url === "string" && url.includes("anthropic.com")) {
          // The AnthropicProvider handles both Vertex AI and Anthropic models
          // and hits api.anthropic.com. Slow.
          return fakeFetchResponse({
            status: 200,
            body: {
              content: [{ type: "text", text: '{"thinking":"","status":"completed","tool_calls":[]}' }],
              stop_reason: "end_turn",
              usage: { input_tokens: 10, output_tokens: 5 },
            },
            delayMs: 200,
          }).then((r) => {
            vertexResolved = ++counter;
            return r;
          });
        }
        if (typeof url === "string" && url.includes("generativelanguage.googleapis.com")) {
          // Gemini. Fast.
          return fakeFetchResponse({
            status: 200,
            body: {
              candidates: [
                {
                  content: {
                    parts: [
                      { text: '{"thinking":"","status":"completed","tool_calls":[]}' },
                    ],
                  },
                  finishReason: "STOP",
                },
              ],
              usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
            },
            delayMs: 20,
          }).then((r) => {
            geminiResolved = ++counter;
            return r;
          });
        }
        return Promise.reject(new Error(`unexpected fetch URL: ${String(url)}`));
      }),
    );

    const vertexCall = callLLM("claude-sonnet-4.5", {
      systemPrompt: "test",
      messages: [{ role: "user", content: "hi" }],
      responseFormat: "json",
    });
    const geminiCall = callLLM("gemini-2.5-flash", {
      systemPrompt: "test",
      messages: [{ role: "user", content: "hi" }],
      responseFormat: "json",
    });

    await Promise.all([vertexCall, geminiCall]);

    // Gemini must have resolved BEFORE Vertex AI. Without isolation, the
    // shared `getProviderInstance` call sequence would have made Gemini
    // wait — the test guarantees they ran on independent queues.
    expect(geminiResolved).toBe(1);
    expect(vertexResolved).toBe(2);
  });

  it("multiple Vertex AI calls share the same semaphore (bounded concurrency within a provider)", async () => {
    // Burst 12 calls; with DEFAULT_PROVIDER_CONCURRENCY=8 the 9th and beyond
    // must wait. We confirm the in-flight count never exceeds the cap.
    let inflight = 0;
    let maxInflight = 0;

    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        inflight += 1;
        maxInflight = Math.max(maxInflight, inflight);
        return new Promise<Response>((resolve) => {
          setTimeout(() => {
            inflight -= 1;
            resolve(
              new Response(
                JSON.stringify({
                  content: [
                    { type: "text", text: '{"thinking":"","status":"completed","tool_calls":[]}' },
                  ],
                  stop_reason: "end_turn",
                  usage: { input_tokens: 10, output_tokens: 5 },
                }),
                { status: 200, headers: { "content-type": "application/json" } },
              ) as unknown as Response,
            );
          }, 50);
        });
      }),
    );

    const calls = Array.from({ length: 12 }, () =>
      callLLM("claude-sonnet-4.5", {
        systemPrompt: "test",
        messages: [{ role: "user", content: "hi" }],
        responseFormat: "json",
      }),
    );

    await Promise.all(calls);

    expect(maxInflight).toBeLessThanOrEqual(8);
    expect(maxInflight).toBeGreaterThan(0);
  });
});
