# Prompt for Next Agent

Copy and paste the following as the prompt for the next agent session:

---

## Prompt

I'm working on the ABC (Agent Builder Console) rebuild — a greenfield build of an agentic workflow canvas tool for the Government of Alberta. The project is on my desktop at `agent-builder-console-main/abc-app/`.

Phase 1 (Foundation) is complete: the monorepo is set up with a Node.js Express backend (port 3000) and Vue.js 3 frontend (port 5173), including authentication middleware, PII detection, audit logging, and the basic Free Agent UI layout.

I need you to continue with **Phase 2: Backend Orchestration Engine**. This is the core of the application — the server-side iteration loop that replaces the original app's client-side React hook. Specifically:

1. Build the LLM provider factory (`backend/src/services/llmProvider.ts`) that reads approved models from a registry and routes to the correct API (Vertex AI Claude, Gemini, etc.)
2. Build the server-side iteration loop (`backend/src/services/agentOrchestrator.ts`) that: assembles the system prompt, calls the LLM, parses the structured JSON response, dispatches tool calls, updates memory (blackboard/scratchpad/attributes), checks status, and streams progress via SSE
3. Build the system prompt builder (`backend/src/services/promptBuilder.ts`) that assembles the dynamic prompt from template sections
4. Port the loop detection algorithm to `backend/src/services/loopDetector.ts`
5. Build the tool dispatcher (`backend/src/services/toolDispatcher.ts`) that routes tool calls to handlers
6. Update the agent routes to use the orchestrator and return real SSE streams

Read `AGENTS.md` and `docs/PHASE_INSTRUCTIONS.md` in the project for full context and constraints. The original app at `github.com/developmentation/agent-builder-console` is the behavioral reference — clone it to understand how the iteration loop, prompt assembly, and tool dispatch work, but do NOT copy code directly.

Key constraint: Everything runs server-side. The frontend only receives SSE events. No secrets or orchestration logic in the browser.

---
