# ABC Rebuild — Phase Instructions for Continuation

This document provides detailed instructions for each remaining build phase. Any agent picking up this work should read `AGENTS.md` first, then follow these phases in order.

---

## Phase 1: Foundation & Security Core — COMPLETE

All items below are implemented and working:
- [x] pnpm monorepo (backend + frontend + shared)
- [x] Express backend with TypeScript (port 3000)
- [x] Helmet, CORS (dev: permissive, prod: restricted), rate limiting
- [x] Zod-validated environment config (`backend/src/config/env.ts`)
- [x] Database connection pool with schema scoping (`backend/src/config/database.ts`)
- [x] Authentication middleware with dev mock user (`backend/src/middleware/auth.ts`)
- [x] RBAC and ministry scoping middleware
- [x] PII detection service (`backend/src/services/piiDetector.ts`)
- [x] Audit logging service (`backend/src/services/auditLogger.ts`)
- [x] Health check route (`/api/health`)
- [x] Agent session route stubs (`/api/agent/sessions`)
- [x] Vue.js 3 frontend with Tailwind + Alberta DS tokens
- [x] App header with GoA branding and navigation
- [x] Free Agent view (three-panel layout)
- [x] Workflow view placeholder
- [x] Vite proxy to backend

---

## Phase 2: Backend Orchestration Engine

**Goal:** Build the server-side intelligence that replaces the original app's client-side `useFreeAgentSession.ts` hook.

### 2.1 Model Registry and LLM Provider Factory

Create `backend/src/services/llmProvider.ts`:
- Read approved models from the `model_registry` database table
- Implement a provider factory that routes to the correct API (Vertex AI for Claude, Google for Gemini)
- Each provider must: accept a system prompt + user prompt, return structured JSON, support streaming
- Reference the original app's `free-agent/index.ts` lines 887-993 for the provider abstraction pattern

### 2.2 Server-Side Iteration Loop

Create `backend/src/services/agentOrchestrator.ts`:
- This is the core engine. It replaces the 2,130-line `useFreeAgentSession.ts` React hook.
- The loop: (1) Build system prompt, (2) Call LLM, (3) Parse response, (4) Execute tool calls, (5) Update memory, (6) Check status, (7) Stream progress via SSE
- Memory (blackboard, scratchpad, attributes) must be stored in the `agent_sessions` table between iterations
- Implement the `executeIteration()` function that processes one agent step
- Implement SSE streaming: send events for `iteration_start`, `tool_call`, `tool_result`, `blackboard_update`, `iteration_complete`, `session_complete`

### 2.3 System Prompt Builder

Create `backend/src/services/promptBuilder.ts`:
- Port the prompt assembly logic from the original app's `systemPromptBuilder.ts` and `systemPromptTemplate.json`
- Copy `public/data/systemPromptTemplate.json` and `public/data/toolsManifest.json` from the original repo into `backend/src/data/`
- Build the dynamic system prompt with runtime variables (iteration number, blackboard content, scratchpad, available tools)

### 2.4 Loop Detection

Create `backend/src/services/loopDetector.ts`:
- Port the algorithm from the original `src/lib/loopDetector.ts` (350 lines)
- This is framework-agnostic TypeScript — it can be ported almost directly
- Integrate into the iteration loop: run detection before each LLM call

### 2.5 Tool Dispatcher

Create `backend/src/services/toolDispatcher.ts`:
- Central routing function: given a tool name and params, execute the correct handler
- Separate tools into "edge tools" (call external APIs) and "memory tools" (manipulate session state)
- Memory tools (read_blackboard, write_blackboard, read_scratchpad, write_scratchpad, read_attribute) operate directly on the session state in the orchestrator
- Edge tools are implemented in Phase 3

### 2.6 Update Agent Routes

Update `backend/src/routes/agent.ts`:
- `POST /api/agent/sessions` — Create session in database
- `POST /api/agent/sessions/:id/start` — Start the orchestrator, return SSE stream
- `POST /api/agent/sessions/:id/stop` — Set abort flag
- `POST /api/agent/sessions/:id/continue` — Resume with new prompt
- `POST /api/agent/sessions/:id/interject` — Inject guidance mid-execution
- `GET /api/agent/sessions/:id` — Get full session state

---

