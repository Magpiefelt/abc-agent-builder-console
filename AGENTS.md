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
| LLM | Vertex AI (Claude) + Google Gemini + configurable model registry |

## Architecture Principle

**Thin Client / Thick Server.** The frontend is a pure presentation layer. It holds NO secrets, performs NO orchestration, and makes NO direct external API calls. All intelligence, state management, and tool execution happens on the Node.js backend.

## Current State (Streams A–F Substantially Complete)

All six parallel work streams have been implemented. The application is feature-complete and awaiting final deployment.

| Stream | Title | Status |
|--------|-------|--------|
| **A** | Identity, SSO & User Memory | **COMPLETE** — Entra ID OIDC, session cookies, user preferences, saved prompts, workflow favorites |
| **B** | Free Agent UX & Real-Time Streaming | **COMPLETE** — Pinia stores, SSE consumer, memory viewers, prompt customizer, Vue Flow agent canvas |
| **C** | Workflow Canvas (Vue Flow + Executor) | **COMPLETE** — Visual builder, topological executor, versioning, execution history, duplicate/restore |
| **D** | Tool Ecosystem + Ent Tools | **COMPLETE** — All 20 edge tools registered, Ent Tools client for Brave/Image, secrets vault integration |
| **E** | Quality: Tests, Evals, Accessibility | **COMPLETE** — 689 backend tests + 480 frontend tests (1,169 total, 2 todo) across 95 files, 14 eval scenarios, Red/Blue report, CI workflow. Counts grow as new slices land — run `pnpm --recursive run test` for the live figure. |
| **F** | Compliance, Privacy & Admin | **COMPLETE** — STRIDE threat model, PIA, retention job, admin UI, Nexus manifest, deploy workflow |

### Backend Services (all built)
- `agentOrchestrator.ts` — 714-line iteration loop with SSE, PII, loop detection
- `llmProvider.ts` — Anthropic + Gemini providers, streaming, retry, model registry cache
- `promptBuilder.ts` — Dynamic prompt assembly from template + runtime state
- `loopDetector.ts` — 5-level detection patterns, escalating interventions
- `toolDispatcher.ts` — Registration pattern, timeout enforcement, result normalization
- `workflowExecutor.ts` — Topological graph walker with branch pruning
- `functionRegistry.ts` — 44 deterministic functions across 5 categories
- `entraAuth.ts` — JWKS-cached JWT verification, PKCE, session cookies
- `secretsVault.ts` — pgcrypto-backed per-user encrypted secret store
- `retentionJob.ts` — Classification-aware scheduled cleanup (90d / 1y / 3y)
- `logger.ts` — Structured JSON logging
- `processMonitor.ts` — Unhandled rejection/exception handling, graceful shutdown
- `auditLogger.ts` — Enum-based audit actions, query helpers

### Frontend (all built)
- **Free Agent:** TaskPanel, ControlBar, IterationTimeline, BlackboardViewer, ScratchpadViewer, ArtifactsPanel, PromptCustomizer, AgentCanvas, InterjectionModal, FinalReportPanel
- **Workflow:** WorkflowCanvas (Vue Flow), WorkflowSidebar, PropertiesPanel, WorkflowToolbar, WorkflowHistoryPanel, ExecutionPanel, 4 custom node types
- **Admin:** AuditLogViewer, PIIDetectionViewer, ModelRegistryEditor, SessionInspector, HealthDiagnostics
- **Auth/User:** LoginView, ProfileView, auth store, userMemory store, auth guard
- **Stores:** agentSession (SSE reducer), workflow (CRUD + execution), auth, models, userMemory

### Edge Tools (20/20 registered)
`brave_search`, `google_search`, `web_scrape`, `read_github_repo`, `read_github_file`, `pdf_extract_text`, `pdf_info`, `ocr_image`, `read_zip_contents`, `read_zip_file`, `extract_zip_files`, `get_call_api`, `post_call_api`, `execute_sql`, `read_database_schemas`, `image_generation`, `elevenlabs_tts`, `get_time`, `get_weather`, `send_email`

### Tool Registration Pattern
Tools are registered at startup in `index.ts` via `registerAllTools()` from `tools/register.ts`. To add a new tool:
1. Create handler in `backend/src/tools/`
2. Add tool name to the tools manifest in `backend/src/data/toolsManifest.json`
3. Import and register in `tools/register.ts`

## Running the Application

```bash
# Backend (port 3000)
cd backend && pnpm install && pnpm dev

# Frontend (port 5173)
cd frontend && pnpm install && pnpm dev
```

The Vite proxy already forwards `/api/*` to `http://localhost:3000`.

