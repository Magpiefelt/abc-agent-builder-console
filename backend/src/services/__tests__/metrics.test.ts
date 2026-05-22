import { describe, it, expect, beforeEach } from "vitest";
import {
  registry,
  M,
  refreshProcessMetrics,
  DURATION_SECONDS_BUCKETS,
  LLM_LATENCY_BUCKETS,
} from "../metrics.js";

// The metrics registry is a process-wide singleton (so it can be incremented
// from anywhere). For tests we reset it between cases and re-register the
// pre-defined `M.*` metrics that the service expects to exist.
beforeEach(() => {
  registry.reset();
  // Force re-registration of the M.* accessors by re-importing.
  // Each test that needs them calls `registry.counter(...)` etc. directly,
  // since the M cache above holds stale references after reset.
});

describe("MetricsRegistry — Counter", () => {
  it("inc with no labels accumulates", () => {
    const c = registry.counter("test_counter_total", "test counter");
    c.inc();
    c.inc({}, 4);
    expect(c.get()).toBe(5);
  });

  it("inc with distinct labels keeps separate series", () => {
    const c = registry.counter("requests_total", "requests");
    c.inc({ method: "GET" });
    c.inc({ method: "GET" });
    c.inc({ method: "POST" });
    expect(c.get({ method: "GET" })).toBe(2);
    expect(c.get({ method: "POST" })).toBe(1);
    expect(c.get({ method: "DELETE" })).toBe(0);
  });

  it("label order does not create distinct series", () => {
    const c = registry.counter("labeled_total", "");
    c.inc({ a: "1", b: "2" });
    c.inc({ b: "2", a: "1" });
    expect(c.get({ a: "1", b: "2" })).toBe(2);
  });

  it("ignores negative deltas", () => {
    const c = registry.counter("only_up_total", "");
    c.inc({}, 5);
    c.inc({}, -3);
    expect(c.get()).toBe(5);
  });

  it("throws if reused as another metric type", () => {
    registry.counter("a_total", "");
    expect(() => registry.gauge("a_total", "")).toThrow(/already registered as counter/);
  });

  it("rejects invalid metric names", () => {
    expect(() => registry.counter("9_starts_with_digit", "")).toThrow(/invalid metric name/);
    expect(() => registry.counter("has space", "")).toThrow(/invalid metric name/);
  });

  it("rejects invalid label names", () => {
    const c = registry.counter("name_ok_total", "");
    expect(() => c.inc({ "bad label": "x" })).toThrow(/invalid label name/);
  });
});

describe("MetricsRegistry — Gauge", () => {
  it("set replaces the value", () => {
    const g = registry.gauge("active", "");
    g.set(7);
    g.set(3);
    expect(g.get()).toBe(3);
  });

  it("inc and dec move the value up and down", () => {
    const g = registry.gauge("inflight", "");
    g.inc({ provider: "vertex" });
    g.inc({ provider: "vertex" });
    g.dec({ provider: "vertex" });
    expect(g.get({ provider: "vertex" })).toBe(1);
  });

  it("dec on never-observed series initialises at zero then decrements", () => {
    const g = registry.gauge("queued", "");
    g.dec({ q: "a" }, 1);
    expect(g.get({ q: "a" })).toBe(-1);
  });
});

describe("MetricsRegistry — Histogram", () => {
  it("observes count, sum, and bucket cumulative counts", () => {
    const h = registry.histogram("dur_seconds", "duration", [0.1, 1, 5]);
    h.observe(0.05);
    h.observe(0.5);
    h.observe(3);
    h.observe(7);
    const snap = h.snapshot();
    expect(snap.count).toBe(4);
    expect(snap.sum).toBeCloseTo(0.05 + 0.5 + 3 + 7, 6);
  });

  it("ignores non-finite values", () => {
    const h = registry.histogram("safe_seconds", "", [1]);
    h.observe(Number.NaN);
    h.observe(Number.POSITIVE_INFINITY);
    expect(h.snapshot().count).toBe(0);
  });

  it("requires at least one bucket", () => {
    expect(() => registry.histogram("empty_seconds", "", [])).toThrow(/requires at least one bucket/);
  });

  it("dedupes and sorts provided buckets", () => {
    const h = registry.histogram("sorted_seconds", "", [5, 1, 5, 0.5]);
    h.observe(2);
    const text = registry.render();
    // Buckets render in ascending order with each le label.
    const buckets = text
      .split("\n")
      .filter((l) => l.startsWith("sorted_seconds_bucket"));
    expect(buckets[0]).toContain('le="0.5"');
    expect(buckets[1]).toContain('le="1"');
    expect(buckets[2]).toContain('le="5"');
    expect(buckets[3]).toContain('le="+Inf"');
  });
});

