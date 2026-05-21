# Incident Response Runbook

For: suspected privacy breach, leaked credential, abusive use, ATO drift.

This runbook covers the four phases: **detect, contain, eradicate, recover** — plus **lessons learned**. Keep it short; the goal is to make the right move quickly.

## On-call entry points

- **Primary contact:** Cohen McLeod (cohen.mcleod@gov.ab.ca)
- **Secondary:** TBD (Stream A handoff)
- **GoA security operations:** TBD (per GoA standard)

---

## 1. Detect

| Signal | Where it appears |
|---|---|
| User report ("my prompt was rejected with PII detected") | Help desk → cohen.mcleod@gov.ab.ca |
| Spike in `pii.blocked.prompt` audit entries | Admin UI → PII Detections tab; or query (below) |
| Spike in `security.rate_limited` events | Admin UI → Audit Log filtered by `action = security.rate_limited` |
| 5xx rate from `/api/health` or `/api/health/detailed` | Monitoring (Render dashboard / future GoA monitoring) |
| Unexpected admin actions (`admin.model.updated`, `secret.rotated`) | Admin UI → Audit Log |
| External CSIRT notification | Email |

### Quick queries

```sql
-- Recent security events in last 24 h
SELECT created_at, action, ip_address, details
FROM cohen_mcleod.audit_log
WHERE action LIKE 'security.%' OR action LIKE 'pii.%'
  AND created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC
LIMIT 200;

-- Failed authentication attempts
SELECT created_at, ip_address, details
FROM cohen_mcleod.audit_log
WHERE action = 'auth.failed'
  AND created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC;

-- Admin actions audit
SELECT created_at, user_id, action, resource_id, details
FROM cohen_mcleod.audit_log
WHERE action LIKE 'admin.%'
  AND created_at > NOW() - INTERVAL '7 days'
ORDER BY created_at DESC;
```

---

## 2. Contain

Use the smallest action that stops the bleeding.

### Suspected credential exposure (LLM API key)

1. Rotate the affected provider key in the provider console.
2. Update `VERTEX_AI_API_KEY` / `ANTHROPIC_API_KEY` / `GOOGLE_AI_API_KEY` in Render env.
3. Roll the backend pod (no restart needed for Express — env reload on cold start; force one).
4. Audit recent calls:

```sql
SELECT created_at, user_id, details->>'modelId' AS model, details->>'latencyMs' AS latency
FROM cohen_mcleod.audit_log
WHERE action LIKE 'agent.%'
  AND created_at > NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC;
```

### Suspected vault-key compromise

1. **Stop** the retention scheduler (set `RETENTION_JOB_ENABLED=false`) so it can't write any new ciphertext under the suspect key.
2. Generate a new key: `openssl rand -hex 32`.
3. Follow `docs/operations/key_rotation.md` to re-encrypt all `user_secrets`.
4. Once redeployed with the new key, set `RETENTION_JOB_ENABLED=true` again.

### Abusive user

1. Identify the user_id from audit log.
2. Set their `users.role = 'viewer'` in the DB (cannot create sessions). Add an audit entry by hand:

```sql
UPDATE cohen_mcleod.users SET role = 'viewer' WHERE id = $1;
INSERT INTO cohen_mcleod.audit_log (action, resource_type, resource_id, details)
VALUES ('admin.config.changed', 'user', $1::TEXT, '{"action": "demoted_due_to_incident"}');
```

3. If escalation needed, also revoke their Entra ID group membership (out-of-band — Entra ID admin console).

### Database compromise suspected

1. Disable the application (Render → service → stop) to halt further writes.
2. Snapshot the DB before mutation.
3. Contact GoA security operations.
4. Plan rollforward from clean backup if necessary.

---

## 3. Eradicate

- Identify and patch the root cause. Open a tracking issue with the incident timeline.
- If a code bug, raise a PR with regression test (Stream E).
- If a config drift, update Render / Nexus secrets and document the change.
- If a process gap, update this runbook.

---

## 4. Recover

- Restore service (revert any temporary lockouts).
- Notify affected users via Cohen McLeod email if any user-visible impact occurred.
- Re-enable monitoring alerts.
- Re-enable retention scheduler if it was paused.

---

## 5. Lessons learned

Within 5 business days of resolution:

1. Convene a post-mortem with everyone who touched the incident.
2. Write a one-page summary: **what happened, what we did, what we'd change**.
3. File the summary in `docs/operations/postmortems/YYYY-MM-DD.md`.
4. Update the threat model (`docs/security/threat_model_stride.md`) and PIA residual-risk table if the incident exposed a new class of risk.
5. Adjust controls / runbooks accordingly.

## Severity guide

| Severity | Definition | Response |
|---|---|---|
| **SEV-1** | Confirmed exposure of Protected B data to unauthorized parties | Page on-call immediately; engage GoA security operations within 1 h |
| **SEV-2** | Sustained service outage or credential leak | Same-day response |
| **SEV-3** | Single-user abuse or contained misuse | Next-business-day response |
| **SEV-4** | Capacity or performance degradation | Routine triage |
