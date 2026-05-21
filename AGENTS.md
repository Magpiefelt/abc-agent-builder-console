# AGENTS.md — ABC Agent Builder Console

## Project Context

This is a **greenfield rebuild** of the Agent Builder Console (ABC), an agentic workflow canvas tool for the Government of Alberta. The existing prototype at `AgentBuilderConsole.com` (source: `https://github.com/developmentation/agent-builder-console`) serves as the **living functional specification** — we are rebuilding its capabilities from scratch on the GoA standard stack.

**Do NOT migrate or copy code from the original.** Use it only as a reference for what features and behaviors to implement.

## Technology Stack

| Layer | Technology |
|-------|------------|
| Frontend | Vue.js 3 (Composition API) + TypeScript + Vite + Tailwind CSS |
| Backend | Node.js 22 + Express 5 + TypeScript |
| Database | PostgreSQL (Render shared instance, schema: `cohen_mcleod`) |
| Authentication | Microsoft Entra ID (OIDC/OAuth2) |
| Styling | Alberta Design System (https://design.alberta.ca) + Tailwind |
| Canvas | Vue Flow (for workflow visualization) |
| LLM | Vertex AI (Claude) + configurable model registry |

## Architecture Principle

**Thin Client / Thick Server.** The frontend is a pure presentation layer. It holds NO secrets, performs NO orchestration, and makes NO direct external API calls. All intelligence, state management, and tool execution happens on the Node.js backend.

## Current State (Phase 2 Complete)

**Phase 1 (Foundation)** and **Phase 2 (Orchestration Engine)** are complete.

Phase 1 deliverables:
- Express backend with security middleware (Helmet, CORS, rate limiting)
- Authentication middleware structure (Entra ID JWT with dev mock)
- PII detection service
- Audit logging service
- Health check and agent session API stubs
- Vue.js 3 frontend with Alberta DS tokens, routing, and three-panel layout

Phase 2 deliverables (2026-05-21):
- `backend/src/services/llmProvider.ts` — LLM Provider Factory (Vertex AI Claude + Google Gemini)
- `backend/src/services/promptBuilder.ts` — Dynamic system prompt builder from template + runtime state
- `backend/src/services/loopDetector.ts` — 4-level loop detection algorithm
- `backend/src/services/toolDispatcher.ts` — Central tool routing (memory tools + edge tool stubs)
- `backend/src/services/agentOrchestrator.ts` — Core server-side iteration loop with SSE streaming
- `backend/src/data/systemPromptTemplate.json` — Configurable prompt template sections
- `backend/src/data/toolsManifest.json` — 26 tool definitions across 8 categories
- `backend/src/routes/agent.ts` — Full agent API (6 endpoints + model registry)

All TypeScript compiles cleanly with `tsc --noEmit` (zero errors).

## Running the Application

```bash
# Backend (port 3000)
cd backend && pnpm install && npx tsx src/index.ts

# Frontend (port 5173)
cd frontend && pnpm install && npx vite --host 0.0.0.0
```

## Database

Connection string (from exercise): See `.env.example` in `backend/`.
Schema: `cohen_mcleod`
Migration script: `docs/02_database_migrations.sql`

## Key Files

| File | Purpose |
|------|---------|
| `backend/src/index.ts` | Express app entry point with all middleware |
| `backend/src/middleware/auth.ts` | Entra ID authentication + RBAC |
| `backend/src/services/piiDetector.ts` | PII scanning before LLM calls |
| `backend/src/services/auditLogger.ts` | Immutable audit trail |
| `backend/src/routes/agent.ts` | Free Agent session API (6 endpoints + models) |
| `backend/src/services/llmProvider.ts` | LLM Provider Factory (Claude + Gemini) |
| `backend/src/services/agentOrchestrator.ts` | Core iteration loop + SSE streaming |
| `backend/src/services/promptBuilder.ts` | Dynamic system prompt assembly |
| `backend/src/services/loopDetector.ts` | 4-level loop detection |
| `backend/src/services/toolDispatcher.ts` | Tool call routing + memory tools |
| `frontend/src/views/FreeAgentView.vue` | Main agent interface |
| `frontend/src/components/AppHeader.vue` | GoA-branded navigation |
| `docs/01_ABC_Rebuild_Plan.md` | Full build-out plan |
| `docs/03_ABC_Deep_Architecture_Review.md` | Deep review of original app |

## Remaining Build Phases

See `docs/PHASE_INSTRUCTIONS.md` for detailed instructions for each phase.

**Next: Phase 3 (Tool Ecosystem)** — Implement the 19 edge tools as real handlers in `backend/src/tools/`. The dispatcher is ready to route to them.
