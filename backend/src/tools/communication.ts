/**
 * Communication Tools
 *
 * `send_email` delivers a message via the GoA SMTP relay. Recipients are
 * validated against `emailAllowlist.json` and each user is capped at
 * 10 emails per 60-second window. Subjects are prefixed with `[ABC] `.
 */

import nodemailer from "nodemailer";
import { env } from "../config/env.js";
import { logger } from "../services/logger.js";
import { auditSecurityEvent, AuditAction } from "../services/auditLogger.js";
import type { ToolContext } from "../services/toolDispatcher.js";
import emailAllowlist from "../data/emailAllowlist.json" with { type: "json" };

interface EmailAllowlist {
  domains: string[];
  addresses: string[];
}

const ALLOWLIST = emailAllowlist as EmailAllowlist;

const SUBJECT_PREFIX = "[ABC] ";
const RATE_LIMIT_PER_USER = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;
const MAX_SUBJECT_LENGTH = 200;
const MAX_BODY_BYTES = 1 * 1024 * 1024; // 1MB

export interface SendEmailResult {
  success: boolean;
  messageId?: string;
  to?: string;
  error?: string;
}

// ============================================================================
// ALLOWLIST
// ============================================================================

export function validateEmailAllowlist(): void {
  if (!ALLOWLIST || typeof ALLOWLIST !== "object") {
    throw new Error("emailAllowlist.json is malformed.");
  }
  if (!Array.isArray(ALLOWLIST.domains) || !Array.isArray(ALLOWLIST.addresses)) {
    throw new Error("emailAllowlist.json must have 'domains' and 'addresses' arrays.");
  }
  logger.info("emailAllowlist validated", {
    domains: ALLOWLIST.domains.length,
    addresses: ALLOWLIST.addresses.length,
  });
}

function isAllowedRecipient(email: string): boolean {
  const lower = email.toLowerCase();
  if (ALLOWLIST.addresses.map((a) => a.toLowerCase()).includes(lower)) return true;
  return ALLOWLIST.domains.some((d) => {
    const domain = d.toLowerCase().replace(/^@/, "");
    return lower.endsWith(`@${domain}`);
  });
}

// ============================================================================
// RATE LIMIT (per-user, per 60s)
// ============================================================================

const sendEmailRateLimits: Map<string, number[]> = new Map();

function checkAndRecordRateLimit(userId: string): { allowed: boolean; resetMs?: number } {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const existing = (sendEmailRateLimits.get(userId) || []).filter((ts) => ts > cutoff);

  if (existing.length >= RATE_LIMIT_PER_USER) {
    const oldest = existing[0];
    sendEmailRateLimits.set(userId, existing);
    return { allowed: false, resetMs: oldest + RATE_LIMIT_WINDOW_MS - now };
  }

  existing.push(now);
  sendEmailRateLimits.set(userId, existing);
  return { allowed: true };
}

let cleanupInterval: ReturnType<typeof setInterval> | null = null;
function ensureRateLimitCleanup(): void {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => {
    const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;
    for (const [userId, timestamps] of sendEmailRateLimits) {
      const fresh = timestamps.filter((ts) => ts > cutoff);
      if (fresh.length === 0) sendEmailRateLimits.delete(userId);
      else if (fresh.length !== timestamps.length) sendEmailRateLimits.set(userId, fresh);
    }
  }, 5 * 60 * 1000);
  cleanupInterval.unref();
}

// ============================================================================
// TRANSPORTER (lazy)
// ============================================================================

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (transporter) return transporter;
  if (!env.EMAIL_SMTP_HOST || !env.EMAIL_SMTP_USER || !env.EMAIL_SMTP_PASS) {
    throw new Error("SMTP is not configured (EMAIL_SMTP_HOST/USER/PASS).");
  }
  const secure = env.EMAIL_SMTP_SECURE === true;
  transporter = nodemailer.createTransport({
    host: env.EMAIL_SMTP_HOST,
    port: env.EMAIL_SMTP_PORT,
    secure,
    requireTLS: !secure,
    auth: {
      user: env.EMAIL_SMTP_USER,
      pass: env.EMAIL_SMTP_PASS,
    },
  });
  return transporter;
}

// ============================================================================
// SEND EMAIL
// ============================================================================

export async function sendEmail(
  params: Record<string, unknown>,
  context?: ToolContext
): Promise<SendEmailResult> {
  const to = (params.to as string)?.trim();
  const subjectRaw = (params.subject as string)?.trim();
  const body = (params.body as string) ?? "";
  const isHtml = params.isHtml === true;

  if (!to) return { success: false, error: "Parameter 'to' is required." };
  if (!subjectRaw) return { success: false, error: "Parameter 'subject' is required." };
  if (!body) return { success: false, error: "Parameter 'body' is required." };

  if (subjectRaw.length > MAX_SUBJECT_LENGTH) {
    return { success: false, error: `Subject exceeds ${MAX_SUBJECT_LENGTH} character limit.` };
  }
  const bodyBytes = Buffer.byteLength(body, "utf-8");
  if (bodyBytes > MAX_BODY_BYTES) {
    return { success: false, error: `Email body exceeds ${MAX_BODY_BYTES / (1024 * 1024)}MB limit (got ${Math.round(bodyBytes / (1024 * 1024))}MB).` };
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return { success: false, error: `'${to}' is not a valid email address.` };
  }

  if (!isAllowedRecipient(to)) {
    auditSecurityEvent(AuditAction.SECURITY_INVALID_REQUEST, context?.userId || "system", {
      tool: "send_email",
      reason: "recipient not in emailAllowlist",
      to,
    });
    return { success: false, error: `Recipient '${to}' is not in the email allowlist.` };
  }

  if (!context?.userId) {
    return { success: false, error: "send_email requires an authenticated user context." };
  }

  ensureRateLimitCleanup();
  const rate = checkAndRecordRateLimit(context.userId);
  if (!rate.allowed) {
    auditSecurityEvent(AuditAction.SECURITY_RATE_LIMITED, context.userId, {
      tool: "send_email",
      windowMs: RATE_LIMIT_WINDOW_MS,
      limit: RATE_LIMIT_PER_USER,
    });
    return { success: false, error: `Email rate limit exceeded (${RATE_LIMIT_PER_USER}/min).` };
  }

  const subject = subjectRaw.startsWith(SUBJECT_PREFIX) ? subjectRaw : SUBJECT_PREFIX + subjectRaw;
  const from = env.EMAIL_FROM || env.EMAIL_SMTP_USER;
  if (!from) return { success: false, error: "Email sender is not configured (set EMAIL_FROM or EMAIL_SMTP_USER)." };

  try {
    const info = await getTransporter().sendMail({
      from,
      to,
      subject,
      ...(isHtml ? { html: body } : { text: body }),
    });
    logger.info("send_email delivered", { to, subject, userId: context.userId, messageId: info.messageId });
    return { success: true, messageId: info.messageId, to };
  } catch (err) {
    logger.error("send_email failed", err, { to, userId: context.userId });
    return { success: false, error: `Email send failed: ${(err as Error).message}` };
  }
}
