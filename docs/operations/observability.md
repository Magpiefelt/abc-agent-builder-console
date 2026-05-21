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

## Recommended alerts (when GoA monitoring lands)

| Alert | Trigger | Severity |
|---|---|---|
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

# Auth-gated me (with dev mock — production needs a real Bearer)
curl -s "$BASE/api/me" -H 'Authorization: Bearer dev' | jq '.user.role'  # → "admin" (dev) / actual role (prod)

# Detailed health (admin)
curl -s "$BASE/api/health/detailed" -H 'Authorization: Bearer dev' | jq '.services'

# Admin audit access creates its own audit row — verify
curl -s "$BASE/api/admin/audit?limit=5" -H 'Authorization: Bearer dev' | jq '.count'
```

A clean smoke run hits all three layers (auth, admin, DB) without errors.
