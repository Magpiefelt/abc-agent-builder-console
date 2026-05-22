/**
 * Compliance Routes — admin-only access to the daily evidence snapshot
 * pipeline.
 *
 * Endpoints:
 *
 *   POST /api/compliance/evidence/run    — trigger a fresh snapshot now.
 *                                          Persists `docs/compliance/evidence_YYYY-MM-DD.md`
 *                                          (overwriting any same-day file),
 *                                          inserts a row into `evidence_collections`,
 *                                          and returns the full snapshot + Markdown.
 *
 *   GET  /api/compliance/evidence        — list historical collections from
 *                                          the `evidence_collections` table.
 *                                          Optional `?limit=N` (default 50,
 *                                          max 200).
 *
 *   GET  /api/compliance/evidence/latest — return the most recently generated
 *                                          snapshot's Markdown content. 404 if
 *                                          none exists yet.
 *
 *   GET  /api/compliance/evidence/:id    — fetch one collection by id,
 *                                          including the rendered Markdown.
 *
 * All routes require:
 *   1. authenticate           — valid Entra ID JWT (dev: mock user)
 *   2. requireRole('admin')   — user.role === 'admin'
 *   3. auditAdminAccess       — every admin call writes an ADMIN_ACCESS entry
 *
 * The collector lives in `services/evidenceCollector.ts`. This file is the
 * thin HTTP surface and does no real work itself.
 */

import express, { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { authenticate, requireRole } from "../middleware/auth.js";
import { auditAction, AuditAction } from "../services/auditLogger.js";
import { logger } from "../services/logger.js";
import {
  getCollection,
  listCollections,
  persistDailyEvidence,
  readLatestEvidence,
} from "../services/evidenceCollector.js";

const router: express.Router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function auditAdminAccess(req: Request, _res: Response, next: NextFunction): void {
  if (req.user) {
    auditAction(req.user.id, AuditAction.ADMIN_ACCESS, "admin_route", req.path, {
      method: req.method,
      ministryCode: req.user.ministryCode,
    });
  }
  next();
}

router.use(authenticate, requireRole("admin"), auditAdminAccess);

// ============================================================================
// POST /api/compliance/evidence/run
// ============================================================================

router.post("/evidence/run", async (req: Request, res: Response) => {
  try {
    const result = await persistDailyEvidence({
      triggeredBy: req.user!.id,
      userId: req.user!.id,
    });
    // persistDailyEvidence emits an EVIDENCE_COLLECTED audit entry internally.
    // No additional audit call needed here — the auditAdminAccess middleware
    // already recorded the ADMIN_ACCESS entry.
    res.json({
      filename: result.filename,
      filePath: result.filePath,
      snapshot: result.snapshot,
      markdown: result.markdown,
    });
  } catch (err) {
    logger.error("Failed to generate evidence snapshot", err as Error);
    res.status(500).json({ error: "Failed to generate evidence snapshot." });
  }
});

// ============================================================================
// GET /api/compliance/evidence
// ============================================================================

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

router.get("/evidence", async (req: Request, res: Response) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid query parameters", details: parsed.error.flatten().fieldErrors });
    return;
  }
  try {
    const collections = await listCollections({ limit: parsed.data.limit });
    res.json({ collections });
  } catch (err) {
    logger.error("Failed to list evidence collections", err as Error);
    res.status(500).json({ error: "Failed to list evidence collections." });
  }
});

// ============================================================================
// GET /api/compliance/evidence/latest
// ============================================================================
// Must be declared BEFORE the catch-all `/evidence/:id` so Express doesn't
// route `/latest` into the id-parameterized handler.
// ============================================================================

router.get("/evidence/latest", async (_req: Request, res: Response) => {
  try {
    const latest = await readLatestEvidence();
    if (!latest) {
      res.status(404).json({ error: "No evidence snapshots have been generated yet." });
      return;
    }
    res.json({
      filename: latest.filename,
      filePath: latest.filePath,
      date: latest.date,
      markdown: latest.markdown,
    });
  } catch (err) {
    logger.error("Failed to read latest evidence snapshot", err as Error);
    res.status(500).json({ error: "Failed to read latest evidence snapshot." });
  }
});

// ============================================================================
// GET /api/compliance/evidence/:id
// ============================================================================

router.get("/evidence/:id", async (req: Request, res: Response) => {
  const id = req.params.id as string;
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: "Invalid collection id." });
    return;
  }
  try {
    const row = await getCollection(id);
    if (!row) {
      res.status(404).json({ error: "Evidence collection not found." });
      return;
    }
    res.json(row);
  } catch (err) {
    logger.error("Failed to load evidence collection", err as Error, { id });
    res.status(500).json({ error: "Failed to load evidence collection." });
  }
});

export default router;