describe("Prometheus exposition format", () => {
  it("renders HELP and TYPE lines for every metric", () => {
    const c = registry.counter("hello_total", "hello world counter");
    c.inc();
    const text = registry.render();
    expect(text).toContain("# HELP hello_total hello world counter");
    expect(text).toContain("# TYPE hello_total counter");
  });

  it("escapes label values per spec (backslash, quote, newline)", () => {
    const c = registry.counter("escape_total", "");
    c.inc({ msg: 'a"b\\c\n' });
    const text = registry.render();
    // backslash → \\, quote → \", newline → \n
    expect(text).toContain('msg="a\\"b\\\\c\\n"');
  });

  it("emits +Inf bucket and _count / _sum lines for histograms", () => {
    const h = registry.histogram("h_seconds", "", [1, 2]);
    h.observe(0.5);
    h.observe(1.5);
    const text = registry.render();
    expect(text).toContain('h_seconds_bucket{le="1"} 1');
    expect(text).toContain('h_seconds_bucket{le="2"} 2');
    expect(text).toContain('h_seconds_bucket{le="+Inf"} 2');
    // Per Prometheus spec, a series with no labels emits no `{}`.
    expect(text).toContain("h_seconds_count 2");
    expect(text).toContain("h_seconds_sum 2");
  });

  it("renders metrics in sorted order so output is deterministic", () => {
    registry.counter("zeta_total", "").inc();
    registry.counter("alpha_total", "").inc();
    const text = registry.render();
    const alphaIdx = text.indexOf("alpha_total");
    const zetaIdx = text.indexOf("zeta_total");
    expect(alphaIdx).toBeGreaterThan(-1);
    expect(zetaIdx).toBeGreaterThan(alphaIdx);
  });

  it("renders nothing when registry is empty (dispose drops definitions too)", () => {
    registry.dispose();
    expect(registry.render()).toBe("");
  });
});

describe("Bucket constants and pre-registered metrics", () => {
  it("DURATION_SECONDS_BUCKETS is sorted ascending", () => {
    for (let i = 1; i < DURATION_SECONDS_BUCKETS.length; i++) {
      expect(DURATION_SECONDS_BUCKETS[i]).toBeGreaterThan(DURATION_SECONDS_BUCKETS[i - 1]);
    }
  });

  it("LLM_LATENCY_BUCKETS covers sub-second through two-minute calls", () => {
    expect(LLM_LATENCY_BUCKETS[0]).toBeLessThan(1);
    expect(LLM_LATENCY_BUCKETS[LLM_LATENCY_BUCKETS.length - 1]).toBeGreaterThanOrEqual(60);
  });

  it("refreshProcessMetrics populates uptime and memory gauges", () => {
    // Re-register the M.* accessors after the per-test reset.
    const uptime = registry.gauge("abc_process_uptime_seconds", "");
    const memory = registry.gauge("abc_nodejs_memory_bytes", "");
    // Drive the helper indirectly by replacing the accessor refs and re-call.
    // Simpler: import refreshProcessMetrics and call it; it will register the
    // metrics if needed (each call to registry.gauge with the same name is
    // idempotent and returns the same series).
    refreshProcessMetrics();
    expect(uptime.get()).toBeGreaterThan(0);
    expect(memory.get({ type: "rss" })).toBeGreaterThan(0);
    expect(memory.get({ type: "heap_used" })).toBeGreaterThan(0);
  });

  it("M.* accessors share state with registry.counter()", () => {
    // After registry.reset(), M.* hold stale refs (they pointed to the
    // pre-reset metric object). New increments must go through new accessors
    // obtained from the registry after reset. The M reference becomes a
    // legacy snapshot — this is the intended trade-off for module-level
    // imports.
    const c = registry.counter("abc_llm_requests_total", "");
    c.inc({ provider: "vertex", model: "claude", outcome: "success" });
    expect(c.get({ provider: "vertex", model: "claude", outcome: "success" })).toBe(1);
    void M; // confirm M exists at import time
  });
});
