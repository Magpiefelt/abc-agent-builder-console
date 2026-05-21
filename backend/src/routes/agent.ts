/**
 * Agent Routes
 * 
 * Handles Free Agent session management and execution.
 * The orchestration engine runs server-side; the frontend only receives SSE updates.
 * 
 * Routes:
 * - POST /api/agent/sessions          — Create a new session
 * - POST /api/agent/sessions/:id/start — Start execution (returns SSE stream)
 * - POST /api/agent/sessions/:id/stop  — Stop a running session
 * - POST /api/agent/sessions/:id/continue — Resume with new prompt
 * - POST /api/agent/sessions/:id/interject — Inject guidance mid-execution
 * - GET  /api/agent/sessions/:id       — Get full session state
 * - GET  /api/agent/models             — List available models
 */

import { Router, type Router as RouterType, Request, Response } from "express";
import { authenticate } from "../middleware/auth.js";
import { logAudit, auditAgentEvent, AuditAction } from "../services/auditLogger.js";
import { logger } from "../services/logger.js";
import {
  createSession,
  loadSession,
  getSessionSummary,
  runOrchestrator,
  stopSession,
  interjectSession,
  isSessionRunning,
} from "../services/agentOrchestrator.js";
import { getActiveModels, validateModelClassification, isProviderConfigured } from "../services/llmProvider.js";
import { scanForPII } from "../services/piiDetector.js";

const router: RouterType = Router();

// All agent routes require authentication
router.use(authenticate);

// ============================================================================
// SESSION CREATION
// ============================================================================

/**
 * POST /api/agent/sessions
 * Create a new agent session.
 */
router.post("/sessions", async (req: Request, res: Response) => {
  const { prompt, modelId, maxIterations, classification } = req.body;

  // Validate prompt
  if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
    res.status(400).json({ error: "A non-empty prompt is required." });
    return;
  }

  if (prompt.trim().length > 50000) {
    res.status(400).json({ error: "Prompt exceeds maximum length of 50,000 characters." });
    return;
  }

  // PII scan on the user prompt
  const piiScan = scanForPII(prompt);
  if (piiScan.blockedCount > 0) {
    logAudit({
      userId: req.user!.id,
      ministryCode: req.user!.ministryCode || undefined,
      action: AuditAction.PII_BLOCKED_PROMPT,
      resourceType: "agent_session",
      details: { detections: piiScan.detections.filter((d) => d.action === "blocked").map((d) => d.type) },
    });

    res.status(422).json({
      error: "Prompt contains blocked content (potential PII or secrets detected). Please remove sensitive information and try again.",
      detections: piiScan.detections
        .filter((d) => d.action === "blocked")
        .map((d) => ({ type: d.type, description: d.pattern })),
    });
    return;
  }

  // Validate model
  const resolvedModelId = modelId || "claude-sonnet-4.5";
  const resolvedClassification = classification || "unclassified";

  const classValidation = await validateModelClassification(resolvedModelId, resolvedClassification);
  if (!classValidation.valid) {
    res.status(400).json({ error: classValidation.reason });
    return;
  }

  // Create session
  try {
    const session = await createSession({
      userId: req.user!.id,
      ministryCode: req.user!.ministryCode,
      prompt: prompt.trim(),
      modelId: resolvedModelId,
      maxIterations: Math.min(maxIterations || 50, 100),
      classification: resolvedClassification,
    });

    auditAgentEvent(req.user!.id, AuditAction.AGENT_SESSION_CREATED, session.id, {
      modelId: resolvedModelId,
      maxIterations: session.maxIterations,
      classification: resolvedClassification,
    });

    res.status(201).json({
      id: session.id,
      status: session.status,
      prompt: session.prompt,
      modelId: session.modelId,
      maxIterations: session.maxIterations,
      classification: session.classification,
      createdAt: session.createdAt,
    });
  } catch (err) {
    logger.error("Failed to create session", err as Error);
    res.status(500).json({ error: "Failed to create agent session." });
  }
});

// ============================================================================
// SESSION EXECUTION
// ============================================================================

/**
 * POST /api/agent/sessions/:id/start
 * Start executing an agent session. Returns an SSE stream.
 */
router.post("/sessions/:id/start", async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { sectionOverrides, enabledTools } = req.body || {};

  // Check LLM provider is configured
  if (!isProviderConfigured()) {
    res.status(503).json({ error: "LLM provider not configured. Set ANTHROPIC_API_KEY or VERTEX_AI_API_KEY." });
    return;
  }

  // Load session
  const session = await loadSession(id, req.user!.id);
  if (!session) {
    res.status(404).json({ error: "Session not found." });
    return;
  }

  if (isSessionRunning(id)) {
    res.status(409).json({ error: "Session is already running." });
    return;
  }

  if (!["idle", "paused"].includes(session.status)) {
    res.status(400).json({
      error: `Cannot start session in "${session.status}" state. Only "idle" or "paused" sessions can be started.`,
    });
    return;
  }

  // Set up SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Handle client disconnect
  req.on("close", () => {
    stopSession(id);
  });

  auditAgentEvent(req.user!.id, AuditAction.AGENT_SESSION_STARTED, id);

  // Run the orchestrator (streams SSE events and ends the response)
  await runOrchestrator(session, res, { sectionOverrides, enabledTools });
});

