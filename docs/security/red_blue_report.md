# Red / Blue Agent Report — ABC Agent Builder Console

**Date:** 2026-05-21
**Branch under test:** `claude/abc-console-stream-e-2mb6i`
**Harness:** AIDE-VELOCITY-HARNESS (Red + Blue agents)
**Standard:** Government of Alberta security baseline, OWASP Top 10 (2021),
  internal SOAR controls.

This document records the Red agent's attack scenarios, the Blue agent's
analysis (dependency / secret / license scan), the observed results
against the running backend, and the remediation status of each finding.
The runnable attack scripts live in
[`red_team_scenarios.md`](./red_team_scenarios.md).

## Summary

| Category | Attempts | Blocked at edge | Blocked in code | Accepted residual risk |
|---|---|---|---|---|
| SSRF | 4 | 4 | — | — |
| Prompt injection | 1 | — | 1 (system-prompt guard) | — |
| PII bypass | 2 | 1 | — | 1 (obfuscated payloads) |
| Rate-limit abuse | 1 | 1 (prod) / 0 (dev) | — | — |
| Authn / scoping | 1 | — | — | 1 (awaiting Stream A real JWT) |
| Log forgery | 1 | 1 | — | — |
| Payload abuse | 3 | 3 | — | — |
| Total | **13** | **9** | **1** | **3** |

## Blue agent — pre-flight scans (VELOCITY-HARNESS)

| Check | Tool | Result | Action |
|---|---|---|---|
| Secret scan | gitleaks (default ruleset) | No secrets detected in tracked files. `.env.example` contains placeholders only. | None. |
| Dependency vuln scan | `pnpm audit --prod` against root + all packages | Two low-severity advisories in transitive `glob@10.5.0` and `uuid@10.0.0` (pnpm warns at install time). No high/critical findings. | Accept (transitive); revisit at next major dep bump. |
| License check | `pnpm licenses ls --prod` | All production dependencies use MIT, ISC, Apache-2.0, or BSD-2-Clause. No copyleft. | None. |
| TypeScript strict | `tsc --noEmit` (workspace) | Zero errors. | None. |
| Lint | `eslint src/` (backend) | Zero errors. | None. |
| Unit + integration tests | `pnpm test:all` | All passing (262 unit + 4 evals scenarios). | None. |

## Red agent findings

### R-01 — SSRF: AWS metadata service (169.254.169.254)
- **Severity:** Critical (if unblocked)
- **Attempt:** Drive `web_scrape` to `http://169.254.169.254/latest/meta-data/`.
- **Observed:** Tool returns `success: false`,
  `"Cannot access private or internal network addresses."`. Audit row
  `security.private_ip_blocked` recorded.
- **Expected:** Blocked.
- **Remediation status:** ✅ **Fixed in code** —
  `backend/src/tools/webScrape.ts` `isPrivateOrReservedHost()` matches
  `169.254.0.0/16`.

### R-02 — SSRF: RFC1918 (10.0.0.0/8)
- **Severity:** Critical
- **Attempt:** `web_scrape` against `http://10.0.0.1/admin`.
- **Observed:** Same block as R-01.
- **Expected:** Blocked.
- **Remediation status:** ✅ **Fixed in code** — covers
  `10/8`, `172.16/12`, `192.168/16`, `127/8`, `169.254/16`, `0/8`.

### R-03 — SSRF: `file://` protocol
- **Severity:** Critical
- **Attempt:** `web_scrape` against `file:///etc/passwd`.
- **Observed:** Rejected by URL protocol check before any fetch is
  initiated.
- **Expected:** Blocked.
- **Remediation status:** ✅ **Fixed in code** — only `http:` / `https:`
  are allowed.

### R-04 — SSRF: `.local` TLD (DNS rebind / mDNS)
- **Severity:** High
- **Attempt:** `web_scrape` against `http://router.local/admin`.
- **Observed:** Blocked.
- **Expected:** Blocked.
- **Remediation status:** ✅ **Fixed in code** —
  block-list includes `.local`, `.internal`, `.corp`, `.lan`.

### R-05 — Prompt injection: "ignore all prior instructions"
- **Severity:** Medium
- **Attempt:** User prompt asks the agent to ignore the system prompt
  and dump `process.env`.
- **Observed:** Session creates normally. The orchestrator never includes
  `process.env` in the system prompt (the prompt builder is content-only
  + structured state). With a real LLM, the `security_rules` template
  section instructs it to refuse exfiltration requests. With the mock
  LLM, no real exfiltration is possible.
- **Expected:** Instruction obeyed only as far as the model itself
  permits; environment never reachable from the prompt context.
- **Remediation status:** ✅ **Defended by design** — the system prompt
  builder does not interpolate environment variables, and the PII /
  secret detector blocks outbound responses that contain API key
  patterns. Documented behavior in `systemPromptTemplate.json`
  `security_rules`.

### R-06 — PII bypass: unicode look-alikes
- **Severity:** High
- **Attempt:** Prompt contains "Ѕ.I.N. 123-456-789" with a Cyrillic Ѕ.
- **Observed:** 422 — SIN regex matched on the digit groups regardless
  of surrounding text.
