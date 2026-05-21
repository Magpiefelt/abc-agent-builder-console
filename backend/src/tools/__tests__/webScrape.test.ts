import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());
vi.mock("../../config/database.js", () => ({ query: queryMock }));

import { webScrape } from "../webScrape.js";

const SSRF_TABLE: Array<[string, string]> = [
  ["http://127.0.0.1/secret", "loopback IPv4"],
  ["http://localhost/admin", "loopback name"],
  ["http://10.0.0.1/", "RFC1918 10.0.0.0/8"],
  ["http://172.16.0.1/", "RFC1918 172.16.0.0/12"],
  ["http://172.31.255.254/", "RFC1918 172.16.0.0/12 upper"],
  ["http://192.168.1.100/", "RFC1918 192.168.0.0/16"],
  ["http://169.254.169.254/latest/meta-data/", "AWS metadata service"],
  ["http://0.0.0.0/", "wildcard"],
  ["http://printer.local/", ".local TLD"],
  ["http://service.internal/api", ".internal TLD"],
];

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [] });
  vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("webScrape — SSRF protection", () => {
  it.each(SSRF_TABLE)("blocks %s (%s)", async (url) => {
    const result = await webScrape({ url });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/private|internal/i);
  });

  it("blocks non-http(s) protocols (file://)", async () => {
    const result = await webScrape({ url: "file:///etc/passwd" });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/protocol/i);
  });

  it("rejects malformed URLs", async () => {
    const result = await webScrape({ url: "not a url" });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid URL/i);
  });

  it("rejects missing url parameter", async () => {
    const result = await webScrape({});
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/required/i);
  });
});

describe("webScrape — happy path", () => {
  it("fetches and extracts text from a public HTML page", async () => {
    const html = `<html><body><h1>Edmonton</h1><p>Population: 1,010,899</p></body></html>`;
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(html, { status: 200, headers: { "content-type": "text/html" } })
    );
    const result = await webScrape({ url: "https://example.com" });
    expect(result.success).toBe(true);
    expect(result.content).toContain("Edmonton");
    expect(result.content).toContain("1,010,899");
  });

  it("uses the honest GoA bot User-Agent (no browser spoofing)", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("<html><body>ok</body></html>", { status: 200, headers: { "content-type": "text/html" } })
    );
    await webScrape({ url: "https://example.com" });
    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers["User-Agent"]).toMatch(/GoA-ABC-Bot/);
    expect(headers["User-Agent"]).not.toMatch(/Mozilla|Chrome|Safari/i);
  });

  it("handles JSON responses by pretty-printing", async () => {
    const json = JSON.stringify({ a: 1, b: "two" });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(json, { status: 200, headers: { "content-type": "application/json" } })
    );
    const result = await webScrape({ url: "https://example.com/data.json" });
    expect(result.success).toBe(true);
    expect(result.content).toContain('"a": 1');
  });

  it("truncates content above maxCharacters", async () => {
    const huge = "<html><body>" + "x".repeat(100_000) + "</body></html>";
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(huge, { status: 200, headers: { "content-type": "text/html" } })
    );
    const result = await webScrape({ url: "https://example.com", maxCharacters: 1000 });
    expect(result.success).toBe(true);
    expect(result.content!.length).toBeLessThanOrEqual(1200); // 1000 + truncation marker
    expect(result.content).toContain("truncated");
  });

  it("returns failure on non-2xx HTTP responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("not found", { status: 404, headers: { "content-type": "text/html" } })
    );
    const result = await webScrape({ url: "https://example.com/missing" });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/404/);
  });

  it("returns failure when response exceeds 2MB size cap (content-length header)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("ok", {
        status: 200,
        headers: { "content-type": "text/html", "content-length": String(3 * 1024 * 1024) },
      })
    );
    const result = await webScrape({ url: "https://example.com" });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/too large/i);
  });
});
