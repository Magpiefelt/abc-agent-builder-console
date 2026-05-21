/**
 * API Proxy Tool (RESTRICTED)
 *
 * Implements get_call_api and post_call_api tools for the agent.
 * Makes HTTP requests to external URLs on behalf of the agent.
 *
 * CRITICAL SECURITY:
 * - Blocks private IP ranges (SSRF protection)
 * - Enforces request/response size limits (1MB)
 * - 30-second timeout
 * - Uses GoA bot User-Agent
 * - Logs all external API calls for audit
 */

import { env } from "../config/env.js";
import { logger } from "../services/logger.js";
import { auditSecurityEvent, AuditAction } from "../services/auditLogger.js";
import { isPrivateOrReservedHost, validatePublicHttpUrl } from "./_shared/ssrf.js";

// ============================================================================
// CONFIGURATION
// ============================================================================

const USER_AGENT = "GoA-ABC-Bot/1.0 (+https://gov.ab.ca)";
const FETCH_TIMEOUT_MS = 30000; // 30 seconds
const MAX_REQUEST_SIZE = 1 * 1024 * 1024; // 1MB
const MAX_RESPONSE_SIZE = 1 * 1024 * 1024; // 1MB

// ============================================================================
// SECURITY
// ============================================================================

/**
 * Check `hostname` against API_PROXY_ALLOWLIST (comma-separated; `*.example.com`
 * means any subdomain of example.com). Returns true if no allowlist is set
 * (allowlist is optional / opt-in).
 */
function isHostnameAllowlisted(hostname: string): boolean {
  if (!env.API_PROXY_ALLOWLIST) return true;
  const lower = hostname.toLowerCase();
  const patterns = env.API_PROXY_ALLOWLIST.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return patterns.some((entry) =>
    entry.startsWith("*.") ? lower.endsWith(entry.slice(1)) : lower === entry
  );
}

/**
 * Validate and sanitize a URL for external API calls. Combines SSRF blocking
 * with the optional API_PROXY_ALLOWLIST check.
 */
function validateUrl(url: string, toolName: string): { valid: boolean; parsed?: URL; error?: string } {
  const base = validatePublicHttpUrl(url);
  if (!base.valid) return base;

  if (!isHostnameAllowlisted(base.parsed!.hostname)) {
    auditSecurityEvent(AuditAction.SECURITY_INVALID_REQUEST, "system", {
      tool: toolName,
      url,
      reason: "host not in API_PROXY_ALLOWLIST",
    });
    return { valid: false, error: `Host '${base.parsed!.hostname}' is not in API_PROXY_ALLOWLIST.` };
  }

  return base;
}

// ============================================================================
// TYPES
// ============================================================================

export interface ApiProxyResult {
  success: boolean;
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: unknown;
  contentType?: string;
  error?: string;
}

// ============================================================================
// GET REQUEST
// ============================================================================

/**
 * Make a GET request to an external API endpoint.
 */
