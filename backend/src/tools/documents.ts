/**
 * Document Processing Tools
 *
 * Implements PDF, ZIP, and OCR tools for the agent.
 * Uses pdf-parse for PDF extraction and adm-zip for ZIP handling.
 *
 * Note: These tools require additional npm packages:
 *   npm install pdf-parse adm-zip
 *   npm install -D @types/adm-zip
 *
 * Security:
 * - Private IP blocking on all URL fetches
 * - Response size limits
 * - Timeout protection
 */

import { logger } from "../services/logger.js";

// ============================================================================
// CONFIGURATION
// ============================================================================

const USER_AGENT = "GoA-ABC-Bot/1.0 (+https://gov.ab.ca)";
const FETCH_TIMEOUT_MS = 60000; // 60 seconds for large files
const MAX_DOWNLOAD_SIZE = 50 * 1024 * 1024; // 50MB max download

// ============================================================================
// SHARED UTILITIES
// ============================================================================

/**
 * Check if a hostname is private/internal (SSRF protection).
 */
function isPrivateHost(hostname: string): boolean {
  const blockedHosts = ["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"];
  if (blockedHosts.includes(hostname.toLowerCase())) return true;

  const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [, a, b] = ipv4Match.map(Number);
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 0) return true;
  }

  return false;
}

/**
 * Fetch a remote file as a Buffer with security checks.
 */
async function fetchFileBuffer(url: string): Promise<{ buffer: Buffer; contentType: string } | { error: string }> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return { error: `Invalid URL: "${url}"` };
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    return { error: `Unsupported protocol: "${parsedUrl.protocol}"` };
  }

  if (isPrivateHost(parsedUrl.hostname)) {
    return { error: "Cannot access private or internal network addresses." };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(parsedUrl.toString(), {
      method: "GET",
      headers: { "User-Agent": USER_AGENT },
      signal: controller.signal,
      redirect: "follow",
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return { error: `HTTP ${response.status}: ${response.statusText}` };
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength) > MAX_DOWNLOAD_SIZE) {
      return { error: `File too large (${contentLength} bytes). Maximum is ${MAX_DOWNLOAD_SIZE} bytes.` };
    }

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_DOWNLOAD_SIZE) {
      return { error: `Downloaded file too large (${arrayBuffer.byteLength} bytes).` };
    }

    return {
      buffer: Buffer.from(arrayBuffer),
      contentType: response.headers.get("content-type") || "",
    };
  } catch (err) {
    clearTimeout(timeout);
    const msg = (err as Error).message;
    if (msg.includes("abort")) {
      return { error: `Download timed out after ${FETCH_TIMEOUT_MS / 1000} seconds.` };
    }
    return { error: `Download failed: ${msg}` };
  }
}

// ============================================================================
// PDF TOOLS
// ============================================================================

export interface PdfExtractResult {
  success: boolean;
  text?: string;
  pages?: number;
  info?: Record<string, unknown>;
  error?: string;
}

/**
 * Extract text content from a PDF file URL.
 */
export async function pdfExtractText(params: Record<string, unknown>): Promise<PdfExtractResult> {
  const url = params.url as string;
  const maxPages = (params.maxPages as number) || 50;

  if (!url) {
    return { success: false, error: "URL parameter is required." };
  }

  const fetchResult = await fetchFileBuffer(url);
  if ("error" in fetchResult) {
    return { success: false, error: fetchResult.error };
  }

  try {
    // Dynamic import to handle missing dependency gracefully
    const pdfParse = await import("pdf-parse").then((m) => m.default || m).catch(() => null);

    if (!pdfParse) {
      return {
        success: false,
        error: "pdf-parse package is not installed. Run: npm install pdf-parse",
      };
    }

    const data = await pdfParse(fetchResult.buffer, { max: maxPages });

    return {
      success: true,
      text: data.text.substring(0, 100000), // Cap at 100K chars
      pages: data.numpages,
      info: {
        title: data.info?.Title || null,
        author: data.info?.Author || null,
        creator: data.info?.Creator || null,
        producer: data.info?.Producer || null,
        creationDate: data.info?.CreationDate || null,
      },
    };
  } catch (err) {
    logger.error("PDF extraction failed", err, { url });
    return { success: false, error: `PDF extraction failed: ${(err as Error).message}` };
  }
}

