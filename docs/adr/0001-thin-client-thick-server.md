# ADR-0001: Thin client, thick server

- **Status:** Accepted
- **Date:** 2026-05-22
- **Deciders:** ABC core engineering

## Context

ABC orchestrates LLM calls, dispatches tools, scans for PII, enforces
classification rules, signs audit entries, and holds long-lived agent
session state. The spec app this project ports from (`AgentBuilderConsole.com`)
ran most of that in the browser — the React frontend stored conversation
state, made LLM calls directly, and held tool credentials in browser
storage. That architecture is incompatible with Government of Alberta
security expectations:

- **Protected B data** must not transit through user-controlled software
  (browsers run extensions, can be screen-recorded, and dump memory under
  debug).
- **API keys** for upstream providers (Vertex AI, Brave Search, Anthropic
  direct, ElevenLabs) cannot land in a frontend bundle — they're either
  trivially extractable or leaked via DevTools network panels.
- **Audit log integrity** requires writes to come from a single trusted
  process; a browser-emitted audit row is forge-able by anyone with the
  page open.
- **Ministry scoping** must be enforced server-side, not as a UI filter
  — a frontend filter is an empty gesture against anyone using `curl`.

## Decision

The browser renders and streams. The backend holds **all** state, secrets,
orchestration, and trust decisions. There are no exceptions.

Concretely:

- All LLM calls originate from `backend/src/services/llmProvider.ts`. The
  frontend never embeds a provider key, never hits Anthropic / Vertex AI /
  Google AI directly.
- Agent orchestration (iteration loop, blackboard, scratchpad, attributes,
  tool dispatch) lives in `backend/src/services/agentOrchestrator.ts`.
- Tool credentials sit in `backend/src/services/secretsVault.ts`, encrypted
  with pgcrypto under `SECRETS_VAULT_KEY`.
- PII scanning runs in `backend/src/services/piiDetector.ts` before every
  outbound prompt and after every inbound response.
- Classification gating, ministry scoping, RBAC checks, and audit logging
  are server-side middleware (`backend/src/middleware/auth.ts`,
  `backend/src/services/auditLogger.ts`).
- The frontend's only persistent state is the auth cookie and the Pinia
  store hydrated from server responses. Any "client-only" optimization
  that requires holding sensitive data is rejected.

The communication contract:

- **Browser → Server:** JSON over HTTPS, credentialed via the
  `abc_session` cookie.
- **Server → Browser:** JSON for static fetches; Server-Sent Events for
  streaming agent/workflow execution. See ADR-0004 for the SSE-vs-WebSockets
  decision.

## Consequences

**Positive.**

- A compromised browser cannot leak provider keys, ministry data from other
  users, or audit-altered agent runs — the attack surface is bounded to the
  user's own data.
- The same backend can serve a future mobile / CLI / IDE-extension client
  without rebuilding orchestration.
- Audit trail integrity is enforceable: every write is server-attributed.
- Compliance review is tractable: one process, one log stream, one secret
  store. Reviewers don't have to audit the bundle.

**Negative.**

- More round-trips. A workflow execution that could happen entirely in the
  browser now needs a server SSE stream. Mitigated by SSE — see ADR-0004.
- Backend is on the critical path. A crashed backend = a frozen UI. Mitigated
  by `services/processMonitor.ts` (unhandled-rejection handlers) and the
  health endpoint split (B5).
- Some interactions feel slower than a pure-frontend port would. Acceptable
  trade-off for the security gains.

## Alternatives considered

1. **Frontend-orchestrated** (the spec app's pattern). Rejected for the
   reasons in Context.
2. **Hybrid: frontend orchestrates, backend signs/audits.** Rejected because
   the frontend would still hold provider keys and the audit row would still
   be browser-emitted, defeating the integrity goal.
3. **Edge functions (Cloudflare Workers or similar) as the orchestrator.**
   Rejected because Protected B data residency requires Canada-hosted
   processing, and edge functions complicate the audit-log/database write
   path.
