import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());
vi.mock("../../config/database.js", () => ({
  query: queryMock,
}));

import {
  callLLM,
  validateModelClassification,
  isProviderConfigured,
  getActiveModels,
  getModel,
  clearModelCache,
  getTokenUsageStats,
} from "../llmProvider.js";
import { registerMockResponses, clearMockResponses } from "../../../test/helpers/mockLLM.js";

const SAMPLE_MODEL_ROW = {
  id: 1,
  model_id: "claude-sonnet-4.5",
  display_name: "Claude Sonnet 4.5",
  provider: "anthropic" as const,
  api_model_name: "claude-sonnet-4-20250514",
  max_output_tokens: 16384,
  supports_streaming: true,
  supports_tools: true,
  data_residency: "canada",
  max_classification: "protected_b",
  is_active: true,
};

const MOCK_MODEL_ROW = {
  id: 99,
  model_id: "mock-llm",
  display_name: "Mock LLM",
  provider: "anthropic" as const,
  api_model_name: "mock-model",
  max_output_tokens: 8192,
  supports_streaming: true,
  supports_tools: true,
  data_residency: "canada",
  max_classification: "protected_b",
  is_active: true,
};

const US_RESIDENCY_MODEL_ROW = {
  id: 2,
  model_id: "gemini-2.5-flash",
  display_name: "Gemini 2.5 Flash",
  provider: "google" as const,
  api_model_name: "gemini-2.5-flash",
  max_output_tokens: 8192,
  supports_streaming: true,
  supports_tools: true,
  data_residency: "us",
  max_classification: "unclassified",
  is_active: true,
};

beforeEach(() => {
  queryMock.mockReset();
  clearMockResponses();
  clearModelCache();
});

