/**
 * Web Search Tools
 *
 * Implements brave_search and google_search tools for the agent.
 * Both accept a query and numResults parameter and return structured results.
 *
 * Security: API keys are server-side only. No user input is passed unsanitized.
 */

import { env } from "../config/env.js";
import { logger } from "../services/logger.js";

// ============================================================================
// TYPES
// ============================================================================

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchToolResult {
  success: boolean;
  results?: SearchResult[];
  query?: string;
  totalResults?: number;
  error?: string;
}

// ============================================================================
// BRAVE SEARCH
// ============================================================================

/**
 * Search the web using Brave Search API.
 */
export async function braveSearch(params: Record<string, unknown>): Promise<SearchToolResult> {
  const query = params.query as string;
  const numResults = Math.min((params.numResults as number) || 10, 20);

  if (!query || typeof query !== "string" || query.trim().length === 0) {
    return { success: false, error: "A non-empty search query is required." };
  }

  if (!env.BRAVE_SEARCH_API_KEY) {
    return { success: false, error: "Brave Search API key is not configured." };
  }

  try {
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query.trim());
    url.searchParams.set("count", String(numResults));

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": env.BRAVE_SEARCH_API_KEY,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error("Brave Search API error", null, {
        status: response.status,
        error: errorText.substring(0, 200),
      });
      return { success: false, error: `Brave Search API error (${response.status}).` };
    }

    const data = await response.json() as Record<string, unknown>;
    const webResults = (data.web as Record<string, unknown>)?.results as Array<Record<string, unknown>> || [];

    const results: SearchResult[] = webResults.slice(0, numResults).map((r) => ({
      title: (r.title as string) || "",
      url: (r.url as string) || "",
      snippet: (r.description as string) || "",
    }));

    return {
      success: true,
      results,
      query: query.trim(),
      totalResults: results.length,
    };
  } catch (err) {
    logger.error("Brave Search failed", err);
    return { success: false, error: `Brave Search request failed: ${(err as Error).message}` };
  }
}

// ============================================================================
// GOOGLE CUSTOM SEARCH
// ============================================================================

/**
 * Search the web using Google Custom Search API.
 */
export async function googleSearch(params: Record<string, unknown>): Promise<SearchToolResult> {
  const query = params.query as string;
  const numResults = Math.min((params.numResults as number) || 10, 10); // Google CSE max is 10

  if (!query || typeof query !== "string" || query.trim().length === 0) {
    return { success: false, error: "A non-empty search query is required." };
  }

  if (!env.GOOGLE_SEARCH_API_KEY || !env.GOOGLE_SEARCH_CX) {
    return { success: false, error: "Google Search API key or CX is not configured." };
  }

  try {
    const url = new URL("https://www.googleapis.com/customsearch/v1");
    url.searchParams.set("key", env.GOOGLE_SEARCH_API_KEY);
    url.searchParams.set("cx", env.GOOGLE_SEARCH_CX);
    url.searchParams.set("q", query.trim());
    url.searchParams.set("num", String(numResults));

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: { "Accept": "application/json" },
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error("Google Search API error", null, {
        status: response.status,
        error: errorText.substring(0, 200),
      });
      return { success: false, error: `Google Search API error (${response.status}).` };
    }

    const data = await response.json() as Record<string, unknown>;
    const items = (data.items as Array<Record<string, unknown>>) || [];

    const results: SearchResult[] = items.slice(0, numResults).map((item) => ({
      title: (item.title as string) || "",
      url: (item.link as string) || "",
      snippet: (item.snippet as string) || "",
    }));

    return {
      success: true,
      results,
      query: query.trim(),
      totalResults: results.length,
    };
  } catch (err) {
    logger.error("Google Search failed", err);
    return { success: false, error: `Google Search request failed: ${(err as Error).message}` };
  }
}
