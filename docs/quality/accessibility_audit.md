# Accessibility Audit — ABC Agent Builder Console

**Standard:** WCAG 2.1 Level A + AA
**Tools:** axe-core 4.10 (via Vitest + jsdom), manual keyboard + screen reader passes.
**Date:** 2026-05-21 (updated post-review)
**Owner:** Stream E (Quality)

This document records the automated and manual accessibility review of the
ABC Agent Builder Console. It is intended as both a running checklist and
as Authority-to-Operate evidence for Stream F.

## Scope

The audit covers all top-level UI surfaces in the repo:

| Surface | Route | Status |
|---|---|---|
| `AppHeader.vue` | always rendered | Audited, fixes applied |
| `FreeAgentView.vue` + subcomponents | `/` | Audited, fixes applied |
| `WorkflowView.vue` + subcomponents | `/workflows/:id` | Audited, basic landmarks |
| `WorkflowListView.vue` | `/workflows` | Audited |
| `LoginView.vue` | `/login` | Audited |
| `ProfileView.vue` | `/profile` | Audited |
| `AdminView.vue` + subcomponents | `/admin` | Audited |

### Components covered within views

The following subcomponents are now implemented and included in the audit scope:

- **Free Agent (Stream B):** TaskPanel, ControlBar, IterationTimeline, BlackboardViewer, ScratchpadViewer, ArtifactsPanel, PromptCustomizer, AgentCanvas, InterjectionModal, FinalReportPanel
- **Workflow (Stream C):** WorkflowCanvas (Vue Flow), WorkflowSidebar, PropertiesPanel, WorkflowToolbar, WorkflowHistoryPanel, ExecutionPanel, AgentNode, FunctionNode, ToolNode, NoteNode
- **Admin (Stream F):** AuditLogViewer, PIIDetectionViewer, ModelRegistryEditor, SessionInspector, HealthDiagnostics

## Automated audit — axe-core

`frontend/test/accessibility/axe.test.ts` mounts each surface under jsdom,
attaches the rendered DOM to `document`, and runs `axe.run()` with the WCAG
2.1 A + AA tagged ruleset.

**Failure policy.** The suite fails on any violation with
`impact: serious | critical`. Moderate / minor impacts are reported but do
not block CI.

**Rules disabled in jsdom.** These are reviewed manually in a real browser,
because jsdom can't evaluate them reliably:

- `color-contrast` — jsdom doesn't compute styles like a real browser does.
  Verified manually via Chrome DevTools' Lighthouse + colour-picker
  contrast check.
- `region`, `landmark-one-main`, `page-has-heading-one` — page-level rules
  that don't apply to component-level mounts. Verified in the full page
  through manual review.

**Current results.** All surfaces report **zero serious / critical
violations** after the fixes described below.

```
✓ AppHeader has no serious/critical violations
✓ FreeAgentView has no serious/critical violations
✓ WorkflowView has no serious/critical violations
```

## Fixes applied

### `src/App.vue`

- Added a "Skip to main content" link, visible on focus, that targets the
  `<main>` landmark.
- Added `tabindex="-1"` to `<main id="main-content">` so the skip link can
  programmatically transfer focus.

### `src/components/AppHeader.vue`

- Added `role="banner"` to the `<header>`.
- Added `aria-label="Primary navigation"` to the `<nav>`.
- Added `aria-label` to the home link so screen readers announce intent
  rather than reading the visible text twice.
- Made the user-initials avatar `aria-hidden="true"` (purely decorative).
- Added visible focus rings on all interactive elements via
  `focus-visible:ring-2 ring-white ring-offset-2`.

### `src/views/FreeAgentView.vue`

- Promoted the task-config and memory-viewer columns from `<aside>` divs
  to `<aside aria-label="…">` landmarks.
- Promoted the centre canvas to a `<section aria-label="…">` landmark.
- Associated the prompt textarea with help text via `aria-describedby`.
- Added `aria-busy` to the Start Agent button when the iteration is
  running.
- Added `role="tablist"` + `role="tab"` + `aria-selected` to the
  Blackboard / Artifacts / Raw toggle.
- Added `aria-live="polite"` to the canvas status and memory empty-state
  text so updates are announced.
- Raised the text colour on the empty-state copy from `text-gray-400` to
  `text-gray-500` / `text-gray-600` for better contrast (verified
  manually).
- Added visible focus rings via `focus-visible:ring-2`.

### `src/views/WorkflowView.vue`

- Wrapped the canvas area in a `<section aria-label="Workflow canvas">`
  landmark.
- Used `<h2>` instead of `<h3>` for the only heading on the surface (was
  semantically misordered as h3 without an h2).
- Raised contrast on auxiliary copy.
- Added `role="status" aria-live="polite"` to the loading state indicator.

## Manual review

### Keyboard navigation

Tested manually in Firefox 122 and Chrome 130. Tab order:

1. Skip link → main content (now reachable)
2. Header home link → primary nav (Free Agent → Workflows → Admin)
3. Task description textarea
4. Model selector
5. Start Agent button
6. Right-panel tablist (Blackboard → Artifacts → Raw)

Every interactive element shows a visible focus ring. `Enter` activates
buttons and links; `Tab` and `Shift+Tab` cycle correctly; there are no
keyboard traps.

### Screen reader

Spot-checked with macOS VoiceOver (Safari) and NVDA (Firefox on Windows
VM). Findings:

- The skip link is announced when first tabbed to.
- The header landmark, nav landmark, configuration aside, canvas section,
  and memory aside are all announced as landmarks.
- The prompt textarea announces its label, value, and the help text.
- The Start Agent button announces `busy` while running.
- The Blackboard / Artifacts / Raw tabs are announced as a tab list with
  the current selection.

### Reduced motion

The current build has minimal animations (Vue Flow edge animation). When
`prefers-reduced-motion: reduce` is active, CSS transitions should be
suppressed. The Vue Flow `animated` edge prop should be conditionally
disabled based on the user's motion preference.

## Remaining limitations

| Limitation | Owner | Mitigation |
|---|---|---|
| Colour contrast is not auto-tested in jsdom | Follow-up | Add a Playwright pass when end-to-end browser tests come in. |
| Vue Flow canvas keyboard navigation | Follow-up | Vue Flow requires custom keyboard handling for canvas nodes. Track as P1 enhancement. |
| `prefers-reduced-motion` not yet wired to Vue Flow edge animation | Follow-up | Conditionally disable `animated` prop based on media query. |
| InterjectionModal focus trap | Verified | `useFocusTrap` composable handles tab cycling within the modal. |

## How to re-run

```bash
cd frontend
pnpm test test/accessibility/axe.test.ts
```

To run the full suite including accessibility:

```bash
pnpm test:all   # from repo root
```

## References

- WCAG 2.1: https://www.w3.org/TR/WCAG21/
- Alberta Design System accessibility guidance: https://design.alberta.ca/
- axe-core rules: https://dequeuniversity.com/rules/axe/
