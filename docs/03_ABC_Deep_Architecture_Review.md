# Agent Builder Console (ABC) — Deep Architecture & Security Review

**Prepared by:** Cohen McLeod  
**Date:** May 20, 2026  
**Status:** Deep Analysis Phase

---

## Executive Summary

Following the initial remediation plan, a second, deeper code-level analysis of the Agent Builder Console (ABC) repository was conducted. This review focused on runtime execution paths, edge function implementations, frontend state management, and live UX observations. 

The deep dive confirms that ABC is fundamentally a **"thick-client, thin-proxy" architecture**. The React frontend holds almost all orchestration logic, memory, and secrets, while the Supabase edge functions act primarily as unauthenticated, permissive proxies to external services. This pattern introduces severe security, privacy, and governance risks that validate the need for the comprehensive Node.js backend migration proposed in the initial plan.

---

## 1. Code-Level Architectural Findings

### 1.1 The "Thick Client" Anti-Pattern

The most significant architectural finding is that the application's core intelligence and state live entirely in the browser.

**Evidence from `useFreeAgentSession.ts` and `freeAgentToolExecutor.ts`:**
- **Memory is Client-Side:** The blackboard, scratchpad, artifacts, and tool result attributes are maintained in React state and synchronous `useRef` hooks. They are passed back and forth to the backend on every iteration.
- **Frontend Tools:** 15 of the 36 tools are executed entirely in the browser. This includes all memory operations (`read_blackboard`, `write_scratchpad`), file reading, and document exports.
- **Advanced Features:** The "Self-Author" (prompt modification) and "Spawn" (child agent creation) features are implemented in the frontend. The `write_self` tool modifies `localStorage` directly.
- **Loop Detection:** The 4-level loop detection system runs in the browser before making API calls, injecting fake "intervention" tool results into the payload.

**Risk Impact:** 
Because the orchestration logic is client-side, a malicious user can bypass loop detection, manipulate memory state, or extract the full system prompt simply by modifying the client-side JavaScript or intercepting network requests.

### 1.2 Secret Management Vulnerability

**Evidence from `useSecretsManager.ts`:**
- Secrets (API keys, OAuth tokens) are stored in plaintext in the browser's `sessionStorage`.
- The frontend computes a `SecretOverrides` object and sends the raw API keys in the JSON payload to the edge functions on every tool call.
- The application supports importing `.env` files directly into the browser to populate these secrets.

**Risk Impact:**
This is a critical security flaw. Any Cross-Site Scripting (XSS) vulnerability in the application would allow an attacker to steal all configured API keys. Furthermore, sending API keys back and forth in request payloads increases the risk of interception or accidental logging.

### 1.3 The `web-scrape` Edge Function (SSRF & Abuse Vector)

**Evidence from `supabase/functions/web-scrape/index.ts`:**
- **Wildcard CORS:** `Access-Control-Allow-Origin: *` allows any website to use this endpoint.
- **Browser Spoofing:** The function maintains an array of modern browser `User-Agent` strings and rotates them randomly. It also injects fake `Sec-CH-UA` and `Referer: https://www.google.com/` headers to bypass bot detection.
- **Adaptive Throttling:** It implements complex retry logic for 429s, connection resets, and SSL errors, specifically relaxing SSL validation for "trusted government domains" (`gov.ab.ca`, `gc.ca`).
- **No Authentication:** The endpoint requires no API key or JWT.

**Risk Impact:**
This endpoint is an open, unauthenticated scraping proxy designed to evade bot detection. It can be abused by anyone on the internet to launch scraping attacks, perform Server-Side Request Forgery (SSRF) against internal GoA resources, or mask malicious traffic behind the Supabase IP addresses.

### 1.4 Workflow Execution Streaming

**Evidence from `run-agent-anthropic/index.ts` and `Index.tsx`:**
- Workflow mode does not use the sophisticated `free-agent` orchestrator. Instead, it uses provider-specific endpoints (`run-agent`, `run-agent-anthropic`, `run-agent-xai`).
- These endpoints eagerly execute a hardcoded list of tools (`google_search`, `weather`, `time`, `web_scrape`, `api_call`) *before* calling the LLM.
- The raw JSON results of these tools are concatenated directly into the user prompt.
- The frontend `Index.tsx` parses Server-Sent Events (SSE) to stream the response into the UI.

