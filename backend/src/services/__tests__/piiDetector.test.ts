import { describe, it, expect } from "vitest";
import { scanForPII, redactPII } from "../piiDetector.js";

// Luhn-valid fixtures (post-Stream-F gating). Verified at test-author time:
//   luhn("046454286") === true  (used as SIN)
//   luhn("100000009") === true  (used as Alberta PHN/AHCN — 9 digits no separators)
//   luhn("4111111111111111") === true (test Visa)
// A non-Luhn 9-digit string like "123456789" no longer matches SIN/AHCN.
const SIN_LUHN = "046-454-286";
const SIN_LUHN_RAW = "046454286";
const SIN_LUHN_ALT = "100-055-433"; // separate Luhn-valid for the "two SINs" test
const AHCN_LUHN = "100000009";
const NON_LUHN_9 = "123456789";

describe("piiDetector — pattern detection", () => {
  it("returns clean=true for benign content", () => {
    const result = scanForPII("This is a perfectly ordinary sentence about cats.");
    expect(result.clean).toBe(true);
    expect(result.detections).toHaveLength(0);
    expect(result.blockedCount).toBe(0);
  });

  it("detects and blocks a Luhn-valid Social Insurance Number", () => {
    const result = scanForPII(`My SIN is ${SIN_LUHN} please file it.`);
    const sinHit = result.detections.find((d) => d.type === "social_insurance_number");
    expect(sinHit).toBeDefined();
    expect(sinHit?.action).toBe("blocked");
    expect(result.blockedCount).toBeGreaterThanOrEqual(1);
  });

  it("does NOT match a non-Luhn 9-digit string (false-positive guard)", () => {
    const result = scanForPII(`Order number: ${NON_LUHN_9}`);
    // Neither SIN nor AHCN should fire on a non-Luhn-valid 9-digit value.
    expect(result.detections.some((d) => d.type === "social_insurance_number")).toBe(false);
    expect(result.detections.some((d) => d.type === "alberta_health_number")).toBe(false);
  });

  it("blocks Luhn-valid Alberta Health Care Numbers", () => {
    // 9 digits, no separators, Luhn-valid → AHCN (post-Stream-F is `blocked`).
    const result = scanForPII(`Health card: ${AHCN_LUHN}`);
    const hit = result.detections.find(
      (d) => d.type === "alberta_health_number" || d.type === "social_insurance_number"
    );
    expect(hit).toBeDefined();
    expect(hit?.action).toBe("blocked");
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

  it("flags Alberta driver's license patterns (hyphenated form)", () => {
    // Stream F tightened the regex to require an explicit hyphen.
    const result = scanForPII("License: 123456-789");
    const dl = result.detections.find((d) => d.type === "alberta_drivers_license");
    expect(dl?.action).toBe("flagged");
  });

  it("truncates the match string for safe logging", () => {
    const result = scanForPII(`SIN ${SIN_LUHN}`);
    const hit = result.detections.find((d) => d.type === "social_insurance_number");
    expect(hit?.match).toMatch(/\*\*\*$/);
    expect(hit?.match?.length).toBeLessThanOrEqual(10);
  });

  it("records the original character position of each detection", () => {
    const haystack = `Some preamble text, then SIN ${SIN_LUHN} trails.`;
    const result = scanForPII(haystack);
    const hit = result.detections.find((d) => d.type === "social_insurance_number");
    expect(hit).toBeDefined();
    const slice = haystack.substring(hit!.position.start, hit!.position.end);
    expect(slice).toBe(SIN_LUHN);
  });

  it("detects multiple separate SINs in one document", () => {
    const result = scanForPII(`first ${SIN_LUHN} then ${SIN_LUHN_ALT}`);
    const sins = result.detections.filter((d) => d.type === "social_insurance_number");
    expect(sins.length).toBeGreaterThanOrEqual(2);
  });
});

describe("piiDetector — redaction", () => {
  it("replaces blocked matches with [REDACTED:type] tags", () => {
    const haystack = `SIN: ${SIN_LUHN} done.`;
    const scan = scanForPII(haystack);
    const redacted = redactPII(haystack, scan.detections);
    expect(redacted).toContain("[REDACTED:social_insurance_number]");
    expect(redacted).not.toContain(SIN_LUHN);
  });

  it("only redacts blocked / redacted detections, leaves flagged content alone", () => {
    const haystack = `Email me at a@b.com but my SIN is ${SIN_LUHN}`;
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

// Sanity: ensure our test fixtures themselves are still Luhn-valid (catches
// future drift if someone rewrites the validator).
describe("piiDetector — fixture sanity", () => {
  it("the documented SIN fixture is detected", () => {
    const r = scanForPII(SIN_LUHN);
    expect(r.detections.some((d) => d.type === "social_insurance_number")).toBe(true);
  });
  it("the AHCN fixture is detected (raw 9 digits)", () => {
    const r = scanForPII(AHCN_LUHN);
    expect(
      r.detections.some(
        (d) => d.type === "alberta_health_number" || d.type === "social_insurance_number"
      )
    ).toBe(true);
  });
});
