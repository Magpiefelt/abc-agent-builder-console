# Accessibility Audit — ABC Agent Builder Console

**Standard:** WCAG 2.1 Level A + AA
**Tools:** axe-core 4.10 (via Vitest + jsdom), manual keyboard + screen reader passes.
**Date:** 2026-05-21
**Owner:** Stream E (Quality)

This document records the automated and manual accessibility review of the
greenfield Free Agent and Workflow surfaces. It is intended as both a
running checklist and as Authority-to-Operate evidence for Stream F.

## Scope

The audit covers the three top-level UI surfaces currently in the repo:

| Surface | Route | Status |
|---|---|---|
| `AppHeader.vue` | always rendered | Audited, fixes applied |
| `FreeAgentView.vue` | `/` | Audited, fixes applied |
| `WorkflowView.vue` | `/workflow` | Placeholder; basic landmarks added |

The Vue Flow canvas (Stream C), Blackboard / Task / Artifacts panels (Stream B),
and the admin console (Stream F) are out of scope; they will be added to the
audit as they land.

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

**Current results.** All three surfaces report **zero serious / critical
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

- Wrapped the placeholder in a `<section aria-label="Workflow canvas">`
  landmark.
- Used `<h2>` instead of `<h3>` for the only heading on the surface (was
  semantically misordered as h3 without an h2).
- Raised contrast on auxiliary copy.

## Manual review

### Keyboard navigation

Tested manually in Firefox 122 and Chrome 130. Tab order:

1. Skip link → main content (now reachable)
2. Header home link → primary nav (Free Agent → Workflow)
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

The current build has no animations, so `prefers-reduced-motion` is not
yet exercised. When Stream B adds SSE-driven progress animation, the
animation must respect the `@media (prefers-reduced-motion: reduce)`
preference.

## Remaining limitations

| Limitation | Owner | Mitigation |
|---|---|---|
| Colour contrast is not auto-tested in jsdom | Stream E follow-up | Add a Playwright pass when end-to-end browser tests come in. |
| Vue Flow canvas accessibility | Stream C | Track as P1 — Vue Flow requires custom keyboard handling for canvas nodes. |
| Workflow canvas placeholder is informational only | Stream C | Will be re-audited when Stream C lands. |
| Stream B's SSE-driven UI not yet present | Stream B | When the live blackboard / task panel land, re-run the audit and add aria-live regions for streaming updates. |

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
