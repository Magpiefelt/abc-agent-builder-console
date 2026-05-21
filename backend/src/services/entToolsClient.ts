/**
 * GoA Enterprise Tools HTTP client.
 *
 * Thin wrapper around `fetch` for `https://ent-tools.sandbox.aim.int.gov.ab.ca`.
 * When `ENT_TOOLS_API_KEY` is set, this client is the preferred path for
 * external API calls — keeps egress consolidated through the GoA proxy.
 * Tools fall back to direct vendor APIs when the key is not configured.
 *
 * SSRF check applied to the base URL itself (refuses configurations that
 * point at private ranges).
 */

import { env } from "../config/env.js";
import { logger } from "./logger.js";
import { isPrivateOrReservedHost } from "../tools/_shared/ssrf.js";

const USER_AGENT = "GoA-ABC-Bot/1.0 (+https://gov.ab.ca)";
const FETCH_TIMEOUT_MS = 30_000;

export class EntToolsNotConfiguredError extends Error {
  constructor() {
    super("ENT_TOOLS_API_KEY is not configured.");
    this.name = "EntToolsNotConfiguredError";
  }
}

export function isEntToolsConfigured(): boolean {
  return !!env.ENT_TOOLS_API_KEY;
}

function ensureBaseUrlSafe(): URL {
  const url = new URL(env.ENT_TOOLS_BASE_URL);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`ENT_TOOLS_BASE_URL must be HTTP(S): "${env.ENT_TOOLS_BASE_URL}"`);
  }
  if (isPrivateOrReservedHost(url.hostname)) {
    throw new Error(`ENT_TOOLS_BASE_URL hostname is private/reserved: "${url.hostname}"`);
  }
  return url;
}

async function entFetch(path: string, init: RequestInit): Promise<Response> {
  if (!env.ENT_TOOLS_API_KEY) throw new EntToolsNotConfiguredError();

  const base = ensureBaseUrlSafe();
  const url = new URL(path, base);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      ...init,
      headers: {
        "User-Agent": USER_AGENT,
        "Authorization": `Bearer ${env.ENT_TOOLS_API_KEY}`,
        ...(init.headers || {}),
      },
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

// ============================================================================
// BRAVE SEARCH (via Ent Tools)
// ============================================================================

export interface EntSearchResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Search the web via Ent Tools' Brave Search proxy.
 * Response shape mirrors the upstream Brave API so the calling tool can map
 * to its existing `SearchToolResult`.
 */
export async function entBraveSearch(
  query: string,
  opts: { count?: number } = {}
): Promise<{ results: EntSearchResult[] }> {
  const count = Math.min(opts.count || 10, 20);
  const path = `${env.ENT_TOOLS_BRAVE_PATH}?q=${encodeURIComponent(query)}&count=${count}`;
  const response = await entFetch(path, {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    const errText = await response.text();
    logger.error("Ent Tools brave search failed", null, {
      status: response.status,
      error: errText.substring(0, 200),
    });
    throw new Error(`Ent Tools brave search returned ${response.status}`);
  }

  const data = (await response.json()) as Record<string, unknown>;
  const webResults =
    ((data.web as Record<string, unknown> | undefined)?.results as Array<Record<string, unknown>> | undefined) ??
    ((data.results as Array<Record<string, unknown>>) || []);

  const results: EntSearchResult[] = webResults.slice(0, count).map((r) => ({
    title: (r.title as string) || "",
    url: (r.url as string) || "",
    snippet: ((r.description as string) || (r.snippet as string) || ""),
  }));

  return { results };
}

// ============================================================================
// IMAGE GENERATION (via Ent Tools)
// ============================================================================

export interface EntImageResult {
  base64: string;
  mimeType: string;
}

/**
 * Generate an image via Ent Tools' image generation endpoint.
 * Returns the raw base64 payload plus mime type for artifact persistence.
 */
export async function entImageGeneration(
  prompt: string,
  opts: { size?: string; model?: string } = {}
): Promise<EntImageResult> {
  const response = await entFetch(env.ENT_TOOLS_IMAGE_PATH, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      prompt,
      size: opts.size || "1024x1024",
      model: opts.model || "dall-e-3",
      response_format: "b64_json",
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    logger.error("Ent Tools image generation failed", null, {
      status: response.status,
      error: errText.substring(0, 200),
    });
    throw new Error(`Ent Tools image generation returned ${response.status}`);
  }

  const data = (await response.json()) as Record<string, unknown>;
  const first = ((data.data as Array<Record<string, unknown>> | undefined) || [])[0];
  const b64 = first?.b64_json as string | undefined;
  if (!b64) throw new Error("Ent Tools image response missing b64_json");

  return { base64: b64, mimeType: "image/png" };
}
