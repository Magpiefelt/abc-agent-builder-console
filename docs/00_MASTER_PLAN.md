# ABC Agent Builder Console — Master Build Plan & Parallel Work Streams

**Owner:** Cohen McLeod (`cohen.mcleod@gov.ab.ca`)
**Schema:** `cohen_mcleod`
**Branch:** `claude/review-repo-prep-63MAr`
**Status as of:** 2026-05-21 (updated post-review)

This document is the **single source of truth** for the ABC build. It consolidates and supersedes:

- `01_ABC_Rebuild_Plan.md`
- `03_ABC_Deep_Architecture_Review.md`
- `COORDINATION_STRATEGY.md`
- `PHASE_INSTRUCTIONS.md`
- `NEXT_AGENT_PROMPT.md`

Reference assets that remain authoritative:

- `02_database_migrations.sql` — schema + seed data (idempotent, additive)
- `architecture_current.png`, `architecture_target.png`, `architecture_rebuild.png`

---

## 1. Context — What ABC Is

ABC is a greenfield rebuild of the Agent Builder Console for the Government of Alberta, replacing the React/Supabase prototype at `https://github.com/developmentation/agent-builder-console` (live: `AgentBuilderConsole.com`). The prototype is the **functional specification** — we copy intent, never code.

**Target stack:** Vue 3 + TypeScript + Vite + Tailwind + Alberta DS (frontend, 5173) / Node 22 + Express 5 + TypeScript (backend, 3000) / PostgreSQL (Render shared instance) / Microsoft Entra ID OIDC / Vertex AI Claude.

**Core architectural rule:** Thin Client / Thick Server. The frontend renders and streams; the backend holds all state, secrets, and orchestration. No exceptions.

**Two operating modes:**
1. **Free Agent** — autonomous iterative agent (up to 200 iterations) with blackboard/scratchpad/attributes memory.
2. **Workflow** — visual canvas for chaining Agent / Function / Tool / Note nodes into deterministic or probabilistic pipelines.

---

## 2. What's Built Today

### Backend (`backend/src/`)

| Layer | Files | Status |
|-------|-------|--------|
| Entry + middleware stack | `index.ts`, `middleware/requestValidation.ts`, `middleware/agentRateLimit.ts` | **Complete** |
| Config | `config/env.ts` (Zod), `config/database.ts` (pool + transactions + slow-query logging) | **Complete** |
| Auth | `middleware/auth.ts`, `services/entraAuth.ts` | **Complete** — JWKS + PKCE + session cookies + dev mock fallback |
| Privacy | `services/piiDetector.ts` (Luhn-gated), `services/auditLogger.ts`, `services/secretsVault.ts`, `services/retentionJob.ts` | **Complete** |
| Logging | `services/logger.ts`, `services/processMonitor.ts` (SIGTERM/SIGINT, unhandled rejections) | **Complete** |
| LLM | `services/llmProvider.ts` (AnthropicProvider + GoogleGeminiProvider, retry, streaming, classification gating) | **Complete** |
| Orchestration | `services/agentOrchestrator.ts`, `services/promptBuilder.ts`, `services/loopDetector.ts`, `services/toolDispatcher.ts` | **Complete** |
| Workflow | `services/workflowExecutor.ts`, `services/functionRegistry.ts` (44 functions) | **Complete** |
| Edge tools (20/20) | `tools/webSearch.ts`, `tools/webScrape.ts`, `tools/github.ts`, `tools/documents.ts`, `tools/apiProxy.ts`, `tools/utilities.ts`, `tools/database.ts`, `tools/generation.ts`, `tools/communication.ts` | **Complete** |
| Routes | `routes/health.ts`, `routes/agent.ts`, `routes/workflow.ts`, `routes/auth.ts`, `routes/users.ts`, `routes/admin.ts` | **Complete** |

### Frontend (`frontend/src/`)

| Layer | Files | Status |
|-------|-------|--------|
| App shell | `App.vue`, `main.ts`, `router/index.ts`, `assets/main.css` (Alberta DS tokens) | **Complete** |
| Header | `components/AppHeader.vue` | **Complete** — auth-aware, shows real user + ministry |
| Free Agent view | `views/FreeAgentView.vue` + 10 subcomponents | **Complete** — SSE consumer, memory viewers, prompt customizer, Vue Flow canvas |
| Workflow view | `views/WorkflowView.vue` + 8 subcomponents | **Complete** — Vue Flow editor, sidebar, properties, history, execution panel |
| Admin view | `views/AdminView.vue` + 5 subcomponents | **Complete** — Audit, PII, models, sessions, health diagnostics |
| Auth/Profile | `views/LoginView.vue`, `views/ProfileView.vue` | **Complete** — SSO redirect, identity display, saved prompts |
| Workflow List | `views/WorkflowListView.vue` | **Complete** — CRUD, duplicate, search |
| State | `stores/agentSession.ts`, `stores/workflow.ts`, `stores/auth.ts`, `stores/models.ts`, `stores/userMemory.ts` | **Complete** |
| Composables | `useSSEStream.ts`, `useApiFetch.ts`, `useAuthGuard.ts`, `useMarkdown.ts`, `useToast.ts`, `useFocusTrap.ts` | **Complete** |

### Database (`docs/02_database_migrations.sql`)

Schema + seed (idempotent):

- **Planning tables (5):** `features`, `vulnerabilities`, `migration`, `plan`, `privacy_controls`
- **Application tables (9):** `users`, `model_registry`, `workflows`, `agent_sessions`, `agent_iterations`, `artifacts`, `audit_log`, `pii_detections`
- **Triggers:** `update_timestamp()` on all `updated_at` columns
- **Seed data:** 35 rows in `plan`, 35 in `migration`, 10 in `vulnerabilities`, 10 in `privacy_controls`
- **Seed data:** 103 rows in `features`, 4 rows in `model_registry` (Claude Opus/Sonnet/Haiku + Gemini Flash)

---

## 3. Gap Analysis — Exercise Brief vs. Current State

The exercise (AI Garage — Application Remediation and Migration) requires more than the rebuild plan. The table below maps brief items to current state.

| Brief Section | Requirement | State |
|---------------|-------------|-------|
| 3.1 Features mapping | Populate `features` table from 100% coverage of spec app | **COMPLETE** — 103 features seeded in migration script |
| 3.2 Vulnerabilities + Blue/Red agents | 10 vulns identified; Red/Blue agent runs executed | **COMPLETE** — 10 vulns seeded, Red/Blue report in `docs/security/red_blue_report.md` |
| 3.3 Target architecture + `migration` table | Done; diagrams in `docs/` | **COMPLETE** |
| 3.4 Plan table | 35 tasks across 6 phases | **COMPLETE** — 36 rows seeded |
| 3.5 Privacy controls | 10 controls planned; PII detector + ministry scoping built; classification routing done in LLM factory | **COMPLETE** — 10 controls seeded, all implemented |
| 4.1 Harness | 8-phase Velocity approach | **COMPLETE** — All phases implemented |
| 5.1 Evals + trust | Eval scripts, visual presentation, SOAR/STRA evidence | **COMPLETE** — 4 eval scenarios, CI workflow, STRIDE/PIA/controls docs |
| 6.1 Review | Faithful port + functional verification | **IN PROGRESS** — Code review complete (see `docs/review/`), real LLM verification pending |
| Step 4 Completion: Nexus host, Red/Blue runs, SSO | Nexus manifest + deploy workflow ready | **PENDING DEPLOYMENT** — SSO code complete, Entra callback registration needed |
| Enterprise Tools (Ent Tools APIs) | Wire in via `ent-tools.sandbox.aim.int.gov.ab.ca` | **COMPLETE** — `entToolsClient.ts` routes Brave + Image when `ENT_TOOLS_API_KEY` set |
| User memory / accounts (whitepaper extras) | Saved prompts, favourite workflows, recent sessions | **COMPLETE** — Full user memory API + frontend integration |

---

## 4. Six Parallel Work Streams

Streams are sized to be picked up independently. The only hard cross-stream dependency is the **Stream A → Stream B/C** handoff for replacing the dev auth mock; until then B and C run against the mock user.

