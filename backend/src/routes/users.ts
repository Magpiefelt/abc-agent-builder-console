/**
 * User Memory Routes
 *
 * Per-user persistence: preferences, saved prompts, favorite workflows, recent sessions.
 * All endpoints are scoped to req.user.id and (where relevant) req.user.ministryCode.
 *
 *   GET    /api/users/me/preferences
 *   PUT    /api/users/me/preferences
 *   GET    /api/users/me/saved-prompts
 *   POST   /api/users/me/saved-prompts
 *   DELETE /api/users/me/saved-prompts/:id
 *   GET    /api/users/me/favorite-workflows
 *   POST   /api/users/me/favorite-workflows/:workflowId
 *   DELETE /api/users/me/favorite-workflows/:workflowId
 *   GET    /api/users/me/recent-sessions
 */
import { Router, type Request, type Response } from "express";
import { query } from "../config/database.js";
import { logger } from "../services/logger.js";

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUser(req: Request, res: Response): boolean {
  if (!req.user) {
    res.status(401).json({ error: "UNAUTHENTICATED" });
    return false;
  }
  return true;
}

// ============================================================================
// PREFERENCES
// ============================================================================

router.get("/me/preferences", async (req: Request, res: Response) => {
  if (!requireUser(req, res)) return;
  const result = await query<{
    default_model_id: string | null;
    default_classification: string | null;
    theme: string | null;
    notification_preferences: Record<string, unknown>;
    updated_at: Date;
  }>(
    `SELECT default_model_id, default_classification, theme, notification_preferences, updated_at
     FROM user_preferences WHERE user_id = $1`,
    [req.user!.id],
  );
  if (result.rowCount === 0) {
    res.json({
      defaultModelId: null,
      defaultClassification: null,
      theme: "light",
      notificationPreferences: {},
    });
    return;
  }
  const row = result.rows[0];
  res.json({
    defaultModelId: row.default_model_id,
    defaultClassification: row.default_classification,
    theme: row.theme,
    notificationPreferences: row.notification_preferences,
    updatedAt: row.updated_at,
  });
});

const ALLOWED_THEMES = ["light", "dark", "system"] as const;
const ALLOWED_CLASSIFICATIONS = ["unclassified", "protected_a", "protected_b"] as const;

router.put("/me/preferences", async (req: Request, res: Response) => {
  if (!requireUser(req, res)) return;
  const { defaultModelId, defaultClassification, theme, notificationPreferences } = req.body ?? {};

  if (
    theme !== undefined &&
    theme !== null &&
    !ALLOWED_THEMES.includes(theme as (typeof ALLOWED_THEMES)[number])
  ) {
    res.status(400).json({ error: `theme must be one of: ${ALLOWED_THEMES.join(", ")}` });
    return;
  }
  if (
    defaultClassification !== undefined &&
    defaultClassification !== null &&
    !ALLOWED_CLASSIFICATIONS.includes(
      defaultClassification as (typeof ALLOWED_CLASSIFICATIONS)[number],
    )
  ) {
    res
      .status(400)
      .json({ error: `defaultClassification must be one of: ${ALLOWED_CLASSIFICATIONS.join(", ")}` });
    return;
  }
  if (defaultModelId !== undefined && defaultModelId !== null && typeof defaultModelId !== "string") {
    res.status(400).json({ error: "defaultModelId must be a string or null." });
    return;
  }
  if (
    notificationPreferences !== undefined &&
    (typeof notificationPreferences !== "object" || notificationPreferences === null || Array.isArray(notificationPreferences))
  ) {
    res.status(400).json({ error: "notificationPreferences must be an object." });
    return;
  }

  await query(
    `INSERT INTO user_preferences (user_id, default_model_id, default_classification, theme, notification_preferences, updated_at)
     VALUES ($1, $2, $3, COALESCE($4, 'light'), COALESCE($5::jsonb, '{}'::jsonb), NOW())
     ON CONFLICT (user_id) DO UPDATE
       SET default_model_id = EXCLUDED.default_model_id,
           default_classification = EXCLUDED.default_classification,
           theme = EXCLUDED.theme,
           notification_preferences = EXCLUDED.notification_preferences,
           updated_at = NOW()`,
    [
      req.user!.id,
      defaultModelId ?? null,
      defaultClassification ?? null,
      theme ?? null,
      notificationPreferences ? JSON.stringify(notificationPreferences) : null,
    ],
  );

  res.status(204).send();
});

// ============================================================================
// SAVED PROMPTS
// ============================================================================

