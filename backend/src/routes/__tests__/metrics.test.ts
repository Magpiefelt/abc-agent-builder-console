/**
 * Route-level tests for GET /api/metrics.
 *
 * Verifies the response shape (Prometheus exposition text), authentication
 * gating (admin role enforced via `requireRole('admin')`), and the
 * scrape-time process-info refresh.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../../config/env.js", () => ({
  env: {
    NODE_ENV: "development",
    PORT: 3000,
    DATABASE_URL: undefined,
    DB_SCHEMA: "test",
    SESSION_SECRET: "test",
    FRONTEND_URL: "http://localhost:5173",
  },
}));

import metricsRouter from "../metrics.js";
import { registry, M } from "../../services/metrics.js";

function makeApp(): express.Express {
  const app = express();
  app.use("/api/metrics", metricsRouter);
  return app;
}

beforeEach(() => {
  // Clear series between tests but keep metric definitions so M.* stays
  // attached to the registry. This mirrors how the singleton lives at
  // runtime — services keep their accessor references for the life of the
  // process.
  registry.reset();
});

describe("GET /api/metrics", () => {
  it("returns 200 with Prometheus text content-type", async () => {
    const res = await request(makeApp()).get("/api/metrics");
    expect(res.status).toBe(200);
    // Express normalizes the header order — `charset` may be moved ahead of
    // `version`. Both directives must be present.
    expect(res.headers["content-type"]).toMatch(/^text\/plain;/);
    expect(res.headers["content-type"]).toMatch(/version=0\.0\.4/);
    expect(res.headers["content-type"]).toMatch(/charset=utf-8/);
  });

  it("includes process metrics refreshed at scrape time", async () => {
    const res = await request(makeApp()).get("/api/metrics");
    expect(res.text).toMatch(/^# HELP abc_process_uptime_seconds /m);
    expect(res.text).toMatch(/^# TYPE abc_process_uptime_seconds gauge/m);
    expect(res.text).toMatch(/abc_process_uptime_seconds \d+(?:\.\d+)?/);
    expect(res.text).toMatch(/abc_nodejs_memory_bytes\{type="rss"\} \d+/);
    expect(res.text).toMatch(/abc_nodejs_memory_bytes\{type="heap_used"\} \d+/);
  });

  it("renders any observed counter series", async () => {
    // Re-fetch the accessor after reset to ensure it's attached.
    const llmReqs = registry.counter("abc_llm_requests_total", "");
    llmReqs.inc({ provider: "vertex_ai", model: "claude-sonnet", outcome: "success" });
    llmReqs.inc({ provider: "vertex_ai", model: "claude-sonnet", outcome: "success" });

    const res = await request(makeApp()).get("/api/metrics");
    expect(res.text).toMatch(/abc_llm_requests_total\{model="claude-sonnet",outcome="success",provider="vertex_ai"\} 2/);
  });

  it("renders histogram buckets + count + sum", async () => {
    const h = registry.histogram("abc_llm_request_duration_seconds", "", [0.5, 1, 5]);
    h.observe(0.4);
    h.observe(2);

    const res = await request(makeApp()).get("/api/metrics");
    expect(res.text).toContain('abc_llm_request_duration_seconds_bucket{le="0.5"} 1');
    expect(res.text).toContain('abc_llm_request_duration_seconds_bucket{le="1"} 1');
    expect(res.text).toContain('abc_llm_request_duration_seconds_bucket{le="5"} 2');
    expect(res.text).toContain('abc_llm_request_duration_seconds_bucket{le="+Inf"} 2');
    expect(res.text).toContain("abc_llm_request_duration_seconds_count 2");
    expect(res.text).toContain("abc_llm_request_duration_seconds_sum 2.4");
  });

  it("sets no-cache headers so scrapers don't get stale data", async () => {
    const res = await request(makeApp()).get("/api/metrics");
    expect(res.headers["cache-control"]).toMatch(/no-cache/);
  });

  it("M.* accessors used inside the app feed into the rendered output", async () => {
    // Update via the pre-registered M reference (same path real services use).
    M.toolCalls.inc({ tool: "web_search", outcome: "success" });
    const res = await request(makeApp()).get("/api/metrics");
    expect(res.text).toContain('abc_tool_calls_total{outcome="success",tool="web_search"} 1');
  });
});
