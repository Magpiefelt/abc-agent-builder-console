import { describe, it, expect } from "vitest";
import { isPrivateOrReservedHost, validatePublicHttpUrl } from "../ssrf.js";

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

  it("rejects file:// and javascript: protocols", () => {
    expect(validatePublicHttpUrl("file:///etc/passwd").valid).toBe(false);
    expect(validatePublicHttpUrl("javascript:alert(1)").valid).toBe(false);
  });

  it("rejects private IP URLs", () => {
    expect(validatePublicHttpUrl("http://127.0.0.1/admin").valid).toBe(false);
    expect(validatePublicHttpUrl("http://169.254.169.254/latest/meta-data").valid).toBe(false);
    expect(validatePublicHttpUrl("https://service.internal/health").valid).toBe(false);
  });
});
