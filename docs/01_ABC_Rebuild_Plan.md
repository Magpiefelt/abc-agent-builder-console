# Agent Builder Console (ABC) — Greenfield Build-Out Plan

**Prepared by:** Cohen McLeod  
**Date:** May 20, 2026  
**Schema:** `cohen_mcleod`  
**Status:** Planning Phase

---

## Executive Summary

The Agent Builder Console (ABC) is an agentic workflow canvas tool that enables users to construct repeatable AI-powered workflows. Following a deep architectural review of the existing prototype, it was determined that the current codebase (React + Supabase Edge Functions) suffers from fundamental architectural flaws, including a "thick-client" anti-pattern where orchestration and secrets are managed in the browser, zero authentication, and open proxy vulnerabilities.

Therefore, the strategy has shifted from *migration* to a **greenfield rebuild**. The existing application at `AgentBuilderConsole.com` and its source code will serve purely as a living functional specification. The new application will be built from the ground up on the Government of Alberta (GoA) standard stack: Vue.js 3, Node.js (Express), PostgreSQL, and Microsoft Entra ID SSO. This approach ensures a secure, enterprise-ready architecture capable of handling Protected B data from day one.

---

## 1. Product Requirements (Derived from Spec)

The new ABC application must deliver the following core capabilities, mirroring the functional intent of the original prototype but implemented securely.

### 1.1 Core Application Modes
1. **Workflow Mode:** A visual canvas (using Vue Flow) for building multi-stage deterministic and probabilistic pipelines. Users can drag and drop Agent, Function, Tool, and Note nodes, connect them, and execute the workflow sequentially.
2. **Free Agent Mode:** An autonomous AI agent interface capable of executing complex tasks over multiple iterations (up to 200) using a suite of integrated tools and a persistent memory system.

### 1.2 Memory Architecture (Free Agent)
The three-tier memory system must be preserved but managed entirely server-side:
- **Blackboard:** Categorized entries (observation, insight, plan, decision, error, artifact) tracking agent reasoning.
- **Scratchpad:** Persistent working memory for long-form content and summaries (with strict size limits to prevent context bloat).
- **Attributes:** Named storage for tool results, allowing the agent to reference previously fetched data without re-executing tools.

### 1.3 Tool Ecosystem
The application must support the 36 tools identified in the original spec, categorized as follows:
- **Web Tools:** Search (Brave, Google) and web scraping.
- **Code Tools:** GitHub repository browsing and file reading.
- **API Tools:** Generic GET/POST requests (with strict SSRF protections).
- **Document Tools:** PDF metadata/extraction, OCR, ZIP handling.
- **Utility Tools:** Time, weather.
- **Database Tools:** External SQL execution (parameterized and restricted).
- **Generation Tools:** Image generation (Gemini), Text-to-Speech (ElevenLabs).
- **Communication/Export Tools:** Email sending, Word/PDF export, Pronghorn integration.
- **Memory/UX Tools:** Blackboard/scratchpad operations, assistance requests.

### 1.4 Advanced Agent Capabilities
- **Loop Detection:** A multi-level system to detect repetitive behavior and inject interventions.
- **Self-Authoring:** The ability for the agent to modify its own system prompt (managed securely on the server).
- **Child Spawning:** The ability to spawn parallel child agents for subtasks and merge their memory back to the parent.
- **Prompt Enhancement & Reflection:** AI-assisted planning before execution and analysis after completion.

### 1.5 Enterprise Security & Privacy (New Requirements)
- **Authentication:** Microsoft Entra ID SSO integration.
- **Authorization:** Role-Based Access Control (RBAC) and ministry-based data segmentation derived from Entra ID groups.
- **PII Detection:** Regex-driven scanning of all content before it is sent to external LLM APIs.
- **Audit Logging:** Immutable tracking of all user actions, tool executions, and data access.
- **Secret Management:** Server-side encryption and injection of API keys; keys are never exposed to the frontend.

---

## 2. Target Architecture

### 2.1 Technology Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| **Frontend Framework** | Vue.js 3 (Composition API) + TypeScript | GoA standard; replaces React |
| **Build Tool** | Vite 5 | Fast, modern build tooling |
| **Styling** | Alberta Design System + Tailwind CSS | GoA compliance and accessibility |
| **State Management** | Pinia | Vue standard; replaces complex React refs |
| **Canvas Library** | Vue Flow | Direct equivalent to React Flow |
| **Backend Framework** | Node.js 22 + Express 5 + TypeScript | GoA standard; replaces Deno Edge Functions |
| **Database** | PostgreSQL (Render shared instance) | Relational data storage |
| **Authentication** | Microsoft Entra ID (OIDC) | GoA standard SSO |
| **LLM Integration** | Vertex AI (Claude) + Configurable Registry | GoA-approved AI provider |

### 2.2 Architectural Paradigm Shift

The fundamental change in this rebuild is moving from a **Thick Client** to a **Thin Client / Thick Server** model.

**Original Architecture (Flawed):**
- Browser holds API keys, manages the iteration loop, maintains memory state, and calls external APIs directly or via dumb proxies.

