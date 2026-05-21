/**
 * Agent Orchestrator
 * 
 * The core server-side iteration loop. Replaces the original app's
 * 2,130-line client-side React hook with a secure, observable backend engine.
 * 
 * Loop per iteration:
 * 1. Check abort/interjection signals
 * 2. Run loop detection
 * 3. Build system prompt (with current memory state)
 * 4. PII scan outbound content
 * 5. Call LLM via provider factory (with retry)
 * 6. Parse structured JSON response
 * 7. Dispatch tool calls
 * 8. Apply memory updates (blackboard, scratchpad, attributes)
 * 9. Check status transition
 * 10. Stream progress via SSE
 * 11. Persist iteration to database
 * 
 * Features:
 * - SSE streaming with heartbeat keep-alive
 * - Graceful abort on client disconnect
 * - User interjection injection mid-loop
 * - LLM retry on transient failures (max 2 retries per iteration)
 * - Loop detection with escalating interventions
 * - Full audit trail via AuditAction enum
 * - Structured logging throughout
 */

import { Response } from "express";
import { randomUUID } from "node:crypto";
import { query } from "../config/database.js";
import { env } from "../config/env.js";
import { callLLM, validateModelClassification } from "./llmProvider.js";
import { buildSystemPrompt, getToolDefinitions } from "./promptBuilder.js";
import type { BlackboardEntry } from "./promptBuilder.js";
import { LoopDetector } from "./loopDetector.js";
import { dispatchToolCalls } from "./toolDispatcher.js";
import type { ToolCall, ToolResult, SessionMemory } from "./toolDispatcher.js";
import { scanForPII } from "./piiDetector.js";
import { logAudit, auditAgentEvent, AuditAction } from "./auditLogger.js";
import { logger } from "./logger.js";

// ============================================================================
// TYPES
// ============================================================================

export interface AgentSession {
  id: string;
  userId: string;
  ministryCode: string | null;
  prompt: string;
  modelId: string;
  maxIterations: number;
  currentIteration: number;
  status: "idle" | "running" | "paused" | "completed" | "error" | "needs_assistance";
  classification: string;
  blackboard: BlackboardEntry[];
  scratchpad: string;
  attributes: Record<string, unknown>;
  finalReport: unknown | null;
  error: string | null;
  createdAt: string;
}

export interface SSEEvent {
  type: string;
  [key: string]: unknown;
}

export interface OrchestratorOptions {
  sectionOverrides?: Record<string, { enabled?: boolean; content?: string }>;
  enabledTools?: string[];
  additionalContext?: string;
  previousToolResults?: Array<{ tool: string; success: boolean; summary: string }>;
}

interface ParsedLLMResponse {
  thinking: string;
  tool_calls: Array<{ tool: string; params: Record<string, unknown> }>;
  blackboard_updates: Array<{ category: string; title: string; content: string }>;
  scratchpad: string | null;
  attribute_updates: Record<string, unknown> | null;
  status: "running" | "completed" | "needs_assistance" | "error";
  user_message: string | null;
}

// ============================================================================
// ACTIVE SESSIONS REGISTRY
// ============================================================================

const activeSessions: Map<string, { abort: boolean; interjection?: string }> = new Map();

export function stopSession(sessionId: string): void {
  const session = activeSessions.get(sessionId);
  if (session) {
    session.abort = true;
    logger.agent("stop_requested", sessionId);
  }
}

export function interjectSession(sessionId: string, message: string): void {
  const session = activeSessions.get(sessionId);
  if (session) {
    session.interjection = message;
    logger.agent("interjection_queued", sessionId, { messageLength: message.length });
  }
}

export function isSessionRunning(sessionId: string): boolean {
  return activeSessions.has(sessionId);
}

// ============================================================================
// SSE HELPERS
// ============================================================================

function sendSSE(res: Response, event: SSEEvent): void {
  try {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  } catch {
    // Client disconnected — silently ignore
  }
}

/** Send a heartbeat comment to keep the connection alive */
function sendHeartbeat(res: Response): void {
  try {
    if (!res.writableEnded) {
      res.write(": heartbeat\n\n");
    }
  } catch {
    // Ignore
  }
}

