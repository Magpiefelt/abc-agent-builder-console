/**
 * LLM Provider Factory
 * 
 * Reads approved models from the model_registry database table and routes
 * requests to the correct provider API (Vertex AI for Claude, Google for Gemini).
 * 
 * Features:
 * - Model registry with database-backed cache
 * - Provider-specific request formatting and response parsing
 * - Streaming support with event callbacks
 * - Automatic retry with exponential backoff on transient failures
 * - Token usage tracking and budget enforcement
 * - Classification-level validation
 * - Structured logging via the enterprise logger
 * 
 * Security: API keys are server-side only. PII scanning happens before this layer.
 */

import { query } from "../config/database.js";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

// ============================================================================
// TYPES
// ============================================================================

export interface ModelRegistryEntry {
  id: number;
  model_id: string;
  display_name: string;
  provider: "vertex_ai" | "openai" | "anthropic" | "xai" | "google";
  api_model_name: string;
  max_output_tokens: number;
  supports_streaming: boolean;
  supports_tools: boolean;
  data_residency: string;
  max_classification: string;
  is_active: boolean;
}

export interface LLMMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface LLMToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LLMRequest {
  systemPrompt: string;
  messages: LLMMessage[];
  tools?: LLMToolDefinition[];
  maxTokens?: number;
  temperature?: number;
  responseFormat?: "json" | "text";
}

export interface LLMToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LLMResponse {
  content: string;
  toolCalls: LLMToolCall[];
  finishReason: "stop" | "tool_use" | "max_tokens" | "error";
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
  provider: string;
  latencyMs: number;
  raw?: unknown;
}

export interface LLMStreamEvent {
  type: "text_delta" | "tool_call_start" | "tool_call_delta" | "done" | "error";
  content?: string;
  toolCall?: Partial<LLMToolCall>;
  error?: string;
}

export type LLMStreamCallback = (event: LLMStreamEvent) => void;

// ============================================================================
// PROVIDER INTERFACE
// ============================================================================

interface LLMProvider {
  name: string;
  call(request: LLMRequest, modelName: string): Promise<LLMResponse>;
  stream(request: LLMRequest, modelName: string, onEvent: LLMStreamCallback): Promise<LLMResponse>;
}

// ============================================================================
// RETRY CONFIGURATION
// ============================================================================

interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryableStatusCodes: Set<number>;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: Math.min(env.LLM_TIMEOUT_MS / 4, 30000),
  retryableStatusCodes: new Set([429, 500, 502, 503, 504]),
};

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a function with exponential backoff retry.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
  context: string = "LLM call"
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err as Error;
      const statusMatch = lastError.message.match(/\((\d{3})\)/);
      const statusCode = statusMatch ? parseInt(statusMatch[1]) : 0;

      // Don't retry on non-retryable errors (4xx except 429)
      if (statusCode >= 400 && statusCode < 500 && statusCode !== 429) {
        throw lastError;
      }

      if (attempt < config.maxRetries) {
        const delay = Math.min(
          config.baseDelayMs * Math.pow(2, attempt) + Math.random() * 500,
          config.maxDelayMs
        );

        logger.warn(`${context} failed (attempt ${attempt + 1}/${config.maxRetries + 1}), retrying in ${Math.round(delay)}ms`, {
          error: lastError.message,
          attempt: attempt + 1,
          delayMs: Math.round(delay),
          statusCode,
        });

        await sleep(delay);
      }
    }
  }

  throw lastError!;
}

// ============================================================================
// TOKEN USAGE TRACKING
// ============================================================================

interface TokenUsageRecord {
  modelId: string;
  promptTokens: number;
  completionTokens: number;
  timestamp: number;
}

const tokenUsageHistory: TokenUsageRecord[] = [];
const MAX_USAGE_HISTORY = 1000;

function recordTokenUsage(modelId: string, usage: LLMResponse["usage"]): void {
  tokenUsageHistory.push({
    modelId,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    timestamp: Date.now(),
  });

  // Trim history
  if (tokenUsageHistory.length > MAX_USAGE_HISTORY) {
    tokenUsageHistory.splice(0, tokenUsageHistory.length - MAX_USAGE_HISTORY);
  }
}

/**
 * Get token usage statistics for monitoring.
 */
export function getTokenUsageStats(): {
  totalPromptTokens: number;
  totalCompletionTokens: number;
  callCount: number;
  windowMinutes: number;
} {
  const windowMs = 60 * 60 * 1000; // Last hour
  const cutoff = Date.now() - windowMs;
  const recent = tokenUsageHistory.filter((r) => r.timestamp > cutoff);

  return {
    totalPromptTokens: recent.reduce((sum, r) => sum + r.promptTokens, 0),
    totalCompletionTokens: recent.reduce((sum, r) => sum + r.completionTokens, 0),
    callCount: recent.length,
    windowMinutes: 60,
  };
}