| Stream | Title | Status | Surface area |
|--------|-------|--------|--------------|
| **A** | Identity, SSO & User Memory | **COMPLETE** | Backend auth + new tables + Vue auth store/header |
| **B** | Free Agent UX & Real-Time Streaming | **COMPLETE** | Vue components, Pinia, SSE consumer |
| **C** | Workflow Canvas (Vue Flow + Executor) | **COMPLETE** | Vue Flow, custom nodes, workflowExecutor service |
| **D** | Tool Ecosystem Completion + Ent Tools | **COMPLETE** | `backend/src/tools/*`, Ent Tools client, secrets vault |
| **E** | Quality: Tests, Evals, Accessibility, Red/Blue | **COMPLETE** | 392+43 tests, 4 eval scenarios, Red/Blue report, CI |
| **F** | Compliance, Privacy Hardening & Nexus Deployment | **DEPLOYMENT PENDING** | SOAR/STRA docs, admin UI, retention job, Nexus manifest |

Each stream below specifies: **Goal**, **Scope**, **Files to create/modify**, **Tasks**, **Dependencies**, **Acceptance criteria**, **Database migrations needed**.

---

### Stream A — Identity, SSO & User Memory

**Goal.** Replace the development mock with a real Microsoft Entra ID OIDC flow, persist users to the database from token claims, extract ministry from `AIM-G-{MINISTRY}-ALL_{EMPLOYEES|CONTRACTORS}` groups, and give each user persistent memory (saved prompts, favorite workflows, recent sessions).

**Scope.**

1. Backend: passport-azure-ad or `jose` + `jwks-rsa` to validate the Entra ID JWT (issuer, audience, signature, expiry).
2. Backend: `/api/auth/login`, `/api/auth/callback`, `/api/auth/logout`, `/api/auth/me` routes.
3. Backend: user upsert from `oid + email + name + groups` claims; ministry extracted by regex.
4. Frontend: `auth` Pinia store; route guard; login redirect; `AppHeader` shows real name + ministry; logout button.
5. Backend + frontend: User memory features — saved prompts, favorite workflows, recent session list.
6. Keep the dev mock path behind `NODE_ENV !== "production"` for fast local iteration.

**Files to create.**

| Path | Purpose |
|------|---------|
| `backend/src/services/entraAuth.ts` | JWT verification (JWKS cache), claim extraction, user upsert |
| `backend/src/routes/auth.ts` | Login/callback/logout/me endpoints |
| `backend/src/routes/users.ts` | `/api/users/me/preferences`, `/api/users/me/recent-sessions`, `/api/users/me/saved-prompts` |
| `frontend/src/stores/auth.ts` | Pinia: user, loading, login(), logout(), fetchMe() |
| `frontend/src/stores/userMemory.ts` | Saved prompts, favorite workflows, recents |
| `frontend/src/views/LoginView.vue` | SSO redirect page |
| `frontend/src/views/ProfileView.vue` | Identity + preferences + saved prompts list |
| `frontend/src/composables/useAuthGuard.ts` | Router guard hook |

**Files to modify.**

| Path | Change |
|------|--------|
| `backend/src/middleware/auth.ts` | Wire `entraAuth.ts` for production; keep dev mock |
| `backend/src/config/env.ts` | `ENTRA_*` already declared — confirm `ENTRA_REDIRECT_URI` and add `ENTRA_AUTHORITY` |
| `backend/src/index.ts` | Mount `authRoutes` and `userRoutes` |
| `frontend/src/main.ts` | Install auth guard on router |
| `frontend/src/components/AppHeader.vue` | Replace hardcoded "Cohen McLeod" with `auth.user` reactive data + logout |
| `frontend/src/router/index.ts` | Add `/login`, `/profile`; mark protected routes |

**Database migrations needed (`docs/02_database_migrations.sql` — additive).**

```sql
CREATE TABLE IF NOT EXISTS cohen_mcleod.user_preferences (
    user_id UUID PRIMARY KEY REFERENCES cohen_mcleod.users(id) ON DELETE CASCADE,
    default_model_id TEXT,
    default_classification TEXT,
    theme TEXT DEFAULT 'light',
    notification_preferences JSONB DEFAULT '{}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cohen_mcleod.saved_prompts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES cohen_mcleod.users(id) ON DELETE CASCADE,
    ministry_code TEXT,
    title TEXT NOT NULL,
    prompt TEXT NOT NULL,
    tags TEXT[],
    is_public BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_saved_prompts_user ON cohen_mcleod.saved_prompts(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_prompts_ministry ON cohen_mcleod.saved_prompts(ministry_code);

CREATE TABLE IF NOT EXISTS cohen_mcleod.workflow_favorites (
    user_id UUID NOT NULL REFERENCES cohen_mcleod.users(id) ON DELETE CASCADE,
    workflow_id UUID NOT NULL REFERENCES cohen_mcleod.workflows(id) ON DELETE CASCADE,
    favorited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, workflow_id)
);
```

**Tasks.**

1. Install `jose` and `jwks-rsa` (Node-friendly, no native deps).
2. Implement JWKS-cached signature verification (refresh every 24h, ETag-respecting).
3. Implement claim → `AuthUser` mapper; ministry regex (already present in `middleware/auth.ts`).
4. User upsert (UPSERT on `entra_id`, refresh `display_name`, `email`, `ministry_code`, `last_login`).
5. Build `/api/auth/*` routes including PKCE-aware callback and refresh handling.
6. Apply migration and build user memory endpoints.
7. Frontend auth store + guard + login/profile views.
8. Replace `AppHeader.vue` hardcoded display with real user.
9. Add "Save this prompt" and "Recent sessions" UI hooks to `FreeAgentView`.

**Dependencies.** None — can start immediately. Other streams use the dev mock until this lands.

**Acceptance.**

- Production deploy authenticates via Entra ID; Authorization header rejected when invalid.
- Ministry correctly extracted for at least one test user.
- Header displays real name + ministry; logout returns to login screen.
- User can save a prompt, list saved prompts, favorite a workflow, see recent sessions.
- Dev mode still works without setting Entra env vars.
- Audit log records every login (`AuditAction.AUTH_LOGIN`).

---

### Stream B — Free Agent UX & Real-Time Streaming

**Goal.** Wire the existing `FreeAgentView.vue` to the live backend orchestrator: create a session, consume the SSE stream, render iteration progress with blackboard / scratchpad / artifacts viewers, support stop / continue / interject, and expose the prompt customizer.

**Scope.**

1. Pinia store managing session lifecycle and SSE event ingestion.
2. SSE consumer using `fetch` + `ReadableStream` (preferred over `EventSource` because it cannot send `POST` bodies — required for our `/start` endpoint which expects a JSON body with section overrides).
3. Component breakdown: task panel, control bar (start / stop / continue / interject), iteration timeline, blackboard / scratchpad / artifacts tabs, prompt customizer modal, model selector populated from `/api/agent/models`.
4. Free Agent execution canvas (Vue Flow) — visual graph of agent → tool calls → artifacts, nodes appearing as iterations stream.
5. Mobile / responsive layout — three-panel collapses to tabs below 768px.

**Files to create.**

| Path | Purpose |
|------|---------|
| `frontend/src/stores/agentSession.ts` | State machine: idle → creating → running → completed/error; SSE event reducer |
| `frontend/src/stores/models.ts` | Cache `/api/agent/models` registry |
| `frontend/src/composables/useSSEStream.ts` | Reusable `POST + stream` consumer |
| `frontend/src/components/freeAgent/TaskPanel.vue` | Prompt + model + classification + max iterations + start button |
| `frontend/src/components/freeAgent/ControlBar.vue` | Stop / continue / interject + iteration counter |
| `frontend/src/components/freeAgent/IterationTimeline.vue` | List of iterations with status badges, expandable details |
| `frontend/src/components/freeAgent/BlackboardViewer.vue` | Categorized entries with iteration badges + search |
| `frontend/src/components/freeAgent/ScratchpadViewer.vue` | Markdown-rendered scratchpad |
| `frontend/src/components/freeAgent/ArtifactsPanel.vue` | Artifact list with type filtering + download |
| `frontend/src/components/freeAgent/PromptCustomizer.vue` | Section enable/disable + content edit modal |
| `frontend/src/components/freeAgent/AgentCanvas.vue` | Vue Flow visualization of execution graph |
| `frontend/src/components/freeAgent/InterjectionModal.vue` | "Inject guidance" input |
| `frontend/src/components/freeAgent/FinalReportPanel.vue` | Renders `final_report` when status = completed |

