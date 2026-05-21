/**
 * PII Detection Service
 * Scans content for personally identifiable information before it is sent to external LLM APIs.
 * Supports blocking, redacting, or flagging based on severity.
 */

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

interface PIIPattern {
  type: string;
  regex: RegExp;
  action: "blocked" | "redacted" | "flagged";
  description: string;
}

const PII_PATTERNS: PIIPattern[] = [
  // Critical - Always block
  {
    type: "social_insurance_number",
    regex: /\b\d{3}[-\s]?\d{3}[-\s]?\d{3}\b/g,
    action: "blocked",
    description: "Social Insurance Number (SIN)",
  },
  {
    type: "alberta_health_number",
    regex: /\b\d{9}\b/g,
    action: "flagged", // 9-digit numbers are common; flag but don't block unless context confirms
    description: "Potential Alberta Health Care Number",
  },
  {
    type: "credit_card",
    regex: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
    action: "blocked",
    description: "Credit Card Number",
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
    type: "bearer_token",
    regex: /Bearer\s+[a-zA-Z0-9._-]{20,}/g,
    action: "blocked",
    description: "Bearer Token",
  },
  {
    type: "generic_secret",
    regex: /(?:password|secret|token|key)\s*[:=]\s*['"][^'"]{8,}['"]/gi,
    action: "blocked",
    description: "Generic Secret/Password",
  },

  // High - Redact
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

  // Medium - Flag
  {
    type: "alberta_drivers_license",
    regex: /\b\d{6}[-]?\d{3}\b/g,
    action: "flagged",
    description: "Potential Alberta Driver's License",
  },
];

/**
 * Scan content for PII patterns.
 */
export function scanForPII(content: string): PIIScanResult {
  const detections: PIIDetection[] = [];

  for (const pattern of PII_PATTERNS) {
    // Reset regex state
    pattern.regex.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = pattern.regex.exec(content)) !== null) {
      detections.push({
        type: pattern.type,
        pattern: pattern.description,
        match: match[0].substring(0, 4) + "***", // Truncate for logging
        action: pattern.action,
        position: { start: match.index, end: match.index + match[0].length },
      });
    }
  }

  const blockedCount = detections.filter((d) => d.action === "blocked").length;

  return {
    clean: detections.length === 0,
    detections,
    blockedCount,
  };
}

/**
 * Redact detected PII from content (replace with [REDACTED]).
 */
export function redactPII(content: string, detections: PIIDetection[]): string {
  let redacted = content;
  // Sort detections by position descending so replacements don't shift indices
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
