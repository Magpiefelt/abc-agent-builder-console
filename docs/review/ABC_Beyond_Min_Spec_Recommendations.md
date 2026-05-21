# ABC Agent Builder Console — Beyond Minimum Spec: Pre-Deployment Enhancements

**Date:** May 21, 2026
**Author:** Manus AI

## 1. Strategic Context

The ABC rebuild already exceeds the minimum viable product for the AI Garage exercise. The architecture is sound, the core features work, and the security posture is strong. The question now is: what additional work would make this application genuinely impressive at peer review on Day 4, demonstrating enterprise maturity that other attempts are unlikely to match?

The recommendations below are ordered by **impact-to-effort ratio** — the highest-leverage enhancements first. Each section identifies the gap, the enhancement, the files affected, and why it matters for the exercise evaluation.

---

## 2. High-Impact Enhancements (Strongly Recommended)

### 2.1 End-to-End Functional Verification with Real LLM

**Gap:** The orchestrator has never been tested against a real LLM provider. All testing uses `MOCK_LLM=1`. The exercise explicitly requires "faithful port + functional verification" (Brief Section 6.1).

**Enhancement:** Configure a real Vertex AI or Anthropic API key and run a complete Free Agent session end-to-end. Document the results: capture the SSE event stream, the blackboard entries produced, the tool calls made, and the final report. This becomes irrefutable evidence that the orchestration loop works under production conditions.

**Files affected:** `backend/.env` (add real key), capture output to `docs/quality/e2e_verification_log.md`.

**Why it matters:** This is the single most defensible artifact you can produce. Other teams may have code that compiles but has never actually run against an LLM. A documented successful session with real tool calls (web search, scrape, artifact creation) proves the system works.

---

### 2.2 Convert `agentSession.test.ts` Scaffolds into Real Tests

**Gap:** The frontend has 13 `it.todo` test stubs for the `agentSession` store, even though the store is fully implemented (540 lines). This makes the test suite look incomplete to reviewers.

**Enhancement:** Implement all 13 test cases. The store already exists and the SSE event vocabulary is well-defined. Each test should instantiate the store, dispatch a mock SSE event, and assert the resulting state mutation.

**Files affected:** `frontend/src/stores/__tests__/agentSession.test.ts`

**Why it matters:** Moves the frontend test count from 43 to 56+ passing tests, eliminates the "13 skipped" line from test output, and demonstrates that the SSE consumer contract is verified.

---

### 2.3 Wire the Model Registry into WorkflowView (Replace Hardcoded Models)

**Gap:** `WorkflowView.vue` hardcodes four model options instead of fetching from the backend model registry like `TaskPanel.vue` does.

**Enhancement:** Import the `useModelsStore` and call `ensureLoaded()` on mount, then bind the model dropdown to the registry data. This ensures consistency between Free Agent and Workflow modes and means new models added to the registry automatically appear in both views.

**Files affected:** `frontend/src/views/WorkflowView.vue`

**Why it matters:** Demonstrates architectural consistency. A reviewer who notices the hardcoded list will question whether the model registry is actually used. This is a 5-minute fix with outsized perception value.

---

### 2.4 Implement the Ministry Filter in WorkflowListView

**Gap:** The workflow list page renders a "My ministry" / "All accessible" dropdown but the `filtered` computed property ignores it entirely.

**Enhancement:** Pass the `ministryFilter` value to the backend `GET /api/workflows` endpoint (which already supports ministry scoping) or filter client-side based on the workflow's `ministry_code` field.

**Files affected:** `frontend/src/views/WorkflowListView.vue`, potentially `frontend/src/stores/workflow.ts`

**Why it matters:** Ministry scoping is a non-negotiable GoA requirement. Having a visible but non-functional filter is worse than not having the filter at all — it signals incomplete work.

---

### 2.5 Fix the Missing ExecutionPanel Import

**Gap:** `WorkflowView.vue` uses `<ExecutionPanel>` in its template but never imports the component. Vue resolves this silently in development (likely via auto-import or global registration), but it will fail in strict builds.

**Enhancement:** Add `import ExecutionPanel from '@/components/workflow/ExecutionPanel.vue'` to the script setup.

**Files affected:** `frontend/src/views/WorkflowView.vue`

**Why it matters:** This is a latent build failure. If `vue-tsc` passes today it is because the component is registered elsewhere, but explicit imports are the Vue 3 Composition API convention and prevent surprises during production builds.

---

## 3. Medium-Impact Enhancements (Recommended)

### 3.1 Expand Agent Templates Beyond the Basic Three

**Gap:** The workflow sidebar offers only three agent templates (Researcher, Summarizer, Analyst). The spec app had significantly more variety.

**Enhancement:** Add 4-6 additional GoA-relevant templates to `backend/src/data/agentTemplates.json`:

| Template | Purpose |
|----------|---------|
| **Policy Drafter** | Generates structured policy briefs from research inputs |
| **FOIP Reviewer** | Scans content for FOIP compliance issues and flags concerns |
| **Briefing Note Writer** | Produces executive briefing notes in GoA format |
| **Data Interpreter** | Analyzes structured data and produces narrative insights |
| **Meeting Summarizer** | Condenses meeting transcripts into action items and decisions |
| **Risk Assessor** | Evaluates proposals against a risk framework and produces a risk register |

**Files affected:** `backend/src/data/agentTemplates.json`

**Why it matters:** Shows domain understanding. Generic templates (Researcher, Summarizer) could be from any demo. GoA-specific templates demonstrate that the tool was built for government work.

---

### 3.2 Add a Dashboard / Analytics View

**Gap:** The admin panel shows raw audit logs and session lists, but there is no high-level dashboard showing usage patterns, token consumption trends, or tool popularity.

