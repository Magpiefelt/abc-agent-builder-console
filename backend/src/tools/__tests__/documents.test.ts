/**
 * Document tools tests. The full pdf-parse / adm-zip paths require real
 * binary fixtures and have a self-test trap, so most cases here exercise
 * the validation surface around the URL fetcher (SSRF guards, parameter
 * validation, and graceful failure modes).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { pdfExtractText, pdfInfo, ocrImage, readZipContents, readZipFile, extractZipFiles } from "../documents.js";

beforeEach(() => {
  vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("documents — parameter validation", () => {
  it("pdfExtractText requires url", async () => {
    expect((await pdfExtractText({})).success).toBe(false);
  });
  it("pdfInfo requires url", async () => {
    expect((await pdfInfo({})).success).toBe(false);
  });
  it("ocrImage requires url", async () => {
    expect((await ocrImage({})).success).toBe(false);
  });
  it("readZipContents requires url", async () => {
    expect((await readZipContents({})).success).toBe(false);
  });
  it("readZipFile requires url and filePath", async () => {
    expect((await readZipFile({})).success).toBe(false);
    expect((await readZipFile({ url: "https://example.com/x.zip" })).success).toBe(false);
  });
  it("extractZipFiles requires url", async () => {
    expect((await extractZipFiles({})).success).toBe(false);
  });
});

describe("documents — SSRF protection", () => {
  it("pdfExtractText blocks private IP URLs", async () => {
    const result = await pdfExtractText({ url: "http://127.0.0.1/x.pdf" });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/private|internal/i);
  });

  it("ocrImage blocks private IP URLs", async () => {
    const result = await ocrImage({ url: "http://10.0.0.5/x.png" });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/private|internal/i);
  });

  it("pdfExtractText rejects file:// URLs (protocol)", async () => {
    const result = await pdfExtractText({ url: "file:///etc/passwd" });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/protocol|Invalid URL/i);
  });
});

describe("documents — HTTP error propagation", () => {
  it("pdfExtractText surfaces HTTP errors from the upstream fetch", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("not found", { status: 404 }));
    const result = await pdfExtractText({ url: "https://example.com/missing.pdf" });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/404/);
  });

  it("readZipContents surfaces HTTP errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("oops", { status: 500 }));
    const result = await readZipContents({ url: "https://example.com/big.zip" });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/500/);
  });
});

describe("documents — OCR", () => {
  // Stream D wired Tesseract.js into ocrImage. With no real image to fetch,
  // it fails at the HTTP step. The contract here is: the function returns a
  // structured error result rather than crashing.
  it("ocrImage returns a structured failure when the upstream URL is unreachable", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("not found", { status: 404 }));
    const result = await ocrImage({ url: "https://example.com/image.png" });
    expect(result.success).toBe(false);
    expect(typeof result.error).toBe("string");
  });
});