**Files to modify.**

| Path | Change |
|------|--------|
| `frontend/src/views/FreeAgentView.vue` | Compose the new components; remove placeholder copy |
| `frontend/package.json` | Add `@vue-flow/core`, `@vue-flow/background`, `@vue-flow/minimap`, `marked` (markdown), `dompurify` |
| `frontend/src/assets/main.css` | Add `@import '@vue-flow/core/dist/style.css'` |
| `backend/src/routes/agent.ts` | Add `GET /api/agent/sessions/:id/events` if we move SSE replay to a separate endpoint (optional) |
| `backend/src/services/promptBuilder.ts` | Export `getTemplateSections()` already exists — surface via `GET /api/agent/prompt-template` route |
| `backend/src/routes/agent.ts` | New: `GET /prompt-template` returning sections from `getTemplateSections()` for the customizer |

**Tasks.**

1. Read `agentOrchestrator.ts` to enumerate all `SSEEvent.type` values (`session_start`, `iteration_start`, `llm_response`, `tool_calls`, `tool_result`, `blackboard_update`, `scratchpad_update`, `attributes_update`, `iteration_complete`, `loop_warning`, `loop_intervention`, `pii_warning`, `llm_error`, `session_stopped`, `iteration_limit`, `session_complete`, `error`) and route each to a store mutation.
2. Build `useSSEStream` composable that does `fetch(url, { method: 'POST', body, headers })` and reads `response.body.getReader()` with line-buffered `data: …` parsing.
3. Build TaskPanel pulling models from `/api/agent/models` and classifications from a static enum.
4. Iteration timeline shows live `iteration_start` events as collapsed cards that expand on click.
5. Blackboard viewer groups by category, badges by iteration, with category filter.
6. Artifacts panel calls `GET /api/agent/sessions/:id` to enumerate artifacts (extend the route to include artifacts), or alternatively listen for a new `artifact_created` SSE event (recommended — add this event in `toolDispatcher.storeArtifact`).
7. Prompt customizer fetches sections, allows toggle/edit, sends overrides in `POST /sessions/:id/start` body.
8. AgentCanvas adds a node per iteration and edges representing flow; tool calls become side nodes.
9. Mobile breakpoints: side panels become bottom-sheet tabs.

**Dependencies.**

- Stream A for real user display (works against dev mock until then).
- Stream D for `image_generation`/`elevenlabs_tts` artifact rendering (UI can show generic artifacts now and add type-specific previews later).

**Acceptance.**

- User can: enter prompt → select model → click Start → see SSE events flow in real time → see blackboard / scratchpad update live → stop / continue / interject → view final report.
- Prompt customizer round-trips section overrides to the orchestrator.
- No console errors; SSE reconnect logic on transient drop; PII warnings rendered as toast.
- Layout responsive down to 360px viewport.
- Vue Flow canvas reflects iteration count and tool calls.

---

### Stream C — Workflow Canvas (Vue Flow + Backend Executor)

**Goal.** Replace `WorkflowView.vue` placeholder with the full visual workflow builder, and build the backend graph executor + persistence routes that turn the canvas into a streaming sequential pipeline.

**Scope.**

