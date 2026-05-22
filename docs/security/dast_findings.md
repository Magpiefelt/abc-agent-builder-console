# DAST Findings — ABC Agent Builder Console

Dynamic Application Security Testing findings from the nightly OWASP ZAP
baseline scan (`/.github/workflows/security.yml`).

## How this is generated

A nightly GitHub Actions job spins up the backend against a fresh PostgreSQL
service container (`MOCK_LLM=1`, no real API calls), runs the [ZAP baseline
action](https://github.com/zaproxy/action-baseline) against
`http://localhost:3000`, and uploads three artifacts to the workflow run:

- `report_html.html` — human-readable scan report
- `report_md.md` — Markdown form, suitable for sticking under
  `docs/security/dast_artifacts/YYYY-MM-DD.md`
- `report_json.json` — machine-readable, suitable for further automation

The scan is **passive only** — no active exploitation. It catches
configuration issues (missing security headers, leaky comments, weak
cookies), not application logic flaws. Pair it with the manual Red-team
runs documented in `docs/security/red_team_scenarios.md`.

## Rule tuning

Per-rule thresholds live in `.zap/rules.tsv` next to the workflow. Three
buckets:

| Threshold | Effect | Use when… |
|---|---|---|
| `FAIL` | Failing finding blocks the workflow | Always-bad checks (injection, CSRF, leaked stack traces) |
| `WARN` | Reported but doesn't block | Known gap with tracking ticket; investigation phase |
| `IGNORE` | Suppressed from the report | Confirmed false positive with reasoning written in the TSV |

Every `IGNORE` in `rules.tsv` has a one-line comment explaining why. Every
`WARN` should link to a backlog item (e.g. `S1` for the CSP gap).

## Open findings

This section is updated by hand after each scan triage pass. The raw report
artifacts are the source of truth; this is the curated view.

| Date | Finding | Rule ID | Severity | Status | Owner | Notes |
|---|---|---|---|---|---|---|
| _none yet_ | — | — | — | — | — | First run lands when the workflow merges + the nightly cron fires. |

## Resolved findings (history)

| Date resolved | Finding | Rule ID | Resolution |
|---|---|---|---|
| _none yet_ | — | — | — |

## Triage workflow

When the nightly run fires and finds something new:

1. Download `report_md.md` from the failed workflow run.
2. For each new finding, decide:
   - **Real bug** → file an issue, add a row to "Open findings" above with
     status `triage`, link the issue.
   - **False positive** → add the rule ID to `.zap/rules.tsv` with
     `IGNORE` + a justification comment. Re-run the workflow to confirm.
   - **Known gap with tracking** → set the rule to `WARN` in `rules.tsv`
     and reference the existing backlog item.
3. After resolution: move the row from "Open findings" to "Resolved findings"
   with the resolution method.

## Why ZAP baseline (not full active scan)?

The baseline scan is passive — it does not POST to forms, follow redirects
to logged-in areas, or attempt SQL injection / XSS payloads. That's
deliberate:

- The CI environment has a real DB and a (mocked) LLM; an active scan would
  generate write traffic that pollutes both.
- Active scans take 30+ minutes vs the baseline's 3-5. We get a nightly
  signal without burning the org's CI budget.
- The interesting application-logic vulnerabilities (privilege escalation,
  prompt injection, business-logic bypass) need targeted hand-built attacks
  — see `docs/security/red_team_scenarios.md`. ZAP-active would not find
  them anyway.

For the active scan story, the Red/Blue agent pipeline + a separate
on-demand `zaproxy/action-full-scan` invocation against a non-prod
environment are the right tools.

## Pairing with other signals

DAST is one of four scan layers in this codebase:

| Layer | What it catches | Where |
|---|---|---|
| **SAST** (TypeScript / ESLint) | Type errors, lint violations, obvious bugs | `.github/workflows/ci.yml` |
| **Secret scanning** (gitleaks) | Committed keys / tokens / credentials | `.github/workflows/ci.yml` + `.pre-commit-config.yaml` |
| **DAST** (ZAP baseline, this file) | Configuration / header / cookie issues at runtime | `.github/workflows/security.yml` |
| **Red/Blue agent runs** | Application-logic flaws | `docs/security/red_blue_report.md` |

Treat all four as required-but-not-sufficient. Real attackers chain across
all of them.
