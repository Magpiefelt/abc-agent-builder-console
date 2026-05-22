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

## API documentation

The backend self-documents every public endpoint via an OpenAPI 3.1 spec
built programmatically from typed building blocks in
`backend/src/lib/openapi/spec.ts`.

- `GET /api/openapi.json` — the full OpenAPI 3.1 document as JSON.
- `GET /api/docs` — Swagger UI rendered against the same spec. Loads
  CSS/JS from `cdn.jsdelivr.net/npm/swagger-ui-dist@5/` with a
  per-response CSP that allows only the documentation CDN.

Both endpoints are intentionally unauthenticated — the spec describes
the public shape of the API and never contains secrets or user data.
External integrators (and AI agent harnesses) can read the contract
without an account; calls into the API itself still require a valid
session cookie issued by the Entra ID OIDC flow.

When you add a route under `backend/src/routes/`, add it to `spec.ts`
too. The unit test in `backend/src/lib/openapi/__tests__/spec.test.ts`
pins the full production-route list — adding a route without spec
coverage trips a red test.

## Secret rotation

Tool credentials are encrypted at rest in `cohen_mcleod.user_secrets` using pgcrypto with the `SECRETS_VAULT_KEY` env variable. Rotate annually or on suspected compromise — full procedure in **`docs/operations/key_rotation.md`**.

## Secret scanning (pre-commit)

This repo ships a `.pre-commit-config.yaml` that runs [`gitleaks`](https://github.com/gitleaks/gitleaks) on every commit so credentials never reach git history. One-time setup per developer:

```bash
pipx install pre-commit        # or: brew install pre-commit
pre-commit install             # registers the hook in this repo
pre-commit run --all-files     # one-shot sweep of the whole tree
```

The hook reads `.gitleaks.toml`, which layers a small project-specific allowlist (lockfiles, `.env.example`, fixture data) on top of gitleaks' upstream defaults. Anything else that looks like an Anthropic, AWS, Stripe, or generic high-entropy key blocks the commit until it's removed or scrubbed from history.

## Compliance posture

This rebuild is engineered against the GoA Security Categorization Standard for **Protected B** data. The ATO control set lives under `docs/security/`; the PIA lives under `docs/privacy/`. Submit those for review alongside the running application.

## Contributing

- Develop on a stream branch (`claude/<stream>-<focus>`). Do not push directly to `main`.
- Migrations are append-only and idempotent (`CREATE TABLE IF NOT EXISTS`, `ON CONFLICT DO NOTHING`).
- Every new endpoint must call `auditAction` or one of its wrappers.
- Before opening a PR:
  - `pnpm --recursive run type-check` — backend `tsc --noEmit` + frontend `vue-tsc --build`
  - `pnpm --recursive run test` — Vitest in both packages (CI gates on this via `.github/workflows/ci.yml`)
- Scenario evals live under `evals/`. Run one with
  `BASE_URL=http://localhost:3000 npx tsx evals/runners/scenarioRunner.ts evals/scenarios/01_smoke.json`.

## Contact

Cohen McLeod · cohen.mcleod@gov.ab.ca
