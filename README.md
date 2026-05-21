# ABC Agent Builder Console

> Greenfield rebuild of the Agent Builder Console for the Government of Alberta — an agentic workflow canvas for staff to compose Free-Agent tasks and Workflow graphs against an approved LLM model registry.

**Status:** Phase 2 complete (orchestration engine). Streams A–F in flight.
**Stack:** Vue 3 + Vite (frontend, port 5173) / Node 22 + Express 5 (backend, port 3000) / PostgreSQL (schema `cohen_mcleod`) / Microsoft Entra ID SSO / Vertex AI Claude (Canadian residency).
**Architecture principle:** Thin client, thick server. No secrets in the frontend; all orchestration server-side.

## Quick start (local development)

```bash
# Install once
pnpm install

# Backend (port 3000) — uses a mock admin user in NODE_ENV=development
cd backend && npx tsx src/index.ts

# Frontend (port 5173) — proxies /api to the backend
cd frontend && pnpm dev
```

Open <http://localhost:5173>. The dev-mock user is `cohen.mcleod@gov.ab.ca` with `role: 'admin'` and `ministryCode: 'INFRA'` — every endpoint, including `/admin`, is reachable without SSO until Stream A lands real Entra ID validation.

## Repository layout

```
backend/           Node 22 + Express + TypeScript API
frontend/          Vue 3 + Vite SPA
docs/
  00_MASTER_PLAN.md            Six-stream parallel build plan
  02_database_migrations.sql   Idempotent additive schema
  security/                    Threat model, DFDs, controls matrix
  privacy/                     PIA + retention schedule
  operations/                  Runbooks (incident, key rotation, observability, deploy)
nexus/manifest.yaml            Nexus deployment declaration
.github/workflows/deploy.yml   Build → publish → smoke
```

## Documentation index

### Build plan
- `docs/00_MASTER_PLAN.md` — six work streams, dependencies, acceptance criteria
- `AGENTS.md` — stack, non-negotiables, key files

### Security (ATO package)
- `docs/security/threat_model_stride.md` — STRIDE per component
- `docs/security/data_flow_diagram.md` — Mermaid sequence diagrams (login, free agent, workflow, PII block)
- `docs/security/controls_matrix.md` — controls vs GoA categorization, tied to source files

### Privacy
- `docs/privacy/pia.md` — Privacy Impact Assessment (FOIP s.33, third-party processors, residual risks)
- `docs/privacy/retention_schedule.md` — per-classification retention windows

### Operations
- `docs/operations/incident_response.md` — detect / contain / eradicate / recover
- `docs/operations/key_rotation.md` — rotating `SECRETS_VAULT_KEY` (annual or on compromise)
- `docs/operations/observability.md` — logs, metrics, alerts, manual queries
- `docs/operations/deployment_nexus.md` — Nexus deployment runbook + SSO callback registration

## Deployment

The full procedure lives in `docs/operations/deployment_nexus.md`. Summary:

1. Merge to `main` → `.github/workflows/deploy.yml` builds and packages `frontend-dist.tar.gz` and `backend-dist.tar.gz`.
2. Apply migrations: `psql "$DATABASE_URL" < docs/02_database_migrations.sql` (idempotent).
3. The deploy workflow publishes to Nexus when `NEXUS_API_TOKEN` is configured; otherwise artifacts remain in the Actions run for manual upload.
4. Run the post-deploy smoke check:
   ```bash
   curl -fsS "$BASE/api/health" | jq '.status'   # → "healthy"
   ```
5. For admin UI validation, sign in via SSO and walk through the five tabs at `/admin`.

## SSO callback registration

**TODO until Stream A lands real Entra ID validation.** Once it does, register the following redirect URIs in the Entra ID app registration:

- `https://abc-agent-builder.gov.ab.ca/api/auth/callback` (production)
- `https://abc-agent-builder.staging.gov.ab.ca/api/auth/callback` (staging)
- `http://localhost:3000/api/auth/callback` (developer local)

The required token claims are `oid`, `email`, `name`, and `groups` (with the **Security groups** claim source — drives `ministry_code` extraction from `AIM-G-{MINISTRY}-ALL_(EMPLOYEES|CONTRACTORS)`). Full step-by-step is in `docs/operations/deployment_nexus.md`.

## Secret rotation

Tool credentials are encrypted at rest in `cohen_mcleod.user_secrets` using pgcrypto with the `SECRETS_VAULT_KEY` env variable. Rotate annually or on suspected compromise — full procedure in **`docs/operations/key_rotation.md`**.

## Compliance posture

This rebuild is engineered against the GoA Security Categorization Standard for **Protected B** data. The ATO control set lives under `docs/security/`; the PIA lives under `docs/privacy/`. Submit those for review alongside the running application.

## Contributing

- Develop on a stream branch (`claude/<stream>-<focus>`). Do not push directly to `main`.
- Migrations are append-only and idempotent (`CREATE TABLE IF NOT EXISTS`, `ON CONFLICT DO NOTHING`).
- Every new endpoint must call `auditAction` or one of its wrappers.
- Run `pnpm type-check` in both workspaces before opening a PR.

## Contact

Cohen McLeod · cohen.mcleod@gov.ab.ca