export async function getCallApi(params: Record<string, unknown>): Promise<ApiProxyResult> {
  const url = params.url as string;
  const customHeaders = (params.headers as Record<string, string>) || {};

  const validation = validateUrl(url, "get_call_api");
  if (!validation.valid) {
    try {
      if (url && isPrivateOrReservedHost(new URL(url).hostname)) {
        auditSecurityEvent(AuditAction.SECURITY_PRIVATE_IP_BLOCKED, "system", {
          tool: "get_call_api",
          url,
        });
      }
    } catch { /* URL was malformed — already handled by validation */ }
    return { success: false, error: validation.error };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch(validation.parsed!.toString(), {
      method: "GET",
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "application/json, text/plain, */*",
        ...customHeaders,
      },
      signal: controller.signal,
      redirect: "follow",
    });

    clearTimeout(timeout);

    // Check response size
    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength) > MAX_RESPONSE_SIZE) {
      return {
        success: false,
        error: `Response too large (${contentLength} bytes). Maximum is ${MAX_RESPONSE_SIZE} bytes.`,
      };
    }

    const contentType = response.headers.get("content-type") || "";
    const bodyText = await response.text();

    if (bodyText.length > MAX_RESPONSE_SIZE) {
      return {
        success: false,
        error: `Response body too large (${bodyText.length} bytes). Maximum is ${MAX_RESPONSE_SIZE} bytes.`,
      };
    }

    // Parse JSON if applicable
    let body: unknown;
    if (contentType.includes("application/json")) {
      try {
        body = JSON.parse(bodyText);
      } catch {
        body = bodyText;
      }
    } else {
      body = bodyText;
    }

    // Extract relevant response headers
    const responseHeaders: Record<string, string> = {};
    for (const [key, value] of response.headers.entries()) {
      if (["content-type", "content-length", "date", "server", "x-request-id"].includes(key.toLowerCase())) {
        responseHeaders[key] = value;
      }
    }

    return {
      success: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body,
      contentType,
    };
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes("abort")) {
      return { success: false, error: `Request timed out after ${FETCH_TIMEOUT_MS / 1000} seconds.` };
    }
    logger.error("API GET request failed", err, { url });
    return { success: false, error: `API request failed: ${msg}` };
  }
}

// ============================================================================
// POST REQUEST
// ============================================================================

/**
 * Make a POST request to an external API endpoint.
 */
export async function postCallApi(params: Record<string, unknown>): Promise<ApiProxyResult> {
  const url = params.url as string;
  const customHeaders = (params.headers as Record<string, string>) || {};
  const requestBody = params.body as Record<string, unknown> | undefined;

  const validation = validateUrl(url, "post_call_api");
  if (!validation.valid) {
    if (url) {
      try {
        if (isPrivateOrReservedHost(new URL(url).hostname)) {
          auditSecurityEvent(AuditAction.SECURITY_PRIVATE_IP_BLOCKED, "system", {
            tool: "post_call_api",
            url,
          });
        }
      } catch { /* invalid URL, already handled */ }
    }
    return { success: false, error: validation.error };
  }

  // Check request body size
  const bodyString = requestBody ? JSON.stringify(requestBody) : "";
  if (bodyString.length > MAX_REQUEST_SIZE) {
    return {
      success: false,
      error: `Request body too large (${bodyString.length} bytes). Maximum is ${MAX_REQUEST_SIZE} bytes.`,
    };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch(validation.parsed!.toString(), {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        "Content-Type": "application/json",
        "Accept": "application/json, text/plain, */*",
        ...customHeaders,
      },
      body: bodyString || undefined,
      signal: controller.signal,
      redirect: "follow",
    });

    clearTimeout(timeout);

    // Check response size
    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength) > MAX_RESPONSE_SIZE) {
      return {
        success: false,
        error: `Response too large (${contentLength} bytes). Maximum is ${MAX_RESPONSE_SIZE} bytes.`,
      };
    }

    const contentType = response.headers.get("content-type") || "";
    const responseText = await response.text();

    if (responseText.length > MAX_RESPONSE_SIZE) {
      return {
        success: false,
        error: `Response body too large (${responseText.length} bytes).`,
      };
    }

    // Parse JSON if applicable
    let body: unknown;
    if (contentType.includes("application/json")) {
      try {
        body = JSON.parse(responseText);
      } catch {
        body = responseText;
      }
    } else {
      body = responseText;
    }

    const responseHeaders: Record<string, string> = {};
    for (const [key, value] of response.headers.entries()) {
      if (["content-type", "content-length", "date", "server", "x-request-id"].includes(key.toLowerCase())) {
        responseHeaders[key] = value;
      }
    }

    return {
      success: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body,
      contentType,
    };
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes("abort")) {
      return { success: false, error: `Request timed out after ${FETCH_TIMEOUT_MS / 1000} seconds.` };
    }
    logger.error("API POST request failed", err, { url });
    return { success: false, error: `API request failed: ${msg}` };
  }
}
