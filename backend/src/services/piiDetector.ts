/**
 * PII Detection Service
 *
 * Scans content for personally identifiable information before it is sent
 * to external LLM APIs or stored in long-lived state. Supports blocking,
 * redacting, or flagging based on severity.
 *
 * Detection coverage:
 *   - Canadian government identifiers: SIN (Luhn-gated), Alberta PHN/AHCN
 *     (Luhn-gated), Alberta driver's licence (narrowed format), Canadian
 *     passport.
 *   - Payment: credit card with Luhn validation.
 *   - Secrets: OpenAI key, Anthropic key, Google AI key, AWS access key,
 *     bearer tokens, JWTs, generic password/secret/token assignments.
 *   - Contact: email, North American phone.
 *
 * Numeric IDs (SIN, AHCN, credit card) are Luhn-checked to drop the
 * majority of false positives from random 9- and 16-digit sequences.
 *
 * Detected matches are truncated to the first 4 chars + `***` before
 * logging or storing — raw matches never leave this module.
 */

import { query } from "../config/database.js";
import { logger } from "./logger.js";

export interface PIIDetection {
  type: string;
  pattern: string;
  match: string;
  action: "blocked" | "redacted" | "flagged";
  position: { start: number; end: number };
}

export interface PIIScanResult {
  clean: boolean;
  detections: PIIDetection[];
  blockedCount: number;
  redactedContent?: string;
}

export interface PIIScanContext {
  /** User who supplied the content (for audit). */
  userId?: string;
  /** Session this content belongs to (for forensic context). */
  sessionId?: string;
}

interface PIIPattern {
  type: string;
  regex: RegExp;
  action: "blocked" | "redacted" | "flagged";
  description: string;
  /**
   * Optional post-match validator. If provided, only matches that pass
   * the validator are emitted as detections. Used for Luhn checks.
   */
  validate?: (match: string) => boolean;
}

// ============================================================================
// LUHN ALGORITHM
// ============================================================================

/**
 * Validate a numeric string against the Luhn (mod-10) checksum.
 * Used to gate credit card and Alberta health number detections so that
 * arbitrary 9- and 16-digit strings don't trigger false positives.
 */
function luhnCheck(input: string): boolean {
  const digits = input.replace(/\D/g, "");
  if (digits.length < 2) return false;

  let sum = 0;
  let doubleNext = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (doubleNext) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    doubleNext = !doubleNext;
  }
  return sum % 10 === 0;
}

// ============================================================================
// PATTERNS
// ============================================================================

