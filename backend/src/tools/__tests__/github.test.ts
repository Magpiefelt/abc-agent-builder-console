import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../config/env.js", () => ({
  env: { GITHUB_TOKEN: "test-github-token" },
}));

import { readGithubRepo, readGithubFile } from "../github.js";

beforeEach(() => {
  vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("readGithubRepo", () => {
  it("requires owner and repo params", async () => {
    expect((await readGithubRepo({ repo: "x" })).success).toBe(false);
    expect((await readGithubRepo({ owner: "x" })).success).toBe(false);
    expect((await readGithubRepo({})).success).toBe(false);
  });

  it("lists directory entries with type=dir and type=file", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { name: "src", path: "src", type: "dir", size: 0 },
          { name: "README.md", path: "README.md", type: "file", size: 1234 },
        ]),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    const result = await readGithubRepo({ owner: "anthropic", repo: "claude-code" });
    expect(result.success).toBe(true);
    expect(result.entries).toHaveLength(2);
    expect(result.entries![0].type).toBe("dir"); // dirs sorted first
    expect(result.entries![1].name).toBe("README.md");
  });

  it("sets the Bearer Authorization header when GITHUB_TOKEN is configured", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("[]", { status: 200, headers: { "content-type": "application/json" } })
    );
    await readGithubRepo({ owner: "x", repo: "y" });
    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer test-github-token");
    expect(headers["User-Agent"]).toMatch(/GoA-ABC-Bot/);
  });

  it("returns a not-found error on 404", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("not found", { status: 404 }));
    const result = await readGithubRepo({ owner: "x", repo: "y" });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  it("returns a rate-limit error on 403", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("rate limit", { status: 403 }));
    const result = await readGithubRepo({ owner: "x", repo: "y" });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/rate limit|access denied/i);
  });
});

describe("readGithubFile", () => {
  it("requires owner, repo, and path params", async () => {
    expect((await readGithubFile({ owner: "x", repo: "y" })).success).toBe(false);
    expect((await readGithubFile({})).success).toBe(false);
  });

  it("decodes base64-encoded file contents", async () => {
    const content = Buffer.from("Hello from GitHub").toString("base64");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ type: "file", encoding: "base64", content, size: 17 }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    const result = await readGithubFile({ owner: "a", repo: "b", path: "README.md" });
    expect(result.success).toBe(true);
    expect(result.content).toBe("Hello from GitHub");
  });

  it("rejects when path resolves to a directory", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ type: "dir" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    const result = await readGithubFile({ owner: "a", repo: "b", path: "src" });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/directory/i);
  });

  it("rejects files larger than 1MB", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ type: "file", encoding: "base64", content: "", size: 2 * 1024 * 1024 }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    const result = await readGithubFile({ owner: "a", repo: "b", path: "big.bin" });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/too large/i);
  });

  it("preserves slashes in nested paths so GitHub treats them as directory separators", async () => {
    // The previous implementation called encodeURIComponent on the whole path,
    // which turns "src/services/auth.ts" into "src%2Fservices%2Fauth.ts" — and
    // GitHub's contents API treats the result as a single literal filename and
    // 404s. Each segment must be encoded individually so reserved characters
    // are still escaped but slashes stay as path separators.
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          type: "file",
          encoding: "base64",
          content: Buffer.from("hello").toString("base64"),
          size: 5,
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    await readGithubFile({ owner: "a", repo: "b", path: "src/services/auth ts.ts" });

    const url = fetchMock.mock.calls[0][0] as string;
    // Slashes preserved.
    expect(url).toContain("/contents/src/services/");
    // Spaces (and other reserved chars) within a segment must still be escaped.
    expect(url).toContain("auth%20ts.ts");
    // The legacy bug would produce %2F encodings.
    expect(url).not.toContain("%2F");
  });
});