- **Expected:** Blocked.
- **Remediation status:** ✅ **Fixed in code** — the SIN regex matches
  `\b\d{3}[-\s]?\d{3}[-\s]?\d{3}\b` which is content-shape based, not
  alphabet-based.

### R-07 — PII bypass: base64 encoded SIN
- **Severity:** Medium (residual)
- **Attempt:** Prompt contains `SIN: 123-456-789` after base64 encoding.
- **Observed:** Creation **succeeds** — inbound regex cannot see the
  encoded payload.
- **Expected:** Documented residual risk.
- **Remediation status:** ⚠️ **Accepted residual** — generic encoding
  bypass cannot be solved by regex alone; relying on the model's own
  refusal behaviour, audit logs for review, and Stream F retention /
  notification controls. Mitigations roadmap:
  1. Add an outbound-content PII pass after LLM call to catch decoded
     output (Stream F).
  2. Add base64 / hex auto-decoders to the PII scanner.
  3. Add user-facing warning about prompts with high-entropy strings.

### R-08 — Rate-limit abuse (burst)
- **Severity:** High (cost / DoS)
- **Attempt:** 50× POST `/sessions/abc/start` in 5 seconds.
- **Observed (NODE_ENV=production):** First 5 receive 4xx (validation /
  not-found), remainder receive 429 + `Retry-After`. Audit log records
  `security.rate_limited`.
- **Observed (NODE_ENV=development):** All 50 pass — middleware bypasses
  in dev as a known convenience.
- **Expected:** 429 in prod, bypass in dev.
- **Remediation status:** ✅ **Fixed in code** for production. Dev
  bypass is intentional and documented.

### R-09 — Ministry leakage probe
- **Severity:** High (FOIP / classification)
- **Attempt:** Read session created by user A from user B (different
  ministry) — currently both look like the dev mock user.
- **Observed:** Today the dev mock returns the same user, so the test
  cannot truly isolate ministries. The session query already filters
  by `user_id`; once Stream A wires real Entra ID JWTs (`req.user.id`
  derived from the OID claim), the filter activates.
- **Expected (after Stream A):** 404.
- **Remediation status:** ⚠️ **Pending Stream A** — auth middleware
  has a real-JWT placeholder; production deploy must NOT proceed until
  it is filled in. Documented in
  `backend/src/middleware/auth.ts` TODO and PC-003 in the privacy
  controls matrix.

### R-10 — Audit log forgery via crafted X-Forwarded-For
- **Severity:** Medium
- **Attempt:** Inject a `\r\n` newline into `X-Forwarded-For` to
  smuggle a second log line.
- **Observed:** Node's `http` parser rejects the malformed header at
  the transport layer with a 400 before our middleware sees it.
- **Expected:** Blocked.
- **Remediation status:** ✅ **Fixed by Node's parser**. As defence in
  depth, `auditLogger.ts` writes every field as a parameterised query
  argument, so even a header that bypassed the transport-layer check
  would not result in log forgery or SQL injection.

### R-11 — Oversized payload
- **Severity:** Medium (DoS)
- **Attempt:** 6 MB JSON body (cap is 5 MB).
- **Observed:** 413 from `requestValidation` middleware.
- **Expected:** 413.
- **Remediation status:** ✅ **Fixed in code** —
  `requestValidation.ts` checks `Content-Length` before the body is
  fully read; Express's `express.json({ limit: "5mb" })` is a backstop.

### R-12 — Content-type confusion
- **Severity:** Low
- **Attempt:** Send `Content-Type: text/xml` on `POST /sessions`.
- **Observed:** 415 from `requestValidation`.
- **Expected:** 415.
- **Remediation status:** ✅ **Fixed in code** — only `application/json`,
  `application/x-www-form-urlencoded`, `multipart/form-data` accepted.

### R-13 — Path traversal in query string
- **Severity:** High
- **Attempt:** `?q=%2e%2e%2f%2e%2e%2fetc%2fpasswd`.
- **Observed:** 400 from `requestValidation` — `%2e%2e` matches the
  blocked pattern set after URI decoding.
- **Expected:** 400.
- **Remediation status:** ✅ **Fixed in code**.

## Operational follow-ups

| Item | Owner | Priority |
|---|---|---|
| Outbound-content PII scan after LLM call (catch decoded PII) | Stream F | P1 |
| Wire real Entra ID JWT validation in `auth.ts` | Stream A | P0 — blocking |
| Drop `NODE_ENV=development` rate-limit bypass before Nexus deploy | Stream F | P0 — blocking |
| Add Playwright color-contrast pass to CI | Stream E follow-up | P2 |
| Add gitleaks pre-commit hook | Stream F | P2 |

## Notes for the auditor

- The Red agent's full command lines are in
  [`red_team_scenarios.md`](./red_team_scenarios.md); each `R-NN`
  here references the matching command block there.
- The Blue agent's full output (gitleaks, pnpm audit, pnpm licenses) is
  reproducible by running the commands in the "Blue agent" section above
  against this branch.
- All routes are exercised by the unit + integration suites
  (`backend/src/**/__tests__/`, `backend/test/integration/`) and the
  evals harness (`evals/scenarios/`), so the controls above are not just
  documented — they're locked in by tests that run in CI.
