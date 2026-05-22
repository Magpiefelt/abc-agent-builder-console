# ADR-0005: Ministry-scoped row-level data partitioning

- **Status:** Accepted
- **Date:** 2026-05-22
- **Deciders:** ABC core engineering, GoA privacy advisory (informal)

## Context

GoA users come from many ministries (Education, Health, Infrastructure,
Justice, …). A workflow built by an Education public servant must not be
visible to a Health user, even though they live in the same database and
share the same backend instance. Same for agent sessions, artifacts, audit
log rows, and PII detections. This is a privacy + FOIP requirement, not a
nice-to-have.

We considered three patterns:

1. **Per-ministry database.** One PostgreSQL instance per ministry.
2. **Per-ministry schema.** One PostgreSQL schema per ministry, same
   instance.
3. **Row-level scoping by `ministry_code` column.** One shared schema; every
   query filters by `ministry_code`.

## Decision

**Row-level scoping by `ministry_code`.**

Every multi-tenant table carries a `ministry_code TEXT` column populated
from the authenticated user's Entra ID group membership (regex extraction
from `AIM-G-{MINISTRY}-ALL_{EMPLOYEES|CONTRACTORS}`). The auth middleware
(`backend/src/middleware/auth.ts:authenticate`) sets `req.user.ministryCode`;
every query that reads from a multi-tenant table includes a
`WHERE ministry_code = $userMinistry` predicate.

Visibility rule:
- Users see workflows where they are the owner OR `ministry_code` matches
  their own ministry.
- Users see agent sessions they own (per-user scoping is stricter — sessions
  are not shared across ministry).
- Admins (`role='admin'`) bypass ministry scoping when explicitly invoking
  admin routes; the bypass is audit-logged as `ADMIN_ACCESS`.

## Consequences

**Positive.**

- One backend process, one database, one connection pool. Operational
  surface is small.
- Schema migrations apply once across all ministries — no per-tenant
  drift.
- Admin-cross-ministry actions (e.g. retention pass) are simple: omit the
  predicate.
- Audit log captures everyone in one stream — `SELECT * FROM audit_log
  WHERE created_at > $start` is the canonical incident-response query.
- Cost is bounded — one Render Postgres instance serves all ministries.

**Negative.**

- A bug that forgets the `ministry_code` predicate leaks across
  ministries. This is the load-bearing risk. **Mitigation:**
  - Every multi-tenant route is covered by an integration test that
    creates rows in two ministries and confirms one user can't see the
    other's data (`routes/__tests__/workflow.test.ts`,
    `agent.test.ts`).
  - The auth middleware refuses to issue a session for a user with no
    `ministry_code` claim (`middleware/auth.ts:requireMinistry`).
  - The privacy controls table tracks "ministry scoping" as control #4
    with explicit verification status (`docs/02_database_migrations.sql`).
- A full backup tape contains every ministry's data. The pgcrypto
  vault (ADR-0003) covers user secrets; non-secret data is row-scoped only.
  This is acceptable because backup tapes themselves are encrypted at the
  storage layer (GoA-managed).

## Alternatives considered

1. **Per-ministry database.** Rejected: per-ministry pool tuning, per-ministry
   migrations, per-ministry monitoring, per-ministry SSO callback config.
   Roughly 12× the operational load for marginal isolation gain.
2. **Per-ministry schema.** Rejected: same migration drift problem on a
   smaller scale; queries that span ministries (audit log views, admin
   dashboards) become ugly `UNION ALL` constructs.
3. **PostgreSQL Row-Level Security (RLS).** Considered seriously. Rejected
   because:
   - The dev-mock authentication (`DEV_USER`) doesn't pass a session
     variable cleanly into RLS policy expressions.
   - Admin bypass via `SECURITY DEFINER` functions clutters every query
     path.
   - Application-level predicates are explicit and auditable in the
     handler code; RLS hides the check inside the database, which is
     harder to reason about during a security review.
   - We can layer RLS on later as defense-in-depth without changing the
     application logic.

## Implementation invariants for future contributors

If you add a new multi-tenant table:

1. Include `ministry_code TEXT NOT NULL` (or nullable + documented reason).
2. Add an index on `ministry_code` for any query that filters on it
   plus a sort or limit.
3. Every `SELECT`/`UPDATE`/`DELETE` in a route handler must filter by
   the caller's `ministryCode` unless the route is admin-only.
4. The integration test must include a two-ministry isolation case.

If you bypass scoping (admin route, retention job), audit-log
the operation as `ADMIN_ACCESS` or a more specific action.