/**
 * Get metadata and page count from a PDF file.
 */
export async function pdfInfo(params: Record<string, unknown>): Promise<PdfExtractResult> {
  const url = params.url as string;

  if (!url) {
    return { success: false, error: "URL parameter is required." };
  }

  const fetchResult = await fetchFileBuffer(url);
  if ("error" in fetchResult) {
    return { success: false, error: fetchResult.error };
  }

  try {
    const pdfParse = await import("pdf-parse").then((m) => m.default || m).catch(() => null);

    if (!pdfParse) {
      return { success: false, error: "pdf-parse package is not installed." };
    }

    // Parse with max 0 pages to just get metadata
    const data = await pdfParse(fetchResult.buffer, { max: 1 });

    return {
      success: true,
      pages: data.numpages,
      info: {
        title: data.info?.Title || null,
        author: data.info?.Author || null,
        creator: data.info?.Creator || null,
        producer: data.info?.Producer || null,
        creationDate: data.info?.CreationDate || null,
        modDate: data.info?.ModDate || null,
        fileSize: fetchResult.buffer.length,
      },
    };
  } catch (err) {
    logger.error("PDF info extraction failed", err, { url });
    return { success: false, error: `PDF info extraction failed: ${(err as Error).message}` };
  }
}

// ============================================================================
// ZIP TOOLS
// ============================================================================

export interface ZipContentsResult {
  success: boolean;
  entries?: Array<{ path: string; size: number; compressedSize: number; isDirectory: boolean }>;
  totalFiles?: number;
  error?: string;
}

export interface ZipFileResult {
  success: boolean;
  content?: string;
  path?: string;
  size?: number;
  error?: string;
}

/**
 * List the file entries in a ZIP archive.
 */
export async function readZipContents(params: Record<string, unknown>): Promise<ZipContentsResult> {
  const url = params.url as string;

  if (!url) {
    return { success: false, error: "URL parameter is required." };
  }

  const fetchResult = await fetchFileBuffer(url);
  if ("error" in fetchResult) {
    return { success: false, error: fetchResult.error };
  }

  try {
    const AdmZip = await import("adm-zip").then((m) => m.default || m).catch(() => null);

    if (!AdmZip) {
      return { success: false, error: "adm-zip package is not installed. Run: npm install adm-zip" };
    }

    const zip = new AdmZip(fetchResult.buffer);
    const zipEntries = zip.getEntries();

    const entries = zipEntries.map((entry: { entryName: string; header: { size: number; compressedSize: number }; isDirectory: boolean }) => ({
      path: entry.entryName,
      size: entry.header.size,
      compressedSize: entry.header.compressedSize,
      isDirectory: entry.isDirectory,
    }));

    return {
      success: true,
      entries,
      totalFiles: entries.filter((e: { isDirectory: boolean }) => !e.isDirectory).length,
    };
  } catch (err) {
    logger.error("ZIP contents listing failed", err, { url });
    return { success: false, error: `ZIP processing failed: ${(err as Error).message}` };
  }
}

/**
 * Extract and read a specific file from a ZIP archive.
 */
