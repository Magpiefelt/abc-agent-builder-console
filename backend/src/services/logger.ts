/**
 * Structured Logger Service
 *
 * Enterprise-grade structured JSON logging for the ABC backend.
 * Adapted from the Hockey App's logging pattern for GoA observability requirements.
 *
 * Features:
 * - Level-based filtering (DEBUG, INFO, WARN, ERROR)
 * - Structured JSON output for log aggregation
 * - Specialized methods for queries, requests, auth, and business events
 * - Safe error serialization (no stack traces in production)
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

interface LogContext {
  [key: string]: unknown;
}

interface SerializedError {
  name?: string;
  message: string;
  stack?: string;
}

function isErrorLike(value: unknown): value is { name?: string; message?: string; stack?: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    ("message" in value || "name" in value || "stack" in value)
  );
}

class Logger {
  private minLevel: LogLevel;
  private includeStacks: boolean;

  constructor() {
    this.minLevel = process.env.NODE_ENV === "production" ? LogLevel.INFO : LogLevel.DEBUG;
    this.includeStacks = process.env.NODE_ENV !== "production";
  }

  private serializeError(err: unknown): SerializedError | undefined {
    if (!err) return undefined;
    if (err instanceof Error) {
      return {
        name: err.name,
        message: err.message,
        stack: this.includeStacks ? err.stack : undefined,
      };
    }
    if (isErrorLike(err)) {
      return {
        name: err.name,
        message: err.message || String(err),
        stack: this.includeStacks ? err.stack : undefined,
      };
    }
    return { message: String(err) };
  }

  private log(level: LogLevel, message: string, context?: LogContext): void {
    if (level < this.minLevel) return;

    const entry = {
      timestamp: new Date().toISOString(),
      level: LogLevel[level],
      service: "abc-backend",
      message,
      ...context,
    };

    const formatted = JSON.stringify(entry);

    switch (level) {
      case LogLevel.DEBUG:
        console.debug(formatted);
        break;
      case LogLevel.INFO:
        console.info(formatted);
        break;
      case LogLevel.WARN:
        console.warn(formatted);
        break;
      case LogLevel.ERROR:
        console.error(formatted);
        break;
    }
  }

  private normalizeContext(context?: LogContext | Error): LogContext | undefined {
    if (!context) return undefined;
    if (context instanceof Error) {
      return { error: this.serializeError(context) };
    }
    return context;
  }

  // ============================================================================
  // CORE METHODS
  // ============================================================================

  debug(message: string, context?: LogContext | Error): void {
    this.log(LogLevel.DEBUG, message, this.normalizeContext(context));
  }

  info(message: string, context?: LogContext | Error): void {
    this.log(LogLevel.INFO, message, this.normalizeContext(context));
  }

  warn(message: string, context?: LogContext | Error): void {
    this.log(LogLevel.WARN, message, this.normalizeContext(context));
  }

  error(message: string, errorOrContext?: unknown, context?: LogContext): void {
    const error = isErrorLike(errorOrContext) ? errorOrContext : undefined;
    const mergedContext: LogContext | undefined = error
      ? { ...context, error: this.serializeError(errorOrContext) }
      : { ...(errorOrContext as LogContext | undefined), ...context };

    this.log(LogLevel.ERROR, message, mergedContext);
  }

  // ============================================================================
  // SPECIALIZED METHODS
  // ============================================================================

  /**
   * Log a database query (DEBUG level).
   */
  query(sql: string, durationMs?: number, params?: unknown[]): void {
    this.debug("Database query", {
      sql: sql.substring(0, 300),
      durationMs,
      paramCount: params?.length,
    });
  }

  /**
   * Log a slow query (WARN level).
   */
  slowQuery(sql: string, durationMs: number): void {
    this.warn("Slow query detected", {
      sql: sql.substring(0, 300),
      durationMs,
    });
  }

  /**
   * Log an API request (INFO level).
   */
  request(method: string, path: string, userId?: string, ip?: string): void {
    this.info("API request", { method, path, userId, ip });
  }

  /**
   * Log an API response (INFO level).
   */
  response(method: string, path: string, statusCode: number, durationMs: number): void {
    this.info("API response", { method, path, statusCode, durationMs });
  }

  /**
   * Log an authentication event (INFO level).
   */
  auth(event: string, userId?: string, success: boolean = true): void {
    this.info("Authentication event", { event, userId, success });
  }

  /**
   * Log a business/domain event (INFO level).
   */
  business(event: string, context?: LogContext): void {
    this.info("Business event", { event, ...context });
  }

  /**
   * Log an agent orchestration event (INFO level).
   */
  agent(event: string, sessionId: string, context?: LogContext): void {
    this.info("Agent event", { event, sessionId, ...context });
  }

  /**
   * Log a tool execution event (DEBUG level).
   */
  tool(toolName: string, sessionId: string, success: boolean, durationMs: number, context?: LogContext): void {
    this.debug("Tool execution", { toolName, sessionId, success, durationMs, ...context });
  }
}

export const logger = new Logger();
