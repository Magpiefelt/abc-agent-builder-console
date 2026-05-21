# Privacy Impact Assessment

**Initiative:** ABC Agent Builder Console
**Public body:** Government of Alberta
**Privacy Officer (proposed reviewer):** Cohen McLeod (cohen.mcleod@gov.ab.ca)
**Lawful authority:** FOIP s.33 (collection), s.39 (use), s.40 (disclosure)
**Document version:** 1.0 — Stream F initial
**Status:** Draft for review

---

## 1. Initiative summary

The ABC Agent Builder Console is an internal-only web application that lets GoA staff (a) compose ad-hoc agentic tasks against an approved LLM model registry ("Free Agent") and (b) build, save, and execute multi-step workflow graphs ("Workflow Canvas"). All orchestration occurs server-side; the frontend is a thin presentation layer.

The system handles **Unclassified**, **Protected A**, and **Protected B** information at the user's declaration, with classification-aware model routing and data retention.

## 2. Data elements

| Element | Source | Classification | Stored where | Retention |
|---|---|---|---|---|
| Entra ID user claims (`oid`, `email`, `displayName`, `groups`) | Microsoft Entra ID via OIDC | Protected A | `cohen_mcleod.users` | While employed + audit retention |
| Ministry derived from `AIM-G-{MINISTRY}-ALL_…` group | Computed from claims | Protected A | `cohen_mcleod.users.ministry_code` | Same as user record |
| Agent prompts (user input) | User typing | Up to Protected B (declared) | `cohen_mcleod.agent_sessions.prompt` | Per `retention_policy` |
| Blackboard / scratchpad / attributes | Generated during agent run | Inherits session classification | `cohen_mcleod.agent_sessions` | Per `retention_policy` |
| Iteration records (LLM responses, tool calls) | LLM + tools | Inherits | `cohen_mcleod.agent_iterations` | Per `retention_policy` |
| Generated artifacts (text, images, audio) | LLM | Inherits | `cohen_mcleod.artifacts` | Per `retention_policy` |
| Workflow definitions | User | Up to Protected B | `cohen_mcleod.workflows` | While owner active + 3 y |
| Audit log entries | App middleware | Internal | `cohen_mcleod.audit_log` | Anonymized at 7 y (Protected B audit window) |
| PII detections | `piiDetector.ts` | Internal (truncated, never raw) | `cohen_mcleod.pii_detections` | Anonymized at 7 y |
| User secrets (tool API tokens) | User explicit submission | Protected B | `cohen_mcleod.user_secrets` (pgcrypto-encrypted) | Until user deletes or deactivates |
| LLM token usage telemetry | `getTokenUsageStats` | Aggregated metrics only | In-memory ring buffer (60 min) | 60-minute window |

## 3. Collection

### Lawful authority

- **Direct collection from individual:** prompts, workflow content, secrets — collected from the employee themselves while performing GoA business. Authorized under FOIP s.33(c) (collection for an operating program).
- **Indirect collection:** Entra ID claims are received from the IdP, not the employee directly. Authorized as the Entra ID service is operated by the public body for its own administrative purposes (FOIP s.33(a)).

### Notice
A privacy notice is displayed on first login (TODO — Stream A) describing what is collected, why, and how to access or correct one's record.

## 4. Use

| Use | Justification |
|---|---|
| Routing the user's prompt to an approved LLM | Core service delivery |
| Persisting session state to allow continuation, audit, and review | Operational continuity + accountability |
| Logging audit events | Security incident response, internal accountability |
| Logging PII detections (truncated) | Forensic analysis of attempted disclosures |
| Storing per-user tool credentials | Allowing tools to act as the user against external services with explicit consent |

All uses fall within FOIP s.39 (use consistent with the purpose for which collected).

## 5. Storage

- **Database:** PostgreSQL on Render shared instance, schema `cohen_mcleod`. TLS in transit (`sslmode=require`).
- **Region:** TBD pending Nexus deployment; assumed Canadian-only.
- **Encryption at rest:** Render-managed disk encryption for the DB. **Per-user secrets are additionally encrypted at the application layer** via pgcrypto + `SECRETS_VAULT_KEY` so that database backups never expose plaintext credentials.

## 6. Processing & disclosure (third parties)

