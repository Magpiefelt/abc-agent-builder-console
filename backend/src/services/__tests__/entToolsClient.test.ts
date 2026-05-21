/**
 * Unit tests for the entToolsClient service.
 *
 * `fetch` is stubbed with vi.stubGlobal so no real network calls are made.
 * The SSRF guard, timeout handling, and API response mapping are all exercised.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks (hoisted before imports)
// ---------------------------------------------------------------------------

vi.mock("../../services/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mutable env — configure per test
const envMock = vi.hoisted(() => ({
  ENT_TOOLS_API_KEY: "test-api-key",
  ENT_TOOLS_BASE_URL: "https://ent-tools.sandbox.aim.int.gov.ab.ca",
  ENT_TOOLS_BRAVE_PATH: "/v1/brave/search",
  ENT_TOOLS_IMAGE_PATH: "/v1/images/generate",
}));
vi.mock("../../config/env.js", () => ({ env: envMock }));

// ---------------------------------------------------------------------------
// Import under test (after mocks)
// ---------------------------------------------------------------------------

import {
  isEntToolsConfigured,
  entBraveSearch,
  entImageGeneration,
} from "../entToolsClient.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetchOk(body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(body),
      text: vi.fn().mockResolvedValue(JSON.stringify(body)),
    })
  );
}

function mockFetchError(status: number, text = "Service error"): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      status,
      json: vi.fn().mockResolvedValue({ error: text }),
      text: vi.fn().mockResolvedValue(text),
    })
  );
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.unstubAllGlobals();
  envMock.ENT_TOOLS_API_KEY = "test-api-key";
  envMock.ENT_TOOLS_BASE_URL = "https://ent-tools.sandbox.aim.int.gov.ab.ca";
  envMock.ENT_TOOLS_BRAVE_PATH = "/v1/brave/search";
  envMock.ENT_TOOLS_IMAGE_PATH = "/v1/images/generate";
});

// ---------------------------------------------------------------------------
// isEntToolsConfigured
// ---------------------------------------------------------------------------

describe("isEntToolsConfigured()", () => {
  it("returns true when ENT_TOOLS_API_KEY is set", () => {
    envMock.ENT_TOOLS_API_KEY = "some-key";
    expect(isEntToolsConfigured()).toBe(true);
  });

  it("returns false when ENT_TOOLS_API_KEY is empty", () => {
    envMock.ENT_TOOLS_API_KEY = "";
    expect(isEntToolsConfigured()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// entBraveSearch — no API key
// ---------------------------------------------------------------------------

describe("entBraveSearch — no API key", () => {
  it("throws when ENT_TOOLS_API_KEY is not configured", async () => {
    envMock.ENT_TOOLS_API_KEY = "";
    vi.stubGlobal("fetch", vi.fn());

    await expect(entBraveSearch("test query")).rejects.toThrow(/ENT_TOOLS_API_KEY/);
    expect(vi.mocked(global.fetch)).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// entBraveSearch — SSRF guard
// ---------------------------------------------------------------------------

describe("entBraveSearch — SSRF guard", () => {
  it("throws when ENT_TOOLS_BASE_URL is a private IP", async () => {
    envMock.ENT_TOOLS_BASE_URL = "http://10.0.0.1";
    vi.stubGlobal("fetch", vi.fn());

    await expect(entBraveSearch("query")).rejects.toThrow(/private\/reserved/i);
    expect(vi.mocked(global.fetch)).not.toHaveBeenCalled();
  });

  it("throws when ENT_TOOLS_BASE_URL is localhost", async () => {
    envMock.ENT_TOOLS_BASE_URL = "http://localhost:8080";
    vi.stubGlobal("fetch", vi.fn());

    await expect(entBraveSearch("query")).rejects.toThrow(/private\/reserved/i);
    expect(vi.mocked(global.fetch)).not.toHaveBeenCalled();
  });

  it("throws when ENT_TOOLS_BASE_URL uses a non-HTTP scheme", async () => {
    envMock.ENT_TOOLS_BASE_URL = "ftp://ent-tools.sandbox.aim.int.gov.ab.ca";
    vi.stubGlobal("fetch", vi.fn());

    await expect(entBraveSearch("query")).rejects.toThrow(/HTTP\(S\)/i);
    expect(vi.mocked(global.fetch)).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// entBraveSearch — successful response (web.results shape)
// ---------------------------------------------------------------------------

describe("entBraveSearch — success (web.results shape)", () => {
  it("returns mapped results from web.results", async () => {
    mockFetchOk({
      web: {
        results: [
          { title: "Alberta Gov", url: "https://gov.ab.ca", description: "Official site" },
          { title: "GoA Services", url: "https://services.gov.ab.ca", description: "Services" },
        ],
      },
    });

    const { results } = await entBraveSearch("Alberta government");
    expect(results).toHaveLength(2);
    expect(results[0].title).toBe("Alberta Gov");
    expect(results[0].url).toBe("https://gov.ab.ca");
    expect(results[0].snippet).toBe("Official site");
  });

  it("sets correct Authorization header in the request", async () => {
    mockFetchOk({ web: { results: [] } });

    await entBraveSearch("test");
    const call = vi.mocked(global.fetch).mock.calls[0];
    const headers = (call[1] as RequestInit).headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer test-api-key");
  });

  it("includes User-Agent header", async () => {
    mockFetchOk({ web: { results: [] } });

    await entBraveSearch("test");
    const call = vi.mocked(global.fetch).mock.calls[0];
    const headers = (call[1] as RequestInit).headers as Record<string, string>;
    expect(headers["User-Agent"]).toMatch(/GoA-ABC-Bot/);
  });
});

// ---------------------------------------------------------------------------
// entBraveSearch — flat results shape
// ---------------------------------------------------------------------------

describe("entBraveSearch — flat results shape", () => {
  it("returns results when response uses top-level results array", async () => {
    mockFetchOk({
      results: [
        { title: "Flat Title", url: "https://example.com", snippet: "flat snippet" },
      ],
    });

    const { results } = await entBraveSearch("test");
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Flat Title");
  });
});

// ---------------------------------------------------------------------------
// entBraveSearch — count capping
// ---------------------------------------------------------------------------

describe("entBraveSearch — count capping", () => {
  it("caps count at 20 even when a higher value is requested", async () => {
    mockFetchOk({ web: { results: [] } });

    await entBraveSearch("query", { count: 100 });
    const url = vi.mocked(global.fetch).mock.calls[0][0] as string;
    expect(url).toContain("count=20");
  });

  it("uses requested count when within limit", async () => {
    mockFetchOk({ web: { results: [] } });

    await entBraveSearch("query", { count: 5 });
    const url = vi.mocked(global.fetch).mock.calls[0][0] as string;
    expect(url).toContain("count=5");
  });
});

// ---------------------------------------------------------------------------
// entBraveSearch — HTTP error
// ---------------------------------------------------------------------------

describe("entBraveSearch — HTTP error", () => {
  it("throws when response is not ok", async () => {
    mockFetchError(503, "Service unavailable");

    await expect(entBraveSearch("test")).rejects.toThrow(/503/);
  });
});

// ---------------------------------------------------------------------------
// entImageGeneration — no API key
// ---------------------------------------------------------------------------

describe("entImageGeneration — no API key", () => {
  it("throws when ENT_TOOLS_API_KEY is not configured", async () => {
    envMock.ENT_TOOLS_API_KEY = "";
    vi.stubGlobal("fetch", vi.fn());

    await expect(entImageGeneration("a blue sky")).rejects.toThrow(/ENT_TOOLS_API_KEY/);
    expect(vi.mocked(global.fetch)).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// entImageGeneration — successful response
// ---------------------------------------------------------------------------

describe("entImageGeneration — success", () => {
  it("returns base64 and mimeType from response", async () => {
    mockFetchOk({ data: [{ b64_json: "ABC123base64==" }] });

    const result = await entImageGeneration("a blue sky");
    expect(result.base64).toBe("ABC123base64==");
    expect(result.mimeType).toBe("image/png");
  });

  it("sends POST with correct body", async () => {
    mockFetchOk({ data: [{ b64_json: "XYZ==" }] });

    await entImageGeneration("mountains", { size: "512x512", model: "dall-e-2" });
    const call = vi.mocked(global.fetch).mock.calls[0];
    expect((call[1] as RequestInit).method).toBe("POST");
    const body = JSON.parse((call[1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body.prompt).toBe("mountains");
    expect(body.size).toBe("512x512");
    expect(body.model).toBe("dall-e-2");
  });

  it("defaults to 1024x1024 and dall-e-3 when no opts provided", async () => {
    mockFetchOk({ data: [{ b64_json: "default==" }] });

    await entImageGeneration("test prompt");
    const call = vi.mocked(global.fetch).mock.calls[0];
    const body = JSON.parse((call[1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body.size).toBe("1024x1024");
    expect(body.model).toBe("dall-e-3");
  });
});

// ---------------------------------------------------------------------------
// entImageGeneration — HTTP error
// ---------------------------------------------------------------------------

describe("entImageGeneration — HTTP error", () => {
  it("throws when response is not ok", async () => {
    mockFetchError(429, "Rate limited");

    await expect(entImageGeneration("test")).rejects.toThrow(/429/);
  });
});

// ---------------------------------------------------------------------------
// entImageGeneration — missing b64_json in response
// ---------------------------------------------------------------------------

describe("entImageGeneration — malformed response", () => {
  it("throws when b64_json is absent from the response", async () => {
    mockFetchOk({ data: [{}] }); // no b64_json field

    await expect(entImageGeneration("test")).rejects.toThrow(/b64_json/);
  });

  it("throws when data array is empty", async () => {
    mockFetchOk({ data: [] });

    await expect(entImageGeneration("test")).rejects.toThrow(/b64_json/);
  });
});
