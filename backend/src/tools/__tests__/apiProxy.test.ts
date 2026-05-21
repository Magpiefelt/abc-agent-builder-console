import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());
vi.mock("../../config/database.js", () => ({ query: queryMock }));

import { getCallApi, postCallApi } from "../apiProxy.js";

const SSRF_TABLE: string[] = [
  "http://127.0.0.1/",
  "http://localhost/",
  "http://10.0.0.1/",
  "http://172.20.0.1/",
  "http://192.168.0.1/",
  "http://169.254.169.254/",
  "http://0.0.0.0/",
];

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [] });
  vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("apiProxy.getCallApi — SSRF protection", () => {
  it.each(SSRF_TABLE)("blocks GET %s", async (url) => {
    const result = await getCallApi({ url });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/private|internal/i);
  });

  it("blocks non-http(s) protocols", async () => {
    const result = await getCallApi({ url: "ftp://example.com/file" });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/protocol/i);
  });
});

describe("apiProxy.postCallApi — SSRF protection", () => {
  it.each(SSRF_TABLE)("blocks POST %s", async (url) => {
    const result = await postCallApi({ url, body: { x: 1 } });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/private|internal/i);
  });
});

describe("apiProxy — happy path", () => {
  it("performs a GET against a public URL and parses JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, n: 1 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    const result = await getCallApi({ url: "https://api.example.com/status" });
    expect(result.success).toBe(true);
    expect(result.status).toBe(200);
    expect((result.body as { ok: boolean }).ok).toBe(true);
  });

  it("performs a POST with a JSON body", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ accepted: true }), {
        status: 201,
        headers: { "content-type": "application/json" },
      })
    );
    const result = await postCallApi({
      url: "https://api.example.com/items",
      body: { name: "alberta" },
    });
    expect(result.success).toBe(true);
    expect(result.status).toBe(201);
    const callBody = fetchMock.mock.calls[0][1]?.body;
    expect(callBody).toBe(JSON.stringify({ name: "alberta" }));
  });

  it("uses the GoA bot User-Agent on all requests", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("ok", { status: 200, headers: { "content-type": "text/plain" } })
    );
    await getCallApi({ url: "https://api.example.com" });
    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers["User-Agent"]).toMatch(/GoA-ABC-Bot/);
  });

  it("enforces request body size cap (1MB)", async () => {
    const giant = { content: "x".repeat(1.2 * 1024 * 1024) };
    const result = await postCallApi({ url: "https://api.example.com", body: giant });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/too large/i);
  });

  it("enforces response body size cap via Content-Length header", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("ok", {
        status: 200,
        headers: { "content-type": "text/plain", "content-length": String(2 * 1024 * 1024) },
      })
    );
    const result = await getCallApi({ url: "https://api.example.com" });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/too large/i);
  });
});