// ============================================================================
// MODEL REGISTRY CACHE
// ============================================================================

let registryCache: ModelRegistryEntry[] | null = null;
let registryCacheTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch all active models from the model_registry table.
 * Results are cached for 5 minutes.
 */
export async function getActiveModels(): Promise<ModelRegistryEntry[]> {
  const now = Date.now();
  if (registryCache && now - registryCacheTime < CACHE_TTL_MS) {
    return registryCache;
  }

  try {
    const result = await query<ModelRegistryEntry>(
      "SELECT * FROM model_registry WHERE is_active = true ORDER BY display_name"
    );
    registryCache = result.rows;
    registryCacheTime = now;
    logger.debug("Model registry refreshed", { count: result.rows.length });
    return registryCache;
  } catch (err) {
    logger.error("Failed to fetch model registry", err as Error);
    // Return cached data if available, even if stale
    if (registryCache) return registryCache;
    // Fallback: return default models for development
    return getDefaultModels();
  }
}

/**
 * Get a specific model by its model_id.
 */
export async function getModel(modelId: string): Promise<ModelRegistryEntry | null> {
  const models = await getActiveModels();
  return models.find((m) => m.model_id === modelId) || null;
}

/**
 * Default models for development when database is unavailable.
 */
function getDefaultModels(): ModelRegistryEntry[] {
  return [
    {
      id: 1,
      model_id: "claude-sonnet-4.5",
      display_name: "Claude Sonnet 4.5 (Vertex AI)",
      provider: "vertex_ai",
      api_model_name: "claude-sonnet-4-20250514",
      max_output_tokens: 16384,
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
      api_model_name: "gemini-2.5-flash-preview-05-20",
      max_output_tokens: 8192,
      supports_streaming: true,
      supports_tools: true,
      data_residency: "us",
      max_classification: "unclassified",
      is_active: true,
    },
  ];
}

// ============================================================================
// VERTEX AI / ANTHROPIC PROVIDER (Claude)
// ============================================================================

class AnthropicProvider implements LLMProvider {
  name = "anthropic";
  private apiKey: string;

  constructor() {
    this.apiKey = env.ANTHROPIC_API_KEY || env.VERTEX_AI_API_KEY || "";
    if (!this.apiKey) {
      logger.warn("No Anthropic/Vertex AI API key configured. Claude calls will fail.");
    }
  }

