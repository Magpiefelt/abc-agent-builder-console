import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { isPrivateOrReservedHost, safeFetch, validatePublicHttpUrl } from "../ssrf.js";

describe("isPrivateOrReservedHost", () => {
  it("blocks IPv4 RFC 1918 ranges", () => {
    expect(isPrivateOrReservedHost("10.0.0.1")).toBe(true);
    expect(isPrivateOrReservedHost("172.16.0.1")).toBe(true);
    expect(isPrivateOrReservedHost("172.31.255.255")).toBe(true);
    expect(isPrivateOrReservedHost("192.168.1.1")).toBe(true);
  });

  it("blocks loopback, link-local, and unspecified addresses", () => {
    expect(isPrivateOrReservedHost("127.0.0.1")).toBe(true);
    expect(isPrivateOrReservedHost("169.254.169.254")).toBe(true);
    expect(isPrivateOrReservedHost("0.0.0.0")).toBe(true);
    expect(isPrivateOrReservedHost("localhost")).toBe(true);
    expect(isPrivateOrReservedHost("::1")).toBe(true);
    expect(isPrivateOrReservedHost("[::1]")).toBe(true);
  });

  it("blocks IPv4-mapped IPv6 forms", () => {
    expect(isPrivateOrReservedHost("::ffff:10.0.0.1")).toBe(true);
    expect(isPrivateOrReservedHost("::ffff:127.0.0.1")).toBe(true);
  });

  it("blocks internal TLDs", () => {
    expect(isPrivateOrReservedHost("router.local")).toBe(true);
    expect(isPrivateOrReservedHost("foo.internal")).toBe(true);
    expect(isPrivateOrReservedHost("server.corp")).toBe(true);
    expect(isPrivateOrReservedHost("host.lan")).toBe(true);
  });

  it("allows public hostnames and IPs", () => {
    expect(isPrivateOrReservedHost("example.com")).toBe(false);
    expect(isPrivateOrReservedHost("8.8.8.8")).toBe(false);
    expect(isPrivateOrReservedHost("2606:4700:4700::1111")).toBe(false);
  });
});

describe("validatePublicHttpUrl", () => {
  it("rejects non-http/https protocols", () => {
    expect(validatePublicHttpUrl("file:///etc/passwd").valid).toBe(false);
    expect(validatePublicHttpUrl("ftp://example.com").valid).toBe(false);
    expect(validatePublicHttpUrl("gopher://example.com").valid).toBe(false);
  });

  it("rejects URLs that resolve to private hosts", () => {
    expect(validatePublicHttpUrl("http://10.0.0.1/").valid).toBe(false);
    expect(validatePublicHttpUrl("http://169.254.169.254/latest/meta-data/").valid).toBe(false);
  });

  it("accepts well-formed public URLs", () => {
    const r = validatePublicHttpUrl("https://example.com/foo?bar=1");
    expect(r.valid).toBe(true);
    expect(r.parsed?.hostname).toBe("example.com");
  });
});

describe("safeFetch — SSRF redirect protection", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("rejects an initial URL pointing at a private host", async () => {
    await expect(safeFetch("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(
      /private or internal/i,
    );
  });

  it("blocks redirects to private hosts", async () => {
    let call = 0;
    globalThis.fetch = vi.fn(async () => {
      call++;
      if (call === 1) {
        return new Response(null, {
          status: 302,
          headers: { Location: "http://169.254.169.254/latest/meta-data/" },
        });
      }
      // We should never get here — the redirect must be refused.
      return new Response("metadata-leak", { status: 200 });
    }) as unknown as typeof fetch;

    await expect(safeFetch("https://public.example.com/redir")).rejects.toThrow(
      /Redirect blocked/i,
    );
    expect(call).toBe(1);
  });

  it("follows public-to-public redirects up to the hop limit", async () => {
    let call = 0;
    globalThis.fetch = vi.fn(async () => {
      call++;
      if (call < 3) {
        return new Response(null, {
          status: 302,
          headers: { Location: `https://public${call}.example.com/next` },
        });
      }
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;

    const res = await safeFetch("https://public.example.com/start");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
    expect(call).toBe(3);
  });

  it("strips Authorization on cross-origin redirects", async () => {
    let call = 0;
    let secondCallHeaders: Record<string, string> = {};
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      call++;
      if (call === 1) {
        return new Response(null, {
          status: 302,
          headers: { Location: "https://other.example.com/next" },
        });
      }
      const h = new Headers(init?.headers);
      secondCallHeaders = Object.fromEntries(h.entries());
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;

    await safeFetch("https://first.example.com/start", {
      headers: { Authorization: "Bearer abc123", "X-Trace": "keep-me" },
    });

    expect(call).toBe(2);
    // Headers iterates lower-cased keys, so the Authorization check must too.
    expect(secondCallHeaders["authorization"]).toBeUndefined();
    // Non-credential headers should still pass through.
    expect(secondCallHeaders["x-trace"]).toBe("keep-me");
  });

  it("throws after exceeding the redirect cap", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(null, {
        status: 302,
        headers: { Location: "https://public.example.com/loop" },
      }),
    ) as unknown as typeof fetch;

    await expect(
      safeFetch("https://public.example.com/start", { maxRedirects: 2 }),
    ).rejects.toThrow(/Too many redirects/);
  });
});
