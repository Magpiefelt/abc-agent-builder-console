import { describe, it, expect } from "vitest";
import { scanForPII, redactPII } from "../piiDetector.js";

describe("piiDetector — pattern detection", () => {
  it("returns clean=true for benign content", () => {
    const result = scanForPII("This is a perfectly ordinary sentence about cats.");
    expect(result.clean).toBe(true);
    expect(result.detections).toHaveLength(0);
    expect(result.blockedCount).toBe(0);
  });

  it("detects and blocks a Social Insurance Number", () => {
    const result = scanForPII("My SIN is 123-456-789 please file it.");
    const sinHit = result.detections.find((d) => d.type === "social_insurance_number");
    expect(sinHit).toBeDefined();
    expect(sinHit?.action).toBe("blocked");
    expect(result.blockedCount).toBeGreaterThanOrEqual(1);
  });

  it("flags 9-digit numbers as potential Alberta Health Care Numbers", () => {
    const result = scanForPII("Account number: 100200300");
    const ahc = result.detections.find((d) => d.type === "alberta_health_number");
    expect(ahc).toBeDefined();
    expect(ahc?.action).toBe("flagged");
  });

  it("detects credit card numbers and blocks them", () => {
    const result = scanForPII("Card: 4111 1111 1111 1111");
    const cc = result.detections.find((d) => d.type === "credit_card");
    expect(cc).toBeDefined();
    expect(cc?.action).toBe("blocked");
  });

  it.each([
    ["sk-abcdef1234567890abcdef1234", "api_key_openai"],
    ["sk-ant-AAAAAAAAAAAAAAAAAAAAAA", "api_key_anthropic"],
    ["AIzaSyA0123456789ABCDEFGHIJKLMNOPQRSTUVW", "api_key_google"],
  ])("blocks the API key pattern %s", (key, expectedType) => {
    const result = scanForPII(`debug payload: ${key}`);
    const match = result.detections.find((d) => d.type === expectedType);
    expect(match).toBeDefined();
    expect(match?.action).toBe("blocked");
  });

  it("blocks Bearer tokens", () => {
    const result = scanForPII("Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI");
    const t = result.detections.find((d) => d.type === "bearer_token");
    expect(t?.action).toBe("blocked");
  });

  it("blocks generic password=\"...\" style secrets", () => {
    const result = scanForPII('config { password: "hunter2hunter2" }');
    const s = result.detections.find((d) => d.type === "generic_secret");
    expect(s?.action).toBe("blocked");
  });

  it("flags email addresses (not blocked)", () => {
    const result = scanForPII("Reach out to alice@example.com for help.");
    const e = result.detections.find((d) => d.type === "email_address");
    expect(e?.action).toBe("flagged");
    expect(result.blockedCount).toBe(0);
  });

  it("flags phone numbers (not blocked)", () => {
    const result = scanForPII("Call 780-555-1234 anytime.");
    const p = result.detections.find((d) => d.type === "phone_number");
    expect(p?.action).toBe("flagged");
  });

  it("flags Alberta driver's license patterns", () => {
    const result = scanForPII("License: 123456-789");
    const dl = result.detections.find((d) => d.type === "alberta_drivers_license");
    expect(dl?.action).toBe("flagged");
  });

  it("truncates the match string for safe logging", () => {
    const result = scanForPII("SIN 123-456-789");
    const hit = result.detections.find((d) => d.type === "social_insurance_number");
    expect(hit?.match).toMatch(/\*\*\*$/);
    expect(hit?.match?.length).toBeLessThanOrEqual(10);
  });

  it("records the original character position of each detection", () => {
    const haystack = "Some preamble text, then SIN 123-456-789 trails.";
    const result = scanForPII(haystack);
    const hit = result.detections.find((d) => d.type === "social_insurance_number");
    expect(hit).toBeDefined();
    const slice = haystack.substring(hit!.position.start, hit!.position.end);
    expect(slice).toBe("123-456-789");
  });

  it("detects multiple separate SINs in one document", () => {
    const result = scanForPII("first 111-222-333 then 444-555-666");
    const sins = result.detections.filter((d) => d.type === "social_insurance_number");
    expect(sins).toHaveLength(2);
  });
});

describe("piiDetector — redaction", () => {
  it("replaces blocked matches with [REDACTED:type] tags", () => {
    const haystack = "SIN: 123-456-789 done.";
    const scan = scanForPII(haystack);
    const redacted = redactPII(haystack, scan.detections);
    expect(redacted).toContain("[REDACTED:social_insurance_number]");
    expect(redacted).not.toContain("123-456-789");
  });

  it("only redacts blocked / redacted detections, leaves flagged content alone", () => {
    const haystack = "Email me at a@b.com but my SIN is 123-456-789";
    const scan = scanForPII(haystack);
    const redacted = redactPII(haystack, scan.detections);
    expect(redacted).toContain("a@b.com");
    expect(redacted).toContain("[REDACTED:social_insurance_number]");
  });

  it("handles overlapping detections without corrupting the output", () => {
    const haystack = "secret = \"sk-abcdef1234567890abcdef1234\"";
    const scan = scanForPII(haystack);
    const redacted = redactPII(haystack, scan.detections);
    expect(redacted).not.toContain("sk-abcdef");
    expect(redacted).toContain("[REDACTED:");
  });

  it("is a no-op when there are no detections to redact", () => {
    const haystack = "Plain text, nothing to see.";
    const scan = scanForPII(haystack);
    expect(redactPII(haystack, scan.detections)).toBe(haystack);
  });
});
