/**
 * Microsoft Entra ID Authentication Service
 *
 * Responsibilities:
 * - Verify Entra-issued ID tokens via JWKS (24h cache, ETag-respecting via jose).
 * - Build OAuth 2.0 authorize URLs with PKCE (S256).
 * - Exchange authorization codes for tokens at the Entra token endpoint.
 * - Map verified claims to AuthUser and upsert the user row.
 * - Mint and verify our own short-lived session JWT (HS256, SESSION_SECRET).
 *
 * Architectural choice: we do NOT pass the Entra access/ID token through as a
 * session cookie. After verifying the Entra token once at /callback, we mint
 * our own HS256 JWT signed with SESSION_SECRET. This keeps the hot path free
 * of JWKS lookups and decouples session lifetime from Entra token lifetime.
 */
import { createRemoteJWKSet, jwtVerify, SignJWT, type JWTPayload } from "jose";
import { env } from "../config/env.js";
import { query } from "../config/database.js";
import { logger } from "./logger.js";
import type { AuthUser } from "../middleware/auth.js";

// ============================================================================
// CONSTANTS
// ============================================================================

const ENTRA_BASE = "https://login.microsoftonline.com";
const SESSION_TTL_SECONDS = 8 * 60 * 60; // 8 hours
const OAUTH_STATE_TTL_SECONDS = 5 * 60; // 5 minutes

// Distinct issuer values so a session JWT cannot be swapped for an OAuth state
// cookie (or vice versa) — both are HS256 with the same secret.
const SESSION_ISSUER = "abc-agent-builder/session";
const OAUTH_STATE_ISSUER = "abc-agent-builder/oauth-state";

const sessionKey = (): Uint8Array => new TextEncoder().encode(env.SESSION_SECRET);

// ============================================================================
// ERROR TYPES
// ============================================================================

export class SessionExpiredError extends Error {
  constructor(message = "Session expired") {
    super(message);
    this.name = "SessionExpiredError";
  }
}

export class InvalidSignatureError extends Error {
  constructor(message = "Invalid signature") {
    super(message);
    this.name = "InvalidSignatureError";
  }
}

export class EntraConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EntraConfigError";
  }
}

// ============================================================================
// JWKS CACHE
// ============================================================================

let jwksCache: ReturnType<typeof createRemoteJWKSet> | null = null;
let jwksCacheTenant: string | null = null;

function getJwks(tenantId: string): ReturnType<typeof createRemoteJWKSet> {
  if (jwksCache && jwksCacheTenant === tenantId) return jwksCache;
  const url = new URL(`${ENTRA_BASE}/${tenantId}/discovery/v2.0/keys`);
  jwksCache = createRemoteJWKSet(url, {
    cacheMaxAge: 24 * 60 * 60 * 1000,
    cooldownDuration: 30 * 1000,
  });
  jwksCacheTenant = tenantId;
  return jwksCache;
}

// ============================================================================
// MINISTRY EXTRACTION
// ============================================================================

const MINISTRY_GROUP_RE = /^AIM-G-(\w+)-ALL_(?:EMPLOYEES|CONTRACTORS)$/;

export function extractMinistry(groups: string[] | undefined): string | null {
  if (!Array.isArray(groups)) return null;
  for (const group of groups) {
    const match = group.match(MINISTRY_GROUP_RE);
    if (match) return match[1];
  }
  return null;
}

// ============================================================================
// ENTRA TOKEN VERIFICATION
// ============================================================================

export interface EntraClaims extends JWTPayload {
  oid?: string;
  sub?: string;
  preferred_username?: string;
  upn?: string;
  email?: string;
  name?: string;
  groups?: string[];
}

export async function verifyEntraToken(token: string): Promise<EntraClaims> {
  if (!env.ENTRA_TENANT_ID || !env.ENTRA_CLIENT_ID) {
    throw new EntraConfigError("Entra ID is not configured (ENTRA_TENANT_ID / ENTRA_CLIENT_ID missing)");
  }

  const expectedIssuer = `${ENTRA_BASE}/${env.ENTRA_TENANT_ID}/v2.0`;
  const { payload } = await jwtVerify(token, getJwks(env.ENTRA_TENANT_ID), {
    issuer: expectedIssuer,
    audience: env.ENTRA_CLIENT_ID,
  });
  return payload as EntraClaims;
}

// ============================================================================
// CLAIM → AUTHUSER MAPPING
// ============================================================================

export function claimsToAuthUser(claims: EntraClaims): Omit<AuthUser, "id"> {
  const entraId = claims.oid || claims.sub;
  if (!entraId) {
    throw new Error("Entra token missing required claim: oid or sub");
  }

  const email = claims.email || claims.preferred_username || claims.upn || "";
  const displayName = claims.name || email || "Unknown User";
  const ministryCode = extractMinistry(claims.groups);

  return {
    entraId,
    email,
    displayName,
    ministryCode,
    role: "user",
  };
}

// ============================================================================
// USER UPSERT
// ============================================================================

export async function upsertUser(claims: EntraClaims): Promise<AuthUser> {
  const partial = claimsToAuthUser(claims);
  const result = await query<{
    id: string;
    entra_id: string;
    email: string;
    display_name: string;
    ministry_code: string | null;
    role: AuthUser["role"];
  }>(
    `INSERT INTO users (entra_id, email, display_name, ministry_code, last_login)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (entra_id) DO UPDATE
       SET email = EXCLUDED.email,
           display_name = EXCLUDED.display_name,
           ministry_code = EXCLUDED.ministry_code,
           last_login = NOW(),
           updated_at = NOW()
     RETURNING id, entra_id, email, display_name, ministry_code, role`,
    [partial.entraId, partial.email, partial.displayName, partial.ministryCode],
  );

  const row = result.rows[0];
  return {
    id: row.id,
    entraId: row.entra_id,
    email: row.email,
    displayName: row.display_name,
    ministryCode: row.ministry_code,
    role: row.role,
  };
}