/**
 * POST /api/agent/sessions/:id/stop
 * Stop a running session.
 */
router.post("/sessions/:id/stop", async (req: Request, res: Response) => {
  const id = req.params.id as string;

  if (!isSessionRunning(id)) {
    res.status(400).json({ error: "Session is not currently running." });
    return;
  }

  stopSession(id);
  auditAgentEvent(req.user!.id, AuditAction.AGENT_SESSION_STOPPED, id);

  res.json({ id, status: "stopping", message: "Stop signal sent. Session will halt after current iteration." });
});

/**
 * POST /api/agent/sessions/:id/continue
 * Resume a paused or completed session with a new/additional prompt.
 */
router.post("/sessions/:id/continue", async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { prompt, additionalIterations } = req.body;

  if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
    res.status(400).json({ error: "A continuation prompt is required." });
    return;
  }

  if (!isProviderConfigured()) {
    res.status(503).json({ error: "LLM provider not configured." });
    return;
  }

  const session = await loadSession(id, req.user!.id);
  if (!session) {
    res.status(404).json({ error: "Session not found." });
    return;
  }

  if (isSessionRunning(id)) {
    res.status(409).json({ error: "Session is already running. Use /interject instead." });
    return;
  }

  if (!["paused", "completed", "needs_assistance"].includes(session.status)) {
    res.status(400).json({ error: `Cannot continue session in "${session.status}" state.` });
    return;
  }

  // PII scan
  const piiScan = scanForPII(prompt);
  if (piiScan.blockedCount > 0) {
    res.status(422).json({
      error: "Continuation prompt contains blocked content.",
      detections: piiScan.detections.filter((d) => d.action === "blocked").map((d) => ({ type: d.type })),
    });
    return;
  }

  // Update session for continuation
  session.prompt = prompt.trim();
  session.status = "running";
  if (additionalIterations) {
    session.maxIterations = session.currentIteration + Math.min(additionalIterations, 100);
  }

  // SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  req.on("close", () => { stopSession(id); });

  auditAgentEvent(req.user!.id, AuditAction.AGENT_SESSION_CONTINUED, id, {
    newPrompt: prompt.trim().substring(0, 100),
  });

  await runOrchestrator(session, res);
});

/**
 * POST /api/agent/sessions/:id/interject
 * Inject guidance into a running session.
 */
router.post("/sessions/:id/interject", async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { message } = req.body;

  if (!message || typeof message !== "string" || message.trim().length === 0) {
    res.status(400).json({ error: "An interjection message is required." });
    return;
  }

  if (!isSessionRunning(id)) {
    res.status(400).json({ error: "Session is not currently running. Use /continue instead." });
    return;
  }

  const piiScan = scanForPII(message);
  if (piiScan.blockedCount > 0) {
    res.status(422).json({ error: "Interjection contains blocked content." });
    return;
  }

  interjectSession(id, message.trim());
  auditAgentEvent(req.user!.id, AuditAction.AGENT_SESSION_INTERJECTED, id, {
    messageLength: message.trim().length,
  });

  res.json({ id, message: "Interjection queued. It will be injected in the next iteration." });
});

// ============================================================================
// SESSION RETRIEVAL
// ============================================================================

/**
 * GET /api/agent/sessions/:id
 * Get full session state including memory.
 */
router.get("/sessions/:id", async (req: Request, res: Response) => {
  const id = req.params.id as string;

  const session = await loadSession(id, req.user!.id);
  if (!session) {
    res.status(404).json({ error: "Session not found." });
    return;
  }

  res.json({
    id: session.id,
    status: session.status,
    prompt: session.prompt,
    modelId: session.modelId,
    maxIterations: session.maxIterations,
    currentIteration: session.currentIteration,
    classification: session.classification,
    blackboard: session.blackboard,
    scratchpad: session.scratchpad,
    attributes: session.attributes,
    finalReport: session.finalReport,
    error: session.error,
    createdAt: session.createdAt,
    isRunning: isSessionRunning(id),
  });
});

// ============================================================================
// MODEL REGISTRY
// ============================================================================

/**
 * GET /api/agent/models
 * List available LLM models from the registry.
 */
router.get("/models", async (_req: Request, res: Response) => {
  try {
    const models = await getActiveModels();
    res.json({
      models: models.map((m) => ({
        id: m.model_id,
        name: m.display_name,
        provider: m.provider,
        maxOutputTokens: m.max_output_tokens,
        supportsStreaming: m.supports_streaming,
        supportsTools: m.supports_tools,
        dataResidency: m.data_residency,
        maxClassification: m.max_classification,
      })),
    });
  } catch (err) {
    logger.error("Failed to fetch models", err as Error);
    res.status(500).json({ error: "Failed to fetch model registry." });
  }
});

export default router;
