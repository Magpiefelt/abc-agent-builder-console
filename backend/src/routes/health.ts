/**
 * Health Check Routes
 *
 * Two endpoints:
 *   - GET /api/health           — minimal, public, suitable for load balancers
 *   - GET /api/health/detailed  — full diagnostics, admin-only (pool stats,
 *                                 token usage, uptime, memory, node version)
 */

import express, { Router, Request, Response } from "express";
import { checkConnection, getPoolStats } from "../config/database.js";
import { env } from "../config/env.js";
import { authenticate, requireRole } from "../middleware/auth.js";
import { getTokenUsageStats } from "../services/llmProvider.js";

const router: express.Router = Router();

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