export async function loadUserById(userId: string): Promise<AuthUser | null> {
  const result = await query<{
    id: string;
    entra_id: string;
    email: string;
    display_name: string;
    ministry_code: string | null;
    role: AuthUser["role"];
  }>(
    `SELECT id, entra_id, email, display_name, ministry_code, role
     FROM users WHERE id = $1`,
    [userId],
  );
  if (result.rowCount === 0) return null;
  const row = result.rows[0];
  return {
    id: row.id,
    entraId: row.entra_id,
    email: row.email,
    displayName: row.display_name,
    ministryCode: row.ministry_code,
    role: row.role,
  };
}

// ============================================================================
// OAUTH FLOW HELPERS
// ============================================================================

export function buildAuthorizeUrl(state: string, codeChallenge: string, redirectUri: string): string {
  if (!env.ENTRA_TENANT_ID || !env.ENTRA_CLIENT_ID) {
    throw new EntraConfigError("Entra ID is not configured");
  }
  const url = new URL(`${ENTRA_BASE}/${env.ENTRA_TENANT_ID}/oauth2/v2.0/authorize`);
  url.searchParams.set("client_id", env.ENTRA_CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", "openid profile email offline_access");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export interface TokenResponse {
  id_token: string;
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

export async function exchangeCodeForToken(
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<TokenResponse> {
  if (!env.ENTRA_TENANT_ID || !env.ENTRA_CLIENT_ID || !env.ENTRA_CLIENT_SECRET) {
    throw new EntraConfigError("Entra ID is not fully configured for code exchange");
  }

  const body = new URLSearchParams({
    client_id: env.ENTRA_CLIENT_ID,
    client_secret: env.ENTRA_CLIENT_SECRET,
    code,
    code_verifier: codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });

  const response = await fetch(`${ENTRA_BASE}/${env.ENTRA_TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error("Entra token exchange failed", new Error(`HTTP ${response.status}`), {
      status: response.status,
      body: errorBody.substring(0, 500),
    });
    throw new Error(`Token exchange failed: HTTP ${response.status}`);
  }

  return (await response.json()) as TokenResponse;
}

// ============================================================================
// SESSION JWT (our own, HS256 with SESSION_SECRET)
// ============================================================================

export interface SessionPayload extends JWTPayload {
  userId: string;
  entraId: string;
  role: AuthUser["role"];
  ministryCode: string | null;
}

export async function signSessionToken(user: AuthUser): Promise<string> {
  return await new SignJWT({
    userId: user.id,
    entraId: user.entraId,
    role: user.role,
    ministryCode: user.ministryCode,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(SESSION_ISSUER)
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(sessionKey());
}

export async function verifySessionToken(token: string): Promise<SessionPayload> {
  try {
    const { payload } = await jwtVerify(token, sessionKey(), {
      algorithms: ["HS256"],
      issuer: SESSION_ISSUER,
    });
    return payload as SessionPayload;
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "ERR_JWT_EXPIRED") throw new SessionExpiredError();
    throw new InvalidSignatureError((err as Error).message);
  }
}

// ============================================================================
// OAUTH STATE COOKIE (signed JSON, 5-minute TTL)
// ============================================================================

export interface OAuthStatePayload extends JWTPayload {
  codeVerifier: string;
  state: string;
  returnTo: string;
}

export async function signOAuthState(input: {
  codeVerifier: string;
  state: string;
  returnTo: string;
}): Promise<string> {
  return await new SignJWT({ ...input })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(OAUTH_STATE_ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${OAUTH_STATE_TTL_SECONDS}s`)
    .sign(sessionKey());
}

export async function verifyOAuthState(token: string): Promise<OAuthStatePayload> {
  const { payload } = await jwtVerify(token, sessionKey(), {
    algorithms: ["HS256"],
    issuer: OAUTH_STATE_ISSUER,
  });
  return payload as OAuthStatePayload;
}

// ============================================================================
// SAFE RETURN-TO (defends against open-redirect via PKCE state's returnTo)
// ============================================================================

/**
 * Returns a same-origin pathname+search+hash, or "/" if input cannot be safely
 * accepted. Rejects:
 *   - non-string input
 *   - inputs > 1024 chars (DoS-shaped queries)
 *   - inputs that don't start with "/"
 *   - protocol-relative URLs ("//evil.com")
 *   - backslash variants that some browsers normalize to "//"
 *   - anything that resolves to a different origin when parsed
 */
export function safeReturnTo(returnTo: unknown): string {
  if (typeof returnTo !== "string") return "/";
  if (returnTo.length === 0 || returnTo.length > 1024) return "/";
  if (!returnTo.startsWith("/")) return "/";
  if (returnTo.startsWith("//")) return "/";
  if (returnTo.includes("\\")) return "/";
  try {
    const placeholder = "http://localhost.invalid";
    const url = new URL(returnTo, placeholder);
    if (url.origin !== placeholder) return "/";
    return url.pathname + url.search + url.hash || "/";
  } catch {
    return "/";
  }
}

// ============================================================================
// CONSTANTS (exported for routes/middleware)
// ============================================================================

export const COOKIE_SESSION = "abc_session";
export const COOKIE_OAUTH_STATE = "abc_oauth_state";
export const SESSION_TTL_MS = SESSION_TTL_SECONDS * 1000;
export const OAUTH_STATE_TTL_MS = OAUTH_STATE_TTL_SECONDS * 1000;