router.get("/me/saved-prompts", async (req: Request, res: Response) => {
  if (!requireUser(req, res)) return;
  const result = await query<{
    id: string;
    title: string;
    prompt: string;
    tags: string[] | null;
    is_public: boolean;
    ministry_code: string | null;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT id, title, prompt, tags, is_public, ministry_code, created_at, updated_at
     FROM saved_prompts
     WHERE user_id = $1
        OR (is_public = true AND ministry_code IS NOT DISTINCT FROM $2)
     ORDER BY updated_at DESC
     LIMIT 200`,
    [req.user!.id, req.user!.ministryCode],
  );
  res.json({
    prompts: result.rows.map((r) => ({
      id: r.id,
      title: r.title,
      prompt: r.prompt,
      tags: r.tags ?? [],
      isPublic: r.is_public,
      ministryCode: r.ministry_code,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
  });
});

router.post("/me/saved-prompts", async (req: Request, res: Response) => {
  if (!requireUser(req, res)) return;
  const { title, prompt, tags, isPublic } = req.body ?? {};

  if (typeof title !== "string" || title.trim().length === 0 || title.length > 200) {
    res.status(400).json({ error: "title is required and must be 1-200 chars." });
    return;
  }
  if (typeof prompt !== "string" || prompt.trim().length === 0 || prompt.length > 50000) {
    res.status(400).json({ error: "prompt is required and must be 1-50000 chars." });
    return;
  }
  if (tags !== undefined) {
    if (!Array.isArray(tags) || tags.some((t) => typeof t !== "string")) {
      res.status(400).json({ error: "tags must be a string[]." });
      return;
    }
    if (tags.length > 20) {
      res.status(400).json({ error: "tags is limited to 20 entries." });
      return;
    }
    if ((tags as string[]).some((t) => t.length > 50)) {
      res.status(400).json({ error: "each tag must be 50 chars or fewer." });
      return;
    }
  }

  const result = await query<{ id: string; created_at: Date; updated_at: Date }>(
    `INSERT INTO saved_prompts (user_id, ministry_code, title, prompt, tags, is_public)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, created_at, updated_at`,
    [
      req.user!.id,
      req.user!.ministryCode,
      title.trim(),
      prompt,
      tags ?? null,
      Boolean(isPublic),
    ],
  );
  const row = result.rows[0];
  res.status(201).json({
    id: row.id,
    title: title.trim(),
    prompt,
    tags: tags ?? [],
    isPublic: Boolean(isPublic),
    ministryCode: req.user!.ministryCode,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
});

router.delete("/me/saved-prompts/:id", async (req: Request, res: Response) => {
  if (!requireUser(req, res)) return;
  const id = req.params.id as string;
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: "Invalid id." });
    return;
  }
  const result = await query(
    `DELETE FROM saved_prompts WHERE id = $1 AND user_id = $2`,
    [id, req.user!.id],
  );
  if (result.rowCount === 0) {
    res.status(404).json({ error: "Prompt not found." });
    return;
  }
  res.status(204).send();
});

// ============================================================================
// FAVORITE WORKFLOWS
// ============================================================================

router.get("/me/favorite-workflows", async (req: Request, res: Response) => {
  if (!requireUser(req, res)) return;
  const result = await query<{
    workflow_id: string;
    favorited_at: Date;
    name: string | null;
    description: string | null;
  }>(
    `SELECT wf.workflow_id, wf.favorited_at, w.name, w.description
     FROM workflow_favorites wf
     LEFT JOIN workflows w ON w.id = wf.workflow_id AND w.ministry_code IS NOT DISTINCT FROM $2
     WHERE wf.user_id = $1
     ORDER BY wf.favorited_at DESC`,
    [req.user!.id, req.user!.ministryCode],
  );
  res.json({
    favorites: result.rows.map((r) => ({
      workflowId: r.workflow_id,
      favoritedAt: r.favorited_at,
      name: r.name,
      description: r.description,
    })),
  });
});

router.post("/me/favorite-workflows/:workflowId", async (req: Request, res: Response) => {
  if (!requireUser(req, res)) return;
  const workflowId = req.params.workflowId as string;
  if (!UUID_RE.test(workflowId)) {
    res.status(400).json({ error: "Invalid workflowId." });
    return;
  }
  // Verify the workflow exists and is visible to this user's ministry before favoriting.
  const wf = await query<{ id: string }>(
    `SELECT id FROM workflows
     WHERE id = $1 AND (ministry_code IS NOT DISTINCT FROM $2 OR is_template = true)`,
    [workflowId, req.user!.ministryCode],
  );
  if (wf.rowCount === 0) {
    res.status(404).json({ error: "Workflow not found in your ministry." });
    return;
  }
  await query(
    `INSERT INTO workflow_favorites (user_id, workflow_id)
     VALUES ($1, $2)
     ON CONFLICT (user_id, workflow_id) DO NOTHING`,
    [req.user!.id, workflowId],
  );
  res.status(204).send();
});

router.delete("/me/favorite-workflows/:workflowId", async (req: Request, res: Response) => {
  if (!requireUser(req, res)) return;
  const workflowId = req.params.workflowId as string;
  if (!UUID_RE.test(workflowId)) {
    res.status(400).json({ error: "Invalid workflowId." });
    return;
  }
  await query(
    `DELETE FROM workflow_favorites WHERE user_id = $1 AND workflow_id = $2`,
    [req.user!.id, workflowId],
  );
  res.status(204).send();
});

// ============================================================================
// RECENT SESSIONS
// ============================================================================

router.get("/me/recent-sessions", async (req: Request, res: Response) => {
  if (!requireUser(req, res)) return;
  try {
    const result = await query<{
      id: string;
      prompt: string;
      model_id: string;
      status: string;
      classification: string;
      created_at: Date;
      completed_at: Date | null;
    }>(
      `SELECT id, prompt, model_id, status, classification, created_at, completed_at
       FROM agent_sessions
       WHERE user_id = $1 AND ministry_code IS NOT DISTINCT FROM $2
       ORDER BY created_at DESC
       LIMIT 20`,
      [req.user!.id, req.user!.ministryCode],
    );
    res.json({
      sessions: result.rows.map((r) => ({
        id: r.id,
        prompt: r.prompt,
        modelId: r.model_id,
        status: r.status,
        classification: r.classification,
        createdAt: r.created_at,
        completedAt: r.completed_at,
      })),
    });
  } catch (err) {
    logger.error("Failed to load recent sessions", err as Error);
    res.json({ sessions: [] });
  }
});

export default router;
