/**
 * Shared SSRF protections for all tools that make outbound HTTP requests.
 *
 * Consolidated from previously duplicated helpers in webScrape.ts, apiProxy.ts,
 * and documents.ts (which had drifted — only webScrape blocked .local/.internal/
 * .corp/.lan TLDs). Single source of truth ahead of Stream F red-team probes.
 */

/**
 * Check whether a hostname resolves to a private, reserved, or internal-only
 * IP range. Blocks loopback, RFC 1918 IPv4, IPv6 unique-local/link-local/
 * loopback/multicast, link-local IPv4, 0.0.0.0/8, and common internal TLDs
 * (.local, .internal, .corp, .lan).
 *
 * Hostnames are accepted bare (`fc00::1`) or wrapped in URL brackets (`[fc00::1]`).
 */
export function isPrivateOrReservedHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();

  // Block obvious private hostnames
  const blockedHosts = ["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]", "::"];
  if (blockedHosts.includes(lower)) return true;

  // IPv4 ranges
  const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [, a, b] = ipv4Match.map(Number);
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 127) return true; // 127.0.0.0/8
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
    if (a === 0) return true; // 0.0.0.0/8
  }

  // IPv6 ranges. Hostname may arrive as `[fc00::1]` (URL form) or `fc00::1`.
  const ipv6 = lower.startsWith("[") && lower.endsWith("]") ? lower.slice(1, -1) : lower;
  if (ipv6.includes(":")) {
    // Loopback `::1` and unspecified `::`
    if (ipv6 === "::1" || ipv6 === "::") return true;
    // Embedded IPv4 in any IPv6 form — recurse into the IPv4 check.
    // Catches `::ffff:a.b.c.d` (IPv4-mapped) and `::a.b.c.d` (legacy IPv4-compatible).
    const embedded = ipv6.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
    if (embedded && isPrivateOrReservedHost(embedded[1])) return true;
    // Block any `::ffff:` prefix outright (IPv4-mapped form). Legitimate
    // public IPv6 should not use this prefix, and the hex-encoded variant
    // `::ffff:0a00:0001` cannot be safely decoded with a regex.
    if (ipv6.startsWith("::ffff:") || ipv6.startsWith("::0:ffff:")) return true;
    // fc00::/7 unique-local (the entire fc00..fdff range starts with fc/fd)
    if (/^f[cd]/i.test(ipv6)) return true;
    // fe80::/10 link-local — match fe8x/fe9x/feax/febx
    if (/^fe[89ab]/i.test(ipv6)) return true;
    // ff00::/8 multicast
    if (/^ff/i.test(ipv6)) return true;
  }

  // Internal TLDs
  const blockedTLDs = [".local", ".internal", ".corp", ".lan"];
  if (blockedTLDs.some((tld) => lower.endsWith(tld))) return true;

  return false;
}

export interface UrlValidationResult {
  valid: boolean;
  parsed?: URL;
  error?: string;
}

/**
 * Validate that a URL is a well-formed public HTTP/HTTPS URL. Combines
 * format, protocol, and SSRF checks into one helper so callers don't have
 * to repeat the same three branches.
 */
export function validatePublicHttpUrl(url: string): UrlValidationResult {
  if (!url || typeof url !== "string" || url.trim().length === 0) {
    return { valid: false, error: "URL parameter is required." };
  }

  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return { valid: false, error: `Invalid URL format: "${url}"` };
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { valid: false, error: `Unsupported protocol: "${parsed.protocol}". Only HTTP/HTTPS allowed.` };
  }

  if (isPrivateOrReservedHost(parsed.hostname)) {
    return { valid: false, error: "Cannot access private or internal network addresses." };
  }

  return { valid: true, parsed };
}
