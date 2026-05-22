/**
 * Logger tests (Backlog O4).
 *
 * Pin the JSON line schema so the GoA aggregator's parsers cannot be silently
 * broken by a refactor, and confirm the pretty mode stays readable and
 * grep-friendly.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Logger, LogLevel, type LogFormat } from "../logger.js";

interface CapturedLine {
  level: LogLevel;
  line: string;
}

function newRecorder() {
  const captured: CapturedLine[] = [];
  return {
    captured,
    fn(level: LogLevel, line: string) {
      captured.push({ level, line });
    },
  };
}

function makeLogger(opts: { format?: LogFormat; minLevel?: LogLevel } = {}) {
  const rec = newRecorder();
  const logger = new Logger({
    format: opts.format ?? "json",
    minLevel: opts.minLevel ?? LogLevel.DEBUG,
    serviceName: "abc-backend",
    includeStacks: true,
    writeFn: rec.fn,
  });
  return { logger, captured: rec.captured };
}

beforeEach(() => {
  // Tests construct their own loggers — no need to scrub process.env between
  // them — but reset console.* spies to be safe.
  vi.restoreAllMocks();
});

describe("Logger — JSON mode (NDJSON wire format for Loki/ELK)", () => {
  it("emits one JSON object per call with the documented schema", () => {
    const { logger, captured } = makeLogger();
    logger.info("hello", { sessionId: "abc-123" });
    expect(captured).toHaveLength(1);
    const parsed = JSON.parse(captured[0].line);
    // Core fields are stable contract — Loki dashboards depend on them.
    expect(parsed).toMatchObject({
      level: "INFO",
      severity: "info",
      service: "abc-backend",
      message: "hello",
      sessionId: "abc-123",
    });
    expect(typeof parsed.timestamp).toBe("string");
    expect(new Date(parsed.timestamp).toISOString()).toBe(parsed.timestamp);
  });

  it("maps each level to its canonical severity label", () => {
    const { logger, captured } = makeLogger();
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    const severities = captured.map((c) => JSON.parse(c.line).severity);
    expect(severities).toEqual(["debug", "info", "warning", "error"]);
  });

  it("routes each level to the matching write call", () => {
    const { logger, captured } = makeLogger();
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    const levels = captured.map((c) => c.level);
    expect(levels).toEqual([LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR]);
  });

  it("drops entries below minLevel without invoking the write fn", () => {
    const { logger, captured } = makeLogger({ minLevel: LogLevel.WARN });
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    const messages = captured.map((c) => JSON.parse(c.line).message);
    expect(messages).toEqual(["w", "e"]);
  });

  it("serializes Error instances passed to .error() into a structured `error` field", () => {
    const { logger, captured } = makeLogger();
    const err = new TypeError("boom");
    logger.error("failure", err, { workflowId: "wf-1" });
    const parsed = JSON.parse(captured[0].line);
    expect(parsed.message).toBe("failure");
    expect(parsed.error.name).toBe("TypeError");
    expect(parsed.error.message).toBe("boom");
    expect(typeof parsed.error.stack).toBe("string");
    expect(parsed.workflowId).toBe("wf-1");
  });

  it("treats a non-Error second arg as a context object instead of a serialized error", () => {
    const { logger, captured } = makeLogger();
    logger.error("plain context", { ministry: "TREAS", code: 42 });
    const parsed = JSON.parse(captured[0].line);
    expect(parsed.ministry).toBe("TREAS");
    expect(parsed.code).toBe(42);
    expect(parsed.error).toBeUndefined();
  });

  it("normalises an Error passed as the context argument on .info/.warn/.debug", () => {
    const { logger, captured } = makeLogger();
    const err = new Error("oops");
    logger.warn("recoverable", err);
    const parsed = JSON.parse(captured[0].line);
    expect(parsed.message).toBe("recoverable");
    expect(parsed.error.message).toBe("oops");
  });

  it("falls back to a stringified `message` for non-Error, non-object error inputs", () => {
    const { logger, captured } = makeLogger();
    logger.error("weird", "string-error", { route: "/x" });
    const parsed = JSON.parse(captured[0].line);
    // "string-error" is not isErrorLike so it goes into the context bag.
    expect(parsed["0"]).toBe("s");
    // The route key from the third arg still lands.
    expect(parsed.route).toBe("/x");
  });

  it("clamps long SQL in query() to 300 chars to keep audit traffic bounded", () => {
    const { logger, captured } = makeLogger({ minLevel: LogLevel.DEBUG });
    const longSql = "SELECT " + "x".repeat(500);
    logger.query(longSql, 12, ["a", "b"]);
    const parsed = JSON.parse(captured[0].line);
    expect(parsed.sql.length).toBe(300);
    expect(parsed.durationMs).toBe(12);
    expect(parsed.paramCount).toBe(2);
  });

  it("specialised helpers populate semantic fields (request / response / auth / business / agent / tool)", () => {
    const { logger, captured } = makeLogger({ minLevel: LogLevel.DEBUG });
    logger.request("POST", "/api/agent/sessions", "u-1", "10.0.0.1");
    logger.response("POST", "/api/agent/sessions", 201, 42);
    logger.auth("login", "u-1", true);
    logger.business("session.created", { sessionId: "s-1" });
    logger.agent("orchestrator_started", "s-1", { iteration: 0 });
    logger.tool("web_search", "s-1", true, 230, { provider: "brave" });
    const parsed = captured.map((c) => JSON.parse(c.line));
    expect(parsed[0]).toMatchObject({ message: "API request", method: "POST", path: "/api/agent/sessions", userId: "u-1", ip: "10.0.0.1" });
    expect(parsed[1]).toMatchObject({ message: "API response", method: "POST", path: "/api/agent/sessions", statusCode: 201, durationMs: 42 });
    expect(parsed[2]).toMatchObject({ message: "Authentication event", event: "login", userId: "u-1", success: true });
    expect(parsed[3]).toMatchObject({ message: "Business event", event: "session.created", sessionId: "s-1" });
    expect(parsed[4]).toMatchObject({ message: "Agent event", event: "orchestrator_started", sessionId: "s-1", iteration: 0 });
    expect(parsed[5]).toMatchObject({ message: "Tool execution", toolName: "web_search", success: true, provider: "brave" });
  });

  it("slowQuery() emits at WARN level so it surfaces above DEBUG-suppressed traffic in production", () => {
    const { logger, captured } = makeLogger({ minLevel: LogLevel.WARN });
    logger.query("SELECT *", 1); // DEBUG — should be dropped
    logger.slowQuery("SELECT *", 2500); // WARN — should appear
    expect(captured).toHaveLength(1);
    const parsed = JSON.parse(captured[0].line);
    expect(parsed.level).toBe("WARN");
    expect(parsed.durationMs).toBe(2500);
  });
});

describe("Logger — pretty mode (local dev readability)", () => {
  it("renders a single grep-friendly line with the message", () => {
    const { logger, captured } = makeLogger({ format: "pretty" });
    logger.info("session ready", { sessionId: "s-99" });
    expect(captured).toHaveLength(1);
    expect(captured[0].line).toContain("INFO");
    expect(captured[0].line).toContain("session ready");
    expect(captured[0].line).toContain("sessionId=s-99");
  });

  it("emits the error message inline and pushes the stack to a trailing line", () => {
    const { logger, captured } = makeLogger({ format: "pretty" });
    const err = new Error("kaboom");
    logger.error("dispatch failed", err, { tool: "web_search" });
    const line = captured[0].line;
    expect(line).toContain("ERROR");
    expect(line).toContain("dispatch failed");
    expect(line).toContain("error=kaboom");
    expect(line).toContain("tool=web_search");
    // Stack trace lives below the primary line for grep-friendliness.
    expect(line).toContain("Error: kaboom");
  });

  it("renders objects and arrays as JSON instead of [object Object]", () => {
    const { logger, captured } = makeLogger({ format: "pretty" });
    logger.info("complex ctx", { meta: { a: 1 }, tags: ["x", "y"] });
    expect(captured[0].line).toContain('meta={"a":1}');
    expect(captured[0].line).toContain('tags=["x","y"]');
  });

  it("respects minLevel in pretty mode too", () => {
    const { logger, captured } = makeLogger({ format: "pretty", minLevel: LogLevel.ERROR });
    logger.info("hidden");
    logger.warn("hidden");
    logger.error("visible");
    expect(captured).toHaveLength(1);
    expect(captured[0].line).toContain("visible");
  });
});

describe("Logger — runtime configurability", () => {
  it("setMinLevel + setFormat update behaviour without re-instantiation", () => {
    const { logger, captured } = makeLogger();
    logger.debug("first");
    logger.setMinLevel(LogLevel.ERROR);
    logger.debug("dropped");
    logger.error("kept");
    logger.setFormat("pretty");
    logger.error("pretty-error");
    const lines = captured.map((c) => c.line);
    // first → JSON debug, kept → JSON error, pretty-error → pretty error
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]).message).toBe("first");
    expect(JSON.parse(lines[1]).message).toBe("kept");
    expect(lines[2]).toContain("ERROR");
    expect(lines[2]).toContain("pretty-error");
  });

  it("honours getFormat / getMinLevel reflection", () => {
    const { logger } = makeLogger({ format: "pretty", minLevel: LogLevel.WARN });
    expect(logger.getFormat()).toBe("pretty");
    expect(logger.getMinLevel()).toBe(LogLevel.WARN);
  });
});

describe("Logger — environment defaults", () => {
  it("defaults to JSON + INFO in production", () => {
    const originalEnv = process.env.NODE_ENV;
    const originalFormat = process.env.LOG_FORMAT;
    const originalLevel = process.env.LOG_LEVEL;
    process.env.NODE_ENV = "production";
    delete process.env.LOG_FORMAT;
    delete process.env.LOG_LEVEL;
    try {
      const rec = newRecorder();
      const logger = new Logger({ writeFn: rec.fn });
      expect(logger.getFormat()).toBe("json");
      expect(logger.getMinLevel()).toBe(LogLevel.INFO);
      logger.debug("hidden");
      logger.info("kept");
      expect(rec.captured).toHaveLength(1);
    } finally {
      process.env.NODE_ENV = originalEnv;
      if (originalFormat !== undefined) process.env.LOG_FORMAT = originalFormat;
      if (originalLevel !== undefined) process.env.LOG_LEVEL = originalLevel;
    }
  });

  it("defaults to pretty + DEBUG in development", () => {
    const originalEnv = process.env.NODE_ENV;
    const originalFormat = process.env.LOG_FORMAT;
    const originalLevel = process.env.LOG_LEVEL;
    process.env.NODE_ENV = "development";
    delete process.env.LOG_FORMAT;
    delete process.env.LOG_LEVEL;
    try {
      const rec = newRecorder();
      const logger = new Logger({ writeFn: rec.fn });
      expect(logger.getFormat()).toBe("pretty");
      expect(logger.getMinLevel()).toBe(LogLevel.DEBUG);
    } finally {
      process.env.NODE_ENV = originalEnv;
      if (originalFormat !== undefined) process.env.LOG_FORMAT = originalFormat;
      if (originalLevel !== undefined) process.env.LOG_LEVEL = originalLevel;
    }
  });

  it("env vars override NODE_ENV-derived defaults", () => {
    const originalEnv = process.env.NODE_ENV;
    const originalFormat = process.env.LOG_FORMAT;
    const originalLevel = process.env.LOG_LEVEL;
    process.env.NODE_ENV = "development";
    process.env.LOG_FORMAT = "json";
    process.env.LOG_LEVEL = "warn";
    try {
      const rec = newRecorder();
      const logger = new Logger({ writeFn: rec.fn });
      expect(logger.getFormat()).toBe("json");
      expect(logger.getMinLevel()).toBe(LogLevel.WARN);
    } finally {
      process.env.NODE_ENV = originalEnv;
      if (originalFormat !== undefined) process.env.LOG_FORMAT = originalFormat;
      else delete process.env.LOG_FORMAT;
      if (originalLevel !== undefined) process.env.LOG_LEVEL = originalLevel;
      else delete process.env.LOG_LEVEL;
    }
  });

  it("ignores an unknown LOG_LEVEL value and falls back to the NODE_ENV default", () => {
    const originalEnv = process.env.NODE_ENV;
    const originalLevel = process.env.LOG_LEVEL;
    process.env.NODE_ENV = "production";
    process.env.LOG_LEVEL = "nonsense";
    try {
      const rec = newRecorder();
      const logger = new Logger({ writeFn: rec.fn });
      expect(logger.getMinLevel()).toBe(LogLevel.INFO);
    } finally {
      process.env.NODE_ENV = originalEnv;
      if (originalLevel !== undefined) process.env.LOG_LEVEL = originalLevel;
      else delete process.env.LOG_LEVEL;
    }
  });

  it("LOG_SERVICE_NAME flows through to the JSON `service` field", () => {
    const originalName = process.env.LOG_SERVICE_NAME;
    process.env.LOG_SERVICE_NAME = "abc-canary";
    try {
      const rec = newRecorder();
      const logger = new Logger({ writeFn: rec.fn, format: "json", minLevel: LogLevel.DEBUG });
      logger.info("ping");
      const parsed = JSON.parse(rec.captured[0].line);
      expect(parsed.service).toBe("abc-canary");
    } finally {
      if (originalName !== undefined) process.env.LOG_SERVICE_NAME = originalName;
      else delete process.env.LOG_SERVICE_NAME;
    }
  });
});

describe("Logger — production stack hiding", () => {
  it("omits stack traces in production for serialized errors", () => {
    const rec = newRecorder();
    const logger = new Logger({
      format: "json",
      minLevel: LogLevel.DEBUG,
      serviceName: "abc-backend",
      includeStacks: false,
      writeFn: rec.fn,
    });
    logger.error("boom", new Error("inner"));
    const parsed = JSON.parse(rec.captured[0].line);
    expect(parsed.error.message).toBe("inner");
    expect(parsed.error.stack).toBeUndefined();
  });

  it("keeps stack traces in development", () => {
    const rec = newRecorder();
    const logger = new Logger({
      format: "json",
      minLevel: LogLevel.DEBUG,
      serviceName: "abc-backend",
      includeStacks: true,
      writeFn: rec.fn,
    });
    logger.error("boom", new Error("inner"));
    const parsed = JSON.parse(rec.captured[0].line);
    expect(typeof parsed.error.stack).toBe("string");
  });
});
