# Nexus Deployment Runbook

Step-by-step procedure for deploying the ABC Agent Builder Console to GoA Nexus. The application has two deployable components:

- **Frontend** — Vite-built static bundle, served on port 5173.
- **Backend** — Node.js 22 / Express, served on port 3000.

## Inputs

- A merged commit on `main`.
- The `.github/workflows/deploy.yml` workflow has produced two artifacts:
  - `frontend-dist.tar.gz` — built static site
  - `backend-dist.tar.gz` — backend bundle + `package.json` + production deps
- Secrets registered in the Nexus secret store (see [Secrets](#secrets) below).

## Prerequisites (one-time)

1. **Nexus app registration** with `nexus/manifest.yaml` (committed in repo).
2. **Entra ID app registration** — **TODO until Stream A lands the JWT validation.** When it does, register the following redirect URIs in the Entra ID app:
   - `https://abc-agent-builder.gov.ab.ca/api/auth/callback` (production)
   - `https://abc-agent-builder.staging.gov.ab.ca/api/auth/callback` (staging)
   - `http://localhost:3000/api/auth/callback` (developer local)
3. **Database** — schema `cohen_mcleod` on the Render shared instance. Migration is `docs/02_database_migrations.sql`, idempotent.

### SSO callback registration steps (when Stream A is ready)

1. In Entra ID admin console, open the app registration for ABC Agent Builder Console.
2. Under **Authentication** → **Platform configurations** → **Web**, add the redirect URI for the target environment.
3. Under **Token configuration**, ensure the `groups` claim is added with **Security groups** selected (this drives `ministry_code` extraction).
4. Under **API permissions**, ensure `openid`, `profile`, `email`, `User.Read`, and `Group.Read.All` are present and admin-consented.
5. Copy the Application (client) ID and the directory (tenant) ID. Register a client secret. Place these values in the Nexus secret store as `ENTRA_CLIENT_ID`, `ENTRA_TENANT_ID`, `ENTRA_CLIENT_SECRET`.
6. Set `ENTRA_REDIRECT_URI` to the redirect URI registered in step 2.

## Secrets

The following must be configured in the Nexus secret store before deployment:

| Name | Required? | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string with `sslmode=require` |
| `SECRETS_VAULT_KEY` | yes (prod) | `openssl rand -hex 32` — 32-byte minimum |
| `SESSION_SECRET` | yes | random 64-byte string |
| `ENTRA_CLIENT_ID` | yes | TODO until Stream A |
| `ENTRA_CLIENT_SECRET` | yes | TODO until Stream A |
| `ENTRA_TENANT_ID` | yes | TODO until Stream A |
| `ENTRA_REDIRECT_URI` | yes | TODO until Stream A |
| `VERTEX_AI_API_KEY` | yes | Or `ANTHROPIC_API_KEY` for direct fallback |
| `VERTEX_AI_PROJECT_ID` | yes | Vertex project ID |
| `VERTEX_AI_REGION` | yes | Default `northamerica-northeast1` |
| `GOOGLE_AI_API_KEY` | optional | for Gemini (Unclassified only) |
| `BRAVE_SEARCH_API_KEY` | optional | for search tool |
| `GOOGLE_SEARCH_API_KEY`, `GOOGLE_SEARCH_CX` | optional | for Google Custom Search |
| `ELEVENLABS_API_KEY` | optional | TTS — Stream D |
| `GITHUB_TOKEN` | optional | GitHub tool |
| `FRONTEND_URL` | yes | `https://abc-agent-builder.gov.ab.ca` |
| `NODE_ENV` | yes | `production` |
| `RETENTION_JOB_ENABLED` | recommended | `true` in production |
| `RETENTION_JOB_HOUR` | optional | `2` (default — 02:00 local) |

> **Critical:** Verify `NODE_ENV=production` in the deployment env. If left at `development`, the dev-mock admin user is accepted for any request. This is the single highest-impact misconfiguration to guard against.

## Deployment procedure

### 1. Run the CI build

Push to `main`. The workflow `.github/workflows/deploy.yml` runs `build → test → package` and produces:

- `frontend-dist.tar.gz`
- `backend-dist.tar.gz`

Verify the workflow ran green before continuing.

### 2. Apply migrations

```bash
# From a privileged operator console with DATABASE_URL exported
psql "$DATABASE_URL" < docs/02_database_migrations.sql
```

The script is idempotent — running against an already-migrated DB is a no-op for existing tables and a `ON CONFLICT DO NOTHING` for seeded rows.

### 3. Publish to Nexus

If the deploy workflow has a `NEXUS_API_TOKEN` secret configured, it auto-publishes. Otherwise:

```bash
# Manual upload — placeholder until the Nexus client / API is documented
# Pull artifacts from the GitHub Actions run and follow the GoA Nexus upload procedure
```

### 4. Verify

Within 60 seconds of deploy:

```bash
BASE=https://abc-agent-builder.gov.ab.ca

# Public health — should be 200
curl -fsS "$BASE/api/health" | jq '.status, .environment'
# Expected:
#   "healthy"
#   "production"

# Detailed health (unauthenticated should 401)
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/api/health/detailed"
# Expected: 401

# Frontend loads
curl -fsS "$BASE/" | grep -q '<title>'
echo "OK"
```

### 5. Admin smoke test (once Stream A is live)

1. Open `$BASE/` in a browser, sign in via SSO.
2. Navigate to `/admin`. The admin link is visible only for `role: 'admin'` users.
3. Cycle through all 5 tabs (Audit / PII / Models / Sessions / Health). Each should load without errors.
4. In Health Diagnostics, confirm `services.secretsVault == "configured"`.
5. Click **Run retention pass now** — confirm a report appears (totals likely zero on a fresh deploy).

### 6. Roll back

The simplest rollback is redeploying the prior tag. Because all DB migrations are additive and `IF NOT EXISTS`-guarded, rolling the application back does not require schema rollback.

If a destructive schema change is ever introduced (avoid this), gate it behind a feature flag and provide a `down` migration in the same PR.

## Failure modes

| Symptom | Likely cause | Mitigation |
|---|---|---|
| `/api/health` 503 | `DATABASE_URL` wrong or DB unreachable | Verify env, then DB connectivity |
| Backend exits at boot with `SECRETS_VAULT_KEY` validation error | Key < 32 bytes | Regenerate via `openssl rand -hex 32` |
| `pgcrypto` not installed | DB role lacks `CREATE EXTENSION` privilege | Run the migration as a privileged role once |
| SSO redirect fails | Redirect URI mismatch between Entra ID app and `ENTRA_REDIRECT_URI` env | Update one to match the other |
| Admin UI shows "vault disabled" | `SECRETS_VAULT_KEY` env missing or empty | Set in secret panel, redeploy |

## Post-deploy cleanup

- Tag the release in git (`vYYYY.MM.DD`).
- Capture the audit-log row count baseline for the new release.
- Notify users of any user-visible changes via Cohen McLeod's standard distribution list.

---

## Local dry-run findings (2026-05-22)

A local read-through of `nexus/manifest.yaml`, `backend/src/config/env.ts`,
`backend/src/index.ts`, and `backend/.env.example` was done as a manifest
sanity-check before the first real Nexus push. The findings below are
clarifications and small gaps a fresh operator will hit if not addressed
**before** the first deploy. None of them block deployment — they shorten
the time-to-success.

### 1. Manifest secrets vs. env.ts schema — three gaps

`backend/src/config/env.ts` validates **more** environment variables than
`nexus/manifest.yaml` currently declares. The deploy will succeed without
these (they are optional), but the operator should add them to the Nexus
secret store **explicitly** so the audit trail of "what is reachable from
this environment" is complete:

| env.ts variable | In `nexus/manifest.yaml`? | Action |
|---|---|---|
| `ENT_TOOLS_API_KEY` | No | Add to `secrets:` block as `optional: true`. Without it, `brave_search` / `image_generation` fall back to direct vendor APIs. |
| `ENT_TOOLS_BASE_URL` | No | Add to `config:` with the production URL. Default in `env.ts` is the sandbox. |
| `ENT_TOOLS_BRAVE_PATH` / `ENT_TOOLS_IMAGE_PATH` | No | Add to `config:` only if the production proxy differs from the sandbox path defaults. |
| `EMAIL_FROM` / `EMAIL_SMTP_*` | No | Add to `secrets:` (host/user/pass) and `config:` (port, secure, from-address) once the `send_email` tool is rolled out. Without these the tool returns a clear "SMTP not configured" error rather than crashing. |
| `API_PROXY_ALLOWLIST` | No | Add to `config:` once a production allowlist is decided. Without it, only SSRF blocks apply — which is fine for first deploy but should be tightened later. |
| `LLM_MOCK` | No | Do NOT add. This is a dev-only flag; setting `LLM_MOCK=1` in production would route every LLM call through a deterministic mock and silently break the app. |

### 2. `frontend.healthCheck.path` is too permissive

The manifest declares `frontend.healthCheck.path: /` with
`expectedStatus: 200`. Vite's SPA fallback serves the index page for any
unmatched route, so a request to `/healthz` or `/this-route-does-not-exist`
also returns 200. The probe will report **healthy** even if the static
bundle is partially missing as long as `index.html` is present.

A tighter probe would be a static asset that ships with the bundle (e.g.
`/favicon.ico` or a generated `/health.txt`). Not blocking for the first
deploy, but flag this in the next manifest revision.

### 3. The frontend has no public health endpoint distinct from the SPA

There is no equivalent of the backend's `/api/health` on the frontend
side. Operators need to know that an HTTP 200 from the frontend means
"static server is up", **not** "the bundle is intact and the SPA mounts
without errors". The actual SPA-mount health is only observable from a
browser. Document this in incident triage: a frontend probe-green +
backend probe-green can still leave users with a blank page if the
bundle is corrupt.

### 4. `MOCK_LLM=1` mounts test routes — confirm it is never set in prod

`backend/src/index.ts` lines 136-140 conditionally mount `/api/test/*`
when `MOCK_LLM=1`. These routes let a caller inject canned LLM responses
into a session. In production this would be a critical control bypass.
Two defenses are in place: the env validator does not accept `MOCK_LLM=1`
in `production` config (it is dev-only), and the Nexus manifest does not
declare `MOCK_LLM` at all. Belt-and-braces: confirm during the verify
step (§4) that `curl $BASE/api/test/mock-llm -X POST` returns 404, not
the test route handler.

### 5. Port assignment vs. typical Nexus reverse-proxy patterns

The manifest assigns the frontend to port 5173 (Vite's dev port) and the
backend to port 3000. Nexus is expected to put a reverse proxy in front
of both. Two concrete checks for the operator:

1. **Cookie domain**: The session cookie is set on the backend response.
   When the reverse proxy strips the `Host` header or rewrites the path,
   the cookie domain may not match `FRONTEND_URL`, and the user is
   silently logged out on every request. Verify this end-to-end during
   the §5 admin smoke test.
2. **CORS origin**: `backend/src/index.ts` line 91 sets the CORS origin
   to `env.FRONTEND_URL` in production. If Nexus exposes the frontend
   under a different hostname than `FRONTEND_URL` (e.g. an internal
   `*.nexus.gov.ab.ca` alongside the public `abc-agent-builder.gov.ab.ca`),
   API calls from the alias will be rejected by CORS. Set `FRONTEND_URL`
   to the user-facing hostname, not the internal one.

### 6. `MAX_CONCURRENT_SESSIONS=3` is per-user, not per-instance

Operators reading the manifest may assume `MAX_CONCURRENT_SESSIONS=3`
limits global concurrency. It actually limits **per-user** concurrent
agent sessions (see `agentRateLimit`). Capacity planning for the first
production rollout should use the per-user cap × expected concurrent
users, not the raw value. A 50-user ministry sees up to 150 concurrent
sessions.

### 7. Migration script is idempotent — confirm with a no-op replay

`docs/02_database_migrations.sql` is additive and `IF NOT EXISTS` /
`ON CONFLICT DO NOTHING` throughout. The operator can — and should —
replay the script against a freshly-migrated DB to confirm zero rows
affected, before kicking off the first deploy. This proves both the
script is safe to re-run and that the operator's DB credentials have
the right grants.

```bash
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM cohen_mcleod.features"
# Capture this count.

psql "$DATABASE_URL" < docs/02_database_migrations.sql
# Should print mostly NOTICE: ... "already exists" lines, with seed
# INSERTs reporting "INSERT 0 0".

psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM cohen_mcleod.features"
# Should match the captured count exactly.
```

### 8. SSO callbacks block first deploy by design

The "Prerequisites" section flags Stream A as a hard dependency for SSO,
but a first-deploy operator may not realise they can ship the backend
**without** SSO configured for an initial smoke test — the dev-mock auth
path is gated on `NODE_ENV !== "production"`, so production deploys with
no Entra config simply 401 every request. That is the safe failure mode;
no special action needed. Just be clear in pre-deploy comms that
SSO-without-Entra means "every user sees a sign-in failure", not "the
backend is broken".

### 9. Retention job: confirm it can read its own schema

`RETENTION_JOB_ENABLED=true` in the manifest defaults the daily 02:00
pass on. The job reads `retention_policy`, `agent_sessions`,
`artifacts`, and `audit_log` and writes to the same tables. If the DB
user the backend runs as has read but not delete privileges on these
tables, the job logs an error every 24h and is otherwise silent. After
the first deploy, run **§5.5 (Run retention pass now)** in a dev-mode
admin login against a populated DB to confirm grants are correct.
