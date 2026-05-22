/**
 * Prometheus-format metrics registry (zero-dependency).
 *
 * Exposes three primitive metric types — Counter, Gauge, Histogram — and a
 * single `render()` function that emits the Prometheus text exposition
 * format documented at:
 *   https://prometheus.io/docs/instrumenting/exposition_formats/
 *
 * Why hand-rolled instead of `prom-client`?
 *   - The dependency surface here is very deliberate (see `backend/package.json`
 *     vetted dependency list). A 200-line in-tree implementation removes one
 *     supply-chain link.
 *   - We only need the three primitive types, the basic exposition format,
 *     and label support — none of the advanced features (push, summary
 *     quantiles, default Node metrics).
 *
 * Concurrency / safety:
 *   - All state is plain JS Maps. Node is single-threaded, so increments are
 *     atomic. There is no lock or mutex needed.
 *   - Label values are sanitized so a malicious string can't break the
 *     exposition format. Backslashes and double-quotes are escaped; newlines
 *     are stripped.
 *
 * The registry is a singleton — every service imports `metrics` and calls
 * `.inc()`, `.set()`, `.observe()` on the named accessor. New metric names
 * declared at module-load time get registered automatically.
 */

import { logger } from "./logger.js";

// ============================================================================
// TYPES
// ============================================================================

export type Labels = Record<string, string | number>;

interface MetricBase {
  name: string;
  help: string;
  type: "counter" | "gauge" | "histogram";
}

interface CounterSeries {
  labels: Labels;
  value: number;
}

interface GaugeSeries {
  labels: Labels;
  value: number;
}

interface HistogramSeries {
  labels: Labels;
  buckets: Map<number, number>; // bucket-le → cumulative count
  count: number;
  sum: number;
}

interface CounterMetric extends MetricBase {
  type: "counter";
  series: Map<string, CounterSeries>;
}

interface GaugeMetric extends MetricBase {
  type: "gauge";
  series: Map<string, GaugeSeries>;
}

interface HistogramMetric extends MetricBase {
  type: "histogram";
  buckets: number[]; // upper bounds (le)
  series: Map<string, HistogramSeries>;
}

type Metric = CounterMetric | GaugeMetric | HistogramMetric;

// ============================================================================
// REGISTRY
// ============================================================================

class MetricsRegistry {
  private metrics = new Map<string, Metric>();

  /**
   * Register or fetch a counter. Counters monotonically increase; use for
   * counts of events (requests, errors, completions).
   */
  counter(name: string, help: string): CounterAccessor {
    const existing = this.metrics.get(name);
    if (existing) {
      if (existing.type !== "counter") {
        throw new Error(`metric "${name}" already registered as ${existing.type}`);
      }
      return new CounterAccessor(existing);
    }
    validateName(name);
    const m: CounterMetric = { name, help, type: "counter", series: new Map() };
    this.metrics.set(name, m);
    return new CounterAccessor(m);
  }

  /**
   * Register or fetch a gauge. Gauges go up and down — use for queue depth,
   * in-flight count, process memory.
   */
  gauge(name: string, help: string): GaugeAccessor {
    const existing = this.metrics.get(name);
    if (existing) {
      if (existing.type !== "gauge") {
        throw new Error(`metric "${name}" already registered as ${existing.type}`);
      }
      return new GaugeAccessor(existing);
    }
    validateName(name);
    const m: GaugeMetric = { name, help, type: "gauge", series: new Map() };
    this.metrics.set(name, m);
    return new GaugeAccessor(m);
  }

  /**
   * Register or fetch a histogram. Buckets are upper bounds (Prometheus `le`);
   * `+Inf` is added automatically.
   */
  histogram(name: string, help: string, buckets: number[]): HistogramAccessor {
    const existing = this.metrics.get(name);
    if (existing) {
      if (existing.type !== "histogram") {
        throw new Error(`metric "${name}" already registered as ${existing.type}`);
      }
      return new HistogramAccessor(existing);
    }
    validateName(name);
    const sorted = [...new Set(buckets)].sort((a, b) => a - b);
    if (sorted.length === 0) {
      throw new Error(`histogram "${name}" requires at least one bucket`);
    }
    const m: HistogramMetric = {
      name,
      help,
      type: "histogram",
      buckets: sorted,
      series: new Map(),
    };
    this.metrics.set(name, m);
    return new HistogramAccessor(m);
  }

  /**
   * Reset every metric's *series* (test-only). Keeps the metric definitions
   * so the pre-registered `M.*` accessors stay attached to the registry.
   * Use `dispose()` for a full wipe in tests that need to re-register from
   * scratch.
   */
  reset(): void {
    for (const m of this.metrics.values()) {
      m.series.clear();
    }
  }

  /** Drop every metric, including definitions. Test-only. */
  dispose(): void {
    this.metrics.clear();
  }

