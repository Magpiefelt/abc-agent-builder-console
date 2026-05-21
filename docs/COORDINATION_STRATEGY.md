# Phase 2+ Coordination Strategy: ABC Rebuild & Hockey App Patterns

## Executive Summary

This document outlines the coordination strategy for completing the Agent Builder Console (ABC) rebuild. It documents what has been implemented by the enterprise hardening agent (leveraging patterns from `Magpiefelt/Hockey_app`) and what remains for the Phase 2 orchestration agent.

The core orchestration engine (`agentOrchestrator.ts`) was already substantially implemented before this work began. The enterprise hardening agent focused on non-overlapping concerns: structured logging, process resilience, granular rate limiting, request validation, and implementing all Phase 3 edge tools.

---

## Current State After This Work

| Component | Status | Owner |
| :--- | :--- | :--- |
| **Agent Orchestrator** | Substantially Built | Phase 2 Agent |
| **Prompt Builder** | Substantially Built | Phase 2 Agent |
| **Loop Detector** | Substantially Built | Phase 2 Agent |
| **Tool Dispatcher** | **COMPLETE** — registration pattern + real tools | Enterprise Agent |
| **Agent Routes** | **COMPLETE** — fully wired to orchestrator | Phase 2 Agent (already done) |
| **LLM Provider** | Substantially Built (needs end-to-end testing) | Phase 2 Agent |
| **Structured Logger** | **COMPLETE** | Enterprise Agent |
| **Process Monitor** | **COMPLETE** | Enterprise Agent |
| **Audit Logger** | **COMPLETE** — enum-based | Enterprise Agent |
| **Rate Limiting** | **COMPLETE** — granular per-endpoint | Enterprise Agent |
| **Request Validation** | **COMPLETE** — XSS/SQLi/traversal blocking | Enterprise Agent |
| **Database Layer** | **COMPLETE** — transactions, slow-query logging | Enterprise Agent |
| **Phase 3 Tools** | **MOSTLY COMPLETE** — see below | Enterprise Agent |

---

## Files Created (NEW)

| File | Purpose |
| :--- | :--- |
| `backend/src/services/logger.ts` | Structured JSON logging with levels, specialized methods |
| `backend/src/services/processMonitor.ts` | Catches unhandled rejections/exceptions, graceful shutdown |
| `backend/src/middleware/agentRateLimit.ts` | Granular per-endpoint rate limiting for agent routes |
| `backend/src/tools/register.ts` | **Startup registration** — imports all tools and calls `registerEdgeTools()` |
| `backend/src/tools/index.ts` | Barrel export for all tool implementations |
| `backend/src/tools/webSearch.ts` | Brave Search + Google Custom Search |
| `backend/src/tools/webScrape.ts` | Secure web scraping with SSRF protection |
| `backend/src/tools/github.ts` | GitHub repo listing + file reading |
| `backend/src/tools/documents.ts` | PDF extraction, ZIP handling, OCR stub |
| `backend/src/tools/utilities.ts` | get_time + get_weather (Open-Meteo) |
| `backend/src/tools/apiProxy.ts` | Secure HTTP proxy with private IP blocking |
| `docs/COORDINATION_STRATEGY.md` | This document |

## Files Modified (ENHANCED)

| File | Changes |
| :--- | :--- |
| `backend/src/index.ts` | Integrated processMonitor, requestValidation, agentRateLimit, tool registration via `registerAllTools()`, graceful shutdown via `closePool()` |
| `backend/src/config/database.ts` | Added transaction wrapper, slow-query logging, pool stats, closePool() |
| `backend/src/config/env.ts` | Added GITHUB_TOKEN to Zod schema |
| `backend/src/services/auditLogger.ts` | Added AuditAction enum, structured metadata, query helpers |
| `backend/src/services/toolDispatcher.ts` | Uses registration pattern (`registerEdgeTools`), timeout enforcement, result normalization |
| `backend/src/middleware/requestValidation.ts` | Enhanced with XSS/SQLi/code-exec pattern blocking, audit logging |
| `backend/.env.example` | Added GITHUB_TOKEN |
| `backend/package.json` | Added pdf-parse, adm-zip, @types/adm-zip dependencies |

---

## Critical Integration Detail: Tool Registration

The `toolDispatcher.ts` uses a **registration pattern** (not direct imports). Tools must be registered at startup before any agent session runs. This is handled by:

