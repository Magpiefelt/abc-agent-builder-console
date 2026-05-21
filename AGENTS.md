# AGENTS.md — ABC Agent Builder Console

## Project Context

This is a **greenfield rebuild** of the Agent Builder Console (ABC), an agentic workflow canvas tool for the Government of Alberta. The existing prototype at `AgentBuilderConsole.com` (source: `https://github.com/developmentation/agent-builder-console`) serves as the **living functional specification** — we are rebuilding its capabilities from scratch on the GoA standard stack.

**Do NOT migrate or copy code from the original.** Use it only as a reference for what features and behaviors to implement.

## Technology Stack

| Layer | Technology |
|-------|------------|
| Frontend | Vue.js 3 (Composition API) + TypeScript + Vite + Tailwind CSS + Alberta Design System |
| Backend | Node.js 22 + Express 5 + TypeScript |
| Database | PostgreSQL (Render shared instance, schema: `cohen_mcleod`) |
| Authentication | Microsoft Entra ID (OIDC/OAuth2) via `jose` + `jwks-rsa` |
| Styling | Alberta Design System (https://design.alberta.ca) + Tailwind |
| Canvas | Vue Flow (for workflow visualization) |
| LLM | Vertex AI (Claude) + Google Gemini fallback + configurable model registry |
| Tests | Vitest + Vue Test Utils + jsdom + axe-core |
| Deployment | GitHub Actions → Nexus (GoA platform) |

## Architecture Principle

**Thin Client / Thick Server.** The frontend is a pure presentation layer. It holds NO secrets, performs NO orchestration, and makes NO direct external API calls. All intelligence, state management, and tool execution happens on the Node.js backend.

## Current State (as of 2026-05-21)

All six parallel work streams are substantially complete. Phases 1–5 are feature-complete; Phase 6 (Compliance) documentation and the Nexus deployment are the main remaining items.

### What's Built

**Backend (`backend/src/`)**

| Layer | Files | Status |
|-------|-------|--------|
| Entry + middleware stack | `index.ts`, `middleware/requestValidation.ts`, `middleware/agentRateLimit.ts` | ✅ Complete |
| Config | `config/env.ts` (Zod), `config/database.ts` (pool + slow-query logging) | ✅ Complete |
| Auth | `middleware/auth.ts`, `services/entraAuth.ts` | ✅ Dev mock + real Entra ID JWT validation |
| Routes | `routes/auth.ts`, `routes/agent.ts`, `routes/users.ts`, `routes/workflow.ts`, `routes/admin.ts`, `routes/health.ts` | ✅ Complete |
| Privacy | `services/piiDetector.ts` (12 patterns), `services/auditLogger.ts` | ✅ Complete |
| LLM | `services/llmProvider.ts` (Anthropic + Vertex AI + Gemini, retry, streaming) | ✅ Complete |
| Orchestration | `services/agentOrchestrator.ts`, `services/promptBuilder.ts`, `services/loopDetector.ts`, `services/toolDispatcher.ts` | ✅ Complete |
| Tools (20/20) | `tools/webSearch.ts`, `tools/webScrape.ts`, `tools/github.ts`, `tools/documents.ts`, `tools/apiProxy.ts`, `tools/utilities.ts`, `tools/database.ts`, `tools/generation.ts`, `tools/communication.ts` | ✅ Complete |
| Workflow | `services/workflowExecutor.ts`, `services/functionRegistry.ts` | ✅ Complete |
| Compliance | `services/retentionJob.ts`, `services/secretsVault.ts`, `services/entToolsClient.ts` | ✅ Complete |

**Frontend (`frontend/src/`)**

| Layer | Files | Status |
|-------|-------|--------|
| App shell + routing | `App.vue`, `main.ts`, `router/index.ts` | ✅ Complete |
| Views | `FreeAgentView.vue`, `WorkflowView.vue`, `WorkflowListView.vue`, `AdminView.vue`, `LoginView.vue`, `ProfileView.vue` | ✅ Complete |
| Free Agent components | `TaskPanel`, `ControlBar`, `IterationTimeline`, `BlackboardViewer`, `ScratchpadViewer`, `ArtifactsPanel`, `PromptCustomizer`, `AgentCanvas`, `InterjectionModal`, `FinalReportPanel` | ✅ Complete |
| Workflow components | `WorkflowCanvas`, `WorkflowSidebar`, `PropertiesPanel`, `WorkflowToolbar`, `ExecutionPanel`, `WorkflowHistoryPanel` | ✅ Complete |
| Workflow nodes | `AgentNode`, `FunctionNode`, `ToolNode`, `NoteNode` | ✅ Complete |
| Admin components | `AuditLogViewer`, `HealthDiagnostics`, `ModelRegistryEditor`, `PIIDetectionViewer`, `SessionInspector` | ✅ Complete |
| Pinia stores | `auth`, `agentSession`, `workflow`, `userMemory`, `models` | ✅ Complete |
| Composables | `useSSEStream`, `useApiFetch`, `useAuthGuard`, `useMarkdown`, `useToast`, `useFocusTrap` | ✅ Complete |

**Database (`docs/02_database_migrations.sql`)**

Schema + seed (idempotent, `IF NOT EXISTS`):
- **Planning tables (5):** `features` (103 rows), `vulnerabilities` (10 rows), `migration` (35 rows), `plan` (35 rows), `privacy_controls` (10 rows)
- **Application tables (9):** `users`, `model_registry`, `workflows`, `agent_sessions`, `agent_iterations`, `artifacts`, `audit_log`, `pii_detections`
- **Stream A tables:** `user_preferences`, `saved_prompts`, `workflow_favorites`
- **Stream C tables:** `workflow_versions`, `workflow_executions`
- **Stream F tables:** `user_secrets`, `retention_policy`

**Tests**

| Suite | Count | Status |
|-------|-------|--------|
| Backend unit (Vitest) | 394 tests across 24 files | ✅ All passing |
| Frontend unit (Vitest + Vue Test Utils) | 56 tests across 9 files | ✅ All passing |
| Accessibility (axe-core) | 2 tests | ✅ All passing |
| Evals (scenario runner) | 5 JSON scenarios | ✅ All valid format |

**Documentation**

| Doc | Location | Status |
|-----|----------|--------|
| Master plan | `docs/00_MASTER_PLAN.md` | ✅ |
| DB migrations | `docs/02_database_migrations.sql` | ✅ |
| STRIDE threat model | `docs/security/threat_model_stride.md` | ✅ |
| Data flow diagram | `docs/security/data_flow_diagram.md` | ✅ |
| Controls matrix | `docs/security/controls_matrix.md` | ✅ |
| Red/Blue report | `docs/security/red_blue_report.md` | ✅ |
| PIA | `docs/privacy/pia.md` | ✅ |
| Retention schedule | `docs/privacy/retention_schedule.md` | ✅ |
| Accessibility audit | `docs/quality/accessibility_audit.md` | ✅ |
| Nexus deployment runbook | `docs/operations/deployment_nexus.md` | ✅ |
| Incident response | `docs/operations/incident_response.md` | ✅ |
| Key rotation | `docs/operations/key_rotation.md` | ✅ |
| Observability | `docs/operations/observability.md` | ✅ |

**Deployment**

- `.github/workflows/ci.yml` — lint + type-check + test on push/PR
- `.github/workflows/deploy.yml` — build artifacts + Nexus publish
- `nexus/manifest.yaml` — GoA Nexus app declaration

## Running the Application

```bash
# Install (monorepo root)
pnpm install

# Backend (port 3000)
cd backend && pnpm dev

# Frontend (port 5173)
cd frontend && pnpm dev

# Run all tests
pnpm test

# Type-check
pnpm type-check
```

The Vite proxy in `frontend/vite.config.ts` forwards `/api/*` to `http://localhost:3000`.

## Environment Variables

See `backend/.env.example`. Required for a full run:
- `DATABASE_URL` — PostgreSQL connection string (Render)
- `ANTHROPIC_API_KEY` or `VERTEX_AI_API_KEY` — at least one LLM provider

Everything else is optional and the corresponding features degrade gracefully.

**Dev mode:** No Entra ID env vars required. The backend uses a fixed mock user (`cohen.mcleod@gov.ab.ca`, role: `admin`) when `NODE_ENV !== "production"`.

## Database

Connection string: see `backend/.env.example`.
Schema: `cohen_mcleod`
Migration script: `docs/02_database_migrations.sql` (run once; fully idempotent)

## Key Files

| File | Purpose |
|------|---------|
| `backend/src/index.ts` | Express entry point — middleware, routes, tool registration |
| `backend/src/middleware/auth.ts` | Entra ID JWT validation + dev mock |
| `backend/src/services/agentOrchestrator.ts` | Core SSE iteration loop (800+ lines) |
| `backend/src/services/llmProvider.ts` | LLM factory — Anthropic / Vertex / Gemini + retry |
| `backend/src/services/toolDispatcher.ts` | Tool routing + memory tools + artifact persistence |
| `backend/src/services/piiDetector.ts` | 12-pattern PII scanner — chokepoint before all LLM calls |
| `backend/src/services/auditLogger.ts` | Immutable audit trail (40+ action types) |
| `backend/src/routes/agent.ts` | Free Agent session API (7 endpoints + models) |
| `backend/src/routes/workflow.ts` | Workflow CRUD + execution (SSE streaming) |
| `backend/src/routes/admin.ts` | Audit / PII / model / session admin endpoints |
| `frontend/src/views/FreeAgentView.vue` | Main Free Agent workbench (3-panel layout) |
| `frontend/src/views/WorkflowView.vue` | Visual workflow builder (Vue Flow) |
| `frontend/src/stores/agentSession.ts` | Session lifecycle + SSE event reducer |
| `frontend/src/stores/workflow.ts` | Workflow canvas state + execution log |
| `frontend/src/composables/useSSEStream.ts` | POST + ReadableStream SSE consumer |
| `docs/00_MASTER_PLAN.md` | **Start here.** Consolidated build plan + 6 parallel work streams |
| `docs/02_database_migrations.sql` | Complete schema + seed (idempotent) |

## Multi-Agent Coordination Notes

This project is developed by multiple Claude Code agents working in parallel. When picking up work:

1. Read `docs/00_MASTER_PLAN.md` — the authoritative stream breakdown.
2. Check `git log --oneline -20` to see what's been merged recently.
3. Run `pnpm test` to confirm the baseline is green before making changes.
4. Commit with descriptive messages; push to `claude/app-state-review-buildout-ZZvV2`.

### Cross-Stream Non-Negotiables

- **No secrets in the frontend.** Ever.
- **All orchestration on the backend.** SSE in, JSON in.
- **PII scan before every LLM call.** `services/piiDetector.ts` is the chokepoint.
- **Audit every action** using `AuditAction` enum.
- **Ministry scoping on every query** — pull `ministryCode` from `req.user`.
- **Alberta Design System** — colours, fonts, GoA web components.
- **Parameterized SQL only.** No string concatenation.
- **Idempotent + additive migrations** in `docs/02_database_migrations.sql`.

## Reference Material

- **Spec app source:** `https://github.com/developmentation/agent-builder-console`
- **Live spec:** `https://agentbuilderconsole.com`
- **Architecture diagrams:** `docs/architecture_current.png`, `docs/architecture_target.png`, `docs/architecture_rebuild.png`
- **Schema + seed:** `docs/02_database_migrations.sql`