## Phase 3: Tool Ecosystem

**Goal:** Implement all 36 tools as secure Node.js services.

### 3.1 Web Search Tools

Create `backend/src/tools/webSearch.ts`:
- `brave_search`: Call Brave Search API with `BRAVE_SEARCH_API_KEY`
- `google_search`: Call Google Custom Search with `GOOGLE_SEARCH_API_KEY` + `GOOGLE_SEARCH_CX`
- Both: accept `query` and `numResults`, return structured results

### 3.2 Web Scraping Tool (SECURE)

Create `backend/src/tools/webScrape.ts`:
- Fetch URL content and extract text
- **CRITICAL SECURITY:** Block private IP ranges (10.x, 172.16-31.x, 192.168.x, 169.254.x, 127.x)
- **NO browser spoofing.** Use honest User-Agent: `GoA-ABC-Bot/1.0 (+https://gov.ab.ca)`
- Accept `url`, `maxCharacters`, return extracted text content
- Handle HTML (strip tags), PDF (use pdf-parse), DOCX (use mammoth)

### 3.3 GitHub Tools

Create `backend/src/tools/github.ts`:
- `read_github_repo`: List repository file structure via GitHub API
- `read_github_file`: Download file contents
- Support optional `GITHUB_TOKEN` for private repos

### 3.4 Document Processing Tools

Create `backend/src/tools/documents.ts`:
- `pdf_info`: PDF metadata extraction
- `pdf_extract_text`: PDF text extraction (use `pdf-parse` npm package)
- `ocr_image`: OCR via external API or Tesseract.js
- `read_zip_contents`, `read_zip_file`, `extract_zip_files`: ZIP handling (use `adm-zip`)

### 3.5 API Proxy Tool (RESTRICTED)

Create `backend/src/tools/apiProxy.ts`:
- `get_call_api` / `post_call_api`: Make HTTP requests to external URLs
- **CRITICAL:** Implement URL allowlisting or at minimum block private IPs
- Limit request/response size (1MB max)
- Timeout: 30 seconds

### 3.6 Database Tool (PARAMETERIZED)

Create `backend/src/tools/database.ts`:
- `execute_sql`: Run parameterized SQL queries
- `read_database_schemas`: Inspect database structure
- **CRITICAL:** Validate connection strings against an allowlist
- Default to read-only; require explicit `isWrite: true` flag for mutations

### 3.7 Generation Tools

Create `backend/src/tools/generation.ts`:
- `image_generation`: Call Gemini image generation API
- `elevenlabs_tts`: Call ElevenLabs TTS API with `ELEVENLABS_API_KEY`

### 3.8 Utility and Communication Tools

Create `backend/src/tools/utilities.ts`:
- `get_time`: Return current time for a timezone
- `get_weather`: Weather API call
- `send_email`: Send email (restrict recipients, require auth)

---

## Phase 4: Frontend — Free Agent UI

**Goal:** Build the full Free Agent interface that consumes the backend SSE stream.

### 4.1 Pinia Stores

Create `frontend/src/stores/agentSession.ts`:
- Manage session state (status, iterations, blackboard, scratchpad, artifacts)
- Implement SSE connection to backend
- Parse incoming events and update reactive state

### 4.2 SSE Streaming Consumer

Update `frontend/src/views/FreeAgentView.vue`:
- On "Start Agent": POST to create session, then POST to start, consume SSE stream
- Show real-time iteration progress
- Display tool calls as they execute
- Update blackboard/scratchpad/artifacts panels live

### 4.3 Memory Viewers

Create components:
- `frontend/src/components/BlackboardViewer.vue`: Categorized entries with iteration badges
- `frontend/src/components/ScratchpadViewer.vue`: Markdown-rendered scratchpad content
- `frontend/src/components/ArtifactsPanel.vue`: List of generated artifacts with download

### 4.4 Prompt Customization

Create `frontend/src/components/PromptCustomizer.vue`:
- Load system prompt template sections
- Allow enabling/disabling sections
- Allow editing section content
- Send customizations to backend with session start

### 4.5 Free Agent Canvas (Vue Flow)

Install `@vue-flow/core` and create `frontend/src/components/AgentCanvas.vue`:
- Show agent execution as a graph
- Nodes: Agent (center), Tool calls (around), Artifacts (bottom)
- Edges: Show execution flow between iterations

