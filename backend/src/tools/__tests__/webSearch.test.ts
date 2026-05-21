import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../config/env.js", () => ({
  env: {
    BRAVE_SEARCH_API_KEY: "test-brave-key",
    GOOGLE_SEARCH_API_KEY: "test-google-key",
    GOOGLE_SEARCH_CX: "test-cx",
  },
}));

import { braveSearch, googleSearch } from "../webSearch.js";

beforeEach(() => {
  vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("braveSearch", () => {
  it("rejects empty queries", async () => {
    const result = await braveSearch({ query: "" });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/query/i);
  });

  it("returns mapped results from the Brave API", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          web: {
            results: [
              { title: "Edmonton — Wikipedia", url: "https://en.wikipedia.org/Edmonton", description: "Capital of Alberta" },
              { title: "City of Edmonton", url: "https://edmonton.ca", description: "Official site" },
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    const result = await braveSearch({ query: "edmonton population" });
    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(2);
    expect(result.results![0].title).toContain("Edmonton");
  });

  it("caps numResults at 20", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ web: { results: [] } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    await braveSearch({ query: "x", numResults: 50 });
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toMatch(/count=20/);
  });

  it("returns failure on non-2xx response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("err", { status: 503 }));
    const result = await braveSearch({ query: "x" });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/503/);
  });

  it("sets the X-Subscription-Token header", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ web: { results: [] } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    await braveSearch({ query: "x" });
    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers["X-Subscription-Token"]).toBe("test-brave-key");
  });
});

describe("googleSearch", () => {
  it("rejects empty queries", async () => {
    const result = await googleSearch({ query: "" });
    expect(result.success).toBe(false);
  });

  it("returns mapped results from the Google Custom Search API", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          items: [
            { title: "A", link: "https://a.com", snippet: "a snippet" },
            { title: "B", link: "https://b.com", snippet: "b snippet" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    const result = await googleSearch({ query: "edmonton" });
    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(2);
    expect(result.results![0].url).toBe("https://a.com");
  });

  it("caps numResults at 10 (Google CSE max)", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    await googleSearch({ query: "x", numResults: 50 });
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toMatch(/num=10/);
  });

  it("returns failure on non-2xx response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("err", { status: 500 }));
    const result = await googleSearch({ query: "x" });
    expect(result.success).toBe(false);
  });
});

describe("webSearch — API key absence", () => {
  it.todo("braveSearch returns config error when BRAVE_SEARCH_API_KEY is missing — covered by env mock variants");
  it.todo("googleSearch returns config error when GOOGLE_SEARCH_API_KEY or CX is missing");
});
