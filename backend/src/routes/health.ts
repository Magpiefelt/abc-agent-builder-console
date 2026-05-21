/**
 * Health Check Routes
 * Provides system status information for monitoring and deployment verification.
 */

import { Router, type Router as RouterType, Request, Response } from "express";
import { checkConnection } from "../config/database.js";
import { env } from "../config/env.js";

const router: RouterType = Router();

router.get("/", async (_req: Request, res: Response) => {
  const dbConnected = await checkConnection();

  const status = {
    status: dbConnected ? "healthy" : "degraded",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
    environment: env.NODE_ENV,
    services: {
      database: dbConnected ? "connected" : "disconnected",
      authentication: env.ENTRA_CLIENT_ID ? "configured" : "not_configured",
      llm: env.VERTEX_AI_API_KEY || env.ANTHROPIC_API_KEY ? "configured" : "not_configured",
    },
  };

  const httpStatus = dbConnected ? 200 : 503;
  res.status(httpStatus).json(status);
});

export default router;
