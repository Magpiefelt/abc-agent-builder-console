# Observability Plan

This document describes how to monitor the ABC Agent Builder Console in production: log streams, metrics, alerting candidates, and the manual SQL queries we rely on until full GoA-standard monitoring is wired up.

## Log streams

| Stream | Where | Format |
|---|---|---|
| Application logs | stdout/stderr of the backend process | Structured JSON via `backend/src/services/logger.ts` |
| Audit log | `cohen_mcleod.audit_log` table | Rows; queryable |
| PII detection log | `cohen_mcleod.pii_detections` table | Rows; queryable |
| Slow query log | Application logs, `logger.slowQuery` | JSON line with query, durationMs |
| Render platform logs | Render dashboard | Captured for retention per Render's policy |

### Logger levels

`logger.debug` — verbose runtime, suppressed in production by default
`logger.info` — startup, completions, key rotations
`logger.warn` — recoverable degradation (LLM 429, missing optional key)
`logger.error` — exceptions, with err stack in dev; redacted in production global error handler
`logger.business` — semantic event (audit log mirror)

### Output format (Backlog O4)

The logger has two output modes, configurable via `LOG_FORMAT`:

| `LOG_FORMAT` | Output | When to use |
|---|---|---|
| `json` *(production default)* | One NDJSON object per line on stdout. Ready for Vector / Fluent Bit / Promtail to ship to Loki / ELK. | Production, CI |
| `pretty` *(development default)* | Colourised single-line human-readable format with the message, key=value context pairs, and any error stack on a trailing line. | Local development |

The default is derived from `NODE_ENV` (`production` → `json`, anything else → `pretty`) so a Render or Nexus deploy ships JSON without configuration. Set the env var explicitly to override.

Three additional env vars tune the logger:

| Env | Default | Notes |
|---|---|---|
| `LOG_LEVEL` | `info` in prod, `debug` elsewhere | One of `debug` / `info` / `warn` / `error`. Entries below this are dropped at the logger and never paid for. |
| `LOG_SERVICE_NAME` | `abc-backend` | Static label on every JSON entry. Distinguishes ABC backend lines from other GoA services that share the same aggregator. |
| `LOG_FORMAT` | derived from `NODE_ENV` | `json` or `pretty`. |

#### NDJSON line schema

The JSON output is a stable contract — log-aggregator parsers can rely on these fields:

```json
{
  "timestamp": "2026-05-22T19:31:04.512Z",
  "level":     "INFO",
  "severity":  "info",
  "service":   "abc-backend",
  "message":   "API response",
  "method":    "POST",
  "path":      "/api/agent/sessions",
  "statusCode": 201,
  "durationMs": 42
}
```

| Field | Type | Purpose |
|---|---|---|
| `timestamp` | ISO 8601 UTC | When the entry was emitted |
| `level` | `DEBUG` / `INFO` / `WARN` / `ERROR` | Stable level label (legacy schema) |
| `severity` | `debug` / `info` / `warning` / `error` | Loki / Grafana convention; drives line colour |
| `service` | string | Matches `LOG_SERVICE_NAME` |
| `message` | string | Human-readable summary |
| `error` | `{name, message, stack?}` | Present when `logger.error` was called with an `Error`. `stack` is omitted in production. |
| any other key | mixed | Free-form context (sessionId, workflowId, durationMs, etc.) |

Errors are serialised into a structured sub-object rather than concatenated into `message`, so a Grafana panel like `count by (error.name)` works without a regex parse.

#### Vector sidecar example

A minimal `vector.toml` for shipping ABC stdout to Loki:

```toml
[sources.abc_stdout]
type = "stdin"

[transforms.parse_json]
type = "remap"
inputs = ["abc_stdout"]
source = '''
  parsed, err = parse_json(.message)
  if err == null {
    . = parsed
  }
'''

[sinks.loki]
type = "loki"
inputs = ["parse_json"]
endpoint = "https://loki.gov.ab.ca"
encoding.codec = "json"
labels = { service = "{{ service }}", severity = "{{ severity }}" }
```

The same JSON shape works with Promtail (`pipeline_stages.json.expressions: { level: level, service: service }`) and Fluent Bit (`Parser json`) — there's nothing ABC-specific in the schema. The `severity` label gives Loki a colourised line out of the box; the `service` label keeps multi-tenant clusters legible.

#### Local pretty-mode example

```
19:31:04.512 INFO  API response | method=POST path=/api/agent/sessions statusCode=201 durationMs=42
19:31:04.530 ERROR dispatch failed | tool=web_search error=Connection refused
Error: Connection refused
    at fetch (...)
    at dispatchToolCalls (.../toolDispatcher.ts:142:7)
```

The time prefix (without the date) keeps the line short; the date is recoverable from the surrounding terminal context. Stack traces follow on subsequent lines so the primary log line remains greppable.

## Health probes

