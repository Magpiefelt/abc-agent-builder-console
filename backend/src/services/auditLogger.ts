/**
 * Audit Logging Service
 *
 * Enterprise-grade audit trail for the ABC Agent Builder Console.
 * Writes immutable audit entries for all significant actions to the audit_log table.
 *
 * Adapted from the Hockey App's `server/utils/audit.ts` pattern with GoA-specific
 * action categories for agent orchestration, tool execution, and PII detection.
 *
 * Design:
 * - Fire-and-forget: audit failures never crash the application
 * - Structured: all entries use the AuditAction enum for consistency
 * - Queryable: helper functions for retrieving audit trails
 */

import { query } from "../config/database.js";
import { logger } from "./logger.js";

// ============================================================================
// AUDIT ACTION ENUM
// ============================================================================

/**
 * Canonical audit action identifiers.
 * Organized by domain for easy filtering and reporting.
 */
export enum AuditAction {
  // Authentication
  AUTH_LOGIN = "auth.login",
  AUTH_LOGOUT = "auth.logout",
  AUTH_TOKEN_REFRESH = "auth.token_refresh",
  AUTH_FAILED = "auth.failed",

  // Agent Sessions
  AGENT_SESSION_CREATED = "agent.session.created",
  AGENT_SESSION_STARTED = "agent.session.started",
  AGENT_SESSION_STOPPED = "agent.session.stopped",
  AGENT_SESSION_CONTINUED = "agent.session.continued",
  AGENT_SESSION_INTERJECTED = "agent.session.interjected",
  AGENT_SESSION_COMPLETED = "agent.session.completed",
  AGENT_SESSION_ERROR = "agent.session.error",
  AGENT_ITERATION_COMPLETE = "agent.iteration.complete",

  // Tool Execution
  TOOL_EXECUTED = "tool.executed",
  TOOL_FAILED = "tool.failed",
  TOOL_BLOCKED = "tool.blocked",

  // PII Detection
  PII_DETECTED_OUTBOUND = "pii.detected.outbound",
  PII_DETECTED_INBOUND = "pii.detected.inbound",
  PII_BLOCKED_PROMPT = "pii.blocked.prompt",

  // Workflow
  WORKFLOW_CREATED = "workflow.created",
  WORKFLOW_UPDATED = "workflow.updated",
  WORKFLOW_DELETED = "workflow.deleted",
  WORKFLOW_EXECUTED = "workflow.executed",

  // Admin
  ADMIN_ACCESS = "admin.access",
  ADMIN_MODEL_UPDATED = "admin.model.updated",
  ADMIN_CONFIG_CHANGED = "admin.config.changed",
  ADMIN_RETENTION_RUN = "admin.retention.run",
  ADMIN_PII_VIEWED = "admin.pii.viewed",
  ADMIN_SESSION_VIEWED = "admin.session.viewed",

  // Secrets Vault
  SECRET_CREATED = "secret.created",
  SECRET_ACCESSED = "secret.accessed",
  SECRET_DELETED = "secret.deleted",
  SECRET_ROTATED = "secret.rotated",

  // Security
  SECURITY_RATE_LIMITED = "security.rate_limited",
  SECURITY_INVALID_REQUEST = "security.invalid_request",
  SECURITY_PRIVATE_IP_BLOCKED = "security.private_ip_blocked",
}

// ============================================================================
// TYPES
// ============================================================================

export interface AuditEntry {
  userId?: string;
  ministryCode?: string;
  action: AuditAction | string;
  resourceType?: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

// ============================================================================
// CORE LOGGING
// ============================================================================

/**
 * Log an audit entry. Fire-and-forget (does not block the request).
 * Errors are swallowed after logging so audit failure never crashes the app.
 */
export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    // Structured log for immediate visibility in log aggregation
    logger.business(entry.action, {
      userId: entry.userId,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      ministryCode: entry.ministryCode,
      details: entry.details,
    });

    // Persist to database for long-term audit trail
    await query(
      `INSERT INTO audit_log (user_id, ministry_code, action, resource_type, resource_id, details, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        entry.userId || null,
        entry.ministryCode || null,
        entry.action,
        entry.resourceType || null,
        entry.resourceId || null,
        entry.details ? JSON.stringify(entry.details) : null,
        entry.ipAddress || null,
      ]
    );
  } catch (err) {
    // Audit logging should NEVER crash the application
    logger.error("Failed to write audit entry", err, {
      action: entry.action,
      userId: entry.userId,
    });
  }
}

// ============================================================================
// CONVENIENCE HELPERS
// ============================================================================

/**
 * Fire-and-forget audit of a user action.
 */
export function auditAction(
  userId: string,
  action: AuditAction | string,
  resourceType?: string,
  resourceId?: string,
  details?: Record<string, unknown>
): void {
  logAudit({ userId, action, resourceType, resourceId, details }).catch(() => {});
}

/**
 * Audit an agent session event.
 */
export function auditAgentEvent(
  userId: string,
  action: AuditAction,
  sessionId: string,
  details?: Record<string, unknown>
): void {
  logAudit({
    userId,
    action,
    resourceType: "agent_session",
    resourceId: sessionId,
    details,
  }).catch(() => {});
}

/**
 * Audit a tool execution.
 */
export function auditToolExecution(
  userId: string,
  sessionId: string,
  toolName: string,
  success: boolean,
  durationMs: number,
  details?: Record<string, unknown>
): void {
  logAudit({
    userId,
    action: success ? AuditAction.TOOL_EXECUTED : AuditAction.TOOL_FAILED,
    resourceType: "agent_session",
    resourceId: sessionId,
    details: { toolName, durationMs, ...details },
  }).catch(() => {});
}

/**
 * Audit a security event (rate limiting, blocked requests, etc.).
 */
export function auditSecurityEvent(
  action: AuditAction,
  ipAddress: string,
  details?: Record<string, unknown>
): void {
  logAudit({
    action,
    ipAddress,
    details,
  }).catch(() => {});
}

// ============================================================================
// QUERY HELPERS
// ============================================================================

/**
 * Get the audit trail for a specific resource.
 */
export async function getAuditTrail(
  resourceType: string,
  resourceId: string,
  limit: number = 50
): Promise<Record<string, unknown>[]> {
  try {
    const result = await query<Record<string, unknown>>(
      `SELECT id, user_id, ministry_code, action, resource_type, resource_id, 
              details, ip_address, created_at
       FROM audit_log
       WHERE resource_type = $1 AND resource_id = $2
       ORDER BY created_at DESC
       LIMIT $3`,
      [resourceType, resourceId, limit]
    );
    return result.rows;
  } catch (err) {
    logger.error("Failed to query audit trail", err);
    return [];
  }
}

/**
 * Get recent activity for a user.
 */
export async function getUserActivity(
  userId: string,
  limit: number = 100
): Promise<Record<string, unknown>[]> {
  try {
    const result = await query<Record<string, unknown>>(
      `SELECT id, action, resource_type, resource_id, details, ip_address, created_at
       FROM audit_log
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit]
    );
    return result.rows;
  } catch (err) {
    logger.error("Failed to query user activity", err);
    return [];
  }
}

/**
 * Get recent security events for monitoring.
 */
export async function getSecurityEvents(limit: number = 100): Promise<Record<string, unknown>[]> {
  try {
    const result = await query<Record<string, unknown>>(
      `SELECT id, user_id, action, details, ip_address, created_at
       FROM audit_log
       WHERE action LIKE 'security.%' OR action LIKE 'pii.%'
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );
    return result.rows;
  } catch (err) {
    logger.error("Failed to query security events", err);
    return [];
  }
}