describe("llmProvider — model registry", () => {
  it("getActiveModels returns rows from the DB", async () => {
    queryMock.mockResolvedValueOnce({ rows: [SAMPLE_MODEL_ROW, US_RESIDENCY_MODEL_ROW] });
    const models = await getActiveModels();
    expect(models.map((m) => m.model_id)).toContain("claude-sonnet-4.5");
    expect(models.map((m) => m.model_id)).toContain("gemini-2.5-flash");
  });

  it("getActiveModels caches results for the TTL window", async () => {
    queryMock.mockResolvedValueOnce({ rows: [SAMPLE_MODEL_ROW] });
    await getActiveModels();
    await getActiveModels();
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it("clearModelCache forces a refetch", async () => {
    queryMock.mockResolvedValueOnce({ rows: [SAMPLE_MODEL_ROW] });
    await getActiveModels();
    clearModelCache();
    queryMock.mockResolvedValueOnce({ rows: [SAMPLE_MODEL_ROW] });
    await getActiveModels();
    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  it("getActiveModels falls back to defaults when DB throws and cache empty", async () => {
    queryMock.mockRejectedValueOnce(new Error("conn refused"));
    const models = await getActiveModels();
    expect(models.length).toBeGreaterThan(0);
    expect(models.map((m) => m.model_id)).toContain("mock-llm");
  });

  it("getModel returns null when model_id is not present", async () => {
    queryMock.mockResolvedValueOnce({ rows: [SAMPLE_MODEL_ROW] });
    expect(await getModel("nonexistent-model")).toBeNull();
  });
});

describe("llmProvider — classification gating", () => {
  it("rejects when session is Protected B but model is unclassified-only (US residency)", async () => {
    queryMock.mockResolvedValueOnce({ rows: [US_RESIDENCY_MODEL_ROW] });
    const result = await validateModelClassification("gemini-2.5-flash", "protected_b");
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/protected_b|approved/);
  });

  it("allows Unclassified data on a US-residency model (negative-control)", async () => {
    queryMock.mockResolvedValueOnce({ rows: [US_RESIDENCY_MODEL_ROW] });
    const result = await validateModelClassification("gemini-2.5-flash", "unclassified");
    expect(result.valid).toBe(true);
  });

  it("allows Protected A on a Protected-B-capable Canadian model", async () => {
    queryMock.mockResolvedValueOnce({ rows: [SAMPLE_MODEL_ROW] });
    const result = await validateModelClassification("claude-sonnet-4.5", "protected_a");
    expect(result.valid).toBe(true);
  });

  it("rejects when model_id is not in the registry", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const result = await validateModelClassification("ghost-model", "unclassified");
    expect(result.valid).toBe(false);
  });
});

describe("llmProvider — isProviderConfigured", () => {
  it("returns true when ANTHROPIC_API_KEY is set (test setup defaults it)", () => {
    expect(isProviderConfigured()).toBe(true);
  });
});

describe("llmProvider — callLLM via MockProvider", () => {
  it("returns a structured response for the mock model", async () => {
    queryMock.mockResolvedValueOnce({ rows: [MOCK_MODEL_ROW] });
    registerMockResponses("sess-A", [
      {
        thinking: "thinking content",
        status: "completed",
        userMessage: "Done!",
        usage: { promptTokens: 50, completionTokens: 25 },
      },
    ]);
    const response = await callLLM("mock-llm", {
      systemPrompt: "be helpful",
      messages: [{ role: "user", content: "hi" }],
      sessionId: "sess-A",
    });
    expect(response.provider).toBe("mock");
    expect(response.model).toBe("mock-model");
    expect(response.usage.promptTokens).toBe(50);
    expect(response.usage.completionTokens).toBe(25);
    expect(response.usage.totalTokens).toBe(75);
    expect(response.content).toContain("thinking content");
  });

  it("falls back to default response when no canned responses are registered", async () => {
    queryMock.mockResolvedValueOnce({ rows: [MOCK_MODEL_ROW] });
    const response = await callLLM("mock-llm", {
      systemPrompt: "be helpful",
      messages: [{ role: "user", content: "hi" }],
      sessionId: "sess-without-canned",
    });
    expect(response.provider).toBe("mock");
    expect(JSON.parse(response.content).status).toBe("completed");
  });

  it("throws when the mock entry has an error field set", async () => {
    queryMock.mockResolvedValueOnce({ rows: [MOCK_MODEL_ROW] });
    // Register the error on enough successive responses so all retries see it.
    registerMockResponses("sess-err", [
      { error: "(400) Simulated LLM client error" },
      { error: "(400) Simulated LLM client error" },
      { error: "(400) Simulated LLM client error" },
      { error: "(400) Simulated LLM client error" },
    ]);
    await expect(
      callLLM("mock-llm", {
        systemPrompt: "x",
        messages: [{ role: "user", content: "y" }],
        sessionId: "sess-err",
      })
    ).rejects.toThrow(/Simulated LLM client error/);
  });
});

describe("llmProvider — retry behavior (Anthropic)", () => {
  beforeEach(() => {
    // Disable MOCK_LLM so the real Anthropic provider runs (still fetch-mocked)
    process.env.MOCK_LLM = "";
    vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    process.env.MOCK_LLM = "1";
    vi.restoreAllMocks();
  });

  it("retries on 429 then succeeds", async () => {
    queryMock.mockResolvedValueOnce({ rows: [SAMPLE_MODEL_ROW] });

    const successBody = {
      content: [{ type: "text", text: '{"thinking":"ok","status":"completed"}' }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 },
    };

    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(successBody), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));

    const response = await callLLM("claude-sonnet-4.5", {
      systemPrompt: "system",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(response.usage.promptTokens).toBe(10);
    expect(response.usage.completionTokens).toBe(5);
  }, 30_000);

  it("does not retry on 400 (client error other than 429)", async () => {
    queryMock.mockResolvedValueOnce({ rows: [SAMPLE_MODEL_ROW] });

    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("bad request", { status: 400 }));

    await expect(callLLM("claude-sonnet-4.5", {
      systemPrompt: "system",
      messages: [{ role: "user", content: "hi" }],
    })).rejects.toThrow(/400/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries on 503 up to maxRetries+1 then gives up", async () => {
    queryMock.mockResolvedValueOnce({ rows: [SAMPLE_MODEL_ROW] });

    // Build a fresh Response per call so .text() can be consumed each time.
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response("upstream gateway", { status: 503 }));

    await expect(callLLM("claude-sonnet-4.5", {
      systemPrompt: "system",
      messages: [{ role: "user", content: "hi" }],
    })).rejects.toThrow(/503/);
    // 1 initial + 3 retries = 4 calls
    expect(fetchMock).toHaveBeenCalledTimes(4);
  }, 60_000);
});

describe("llmProvider — token usage tracking", () => {
  it("records token usage on each call and reports recent totals", async () => {
    queryMock.mockResolvedValueOnce({ rows: [MOCK_MODEL_ROW] });
    registerMockResponses("sess-tokens", [
      { thinking: "x", status: "completed", usage: { promptTokens: 100, completionTokens: 50 } },
      { thinking: "y", status: "completed", usage: { promptTokens: 200, completionTokens: 75 } },
    ]);
    queryMock.mockResolvedValueOnce({ rows: [MOCK_MODEL_ROW] });
    await callLLM("mock-llm", {
      systemPrompt: "s",
      messages: [{ role: "user", content: "u" }],
      sessionId: "sess-tokens",
    });
    await callLLM("mock-llm", {
      systemPrompt: "s",
      messages: [{ role: "user", content: "u" }],
      sessionId: "sess-tokens",
    });
    const stats = getTokenUsageStats();
    expect(stats.totalPromptTokens).toBeGreaterThanOrEqual(300);
    expect(stats.callCount).toBeGreaterThanOrEqual(2);
  });
});

describe("llmProvider — callLLM error paths", () => {
  it("rejects when modelId is not in registry", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await expect(callLLM("ghost-model", {
      systemPrompt: "s",
      messages: [{ role: "user", content: "u" }],
    })).rejects.toThrow(/not found/);
  });
});

describe("llmProvider — streaming via MockProvider", () => {
  it("streamLLM emits text_delta and done events", async () => {
    const { streamLLM } = await import("../llmProvider.js");
    queryMock.mockResolvedValueOnce({ rows: [MOCK_MODEL_ROW] });
    registerMockResponses("sess-stream", [
      { thinking: "test", status: "completed", userMessage: "Done" },
    ]);
    const events: string[] = [];
    await streamLLM(
      "mock-llm",
      {
        systemPrompt: "s",
        messages: [{ role: "user", content: "u" }],
        sessionId: "sess-stream",
      },
      (ev) => events.push(ev.type)
    );
    expect(events).toContain("text_delta");
    expect(events).toContain("done");
  });
});
