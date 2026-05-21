# ABC Evals

Scenario-based evals that drive a running ABC backend via HTTP + SSE and compare
the observed event stream against an expected outcome envelope. Used both for
regression testing (CI) and for the exercise's peer-review evidence package.

## Quick start

```bash
# 1. Start the backend (or point BASE_URL at any running instance)
cd backend && pnpm dev

# 2. In another shell, run a scenario
cd evals
BASE_URL=http://localhost:3000 npx tsx runners/scenarioRunner.ts scenarios/03_pii_blocking.json
```

The runner exits 0 when every expectation matches, non-zero on the first miss
(with a diff printed to stderr).

## Scenario file shape

Each scenario is a JSON file with this structure:

```jsonc
{
  "name": "Short human label",
  "description": "What this scenario proves.",
  "request": {
    "prompt": "User-facing prompt to send.",
    "modelId": "claude-haiku-4-5",
    "classification": "unclassified",
    "maxIterations": 5
  },
  "llmMock": "1",          // optional: forces LLM_MOCK=1 server-side (deterministic)
  "expect": {
    "creationStatus": 200, // or 400 for prompts the API should reject up front
    "events": {
      "mustContain": ["session_start", "iteration_start"],
      "mustNotContain": ["session_complete"]
    },
    "finalStatus": "stopped",  // or "completed" / "needs_assistance" / "error"
    "piiDetected": false       // assert presence/absence of pii_warning events
  }
}
```

The runner does NOT call any real LLM provider unless your backend has one
configured. The default scenarios assume `LLM_MOCK=1` is set so they run with
no external dependencies.

## Authoring guidance

- Keep each scenario laser-focused on one acceptance criterion. Loop detection
  belongs in a separate file from PII blocking, even if both fit in one run.
- Prefer assertions on event *types* rather than full event payloads — the
  orchestrator's event vocabulary is stable, the payload shapes evolve.
- For attack-style scenarios (SSRF, prompt injection, ministry leak), assert on
  audit-log side effects too — the audit row is the durable evidence the ATO
  reviewer cares about.

## Files

| Path | Purpose |
|------|---------|
| `runners/scenarioRunner.ts` | The runner — talks to the backend, parses SSE, applies expectations |
| `scenarios/01_smoke.json` | Smallest possible session that streams `session_start` + `session_complete` |
| `scenarios/02_loop_detection.json` | Forces an LLM_MOCK loop and asserts a `loop_warning` event |
| `scenarios/03_pii_blocking.json` | Sends a Luhn-valid SIN and asserts the LLM is never called |
| `scenarios/04_workflow_pipeline.json` | (Stream C) walks a small workflow graph end-to-end |