1. Vue Flow canvas with four custom node types: Agent, Function, Tool, Note.
2. Workflow sidebar: draggable agent templates (Researcher, Summarizer, Analyst, plus user templates) and a function catalog (40+ functions from the spec app's `functionDefinitions.ts`).
3. Properties panel: edit node configuration; agents have system prompt + model + tools; functions have typed parameters.
4. Backend `workflowExecutor.ts` that walks the graph topologically and:
   - For Agent nodes: calls the LLM via `llmProvider.callLLM` (re-uses Stream A's classification gating).
   - For Function nodes: runs deterministic logic from a server-side `functionRegistry`.
   - For Tool nodes: delegates to existing `toolDispatcher.dispatchToolCalls`.
   - For Note nodes: skipped at execution time.
5. SSE streaming of workflow execution progress (analogous to free agent).
6. Workflow CRUD: save, list, load, duplicate, delete; respect ministry scoping.

**Files to create.**

| Path | Purpose |
|------|---------|
| `backend/src/services/workflowExecutor.ts` | Graph walker, stage runner, SSE event emitter |
| `backend/src/services/functionRegistry.ts` | Deterministic function catalog (port intent from spec) |
| `backend/src/routes/workflow.ts` | `POST /api/workflows`, `GET /api/workflows`, `GET /:id`, `PUT /:id`, `DELETE /:id`, `POST /:id/execute` |
| `backend/src/data/agentTemplates.json` | Researcher / Summarizer / Analyst defaults |
| `backend/src/data/functionCatalog.json` | Function definitions (name, params, category) |
| `frontend/src/views/WorkflowView.vue` | Full canvas view (replace placeholder) |
| `frontend/src/components/workflow/WorkflowCanvas.vue` | Vue Flow wrapper |
| `frontend/src/components/workflow/nodes/AgentNode.vue` | Custom node |
| `frontend/src/components/workflow/nodes/FunctionNode.vue` | Custom node |
| `frontend/src/components/workflow/nodes/ToolNode.vue` | Custom node |
| `frontend/src/components/workflow/nodes/NoteNode.vue` | Custom node |
| `frontend/src/components/workflow/WorkflowSidebar.vue` | Library + drag source |
| `frontend/src/components/workflow/PropertiesPanel.vue` | Right-side editor |
| `frontend/src/components/workflow/WorkflowToolbar.vue` | Save / load / run / classification |
| `frontend/src/stores/workflow.ts` | Pinia store for current workflow + saved list |
| `frontend/src/views/WorkflowListView.vue` | "My workflows" list |

**Files to modify.**

| Path | Change |
|------|--------|
| `backend/src/index.ts` | Remove `/api/workflows` placeholder; mount `workflowRoutes` |
| `frontend/src/router/index.ts` | Add `/workflows` (list) and `/workflows/:id` (edit) |
| `frontend/package.json` | Add `@vue-flow/core` + addons (shared with Stream B install) |
| `docs/02_database_migrations.sql` | Add `workflow_versions` table (already referenced in plan but not created) |

**Database migrations needed.**

```sql
CREATE TABLE IF NOT EXISTS cohen_mcleod.workflow_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID NOT NULL REFERENCES cohen_mcleod.workflows(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    canvas_data JSONB NOT NULL,
    created_by UUID NOT NULL REFERENCES cohen_mcleod.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (workflow_id, version)
);
CREATE INDEX IF NOT EXISTS idx_wf_versions_workflow ON cohen_mcleod.workflow_versions(workflow_id);

CREATE TABLE IF NOT EXISTS cohen_mcleod.workflow_executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID NOT NULL REFERENCES cohen_mcleod.workflows(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES cohen_mcleod.users(id),
    classification TEXT NOT NULL DEFAULT 'unclassified',
    status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','error','aborted')),
    stage_results JSONB DEFAULT '[]',
    error TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_wf_executions_user ON cohen_mcleod.workflow_executions(user_id);
```

**Tasks.**

1. Define `canvas_data` JSONB shape: `{ nodes: [...], edges: [...], version: 1 }` matching Vue Flow.
2. Build the four node SFCs with Alberta DS styling and minimum interactive controls.
3. Build sidebar with collapsible Agent / Function / Tool / Note panels and drag-source registration.
4. Properties panel renders dynamic forms based on selected node type.
5. Workflow toolbar: save (PUT or POST), run (`POST /execute` → SSE stream), classification dropdown.
6. Backend executor: topological sort, fail-fast on cycles, emit `stage_start / stage_complete / workflow_complete` SSE events.
7. Persist each execution to `workflow_executions` for audit + replay.
8. Workflow list view with search + ministry filter (no cross-ministry leakage).

**Dependencies.**

- Stream A for ministry scoping on workflows (currently the orchestrator already reads `ministryCode` from the dev mock; same pattern applies here).
- Stream D not strictly required — workflow can call existing tools.

**Acceptance.**

- User can build a workflow visually, save it, reload it, and run it.
- Run streams stage-by-stage progress to the UI.
- Workflow runs respect classification and ministry rules.
- Workflow templates can be marked public (shared within ministry) or private (owner-only).
- Audit log records `WORKFLOW_CREATED`, `WORKFLOW_UPDATED`, `WORKFLOW_EXECUTED`.

---

### Stream D — Tool Ecosystem Completion + Enterprise Tools Integration

**Goal.** Close the gap from 15/20 implemented edge tools to 20/20 (plus a real OCR backend), and route external API calls through GoA Enterprise Tools (`ent-tools.sandbox.aim.int.gov.ab.ca`) where available — primarily Brave Search and OpenAI Image Generation.

**Scope.**

| Tool | Current | Action |
|------|---------|--------|
| `execute_sql` | Not built | Build with **connection allowlist** + parameterized statements + read-only default |
| `read_database_schemas` | Not built | Build (same allowlist) |
| `image_generation` | Not built | Implement via Ent Tools OpenAI Image (preferred) or Gemini Image fallback; persist as `artifacts` |
| `elevenlabs_tts` | Not built | Implement with `ELEVENLABS_API_KEY`; recipient size limits |
| `send_email` | Not built | Build with **recipient allowlist** (must be `@gov.ab.ca` domain or pre-approved); rate-limit per user |
| `ocr_image` | Stub | Replace with Tesseract.js (Node WASM build) or Ent Tools OCR if exposed |
| `brave_search`, `google_search` | Direct API today | **Re-route** to Ent Tools proxy when `ENT_TOOLS_API_KEY` set; preserve direct fallback for dev |
| `pdf_*`, `zip_*` | Implemented | No change |
| `web_scrape` | Implemented (SSRF) | Optional: add robots.txt respect + Allowlist mode |
| `get_call_api`, `post_call_api` | Implemented (SSRF) | Tighten: require an explicit allowlist for production |

**Files to create.**

| Path | Purpose |
|------|---------|
| `backend/src/tools/database.ts` | `execute_sql`, `read_database_schemas` |
| `backend/src/tools/generation.ts` | `image_generation`, `elevenlabs_tts` |
| `backend/src/tools/communication.ts` | `send_email` |
| `backend/src/services/entToolsClient.ts` | Common HTTP client for Ent Tools API base URL + auth header |
| `backend/src/data/connectionAllowlist.json` | DB connection string allowlist (regex per ministry) |
| `backend/src/data/emailAllowlist.json` | Approved recipient domains / addresses |

**Files to modify.**

| Path | Change |
|------|--------|
| `backend/src/tools/webSearch.ts` | Add Ent Tools branch using `entToolsClient` |
| `backend/src/tools/register.ts` | Register all new tools |
| `backend/src/config/env.ts` | Add `ENT_TOOLS_API_KEY`, `ENT_TOOLS_BASE_URL`, `EMAIL_FROM`, `EMAIL_SMTP_HOST`, etc. |
| `backend/.env.example` | Document new vars |
| `backend/package.json` | Add `tesseract.js` (if used), `nodemailer`, `@google/generative-ai` (image), `pg` already present |
| `docs/02_database_migrations.sql` | Seed `model_registry` with current approved models (replace hard-coded fallback) |

**Database migrations needed.**

```sql
-- model_registry seed (move out of code, into DB)
INSERT INTO cohen_mcleod.model_registry
  (model_id, display_name, provider, api_model_name, max_output_tokens, supports_streaming, supports_tools, data_residency, max_classification, is_active)
VALUES
  ('claude-opus-4-7','Claude Opus 4.7 (Vertex AI)','vertex_ai','claude-opus-4-7',16384,true,true,'canada','protected_b',true),
  ('claude-sonnet-4-6','Claude Sonnet 4.6 (Vertex AI)','vertex_ai','claude-sonnet-4-6',16384,true,true,'canada','protected_b',true),
  ('claude-haiku-4-5','Claude Haiku 4.5 (Vertex AI)','vertex_ai','claude-haiku-4-5-20251001',8192,true,true,'canada','protected_a',true),
  ('gemini-2.5-flash','Gemini 2.5 Flash','google','gemini-2.5-flash-preview-05-20',8192,true,true,'us','unclassified',true)
ON CONFLICT (model_id) DO NOTHING;
```

**Tasks.**

1. Build a connection allowlist file with named connections (`{ name, connStringEnvVar, ministries: [...] }`) and validate at startup.
2. SQL tool: prepare statements only; `isWrite` defaults false; enforce statement timeout; cap rows returned.
3. Image generation: call Ent Tools or fallback to Gemini; store result as a base64 artifact with type `image`.
4. TTS: stream audio bytes; store as artifact `audio/mpeg`.
5. Email: nodemailer to GoA SMTP relay (env-configured); recipient validation; subject prefix `[ABC]`.
6. OCR: drop a Tesseract.js worker; honor existing dispatcher timeout.
7. Route Brave/Google searches through Ent Tools when configured; log header attribution.
8. Seed `model_registry` and remove `getDefaultModels()` fallback from `llmProvider.ts`.

**Dependencies.**

- Independent of Streams A / B / C.
- Stream F should run Red agent against new tools to confirm SSRF / DLP posture.

**Acceptance.**

- All 20 edge tools listed in `KNOWN_EDGE_TOOLS` (`backend/src/services/toolDispatcher.ts`) have registered handlers and pass a smoke test through the dispatcher.
- Brave search returns Ent Tools-attributed results when `ENT_TOOLS_API_KEY` is set; otherwise direct fallback works.
- Image generation produces an artifact viewable in the frontend Artifacts panel (Stream B integration point).
- Email tool refuses unapproved recipients; SQL tool refuses non-allowlisted connections.
- `model_registry` seeded; `getActiveModels()` returns real registry rows.

---

### Stream E — Quality: Tests, Evals, Accessibility & Red/Blue Integration

**Goal.** Produce the evidence the exercise requires: unit + integration tests, evals (scripts that detect inconsistencies / regressions), accessibility audit, and Red/Blue agent run reports from the AIDE-VELOCITY-HARNESS.

**Scope.**

1. **Backend tests (Vitest).** Cover middleware, services, tool handlers, route happy + error paths. Target 80% line coverage.
2. **Frontend tests (Vitest + Vue Test Utils).** Pinia stores, key composables, critical components (TaskPanel, BlackboardViewer, WorkflowCanvas).
3. **API integration tests (Supertest).** End-to-end for `/api/agent/sessions/*` flow; mock LLM provider.
4. **Eval scripts.** Standalone Node scripts that run scenarios against the live app, compare expected vs actual blackboard entries / final report shape / SSE event sequences. Includes regression for parsing the LLM JSON, loop detection thresholds, and PII redaction.
5. **Accessibility.** axe-core in CI; manual screen-reader pass; WCAG 2.1 AA fixes.
6. **Red/Blue agent runs.** Local launch of ABC, instructions for the Blue agent (Velocity harness analysis), Red agent attack scenarios (open scraping, SSRF, prompt injection); document findings in `docs/security/red_blue_report.md`.

**Files to create.**

| Path | Purpose |
|------|---------|
| `backend/vitest.config.ts` | Vitest config with coverage |
| `backend/src/**/__tests__/*.test.ts` | Unit tests co-located with sources |
| `backend/test/integration/agent.test.ts` | Full flow with mock LLM |
| `backend/test/integration/workflow.test.ts` | (After Stream C) |
| `backend/test/helpers/mockLLM.ts` | Deterministic LLM responses |
| `frontend/vitest.config.ts` | Frontend Vitest config |
| `frontend/src/**/__tests__/*.test.ts` | Component + store tests |
| `frontend/test/accessibility/axe.test.ts` | axe-core driver |
| `evals/runners/scenarioRunner.ts` | Scripted scenario player |
| `evals/scenarios/01_research_task.json` | "Research X then summarize" expected outcomes |
| `evals/scenarios/02_loop_detection.json` | Force a loop, expect intervention |
| `evals/scenarios/03_pii_blocking.json` | Provide SIN/AHCN, expect block |
| `evals/scenarios/04_workflow_pipeline.json` | (After Stream C) |
| `evals/README.md` | How to run; how to add scenarios |
| `docs/security/red_blue_report.md` | Findings + remediations |
| `docs/security/red_team_scenarios.md` | Attack scripts the Red agent runs |
| `docs/quality/accessibility_audit.md` | axe + manual results |
| `.github/workflows/ci.yml` | Lint, type-check, test on PR |

**Files to modify.**

| Path | Change |
|------|--------|
| `backend/package.json` | Add `vitest`, `@vitest/coverage-v8`, `supertest`, `@types/supertest` |
| `frontend/package.json` | Add `vitest`, `@vue/test-utils`, `jsdom`, `axe-core`, `@vitest/coverage-v8` |
| Root `package.json` | Add `test` script aggregating both |

**Tasks.**

1. Set up Vitest in both packages with shared eslint + tsconfig presets.
2. Write tests starting with the highest-risk modules (`llmProvider`, `agentOrchestrator`, `toolDispatcher`, `piiDetector`, `auth` middleware).
3. Build the mock LLM that returns canned JSON sequences keyed by iteration count.
4. Write a `scenarioRunner` that talks to a running backend (via `fetch`), drives a session, captures SSE events, and compares against expected.
5. Add axe-core driver against the running Vite app; smoke-test all routes.
6. Document Red agent scenarios: SSRF against `web_scrape`, prompt injection in user input, PII bypass attempts, ministry leakage probes, rate-limit abuse.
7. Document Blue agent run via VELOCITY-HARNESS: dependency vuln scan, secret scan, license check, code-quality summary.
8. Capture results to `docs/security/red_blue_report.md` with severity + remediation status.
9. Set up GitHub Actions workflow.

**Dependencies.**

- Streams A / B / C / D need to land before their respective integration tests can be fully realized — Stream E can build the harness now and add scenarios as features arrive.
- Eval scenarios that exercise tools need Stream D before they can target SQL / image / email.

**Acceptance.**

- `pnpm test` runs both packages, exits 0, prints coverage.
- axe-core reports zero serious / critical issues on Free Agent + Workflow views.
- All four scenario files pass when run against a clean DB.
- Red/Blue report documents at least 10 attack attempts and their results.
- CI workflow runs on push and PR.

---

### Stream F — Compliance, Privacy Hardening & Nexus Deployment

**Goal.** Produce the **SOAR / STRA / Authority to Operate** evidence package, deploy the app to GoA Nexus with SSO wired up, harden privacy controls (data retention, classification routing, audit trail viewer), and run smoothly under load.

**Scope.**

1. **Compliance artifacts.** Threat model (STRIDE), data flow diagrams, controls matrix mapped to GoA standards, Privacy Impact Assessment (PIA), residual risk register.
2. **Privacy hardening.** Strengthen PII patterns (Alberta Health Care Number with Luhn validation; Alberta drivers' license precision; Albert Personal Health Number); add classification-aware retention jobs; encrypt sensitive columns at rest (pg `pgcrypto`).
3. **Admin UI.** Audit-log viewer route, PII detection viewer, model registry editor, session inspector.
4. **Deployment.** Nexus deploy manifests, Entra ID callback URLs configured for prod, env var injection plan, smoke check.
5. **Observability.** Health endpoint expansion (pool stats, token usage, queue depth), structured log shipping plan.
6. **Operational runbooks.** Incident response, key rotation, emergency stop, model deprecation.

**Files to create.**

| Path | Purpose |
|------|---------|
| `docs/security/threat_model_stride.md` | STRIDE per component |
| `docs/security/data_flow_diagram.md` | Mermaid + narrative |
| `docs/security/controls_matrix.md` | Controls vs. GoA Security Categorization |
| `docs/privacy/pia.md` | Privacy Impact Assessment |
| `docs/privacy/retention_schedule.md` | Per-classification retention table |
| `docs/operations/incident_response.md` | On-call playbook |
| `docs/operations/key_rotation.md` | Rotation procedure |
| `docs/operations/deployment_nexus.md` | Step-by-step Nexus host (frontend 5173, backend 3000) |
| `docs/operations/observability.md` | Logs / metrics plan |
| `backend/src/routes/admin.ts` | Audit / PII / model / session admin endpoints |
| `backend/src/services/retentionJob.ts` | Scheduled cleanup respecting classification (unclassified 90d, PA 1y, PB 3y) |
| `backend/src/services/secretsVault.ts` | Per-user/per-ministry encrypted secret store (pgcrypto) |
| `frontend/src/views/AdminView.vue` | Admin landing |
| `frontend/src/components/admin/AuditLogViewer.vue` | Filter + export |
| `frontend/src/components/admin/PIIDetectionViewer.vue` | Forensic view |
| `frontend/src/components/admin/ModelRegistryEditor.vue` | Toggle / classification |
| `.github/workflows/deploy.yml` | Build artifact + Nexus publish |
| `nexus/manifest.yaml` | Nexus app declaration (frontend + backend + SSO callback) |

**Files to modify.**

| Path | Change |
|------|--------|
| `backend/src/services/piiDetector.ts` | Add Luhn validation; reduce false positives on AHCN |
| `backend/src/routes/health.ts` | Expand to include pool stats, token usage, queue depth |
| `backend/src/index.ts` | Mount `adminRoutes` (guarded by `requireRole('admin')`) |
| `docs/02_database_migrations.sql` | Add `pgcrypto`, encrypted secrets table, retention metadata |
| `docs/architecture_target.png` | (Optional) Refresh with admin layer |

**Database migrations needed.**

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS cohen_mcleod.user_secrets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES cohen_mcleod.users(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    encrypted_value BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, label)
);

CREATE TABLE IF NOT EXISTS cohen_mcleod.retention_policy (
    classification TEXT PRIMARY KEY,
    sessions_days INTEGER NOT NULL,
    artifacts_days INTEGER NOT NULL,
    audit_log_days INTEGER NOT NULL
);

INSERT INTO cohen_mcleod.retention_policy VALUES
  ('unclassified', 90,  90,  365),
  ('protected_a', 365, 365, 1095),
  ('protected_b', 1095, 1095, 2555)
ON CONFLICT (classification) DO NOTHING;
```

**Tasks.**

1. Author STRIDE model + DFD + controls matrix referencing existing services (PII, RBAC, ministry scoping, audit log).
2. Build admin routes + UI behind `requireRole('admin')`.
3. Build retention job (node-cron or scheduled task) that respects classification.
4. Add `pgcrypto` and migrate to secret column encryption (no plaintext API keys in DB).
5. Author PIA covering ingest, processing, storage, deletion, third-party flows.
6. Write Nexus deployment runbook; capture SSO redirect URI registration.
7. CI/CD workflow: build → test → publish → deploy → smoke check.
8. Health endpoint shows pool stats, in-flight sessions, recent token usage.
9. Final ATO package PDF assembled from the above (use the existing PNG diagrams).

**Dependencies.**

- Stream A for Entra ID prod config (required for SSO callback registration).
- Stream E for evidence of tests passing.
- Streams B / C / D code-complete preferred but not blocking — admin UI can ship against current backend.

**Acceptance.**

- ATO package (threat model + DFD + controls + PIA + residual risk) reviewable.
- App deployed on Nexus and reachable through SSO end-to-end.
- Admin can view recent audit entries, PII detections, model registry, session inspector.
- Retention job runs and cleans data correctly in a dev test.
- `/api/health` returns full diagnostics; can be linked to alerting.

---

## 5. Integration & Sequencing Notes

| Concern | Notes |
|---------|-------|
| Auth handoff | Streams B/C/F all eventually depend on Stream A's real Entra ID flow. Until then, all run against the dev mock — no blocker. |
| Database migrations | Each stream owns its own additive migration block in `docs/02_database_migrations.sql`. The file remains idempotent (`IF NOT EXISTS`, `ON CONFLICT`). Merge order: A → C → D → F. |
| Frontend dependencies | Streams B and C both need Vue Flow. Coordinate one install in `frontend/package.json`. |
| Tool registration | Stream D adds new tools to `backend/src/tools/register.ts`. Whoever lands first wins; the file is short and merge-friendly. |
| SSE event vocabulary | Stream B defines event names consumed by both Free Agent and Workflow views; Stream C should reuse the same vocabulary for consistency. |
| CI | Stream E owns `.github/workflows/ci.yml`; Stream F owns `deploy.yml`. They should agree on the artifact format. |
| Secrets | Stream F's `secretsVault.ts` is the single place per-user secrets are stored; Stream D's tools should read from it where applicable rather than env vars. |

**Recommended ordering if running fewer than 6 agents concurrently:**

1. Start A + B + D in parallel (max independent work).
2. Start C once B has the SSE consumer pattern proven.
3. Run E continuously alongside A–D.
4. Run F last; depends on the others to produce real evidence.

---

## 6. Cross-Cutting Reminders (Non-Negotiable)

- **No secrets in the frontend.** Ever.
- **All orchestration on the backend.** SSE in, JSON in.
- **PII scan before every LLM call.** `services/piiDetector.ts` is the chokepoint.
- **Audit every action** using `AuditAction` enum.
- **Ministry scoping on every query** — pull `ministryCode` from `req.user`.
- **Alberta Design System** — colours, fonts, components.
- **No browser spoofing** in `web_scrape`.
- **Parameterized SQL only.**
- **Idempotent + additive migrations** in `docs/02_database_migrations.sql`.
- **Don't copy code from the prototype.** Intent only.

---

## 7. Running the App Locally

```bash
# Backend (port 3000)
cd backend && pnpm install && pnpm dev

# Frontend (port 5173)
cd frontend && pnpm install && pnpm dev
```

The Vite proxy already forwards `/api/*` to `http://localhost:3000`.

Required env (see `backend/.env.example`): `DATABASE_URL`, `ANTHROPIC_API_KEY` or `VERTEX_AI_API_KEY`. Everything else is optional and the corresponding tools fail gracefully.

---

## 8. Reference Material

- **Spec app source:** `https://github.com/developmentation/agent-builder-console`
- **Live spec:** `https://agentbuilderconsole.com`
- **Architecture diagrams:** `docs/architecture_current.png`, `docs/architecture_target.png`, `docs/architecture_rebuild.png`
- **Schema + seed:** `docs/02_database_migrations.sql`
- **Spec key files (reference, don't copy):** `src/hooks/useFreeAgentSession.ts`, `supabase/functions/free-agent/index.ts`, `public/data/systemPromptTemplate.json`, `public/data/toolsManifest.json`, `src/lib/loopDetector.ts`, `src/lib/functionDefinitions.ts`

---

## 9. Exit Criteria for the Whole Build

The exercise is complete when:

1. All 6 streams meet their acceptance criteria.
2. Peer review (Day 4, 2026-05-25) shows our `features`, `vulnerabilities`, `migration`, `plan`, `privacy_controls` tables are well-populated and defensible vs other attempts.
3. App is deployed at Nexus with SSO; demonstrable on Cohen's account.
4. SOAR / STRA package ready for ATO sign-off (Protected B handling).
5. Red and Blue agent reports captured with remediations applied.
6. The Free Agent and Workflow modes faithfully port the spec app's behavior — with the security, observability, and account features the spec lacked.

---

## 10. Beyond-Spec Enhancement Backlog (Pickable Work)

Once the Streams A–F exit criteria are met, the items below are the open
backlog. They are sized so a single dev bot can pick one off the list,
ship it end-to-end (code + tests + docs), and not block another bot. Each
row names the **surface area** so concurrent bots can avoid collisions —
keep `docs/00_AGENT_COORDINATION.md` in sync when you claim one.

Items already shipped during the post-Stream phase: cost estimation
dialog (§4.3, Bot 1), dark mode (§4.1, Bot 2 in progress), additional
eval scenarios (Bot 3 in progress), workflow export/import (§3.3),
session replay (§3.4), parallel branch execution (§3.5), dashboard
panel (§3.2), GoA agent templates (§3.1), inbound PII scan, model
registry wiring in WorkflowView (§2.3), ministry filter (§2.4),
document titles, keyboard shortcuts, toast feedback.

### 10.1 Frontend UX

| # | Idea | Why it matters | Likely files |
|---|------|----------------|--------------|
| ~~F1~~ | ~~**Workflow version diff viewer**~~ — **Done by Bot 14, 2026-05-22.** `WorkflowCanvas.vue` gains an optional `diffOverlay` prop that paints removed nodes/edges with a red striped ring, modified ones with an amber ring, and ghost-renders added nodes (low-opacity, green dashed) at their target positions. A top-of-canvas banner surfaces `Previewing v{N} — Restore / Cancel`. The store's `versionPreview.diff` (already populated by `previewVersion`) drives the overlay; the standalone `WorkflowDiffView.vue` originally listed was unnecessary once the in-place overlay landed. 9 new vitest cases. | The diff library is already built (`frontend/src/lib/canvasDiff.ts`) and the history panel summarises diffs, but users can't actually *see* what changed visually. | `components/workflow/WorkflowDiffView.vue` (new), `WorkflowHistoryPanel.vue`, `WorkflowCanvas.vue` (diff-overlay mode) |
| ~~F2~~ | ~~**Workflow template gallery**~~ — **Done by Bot 17, 2026-05-22.** New `/workflows/templates` view lists `is_template=true` workflows ministry-scoped (existing `?templates=true` filter); each card has a "Use as starting point" action that calls `store.duplicate` (already strips `is_template` and re-owns the row). Tag chip + dropdown filtering, full-text + tag search. Empty state guides users toward publishing their own. Backed by 10 new Vitest cases. | The schema already supports `is_template`; the UI only exposes the flag as a checkbox today. | `views/WorkflowTemplatesView.vue` (new), `router/index.ts`, `stores/workflow.ts` |
| F3 | **Saved-prompts categories + drag-to-reorder** — group saved prompts under user-defined categories; reorder by drag handle. | Long lists of saved prompts become unmanageable; categories are a low-effort information-architecture win. | `views/ProfileView.vue`, `stores/userMemory.ts`, migration adding `saved_prompts.category` (additive) |
| ~~F4~~ | ~~**Session transcript export**~~ — **Done by Bot 9, 2026-05-22.** Backend `sessionExporter.ts` + `GET /api/agent/sessions/:id/export` + `SessionHistoryView` at `/sessions`. PDF was descoped (would need server-side Chromium / wkhtmltopdf); browser "Print to PDF" on the Markdown view is the documented workaround. | Users need to attach evidence to briefing notes; today they screenshot. | `views/SessionHistoryView.vue` (new export action), backend export route, `services/sessionExporter.ts` (new) |
| ~~F5~~ | ~~**Workflow tag system**~~ — **Done by Bot 17, 2026-05-22.** Idempotent `ALTER TABLE workflows ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}'` + GIN index. POST/PUT accept tags; PUT does partial-update semantics (omit = leave alone); GET list supports `?tag=foo&tag=bar` array-overlap filter; duplicate inherits tags (but resets `is_template`). New `WorkflowTagsEditor` component (lowercase / dedupe / 12-tag cap / 32-char-per-tag normalisation) wired into `WorkflowToolbar.vue` and rendered readonly per row in `WorkflowListView.vue`. 15 backend tag tests + 15 editor tests + 6 list-view filter tests + 5 store tests. | Ministries with hundreds of workflows need taxonomy beyond name search. | Additive migration `workflows.tags TEXT[]`, `WorkflowListView.vue`, `WorkflowToolbar.vue` |
| F6 | **In-app changelog viewer** — small "What's new" panel that surfaces the latest model registry updates and recent admin-published notices. | Operators need to know when a model is deprecated; admins need a non-email channel. | `components/admin/ChangelogEditor.vue` (new), `views/HomeView.vue` (changelog widget), additive `cohen_mcleod.changelog` table |
| F7 | **First-run onboarding tour** — guided overlay that walks new users through Free Agent → first workflow → admin panel (for admins). Triggered by `user_preferences.has_onboarded = false`. | Reduces drop-off; onboarding is the only place to surface non-obvious features (Ctrl+Enter, prompt customizer, etc.). | `composables/useOnboardingTour.ts` (new), `views/FreeAgentView.vue`, `views/WorkflowView.vue` |
| ~~F8~~ | ~~**Pinnable iterations + "starred" sessions**~~ — **Done by Bot 19, 2026-05-22.** Adds `agent_sessions.starred` + `agent_iterations.pinned` BOOLEAN columns (partial indexes only carry the starred/pinned rows so the "Starred only" query is index-only). Two PATCH endpoints (`/sessions/:id/star`, `/sessions/:id/iterations/:n/pin`), `?starred=true` filter on `GET /me/recent-sessions`, `starred` / `pinned` fields on the existing `GET /sessions/:id` + `GET /sessions/:id/iterations` responses. `SessionHistoryView` gains a per-row star toggle and a "Show starred / Starred only" chip; `IterationTimeline` gains a per-row pin toggle and sorts pinned iterations to the top. Optimistic-flip with roll-back-on-failure so the toggle feels instant. Audited as `AGENT_SESSION_STARRED` + `AGENT_ITERATION_PINNED`. 37 new tests across backend (15) and frontend (22). | Done. | n/a |

### 10.2 Backend reliability & features

| # | Idea | Why it matters | Likely files |
|---|------|----------------|--------------|
| ~~B1~~ | ~~**Per-user / per-ministry token budgets**~~ — **Done by Bot 15, 2026-05-22.** Additive `cohen_mcleod.token_budgets` table + denormalized `workflow_executions.total_tokens` column. `services/budgetGuard.ts` resolves `user > ministry > global` and aggregates monthly usage from `agent_iterations.tokens_used` + `workflow_executions.total_tokens`. Hooks into `agentOrchestrator` (pre-iteration check; emits `budget_exceeded` SSE + terminates) and `workflowExecutor` (per-agent-stage check + final token tally; hard-stops the workflow on a budget hit even when `continueOnError`). Admin UI: `BudgetPanel.vue` + new "Token budgets" tab under Configuration. User UI: ProfileView "Token usage this month" panel with progress bar + percent badge. New audit actions `BUDGET_SET`, `BUDGET_DELETED`, `BUDGET_EXCEEDED`. 57 new backend tests + 8 new frontend tests. | Prevents runaway LLM spend; auditors want a hard cap. | New `services/budgetGuard.ts`, additive migration `cohen_mcleod.token_budgets`, hook into `agentOrchestrator.ts` + `workflowExecutor.ts`, `routes/admin.ts`, `routes/users.ts`, `components/admin/BudgetPanel.vue`, `views/ProfileView.vue` |
| B2 | **Workflow scheduling (cron-like)** — let users schedule a workflow to run nightly / weekly with a chosen classification and parameters. | Common ask: "Email me the weekly headlines summary." Removes need for external task scheduler. | New `services/workflowScheduler.ts`, `routes/workflow.ts` (`POST /:id/schedule`), additive `workflow_schedules` table, background worker startup hook |
| ~~B3~~ | ~~**Webhook delivery on session/workflow completion**~~ — **Done by Bot 21, 2026-05-22.** `services/webhookDispatcher.ts` + `routes/webhooks.ts` ship HMAC-SHA256-signed outbound POSTs (secret derived from `SECRETS_VAULT_KEY` + per-subscription `secret_label`), 5-second timeout, 3-attempt exponential backoff. Per-attempt audit row in `webhook_deliveries`. Hooks fire at session terminal-state (orchestrator) and `workflow_complete` (executor). Admin UI: new "Webhooks" tab in AdminView with CRUD modals, enabled toggle, "Send test" inline action, recent-deliveries drill-down. 51 new tests (19 dispatcher + 23 admin route + 9 panel). Audited as `WEBHOOK_SUBSCRIPTION_*` / `WEBHOOK_DELIVERED`. | Lets other GoA systems subscribe to completions. | `services/webhookDispatcher.ts` (new), `routes/webhooks.ts` (new), additive `webhook_subscriptions` + `webhook_deliveries` tables, signature scheme using `SECRETS_VAULT_KEY` |
| B4 | **Soft-delete with restore window for workflows** — `DELETE /api/workflows/:id` flips a `deleted_at` column instead of hard-deleting; nightly job purges after 30 days; admin UI can restore. | Mistaken deletes are a real concern for shared ministry workflows. | `routes/workflow.ts`, additive `workflows.deleted_at TIMESTAMPTZ`, `retentionJob.ts` extension, admin UI "Trash" view |
| ~~B5~~ | ~~**Health endpoint split**~~ — **Done by Bot 9, 2026-05-22.** `/api/health/live` returns `{ status: "alive" }` 200 unconditionally and never touches the DB. `/api/health/ready` returns `{ status: "ready" }` 200 when the DB is reachable; `{ status: "not_ready", reason: "database_disconnected" }` 503 otherwise. LLM + queue checks deferred — adding them risks readiness-flapping when a single provider rate-limits. | Standard practice; needed for Nexus liveness checks. | `routes/health.ts`, `docs/operations/observability.md` |
| ~~B6~~ | ~~**FOIP s.7 right-of-access export**~~ — **Done by Bot 13, 2026-05-22.** `services/userDataExporter.ts` + `POST /api/admin/users/:id/export` ship a `application/zip` archive containing one JSON file per user-attributable table (`user`, `preferences`, `saved_prompts`, `workflow_favorites`, `workflows`, `workflow_versions`, `workflow_executions`, `agent_sessions`, `agent_iterations`, `artifacts`, `audit_log`, `pii_detections`, `secret_labels`) plus a README.md listing them with row counts. Encrypted secret values intentionally excluded; non-text artifact payloads scrubbed. Audited as `AuditAction.USER_DATA_EXPORTED`. 15 new vitest cases (10 exporter + 5 route). | Compliance requirement under FOIP — operators must be able to fulfill access requests. | New `services/userDataExporter.ts`, `routes/admin.ts` (`POST /users/:id/export`), audit logged with `AuditAction.USER_DATA_EXPORTED` |
| ~~B7~~ | ~~**Workflow execution dry-run mode**~~ — **Done by Bot 12, 2026-05-22.** `ExecutionContext.dryRun` threads from `POST /api/workflows/:id/execute` body into `workflowExecutor.runWorkflow`. Agent/tool/non-branch-function leaves are stubbed; branch functions still actually evaluate so prune behavior is exercised; PII scan still blocks; cycles still error; provider-not-configured check skipped on dry-run. Audited as `WORKFLOW_DRY_RUN`. UI: toolbar "Dry run" button next to "Run" + ExecutionPanel "Dry run" banner. 27 new tests (12 executor + 8 route + 7 store). | Pairs naturally with the cost estimator (§4.3) to make pre-flight checks first-class. | `services/workflowExecutor.ts` (new `dryRun` flag), `routes/workflow.ts` (`POST /:id/execute` adds `dryRun: true`), `WorkflowToolbar.vue`, `ExecutionPanel.vue`, `stores/workflow.ts`, `views/WorkflowView.vue` |
| ~~B8~~ | ~~**Outbound rate-limit hardening per provider**~~ — **Done by Bot 11, 2026-05-22.** Per-provider semaphore wrapper in `services/llmProvider.ts` isolates each provider's in-flight queue so a Vertex AI throttle no longer drags Gemini calls down with it. Public `callLLM` / `streamLLM` signatures unchanged. 2 dedicated concurrency tests pin the isolation contract. | Provider quotas are independent — limiting them as one is wasteful. | `middleware/agentRateLimit.ts`, `services/llmProvider.ts` |

### 10.3 Security & compliance

| # | Idea | Why it matters | Likely files |
|---|------|----------------|--------------|
| S1 | **Content Security Policy headers** — add a strict CSP via Helmet (already a likely dep) that restricts script sources to `self` + Alberta DS CDN; report violations to a `/api/csp-report` endpoint logged for audit. | XSS defence-in-depth; STRIDE T-002 mitigation. | `index.ts` (Helmet config), new `routes/cspReport.ts` |
| ~~S2~~ | ~~**SOC2 evidence collection automation**~~ — **Done by Bot 22 + extended by Bot 24, 2026-05-22.** Daily + on-demand snapshot of controls matrix, audit-log retention, PII counts by classification, model registry, retention-job last-run, plus webhook deliveries (real bucket counts after Bot 24's `webhook_deliveries.status` lazy-impl fix) + token budgets when those tables exist (degrades gracefully to `not_applicable_yet`). Output: Markdown artifact at `docs/compliance/evidence_YYYY-MM-DD.md` + row in `evidence_collections` table. Admin routes: `POST /api/compliance/evidence/run`, `GET /evidence` (list, Bot 24), `GET /evidence/latest`, `GET /evidence/:id` (detail, Bot 24). Scheduler armed when `EVIDENCE_JOB_ENABLED=true`. Audited as `AuditAction.EVIDENCE_COLLECTED` (Bot 24 wiring). AdminView "Compliance evidence" tab + `EvidencePanel.vue` shipped (Bot 24); CI cron workflow remains a follow-up. | Audit prep becomes a 5-minute task instead of a 5-day task. | `services/evidenceCollector.ts`, `routes/compliance.ts`, `docs/compliance/`, env vars, `evidence_collections` migration, `components/admin/EvidencePanel.vue`, `api.compliance` |
| ~~S3~~ | ~~**DAST scan in CI**~~ — **Done by Bot 23, 2026-05-22.** New `.github/workflows/security.yml` runs the pinned `zaproxy/action-baseline@v0.12.0` ZAP baseline nightly (04:30 UTC) + on workflow_dispatch + on push to backend routes/middleware. Backend boots with `MOCK_LLM=1` and `LOG_FORMAT=json` against a real Postgres service container; 60s liveness wait gates ZAP startup. Three artifacts uploaded per run (HTML / Markdown / JSON ZAP reports + backend log). Rule tuning lives in `.zap/rules.tsv`: 3 hard FAIL rules (CSRF, server-side injection, error disclosure), 3 WARN/IGNORE rules with reasoning comments. Triage workflow + open/resolved findings tables in `docs/security/dast_findings.md`. | Catches regressions early; complements Red/Blue report. | `.github/workflows/security.yml`, `.zap/rules.tsv`, `docs/security/dast_findings.md` |
| S4 | **gitleaks pre-commit hook (§4.4)** — `.pre-commit-config.yaml` + `.gitleaks.toml` to scan secrets before commit. | Recommendations doc §4.4. Tiny scope, real value. | Root `.pre-commit-config.yaml` (new), README install note |
| S5 | **Encryption-at-rest audit + migration** — verify every PII-bearing column is encrypted via pgcrypto; convert any plaintext stragglers. | Protected B requirement; current vault covers `user_secrets` but `agent_sessions.prompt` is plaintext. | New `services/columnEncryption.ts`, additive migration, `retentionJob.ts` updates |
| S6 | **Penetration test playbook** — runbook for the Red agent's next pass, scoped to features added post-Stream F (admin UI, replay, parallel branches, cost endpoint). | Re-attestation cycle for ATO renewal. | `docs/security/red_team_scenarios.md` extension |

### 10.4 Operations & observability

| # | Idea | Why it matters | Likely files |
|---|------|----------------|--------------|
| O1 | **Metrics endpoint (Prometheus format)** — `/api/metrics` exposing histograms for request latency, LLM token usage, tool execution counts, retention deletes. | Standard observability; lets the Nexus monitoring stack scrape without parsing JSON logs. | New `services/metrics.ts`, `routes/metrics.ts`, `docs/operations/observability.md` |
| O2 | **Slow-query report job** — periodic job that summarises queries above the existing slow-query log threshold and writes to an admin-readable table. | Today slow queries log but never aggregate; SREs need a weekly digest. | New `services/slowQueryReporter.ts`, additive table, admin UI tab |
| O3 | **Canary deployment workflow** — split the Nexus deploy into staging → 10% canary → 100%, with a manual approval gate between stages. | Reduces blast radius of bad deploys. | `.github/workflows/deploy.yml`, `docs/operations/deployment_nexus.md` |
| ~~O4~~ | ~~**Structured log shipping to Loki/ELK**~~ — **Done by Bot 23, 2026-05-22.** `services/logger.ts` refactored to a constructor-options-driven `Logger` class with `LOG_FORMAT` (json/pretty), `LOG_LEVEL` (debug/info/warn/error), and `LOG_SERVICE_NAME` env vars. NDJSON output now includes both `level` (UPPER, legacy contract) and `severity` (lower, Loki convention). 24 vitest cases pin the schema. Production defaults to `json` + `INFO`; dev defaults to `pretty` + `DEBUG`. Observability runbook gains a JSON schema table + Vector sidecar example. | Required for incident triage in production. | `services/logger.ts`, `services/__tests__/logger.test.ts` (new), `config/env.ts`, `docs/operations/observability.md` |
| O5 | **Nexus deployment dry-run** (Available work F) — annotate `docs/operations/deployment_nexus.md` with observations from a local dry-run of the manifest + deploy workflow. | Catches misconfigurations before the real deploy. | `docs/operations/deployment_nexus.md`, `nexus/manifest.yaml` clarifications |
| O6 | **Real-LLM end-to-end verification log** (§2.1) — drive a complete Free Agent session against Vertex AI and capture the SSE timeline. | Recommendations §2.1; the single highest-value reviewer artifact still outstanding. | `docs/quality/e2e_verification_log.md` (new). Needs real `VERTEX_AI_API_KEY` — confirm before claiming. |

### 10.5 Tooling, DX, documentation

| # | Idea | Why it matters | Likely files |
|---|------|----------------|--------------|
| ~~D1~~ | ~~**Auto-generated OpenAPI schema**~~ — **Done by Bot 20, 2026-05-22.** Programmatic OpenAPI 3.1 spec lives in `backend/src/lib/openapi/spec.ts` with all production routes (health, auth, agent, workflow, users, admin, metrics — `MOCK_LLM`-gated `/api/test` deliberately excluded). Served live at `GET /api/openapi.json` (auth-free JSON) and `GET /api/docs` (Swagger UI HTML with per-response CSP allowing the jsdelivr CDN). 29 new vitest cases (18 spec + 11 route) green. Hosted in a dedicated `routes/openapi.ts` rather than `routes/admin.ts` so Bot 15's in-progress admin work has no collision. README updated with usage. Generating a version-controlled `docs/api/openapi.yaml` from `spec.ts` is left as a one-line follow-up. | External integrators have nothing to read today except the source. | `backend/src/lib/openapi/{types,spec}.ts` + tests, `backend/src/routes/openapi.ts` + tests, `backend/src/index.ts` mount, README API documentation section. |
| ~~D2~~ | ~~**Architecture Decision Records**~~ — **Done by Bot 22, 2026-05-22.** Series seeded under `docs/adr/` with five load-bearing ADRs: 0001 Thin client / thick server, 0002 Vue Flow for the workflow canvas, 0003 pgcrypto for at-rest secret encryption, 0004 SSE over WebSockets for streaming, 0005 Ministry-scoped row-level data partitioning. `docs/adr/README.md` documents the Nygard-style template + index + when-to-write-one guidance. | Onboarding new engineers takes a week today; ADRs cut that to a day. | `docs/adr/0001-thin-client-thick-server.md` etc. |
| D3 | **Component Storybook** — Storybook 8 build hosting the Free Agent + Workflow components in isolation with controlled props. | Visual regression catch-net; designers can iterate without spinning up the full app. | `frontend/.storybook/`, `*.stories.ts` per component |
| D4 | **Bundle-size budget in CI** — `size-limit` config that fails CI on >5% bundle growth, with a per-route breakdown. | The Vue Flow bundle is large; we need a guardrail before it grows. | Root `.size-limit.json`, `.github/workflows/ci.yml` |
| D5 | **Accessibility re-audit** (Available work G) — re-run axe and manual checks on the Workflow + Free Agent views (originally marked out of scope in `docs/quality/accessibility_audit.md`). | WCAG 2.1 AA compliance is non-negotiable for GoA. | `docs/quality/accessibility_audit.md`, `test/accessibility/axe.test.ts` |
| D6 | **Database ERD refresh** — generate a current ER diagram from `02_database_migrations.sql` and embed it in the README. | The architecture diagrams pre-date the post-stream additions. | `docs/architecture_target.png` regeneration, `README.md` |
| ~~D7~~ | ~~**VS Code workspace config**~~ — **Done by Bot 23, 2026-05-22.** Complete `.vscode/{extensions,settings,tasks,launch}.json` set. Extensions: Volar (Vue 3), ESLint, EditorConfig, Tailwind, Vitest, cSpell, PostgreSQL, GitLens. Settings: tab 2, ESLint per-package working dirs, project cSpell word list (`abgov`, `Entra`, `FOIP`, `goa-*`, etc.). Tasks: 9 named commands (dev / test / build / lint / type-check / db migrate). Launch: 5 debug profiles (backend tsx, attach inspector, Vitest current file for backend & frontend, Chrome attach for the Vite app) + one full-stack compound. | One-click onboarding for new contributors. | `.vscode/extensions.json`, `.vscode/settings.json`, `.vscode/tasks.json`, `.vscode/launch.json` |

---

When a bot picks an item, add a row to `docs/00_AGENT_COORDINATION.md`
following the existing template (Slice / Status / Files claimed / Files
NOT touched / Acceptance). When the item ships, link the PR or commit
range from the same row.