Four health endpoints serve different operational concerns. **Use the right
one** when configuring probes in Render / Nexus / Kubernetes — confusing
liveness with readiness is the most common production misconfiguration we
see.

| Endpoint | Purpose | Auth | Status codes | What probes should do on failure |
|---|---|---|---|---|
| `GET /api/health` | Public load-balancer health summary (DB-aware) | None | 200 healthy · 503 degraded | Drain instance from rotation |
| `GET /api/health/live` | Kubernetes liveness probe — "is the process responsive?" | None | 200 alive (always) | Restart container if it fails for > 30 s |
| `GET /api/health/ready` | Kubernetes readiness probe — "ready to serve traffic?" | None | 200 ready · 503 not_ready | Drain instance until it returns 200 |
| `GET /api/health/detailed` | Full operational diagnostics | Admin | 200 healthy · 503 degraded | Surface in admin UI; do not page on this |

The split between liveness and readiness matters: when the DB is briefly
unreachable, **only `/ready` should fail**. If `/live` returned 503 in that
window the orchestrator would restart the container, which both makes the
DB-outage symptoms worse and slows recovery once the DB comes back. The
liveness endpoint deliberately never touches the database for that reason.

For Nexus deploys, configure:

```yaml
livenessProbe:
  httpGet: { path: /api/health/live, port: 3000 }
  initialDelaySeconds: 10
  periodSeconds: 10
  failureThreshold: 3
readinessProbe:
  httpGet: { path: /api/health/ready, port: 3000 }
  initialDelaySeconds: 5
  periodSeconds: 5
  failureThreshold: 2
```

## Metrics surfaced today

`/api/health/detailed` (admin) returns:

| Metric | Source | Units |
|---|---|---|
| `uptimeSeconds` | `process.uptime()` | seconds |
| `memory.rssMb` / `heapUsedMb` / `heapTotalMb` / `externalMb` | `process.memoryUsage()` | MB |
| `pool.totalCount` / `idleCount` / `waitingCount` | `pg.Pool` instance | connections |
| `pool.queryCount` / `slowQueryCount` / `errorCount` | tracked in `config/database.ts` | counters since boot |
| `tokens.totalPromptTokens` / `totalCompletionTokens` / `callCount` | `getTokenUsageStats()` | rolling 60-min window |
| `services.*` | env presence checks | configured / not_configured / connected / disconnected |
| `retention.enabled` / `retention.hour` | env | boolean / 0–23 |

The Health Diagnostics tab in the admin UI polls this endpoint every 30 seconds.

## Prometheus metrics endpoint

`GET /api/metrics` exposes the running instance in Prometheus text exposition
format (version `0.0.4`). The endpoint is **admin-gated** because the label
dimensions (provider names, model names, error rates, ministry-level activity
counts) carry operational signal we don't want indexed by accident.

When scraping from inside the GoA network, configure your Prometheus instance
with an admin bearer token:

```yaml
scrape_configs:
  - job_name: abc
    metrics_path: /api/metrics
    scheme: https
    bearer_token_file: /etc/prometheus/abc-admin-token
    static_configs:
      - targets:
          - abc.example.gov.ab.ca
```

A development scrape uses the dev mock identity:

```bash
curl -s "$BASE/api/metrics" -H 'Authorization: Bearer dev'
```

### Metric inventory

| Name | Type | Labels | Source |
|---|---|---|---|
| `abc_llm_requests_total` | Counter | `provider`, `model`, `outcome` (`success`/`error`/`throttled`) | `services/llmProvider.ts` |
| `abc_llm_request_duration_seconds` | Histogram | `provider`, `model` | `services/llmProvider.ts` |
| `abc_llm_tokens_total` | Counter | `provider`, `model`, `type` (`prompt`/`completion`) | `services/llmProvider.ts` |
| `abc_llm_inflight` | Gauge | `provider` | `services/llmProvider.ts` |
| `abc_tool_calls_total` | Counter | `tool`, `outcome` (`success`/`error`) | `services/toolDispatcher.ts` |
| `abc_tool_duration_seconds` | Histogram | `tool` | `services/toolDispatcher.ts` |
| `abc_agent_sessions_total` | Counter | `status` (`started`/`completed`/`error`/`paused`/`needs_assistance`) | `services/agentOrchestrator.ts` |
| `abc_agent_iterations_total` | Counter | `status` (`started`/`completed`/`error`/`loop_intervention`) | `services/agentOrchestrator.ts` |
| `abc_workflow_executions_total` | Counter | `status` (`completed`/`error`/`aborted`) | `services/workflowExecutor.ts` |
| `abc_workflow_stages_total` | Counter | `kind` (`agent`/`function`/`tool`/`note`), `status` | `services/workflowExecutor.ts` |
| `abc_retention_deletes_total` | Counter | `table` | `services/retentionJob.ts` |
| `abc_process_uptime_seconds` | Gauge | — | `process.uptime()` (refreshed per scrape) |
| `abc_nodejs_memory_bytes` | Gauge | `type` (`rss`/`heap_total`/`heap_used`/`external`) | `process.memoryUsage()` (refreshed per scrape) |

