/**
 * ABC Agent Builder Console - Backend Server
 *
 * GoA Enterprise Agentic Workflow Tool
 * Node.js + Express + TypeScript
 * Port: 3000
 */

import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { env } from "./config/env.js";
import { closePool } from "./config/database.js";
import { logger } from "./services/logger.js";
import { installProcessMonitor } from "./services/processMonitor.js";
import { requestValidation } from "./middleware/requestValidation.js";
import { agentRateLimit } from "./middleware/agentRateLimit.js";
import { authenticate } from "./middleware/auth.js";
import { registerAllTools } from "./tools/register.js";
import healthRoutes from "./routes/health.js";
import agentRoutes from "./routes/agent.js";
import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/users.js";

// ============================================================================
// PROCESS MONITOR (must be first — catches unhandled errors)
// ============================================================================

installProcessMonitor(async () => {
  // Graceful shutdown: close database pool
  await closePool();
});

// ============================================================================
// TOOL REGISTRATION (must happen before any agent session starts)
// ============================================================================

registerAllTools();

// ============================================================================
// EXPRESS APP
// ============================================================================

const app = express();

// ============================================================================
// SECURITY MIDDLEWARE (order matters)
// ============================================================================

// 1. Helmet: Security headers (CSP, HSTS, X-Frame-Options, etc.)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", env.FRONTEND_URL],
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true },
}));

// 2. CORS: In development allow any origin; in production restrict to frontend only
app.use(cors({
  origin: env.NODE_ENV === "development" ? true : env.FRONTEND_URL,
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

// 3. Request validation: path traversal, XSS, SQLi, payload limits
app.use(requestValidation);

// 4. Global rate limiting
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // 500 requests per window per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." },
});
app.use(globalLimiter);

// 5. Body parsing with size limits
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// 6. Cookie parsing (signed cookies use SESSION_SECRET; we sign our own JWTs separately)
app.use(cookieParser(env.SESSION_SECRET));

// ============================================================================
// ROUTES
// ============================================================================

app.use("/api/health", healthRoutes);

// Authentication routes (login/callback are public; logout and /me have their own auth middleware)
app.use("/api/auth", authRoutes);

// User memory routes (preferences, saved prompts, favorite workflows, recent sessions)
app.use("/api/users", authenticate, userRoutes);

// Agent routes with granular per-endpoint rate limiting
app.use("/api/agent", agentRateLimit, agentRoutes);

// Placeholder routes for future phases
app.use("/api/workflows", (_req, res) => {
  res.json({ message: "Workflow routes - Phase 5" });
});

app.use("/api/admin", (_req, res) => {
  res.json({ message: "Admin routes - Phase 6" });
});

// ============================================================================
// ERROR HANDLING
// ============================================================================

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: "Route not found." });
});

// Global error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error("Unhandled route error", err, {
    path: _req.path,
    method: _req.method,
  });

  // Never expose stack traces in production
  const response = env.NODE_ENV === "development"
    ? { error: err.message, stack: err.stack }
    : { error: "An internal server error occurred." };

  res.status(500).json(response);
});

// ============================================================================
// START SERVER
// ============================================================================

app.listen(env.PORT, () => {
  logger.info("Server started", {
    port: env.PORT,
    environment: env.NODE_ENV,
    corsOrigin: env.FRONTEND_URL,
    databaseConfigured: !!env.DATABASE_URL,
    llmConfigured: !!(env.ANTHROPIC_API_KEY || env.VERTEX_AI_API_KEY),
  });

  console.log(`
╔══════════════════════════════════════════════════════╗
║   ABC Agent Builder Console - Backend Server         ║
║   Port: ${env.PORT}                                         ║
║   Environment: ${env.NODE_ENV.padEnd(36)}║
║   CORS Origin: ${env.FRONTEND_URL.padEnd(36)}║
╚══════════════════════════════════════════════════════╝
  `);
});

export default app;
