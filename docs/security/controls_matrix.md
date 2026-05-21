# Security Controls Matrix

This matrix maps each implemented control to the **GoA Information Security Categorization Standard** dimensions (Confidentiality / Integrity / Availability / Privacy) and identifies the specific file in this codebase that delivers it. Together with the threat model and PIA, this matrix forms the ATO control evidence.

## Categorization summary

| Dimension | Maximum data classification handled | Notes |
|---|---|---|
| Confidentiality | Protected B | Personal health info, ministry-scoped business data. Vertex AI Canadian residency enforced. |
| Integrity | High | Audit log immutable at app layer; database transactions; parameterized SQL. |
| Availability | Medium | Single-region deployment; tolerable downtime < 4 h business hours. |
| Privacy | High | FOIP s.33 lawful authority; PIA covers all data elements. |

## Control table

| ID | Category | Control | Implementation file | Verification |
|---|---|---|---|---|
| **AC-01** | Confidentiality | Authentication of all API consumers | `backend/src/middleware/auth.ts:authenticate` | All routes except `/api/health` require an `Authorization: Bearer` header. Verified by `curl -s /api/agent/sessions` → 401 without token. |
| **AC-02** | Confidentiality | Role-based access control | `backend/src/middleware/auth.ts:requireRole` | Admin endpoints + `/api/health/detailed` reject non-admin users with 403. Verified by `curl` with a `viewer` mock. |
| **AC-03** | Confidentiality | Ministry-scoped data segmentation | `backend/src/middleware/auth.ts:requireMinistry`, ministry extraction in `extractMinistry` | All session/workflow queries scope by `ministryCode` derived from Entra ID group claims. |
| **AC-04** | Privacy | PII detection before LLM egress | `backend/src/services/piiDetector.ts:scanForPII` | Called at every prompt entry point in `routes/agent.ts`. Blocked counts return 422 and never reach the LLM. Luhn-validated for SIN/AHCN/credit card. |
| **AC-05** | Confidentiality | Data classification routing | `backend/src/services/llmProvider.ts:validateModelClassification` | `model_registry.max_classification` enforces Canadian-residency models for Protected B. Verified by attempting `protected_b` session on a `us`-residency model → 400. |
| **AU-01** | Integrity | Immutable audit trail | `backend/src/services/auditLogger.ts:logAudit` | Every state change writes to `audit_log`. App-layer code never UPDATEs or DELETEs from the table. Retention job anonymizes rather than deletes. |
| **AU-02** | Integrity | Admin-action attribution | `backend/src/routes/admin.ts:auditAdminAccess` (middleware) | Every admin route writes an `ADMIN_ACCESS` audit entry before the handler runs. `AuditAction` enum centralizes naming. |
| **AU-03** | Integrity | Security-event audit | `backend/src/services/auditLogger.ts:auditSecurityEvent` | Rate-limit hits, invalid requests, blocked IPs all logged. Surfaced via `getSecurityEvents()`. |
| **CR-01** | Confidentiality | Secrets at rest | `backend/src/services/secretsVault.ts` | `user_secrets.encrypted_value` is `pgp_sym_encrypt`-encrypted with `SECRETS_VAULT_KEY`. Backups contain only ciphertext. |
| **CR-02** | Confidentiality | Symmetric key management | `backend/src/config/env.ts` (`SECRETS_VAULT_KEY: z.string().min(32)`) | Minimum 32 bytes validated at boot. SHA-256 fingerprint logged via `logVaultFingerprint()`. Rotation procedure in `docs/operations/key_rotation.md`. |
| **CR-03** | Confidentiality | TLS in transit | `backend/src/config/database.ts` (`sslmode=require`), Helmet HSTS in `index.ts` | DB connection enforced TLS. Outbound to LLM provider uses HTTPS only. Helmet adds `Strict-Transport-Security` to responses. |
| **IN-01** | Integrity | Parameterized SQL | `backend/src/config/database.ts:query` | All callers use the typed `query<T>(text, params)` helper. No string interpolation of user input. |
| **IN-02** | Integrity | Input validation | `backend/src/middleware/requestValidation.ts`, zod schemas in routes | Path traversal, null bytes, SQLi keywords, XSS patterns blocked at the edge. Per-route Zod validation in `admin.ts`. |
| **IN-03** | Integrity | Body size limits | `backend/src/index.ts` (`express.json({ limit: "5mb" })`) | Requests > 5 MB rejected (413). URL-encoded > 1 MB rejected. |
| **AV-01** | Availability | Rate limiting | `backend/src/middleware/agentRateLimit.ts`, global limiter in `index.ts` | 500 req / 15 min globally, plus per-endpoint buckets for LLM-touching routes. |
| **AV-02** | Availability | LLM retry with backoff | `backend/src/services/llmProvider.ts:withRetry` | Exponential backoff on 429/5xx. Capped delays. Streams retry less aggressively. |
| **AV-03** | Availability | DB pool health monitoring | `backend/src/config/database.ts:getPoolStats` | Surfaced via `/api/health/detailed`. Slow-query log (>1 s) wired to `logger.slowQuery`. |
| **AV-04** | Availability | Loop detection | `backend/src/services/loopDetector.ts` | Halts agents stuck in identical iterations or tool-call patterns. |
| **PR-01** | Privacy | Lawful authority documented | `docs/privacy/pia.md` | FOIP s.33 / s.40 referenced. PIA reviewed before each release. |
| **PR-02** | Privacy | Retention by classification | `backend/src/services/retentionJob.ts` + `cohen_mcleod.retention_policy` | Hard-delete `agent_sessions`/`artifacts` beyond classification window; anonymize `audit_log`/`pii_detections` beyond 7 years (Protected B max). Manual trigger via `POST /api/admin/retention/run`. |
| **PR-03** | Privacy | PII forensic visibility | `backend/src/services/piiDetector.ts:logDetections` + admin UI `PIIDetectionViewer.vue` | Truncated matches (4 chars + ***) stored in `pii_detections`. Admin can review without seeing raw values. |
| **PR-04** | Privacy | Third-party data flow controls | `backend/src/services/llmProvider.ts` + `model_registry.data_residency` | Vertex AI pinned to `northamerica-northeast1`. Protected B traffic forbidden on US-residency models. Tool egress allow-lists per tool. |
| **PR-05** | Privacy | Subject access (right to know) | `backend/src/services/auditLogger.ts:getUserActivity` | Audit history queryable per user. Admin UI exposes `GET /api/admin/audit?user_id=...`. |
| **PR-06** | Privacy | Truncation of PII in logs | `backend/src/services/piiDetector.ts` (`match.substring(0, 4) + "***"`) | Raw matches never leave the detector. Verified by inspecting `pii_detections.context_snippet` rows. |
| **NW-01** | Confidentiality | SSRF prevention | `backend/src/middleware/requestValidation.ts` private-IP guard; tool-level allow-lists | `web_scrape`, `api_proxy` reject `10.*`, `172.16-31.*`, `192.168.*`, `127.*`, `0.0.0.0`, `169.254.*`. |
| **NW-02** | Confidentiality | CORS scoped to frontend | `backend/src/index.ts` (`cors({ origin: env.FRONTEND_URL })`) | Production CORS restricts origin to deployed frontend. Dev mode is permissive (no shared resources accessed). |
| **NW-03** | Integrity | Security headers | Helmet in `backend/src/index.ts` | CSP restricts script sources, HSTS, X-Frame-Options, X-Content-Type-Options. |
| **MO-01** | Availability | Observability | `backend/src/routes/health.ts` `/api/health` (public) + `/api/health/detailed` (admin) | Pool stats, token usage, memory, uptime exposed. Polled by admin UI every 30 s. |

## Mapping to GoA Security Categorization

| GoA category | Controls in this matrix |
|---|---|
| **Confidentiality** | AC-01..05, CR-01..03, IN-01, NW-01..03 |
| **Integrity** | AU-01..03, IN-01..03, NW-03 |
| **Availability** | AV-01..04, MO-01 |
| **Privacy** | PR-01..06, AC-04 (PII detection) |

## Operational verification cadence

| Control | Cadence | Owner |
|---|---|---|
| Audit trail completeness | Continuous (every request) | App |
| PII detector coverage | Per release — manual regression with the 11-pattern fixture suite | Stream F |
| Retention policy | Daily (automated) + monthly review of `retention_policy` rows | Ops |
| Key rotation | Annual + on suspected compromise | Ops + Stream F |
| Health diagnostics | Continuous (30-s poll) + alerting | Ops |
| RBAC scoping | Quarterly access review | Cohen McLeod |
