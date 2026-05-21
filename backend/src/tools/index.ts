/**
 * Tool Index — Barrel Export
 *
 * Central export point for all Phase 3 tool implementations.
 * Each tool exports an async function matching the dispatcher's EdgeToolHandler signature:
 *   (params: Record<string, unknown>) => Promise<{ success: boolean; result: unknown; error?: string }>
 *
 * NOTE: This barrel file is for convenience imports only.
 * Actual runtime registration happens in `tools/register.ts`, which is called
 * from `index.ts` at application startup via `registerAllTools()`.
 */

// Web Search
export { braveSearch, googleSearch } from "./webSearch.js";

// Web Scraping
export { webScrape } from "./webScrape.js";

// GitHub
export { readGithubRepo, readGithubFile } from "./github.js";

// Document Processing
export { pdfExtractText, pdfInfo, ocrImage, readZipContents, readZipFile, extractZipFiles } from "./documents.js";

// API Proxy
export { getCallApi, postCallApi } from "./apiProxy.js";

// Utilities
export { getTime, getWeather } from "./utilities.js";

// Registration (re-export for convenience)
export { registerAllTools } from "./register.js";