```
backend/src/index.ts
  → imports { registerAllTools } from "./tools/register.js"
  → calls registerAllTools() at startup (before Express routes are mounted)

backend/src/tools/register.ts
  → imports all tool handler functions
  → calls registerEdgeTools({...}) to populate the dispatcher's internal Map
```

If you add a new tool, you must:
1. Create the handler file in `backend/src/tools/`
2. Add the tool name to `KNOWN_EDGE_TOOLS` in `toolDispatcher.ts`
3. Import and register it in `backend/src/tools/register.ts`

---

## What the Phase 2 Agent Should Focus On

The Phase 2 agent should focus on **making the orchestration loop work end-to-end**:

1. **LLM Provider Finalization:** Verify `callLLM` correctly routes to Anthropic/Gemini providers and handles streaming.
2. **End-to-End Testing:** Create a session, start it, verify SSE events stream correctly, tool calls dispatch to real tools, memory persists.
3. **Error Recovery:** Test malformed LLM JSON, tool timeouts, database connectivity issues.
4. **Prompt Builder Verification:** Ensure dynamic prompt correctly injects blackboard state, scratchpad, attributes, and available tools.

**DO NOT modify these files** (they are complete and reviewed):
- `backend/src/services/logger.ts`
- `backend/src/services/processMonitor.ts`
- `backend/src/middleware/agentRateLimit.ts`
- `backend/src/middleware/requestValidation.ts`
- `backend/src/tools/*` (all tool files)
- `backend/src/config/database.ts`

---

## Phase 3 Tool Status

| Tool | Status | Notes |
| :--- | :--- | :--- |
| `brave_search` | **Implemented** | Requires BRAVE_SEARCH_API_KEY |
| `google_search` | **Implemented** | Requires GOOGLE_SEARCH_API_KEY + GOOGLE_SEARCH_CX |
| `web_scrape` | **Implemented** | SSRF-protected, GoA bot UA |
| `read_github_repo` | **Implemented** | Uses env.GITHUB_TOKEN for private repos |
| `read_github_file` | **Implemented** | Uses env.GITHUB_TOKEN |
| `pdf_extract_text` | **Implemented** | Requires pdf-parse package |
| `pdf_info` | **Implemented** | Requires pdf-parse package |
| `ocr_image` | **Stub** | Needs Tesseract.js or external OCR |
| `read_zip_contents` | **Implemented** | Requires adm-zip package |
| `read_zip_file` | **Implemented** | Requires adm-zip package |
| `extract_zip_files` | **Implemented** | Requires adm-zip package |
| `get_call_api` | **Implemented** | SSRF-protected, size-limited |
| `post_call_api` | **Implemented** | SSRF-protected, size-limited |
| `get_time` | **Implemented** | No external deps (also built-in fallback in dispatcher) |
| `get_weather` | **Implemented** | Uses Open-Meteo (free, no key) |
| `execute_sql` | **Not Implemented** | Needs connection allowlist design |
| `read_database_schemas` | **Not Implemented** | Needs connection allowlist design |
| `image_generation` | **Not Implemented** | Needs Gemini image API integration |
| `elevenlabs_tts` | **Not Implemented** | Needs ElevenLabs API integration |
| `send_email` | **Not Implemented** | Needs recipient allowlist + SMTP config |

---

## Architecture Decisions

1. **Structured Logger:** All services use `import { logger } from "./logger.js"` instead of raw `console.log`.
2. **Audit Actions:** Use the `AuditAction` enum from `auditLogger.ts` for all audit events.
3. **Rate Limiting:** Agent routes have their own middleware (`agentRateLimit.ts`) separate from the global limiter. Skips in development mode.
4. **Tool Registration:** Tools are registered at startup via `registerAllTools()` in `index.ts`. The dispatcher uses a Map-based registry with timeout enforcement (30s per tool).
5. **Result Normalization:** The dispatcher handles tools that return `{ success, result, error }` OR tools that return `{ success, ...domainData, error }` — it normalizes both patterns.
6. **Security:** All external HTTP calls block private IP ranges and use the GoA bot User-Agent.
7. **Process Resilience:** `processMonitor.ts` catches unhandled rejections (stays alive) and uncaught exceptions (exits in production). Graceful shutdown closes the database pool via `closePool()`.
8. **Database Transactions:** Use `import { transaction } from "./config/database.js"` for multi-statement operations.

---

## Installation

After pulling these changes, run:

```bash
cd abc-app/backend
pnpm install
```

This will install the new dependencies (`pdf-parse`, `adm-zip`, `@types/adm-zip`).