**Enhancement:** Add a `DashboardView.vue` (or a "Dashboard" tab in the Admin panel) that surfaces:
- Total sessions run (today / this week / this month)
- Token usage over time (from the backend's `getTokenUsageStats()`)
- Most-used tools (from audit log aggregation)
- Active model distribution
- PII detection rate trend

This can be implemented with simple computed aggregations from the existing `/api/admin/audit` and `/api/health/detailed` endpoints — no new backend work required.

**Files affected:** New `frontend/src/components/admin/DashboardPanel.vue`, modify `frontend/src/views/AdminView.vue` to add the tab.

**Why it matters:** Transforms the admin experience from "forensic log viewer" to "operational intelligence." This is the kind of feature that makes reviewers say "they thought about operations, not just development."

---

### 3.3 Add Workflow Export / Import (JSON)

**Gap:** Workflows can be saved and loaded from the database, but there is no way to export a workflow as a portable JSON file or import one from disk.

**Enhancement:** Add "Export JSON" and "Import JSON" buttons to the `WorkflowToolbar`. Export serializes the current `canvas_data` to a downloadable `.json` file. Import validates the schema and creates a new workflow from the uploaded file.

**Files affected:** `frontend/src/components/workflow/WorkflowToolbar.vue`, `frontend/src/stores/workflow.ts` (add `exportToFile()` and `importFromFile()` actions).

**Why it matters:** Enables workflow sharing between users and environments without database access. This is a practical feature that demonstrates product thinking beyond the exercise requirements.

---

### 3.4 Add Session Replay / History to Free Agent

**Gap:** The Free Agent view is ephemeral — once a session completes and the user navigates away, there is no way to revisit it from the UI. The backend stores all iterations and artifacts, but the frontend has no "Recent Sessions" navigation that loads a past session's results.

**Enhancement:** The `userMemory` store already fetches recent sessions. Wire a "Session History" panel or route that loads a completed session's blackboard, scratchpad, artifacts, and iteration timeline in read-only mode. The backend endpoint `GET /api/agent/sessions/:id` already returns the full state.

**Files affected:** New `frontend/src/views/SessionHistoryView.vue` or extend `FreeAgentView.vue` with a "load previous session" flow. Update `frontend/src/router/index.ts`.

**Why it matters:** Without replay, the application loses all value the moment a session ends. This is a fundamental usability gap that reviewers will notice immediately when they try to use the app.

---

### 3.5 Parallel Branch Execution in Workflow Engine

**Gap:** The `workflowExecutor.ts` header explicitly states "V1 limitations: Sequential execution (no parallel branches even when topo allows)."

**Enhancement:** When the topological sort identifies nodes at the same depth level with no inter-dependencies, execute them concurrently using `Promise.all()`. Emit SSE events for each parallel stage. This is architecturally straightforward because each stage already operates on its own isolated context.

**Files affected:** `backend/src/services/workflowExecutor.ts`

**Why it matters:** Parallel execution is the primary differentiator between a toy workflow engine and a production one. It also dramatically reduces execution time for wide graphs, which is visible during the demo.

---

## 4. Polish Enhancements (Nice to Have)

### 4.1 Dark Mode Support

The Alberta Design System tokens already support theming. Add a theme toggle to the `ProfileView` that persists to `user_preferences.theme` and applies a `dark` class to the root element.

### 4.2 Keyboard Shortcuts

Add keyboard shortcuts for power users: `Ctrl+Enter` to start a session, `Escape` to stop, `Ctrl+S` to save a workflow. Use a lightweight composable that registers/unregisters on mount/unmount.

### 4.3 Workflow Execution Cost Estimation

Before running a workflow, estimate the token cost based on the number of Agent nodes, their configured `maxTokens`, and the model's pricing tier. Display this as a confirmation dialog: "This workflow will use approximately X tokens across Y LLM calls."

### 4.4 Add a `gitleaks` Pre-Commit Hook

The Red/Blue report lists this as a P2 follow-up. Adding a `.pre-commit-config.yaml` with `gitleaks` takes 5 minutes and demonstrates security-by-default in the development workflow.

### 4.5 Outbound PII Scan After LLM Response

The Red/Blue report identifies this as a P1 follow-up: scan the LLM's response for PII before streaming it to the client. Currently PII is only scanned on the outbound prompt. Adding a post-response scan in `agentOrchestrator.ts` (after `parseLLMResponse`) closes a real privacy gap.

---

## 5. Recommended Priority Order

The following sequence maximizes impact while respecting dependencies:

| Priority | Enhancement | Effort | Impact |
|----------|-------------|--------|--------|
| 1 | End-to-end verification with real LLM (2.1) | Medium | Critical |
| 2 | Fix ExecutionPanel import + ministry filter + hardcoded models (2.3, 2.4, 2.5) | Low | High |
| 3 | Convert agentSession test scaffolds (2.2) | Low | High |
| 4 | Expand agent templates (3.1) | Low | Medium |
| 5 | Session replay / history (3.4) | Medium | High |
| 6 | Outbound PII scan on LLM response (4.5) | Low | High (security) |
| 7 | Dashboard / analytics panel (3.2) | Medium | Medium |
| 8 | Parallel branch execution (3.5) | Medium | Medium |
| 9 | Workflow export/import (3.3) | Low | Medium |
| 10 | gitleaks pre-commit hook (4.4) | Trivial | Low |

---

## 6. Summary

The minimum spec is already met. The enhancements above transform ABC from "a working exercise submission" into "a production-ready enterprise tool that happens to also satisfy the exercise." The highest-leverage items are the real LLM verification (proves it works), the bug fixes (removes reviewer doubt), and the GoA-specific agent templates (proves domain understanding). Everything else builds on that foundation to demonstrate operational maturity, product thinking, and security depth.
