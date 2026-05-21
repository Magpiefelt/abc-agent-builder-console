/**
 * Tool Dispatcher
 * 
 * Central routing function that dispatches tool calls to the correct handler.
 * 
 * Categories:
 * - **Memory tools**: Operate directly on session state (blackboard, scratchpad, attributes).
 * - **Edge tools**: Call external APIs via registered Phase 3 handlers.
 * 
 * Features:
 * - Pluggable handler registration for Phase 3 tools
 * - Timeout enforcement per tool call (prevents hung tools from blocking the loop)
 * - Structured logging and audit trail for every tool execution
 * - Memory tool size limits (scratchpad 50KB, blackboard entry 10KB)
 * - Artifact persistence to database
 * - Sequential dispatch with memory propagation between calls
 */

import { query } from "../config/database.js";
import { logger } from "./logger.js";
import { auditToolExecution } from "./auditLogger.js";
import type { BlackboardEntry } from "./promptBuilder.js";

// ============================================================================
// TYPES
// ============================================================================

export interface ToolCall {
  tool: string;
  params: Record<string, unknown>;
}

export interface ToolResult {
  tool: string;
  success: boolean;
  result: unknown;
  error?: string;
  durationMs: number;
}

export interface SessionMemory {
  blackboard: BlackboardEntry[];
  scratchpad: string;
  attributes: Record<string, unknown>;
}

