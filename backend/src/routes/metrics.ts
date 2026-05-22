/**
 * Prometheus metrics endpoint.
 *
 *   GET /api/metrics — admin-only. Returns the registry as
 *   `text/plain; version=0.0.4; charset=utf-8`.
 *
 * Admin-gated because the metric series may leak operational signal
 * (provider names, model names, error rates) that we don't want indexed by
 * accident. A real production deploy would also restrict by network policy.
 */

import { Router, type Router as RouterType, Request, Response } from "express";
import { authenticate, requireRole } from "../middleware/auth.js";
import { registry, refreshProcessMetrics } from "../services/metrics.js";

const router: RouterType = Router();

router.get(
  "/",
  authenticate,
  requireRole("admin"),
  (_req: Request, res: Response) => {
    refreshProcessMetrics();
    res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.status(200).send(registry.render());
  },
);

export default router;