  /** Render the registry as Prometheus exposition text. */
  render(): string {
    const parts: string[] = [];
    const names = [...this.metrics.keys()].sort();
    for (const name of names) {
      const m = this.metrics.get(name)!;
      parts.push(`# HELP ${m.name} ${escapeHelp(m.help)}`);
      parts.push(`# TYPE ${m.name} ${m.type}`);
      switch (m.type) {
        case "counter":
        case "gauge":
          for (const series of m.series.values()) {
            parts.push(`${m.name}${formatLabels(series.labels)} ${formatValue(series.value)}`);
          }
          break;
        case "histogram":
          for (const series of m.series.values()) {
            for (const le of m.buckets) {
              const bucketCount = series.buckets.get(le) ?? 0;
              parts.push(
                `${m.name}_bucket${formatLabels({ ...series.labels, le: formatBucketLE(le) })} ${formatValue(bucketCount)}`,
              );
            }
            parts.push(
              `${m.name}_bucket${formatLabels({ ...series.labels, le: "+Inf" })} ${formatValue(series.count)}`,
            );
            parts.push(`${m.name}_count${formatLabels(series.labels)} ${formatValue(series.count)}`);
            parts.push(`${m.name}_sum${formatLabels(series.labels)} ${formatValue(series.sum)}`);
          }
          break;
      }
    }
    return parts.length === 0 ? "" : parts.join("\n") + "\n";
  }
}

// ============================================================================
// ACCESSORS
// ============================================================================

export class CounterAccessor {
  constructor(private readonly metric: CounterMetric) {}

  inc(labels: Labels = {}, delta = 1): void {
    if (delta < 0) {
      logger.warn(`counter "${this.metric.name}" inc called with negative delta`, { delta });
      return;
    }
    const key = seriesKey(labels);
    let series = this.metric.series.get(key);
    if (!series) {
      series = { labels: cloneLabels(labels), value: 0 };
      this.metric.series.set(key, series);
    }
    series.value += delta;
  }

  /** Snapshot for the given labelset (0 if not yet observed). */
  get(labels: Labels = {}): number {
    return this.metric.series.get(seriesKey(labels))?.value ?? 0;
  }
}

export class GaugeAccessor {
  constructor(private readonly metric: GaugeMetric) {}

  set(value: number, labels: Labels = {}): void {
    const key = seriesKey(labels);
    let series = this.metric.series.get(key);
    if (!series) {
      series = { labels: cloneLabels(labels), value: 0 };
      this.metric.series.set(key, series);
    }
    series.value = value;
  }

  inc(labels: Labels = {}, delta = 1): void {
    const key = seriesKey(labels);
    let series = this.metric.series.get(key);
    if (!series) {
      series = { labels: cloneLabels(labels), value: 0 };
      this.metric.series.set(key, series);
    }
    series.value += delta;
  }

  dec(labels: Labels = {}, delta = 1): void {
    this.inc(labels, -delta);
  }

  get(labels: Labels = {}): number {
    return this.metric.series.get(seriesKey(labels))?.value ?? 0;
  }
}

export class HistogramAccessor {
  constructor(private readonly metric: HistogramMetric) {}

  observe(value: number, labels: Labels = {}): void {
    if (!Number.isFinite(value)) {
      logger.warn(`histogram "${this.metric.name}" observe called with non-finite value`, { value });
      return;
    }
    const key = seriesKey(labels);
    let series = this.metric.series.get(key);
    if (!series) {
      series = {
        labels: cloneLabels(labels),
        buckets: new Map(this.metric.buckets.map((b) => [b, 0])),
        count: 0,
        sum: 0,
      };
      this.metric.series.set(key, series);
    }
    series.count += 1;
    series.sum += value;
    for (const le of this.metric.buckets) {
      if (value <= le) series.buckets.set(le, (series.buckets.get(le) ?? 0) + 1);
    }
  }

  /** Snapshot of {count, sum} for the given labelset. */
  snapshot(labels: Labels = {}): { count: number; sum: number } {
    const s = this.metric.series.get(seriesKey(labels));
    return { count: s?.count ?? 0, sum: s?.sum ?? 0 };
  }
}

// ============================================================================
// HELPERS
// ============================================================================

const METRIC_NAME_RE = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;
const LABEL_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function validateName(name: string): void {
  if (!METRIC_NAME_RE.test(name)) {
    throw new Error(`invalid metric name: "${name}" (must match ${METRIC_NAME_RE.source})`);
  }
}

function cloneLabels(labels: Labels): Labels {
  // Sort keys so two equivalent labelsets serialize identically.
  const out: Labels = {};
  for (const k of Object.keys(labels).sort()) {
    if (!LABEL_NAME_RE.test(k)) {
      throw new Error(`invalid label name: "${k}" (must match ${LABEL_NAME_RE.source})`);
    }
    out[k] = labels[k];
  }
  return out;
}