export interface ToolContext {
  sessionId: string;
  userId: string;
  ministryCode: string | null;
  iteration: number;
  memory: SessionMemory;
  /**
   * When set, the tool dispatcher is running inside a workflow execution
   * rather than a free-agent session. Memory tools that persist (e.g.
   * create_artifact) write to workflow_execution_id and leave session_id NULL.
   */
  workflowExecutionId?: string | null;
  /**
   * Optional sink for orchestrator-level SSE events emitted by tools
   * (e.g. `artifact_created`). Kept optional so tools never depend on a
   * Response object — the orchestrator wires this when streaming.
   */
  onEvent?: (event: { type: string; [key: string]: unknown }) => void;
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const SCRATCHPAD_MAX_SIZE = 50 * 1024; // 50KB
const BLACKBOARD_ENTRY_MAX_SIZE = 10 * 1024; // 10KB per entry
const BLACKBOARD_MAX_ENTRIES = 200;
const TOOL_TIMEOUT_MS = 30_000; // 30 seconds per tool call
const MAX_ARTIFACT_CONTENT_BYTES = 10 * 1024 * 1024; // 10MB per artifact

// ============================================================================
// EDGE TOOL HANDLER REGISTRY
// ============================================================================

/**
 * Tool handler function signature.
 * Each Phase 3 tool file exports functions matching this signature.
 *
 * `context` is optional — single-arg handlers (e.g. web_scrape) ignore it.
 * Tools that need to persist artifacts, look up ministry scope, or apply
 * per-user rate limits accept it as a second parameter.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EdgeToolHandler = (params: Record<string, unknown>, context?: ToolContext) => Promise<any>;

/**
 * Registry of edge tool handlers.
 * Populated at startup by Phase 3 tool modules calling registerEdgeTool().
 */
const edgeToolHandlers: Map<string, EdgeToolHandler> = new Map();

/**
 * Register a tool handler for a specific tool name.
 */
export function registerEdgeTool(toolName: string, handler: EdgeToolHandler): void {
  edgeToolHandlers.set(toolName, handler);
  logger.info("Edge tool registered", { toolName });
}

/**
 * Register multiple tool handlers at once.
 */
export function registerEdgeTools(handlers: Record<string, EdgeToolHandler>): void {
  for (const [name, handler] of Object.entries(handlers)) {
    edgeToolHandlers.set(name, handler);
  }
  logger.info("Edge tools registered", { count: Object.keys(handlers).length, tools: Object.keys(handlers) });
}

/**
 * Get the count of registered edge tool handlers.
 */
export function getRegisteredToolCount(): number {
  return edgeToolHandlers.size;
}

// ============================================================================
// KNOWN TOOLS
// ============================================================================

const MEMORY_TOOLS = new Set([
  "read_blackboard",
  "write_blackboard",
  "read_scratchpad",
  "write_scratchpad",
  "read_attributes",
  "write_attribute",
  "create_artifact",
]);

const KNOWN_EDGE_TOOLS = new Set([
  "brave_search", "google_search", "web_scrape",
  "read_github_repo", "read_github_file",
  "pdf_extract_text", "pdf_info", "ocr_image",
  "read_zip_contents", "read_zip_file", "extract_zip_files",
  "get_call_api", "post_call_api",
  "execute_sql", "read_database_schemas",
  "image_generation", "elevenlabs_tts",
  "get_time", "get_weather", "send_email",
]);

// ============================================================================
// MEMORY TOOLS
// ============================================================================

function handleMemoryTool(
  toolCall: ToolCall,
  context: ToolContext
): { result: ToolResult; memoryUpdate?: Partial<SessionMemory> } {
  const startTime = Date.now();

  switch (toolCall.tool) {
    case "read_blackboard": {
      const category = toolCall.params.category as string | undefined;
      let entries = context.memory.blackboard;
      if (category) {
        entries = entries.filter((e) => e.category === category);
      }
      return {
        result: {
          tool: toolCall.tool,
          success: true,
          result: { entries, count: entries.length },
          durationMs: Date.now() - startTime,
        },
      };
    }

    case "write_blackboard": {
      const { category, title, content } = toolCall.params as {
        category: string;
        title: string;
        content: string;
      };

      if (!category || !title || !content) {
        return failResult(toolCall.tool, "Missing required parameters: category, title, content", startTime);
      }

      if (content.length > BLACKBOARD_ENTRY_MAX_SIZE) {
        return failResult(toolCall.tool, `Entry content exceeds ${BLACKBOARD_ENTRY_MAX_SIZE / 1024}KB limit. Summarize the content.`, startTime);
      }

      if (context.memory.blackboard.length >= BLACKBOARD_MAX_ENTRIES) {
        return failResult(toolCall.tool, `Blackboard is full (${BLACKBOARD_MAX_ENTRIES} entries). Remove old entries or use the scratchpad.`, startTime);
      }

      const newEntry: BlackboardEntry = {
        category,
        title,
        content,
        iteration: context.iteration,
      };

      return {
        result: {
          tool: toolCall.tool,
          success: true,
          result: { message: `Entry "${title}" added to [${category}].`, entry: newEntry },
          durationMs: Date.now() - startTime,
        },
        memoryUpdate: { blackboard: [...context.memory.blackboard, newEntry] },
      };
    }

    case "read_scratchpad": {
      return {
        result: {
          tool: toolCall.tool,
          success: true,
          result: { content: context.memory.scratchpad, length: context.memory.scratchpad.length },
          durationMs: Date.now() - startTime,
        },
      };
    }

    case "write_scratchpad": {
      const content = toolCall.params.content as string;
      if (content === undefined || content === null) {
        return failResult(toolCall.tool, "Missing required parameter: content", startTime);
      }

      if (content.length > SCRATCHPAD_MAX_SIZE) {
        return failResult(toolCall.tool, `Content exceeds ${SCRATCHPAD_MAX_SIZE / 1024}KB limit (current: ${Math.round(content.length / 1024)}KB). Trim or summarize.`, startTime);
      }

      return {
        result: {
          tool: toolCall.tool,
          success: true,
          result: { message: "Scratchpad updated.", length: content.length },
          durationMs: Date.now() - startTime,
        },
        memoryUpdate: { scratchpad: content },
      };
    }

    case "read_attributes": {
      return {
        result: {
          tool: toolCall.tool,
          success: true,
          result: { attributes: context.memory.attributes },
          durationMs: Date.now() - startTime,
        },
      };
    }

    case "write_attribute": {
      const { key, value } = toolCall.params as { key: string; value: unknown };
      if (!key) {
        return failResult(toolCall.tool, "Missing required parameter: key", startTime);
      }
      if (key.length > 100) {
        return failResult(toolCall.tool, "Attribute key must be 100 characters or less.", startTime);
      }

      const updatedAttributes = { ...context.memory.attributes, [key]: value };

      return {
        result: {
          tool: toolCall.tool,
          success: true,
          result: { message: `Attribute "${key}" set.`, key, value },
          durationMs: Date.now() - startTime,
        },
        memoryUpdate: { attributes: updatedAttributes },
      };
    }

    case "create_artifact": {
      const { title, type, content, mimeType, description } = toolCall.params as {
        title: string;
        type: string;
        content: string;
        mimeType?: string;
        description?: string;
      };

      if (!title || !type || !content) {
        return failResult(toolCall.tool, "Missing required parameters: title, type, content", startTime);
      }

      const validTypes = ["text", "file", "image", "audio", "data"];
      if (!validTypes.includes(type)) {
        return failResult(toolCall.tool, `Invalid type "${type}". Must be one of: ${validTypes.join(", ")}`, startTime);
      }

      // Pre-check the 10MB cap so the agent gets a clear error synchronously
      // rather than a silent fire-and-forget failure.
      const contentSize = Buffer.byteLength(content, "utf-8");
      if (contentSize > MAX_ARTIFACT_CONTENT_BYTES) {
        return failResult(toolCall.tool, `Artifact content exceeds ${MAX_ARTIFACT_CONTENT_BYTES / (1024 * 1024)}MB limit (got ${Math.round(contentSize / (1024 * 1024))}MB).`, startTime);
      }

      // Persist artifact (fire and forget — surfaces errors via logger). Emits artifact_created
      // SSE event via context.onEvent when wired by the orchestrator.
      storeArtifact(context, { title, type, content, mimeType, description }).catch((err) => {
        logger.error("Failed to store artifact", err as Error, { sessionId: context.sessionId, title });
      });

      return {
        result: {
          tool: toolCall.tool,
          success: true,
          result: { message: `Artifact "${title}" created (${type}).`, title, type, size: content.length },
          durationMs: Date.now() - startTime,
        },
      };
    }

    default:
      return failResult(toolCall.tool, `Unknown memory tool: "${toolCall.tool}"`, startTime);
  }
}

// ============================================================================
// EDGE TOOLS
// ============================================================================

/**
 * Handle edge tools with timeout enforcement.
 */
async function handleEdgeTool(
  toolCall: ToolCall,
  context: ToolContext
): Promise<ToolResult> {
  const startTime = Date.now();

  // Validate tool name
  if (!KNOWN_EDGE_TOOLS.has(toolCall.tool)) {
    return {
      tool: toolCall.tool,
      success: false,
      result: null,
      error: `Unknown tool: "${toolCall.tool}".`,
      durationMs: Date.now() - startTime,
    };
  }

  // Check for registered handler
  const handler = edgeToolHandlers.get(toolCall.tool);
  if (handler) {
    try {
      // Execute with timeout (pass context so tools that need it can use it)
      const handlerResult = await withTimeout(
        handler(toolCall.params, context),
        TOOL_TIMEOUT_MS,
        `Tool "${toolCall.tool}" timed out after ${TOOL_TIMEOUT_MS / 1000}s`
      );

      const durationMs = Date.now() - startTime;

      // Audit the execution
      auditToolExecution(context.userId, context.sessionId, toolCall.tool, handlerResult.success, durationMs);

      logger.tool(toolCall.tool, context.sessionId, handlerResult.success, durationMs);

      // Extract result — handlers may return it as `result` or as other named fields
      const success = !!handlerResult.success;
      const error = handlerResult.error as string | undefined;
      const { success: _s, error: _e, ...rest } = handlerResult;
      const resultData = rest.result !== undefined ? rest.result : rest;

      return {
        tool: toolCall.tool,
        success,
        result: resultData,
        error,
        durationMs,
      };
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const errorMsg = (err as Error).message;

      auditToolExecution(context.userId, context.sessionId, toolCall.tool, false, durationMs, { error: errorMsg });
      logger.error(`Tool "${toolCall.tool}" failed`, err as Error, { sessionId: context.sessionId });

      return {
        tool: toolCall.tool,
        success: false,
        result: null,
        error: errorMsg,
        durationMs,
      };
    }
  }

  // No handler registered. `tools/register.ts` is imported from index.ts
  // before any session runs, so every name in `KNOWN_EDGE_TOOLS` should have
  // a handler. A miss here indicates a registration regression worth surfacing.
  return {
    tool: toolCall.tool,
    success: false,
    result: null,
    error: `Tool "${toolCall.tool}" handler not loaded. Phase 3 tool modules may not be initialized.`,
    durationMs: Date.now() - startTime,
  };
}

// ============================================================================
// HELPERS
// ============================================================================

function failResult(tool: string, error: string, startTime: number): { result: ToolResult; memoryUpdate?: undefined } {
  return {
    result: { tool, success: false, result: null, error, durationMs: Date.now() - startTime },
  };
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

/**
 * Persist an artifact to the database and fire the optional SSE callback on
 * the context. Returns the inserted row id and created_at.
 * Exposed so tool handlers (e.g. image_generation, elevenlabs_tts) can persist
 * artifacts they generate.
 */
export async function storeArtifact(
  context: ToolContext,
  artifact: { title: string; type: string; content: string; mimeType?: string; description?: string }
): Promise<{ id: string | null; sizeBytes: number; persisted: boolean }> {
  const sizeBytes = Buffer.byteLength(artifact.content, "utf-8");

  // 10MB cap applies before any persistence attempt so misbehaving tools
  // get a clear synchronous error rather than a silent DB rejection.
  if (sizeBytes > MAX_ARTIFACT_CONTENT_BYTES) {
    throw new Error(
      `Artifact content exceeds ${MAX_ARTIFACT_CONTENT_BYTES / (1024 * 1024)}MB limit (got ${Math.round(sizeBytes / (1024 * 1024))}MB).`
    );
  }

  // An artifact belongs to either a workflow execution (Stream C) or a free-agent
  // session (default). The artifacts table CHECK constraint requires exactly one.
  const isWorkflow = !!context.workflowExecutionId;

  let id: string | null = null;
  let persisted = false;
  try {
    const result = await query<{ id: string }>(
      `INSERT INTO artifacts (session_id, workflow_execution_id, user_id, artifact_type, title, content, description, mime_type, size_bytes, iteration)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        isWorkflow ? null : context.sessionId,
        isWorkflow ? context.workflowExecutionId : null,
        context.userId,
        artifact.type,
        artifact.title,
        artifact.content,
        artifact.description || null,
        artifact.mimeType || null,
        sizeBytes,
        context.iteration,
      ]
    );
    id = result.rows[0]?.id ?? null;
    persisted = id !== null;
  } catch (err) {
    // Persistence failed (e.g. dev mode without a DB). The artifact is still
    // surfaced to the live UI via the SSE event below; downstream consumers
    // that need the row will retry/refresh on next session load.
    logger.warn("Failed to persist artifact, emitting transient SSE only", {
      sessionId: context.sessionId,
      workflowExecutionId: context.workflowExecutionId,
      title: artifact.title,
      error: (err as Error).message,
    });
  }

  context.onEvent?.({
    type: "artifact_created",
    iteration: context.iteration,
    artifact: {
      id,
      title: artifact.title,
      type: artifact.type,
      mimeType: artifact.mimeType ?? null,
      description: artifact.description ?? null,
      size: sizeBytes,
    },
  });

  return { id, sizeBytes, persisted };
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Dispatch a single tool call to the appropriate handler.
 */
export async function dispatchTool(
  toolCall: ToolCall,
  context: ToolContext
): Promise<{ result: ToolResult; memoryUpdate?: Partial<SessionMemory> }> {
  if (!toolCall.tool || typeof toolCall.tool !== "string") {
    return {
      result: { tool: toolCall.tool || "unknown", success: false, result: null, error: "Invalid tool call: missing tool name.", durationMs: 0 },
    };
  }

  if (MEMORY_TOOLS.has(toolCall.tool)) {
    return handleMemoryTool(toolCall, context);
  }

  const result = await handleEdgeTool(toolCall, context);
  return { result };
}

/**
 * Dispatch multiple tool calls sequentially.
 * Memory updates from each call are applied before the next.
 */
export async function dispatchToolCalls(
  toolCalls: ToolCall[],
  context: ToolContext
): Promise<{ results: ToolResult[]; finalMemory: SessionMemory }> {
  const results: ToolResult[] = [];
  let currentMemory: SessionMemory = {
    blackboard: [...context.memory.blackboard],
    scratchpad: context.memory.scratchpad,
    attributes: { ...context.memory.attributes },
  };

  for (const toolCall of toolCalls) {
    const currentContext = { ...context, memory: currentMemory };
    const { result, memoryUpdate } = await dispatchTool(toolCall, currentContext);
    results.push(result);

    if (memoryUpdate) {
      if (memoryUpdate.blackboard) currentMemory.blackboard = memoryUpdate.blackboard;
      if (memoryUpdate.scratchpad !== undefined) currentMemory.scratchpad = memoryUpdate.scratchpad;
      if (memoryUpdate.attributes) currentMemory.attributes = memoryUpdate.attributes;
    }
  }

  return { results, finalMemory: currentMemory };
}

/**
 * Check if a tool name is a memory tool.
 */
export function isMemoryTool(toolName: string): boolean {
  return MEMORY_TOOLS.has(toolName);
}

/**
 * Get the list of all known tool names.
 */
export function getKnownTools(): string[] {
  return [...Array.from(MEMORY_TOOLS), ...Array.from(KNOWN_EDGE_TOOLS)];
}
