/**
 * Structured Logger Service
 *
 * NDJSON output is the production default — one JSON object per line on
 * stdout/stderr, ready for Vector / Fluent Bit / Promtail to ship to the GoA
 * log aggregator (Loki / ELK). Local development defaults to a colourised
 * pretty form for readability.
 *
 * Configuration (see `config/env.ts`):
 *  - `LOG_FORMAT` (`json` | `pretty`): output shape. Default = `json` in
 *    production, `pretty` everywhere else.
 *  - `LOG_LEVEL` (`debug` | `info` | `warn` | `error`): minimum level emitted.
 *    Default = `info` in production, `debug` everywhere else.
 *  - `LOG_SERVICE_NAME`: static `service` label on every JSON entry.
 *
 * JSON line schema (stable contract for the aggregator):
 *
 *   {
 *     "timestamp":   "<ISO 8601 UTC>",
 *     "level":       "DEBUG" | "INFO" | "WARN" | "ERROR",
 *     "severity":    "debug" | "info" | "warning" | "error",  // Loki convention
 *     "service":     "<LOG_SERVICE_NAME>",
 *     "message":     "<human-readable summary>",
 *     ...<arbitrary context keys including a serialized `error` when present>
 *   }
 *
 * Why both `level` (UPPER) and `severity` (lower)? Loki/Grafana derives the
 * line colour from `severity`, while existing structured log readers (and our
 * own tests) expected `level`. Emitting both keeps the schema additive.
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

type LevelName = "DEBUG" | "INFO" | "WARN" | "ERROR";
type SeverityName = "debug" | "info" | "warning" | "error";

interface LogContext {
  [key: string]: unknown;
}

interface SerializedError {
  name?: string;
  message: string;
  stack?: string;
}

export type LogFormat = "json" | "pretty";

export interface LoggerOptions {
  /** Output shape. */
  format?: LogFormat;
  /** Minimum level. Entries below this are dropped. */
  minLevel?: LogLevel;
  /** Service name emitted as the `service` field. */
  serviceName?: string;
  /** Whether to include error stack traces in serialized errors. */
  includeStacks?: boolean;
  /** Destination function (defaults to console.*). Tests override this. */
  writeFn?: (level: LogLevel, line: string) => void;
}

function isErrorLike(value: unknown): value is { name?: string; message?: string; stack?: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    ("message" in value || "name" in value || "stack" in value)
  );
}

const LEVEL_TO_SEVERITY: Record<LevelName, SeverityName> = {
  DEBUG: "debug",
  INFO: "info",
  WARN: "warning",
  ERROR: "error",
};

const LEVEL_FROM_STRING: Record<string, LogLevel> = {
  debug: LogLevel.DEBUG,
  info: LogLevel.INFO,
  warn: LogLevel.WARN,
  error: LogLevel.ERROR,
};

// ANSI colours for `pretty` mode. We keep this tiny and dependency-free so the
// logger remains usable in environments where chalk / kleur are unavailable.
const ANSI = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
} as const;

function defaultWrite(level: LogLevel, line: string): void {
  switch (level) {
    case LogLevel.DEBUG:
      console.debug(line);
      return;
    case LogLevel.INFO:
      console.info(line);
      return;
    case LogLevel.WARN:
      console.warn(line);
      return;
    case LogLevel.ERROR:
      console.error(line);
      return;
  }
}

/**
 * Resolve the default options from process.env. Pulled out so tests can
 * construct a Logger with explicit options instead.
 */
function resolveDefaultsFromEnv(): Required<Omit<LoggerOptions, "writeFn">> {
  const nodeEnv = process.env.NODE_ENV ?? "development";
  const rawFormat = process.env.LOG_FORMAT;
  const format: LogFormat =
    rawFormat === "json" || rawFormat === "pretty"
      ? rawFormat
      : nodeEnv === "production"
      ? "json"
      : "pretty";

  const rawLevel = (process.env.LOG_LEVEL ?? "").toLowerCase();
  const minLevel =
    rawLevel in LEVEL_FROM_STRING
      ? LEVEL_FROM_STRING[rawLevel]
      : nodeEnv === "production"
      ? LogLevel.INFO
      : LogLevel.DEBUG;

  return {
    format,
    minLevel,
    serviceName: process.env.LOG_SERVICE_NAME ?? "abc-backend",
    includeStacks: nodeEnv !== "production",
  };
}