**Risk Impact:**
The eager execution of tools means that user input is passed directly to external APIs (like search or web scraping) without LLM mediation or sanitization. The hardcoded tool list makes the workflow mode rigid and difficult to extend securely.

---

## 2. Live Application UX Review

A review of the live application at `AgentBuilderConsole.com` revealed several UX and accessibility issues that must be addressed in the Vue.js migration.

### 2.1 Initial Load and Rendering
- **Blank Screen Issue:** The application frequently loads to a blank white screen. The DOM is populated, but content remains invisible until a scroll or interaction event triggers a re-render. This indicates a hydration or CSS layout bug in the React/Tailwind implementation.

### 2.2 Layout and Information Architecture
- **Cramped Sidebar:** The left sidebar in Workflow mode is overloaded. It stacks Workflow Name, Prompt, File Upload, Model Selection, Agent Library, and Functions Library vertically without collapsible sections or clear visual hierarchy.
- **Unclear Branding:** The logo is simply "ABC" in a small box. There is no GoA or ministry branding, and no indication of the user's identity or login state.
- **Canvas Empty State:** While the "Start Building Your Workflow" message is helpful, the massive empty canvas area contrasts sharply with the cramped sidebar.

### 2.3 Accessibility (WCAG) Gaps
- **Missing ARIA Attributes:** A scan of the component files revealed very few `aria-` or `role=` attributes, particularly in the custom Free Agent components.
- **Focus Management:** The live app lacks visible focus indicators for keyboard navigation on many interactive elements.
- **Contrast:** Some secondary text (like model descriptions) uses light gray colors that likely fail WCAG AA contrast requirements.

---

## 3. Refined Remediation Recommendations

Based on this deeper analysis, the following specific technical recommendations are added to the migration plan:

### 3.1 Backend Architecture Shift
The target Node.js backend must completely invert the current responsibility model:
1. **Server-Side Orchestration:** The `useFreeAgentSession` logic must be moved to the Node.js backend. The frontend should only send the user's prompt and receive streaming updates of the agent's progress.
2. **Server-Side State:** Blackboard, scratchpad, and artifacts must be stored in PostgreSQL, not in the browser's memory.
3. **Server-Side Secrets:** API keys must be stored encrypted in the database or injected via secure environment variables on the server. The frontend should never see or transmit an API key.

### 3.2 Security Hardening of Proxies
The `web-scrape` and `api-call` endpoints must be heavily restricted:
1. **Remove Browser Spoofing:** Remove the fake `Referer` and rotating `User-Agent` strings. The service should identify itself transparently (e.g., `GoA-ABC-Bot/1.0`).
2. **Strict Allowlisting:** Implement a strict URL allowlist for the `api-call` endpoint, preventing SSRF attacks against internal IP ranges (10.x.x.x, 192.168.x.x, 169.254.169.254).
3. **Remove Wildcard CORS:** Enforce strict CORS policies allowing only the specific Nexus frontend domain.

### 3.3 Frontend Framework Migration Strategy
When migrating from React to Vue.js 3:
1. **Replace React Flow with Vue Flow:** The canvas logic in `WorkflowCanvas.tsx` maps cleanly to Vue Flow, but the custom node components (`AgentNode`, `FunctionNode`) will need to be rewritten as Vue Single File Components (SFCs).
2. **Replace React Query with Pinia:** The complex, synchronous `useRef` state management in `useFreeAgentSession` should be refactored into a clean, reactive Pinia store.
3. **Fix the Blank Screen Bug:** Ensure the Vue.js layout uses proper CSS Grid or Flexbox structures that don't rely on scroll events to trigger visibility.

### 3.4 Code Quality and Safety
1. **Remove `dangerouslySetInnerHTML`:** The current codebase uses this in `chart.tsx`. In Vue, use `v-html` only when absolutely necessary, and always run the content through DOMPurify first.
2. **Strict TypeScript:** The current codebase has 69 instances of `any` or `as any`. The Vue migration should enforce strict typing, especially for the complex JSON payloads passed between the canvas and the execution engine.

---

## Conclusion

The deep dive confirms that ABC is a functional but highly insecure prototype. Its reliance on client-side orchestration and unauthenticated edge functions makes it unsuitable for GoA deployment in its current state. The proposed migration to a Vue.js + Node.js monorepo with Entra ID authentication, server-side state management, and strict API controls is the correct and necessary path forward.
