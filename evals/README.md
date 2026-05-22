# Evals Harness

End-to-end behaviour tests for the ABC Agent Builder Console. The harness
spawns a real backend instance against `MOCK_LLM=1`, drives sessions through
the HTTP + SSE API, and asserts that the observed event stream and final
state match the scenario's expectations.

## What's tested

| Scenario | Tests |
|---|---|
| `01_smoke.json` | Minimal session round-trip → create + start succeed, SSE delivers `iteration_started` → `iteration_completed` → `session_completed`, status persists as `completed` |
| `01_research_task.json` | Two-iteration research flow → blackboard categories + completed status |
| `02_loop_detection.json` | Forced 4× identical tool calls → `loop_warning` SSE event |
| `03_pii_blocking.json` | SIN in prompt → 422 + PII detection list |
| `04_classification_routing.json` | Protected B + US-residency model → 400 from classification gate |
| `05_iteration_limit.json` | Agent never finishes → `iteration_limit` SSE event + status=completed at the cap |
| `06_needs_assistance.json` | LLM emits `needs_assistance` → terminal status preserved, no iteration cap hit |
| `07_outbound_pii_redaction.json` | SIN in LLM blackboard/scratchpad → `pii_warning` + `[REDACTED:social_insurance_number]` markers |
| `08_attribute_updates.json` | Three `attribute_updates` patches merge into the persisted attributes object |
| `09_llm_error_recovery.json` | Transient LLM failure → `llm_error` event, no session error, recovers on next iteration |
| `10_tool_failure_recovery.json` | SSRF-blocked `web_scrape` → `tool_result` with `success=false`, session continues to completion |
| `11_three_strike_kill.json` | 3 consecutive `llm_error` events → MAX_CONSECUTIVE_FAILURES kill threshold fires, session ends with status=error |
| `12_scratchpad_evolution.json` | Three iterations rewriting the scratchpad with growing content → final persisted scratchpad contains all three checkpoints |
| `13_multi_tool_iteration.json` | Single iteration with 3 simultaneous `get_time` calls → 3 `tool_result` events fan out, session completes |

## Running

```bash
# From the repo root
pnpm test:evals

# Or run a single scenario
pnpm --filter evals test:one evals/scenarios/01_research_task.json
```

Add `EVALS_VERBOSE=1` to stream the spawned backend's stdout/stderr.

## Requirements

- Node 22+
- A reachable Postgres instance. The harness writes to a per-run schema
  `evals_run_<timestamp>` so it never touches production tables.
  - Locally: `DATABASE_URL` must point to a development Postgres
    (testcontainers can be used by the backend's vitest integration tests
    but the evals harness expects a regular `DATABASE_URL`).
  - In CI: GitHub Actions provisions a Postgres service container; set
    `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/evals`.

The harness sets `MOCK_LLM=1` on the spawned backend, which:

1. Activates the `MockProvider` in `backend/src/services/llmProvider.ts`.
2. Mounts the test-only `POST /api/test/mock-llm` route so the harness can
   register canned responses by sessionId.
3. The provider union and prod code paths are untouched — `MOCK_LLM` is
   ignored everywhere else.

## Adding a scenario

1. Drop a JSON file into `evals/scenarios/`. The runner validates it via
   Zod against the schema in `runners/scenarioRunner.ts`. Fields:
   - `name` (string)
   - `description` (string)
   - `prompt` (string) — the user task; must NOT contain PII unless you
     are explicitly testing PII blocking.
   - `modelId` (default `"mock-llm"`)
   - `classification` (default `"unclassified"`)
   - `maxIterations` (integer 1-100, optional) — forwarded to `POST /sessions`.
     Use a small value (e.g. 3) when pinning the iteration-cap path so the
     scenario terminates quickly.
   - `llmResponses` (array of canned responses; each can have `thinking`,
     `toolCalls`, `blackboardUpdates`, `scratchpad`, `attributeUpdates`,
     `status`, `userMessage`, `error`, `usage`)
   - `expectations` (object):
     - `createStatus` / `startStatus` — expected HTTP codes
     - `sseSubsequence` — SSE event types that must appear in this order
     - `sseAbsent` — SSE event types that must NOT appear
     - `blackboardCategories` — categories that must be present after run
     - `finalStatus` — terminal session status
     - `blackboardCount` — exact number or `{ min, max }` range
     - `errorMatches` — regex against the response body for negative cases
     - `expectCreateRejection` — true if the scenario expects the
       `POST /sessions` to fail before the orchestrator runs
     - `scratchpadMatches` (regex string, case-insensitive) — asserts
       against the final persisted scratchpad. Useful for PII redaction
       checks.
     - `attributesContain` (object) — required key/value subset of the
       final persisted attributes object. Equality is deep, via JSON
       comparison.
     - `iterationLimitMessageContains` (substring, case-insensitive) —
       when set, requires an `iteration_limit` SSE event whose `message`
       field contains the substring.
2. Run `pnpm test:evals` to verify.
3. Add a one-line description to the table above.

## Mocking strategy

Each canned response in `llmResponses` is delivered to the orchestrator
when it calls `callLLM(modelId, request)` with `sessionId` set. The
`MockProvider` consumes them in order and emits them as a structured
LLMResponse. The orchestrator parses the JSON content, applies tool calls
and memory updates, and streams SSE events. The harness collects every
SSE chunk, then fetches `GET /sessions/:id` to read the persisted final
state.

## Non-goals

- **No live LLM calls.** The harness is hermetic; it never reaches Vertex
  AI, Anthropic, Google AI, or any external tool API.
- **No browser testing.** UI behaviour is covered by `frontend/test/`.
- **No regression of LLM quality.** Mock responses are deterministic by
  construction; this harness verifies the SCAFFOLDING around the LLM
  (orchestration, PII gating, classification routing, SSE shape, audit
  trail), not the LLM's reasoning ability.