**New Architecture (Secure):**
- **Frontend (Vue.js):** Responsible *only* for UI rendering, canvas interaction, and displaying streaming updates. It holds no secrets and makes no direct external API calls.
- **Backend (Node.js):** Manages the iteration loop, maintains session state in PostgreSQL, securely injects API keys, enforces rate limits, scans for PII, and orchestrates all tool execution.

### 2.3 Data Model

All tables will reside in the `cohen_mcleod` schema.

1. **`users` & `ministries`:** Identity and segmentation.
2. **`workflows` & `workflow_versions`:** Persistent storage of canvas configurations.
3. **`agent_sessions`:** Top-level record of a Free Agent run.
4. **`agent_iterations`:** Granular tracking of each step in a session.
5. **`memory_state`:** Server-side storage of blackboard, scratchpad, and attributes.
6. **`artifacts`:** Generated files, images, and documents.
7. **`audit_log` & `pii_detections`:** Compliance and security tracking.
8. **`model_registry`:** Admin-configurable list of approved LLMs.

---

## 3. Phased Build-Out Plan

The rebuild will be executed in logical, manageable chunks, ensuring security and core functionality are established before complex features are added.

### Phase 1: Foundation & Security Core
**Goal:** Establish the monorepo, database, authentication, and secure API gateway.
- Initialize pnpm workspace (frontend/backend/shared).
- Set up Node.js Express server with TypeScript.
- Implement Entra ID OIDC authentication middleware.
- Create PostgreSQL schema and run initial migrations.
- Implement RBAC and ministry segmentation middleware.
- Set up the PII detection service and audit logging framework.

### Phase 2: Backend Orchestration Engine
**Goal:** Build the server-side intelligence that replaces the client-side React hooks.
- Implement the LLM provider factory (Vertex AI, etc.) driven by the database model registry.
- Build the server-side iteration loop (replacing `useFreeAgentSession`).
- Implement server-side memory management (blackboard, scratchpad, attributes).
- Build the loop detection algorithm as a backend service.
- Implement the secure tool execution dispatcher.

### Phase 3: Tool Ecosystem Porting
**Goal:** Reimplement the 36 tools as secure Node.js services.
- **Web Tools:** Implement secure scraping and search with strict SSRF protections and rate limiting.
- **Code/Doc Tools:** Implement GitHub, PDF, OCR, and ZIP handlers.
- **API/DB Tools:** Implement restricted HTTP proxy and parameterized SQL execution.
- **Generation Tools:** Integrate Gemini Image and ElevenLabs APIs securely.
- **Memory Tools:** Wire frontend memory requests to the new server-side state.

### Phase 4: Frontend Shell & Free Agent UI
**Goal:** Build the Vue.js application shell and the autonomous agent interface.
- Initialize Vue 3 + Vite + Pinia + Vue Router.
- Integrate the Alberta Design System.
- Build the Free Agent layout (Task panel, Canvas, Memory tabs).
- Implement SSE (Server-Sent Events) consumption to stream agent progress to the UI.
- Build the prompt customization, enhance, and reflect modals.

### Phase 5: Workflow Canvas (Vue Flow)
**Goal:** Rebuild the visual workflow builder.
- Integrate Vue Flow.
- Create custom Vue components for Agent, Function, Tool, and Note nodes.
- Implement the properties panel for node configuration.
- Build the workflow execution engine (translating the graph into sequential backend API calls).
- Implement workflow save/load functionality to the database.

### Phase 6: Testing, Polish, & Deployment
**Goal:** Ensure enterprise readiness.
- Write backend unit tests (Vitest) and API integration tests (Supertest).
- Conduct accessibility (WCAG 2.1 AA) and responsive design audits.
- Finalize SOAR/STRA security documentation.
- Deploy to GoA Nexus (Frontend on 5173, Backend on 3000).

---

## 4. Privacy and Information Management

The rebuild bakes privacy controls into the architecture rather than bolting them on:

1. **PII Interception:** A middleware layer scans all outgoing prompts and context using regex patterns (Health Numbers, SINs, Emails, API Keys) *before* they reach external LLMs. Detections trigger blocks or redactions and are logged.
2. **Ministry Isolation:** The backend extracts the user's ministry from their Entra ID token. All database queries automatically append `WHERE ministry_id = ?`, ensuring cross-ministry data leakage is impossible at the ORM level.
3. **Immutable Audit:** Every API request, tool execution, and LLM call generates an audit record containing the user ID, timestamp, action, and classification level.
4. **Data Classification:** Workflows and sessions are tagged with classification levels (Unclassified, Protected A, Protected B), which dictate export permissions and retention policies.

---

## 5. Success Criteria

The rebuild will be considered successful when:
1. **Feature Parity:** All capabilities of the original prototype are functional in the new Vue/Node stack.
2. **Security:** Penetration testing confirms no exposed API keys, no open proxies, and no unauthenticated endpoints.
3. **Compliance:** The application passes SOAR/STRA review for handling Protected B data.
4. **UX:** The application adheres to the Alberta Design System and meets WCAG 2.1 AA standards.
5. **Architecture:** The frontend contains zero orchestration logic or secrets, acting purely as a presentation layer.