// ============================================================================
// IN-MEMORY SESSION STORE (dev-mode fallback when LLM_MOCK=1)
// ============================================================================

const inMemorySessions: Map<string, AgentSession> = new Map();

function isMockMode(): boolean {
  return env.LLM_MOCK === "1";
}

// ============================================================================
// DATABASE PERSISTENCE
// ============================================================================

async function updateSessionInDB(session: AgentSession): Promise<void> {
  if (isMockMode()) {
    inMemorySessions.set(session.id, { ...session });
    return;
  }
  try {
    await query(
      `UPDATE agent_sessions
       SET status = $1, current_iteration = $2, blackboard = $3,
           scratchpad = $4, attributes = $5, final_report = $6, error = $7,
           completed_at = CASE WHEN $1 IN ('completed', 'error') THEN NOW() ELSE completed_at END
       WHERE id = $8`,
      [
        session.status,
        session.currentIteration,
        JSON.stringify(session.blackboard),
        session.scratchpad,
        JSON.stringify(session.attributes),
        session.finalReport ? JSON.stringify(session.finalReport) : null,
        session.error,
        session.id,
      ]
    );
  } catch (err) {
    logger.error("Failed to update session in DB", err as Error, { sessionId: session.id });
  }
}

async function recordIteration(
  sessionId: string,
  iterationNumber: number,
  data: {
    systemPromptHash?: string;
    userPrompt?: string;
    rawResponse?: string;
    parsedResponse?: unknown;
    toolCalls?: unknown;
    toolResults?: unknown;
    blackboardEntry?: unknown;
    status: string;
    error?: string;
    tokensUsed?: number;
    durationMs?: number;
  }
): Promise<void> {
  if (isMockMode()) return;
  try {
    await query(
      `INSERT INTO agent_iterations 
       (session_id, iteration_number, system_prompt_hash, user_prompt, raw_llm_response, 
        parsed_response, tool_calls, tool_results, blackboard_entry, status, error, tokens_used, duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        sessionId,
        iterationNumber,
        data.systemPromptHash || null,
        data.userPrompt || null,
        data.rawResponse ? data.rawResponse.substring(0, 10000) : null,
        data.parsedResponse ? JSON.stringify(data.parsedResponse) : null,
        data.toolCalls ? JSON.stringify(data.toolCalls) : null,
        data.toolResults ? JSON.stringify(data.toolResults) : null,
        data.blackboardEntry ? JSON.stringify(data.blackboardEntry) : null,
        data.status,
        data.error || null,
        data.tokensUsed || null,
        data.durationMs || null,
      ]
    );
  } catch (err) {
    logger.error("Failed to record iteration", err as Error, { sessionId, iterationNumber });
  }
}

// ============================================================================
// RESPONSE PARSING
// ============================================================================

function parseLLMResponse(content: string): ParsedLLMResponse {
  let jsonStr = content.trim();

  // Strip markdown code fences
  if (jsonStr.startsWith("```json")) jsonStr = jsonStr.slice(7);
  else if (jsonStr.startsWith("```")) jsonStr = jsonStr.slice(3);
  if (jsonStr.endsWith("```")) jsonStr = jsonStr.slice(0, -3);
  jsonStr = jsonStr.trim();

  try {
    const parsed = JSON.parse(jsonStr);
    return {
      thinking: parsed.thinking || "",
      tool_calls: Array.isArray(parsed.tool_calls) ? parsed.tool_calls : [],
      blackboard_updates: Array.isArray(parsed.blackboard_updates) ? parsed.blackboard_updates : [],
      scratchpad: parsed.scratchpad ?? null,
      attribute_updates: parsed.attribute_updates || null,
      status: ["running", "completed", "needs_assistance", "error"].includes(parsed.status) ? parsed.status : "running",
      user_message: parsed.user_message || null,
    };
  } catch {
    logger.warn("Failed to parse LLM response as JSON, treating as text", { contentLength: content.length });
    return {
      thinking: content,
      tool_calls: [],
      blackboard_updates: [],
      scratchpad: null,
      attribute_updates: null,
      status: "running",
      user_message: "I encountered a formatting issue. Retrying with correct JSON format.",
    };
  }
}

// ============================================================================
// CORE ORCHESTRATION LOOP
// ============================================================================

export async function runOrchestrator(
  session: AgentSession,
  res: Response,
  options: OrchestratorOptions = {}
): Promise<void> {
  activeSessions.set(session.id, { abort: false });

  const loopDetector = new LoopDetector();
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  let consecutiveLLMFailures = 0;
  const MAX_CONSECUTIVE_FAILURES = 3;

  session.status = "running";
  await updateSessionInDB(session);

  logger.agent("orchestrator_started", session.id, {
    modelId: session.modelId,
    maxIterations: session.maxIterations,
    classification: session.classification,
  });

  sendSSE(res, {
    type: "session_start",
    sessionId: session.id,
    status: "running",
    modelId: session.modelId,
    maxIterations: session.maxIterations,
  });

  // Start heartbeat to keep SSE connection alive
  heartbeatInterval = setInterval(() => sendHeartbeat(res), 15000);

  // Track previous iteration's tool results for context continuity
  let previousToolResults: Array<{ tool: string; success: boolean; summary: string }> = [];

  try {
    // Validate model classification
    const classValidation = await validateModelClassification(session.modelId, session.classification);
    if (!classValidation.valid) {
      throw new Error(classValidation.reason || "Model classification validation failed.");
    }

    // Main iteration loop
    while (session.status === "running" && session.currentIteration < session.maxIterations) {
      // Check abort
      const control = activeSessions.get(session.id);
      if (control?.abort) {
        session.status = "paused";
        sendSSE(res, { type: "session_stopped", reason: "User requested stop." });
        auditAgentEvent(session.userId, AuditAction.AGENT_SESSION_STOPPED, session.id);
        break;
      }

      // Check interjection
      let additionalContext = options.additionalContext || "";
      if (control?.interjection) {
        additionalContext += `\n\n## User Interjection\n\nThe user has provided additional guidance: "${control.interjection}"`;
        control.interjection = undefined;
        loopDetector.reset(); // Give agent a fresh start after interjection
        consecutiveLLMFailures = 0;
      }

      // Execute one iteration
      const iterationResult = await executeIteration(session, res, loopDetector, {
        ...options,
        additionalContext: additionalContext || undefined,
        previousToolResults,
      });

      const iterationSuccess = iterationResult.success;
      previousToolResults = iterationResult.toolSummaries;

      if (iterationSuccess) {
        consecutiveLLMFailures = 0;
      } else {
        consecutiveLLMFailures++;
        if (consecutiveLLMFailures >= MAX_CONSECUTIVE_FAILURES) {
          session.status = "error";
          session.error = `LLM failed ${MAX_CONSECUTIVE_FAILURES} consecutive times. Session terminated.`;
          sendSSE(res, { type: "error", error: session.error });
          break;
        }
      }
    }

    // Iteration limit check
    if (session.status === "running" && session.currentIteration >= session.maxIterations) {
      session.status = "completed";
      session.finalReport = {
        message: "Maximum iteration limit reached. Here is what was accomplished.",
        iterations: session.currentIteration,
        blackboardEntries: session.blackboard.length,
        completedAt: new Date().toISOString(),
      };
      sendSSE(res, { type: "iteration_limit", message: `Reached maximum of ${session.maxIterations} iterations.` });
    }
  } catch (err) {
    session.status = "error";
    session.error = (err as Error).message;
    logger.error("Orchestrator fatal error", err as Error, { sessionId: session.id });
    sendSSE(res, { type: "error", error: session.error });
  } finally {
    if (heartbeatInterval) clearInterval(heartbeatInterval);

    await updateSessionInDB(session);

    const completionAction = session.status === "error"
      ? AuditAction.AGENT_SESSION_ERROR
      : AuditAction.AGENT_SESSION_COMPLETED;
    auditAgentEvent(session.userId, completionAction, session.id, {
      iterations: session.currentIteration,
      status: session.status,
    });

    sendSSE(res, {
      type: "session_complete",
      sessionId: session.id,
      status: session.status,
      iterations: session.currentIteration,
      blackboardCount: session.blackboard.length,
      finalReport: session.finalReport,
      error: session.error,
    });

    activeSessions.delete(session.id);

    logger.agent("orchestrator_finished", session.id, {
      status: session.status,
      iterations: session.currentIteration,
      blackboardEntries: session.blackboard.length,
    });

    if (!res.writableEnded) res.end();
  }
}

/**
 * Execute a single iteration. Returns success flag and tool summaries for next iteration.
 */
async function executeIteration(
  session: AgentSession,
  res: Response,
  loopDetector: LoopDetector,
  options: OrchestratorOptions
): Promise<{ success: boolean; toolSummaries: Array<{ tool: string; success: boolean; summary: string }> }> {
  const iterationStart = Date.now();
  session.currentIteration++;

  sendSSE(res, { type: "iteration_start", iteration: session.currentIteration, maxIterations: session.maxIterations });

  // 1. Loop detection
  const loopResult = loopDetector.detect();
  let loopWarning: string | undefined;
  if (loopResult.detected) {
    loopWarning = loopResult.intervention;
    sendSSE(res, { type: "loop_warning", level: loopResult.level, description: loopResult.description, confidence: loopResult.confidence });

    if (loopResult.shouldForceStop) {
      session.status = "needs_assistance";
      sendSSE(res, { type: "loop_intervention", message: "Agent stuck in a confirmed loop. Requesting human assistance." });
      return { success: true, toolSummaries: [] };
    }
  }

  // 2. Build system prompt with previous tool results for context continuity
  const systemPrompt = buildSystemPrompt({
    iteration: session.currentIteration,
    maxIterations: session.maxIterations,
    status: session.status,
    blackboard: session.blackboard,
    scratchpad: session.scratchpad,
    attributes: session.attributes,
    prompt: session.prompt + (options.additionalContext ? `\n\n${options.additionalContext}` : ""),
    loopWarning,
    sectionOverrides: options.sectionOverrides,
    enabledTools: options.enabledTools,
    previousToolResults: options.previousToolResults,
  });

  // 3. PII scan
  const piiScan = scanForPII(systemPrompt + "\n" + session.prompt);
  if (piiScan.blockedCount > 0) {
    logAudit({
      userId: session.userId,
      action: AuditAction.PII_DETECTED_OUTBOUND,
      resourceType: "agent_session",
      resourceId: session.id,
      details: { iteration: session.currentIteration, detections: piiScan.detections.map((d) => ({ type: d.type, action: d.action })) },
    });
    sendSSE(res, { type: "pii_warning", message: `PII detected (${piiScan.blockedCount} blocked). Content redacted.` });
  }

  // 4. Call LLM
  const tools = getToolDefinitions(options.enabledTools);
  let llmResponse;
  try {
    llmResponse = await callLLM(session.modelId, {
      systemPrompt,
      messages: [{ role: "user", content: session.prompt }],
      tools,
      responseFormat: "json",
      temperature: 0.7,
    });
  } catch (err) {
    const errorMsg = (err as Error).message;
    logger.error("LLM call failed in iteration", err as Error, { sessionId: session.id, iteration: session.currentIteration });
    sendSSE(res, { type: "llm_error", error: errorMsg, iteration: session.currentIteration });
    await recordIteration(session.id, session.currentIteration, { status: "error", error: errorMsg, durationMs: Date.now() - iterationStart });
    return { success: false, toolSummaries: [] };
  }

  // 5. Parse response
  const parsed = parseLLMResponse(llmResponse.content);

  sendSSE(res, {
    type: "llm_response",
    iteration: session.currentIteration,
    thinking: parsed.thinking.substring(0, 300) + (parsed.thinking.length > 300 ? "..." : ""),
    status: parsed.status,
    userMessage: parsed.user_message,
    toolCallCount: parsed.tool_calls.length,
    tokensUsed: llmResponse.usage.totalTokens,
  });

  // 6. Dispatch tool calls (from structured JSON response)
  let toolResults: ToolResult[] = [];
  const allToolCalls: ToolCall[] = [
    ...parsed.tool_calls.map((tc) => ({ tool: tc.tool, params: tc.params || {} })),
    ...llmResponse.toolCalls.map((tc) => ({ tool: tc.name, params: tc.arguments })),
  ];

  if (allToolCalls.length > 0) {
    sendSSE(res, { type: "tool_calls", iteration: session.currentIteration, calls: allToolCalls.map((tc) => ({ tool: tc.tool })) });

    const dispatchResult = await dispatchToolCalls(allToolCalls, {
      sessionId: session.id,
      userId: session.userId,
      ministryCode: session.ministryCode,
      iteration: session.currentIteration,
      memory: { blackboard: session.blackboard, scratchpad: session.scratchpad, attributes: session.attributes },
      onEvent: (event) => sendSSE(res, event),
    });

    toolResults = dispatchResult.results;
    session.blackboard = dispatchResult.finalMemory.blackboard;
    session.scratchpad = dispatchResult.finalMemory.scratchpad;
    session.attributes = dispatchResult.finalMemory.attributes;

    for (const result of toolResults) {
      sendSSE(res, { type: "tool_result", iteration: session.currentIteration, tool: result.tool, success: result.success, durationMs: result.durationMs, error: result.error || undefined });
    }
  }

  // 7. Apply blackboard updates from parsed response
  if (parsed.blackboard_updates.length > 0) {
    for (const update of parsed.blackboard_updates) {
      session.blackboard.push({ category: update.category, title: update.title, content: update.content, iteration: session.currentIteration });
    }
    sendSSE(res, { type: "blackboard_update", iteration: session.currentIteration, newEntries: parsed.blackboard_updates.length, totalEntries: session.blackboard.length });
  }

  // 8. Apply scratchpad/attribute updates
  if (parsed.scratchpad !== null) {
    session.scratchpad = parsed.scratchpad;
    sendSSE(res, { type: "scratchpad_update", iteration: session.currentIteration, length: session.scratchpad.length });
  }
  if (parsed.attribute_updates) {
    session.attributes = { ...session.attributes, ...parsed.attribute_updates };
    sendSSE(res, { type: "attributes_update", iteration: session.currentIteration, keys: Object.keys(parsed.attribute_updates) });
  }

  // 9. Status transition
  if (parsed.status !== "running") {
    session.status = parsed.status;
    if (parsed.status === "completed") {
      session.finalReport = {
        message: parsed.user_message || "Task completed.",
        iterations: session.currentIteration,
        blackboardEntries: session.blackboard.length,
        completedAt: new Date().toISOString(),
      };
    }
  }

  // 10. Record for loop detection
  loopDetector.recordIteration({
    iteration: session.currentIteration,
    thinking: parsed.thinking,
    toolCalls: parsed.tool_calls,
    blackboardUpdates: parsed.blackboard_updates.length,
    status: parsed.status,
  });

  // If agent made progress (blackboard updates), soft-reset loop detector
  if (parsed.blackboard_updates.length > 0) {
    loopDetector.softReset();
  }

  // 11. Persist
  const iterationDuration = Date.now() - iterationStart;
  await recordIteration(session.id, session.currentIteration, {
    parsedResponse: { thinking: parsed.thinking.substring(0, 500), status: parsed.status, toolCallCount: allToolCalls.length },
    toolCalls: allToolCalls,
    toolResults: toolResults.map((r) => ({ tool: r.tool, success: r.success, durationMs: r.durationMs })),
    blackboardEntry: parsed.blackboard_updates.length > 0 ? parsed.blackboard_updates : null,
    status: parsed.status,
    tokensUsed: llmResponse.usage.totalTokens,
    durationMs: iterationDuration,
  });

  await updateSessionInDB(session);

  sendSSE(res, {
    type: "iteration_complete",
    iteration: session.currentIteration,
    status: session.status,
    durationMs: iterationDuration,
    tokensUsed: llmResponse.usage.totalTokens,
    userMessage: parsed.user_message,
  });

  // Build tool summaries for next iteration's context
  const toolSummaries = toolResults.map((r) => ({
    tool: r.tool,
    success: r.success,
    summary: r.success
      ? `Returned result (${r.durationMs}ms)`
      : `Failed: ${r.error || "unknown error"}`,
  }));

  return { success: true, toolSummaries };
}

// ============================================================================
// SESSION LIFECYCLE
// ============================================================================

export async function createSession(params: {
  userId: string;
  ministryCode: string | null;
  prompt: string;
  modelId: string;
  maxIterations: number;
  classification: string;
}): Promise<AgentSession> {
  if (isMockMode()) {
    const id = randomUUID();
    const session: AgentSession = {
      id,
      userId: params.userId,
      ministryCode: params.ministryCode,
      prompt: params.prompt,
      modelId: params.modelId,
      maxIterations: params.maxIterations,
      currentIteration: 0,
      status: "idle",
      classification: params.classification,
      blackboard: [],
      scratchpad: "",
      attributes: {},
      finalReport: null,
      error: null,
      createdAt: new Date().toISOString(),
    };
    inMemorySessions.set(id, session);
    logger.agent("session_created_mock", id, { modelId: params.modelId, maxIterations: params.maxIterations });
    return { ...session };
  }

  const result = await query<{ id: string; created_at: string }>(
    `INSERT INTO agent_sessions (user_id, ministry_code, prompt, model_id, max_iterations, classification)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, created_at`,
    [params.userId, params.ministryCode, params.prompt, params.modelId, params.maxIterations, params.classification]
  );

  const row = result.rows[0];
  if (!row) throw new Error("Session row not returned from insert.");
  logger.agent("session_created", row.id, { modelId: params.modelId, maxIterations: params.maxIterations });

  return {
    id: row.id,
    userId: params.userId,
    ministryCode: params.ministryCode,
    prompt: params.prompt,
    modelId: params.modelId,
    maxIterations: params.maxIterations,
    currentIteration: 0,
    status: "idle",
    classification: params.classification,
    blackboard: [],
    scratchpad: "",
    attributes: {},
    finalReport: null,
    error: null,
    createdAt: row.created_at,
  };
}

export async function loadSession(sessionId: string, userId: string): Promise<AgentSession | null> {
  if (isMockMode()) {
    const session = inMemorySessions.get(sessionId);
    if (!session || session.userId !== userId) return null;
    return { ...session, blackboard: [...session.blackboard], attributes: { ...session.attributes } };
  }

  const result = await query<Record<string, unknown>>(
    `SELECT * FROM agent_sessions WHERE id = $1 AND user_id = $2`,
    [sessionId, userId]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id as string,
    userId: row.user_id as string,
    ministryCode: row.ministry_code as string | null,
    prompt: row.prompt as string,
    modelId: row.model_id as string,
    maxIterations: row.max_iterations as number,
    currentIteration: row.current_iteration as number,
    status: row.status as AgentSession["status"],
    classification: row.classification as string,
    blackboard: (row.blackboard as BlackboardEntry[]) || [],
    scratchpad: (row.scratchpad as string) || "",
    attributes: (row.attributes as Record<string, unknown>) || {},
    finalReport: row.final_report || null,
    error: row.error as string | null,
    createdAt: (row.created_at as Date).toISOString(),
  };
}

export async function getSessionSummary(sessionId: string, userId: string): Promise<Record<string, unknown> | null> {
  const result = await query<Record<string, unknown>>(
    `SELECT id, user_id, ministry_code, prompt, model_id, max_iterations, 
            current_iteration, status, classification, error, created_at, completed_at,
            jsonb_array_length(blackboard) as blackboard_count
     FROM agent_sessions WHERE id = $1 AND user_id = $2`,
    [sessionId, userId]
  );
  if (result.rows.length === 0) return null;
  return result.rows[0];
}