export async function readZipFile(params: Record<string, unknown>): Promise<ZipFileResult> {
  const url = params.url as string;
  const filePath = params.filePath as string;

  if (!url || !filePath) {
    return { success: false, error: "Both 'url' and 'filePath' parameters are required." };
  }

  const fetchResult = await fetchFileBuffer(url);
  if ("error" in fetchResult) {
    return { success: false, error: fetchResult.error };
  }

  try {
    const AdmZip = await import("adm-zip").then((m) => m.default || m).catch(() => null);

    if (!AdmZip) {
      return { success: false, error: "adm-zip package is not installed." };
    }

    const zip = new AdmZip(fetchResult.buffer);
    const entry = zip.getEntry(filePath);

    if (!entry) {
      return { success: false, error: `File "${filePath}" not found in ZIP archive.` };
    }

    if (entry.isDirectory) {
      return { success: false, error: `"${filePath}" is a directory, not a file.` };
    }

    const content = entry.getData().toString("utf-8");

    return {
      success: true,
      content: content.substring(0, 100000), // Cap at 100K chars
      path: filePath,
      size: entry.header.size,
    };
  } catch (err) {
    logger.error("ZIP file read failed", err, { url, filePath });
    return { success: false, error: `ZIP file read failed: ${(err as Error).message}` };
  }
}

/**
 * Extract all files from a ZIP archive (with optional filter).
 */
export async function extractZipFiles(params: Record<string, unknown>): Promise<{
  success: boolean;
  files?: Array<{ path: string; content: string; size: number }>;
  error?: string;
}> {
  const url = params.url as string;
  const filter = params.filter as string | undefined;

  if (!url) {
    return { success: false, error: "URL parameter is required." };
  }

  const fetchResult = await fetchFileBuffer(url);
  if ("error" in fetchResult) {
    return { success: false, error: fetchResult.error };
  }

  try {
    const AdmZip = await import("adm-zip").then((m) => m.default || m).catch(() => null);

    if (!AdmZip) {
      return { success: false, error: "adm-zip package is not installed." };
    }

    const zip = new AdmZip(fetchResult.buffer);
    const zipEntries = zip.getEntries();

    const files: Array<{ path: string; content: string; size: number }> = [];
    let totalSize = 0;
    const MAX_TOTAL_SIZE = 10 * 1024 * 1024; // 10MB total extracted

    for (const entry of zipEntries) {
      if (entry.isDirectory) continue;

      // Apply glob-like filter if provided
      if (filter) {
        const regex = new RegExp(filter.replace(/\*/g, ".*").replace(/\?/g, "."), "i");
        if (!regex.test(entry.entryName)) continue;
      }

      const content = entry.getData().toString("utf-8");
      totalSize += content.length;

      if (totalSize > MAX_TOTAL_SIZE) {
        files.push({ path: "[TRUNCATED]", content: "Total extraction size limit reached.", size: 0 });
        break;
      }

      files.push({
        path: entry.entryName,
        content: content.substring(0, 50000), // Cap individual files
        size: entry.header.size,
      });
    }

    return { success: true, files };
  } catch (err) {
    logger.error("ZIP extraction failed", err, { url });
    return { success: false, error: `ZIP extraction failed: ${(err as Error).message}` };
  }
}

// ============================================================================
// OCR TOOL (STUB — requires external service)
// ============================================================================

/**
 * OCR image text extraction.
 * This is a stub that returns a helpful message about configuration.
 * Full implementation requires Tesseract.js or an external OCR API.
 */
export async function ocrImage(params: Record<string, unknown>): Promise<{
  success: boolean;
  text?: string;
  error?: string;
}> {
  const url = params.url as string;
  const _language = (params.language as string) || "eng";

  if (!url) {
    return { success: false, error: "URL parameter is required." };
  }

  // Validate URL
  try {
    const parsedUrl = new URL(url);
    if (isPrivateHost(parsedUrl.hostname)) {
      return { success: false, error: "Cannot access private or internal network addresses." };
    }
  } catch {
    return { success: false, error: `Invalid URL: "${url}"` };
  }

  // Stub: OCR requires Tesseract.js or external API
  return {
    success: false,
    error: "OCR is not yet fully configured. Install tesseract.js or configure an external OCR service. The agent should note this limitation and suggest alternative approaches.",
  };
}
