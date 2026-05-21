/**
 * Authentication Routes
 *
 *   GET  /api/auth/login    — Begin OIDC flow (PKCE), redirect to Entra.
 *   GET  /api/auth/callback — Handle Entra redirect, exchange code, set session cookie.
 *   POST /api/auth/logout   — Clear session cookie.
 *   GET  /api/auth/me       — Return the authenticated user.
 */
import { Router, type Request, type Response } from "express";
import { randomBytes, createHash } from "node:crypto";
import { env } from "../config/env.js";
import { logger } from "../services/logger.js";
import { logAudit, AuditAction } from "../services/auditLogger.js";
import { authenticate } from "../middleware/auth.js";
import {
  COOKIE_OAUTH_STATE,
  COOKIE_SESSION,
  OAUTH_STATE_TTL_MS,
  SESSION_TTL_MS,
  buildAuthorizeUrl,
  exchangeCodeForToken,
  signOAuthState,
  signSessionToken,
  upsertUser,
  verifyEntraToken,
  verifyOAuthState,
  EntraConfigError,
} from "../services/entraAuth.js";

const router = Router();

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function safeReturnTo(returnTo: unknown): string {
  if (typeof returnTo !== "string") return "/";
  // Only accept relative same-origin paths to prevent open-redirect.
  if (returnTo.startsWith("/") && !returnTo.startsWith("//")) return returnTo;
  return "/";
}

function getRedirectUri(): string {
  if (env.ENTRA_REDIRECT_URI) return env.ENTRA_REDIRECT_URI;
  // Sensible default for development.
  return `http://localhost:${env.PORT}/api/auth/callback`;
}

function cookieSecure(): boolean {
  return env.NODE_ENV === "production";
}

// ============================================================================
// GET /api/auth/login
// ============================================================================
router.get("/login", async (req: Request, res: Response) => {
  if (!env.ENTRA_CLIENT_ID || !env.ENTRA_TENANT_ID) {
    res.status(503).json({ error: "Entra ID is not configured on this server." });
    return;
  }

  const state = base64url(randomBytes(16));
  const codeVerifier = base64url(randomBytes(32));
  const codeChallenge = base64url(createHash("sha256").update(codeVerifier).digest());
  const returnTo = safeReturnTo(req.query.returnTo);

  const stateToken = await signOAuthState({ codeVerifier, state, returnTo });

  res.cookie(COOKIE_OAUTH_STATE, stateToken, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: "lax",
    maxAge: OAUTH_STATE_TTL_MS,
    path: "/api/auth",
  });

  const url = buildAuthorizeUrl(state, codeChallenge, getRedirectUri());
  res.redirect(302, url);
});

// ============================================================================
// GET /api/auth/callback
// ============================================================================
router.get("/callback", async (req: Request, res: Response) => {
  const ipAddress = (req.ip || req.socket.remoteAddress || "unknown").toString();
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies || {};
  const stateCookie = cookies[COOKIE_OAUTH_STATE];

  const failureRedirect = `${env.FRONTEND_URL}/login?error=`;

  async function fail(reason: string, status = 400): Promise<void> {
    await logAudit({
      action: AuditAction.AUTH_FAILED,
      details: { reason, source: "callback" },
      ipAddress,
    });
    res.clearCookie(COOKIE_OAUTH_STATE, { path: "/api/auth" });
    if (req.accepts(["html", "json"]) === "json") {
      res.status(status).json({ error: reason });
    } else {
      res.redirect(302, failureRedirect + encodeURIComponent(reason));
    }
  }

  if (req.query.error) {
    await fail(String(req.query.error_description || req.query.error));
    return;
  }

  const code = typeof req.query.code === "string" ? req.query.code : "";
  const incomingState = typeof req.query.state === "string" ? req.query.state : "";
  if (!code || !incomingState) {
    await fail("missing_code_or_state");
    return;
  }

  if (!stateCookie) {
    await fail("missing_state_cookie");
    return;
  }

  let statePayload;
  try {
    statePayload = await verifyOAuthState(stateCookie);
  } catch {
    await fail("invalid_state_cookie");
    return;
  }

  if (statePayload.state !== incomingState) {
    await fail("state_mismatch");
    return;
  }

  try {
    const tokens = await exchangeCodeForToken(code, statePayload.codeVerifier, getRedirectUri());
    const claims = await verifyEntraToken(tokens.id_token);
    const user = await upsertUser(claims);
    const sessionToken = await signSessionToken(user);

    res.cookie(COOKIE_SESSION, sessionToken, {
      httpOnly: true,
      secure: cookieSecure(),
      sameSite: "strict",
      maxAge: SESSION_TTL_MS,
      path: "/",
    });
    res.clearCookie(COOKIE_OAUTH_STATE, { path: "/api/auth" });

    await logAudit({
      userId: user.id,
      ministryCode: user.ministryCode || undefined,
      action: AuditAction.AUTH_LOGIN,
      ipAddress,
    });

    res.redirect(302, env.FRONTEND_URL + safeReturnTo(statePayload.returnTo));
  } catch (err) {
    logger.error("OAuth callback failure", err as Error);
    if (err instanceof EntraConfigError) {
      await fail("entra_not_configured", 503);
    } else {
      await fail("authentication_failed", 401);
    }
  }
});

// ============================================================================
// POST /api/auth/logout
// ============================================================================
router.post("/logout", authenticate, async (req: Request, res: Response) => {
  const ipAddress = (req.ip || req.socket.remoteAddress || "unknown").toString();
  res.clearCookie(COOKIE_SESSION, { path: "/" });
  res.clearCookie(COOKIE_OAUTH_STATE, { path: "/api/auth" });

  if (req.user) {
    await logAudit({
      userId: req.user.id,
      ministryCode: req.user.ministryCode || undefined,
      action: AuditAction.AUTH_LOGOUT,
      ipAddress,
    });
  }

  res.status(204).send();
});

// ============================================================================
// GET /api/auth/me
// ============================================================================
router.get("/me", authenticate, (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: "UNAUTHENTICATED" });
    return;
  }
  res.json({
    id: req.user.id,
    entraId: req.user.entraId,
    email: req.user.email,
    displayName: req.user.displayName,
    ministryCode: req.user.ministryCode,
    role: req.user.role,
  });
});

export default router;
