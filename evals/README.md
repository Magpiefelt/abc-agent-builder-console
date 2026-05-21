# Evals Harness

End-to-end behaviour tests for the ABC Agent Builder Console. The harness
spawns a real backend instance against `MOCK_LLM=1`, drives sessions through
the HTTP + SSE API, and asserts that the observed event stream and final
state match the scenario's expectations.

## What's tested

| Scenario | Tests |
|---|---|
| `01_research_task.json` | Two-iteration research flow → blackboard categories + completed status |
| `02_loop_detection.json` | Forced 4× identical tool calls → `loop_warning` SSE event |
| `03_pii_blocking.json` | SIN in prompt → 422 + PII detection list |
| `04_classification_routing.json` | Protected B + US-residency model → 400 from classification gate |

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
