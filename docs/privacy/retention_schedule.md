# Retention Schedule

This document defines how long the ABC Agent Builder Console keeps each class of record and how disposal occurs. The schedule is **encoded as data** in `cohen_mcleod.retention_policy` (see `docs/02_database_migrations.sql`) and **enforced by code** in `backend/src/services/retentionJob.ts`. Updates here must be mirrored in both.

## Retention strategy

Two strategies are applied depending on the table:

- **Hard-delete** — the row is physically removed. Used for transient agent state where the obligation to delete (FOIP) outweighs the audit value (`agent_sessions`, `agent_iterations`, `artifacts`).
- **Anonymize** — `user_id` and `ip_address` are nulled (and `details` reduced to a key skeleton) while the row remains. Used for `audit_log` and `pii_detections` where FOIP audit-trail obligations require evidence that an event occurred, but not who triggered it, beyond the retention window. Anonymized records are kept indefinitely for compliance counting.

The classification of the **source agent_session** drives the retention window for related rows.

## Schedule (per classification)

| Classification | `agent_sessions` (hard) | `agent_iterations` (hard) | `artifacts` (hard) | `audit_log` (anonymize threshold) | `pii_detections` (anonymize threshold) |
|---|---|---|---|---|---|
| Unclassified | 90 days | 90 days (joined via session) | 90 days | 365 days | 365 days |
| Protected A | 365 days (1 y) | 365 days | 365 days | 1,095 days (3 y) | 1,095 days |
| Protected B | 1,095 days (3 y) | 1,095 days | 1,095 days | 2,555 days (7 y) | 2,555 days |

> **Note:** The retention job uses the **longest** `audit_log_days` window across all classifications (i.e., 7 years for Protected B) as the anonymization threshold for `audit_log` and `pii_detections`. This is conservative on purpose — it prevents premature anonymization of evidence that may be needed across classifications.

## Data lifecycle by table

### `cohen_mcleod.agent_sessions` (and `agent_iterations` joined via `session_id`)

- **Created:** when the user creates a session (`POST /api/agent/sessions`).
- **Retained:** for `sessions_days` of its classification.
- **Disposed:** hard-deleted by the daily retention pass. The matching `agent_iterations` rows are cascaded out via an explicit DELETE-by-join.

### `cohen_mcleod.artifacts`

- **Created:** when the agent or workflow produces a saved output.
- **Retained:** for `artifacts_days` of its classification.
- **Disposed:** hard-deleted.

### `cohen_mcleod.workflows`

- **Created:** explicitly by the user.
- **Retained:** indefinitely while the workflow remains saved.
- **Disposed:** user-driven (delete button) or admin cleanup. Not subject to the automated retention job because it is owner-controlled reference data.

### `cohen_mcleod.audit_log`

- **Created:** on every state-changing API call.
- **Retained:** all rows kept for 7 years (longest classification audit window).
- **After 7 years:** anonymized — `user_id = NULL`, `ip_address = NULL`, `details` replaced with `{anonymized: true, original_keys: […]}`. Row count preserved for compliance reporting.

### `cohen_mcleod.pii_detections`

- **Created:** by `scanForPII` when a detection fires.
- **Retained:** all rows kept for 7 years.
- **After 7 years:** `user_id` and `context_snippet` nulled. Detection type and timestamp preserved for trend analysis.

### `cohen_mcleod.user_secrets`

- **Created:** explicit user action.
- **Retained:** until the user deletes the secret or the user record is deactivated (ON DELETE CASCADE).
- **Disposed:** user-driven. Not part of the automated retention job. Key rotation procedure is independent of retention.

## Execution

- **Schedule:** Daily at the configured `RETENTION_JOB_HOUR` (default 02:00 local). Implemented in `backend/src/services/retentionJob.ts` via `setTimeout` aligned to the next hour, then `setInterval(24h)`.
- **Manual trigger:** `POST /api/admin/retention/run` (admin-only). Used by ops to force a pass or to validate the policy after edits.
- **Reporting:** Every pass writes an `ADMIN_RETENTION_RUN` audit entry containing per-table row counts, total duration, and any errors. Surfaced in the admin UI's Health Diagnostics tab.

## Modifying the schedule

1. Edit the row in `cohen_mcleod.retention_policy` (via `psql` or admin SQL tool).
2. The change takes effect on the next pass — no application restart required.
3. Schema changes (e.g., adding a new classification) require updating the migration SQL **and** the strategy logic in `retentionJob.ts`. Both are reviewed together.