### Per-provider isolation

LLM calls run through per-provider semaphores (see `ProviderSemaphore` in
`services/llmProvider.ts`). A back-off retry on one provider does not block
in-flight calls against any other provider. The `abc_llm_inflight` gauge can
verify this in production — sustained `provider="vertex_ai"` saturation while
`provider="google"` stays low is the signature of an isolated Vertex AI
throttle event.

### Recommended Grafana panels

| Panel | Query |
|---|---|
| LLM error rate by provider | `sum by (provider) (rate(abc_llm_requests_total{outcome="error"}[5m]))` |
| LLM p95 latency by model | `histogram_quantile(0.95, sum by (le, model) (rate(abc_llm_request_duration_seconds_bucket[5m])))` |
| Token spend per hour | `sum by (model) (increase(abc_llm_tokens_total[1h]))` |
| Tool dispatch success rate | `1 - (rate(abc_tool_calls_total{outcome="error"}[5m]) / rate(abc_tool_calls_total[5m]))` |
| Retention deletes per pass | `increase(abc_retention_deletes_total[24h])` |
| Active agent sessions | `sum(abc_agent_sessions_total{status="started"}) - sum(abc_agent_sessions_total{status=~"completed|error"})` |

## Recommended alerts (when GoA monitoring lands)

| Alert | Trigger | Severity |
|---|---|---|
| `/api/health/ready` returns non-2xx for > 60 s | HTTP probe | SEV-2 (instance not serving traffic) |
| `/api/health/live` returns non-2xx for > 30 s | HTTP probe | SEV-1 (process unresponsive — automatic restart) |
| `/api/health` returns non-2xx for > 60 s | HTTP probe | SEV-2 |
| `pool.errorCount` increasing > 10/min | metric scrape | SEV-3 |
| `tokens.callCount` > 1000/hour | metric scrape | SEV-3 (cost) |
| `audit_log` `action = security.rate_limited` > 50/hour from one IP | DB query | SEV-3 |
| `audit_log` `action = pii.blocked.prompt` > 100/hour overall | DB query | SEV-3 (training opportunity, not necessarily incident) |
| Backend memory.rssMb > 800 sustained | metric scrape | SEV-3 |
| `audit_log` count not increasing in 10 min of business hours | DB query | SEV-2 (audit pipeline broken) |

## Manual queries

### Recent activity by user

```sql
SELECT created_at, action, resource_type, resource_id
FROM cohen_mcleod.audit_log
WHERE user_id = $1
ORDER BY created_at DESC
LIMIT 100;
```

### Top recent PII detection types

```sql
SELECT detection_type, COUNT(*) AS hits
FROM cohen_mcleod.pii_detections
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY detection_type
ORDER BY hits DESC;
```

### Sessions in flight

```sql
SELECT id, user_id, status, current_iteration, max_iterations, created_at
FROM cohen_mcleod.agent_sessions
WHERE status = 'running'
ORDER BY created_at;
```

### Retention pass history

```sql
SELECT created_at, details
FROM cohen_mcleod.audit_log
WHERE action = 'admin.retention.run'
ORDER BY created_at DESC
LIMIT 30;
```

## Dashboards to build (backlog)

When a GoA-standard observability stack is available (e.g. Grafana via Render or Nexus):

1. **Live traffic** — RPS by endpoint, error rate, p50/p95 latency
2. **LLM cost** — token usage per hour stacked by model
3. **Audit volume** — actions per category per hour (auth, agent, admin, security)
4. **Retention** — rows affected per pass, segmented by table
5. **PII** — detection rate by type; trend over weeks
6. **Pool** — connections in use vs idle; slow queries per hour

Until then, the admin UI's Health Diagnostics tab + the SQL snippets above are the operational interface.

## Smoke check (post-deploy)

Run after every deployment:

```bash
# Public health
curl -s "$BASE/api/health" | jq '.status'                       # → "healthy"
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/api/health"     # → 200

# Liveness probe — always 200, even when the DB is down
curl -s "$BASE/api/health/live" | jq '.status'                  # → "alive"

# Readiness probe — 200 only when the DB is reachable
curl -s "$BASE/api/health/ready" | jq '.status'                 # → "ready" (or "not_ready" + reason)

# Auth-gated me (with dev mock — production needs a real Bearer)
curl -s "$BASE/api/me" -H 'Authorization: Bearer dev' | jq '.user.role'  # → "admin" (dev) / actual role (prod)

# Detailed health (admin)
curl -s "$BASE/api/health/detailed" -H 'Authorization: Bearer dev' | jq '.services'

# Admin audit access creates its own audit row — verify
curl -s "$BASE/api/admin/audit?limit=5" -H 'Authorization: Bearer dev' | jq '.count'
```

A clean smoke run hits all three layers (auth, admin, DB) without errors.