Required env (see `backend/.env.example`): `DATABASE_URL`, `ANTHROPIC_API_KEY` or `VERTEX_AI_API_KEY`. Everything else is optional and the corresponding tools fail gracefully.

## Database

Connection string (from exercise): See `.env.example` in `backend/`.
Schema: `cohen_mcleod`
Migration script: `docs/02_database_migrations.sql`

## Key Files

| File | Purpose |
|------|---------|
| `backend/src/index.ts` | Express app entry point with all middleware |
| `backend/src/middleware/auth.ts` | Entra ID authentication + RBAC (dev mock in NODE_ENV=development) |
| `backend/src/services/entraAuth.ts` | JWKS verification, PKCE, session JWT, user upsert |
| `backend/src/services/agentOrchestrator.ts` | Core iteration loop + SSE streaming |
| `backend/src/services/workflowExecutor.ts` | Topological graph executor |
| `backend/src/services/llmProvider.ts` | LLM Provider Factory (Claude + Gemini) |
| `backend/src/services/piiDetector.ts` | PII scanning before LLM calls |
| `backend/src/services/auditLogger.ts` | Immutable audit trail |
| `backend/src/services/secretsVault.ts` | Per-user encrypted secret store |
| `backend/src/services/retentionJob.ts` | Classification-aware data lifecycle |
| `backend/src/routes/agent.ts` | Free Agent session API (create, start, stop, continue, interject, models, prompt-template) |
| `backend/src/routes/workflow.ts` | Workflow CRUD + execute + versions + executions |
| `backend/src/routes/auth.ts` | Login/callback/logout/me |
| `backend/src/routes/users.ts` | Preferences, saved prompts, favorites, recent sessions, secrets |
| `backend/src/routes/admin.ts` | Audit, PII, models, sessions, retention |
| `frontend/src/stores/agentSession.ts` | Session state machine + SSE event reducer |
| `frontend/src/stores/workflow.ts` | Workflow canvas + execution state |
| `frontend/src/composables/useSSEStream.ts` | POST-based SSE consumer |
| `docs/00_MASTER_PLAN.md` | **Start here.** Consolidated build plan + 6 parallel work streams |
| `docs/02_database_migrations.sql` | Schema + seed (idempotent, additive) |
| `docs/review/` | Code review report, next phases plan, enhancement recommendations |

## What to Build Next

Most items from the original enhancement list have shipped (ExecutionPanel import, ministry filter, model-registry-driven dropdowns in WorkflowView, agentSession test conversion, session replay via `/sessions/:id`). Remaining work:

1. **End-to-end verification with real LLM** — Run a complete session against Vertex AI and document results in `docs/quality/e2e_verification_log.md`.
2. **Expand agent templates** — Add GoA-specific templates (Policy Drafter, FOIP Reviewer, Briefing Note Writer).
3. **Outbound PII scan** — Scan LLM responses before streaming to client.
4. **UX polish** — Remaining P2/P3 items called out in `docs/review/ux_apply_2026-05-22.md` (container migration on PIIDetectionViewer/ModelRegistryEditor/SessionInspector/HealthDiagnostics, canvas node differentiation, `goa-pagination` for AuditLogViewer).
5. **Footer link targets** — `goa-microsite-header` feedback URL and the broken `/privacy`/`/accessibility`/`/disclaimer` placeholders are removed; wire real destinations once the GoA pages are confirmed.

## Critical Constraints

1. No secrets in frontend. The Vue app never sees API keys.
2. All orchestration on backend. Frontend only renders and streams.
3. PII scanning before every LLM call. Use `piiDetector.ts`.
4. Audit every action. Use `auditLogger.ts` with `AuditAction` enum.
5. Ministry scoping on all queries. Filter by `ministry_code`.
6. Alberta Design System for all UI. Follow https://design.alberta.ca
7. No browser spoofing in web scraping. Identify as GoA bot.
8. Parameterized queries only. Never concatenate user input into SQL.
9. All logging through `logger.ts`. No raw `console.log`.
10. Tool handlers must return `{ success: boolean; ...data; error?: string }`.

## Original App Reference

Use these files from the original repo for behavioral reference only:
- `src/hooks/useFreeAgentSession.ts` — Agent loop logic (2,130 lines)
- `supabase/functions/free-agent/index.ts` — LLM + tool dispatch (1,279 lines)
- `public/data/systemPromptTemplate.json` — Prompt structure
- `public/data/toolsManifest.json` — 36 tool definitions
- `src/lib/loopDetector.ts` — Loop detection algorithm
- `src/lib/functionDefinitions.ts` — Function catalog

Clone reference: `git clone https://github.com/developmentation/agent-builder-console.git`