function seriesKey(labels: Labels): string {
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return "{}";
  return keys.map((k) => `${k}=${String(labels[k])}`).join(",");
}

function formatLabels(labels: Labels): string {
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return "";
  const pairs = keys.map((k) => `${k}="${escapeLabelValue(String(labels[k]))}"`);
  return `{${pairs.join(",")}}`;
}

function escapeLabelValue(value: string): string {
  // Per Prometheus spec: escape backslash, double-quote, newline.
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function escapeHelp(help: string): string {
  // HELP lines: escape backslash and newline only.
  return help.replace(/\\/g, "\\\\").replace(/\n/g, "\\n");
}

function formatValue(value: number): string {
  if (Number.isNaN(value)) return "NaN";
  if (!Number.isFinite(value)) return value > 0 ? "+Inf" : "-Inf";
  return value.toString();
}

function formatBucketLE(le: number): string {
  // Prometheus convention: integer buckets render without decimals;
  // floats render as compact decimals.
  return Number.isInteger(le) ? le.toString() : le.toString();
}

// ============================================================================
// SINGLETON
// ============================================================================

export const registry: MetricsRegistry = new MetricsRegistry();

/**
 * Common bucket sets, exported so call sites stay consistent.
 *
 * - `DURATION_SECONDS_BUCKETS`: typical HTTP / outbound call latency buckets,
 *   in seconds.
 * - `LLM_LATENCY_BUCKETS`: tuned for LLM calls — fastest token at ~100ms,
 *   slowest at ~120s.
 */
export const DURATION_SECONDS_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
];

export const LLM_LATENCY_BUCKETS = [
  0.1, 0.5, 1, 2.5, 5, 10, 30, 60, 120,
];

// ============================================================================
// PRE-REGISTERED METRICS (so accessors can be imported as constants)
// ============================================================================

export const M = {
  llmRequests: registry.counter(
    "abc_llm_requests_total",
    "Total LLM provider requests, by provider/model/outcome (success|error|throttled).",
  ),
  llmDuration: registry.histogram(
    "abc_llm_request_duration_seconds",
    "LLM provider request latency in seconds, by provider/model.",
    LLM_LATENCY_BUCKETS,
  ),
  llmTokens: registry.counter(
    "abc_llm_tokens_total",
    "Total tokens consumed, by provider/model and direction (prompt|completion).",
  ),
  llmInflight: registry.gauge(
    "abc_llm_inflight",
    "Current in-flight LLM requests, by provider.",
  ),
  toolCalls: registry.counter(
    "abc_tool_calls_total",
    "Total tool dispatcher calls, by tool name and outcome (success|error).",
  ),
  toolDuration: registry.histogram(
    "abc_tool_duration_seconds",
    "Tool handler latency in seconds, by tool name.",
    DURATION_SECONDS_BUCKETS,
  ),
  agentSessions: registry.counter(
    "abc_agent_sessions_total",
    "Free Agent session lifecycle events, by status (started|completed|error|stopped|iteration_limit|needs_assistance).",
  ),
  agentIterations: registry.counter(
    "abc_agent_iterations_total",
    "Free Agent iteration lifecycle events, by status (started|completed|error|loop_intervention|pii_blocked).",
  ),
  workflowExecutions: registry.counter(
    "abc_workflow_executions_total",
    "Workflow executions, by terminal status (completed|error|aborted).",
  ),
  workflowStages: registry.counter(
    "abc_workflow_stages_total",
    "Workflow stages, by node kind and status (completed|error|skipped).",
  ),
  retentionDeletes: registry.counter(
    "abc_retention_deletes_total",
    "Rows deleted by the retention scheduler, by table name.",
  ),
  processUptime: registry.gauge(
    "abc_process_uptime_seconds",
    "Process uptime in seconds (refreshed at scrape time).",
  ),
  processMemory: registry.gauge(
    "abc_nodejs_memory_bytes",
    "Resident set / heap / external memory in bytes (refreshed at scrape time).",
  ),
};

/**
 * Update the process-info gauges (uptime, memory) just before rendering.
 * Called by the metrics route handler so the values reflect scrape time.
 *
 * Re-fetches the gauges from the registry by name on each call so the helper
 * keeps working after `registry.dispose()` (test-only path).
 */
export function refreshProcessMetrics(): void {
  const uptime = registry.gauge(
    "abc_process_uptime_seconds",
    "Process uptime in seconds (refreshed at scrape time).",
  );
  const memory = registry.gauge(
    "abc_nodejs_memory_bytes",
    "Resident set / heap / external memory in bytes (refreshed at scrape time).",
  );
  uptime.set(process.uptime());
  const mem = process.memoryUsage();
  memory.set(mem.rss, { type: "rss" });
  memory.set(mem.heapTotal, { type: "heap_total" });
  memory.set(mem.heapUsed, { type: "heap_used" });
  memory.set(mem.external, { type: "external" });
}
