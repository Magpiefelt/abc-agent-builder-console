/**
 * Agent Route Rate Limiting Middleware
 *
 * Granular, per-endpoint rate limiting for expensive agent operations.
 * Adapted from the Hockey App's `server/middleware/04.rate-limit.ts` pattern.
 *
 * Unlike the global rate limiter in index.ts, this middleware applies
 * endpoint-specific limits to protect expensive LLM API calls from abuse.
 *
 * Design:
 * - In-memory store (no Redis dependency for Phase 2)
 * - Per-IP + per-endpoint bucketing
 * - Fails open on infrastructure errors (except actual 429s)
 * - Sets standard rate-limit headers
 * - Periodic cleanup of expired entries
 */

import { Request, Response, NextFunction } from "express";
import { logger } from "../services/logger.js";
import { auditSecurityEvent, AuditAction } from "../services/auditLogger.js";

// ============================================================================
// TYPES
// ============================================================================

interface RateLimitBucket {
  /** Maximum requests allowed in the window */
  requests: number;
  /** Window duration in seconds */
  window: number;
}

interface RateLimitEntry {
  count: number;
  resetAt: number; // Unix timestamp (ms)
}

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Endpoint-specific rate limits.
 * More restrictive for expensive operations (LLM calls).
 */
const ENDPOINT_LIMITS: Record<string, RateLimitBucket> = {
  // Session creation: moderate limit
  "POST:/sessions": { requests: 20, window: 60 },

  // Session start (triggers LLM calls): strict limit
  "POST:/sessions/start": { requests: 5, window: 60 },

  // Session continue (triggers LLM calls): strict limit
  "POST:/sessions/continue": { requests: 5, window: 60 },

  // Interjection: moderate (no LLM call, just queues a message)
  "POST:/sessions/interject": { requests: 20, window: 60 },

  // Stop: lenient (should always be allowed)
  "POST:/sessions/stop": { requests: 50, window: 60 },

  // Read operations: lenient
  "GET:/sessions": { requests: 60, window: 60 },
  "GET:/models": { requests: 30, window: 60 },
};

const DEFAULT_LIMIT: RateLimitBucket = { requests: 100, window: 60 };

// ============================================================================
// IN-MEMORY STORE
// ============================================================================

const store: Map<string, RateLimitEntry> = new Map();

// Periodic cleanup of expired entries (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) {
      store.delete(key);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    logger.debug("Rate limit store cleanup", { cleaned, remaining: store.size });
  }
}, 5 * 60 * 1000).unref();

// ============================================================================
// BUCKET RESOLUTION
// ============================================================================

/**
 * Normalize a path so per-resource IDs collapse into the static endpoint shape.
 * `/sessions/12345678-1234-1234-1234-123456789012/start` → `/sessions/start`
 *
 * Exported so the rate-limit storeKey uses the same normalized form as the
 * bucket lookup — otherwise per-UUID storeKeys let a caller bypass the limit
 * by creating a new session per request.
 */
function normalizePath(path: string): string {
  return path
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "")
    .replace(/\/\d+/g, "")
    .replace(/\/\//g, "/");
}

/**
 * Resolve the rate-limit bucket for a given request.
 * Matches against METHOD:path patterns, normalizing dynamic :id segments.
 */
function resolveBucket(method: string, path: string): RateLimitBucket {
  const key = `${method.toUpperCase()}:${normalizePath(path)}`;

  // Try exact match first
  if (ENDPOINT_LIMITS[key]) {
    return ENDPOINT_LIMITS[key];
  }

  // Try partial match (for paths like /sessions/start)
  for (const [pattern, bucket] of Object.entries(ENDPOINT_LIMITS)) {
    if (key.endsWith(pattern.split(":")[1]) && key.startsWith(pattern.split(":")[0])) {
      return bucket;
    }
  }

  return DEFAULT_LIMIT;
}

// ============================================================================
// MIDDLEWARE
// ============================================================================

/**
 * Extract client IP from request, respecting proxy headers.
 */
function getClientIP(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || req.socket.remoteAddress || "unknown";
}

/**
 * Agent-specific rate limiting middleware.
 * Apply this to the /api/agent router.
 */
export function agentRateLimit(req: Request, res: Response, next: NextFunction): void {
  // Skip rate limiting in development
  if (process.env.NODE_ENV === "development") {
    next();
    return;
  }

  const ip = getClientIP(req);
  const normalized = normalizePath(req.path);
  const bucket = resolveBucket(req.method, req.path);
  // Use the normalized path in the storeKey so per-resource IDs (session UUIDs,
  // workflow IDs) all share the same bucket. Without this a client could hit
  // POST /sessions/<uuid-A>/start 5 times, create uuid-B, hit it 5 more times,
  // and never trip the configured "5 per minute" limit.
  const storeKey = `agent:${ip}:${req.method}:${normalized}`;

  const now = Date.now();
  let entry = store.get(storeKey);

  // Create or reset entry if expired
  if (!entry || entry.resetAt <= now) {
    entry = {
      count: 0,
      resetAt: now + bucket.window * 1000,
    };
    store.set(storeKey, entry);
  }

  entry.count++;

  // Calculate remaining
  const remaining = Math.max(0, bucket.requests - entry.count);
  const resetIn = Math.ceil((entry.resetAt - now) / 1000);

  // Set rate-limit headers
  res.setHeader("X-RateLimit-Limit", bucket.requests);
  res.setHeader("X-RateLimit-Remaining", remaining);
  res.setHeader("X-RateLimit-Reset", resetIn);

  // Check if limit exceeded
  if (entry.count > bucket.requests) {
    res.setHeader("Retry-After", resetIn);

    logger.warn("Agent rate limit exceeded", {
      ip,
      method: req.method,
      path: req.path,
      limit: bucket.requests,
      window: bucket.window,
    });

    auditSecurityEvent(AuditAction.SECURITY_RATE_LIMITED, ip, {
      method: req.method,
      path: req.path,
      limit: bucket.requests,
    });

    res.status(429).json({
      error: `Rate limit exceeded. Try again in ${resetIn} seconds.`,
      retryAfter: resetIn,
    });
    return;
  }

  next();
}

/**
 * Get current rate limit status (for monitoring/debugging).
 */
export function getRateLimitStatus(): { entries: number; totalHits: number } {
  let totalHits = 0;
  for (const entry of store.values()) {
    totalHits += entry.count;
  }
  return { entries: store.size, totalHits };
}
