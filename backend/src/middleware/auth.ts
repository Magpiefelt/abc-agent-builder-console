/**
 * Authentication Middleware
 *
 * Resolves the caller's identity via a precedence ladder:
 *   1. Session cookie (`abc_session`): HMAC-verify our own session JWT.
 *   2. Authorization: Bearer header: full Entra ID JWKS verification.
 *   3. Neither + NODE_ENV !== "production" + Entra unconfigured: inject DEV_USER.
 *   4. Otherwise: 401 with an AUTH_FAILED audit entry.
 *
 * Notes:
 * - A tampered/expired session cookie ALWAYS 401s — we never fall through to
 *   DEV_USER, which would let a forged cookie silently demote to the mock user.
 * - The dev mock keys off `!env.ENTRA_CLIENT_ID` (not just NODE_ENV) so a
 *   half-configured `.env` does not break local dev silently.
 */

import { Request, Response, NextFunction } from "express";
import { env } from "../config/env.js";
import { logger } from "../services/logger.js";
import { logAudit, AuditAction } from "../services/auditLogger.js";
import {
  COOKIE_SESSION,
  InvalidSignatureError,
  SessionExpiredError,
  loadUserById,
  upsertUser,
  verifyEntraToken,
  verifySessionToken,
  extractMinistry as extractMinistryFromEntra,
} from "../services/entraAuth.js";

export interface AuthUser {
  id: string;
  entraId: string;
  email: string;
  displayName: string;
  ministryCode: string | null;
  role: "admin" | "user" | "viewer";
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/**
 * Re-exported for callers that still import from this module.
 * The canonical implementation lives in `entraAuth.ts`.
 */
export const extractMinistry = extractMinistryFromEntra;

/**
 * Development mock user. Injected only when Entra is unconfigured AND no
 * credentials are presented (no cookie, no Bearer header).
 */
export const DEV_USER: AuthUser = {
  id: "dev-user-001",
  entraId: "dev-entra-id",
  email: "cohen.mcleod@gov.ab.ca",
  displayName: "Cohen McLeod",
  ministryCode: "INFRA",
  role: "admin",
};

function getIp(req: Request): string {
  return (req.ip || req.socket.remoteAddress || "unknown").toString();
}

export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const ipAddress = getIp(req);
  const sessionCookie: string | undefined = req.cookies?.[COOKIE_SESSION];
  const bearer = req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];

  // 1. Session cookie wins. Failure here is terminal — do NOT fall through.
  if (sessionCookie) {
    // 1a. Authentication-level check: signature + expiry (no DB needed).
    let payload;
    try {
      payload = await verifySessionToken(sessionCookie);
    } catch (err) {
      const expired = err instanceof SessionExpiredError;
      const reason = expired
        ? "expired"
        : err instanceof InvalidSignatureError
          ? "invalid_signature"
          : "unknown";
      await logAudit({
        action: AuditAction.AUTH_FAILED,
        details: { reason, source: "cookie" },
        ipAddress,
      });
      res.status(401).json({ error: expired ? "SESSION_EXPIRED" : "SESSION_INVALID" });
      return;
    }

    // 1b. Resolve the user from DB. DB failures are infrastructure-level → 503.
    try {
      const user = await loadUserById(payload.userId);
      if (!user) {
        await logAudit({
          action: AuditAction.AUTH_FAILED,
          details: { reason: "user_not_found", source: "cookie" },
          ipAddress,
        });
        res.status(401).json({ error: "SESSION_INVALID" });
        return;
      }
      req.user = user;
      next();
      return;
    } catch (err) {
      logger.error("Session user lookup failed", err as Error, { userId: payload.userId });
      res.status(503).json({ error: "USER_LOOKUP_FAILED" });
      return;
    }
  }

  // 2. Bearer token (e.g. service-to-service or programmatic clients).
  if (bearer) {
    let claims;
    try {
      claims = await verifyEntraToken(bearer);
    } catch (err) {
      await logAudit({
        action: AuditAction.AUTH_FAILED,
        details: { reason: (err as Error).name || "invalid", source: "bearer" },
        ipAddress,
      });
      res.status(401).json({ error: "INVALID_TOKEN" });
      return;
    }
    try {
      req.user = await upsertUser(claims);
      next();
      return;
    } catch (err) {
      logger.error("Bearer user upsert failed", err as Error);
      res.status(503).json({ error: "USER_UPSERT_FAILED" });
      return;
    }
  }

  // 3. No credentials — dev mock only if Entra is unconfigured.
  if (env.NODE_ENV !== "production" && !env.ENTRA_CLIENT_ID) {
    req.user = DEV_USER;
    next();
    return;
  }

  // 4. Production (or dev with Entra configured) without credentials → reject.
  await logAudit({
    action: AuditAction.AUTH_FAILED,
    details: { reason: "missing", source: "none" },
    ipAddress,
  });
  res.status(401).json({ error: "UNAUTHENTICATED" });
}

/**
 * RBAC middleware - checks if user has required role.
 */
export function requireRole(...roles: AuthUser["role"][]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: `Insufficient permissions. Required role: ${roles.join(" or ")}` });
      return;
    }

    next();
  };
}

/**
 * Ministry scoping middleware - ensures user has a ministry association.
 */
export function requireMinistry(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }

  if (!req.user.ministryCode) {
    res.status(403).json({ error: "No ministry association found. Contact your administrator." });
    return;
  }

  next();
}