---

## Phase 5: Workflow Canvas

**Goal:** Rebuild the visual workflow builder using Vue Flow.

### 5.1 Vue Flow Integration

Create `frontend/src/views/WorkflowView.vue` (replace placeholder):
- Full Vue Flow canvas with drag-and-drop
- Custom node types: AgentNode, FunctionNode, ToolNode, NoteNode
- Connection validation (no backward connections between stages)

### 5.2 Workflow Sidebar

Create `frontend/src/components/workflow/WorkflowSidebar.vue`:
- Agent library (Researcher, Summarizer, Analyst templates)
- Function library (40+ functions from original app's `functionDefinitions.ts`)
- Drag-to-canvas node creation

### 5.3 Properties Panel

Create `frontend/src/components/workflow/PropertiesPanel.vue`:
- Edit selected node's configuration
- Agent nodes: system prompt, model, tools
- Function nodes: parameters, input/output configuration

### 5.4 Workflow Execution Engine

Create `backend/src/routes/workflow.ts` and `backend/src/services/workflowExecutor.ts`:
- Accept a workflow graph definition
- Execute stages sequentially
- For each agent node: call LLM with streaming
- For each function node: execute deterministic logic
- Stream results back via SSE

### 5.5 Workflow Persistence

Create `backend/src/routes/workflows.ts`:
- `POST /api/workflows` — Save workflow
- `GET /api/workflows` — List user's workflows
- `GET /api/workflows/:id` — Load specific workflow
- `DELETE /api/workflows/:id` — Delete workflow
- Store `canvas_data` as JSONB in the `workflows` table

---

## Phase 6: Testing, Polish & Deployment

### 6.1 Backend Tests

Set up Vitest in `backend/`:
- Test all middleware (auth, RBAC, rate limiting)
- Test PII detection patterns
- Test tool handlers
- Test agent orchestration loop
- Target: 80%+ coverage

### 6.2 Frontend Tests

Set up Vitest + Vue Test Utils in `frontend/`:
- Test Pinia stores
- Test key components (AppHeader, FreeAgentView)
- Test SSE consumption logic

### 6.3 Accessibility

- Run axe-core audit
- Fix all critical and serious issues
- Ensure keyboard navigation works throughout
- Add proper ARIA labels to all interactive elements
- Test with screen reader

### 6.4 Nexus Deployment

- Configure for GoA Nexus hosting
- Frontend on port 5173, backend on port 3000
- Set up Entra ID callback URLs for production
- Configure production environment variables
- Set CORS to production frontend URL only

### 6.5 SOAR/STRA Documentation

Produce:
- System architecture diagram (use `docs/architecture_rebuild.png`)
- Threat model (STRIDE analysis)
- Security controls matrix
- Data flow diagram showing PII scanning
- Privacy Impact Assessment

---

## Reference: Original App Spec

The original app source is at: `https://github.com/developmentation/agent-builder-console`

Key files to reference for behavior (DO NOT COPY CODE):
- `src/hooks/useFreeAgentSession.ts` — Agent orchestration logic (2,130 lines)
- `supabase/functions/free-agent/index.ts` — LLM calling and tool dispatch (1,279 lines)
- `public/data/systemPromptTemplate.json` — System prompt structure
- `public/data/toolsManifest.json` — Tool definitions (36 tools)
- `src/lib/loopDetector.ts` — Loop detection algorithm
- `src/lib/freeAgentToolExecutor.ts` — Frontend tool handlers
- `src/lib/functionDefinitions.ts` — Workflow function catalog

Live reference: `https://agentbuilderconsole.com`

---

## Important Constraints

1. **No secrets in frontend.** Ever. The Vue app never sees API keys.
2. **All orchestration on backend.** The frontend only renders and streams.
3. **PII scanning before every LLM call.** Use `piiDetector.ts`.
4. **Audit every action.** Use `auditLogger.ts`.
5. **Ministry scoping on all queries.** Filter by `ministry_code` from the user's JWT.
6. **Alberta Design System.** Follow https://design.alberta.ca for all UI.
7. **No browser spoofing in web scraping.** Identify as GoA bot transparently.
8. **Parameterized queries only.** Never concatenate user input into SQL.
