import { describe, it, expect } from "vitest";
import { scanForPII, redactPII } from "../piiDetector.js";

// Luhn-valid sample numbers used to cover gated detectors. These are documented
// test fixtures — not real numbers issued to any person.
const VALID_SIN = "046 454 286";           // Luhn-valid 9-digit
const INVALID_SIN = "123 456 789";          // Luhn-invalid → must NOT detect
const VALID_PHN = "111111118";              // Luhn-valid 9-digit AHCN
const VALID_VISA = "4111 1111 1111 1111";   // Luhn-valid test card
const INVALID_VISA = "4111 1111 1111 1112";

describe("scanForPII — high-severity blocked patterns", () => {
  it("detects and blocks a Luhn-valid SIN", () => {
    const result = scanForPII(`Applicant SIN is ${VALID_SIN}.`);
    expect(result.clean).toBe(false);
    expect(result.blockedCount).toBeGreaterThanOrEqual(1);
    expect(result.detections.some((d) => d.type === "social_insurance_number")).toBe(true);
  });

  it("does NOT report a Luhn-invalid 9-digit string as a SIN", () => {
    const result = scanForPII(`Reference number: ${INVALID_SIN}`);
    expect(result.detections.some((d) => d.type === "social_insurance_number")).toBe(false);
  });

  it("detects a Luhn-valid credit card and blocks", () => {
    const result = scanForPII(`Visa ${VALID_VISA} expires 12/26`);
    expect(result.clean).toBe(false);
    expect(result.detections.some((d) => d.type === "credit_card" && d.action === "blocked")).toBe(true);
  });

  it("does NOT report a Luhn-invalid 16-digit string as a credit card", () => {
    const result = scanForPII(`Order id ${INVALID_VISA}`);
    expect(result.detections.some((d) => d.type === "credit_card")).toBe(false);
  });

  it("detects Alberta Personal Health Number when Luhn-valid", () => {
    const result = scanForPII(`PHN ${VALID_PHN}`);
    expect(result.detections.some((d) => d.type === "alberta_health_number")).toBe(true);
  });

  it("detects Canadian passport numbers", () => {
    const result = scanForPII(`Passport AB123456 issued 2024.`);
    expect(result.detections.some((d) => d.type === "canadian_passport")).toBe(true);
  });

  it("detects OpenAI/Anthropic/Google API keys and JWTs as blocked", () => {
    const samples = [
      "sk-aaaaaaaaaaaaaaaaaaaaaaaa",
      "sk-ant-xxxxxxxxxxxxxxxxxxxx",
      "AIzaSyA1234567890abcdefghijklmnopqrstuvw",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abcdef",
    ];
    for (const s of samples) {
      const result = scanForPII(s);
      expect(result.clean).toBe(false);
      expect(result.detections[0]?.action).toBe("blocked");
    }
  });

  it("detects bearer tokens and AWS access keys", () => {
    const r1 = scanForPII("Authorization: Bearer abcdefghijklmnopqrstuvwxyz");
    expect(r1.detections.some((d) => d.type === "bearer_token")).toBe(true);

    const r2 = scanForPII("AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE");
    expect(r2.detections.some((d) => d.type === "aws_access_key")).toBe(true);
  });

  it("truncates the stored match string to 4 chars + '***'", () => {
    const result = scanForPII(`SIN: ${VALID_SIN}`);
    const sin = result.detections.find((d) => d.type === "social_insurance_number");
    expect(sin?.match.endsWith("***")).toBe(true);
    // The truncated marker must not leak the full number
    expect(sin?.match).not.toContain(VALID_SIN);
  });
});

describe("scanForPII — medium-severity flagged patterns", () => {
  it("flags (does not block) email addresses", () => {
    const result = scanForPII("Contact alice@example.com");
    const email = result.detections.find((d) => d.type === "email_address");
    expect(email?.action).toBe("flagged");
    expect(result.blockedCount).toBe(0);
  });

  it("flags phone numbers but does not block", () => {
    const result = scanForPII("Call (780) 555-0123 anytime.");
    const phone = result.detections.find((d) => d.type === "phone_number");
    expect(phone?.action).toBe("flagged");
  });

  it("flags Alberta driver's licence only when hyphenated", () => {
    const hyphenated = scanForPII("Licence 123456-789");
    expect(hyphenated.detections.some((d) => d.type === "alberta_drivers_license")).toBe(true);

    // Bare 9-digit must NOT be reported as a drivers licence (caught by SIN/PHN luhn instead).
    const bare = scanForPII("Order 123456789");
    expect(bare.detections.some((d) => d.type === "alberta_drivers_license")).toBe(false);
  });
});

describe("scanForPII — clean inputs", () => {
  it("returns clean=true and empty detections for benign text", () => {
    const result = scanForPII("The quick brown fox jumps over the lazy dog.");
    expect(result.clean).toBe(true);
    expect(result.detections).toEqual([]);
    expect(result.blockedCount).toBe(0);
  });
});

describe("redactPII", () => {
  it("replaces blocked detections with [REDACTED:type] markers", () => {
    const content = `SIN ${VALID_SIN} on file.`;
    const result = scanForPII(content);
    const redacted = redactPII(content, result.detections);
    expect(redacted).not.toContain(VALID_SIN);
    expect(redacted).toContain("[REDACTED:social_insurance_number]");
  });

  it("leaves flagged-only matches alone", () => {
    const content = "Email me at alice@example.com";
    const result = scanForPII(content);
    const redacted = redactPII(content, result.detections);
    expect(redacted).toBe(content); // email is flagged, not redacted
  });

  it("handles multiple overlapping detections from highest position downwards", () => {
    const content = `Card ${VALID_VISA} and SIN ${VALID_SIN}.`;
    const result = scanForPII(content);
    const redacted = redactPII(content, result.detections);
    expect(redacted).not.toContain(VALID_VISA);
    expect(redacted).not.toContain(VALID_SIN);
    expect(redacted).toContain("[REDACTED:credit_card]");
    expect(redacted).toContain("[REDACTED:social_insurance_number]");
  });
});
