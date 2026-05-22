/**
 * Health Check Routes
 *
 * Four endpoints:
 *   - GET /api/health           — minimal, public, summary suitable for load
 *                                 balancers and external monitoring.
 *   - GET /api/health/live      — Kubernetes-style liveness probe. Always 200
 *                                 if the Node process is responsive; no DB or
 *                                 downstream checks.
 *   - GET /api/health/ready     — Kubernetes-style readiness probe. 200 when
 *                                 the database is reachable; 503 otherwise so
 *                                 the orchestrator can pull this instance out
 *                                 of rotation while it heals.
 *   - GET /api/health/detailed  — full diagnostics, admin-only (pool stats,
 *                                 token usage, uptime, memory, node version)
 */

import { Router, type Router as RouterType, Request, Response } from "express";
import { checkConnection, getPoolStats } from "../config/database.js";
import { env } from "../config/env.js";
import { authenticate, requireRole } from "../middleware/auth.js";
import { getTokenUsageStats } from "../services/llmProvider.js";

const router: RouterType = Router();

const APP_VERSION = "1.0.0";

router.get("/", async (_req: Request, res: Response) => {
  const dbConnected = await checkConnection();

  const status = {
    status: dbConnected ? "healthy" : "degraded",
    timestamp: new Date().toISOString(),
    version: APP_VERSION,
    environment: env.NODE_ENV,
    services: {
      database: dbConnected ? "connected" : "disconnected",
      authentication: env.ENTRA_CLIENT_ID ? "configured" : "not_configured",
      llm: env.VERTEX_AI_API_KEY || env.ANTHROPIC_API_KEY ? "configured" : "not_configured",
    },
  };

  res.status(dbConnected ? 200 : 503).json(status);
});

/**
 * GET /api/health/live
 *
 * Liveness probe — answers "is this process still running?" Always returns
 * 200 if the request loop is responsive. Used by Kubernetes/Nexus to decide
 * whether to restart the container. Deliberately does NOT touch the DB or
 * downstream services: a transient DB outage must not trigger a container
 * restart loop.
 */
router.get("/live", (_req: Request, res: Response) => {
  res.status(200).json({
    status: "alive",
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    version: APP_VERSION,
  });
});

/**
 * GET /api/health/ready
 *
 * Readiness probe — answers "is this instance ready to serve traffic?"
 * Returns 200 only when the database is reachable, since every meaningful
 * request needs it. 503 with a `reason` field otherwise so the orchestrator
 * can pull this instance from rotation without flagging it for restart.
 */
router.get("/ready", async (_req: Request, res: Response) => {
  const dbConnected = await checkConnection();

  if (!dbConnected) {
    res.status(503).json({
      status: "not_ready",
      reason: "database_disconnected",
      timestamp: new Date().toISOString(),
    });
    return;
  }

  res.status(200).json({
    status: "ready",
    timestamp: new Date().toISOString(),
  });
});

router.get(
  "/detailed",
  authenticate,
  requireRole("admin"),
  async (_req: Request, res: Response) => {
    const dbConnected = await checkConnection();
    const mem = process.memoryUsage();

    res.status(dbConnected ? 200 : 503).json({
      status: dbConnected ? "healthy" : "degraded",
      timestamp: new Date().toISOString(),
      version: APP_VERSION,
      nodeVersion: process.version,
      environment: env.NODE_ENV,
      uptimeSeconds: Math.round(process.uptime()),
      memory: {
        rssMb: Math.round(mem.rss / 1024 / 1024),
        heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
        heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
        externalMb: Math.round(mem.external / 1024 / 1024),
      },
      pool: getPoolStats(),
      tokens: getTokenUsageStats(),
      services: {
        database: dbConnected ? "connected" : "disconnected",
        authentication: env.ENTRA_CLIENT_ID ? "configured" : "not_configured",
        vertexAi: env.VERTEX_AI_API_KEY ? "configured" : "not_configured",
        anthropic: env.ANTHROPIC_API_KEY ? "configured" : "not_configured",
        googleAi: env.GOOGLE_AI_API_KEY ? "configured" : "not_configured",
        braveSearch: env.BRAVE_SEARCH_API_KEY ? "configured" : "not_configured",
        secretsVault: env.SECRETS_VAULT_KEY ? "configured" : "not_configured",
      },
      retention: {
        enabled: env.RETENTION_JOB_ENABLED,
        hour: env.RETENTION_JOB_HOUR,
      },
    });
  }
);

export default router;
