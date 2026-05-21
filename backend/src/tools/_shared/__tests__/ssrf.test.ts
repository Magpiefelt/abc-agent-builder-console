import { describe, it, expect, afterEach, vi } from "vitest";
import { isPrivateOrReservedHost, safeFetch, validatePublicHttpUrl } from "../ssrf.js";

describe("isPrivateOrReservedHost — IPv4 ranges", () => {
  it.each([
    "127.0.0.1",
    "127.250.99.1",
    "10.0.0.1",
    "10.255.255.254",
    "172.16.0.1",
    "172.31.255.254",
    "192.168.1.1",
    "169.254.169.254", // AWS metadata
    "0.0.0.0",
    "0.42.0.42",
  ])("blocks private/reserved IPv4 %s", (host) => {
    expect(isPrivateOrReservedHost(host)).toBe(true);
  });

  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "172.32.0.1",   // outside 172.16/12
    "172.15.255.254",
    "192.169.0.1",   // outside 192.168/16
    "11.0.0.1",
  ])("allows public IPv4 %s", (host) => {
    expect(isPrivateOrReservedHost(host)).toBe(false);
  });
});

describe("isPrivateOrReservedHost — IPv6 ranges", () => {
  it.each([
    "::1",
    "::",
    "[::1]",
    "fc00::1",
    "fd00::dead:beef",
    "fe80::1",
    "fea0::1",
    "ff00::1",         // multicast
    "::ffff:127.0.0.1", // IPv4-mapped loopback
    "::ffff:10.0.0.1",  // IPv4-mapped RFC 1918
  ])("blocks private/reserved IPv6 %s", (host) => {
    expect(isPrivateOrReservedHost(host)).toBe(true);
  });

  it.each([
    "2606:4700:4700::1111", // Cloudflare DNS
    "2001:4860:4860::8888", // Google DNS
  ])("allows public IPv6 %s", (host) => {
    expect(isPrivateOrReservedHost(host)).toBe(false);
  });
});

describe("isPrivateOrReservedHost — internal hostnames", () => {
  it.each([
    "localhost",
    "metadata.local",
    "service.internal",
    "api.corp",
    "host.lan",
  ])("blocks internal hostname %s", (host) => {
    expect(isPrivateOrReservedHost(host)).toBe(true);
  });

  it("allows public hostnames", () => {
    expect(isPrivateOrReservedHost("api.example.com")).toBe(false);
    expect(isPrivateOrReservedHost("www.gov.ab.ca")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isPrivateOrReservedHost("Localhost")).toBe(true);
    expect(isPrivateOrReservedHost("HOST.LOCAL")).toBe(true);
  });
});

describe("validatePublicHttpUrl", () => {
  it("returns valid=true for a public HTTPS URL", () => {
    const r = validatePublicHttpUrl("https://example.com/foo");
    expect(r.valid).toBe(true);
    expect(r.parsed?.hostname).toBe("example.com");
  });

  it("preserves query strings in the parsed result", () => {
    const r = validatePublicHttpUrl("https://example.com/foo?bar=1");
    expect(r.valid).toBe(true);
    expect(r.parsed?.searchParams.get("bar")).toBe("1");
  });

  it("rejects empty / non-string inputs", () => {
    expect(validatePublicHttpUrl("").valid).toBe(false);
    expect(validatePublicHttpUrl("   ").valid).toBe(false);
    expect(validatePublicHttpUrl(null as unknown as string).valid).toBe(false);
  });

  it("rejects malformed URLs", () => {
    expect(validatePublicHttpUrl("not a url").valid).toBe(false);
    expect(validatePublicHttpUrl("http://").valid).toBe(false);
  });

  it("rejects non-HTTP protocols", () => {
    const r = validatePublicHttpUrl("ftp://example.com/foo");
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/protocol/i);
  });

  it("rejects file://, javascript:, and gopher:// protocols", () => {
    expect(validatePublicHttpUrl("file:///etc/passwd").valid).toBe(false);
    expect(validatePublicHttpUrl("javascript:alert(1)").valid).toBe(false);
    expect(validatePublicHttpUrl("gopher://example.com").valid).toBe(false);
  });

  it("rejects URLs whose host resolves to a private range", () => {
    expect(validatePublicHttpUrl("http://10.0.0.1/").valid).toBe(false);
    expect(validatePublicHttpUrl("http://127.0.0.1/admin").valid).toBe(false);
    expect(validatePublicHttpUrl("http://169.254.169.254/latest/meta-data").valid).toBe(false);
    expect(validatePublicHttpUrl("https://service.internal/health").valid).toBe(false);
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