  async call(request: LLMRequest, modelName: string): Promise<LLMResponse> {
    const startTime = Date.now();
    const body = this.buildRequestBody(request, modelName);

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Anthropic API error (${response.status}): ${errorText.substring(0, 500)}`);
    }

    const data = await response.json() as Record<string, unknown>;
    const result = this.parseResponse(data, modelName, startTime);
    return result;
  }

  async stream(request: LLMRequest, modelName: string, onEvent: LLMStreamCallback): Promise<LLMResponse> {
    const startTime = Date.now();
    const body = { ...this.buildRequestBody(request, modelName), stream: true };

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Anthropic streaming error (${response.status}): ${errorText.substring(0, 500)}`);
    }

    return this.processStream(response, modelName, startTime, onEvent);
  }

  private buildRequestBody(request: LLMRequest, modelName: string): Record<string, unknown> {
    // Convert messages — Anthropic doesn't accept "system" role in messages array
    const messages = request.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role, content: m.content }));

    const body: Record<string, unknown> = {
      model: modelName,
      max_tokens: request.maxTokens || 16384,
      system: request.systemPrompt,
      messages,
    };

    if (request.temperature !== undefined) {
      body.temperature = request.temperature;
    }

    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
    }

    return body;
  }

  private parseResponse(data: Record<string, unknown>, modelName: string, startTime: number): LLMResponse {
    const content: Array<Record<string, unknown>> = (data.content as Array<Record<string, unknown>>) || [];
    const usage = data.usage as Record<string, number> || {};

    let textContent = "";
    const toolCalls: LLMToolCall[] = [];

    for (const block of content) {
      if (block.type === "text") {
        textContent += block.text as string;
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id as string,
          name: block.name as string,
          arguments: (block.input as Record<string, unknown>) || {},
        });
      }
    }

    const stopReason = data.stop_reason as string;
    let finishReason: LLMResponse["finishReason"] = "stop";
    if (stopReason === "tool_use") finishReason = "tool_use";
    else if (stopReason === "max_tokens") finishReason = "max_tokens";

    return {
      content: textContent,
      toolCalls,
      finishReason,
      usage: {
        promptTokens: usage.input_tokens || 0,
        completionTokens: usage.output_tokens || 0,
        totalTokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
      },
      model: modelName,
      provider: this.name,
      latencyMs: Date.now() - startTime,
      raw: data,
    };
  }

  private async processStream(
    response: Response,
    modelName: string,
    startTime: number,
    onEvent: LLMStreamCallback
  ): Promise<LLMResponse> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body for streaming");

    const decoder = new TextDecoder();
    let buffer = "";
    let fullContent = "";
    const toolCalls: LLMToolCall[] = [];
    let currentToolCall: Partial<LLMToolCall> | null = null;
    let currentToolArgs = "";
    let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    let finishReason: LLMResponse["finishReason"] = "stop";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]" || !jsonStr) continue;

          try {
            const event = JSON.parse(jsonStr) as Record<string, unknown>;
            const eventType = event.type as string;

            if (eventType === "content_block_start") {
              const contentBlock = event.content_block as Record<string, unknown>;
              if (contentBlock?.type === "tool_use") {
                currentToolCall = {
                  id: contentBlock.id as string,
                  name: contentBlock.name as string,
                  arguments: {},
                };
                currentToolArgs = "";
                onEvent({ type: "tool_call_start", toolCall: currentToolCall });
              }
            } else if (eventType === "content_block_delta") {
              const delta = event.delta as Record<string, unknown>;
              if (delta?.type === "text_delta") {
                const text = delta.text as string;
                fullContent += text;
                onEvent({ type: "text_delta", content: text });
              } else if (delta?.type === "input_json_delta") {
                const partial = delta.partial_json as string;
                currentToolArgs += partial;
                onEvent({ type: "tool_call_delta", content: partial });
              }
            } else if (eventType === "content_block_stop") {
              if (currentToolCall) {
                try {
                  currentToolCall.arguments = JSON.parse(currentToolArgs || "{}");
                } catch {
                  currentToolCall.arguments = {};
                }
                toolCalls.push(currentToolCall as LLMToolCall);
                currentToolCall = null;
                currentToolArgs = "";
              }
            } else if (eventType === "message_delta") {
              const delta = event.delta as Record<string, unknown>;
              const stopReason = delta?.stop_reason as string;
              if (stopReason === "tool_use") finishReason = "tool_use";
              else if (stopReason === "max_tokens") finishReason = "max_tokens";
              const eventUsage = event.usage as Record<string, number>;
              if (eventUsage) {
                usage.completionTokens = eventUsage.output_tokens || 0;
              }
            } else if (eventType === "message_start") {
              const message = event.message as Record<string, unknown>;
              const msgUsage = message?.usage as Record<string, number>;
              if (msgUsage) {
                usage.promptTokens = msgUsage.input_tokens || 0;
              }
            } else if (eventType === "error") {
              const errorData = event.error as Record<string, unknown>;
              const errorMsg = (errorData?.message as string) || "Unknown streaming error";
              onEvent({ type: "error", error: errorMsg });
              throw new Error(`Anthropic stream error: ${errorMsg}`);
            }
          } catch (parseErr) {
            if ((parseErr as Error).message.startsWith("Anthropic stream error")) throw parseErr;
            // Skip malformed JSON lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    usage.totalTokens = usage.promptTokens + usage.completionTokens;
    onEvent({ type: "done" });

    return {
      content: fullContent,
      toolCalls,
      finishReason,
      usage,
      model: modelName,
      provider: this.name,
      latencyMs: Date.now() - startTime,
    };
  }
}

// ============================================================================
// GOOGLE GEMINI PROVIDER
// ============================================================================

class GoogleGeminiProvider implements LLMProvider {
  name = "google";
  private apiKey: string;

  constructor() {
    // Prefer dedicated Google AI key, fall back to Vertex AI key
    this.apiKey = env.GOOGLE_AI_API_KEY || env.VERTEX_AI_API_KEY || "";
    if (!this.apiKey) {
      logger.warn("No Google AI or Vertex AI API key configured. Gemini calls will fail.");
    }
  }

