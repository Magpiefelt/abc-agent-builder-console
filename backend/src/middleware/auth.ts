/**
 * Authentication Middleware
 * Validates Microsoft Entra ID JWT tokens and extracts user identity.
 * In development mode, provides a mock user for local testing.
 */

import { Request, Response, NextFunction } from "express";
import { env } from "../config/env.js";

export interface AuthUser {
  id: string;
  entraId: string;
  email: string;
  displayName: string;
  ministryCode: string | null;
  role: "admin" | "user" | "viewer";
}

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/**
 * Extract ministry code from Entra ID group claims.
 * Groups follow pattern: AIM-G-{MINISTRY}-ALL_EMPLOYEES or AIM-G-{MINISTRY}-ALL_CONTRACTORS
 */
function extractMinistry(groups: string[]): string | null {
  for (const group of groups) {
    const match = group.match(/^AIM-G-(\w+)-ALL_(?:EMPLOYEES|CONTRACTORS)$/);
    if (match) {
      return match[1];
    }
  }
  return null;
}

/**
 * Development mock user for local testing without SSO.
 */
const DEV_USER: AuthUser = {
  id: "dev-user-001",
  entraId: "dev-entra-id",
  email: "cohen.mcleod@gov.ab.ca",
  displayName: "Cohen McLeod",
  ministryCode: "INFRA",
  role: "admin",
};

/**
 * Authentication middleware.
 * In production: validates Entra ID JWT from Authorization header.
 * In development: uses mock user if no token provided.
 */
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  // Development mode: allow mock user
  if (env.NODE_ENV === "development" && !authHeader) {
    req.user = DEV_USER;
    next();
    return;
  }

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required. Provide a valid Bearer token." });
    return;
  }

  const token = authHeader.slice(7);

  // TODO: Implement actual Entra ID JWT validation
  // For now, in development, accept any token and use mock user
  if (env.NODE_ENV === "development") {
    req.user = DEV_USER;
    next();
    return;
  }

  // Production: validate JWT against Entra ID
  // This will be implemented when SSO credentials are provided
  try {
    // Placeholder for JWT validation logic:
    // 1. Verify signature against Entra ID JWKS endpoint
    // 2. Check expiration, audience, issuer
    // 3. Extract user claims (oid, email, name, groups)
    // 4. Extract ministry from group claims
    // 5. Look up or create user in database

    res.status(401).json({ error: "Token validation not yet configured for production." });
  } catch (err) {
    res.status(401).json({ error: "Invalid or expired token." });
  }
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
 * Ministry scoping middleware - ensures user can only access their ministry's data.
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
