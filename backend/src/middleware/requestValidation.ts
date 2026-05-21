/**
 * Request Validation Middleware
 *
 * Inbound HTTP hygiene: blocks path traversal attempts, enforces payload
 * size limits, validates content types, and rejects malformed requests
 * before they reach route handlers.
 *
 * Enhanced with patterns from the Hockey App's `server/middleware/08.request-validation.ts`:
 * - XSS / SQL injection pattern detection in URL paths
 * - Code execution attempt blocking
 * - Audit logging for security events
 * - Payload size enforcement (defense-in-depth)
 */

import { Request, Response, NextFunction } from "express";
import { logger } from "../services/logger.js";
import { auditSecurityEvent, AuditAction } from "../services/auditLogger.js";

// ============================================================================
// CONFIGURATION
// ============================================================================

/** Maximum payload size in bytes (5MB) — defense-in-depth alongside Express limits */
const MAX_PAYLOAD_SIZE = 5 * 1024 * 1024;

/** Paths that skip validation (health checks, static assets) */
const SKIP_PATHS = ["/api/health", "/favicon.ico"];

// ============================================================================
// SUSPICIOUS PATTERN DETECTION
// ============================================================================

const BLOCKED_PATH_PATTERNS: RegExp[] = [
  // Path traversal
  /\.\.\//,
  /\.\.\\/, 
  /%2e%2e/i,
  /%252e%252e/i,

  // Null byte injection
  /\0/,
  /%00/,

  // XSS attempts in URL
  /<script/i,
  /javascript:/i,
  /on\w+\s*=/i,

  // SQL injection in URL
  /(\bunion\b.*\bselect\b)/i,
  /(\bdrop\b.*\btable\b)/i,
  /(\binsert\b.*\binto\b)/i,
  /(\bdelete\b.*\bfrom\b)/i,

  // Code execution attempts
  /\beval\s*\(/i,
  /\bexec\s*\(/i,
  /\bsystem\s*\(/i,
  /\bpassthru\s*\(/i,
];

// ============================================================================
// MIDDLEWARE
// ============================================================================

/**
 * Validate inbound requests for security hygiene.
 * Apply early in the middleware stack (after CORS/Helmet, before routes).
 */
export function requestValidation(req: Request, res: Response, next: NextFunction): void {
  // Skip validation for health checks and static assets
  if (SKIP_PATHS.some((p) => req.path === p || req.path.startsWith(p))) {
    next();
    return;
  }

  const ip = req.ip || req.socket.remoteAddress || "unknown";

  // ============================================================================
  // 1. BLOCK SUSPICIOUS PATH PATTERNS (traversal, XSS, SQLi, code exec)
  // ============================================================================

  const fullPath = req.path + (req.originalUrl.includes("?") ? "?" + req.originalUrl.split("?")[1] : "");
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(fullPath);
  } catch {
    decodedPath = fullPath;
  }

  for (const pattern of BLOCKED_PATH_PATTERNS) {
    if (pattern.test(fullPath) || pattern.test(decodedPath)) {
      logger.warn("Blocked suspicious request path", {
        path: req.path,
        ip,
        pattern: pattern.source,
        method: req.method,
      });

      auditSecurityEvent(AuditAction.SECURITY_INVALID_REQUEST, ip, {
        reason: "suspicious_path",
        path: req.path,
        pattern: pattern.source,
      });

      res.status(400).json({ error: "Invalid request path." });
      return;
    }
  }

  // ============================================================================
  // 2. BLOCK EXCESSIVELY LONG URLs (potential buffer overflow attempts)
  // ============================================================================

  if (req.originalUrl.length > 2048) {
    logger.warn("Blocked excessively long URL", {
      urlLength: req.originalUrl.length,
      ip,
    });
    res.status(414).json({ error: "URI too long." });
    return;
  }

  // ============================================================================
  // 3. CONTENT-TYPE ENFORCEMENT ON MUTATING REQUESTS
  // ============================================================================

  if (["POST", "PUT", "PATCH"].includes(req.method)) {
    const contentType = req.headers["content-type"];
    const contentLength = parseInt(req.headers["content-length"] || "0", 10);

    // Require Content-Type when there's a body
    if (contentLength > 0 && !contentType) {
      logger.warn("Mutating request missing Content-Type", {
        ip,
        method: req.method,
        path: req.path,
      });
      res.status(415).json({ error: "Content-Type header is required for requests with a body." });
      return;
    }

    // Only allow JSON and multipart form data
    if (contentType &&
        !contentType.includes("application/json") &&
        !contentType.includes("application/x-www-form-urlencoded") &&
        !contentType.includes("multipart/form-data")) {
      logger.warn("Rejected unsupported content type", {
        contentType,
        method: req.method,
        path: req.path,
        ip,
      });
      res.status(415).json({ error: "Unsupported content type. Use application/json." });
      return;
    }
  }

  // ============================================================================
  // 4. PAYLOAD SIZE CHECK (defense-in-depth)
  // ============================================================================

  const contentLength = parseInt(req.headers["content-length"] || "0", 10);
  if (contentLength > MAX_PAYLOAD_SIZE) {
    logger.warn("Oversized payload rejected", {
      ip,
      method: req.method,
      path: req.path,
      contentLength,
      maxAllowed: MAX_PAYLOAD_SIZE,
    });
    res.status(413).json({
      error: `Payload too large. Maximum size is ${MAX_PAYLOAD_SIZE / (1024 * 1024)}MB.`,
    });
    return;
  }

  // ============================================================================
  // 5. BLOCK SUSPICIOUS HOST HEADERS
  // ============================================================================

  const hostHeader = req.headers.host;
  if (hostHeader && hostHeader.includes("..")) {
    logger.warn("Blocked suspicious host header", { host: hostHeader, ip });
    res.status(400).json({ error: "Invalid request." });
    return;
  }

  // ============================================================================
  // 6. LOG MISSING USER-AGENT (suspicious but not blocked)
  // ============================================================================

  if (!req.headers["user-agent"]) {
    logger.debug("Request missing User-Agent header", {
      ip,
      method: req.method,
      path: req.path,
    });
  }

  next();
}
