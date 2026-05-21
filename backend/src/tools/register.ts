/**
 * Tool Registration
 *
 * Imports all Phase 3 tool handlers and registers them with the
 * toolDispatcher's edge tool registry at application startup.
 *
 * This module must be imported early in the application lifecycle
 * (in index.ts) so that tools are available before any agent session starts.
 *
 * The dispatcher uses a registration pattern (registerEdgeTools) rather than
 * direct imports to keep the dispatcher itself decoupled from tool implementations.
 */

import { registerEdgeTools } from "../services/toolDispatcher.js";
import { logger } from "../services/logger.js";

// Phase 3 tool implementations
import { braveSearch, googleSearch } from "./webSearch.js";
import { webScrape } from "./webScrape.js";
import { readGithubRepo, readGithubFile } from "./github.js";
import { pdfExtractText, pdfInfo, ocrImage, readZipContents, readZipFile, extractZipFiles } from "./documents.js";
import { getCallApi, postCallApi } from "./apiProxy.js";
import { getTime, getWeather } from "./utilities.js";

/**
 * Register all Phase 3 edge tools with the dispatcher.
 * Call this once at application startup.
 */
export function registerAllTools(): void {
  registerEdgeTools({
    // Web Search
    brave_search: braveSearch,
    google_search: googleSearch,

    // Web Scraping
    web_scrape: webScrape,

    // GitHub
    read_github_repo: readGithubRepo,
    read_github_file: readGithubFile,

    // Document Processing
    pdf_extract_text: pdfExtractText,
    pdf_info: pdfInfo,
    ocr_image: ocrImage,
    read_zip_contents: readZipContents,
    read_zip_file: readZipFile,
    extract_zip_files: extractZipFiles,

    // API Proxy
    get_call_api: getCallApi,
    post_call_api: postCallApi,

    // Utilities
    get_time: getTime,
    get_weather: getWeather,
  });

  logger.info("All Phase 3 tools registered successfully");
}
