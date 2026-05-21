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