const PII_PATTERNS: PIIPattern[] = [
  // ---------- Critical — always block ----------
  {
    type: "social_insurance_number",
    regex: /\b\d{3}[-\s]?\d{3}[-\s]?\d{3}\b/g,
    action: "blocked",
    description: "Social Insurance Number (SIN)",
    validate: (m) => luhnCheck(m),
  },
  {
    type: "alberta_health_number",
    regex: /\b\d{9}\b/g,
    action: "blocked",
    description: "Alberta Personal Health Number (PHN/AHCN)",
    // Alberta PHN uses Luhn — Luhn-gating reduces 9-digit false positives ~90%
    validate: (m) => luhnCheck(m),
  },
  {
    type: "credit_card",
    regex: /\b(?:\d[ -]?){12,18}\d\b/g,
    action: "blocked",
    description: "Credit Card Number",
    validate: (m) => {
      const digits = m.replace(/\D/g, "");
      return digits.length >= 13 && digits.length <= 19 && luhnCheck(digits);
    },
  },
  {
    type: "canadian_passport",
    regex: /\b[A-Z]{2}\d{6}\b/g,
    action: "blocked",
    description: "Canadian Passport Number",
  },
  {
    type: "api_key_openai",
    regex: /sk-[a-zA-Z0-9]{20,}/g,
    action: "blocked",
    description: "OpenAI API Key",
  },
  {
    type: "api_key_anthropic",
    regex: /sk-ant-[a-zA-Z0-9-]{20,}/g,
    action: "blocked",
    description: "Anthropic API Key",
  },
  {
    type: "api_key_google",
    regex: /AIza[a-zA-Z0-9_-]{35}/g,
    action: "blocked",
    description: "Google API Key",
  },
  {
    type: "aws_access_key",
    regex: /\bAKIA[0-9A-Z]{16}\b/g,
    action: "blocked",
    description: "AWS Access Key ID",
  },
  {
    type: "bearer_token",
    regex: /Bearer\s+[a-zA-Z0-9._-]{20,}/g,
    action: "blocked",
    description: "Bearer Token",
  },
  {
    type: "jwt",
    regex: /\beyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g,
    action: "blocked",
    description: "JSON Web Token (JWT)",
  },
  {
    type: "generic_secret",
    regex: /(?:password|secret|token|key)\s*[:=]\s*['"][^'"]{8,}['"]/gi,
    action: "blocked",
    description: "Generic Secret/Password",
  },

  // ---------- Medium — flag, do not block ----------
  {
    type: "email_address",
    regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    action: "flagged",
    description: "Email Address",
  },
  {
    type: "phone_number",
    regex: /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
    action: "flagged",
    description: "Phone Number",
  },
  {
    type: "alberta_drivers_license",
    // Tightened: require explicit hyphen (e.g. "123456-789"). The previous
    // loose form `\d{6}\d{3}?` collided with phone tails, order numbers, etc.
    regex: /\b\d{6}-\d{3}\b/g,
    action: "flagged",
    description: "Alberta Driver's Licence",
  },
];

// ============================================================================
// SCANNING
// ============================================================================

/**
 * Scan content for PII patterns.
 *
 * When `ctx.userId` is supplied, detections are fire-and-forget logged to
 * the `pii_detections` table (truncated match, no raw values).
 */
export function scanForPII(content: string, ctx?: PIIScanContext): PIIScanResult {
  const detections: PIIDetection[] = [];

  for (const pattern of PII_PATTERNS) {
    pattern.regex.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = pattern.regex.exec(content)) !== null) {
      if (pattern.validate && !pattern.validate(match[0])) continue;

      detections.push({
        type: pattern.type,
        pattern: pattern.description,
        match: match[0].substring(0, 4) + "***",
        action: pattern.action,
        position: { start: match.index, end: match.index + match[0].length },
      });
    }
  }

  const blockedCount = detections.filter((d) => d.action === "blocked").length;

  if (detections.length > 0 && ctx?.userId) {
    logDetections(ctx, detections).catch(() => {});
  }

  return {
    clean: detections.length === 0,
    detections,
    blockedCount,
  };
}

/**
 * Fire-and-forget bulk insert of detections into pii_detections.
 * Failures are swallowed (logged) — PII detection must never crash the request.
 */
async function logDetections(ctx: PIIScanContext, detections: PIIDetection[]): Promise<void> {
  try {
    for (const d of detections) {
      await query(
        `INSERT INTO pii_detections (user_id, session_id, detection_type, pattern_matched, action_taken, context_snippet)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          ctx.userId ?? null,
          ctx.sessionId ?? null,
          d.type,
          d.pattern,
          d.action,
          d.match,
        ]
      );
    }
  } catch (err) {
    logger.error("Failed to persist PII detections", err as Error, {
      userId: ctx.userId,
      sessionId: ctx.sessionId,
      detectionCount: detections.length,
    });
  }
}

/**
 * Redact detected PII from content (replace with [REDACTED:type]).
 */
export function redactPII(content: string, detections: PIIDetection[]): string {
  let redacted = content;
  const sorted = [...detections]
    .filter((d) => d.action === "blocked" || d.action === "redacted")
    .sort((a, b) => b.position.start - a.position.start);

  for (const detection of sorted) {
    const before = redacted.substring(0, detection.position.start);
    const after = redacted.substring(detection.position.end);
    redacted = before + `[REDACTED:${detection.type}]` + after;
  }

  return redacted;
}