| Third party | What they receive | Classification limit | Residency | Lawful basis |
|---|---|---|---|---|
| **Microsoft Entra ID** (Microsoft) | Authentication assertions only — no business data | n/a | Microsoft 365 tenant region (GoA-controlled) | Existing GoA Microsoft licensing |
| **Vertex AI** (Google Cloud) | Prompts and tool outputs as sent to Claude / Gemini | Up to Protected B *(Claude only — pinned to `northamerica-northeast1`)* | Canada (Claude). US (Gemini, Unclassified-only) | GoA Vertex AI agreement |
| **Anthropic** (direct API fallback) | Same as Vertex AI Claude | Up to Protected A | US | Discouraged; use Vertex AI Claude for Protected B |
| **Brave Search** | Search queries (no user data) | Unclassified only | US | Public web search — query may carry intent inferable from text; users instructed not to include PII in queries |
| **Google Custom Search** | Search queries | Unclassified only | US | Same as Brave |
| **GitHub** | Repository paths + optional user token | Unclassified | US | Optional tool; user-provided token |
| **ElevenLabs (TTS)** | Text-to-speech input | Up to Protected A | US | Stream D forthcoming |
| **Ent Tools** (GoA `ent-tools.sandbox.aim.int.gov.ab.ca`) | Whatever the chosen tool requires | As tool dictates | Canada | Internal GoA service |

Disclosure to these processors is authorized under FOIP s.40(1)(c) (disclosure within the public body for purposes consistent with the collection) and processor agreements.

## 7. Security safeguards

See `docs/security/threat_model_stride.md` and `docs/security/controls_matrix.md` for the full control set. Key safeguards relevant to privacy:

- **PII scanner** (`piiDetector.ts`) blocks SIN, Alberta PHN/AHCN, credit cards, JWTs, AWS keys, OpenAI/Anthropic/Google keys, bearer tokens, passport numbers from leaving the perimeter. Luhn-validated for numeric identifiers. Truncated to 4 chars + `***` when persisted.
- **Classification routing** (`validateModelClassification`) prevents Protected B prompts from reaching US-residency models.
- **Audit log** (`auditLogger.ts`) records every privileged operation with attribution.
- **Encryption at rest** (`secretsVault.ts`) for per-user secrets.
- **Retention enforcement** (`retentionJob.ts`) deletes session data beyond classification windows; anonymizes audit/PII rows beyond 7 years.

## 8. Individual rights

- **Right of access:** Admin can produce a per-user audit report via `GET /api/admin/audit?user_id=…`. A self-service endpoint is a future enhancement.
- **Right to correct:** User-supplied secrets and workflows are user-editable via the app. Audit log entries are immutable but include the original request body — correction requests trigger a counter-entry rather than mutation.
- **Right to know:** This PIA, the threat model, and the retention schedule are linked from the deployment README.
- **Right to complain:** OIPC Alberta contact information is included on the login screen (TODO — Stream A).

## 9. Retention & disposal

See `docs/privacy/retention_schedule.md`. Hybrid strategy:

- **Hard-delete** for `agent_sessions`, `agent_iterations`, `artifacts` past the classification retention window (90 d / 1 y / 3 y).
- **Anonymize** for `audit_log` and `pii_detections` past the longest audit window (7 y, Protected B), retaining row skeletons for compliance counting.

## 10. Residual risks

| Risk | Likelihood | Impact | Mitigation | Residual |
|---|---|---|---|---|
| `SECRETS_VAULT_KEY` lives in env alongside DB credentials. A compromised env exposes both. | Low | High | 32-byte minimum at boot; SHA-256 fingerprint logged; documented annual rotation; Render secret panel scoped per-deploy. KMS integration is future work. | **Accepted** with mitigation. |
| Prompt-injection causes the model to leak data the user already had access to but did not intend to share. | Medium | Low | System prompt instructs the model to treat tool output as untrusted; audit captures every iteration; users review blackboard before completing. | **Accepted**. |
| Dev-mock admin user usable in production if `NODE_ENV` is misconfigured. | Low | Critical | Deployment runbook smoke check verifies `/api/health` reports `environment: production`. | **Accepted** with operational guard. |
| Audit log can be mutated by the app DB role. | Low | Medium | Operational item: split DB roles so the app uses an INSERT-only role for `audit_log` and `pii_detections`. | **Open** — see backlog. |
| Tool egress could exfiltrate to attacker-controlled endpoints. | Low | Medium | Per-tool allow-lists; private IP blocking; PII scan on returning content. Adversarial allow-list bypass is conceivable but limited in blast radius. | **Accepted**. |

## 11. Sign-off

| Role | Name | Date |
|---|---|---|
| Initiative lead | Cohen McLeod | TBD |
| Privacy officer | TBD | TBD |
| Security officer | TBD | TBD |
| OIPC notification (if required) | n/a — internal employee tool | — |