export class Logger {
  private format: LogFormat;
  private minLevel: LogLevel;
  private serviceName: string;
  private includeStacks: boolean;
  private writeFn: (level: LogLevel, line: string) => void;

  constructor(options: LoggerOptions = {}) {
    const defaults = resolveDefaultsFromEnv();
    this.format = options.format ?? defaults.format;
    this.minLevel = options.minLevel ?? defaults.minLevel;
    this.serviceName = options.serviceName ?? defaults.serviceName;
    this.includeStacks = options.includeStacks ?? defaults.includeStacks;
    this.writeFn = options.writeFn ?? defaultWrite;
  }

  /** Test/runtime helper: change the minimum level after construction. */
  setMinLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  /** Test/runtime helper: change the output format after construction. */
  setFormat(format: LogFormat): void {
    this.format = format;
  }

  /** Read-only accessor for tests. */
  getFormat(): LogFormat {
    return this.format;
  }

  /** Read-only accessor for tests. */
  getMinLevel(): LogLevel {
    return this.minLevel;
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

  private formatJson(level: LogLevel, message: string, context?: LogContext): string {
    const levelName = LogLevel[level] as LevelName;
    const entry: LogContext = {
      timestamp: new Date().toISOString(),
      level: levelName,
      severity: LEVEL_TO_SEVERITY[levelName],
      service: this.serviceName,
      message,
      ...context,
    };
    return JSON.stringify(entry);
  }

  private formatPretty(level: LogLevel, message: string, context?: LogContext): string {
    const levelName = LogLevel[level] as LevelName;
    const colour =
      level === LogLevel.ERROR
        ? ANSI.red
        : level === LogLevel.WARN
        ? ANSI.yellow
        : level === LogLevel.INFO
        ? ANSI.cyan
        : ANSI.gray;
    const time = new Date().toISOString().slice(11, 23);
    const head = `${ANSI.dim}${time}${ANSI.reset} ${colour}${ANSI.bold}${levelName.padEnd(5)}${ANSI.reset}`;
    const ctxKeys = context ? Object.keys(context) : [];
    if (ctxKeys.length === 0) {
      return `${head} ${message}`;
    }
    // Compact, single-line context summary. Errors get rendered with their
    // message; other complex values are JSON-stringified inline. Stack traces
    // (when present) follow on the next line so the primary log line stays
    // grep-friendly.
    // Keep key=value pairs un-coloured so they survive a `grep` and so tests
    // can assert on the literal `key=value` substring without stripping ANSI.
    const trailingStack: string[] = [];
    const inlineParts: string[] = [];
    for (const key of ctxKeys) {
      const value = context![key];
      if (key === "error" && value && typeof value === "object") {
        const errObj = value as SerializedError;
        inlineParts.push(`error=${errObj.message ?? ""}`);
        if (errObj.stack) trailingStack.push(errObj.stack);
        continue;
      }
      const rendered =
        typeof value === "string"
          ? value
          : typeof value === "number" || typeof value === "boolean"
          ? String(value)
          : JSON.stringify(value);
      inlineParts.push(`${key}=${rendered}`);
    }
    const tail = inlineParts.length ? ` ${ANSI.dim}|${ANSI.reset} ${inlineParts.join(" ")}` : "";
    const stack = trailingStack.length ? `\n${ANSI.dim}${trailingStack.join("\n")}${ANSI.reset}` : "";
    return `${head} ${message}${tail}${stack}`;
  }

  private log(level: LogLevel, message: string, context?: LogContext): void {
    if (level < this.minLevel) return;
    const line =
      this.format === "json"
        ? this.formatJson(level, message, context)
        : this.formatPretty(level, message, context);
    this.writeFn(level, line);
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
