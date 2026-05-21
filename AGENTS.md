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
- `backend/src/services/loopDetector.ts` — 5-level loop detection algorithm
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
| `backend/src/middleware/auth.ts` | Entra ID authentication + RBAC (dev mock active) |
| `backend/src/services/piiDetector.ts` | PII scanning before LLM calls |
| `backend/src/services/auditLogger.ts` | Immutable audit trail |
| `backend/src/routes/agent.ts` | Free Agent session API (6 endpoints + models) |
| `backend/src/services/llmProvider.ts` | LLM Provider Factory (Claude + Gemini) |
| `backend/src/services/agentOrchestrator.ts` | Core iteration loop + SSE streaming |
| `backend/src/services/promptBuilder.ts` | Dynamic system prompt assembly |
| `backend/src/services/loopDetector.ts` | 5-level loop detection |
| `backend/src/services/toolDispatcher.ts` | Tool call routing + memory tools |
| `backend/src/tools/*` | 15/20 edge tools implemented (search, scrape, github, pdf, zip, api, time/weather) |
| `frontend/src/views/FreeAgentView.vue` | Main agent interface (layout only, no SSE consumer yet) |
| `frontend/src/components/AppHeader.vue` | GoA-branded navigation (hardcoded user) |
| `docs/00_MASTER_PLAN.md` | **Start here.** Consolidated build plan + 6 parallel work streams |
| `docs/02_database_migrations.sql` | Schema + seed (idempotent, additive) |
| `docs/architecture_*.png` | Current / target / rebuild architecture diagrams |

## Next Steps

Read **`docs/00_MASTER_PLAN.md`** before picking up work. It describes the remaining build as six independently runnable streams:

- **Stream A** — Identity, SSO & User Memory (real Entra ID JWT, saved prompts, favorites)
- **Stream B** — Free Agent UX & Real-Time Streaming (Pinia + SSE + memory viewers + Vue Flow canvas)
- **Stream C** — Workflow Canvas (Vue Flow nodes + backend executor + CRUD)
- **Stream D** — Tool Ecosystem Completion + Ent Tools Integration (SQL, image gen, TTS, email, OCR)
- **Stream E** — Quality: Tests, Evals, Accessibility & Red/Blue Agent reports
- **Stream F** — Compliance, Privacy Hardening & Nexus Deployment (STRA/SOAR, admin UI, retention)

Each stream lists files to create / modify, tasks, dependencies, and acceptance criteria.
