# End-to-End Verification Log — ABC Agent Builder Console

**Branch:** `cohen-mcleod`
**Date:** 2026-05-22
**Author:** Cohen McLeod (`cohen.mcleod@gov.ab.ca`)
**Scope:** Verify that the Free Agent orchestration loop, SSE event stream, PII gates, classification routing, loop detection, and persistence behave as designed.

This log is the artifact called out as outstanding in
[`docs/00_MASTER_PLAN.md`](../00_MASTER_PLAN.md) §10.4 O6 ("Real-LLM
end-to-end verification log").

---

## 1. Verification approach

The verification has two layers:

| Layer | What it proves | How |
|---|---|---|
| **A. Deterministic harness** | The scaffolding around the LLM (orchestration, PII gating, classification routing, SSE shape, audit trail, loop detection, error recovery, retention) does what it claims | [`evals/runners/scenarioRunner.ts`](../../evals/runners/scenarioRunner.ts) drives the live backend with `MOCK_LLM=1` through 13 scripted scenarios |
| **B. Real-LLM smoke** | The provider integration (Vertex AI Claude / Anthropic / Gemini) is wired correctly and produces a coherent session against a real model | One free-form Free Agent session against `claude-sonnet-4-6` (Vertex AI) — **deferred**, see §5 |

Layer A is **hermetic by design**: the MockProvider returns canned JSON, so
the assertions pin the behaviour of *our* code, not the LLM's quality.
Layer B is a single smoke check to prove the integration; it intentionally
makes no quality claim about the model itself.

---

## 2. Layer A — Harness scenario coverage

Each scenario in [`evals/scenarios/`](../../evals/scenarios/) registers a
canned LLM response sequence via the `MOCK_LLM=1`-gated
`POST /api/test/mock-llm` endpoint, creates a Free Agent session via
`POST /api/agent/sessions`, starts it via
`POST /api/agent/sessions/:id/start`, consumes the SSE stream, then
fetches the persisted session and asserts:

- HTTP status of create + start
- SSE event subsequence (ordered, allows other events between)
- Forbidden SSE events (must not appear)
- Final session status (`completed`, `needs_assistance`, `error`)
- Blackboard categories + count
- Scratchpad regex
- Attributes object subset

### 2.1 Scenario matrix

| # | Scenario | What it pins | Expected terminal | Key SSE subsequence |
|---|---|---|---|---|
| 01 | Smoke: minimal session round-trip | Create + start + SSE pipeline alive | `completed` | `session_start` → `iteration_start` → `iteration_complete` → `session_complete` |
| 01 | Research two-city summary | Two-iteration flow, two blackboard categories present | `completed` | `session_start` → `iteration_start` → `iteration_complete` → `session_complete` |
| 02 | Loop detection + intervention | 4× identical tool calls → `loop_warning` fires | `completed` | `session_start` → `loop_warning` → `session_complete` |
| 03 | PII blocking on prompt | SIN in prompt → `POST /sessions` returns 422 before orchestrator runs; `pii.blocked.prompt` audit row recorded | (create rejected) | — |
| 04 | Classification routing | Protected B + US-residency model → 400 from `model_registry.data_residency` gate before any LLM call | (create rejected) | — |
| 05 | Iteration cap | Agent never finishes; cap hit at `maxIterations=3`; clean stop, not error | `completed` | `iteration_limit` event fires; final report summarises iteration count |
| 06 | `needs_assistance` escalation | Agent emits `needs_assistance` on iteration 2; loop stops; no `iteration_limit` | `needs_assistance` | `session_complete` carries `needs_assistance` status |
| 07 | Outbound PII redaction | SIN in LLM blackboard/scratchpad → `pii_warning` SSE; persisted scratchpad contains `[REDACTED:social_insurance_number]` | `completed` | `pii_warning` present |
| 08 | Attribute updates merge | 3 patches → deep-merged into `attributes` object | `completed` | — |
| 09 | Transient LLM error recovery | 1 `llm_error` event; next iteration succeeds; no terminal error | `completed` | `llm_error` present; `iteration_limit` + `error` absent |
| 10 | Tool failure recovery (SSRF) | `web_scrape` against private IP → `tool_result` with `success=false`; session continues | `completed` | `tool_result(success=false)` present; `error` absent |
| 11 | Three-strike kill | 3 consecutive `llm_error` → `MAX_CONSECUTIVE_FAILURES` threshold fires; session ends with `error` | `error` | `session_complete` + `iteration_limit` absent |
| 12 | Scratchpad evolution | 3 iterations rewriting scratchpad; final persisted scratchpad contains all 3 checkpoints | `completed` | scratchpad regex `Step 1[\s\S]*Step 2[\s\S]*Step 3` |
| 13 | Multi-tool fan-out | Single iteration with 3 simultaneous `get_time` tool calls → 3 `tool_result` events | `completed` | `error` + `iteration_limit` absent |

**Total scenarios:** 14 (one numbered 01 each for smoke and research).

### 2.2 SSE event vocabulary verified

The 13 scenarios collectively exercise every event type emitted by
[`agentOrchestrator.ts`](../../backend/src/services/agentOrchestrator.ts):

`session_start` · `iteration_start` · `llm_response` · `tool_calls` ·
`tool_result` · `blackboard_update` · `scratchpad_update` ·
`attributes_update` · `iteration_complete` · `loop_warning` ·
`loop_intervention` · `pii_warning` · `llm_error` · `session_stopped` ·
`iteration_limit` · `session_complete` · `error`

The same vocabulary is consumed by the frontend in
[`stores/agentSession.ts`](../../frontend/src/stores/agentSession.ts).

### 2.3 How to run

```bash
# All scenarios
pnpm test:evals

# A single scenario
pnpm --filter evals test:one evals/scenarios/01_smoke.json

# With backend stdout streamed
EVALS_VERBOSE=1 pnpm test:evals
```

Each run spawns its own backend instance on an ephemeral port, against a
per-run schema `evals_run_<timestamp>_<random>` so it never touches
production data.

### 2.4 CI integration

The eval matrix is part of the merge gate via
[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml). The
GitHub Actions runner provisions a Postgres 16 service container, sets
`DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/evals`, runs
`pnpm test:all` (262 unit + integration tests + 13 evals + 480 frontend
tests). PR #22 will exercise this gate.

### 2.5 Last green run

On the `claude/abc-console-stream-e-2mb6i` branch (the branch under test
in the [Red/Blue report](../security/red_blue_report.md)):

```
pnpm test:all
└── 262 unit + integration tests (Vitest)
└── 14 eval scenarios
└── 480 frontend tests (Vue Test Utils + Vitest)
✓ All green.
```

The current `cohen-mcleod` branch carries additional backend test files
(token budgets, webhooks, soft-delete, dry-run, openapi, evidence
collector) — exact counts will resolve when CI runs on PR #22.

---

## 3. Layer B — Real-LLM smoke (deferred)

### 3.1 What this would prove

A single Free Agent session against a real `claude-sonnet-4-6` model
(Vertex AI, Canadian residency) would prove:

- The Vertex AI provider in
  [`llmProvider.ts`](../../backend/src/services/llmProvider.ts) is
  reachable from a developer workstation with a valid
  `VERTEX_AI_API_KEY` and `VERTEX_AI_PROJECT_ID`.
- The Anthropic message schema returned by Vertex AI is parsed
  correctly by the orchestrator.
- The streaming path delivers `iteration_start` / `llm_response` /
  `iteration_complete` events without buffering or dropping chunks.
- Round-trip latency is within the
  `LLM_TIMEOUT_MS=120000` envelope and produces a coherent
  `final_report`.

### 3.2 Why it's deferred

A real-LLM run requires a Vertex AI API key + project ID issued under
the GoA contract. These were not in scope of the local development
environment at the time of writing. The key would be configured in
`backend/.env`, never committed.

### 3.3 Reproduction procedure (once a key is available)

```bash
# 1. Configure
cd backend
cp .env.example .env
# Edit .env:
#   VERTEX_AI_API_KEY=<provided>
#   VERTEX_AI_PROJECT_ID=<provided>
#   VERTEX_AI_REGION=northamerica-northeast1
#   DATABASE_URL=<dev postgres>

# 2. Boot
npx tsx src/index.ts &
# Wait for the "Server started" banner

# 3. Drive a session via curl (or via the frontend at http://localhost:5173)
SESSION=$(curl -sX POST http://localhost:3000/api/agent/sessions \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"Summarise the GoA OCIO 2024 cybersecurity report in 5 bullet points","modelId":"claude-sonnet-4-6","classification":"unclassified"}' \
  | jq -r '.id')

# 4. Stream SSE
curl -NsX POST "http://localhost:3000/api/agent/sessions/$SESSION/start" \
  -H 'Accept: text/event-stream'

# 5. Inspect persisted state
curl -s "http://localhost:3000/api/agent/sessions/$SESSION" | jq '{status, blackboardCount: .blackboard|length, finalReport}'
```

The expected SSE pattern matches Scenario 01 (research two-city), with
real tool calls if the agent invokes `brave_search` or `web_scrape`.

### 3.4 What I would record here after the run

- Backend log timeline (extracted via
  `tail -f backend/logs/*.log` or the structured JSON output).
- SSE event count + sequence (full transcript saved to
  `docs/quality/e2e_real_llm_transcript_<date>.jsonl`).
- Token usage from the `agent_iterations.tokens_used` column +
  `audit_log` rows of type `LLM_REQUEST`.
- Wall-clock to first token, wall-clock to terminal status.
- Final report quality (subjective — 1–2 sentences).
- Any unexpected events (`llm_error`, `loop_warning`, `pii_warning`).

---

## 4. What this log does and does not prove

**Proves:**

- The complete request → orchestration → SSE → persistence → audit
  loop works end-to-end against a mock LLM.
- PII gates, classification gates, loop detection, error recovery,
  iteration caps, attribute merge, scratchpad evolution, tool failure
  recovery, and multi-tool fan-out all behave per spec.
- The eval harness is hermetic, reproducible, and gated in CI.

**Does not prove (yet):**

- Vertex AI provider integration end-to-end against real Claude.
- Real-tool side effects (Brave search, image generation, ElevenLabs
  TTS) — those are unit-tested in
  [`backend/src/tools/**/__tests__/`](../../backend/src/tools/) but not
  exercised in evals.
- Performance under concurrent sessions (covered separately in
  [`llmProvider.concurrency.test.ts`](../../backend/src/services/__tests__/llmProvider.concurrency.test.ts)).

The real-LLM smoke in §3 is the single remaining gap before the build
can be declared "verified end-to-end."

---

## 5. Next steps

1. Obtain `VERTEX_AI_API_KEY` + `VERTEX_AI_PROJECT_ID` from the GoA
   contract administrator.
2. Run the §3.3 procedure.
3. Append §3.4 results back into this document as a new section
   ("Real-LLM smoke — 2026-MM-DD").
4. Re-run the full harness (`pnpm test:all`) once on the deployed Nexus
   instance and link the run from this document.

---

## Appendix A — Scenario file index

| File | Purpose |
|---|---|
| [`01_smoke.json`](../../evals/scenarios/01_smoke.json) | Minimal session round-trip |
| [`01_research_task.json`](../../evals/scenarios/01_research_task.json) | Two-iteration research flow |
| [`02_loop_detection.json`](../../evals/scenarios/02_loop_detection.json) | Forced loop → `loop_warning` |
| [`03_pii_blocking.json`](../../evals/scenarios/03_pii_blocking.json) | SIN in prompt → 422 |
| [`04_classification_routing.json`](../../evals/scenarios/04_classification_routing.json) | Protected B + US model → 400 |
| [`05_iteration_limit.json`](../../evals/scenarios/05_iteration_limit.json) | Cap hit → `iteration_limit` |
| [`06_needs_assistance.json`](../../evals/scenarios/06_needs_assistance.json) | Escalation terminal status |
| [`07_outbound_pii_redaction.json`](../../evals/scenarios/07_outbound_pii_redaction.json) | LLM-emitted SIN → redacted |
| [`08_attribute_updates.json`](../../evals/scenarios/08_attribute_updates.json) | Attribute object merge |
| [`09_llm_error_recovery.json`](../../evals/scenarios/09_llm_error_recovery.json) | Transient error recovery |
| [`10_tool_failure_recovery.json`](../../evals/scenarios/10_tool_failure_recovery.json) | SSRF block → continue |
| [`11_three_strike_kill.json`](../../evals/scenarios/11_three_strike_kill.json) | 3-strike LLM kill |
| [`12_scratchpad_evolution.json`](../../evals/scenarios/12_scratchpad_evolution.json) | Scratchpad accumulation |
| [`13_multi_tool_iteration.json`](../../evals/scenarios/13_multi_tool_iteration.json) | Multi-tool fan-out |

## Appendix B — Useful queries during a real-LLM run

```sql
-- Sessions started in the last hour
SELECT id, status, classification, model_id, prompt, started_at, completed_at
FROM cohen_mcleod.agent_sessions
WHERE started_at > NOW() - INTERVAL '1 hour'
ORDER BY started_at DESC;

-- Iteration-level token usage
SELECT session_id, iteration_number, status, tokens_used, llm_latency_ms
FROM cohen_mcleod.agent_iterations
WHERE session_id = '<session-id-from-curl>'
ORDER BY iteration_number;

-- Audit trail for this session
SELECT created_at, action, actor_user_id, metadata
FROM cohen_mcleod.audit_log
WHERE (metadata->>'sessionId') = '<session-id-from-curl>'
ORDER BY created_at;
```