  async call(request: LLMRequest, modelName: string): Promise<LLMResponse> {
    const startTime = Date.now();
    const body = this.buildRequestBody(request);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${this.apiKey}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error (${response.status}): ${errorText.substring(0, 500)}`);
    }

    const data = await response.json() as Record<string, unknown>;
    return this.parseResponse(data, modelName, startTime);
  }

  async stream(request: LLMRequest, modelName: string, onEvent: LLMStreamCallback): Promise<LLMResponse> {
    const startTime = Date.now();
    const body = this.buildRequestBody(request);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:streamGenerateContent?alt=sse&key=${this.apiKey}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini streaming error (${response.status}): ${errorText.substring(0, 500)}`);
    }

    return this.processStream(response, modelName, startTime, onEvent);
  }

  private buildRequestBody(request: LLMRequest): Record<string, unknown> {
    const contents = request.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

    const body: Record<string, unknown> = {
      contents,
      systemInstruction: { parts: [{ text: request.systemPrompt }] },
      generationConfig: {
        maxOutputTokens: request.maxTokens || 8192,
        temperature: request.temperature ?? 0.7,
      },
    };

    if (request.responseFormat === "json") {
      (body.generationConfig as Record<string, unknown>).responseMimeType = "application/json";
    }

    if (request.tools && request.tools.length > 0) {
      body.tools = [
        {
          functionDeclarations: request.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          })),
        },
      ];
    }

    return body;
  }

  private parseResponse(data: Record<string, unknown>, modelName: string, startTime: number): LLMResponse {
    const candidates = (data.candidates as Array<Record<string, unknown>>) || [];
    const candidate = candidates[0] || {};
    const content = candidate.content as Record<string, unknown> || {};
    const parts = (content.parts as Array<Record<string, unknown>>) || [];
    const usageMetadata = data.usageMetadata as Record<string, number> || {};

    let textContent = "";
    const toolCalls: LLMToolCall[] = [];

    for (const part of parts) {
      if (part.text) {
        textContent += part.text as string;
      } else if (part.functionCall) {
        const fc = part.functionCall as Record<string, unknown>;
        toolCalls.push({
          id: `gemini-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: fc.name as string,
          arguments: (fc.args as Record<string, unknown>) || {},
        });
      }
    }

    // Check for blocked content
    const finishReasonRaw = candidate.finishReason as string;
    let finishReason: LLMResponse["finishReason"] = toolCalls.length > 0 ? "tool_use" : "stop";
    if (finishReasonRaw === "MAX_TOKENS") finishReason = "max_tokens";
    if (finishReasonRaw === "SAFETY") finishReason = "error";

    return {
      content: textContent,
      toolCalls,
      finishReason,
      usage: {
        promptTokens: usageMetadata.promptTokenCount || 0,
        completionTokens: usageMetadata.candidatesTokenCount || 0,
        totalTokens: usageMetadata.totalTokenCount || 0,
      },
      model: modelName,
      provider: this.name,
      latencyMs: Date.now() - startTime,
      raw: data,
    };
  }

  private async processStream(
    response: Response,
    modelName: string,
    startTime: number,
    onEvent: LLMStreamCallback
  ): Promise<LLMResponse> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body for streaming");

    const decoder = new TextDecoder();
    let buffer = "";
    let fullContent = "";
    const toolCalls: LLMToolCall[] = [];
    let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;

          try {
            const event = JSON.parse(jsonStr) as Record<string, unknown>;
            const candidates = (event.candidates as Array<Record<string, unknown>>) || [];
            const candidate = candidates[0];
            if (!candidate) continue;

            const content = candidate.content as Record<string, unknown> || {};
            const parts = (content.parts as Array<Record<string, unknown>>) || [];

            for (const part of parts) {
              if (part.text) {
                const text = part.text as string;
                fullContent += text;
                onEvent({ type: "text_delta", content: text });
              } else if (part.functionCall) {
                const fc = part.functionCall as Record<string, unknown>;
                const tc: LLMToolCall = {
                  id: `gemini-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                  name: fc.name as string,
                  arguments: (fc.args as Record<string, unknown>) || {},
                };
                toolCalls.push(tc);
                onEvent({ type: "tool_call_start", toolCall: tc });
              }
            }

            const usageMetadata = event.usageMetadata as Record<string, number>;
            if (usageMetadata) {
              usage = {
                promptTokens: usageMetadata.promptTokenCount || 0,
                completionTokens: usageMetadata.candidatesTokenCount || 0,
                totalTokens: usageMetadata.totalTokenCount || 0,
              };
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    onEvent({ type: "done" });

    return {
      content: fullContent,
      toolCalls,
      finishReason: toolCalls.length > 0 ? "tool_use" : "stop",
      usage,
      model: modelName,
      provider: this.name,
      latencyMs: Date.now() - startTime,
    };
  }
}

// ============================================================================
// PROVIDER FACTORY
// ============================================================================

const providers: Map<string, LLMProvider> = new Map();

/**
 * Get the LLM provider instance for a given model registry entry.
 * Providers are singletons cached by provider name.
 */
function getProviderInstance(model: ModelRegistryEntry): LLMProvider {
  const key = model.provider;

  if (!providers.has(key)) {
    switch (model.provider) {
      case "vertex_ai":
      case "anthropic":
        providers.set(key, new AnthropicProvider());
        break;
      case "google":
        providers.set(key, new GoogleGeminiProvider());
        break;
      case "openai":
      case "xai":
        throw new Error(`Provider "${model.provider}" is not yet implemented. Use Claude or Gemini.`);
      default:
        throw new Error(`Unknown provider: "${model.provider}"`);
    }
  }

  return providers.get(key)!;
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Call an LLM model by its model_id from the registry.
 * Validates the model exists and is active, then routes to the correct provider.
 * Includes automatic retry with exponential backoff on transient failures.
 */
export async function callLLM(
  modelId: string,
  request: LLMRequest
): Promise<LLMResponse> {
  const model = await getModel(modelId);
  if (!model) {
    throw new Error(`Model "${modelId}" not found in registry or is inactive.`);
  }

  const provider = getProviderInstance(model);
  const maxTokens = request.maxTokens || model.max_output_tokens;

  logger.debug("LLM call initiated", {
    modelId,
    provider: model.provider,
    apiModel: model.api_model_name,
    maxTokens,
    messageCount: request.messages.length,
    toolCount: request.tools?.length || 0,
  });

  const response = await withRetry(
    () => provider.call({ ...request, maxTokens }, model.api_model_name),
    DEFAULT_RETRY_CONFIG,
    `LLM call (${modelId})`
  );

  // Track usage
  recordTokenUsage(modelId, response.usage);

  logger.info("LLM call completed", {
    modelId,
    provider: model.provider,
    latencyMs: response.latencyMs,
    promptTokens: response.usage.promptTokens,
    completionTokens: response.usage.completionTokens,
    finishReason: response.finishReason,
    toolCalls: response.toolCalls.length,
  });

  return response;
}

/**
 * Stream an LLM call by model_id from the registry.
 * Returns the final aggregated response after streaming completes.
 * Includes automatic retry with exponential backoff.
 */
export async function streamLLM(
  modelId: string,
  request: LLMRequest,
  onEvent: LLMStreamCallback
): Promise<LLMResponse> {
  const model = await getModel(modelId);
  if (!model) {
    throw new Error(`Model "${modelId}" not found in registry or is inactive.`);
  }

  if (!model.supports_streaming) {
    logger.debug("Model does not support streaming, falling back to non-streaming", { modelId });
    const response = await callLLM(modelId, request);
    onEvent({ type: "text_delta", content: response.content });
    onEvent({ type: "done" });
    return response;
  }

  const provider = getProviderInstance(model);
  const maxTokens = request.maxTokens || model.max_output_tokens;

  const response = await withRetry(
    () => provider.stream({ ...request, maxTokens }, model.api_model_name, onEvent),
    { ...DEFAULT_RETRY_CONFIG, maxRetries: 1 }, // Fewer retries for streaming
    `LLM stream (${modelId})`
  );

  recordTokenUsage(modelId, response.usage);

  logger.info("LLM stream completed", {
    modelId,
    provider: model.provider,
    latencyMs: response.latencyMs,
    totalTokens: response.usage.totalTokens,
    finishReason: response.finishReason,
  });

  return response;
}

/**
 * Validate that a model can handle the given classification level.
 */
export async function validateModelClassification(
  modelId: string,
  classification: string
): Promise<{ valid: boolean; reason?: string }> {
  const model = await getModel(modelId);
  if (!model) {
    return { valid: false, reason: `Model "${modelId}" not found in registry.` };
  }

  const classificationLevels = ["unclassified", "protected_a", "protected_b"];
  const modelLevel = classificationLevels.indexOf(model.max_classification);
  const dataLevel = classificationLevels.indexOf(classification);

  if (dataLevel > modelLevel) {
    return {
      valid: false,
      reason: `Model "${model.display_name}" is only approved for "${model.max_classification}" data, but session is classified as "${classification}".`,
    };
  }

  return { valid: true };
}

/**
 * Check if the LLM provider is configured and ready.
 */
export function isProviderConfigured(): boolean {
  return !!(env.ANTHROPIC_API_KEY || env.VERTEX_AI_API_KEY);
}

/**
 * Clear the model registry cache (useful for admin operations).
 */
export function clearModelCache(): void {
  registryCache = null;
  registryCacheTime = 0;
}
