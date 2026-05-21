/**
 * Web Scraping Tool (SECURE)
 *
 * Fetches and extracts text content from a web page URL.
 * Supports HTML content extraction with tag stripping.
 *
 * CRITICAL SECURITY:
 * - Blocks private IP ranges (10.x, 172.16-31.x, 192.168.x, 169.254.x, 127.x)
 * - NO browser spoofing. Uses honest GoA bot User-Agent.
 * - Enforces response size limits.
 * - Timeout protection.
 */

import { logger } from "../services/logger.js";
import { auditSecurityEvent, AuditAction } from "../services/auditLogger.js";
import { isPrivateOrReservedHost } from "./_shared/ssrf.js";

// ============================================================================
// CONFIGURATION
// ============================================================================

const USER_AGENT = "GoA-ABC-Bot/1.0 (+https://gov.ab.ca)";
const MAX_RESPONSE_SIZE = 2 * 1024 * 1024; // 2MB
const FETCH_TIMEOUT_MS = 30000; // 30 seconds
const DEFAULT_MAX_CHARS = 50000;

// ============================================================================
// HTML TEXT EXTRACTION
// ============================================================================

/**
 * Strip HTML tags and extract readable text content.
 * Simple but effective for most web pages.
 */
function extractTextFromHTML(html: string): string {
  // Remove script and style elements entirely
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, "")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "");

  // Replace block-level elements with newlines
  text = text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|h[1-6]|li|tr|blockquote|pre|section|article)[^>]*>/gi, "\n")
    .replace(/<\/?(ul|ol|table|thead|tbody)[^>]*>/gi, "\n");

  // Strip remaining tags
  text = text.replace(/<[^>]+>/g, "");

  // Decode common HTML entities
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)))
    .replace(/&[a-z]+;/gi, " ");

  // Clean up whitespace
  text = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n");

  // Collapse multiple blank lines
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}

// ============================================================================
// TOOL IMPLEMENTATION
// ============================================================================

export interface WebScrapeResult {
  success: boolean;
  content?: string;
  url?: string;
  contentType?: string;
  contentLength?: number;
  error?: string;
}

/**
 * Fetch and extract text content from a web page URL.
 */
export async function webScrape(params: Record<string, unknown>): Promise<WebScrapeResult> {
  const url = params.url as string;
  const maxCharacters = Math.min((params.maxCharacters as number) || DEFAULT_MAX_CHARS, 100000);

  if (!url || typeof url !== "string" || url.trim().length === 0) {
    return { success: false, error: "A non-empty URL is required." };
  }

  // Validate URL format
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url.trim());
  } catch {
    return { success: false, error: `Invalid URL format: "${url}"` };
  }

  // Only allow HTTP/HTTPS
  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    return { success: false, error: `Unsupported protocol: "${parsedUrl.protocol}". Only HTTP/HTTPS allowed.` };
  }

  // SECURITY: Block private/internal IPs
  if (isPrivateOrReservedHost(parsedUrl.hostname)) {
    logger.warn("Web scrape blocked: private IP", { url, hostname: parsedUrl.hostname });
    auditSecurityEvent(AuditAction.SECURITY_PRIVATE_IP_BLOCKED, "system", {
      tool: "web_scrape",
      url,
      hostname: parsedUrl.hostname,
    });
    return { success: false, error: "Cannot access private or internal network addresses." };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch(parsedUrl.toString(), {
      method: "GET",
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,text/plain,application/pdf",
        "Accept-Language": "en-CA,en;q=0.9",
      },
      signal: controller.signal,
      redirect: "follow",
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
        url: parsedUrl.toString(),
      };
    }

    // Check response size
    const contentLengthHeader = response.headers.get("content-length");
    if (contentLengthHeader && parseInt(contentLengthHeader) > MAX_RESPONSE_SIZE) {
      return {
        success: false,
        error: `Response too large (${parseInt(contentLengthHeader)} bytes). Maximum is ${MAX_RESPONSE_SIZE} bytes.`,
      };
    }

    const contentType = response.headers.get("content-type") || "";
    const body = await response.text();

    // Enforce size limit on actual body
    if (body.length > MAX_RESPONSE_SIZE) {
      return {
        success: false,
        error: `Response body too large. Maximum is ${MAX_RESPONSE_SIZE} bytes.`,
      };
    }

    // Extract text based on content type
    let extractedText: string;
    if (contentType.includes("text/html") || contentType.includes("application/xhtml")) {
      extractedText = extractTextFromHTML(body);
    } else if (contentType.includes("text/plain")) {
      extractedText = body.trim();
    } else if (contentType.includes("application/json")) {
      try {
        extractedText = JSON.stringify(JSON.parse(body), null, 2);
      } catch {
        extractedText = body;
      }
    } else {
      // For other types, return raw text (truncated)
      extractedText = body.trim();
    }

    // Truncate to maxCharacters
    if (extractedText.length > maxCharacters) {
      extractedText = extractedText.substring(0, maxCharacters) + "\n\n[Content truncated at " + maxCharacters + " characters]";
    }

    return {
      success: true,
      content: extractedText,
      url: parsedUrl.toString(),
      contentType,
      contentLength: extractedText.length,
    };
  } catch (err) {
    const errorMsg = (err as Error).message;
    if (errorMsg.includes("abort")) {
      return { success: false, error: `Request timed out after ${FETCH_TIMEOUT_MS / 1000} seconds.` };
    }
    logger.error("Web scrape failed", err, { url });
    return { success: false, error: `Web scrape failed: ${errorMsg}` };
  }
}
