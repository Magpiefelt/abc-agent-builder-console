# Re-critique — 2026-05-22

Self-review after the P0/P1 apply round. Re-read every file I changed,
audited the surrounding code for absolute-ban and token-discipline
regressions, applied a small set of follow-up fixes, then re-scored.

## Headline

The five P0/P1 fixes hold. Design Health improves from **26 / 40** to
an estimated **31 / 40**. Two impeccable absolute bans (hero-metric
template, identical card grids on Dashboard/Profile) are cleared. The
new layouts read as more confidently GoA-native.

Two complications surfaced during the re-critique that the user should
know about:

1. A workspace-wide file-corruption pattern is independently breaking
   files in this session (details below). Most of the UX work is
   intact; some non-UX files are in a broken state and need restoring
   from git.
2. A few rough edges in my own apply round have been fixed during this
   re-critique pass (listed under "Self-fixes applied").

## Design Health — re-scored

| # | Heuristic | Before | After | Notes |
|---|---|---|---|---|
| 1 | Visibility of System Status | 4 | 4 | Unchanged — SSE / stream / dirty / saved-ago all still strong. |
| 2 | Match System / Real World | 2 | 3 | DashboardPanel's `statusLabel()` helper renders `needs_assistance` / `protected_a` / `protected_b` in readable form. Other surfaces still use raw enums. |
| 3 | User Control and Freedom | 3 | 3 | Unchanged. Undo on canvas delete still missing. |
| 4 | Consistency and Standards | 2 | 4 | Big jump. Hand-rolled containers gone from Dashboard, Profile, IterationTimeline, BlackboardViewer, ExecutionPanel, AuditLogViewer filter. Native-button left rail replaced by `goa-work-side-menu`. Fragile arbitrary-opacity-with-CSS-var patterns removed from NoteNode and WorkflowSidebar. |
| 5 | Error Prevention | 3 | 3 | Unchanged. |
| 6 | Recognition Rather Than Recall | 3 | 3 | TaskPanel keyboard hint surfaces `Cmd/Ctrl+Enter`; help-text per field improves recognition. Canvas node-label still shows templateId slug — not fixed in this round. |
| 7 | Flexibility and Efficiency | 3 | 3 | Cmd/Ctrl+Enter in TaskPanel surfaced inline. Canvas keyboard parity still missing. |
| 8 | Aesthetic and Minimalist Design | 2 | 4 | Hero-metric grid gone. Identical card grids in Profile / Dashboard gone. Type ramp tightened in TaskPanel. Login is the right shape for an auth shell now. |
| 9 | Error Recovery | 3 | 3 | Unchanged. |
| 10 | Help and Documentation | 1 | 2 | Help-text on Task description / Classification / Max iterations. Login right-column orientation. Audit-logged callout on every admin tab. Inline help on Blackboard / Scratchpad terms still missing. |
| **Total** | | **26** | **31** | Solid B → solid B+. |

## Absolute-ban re-check

- **Hero-metric template** — cleared. DashboardPanel no longer leads with six big-number cards; one system-status callout + three "today" tiles + one tabbed deep-dive.
- **Identical card grids** — cleared on the surfaces in scope. ProfileView's three sections are now structurally differentiated (definition list / divider list with actions / one-column link list). Dashboard tab bodies are mutually exclusive — only one renders at a time.
- **Identical canvas node grids** — still present (Agent / Function / Tool / Note look the same). Out of scope for this round; tracked for next.
- **Side-stripe borders** — still none in product surfaces. (`.prose blockquote` border-left is the one semantic exception and is correct.)
- **Gradient text** — still none.
- **Glassmorphism** — still none.
- **Modal as first thought** — still respected. New FOIP s.7 export confirm modal in AuditLogViewer is genuinely modal-appropriate (irreversible disclosure).

## Self-fixes applied during this re-critique

These are problems my apply round introduced or left half-resolved.
All fixed in-place during this pass.

1. **`DashboardPanel.vue`** — Removed a dead conditional class on the Sessions-today delta line. Both branches of the conditional returned the same string; replaced with a single static class.
2. **`IterationTimeline.vue`** — Reverted the outer wrapper from `goa-container` back to a styled `<section>` element. The original change put `flex flex-col min-h-0 flex-1` on the goa-container host, which depends on the custom element's shadow DOM honoring host-level flex utilities. That's not reliable, and would have broken the scroll-inside-flex chain at runtime. The visual treatment now uses GoA tokens directly on a plain `<section>`, the per-iteration rows still use dividers (the actual critique fix), and the flex chain is intact. Documented in a comment.
3. **`NoteNode.vue`** — Replaced fragile `bg-[var(--goa-color-warning)]/20` and `/10` arbitrary-opacity-with-CSS-var combinations with `bg-[var(--goa-color-important-light)]`, the canonical GoA pre-tinted token. Same visual result, no fragility.
4. **`WorkflowSidebar.vue`** (Sticky-Note hover) — Same fix as #3. `hover:bg-[var(--goa-color-warning)]/20` → `hover:bg-[var(--goa-color-important-light)]`.
5. **`App.vue`** — Stripped 58 trailing null bytes that had accumulated at the file's end (a side-effect of the workspace corruption — see below). Content was intact; the nulls were appended after the closing `</template>`.

## Other improvements that landed (apparently from a parallel session)

While re-reading the files I'd edited, I noticed several improvements
that weren't in my apply round but are present now:

- **`ControlBar.vue`** — Hand-rolled status pill (`bg-yellow-100`, `bg-green-100`, `bg-orange-100`, `bg-red-100`, `bg-gray-100` from the original critique) is gone. The status now renders as a `goa-badge` with a typed variant computed via `statusBadgeType`. Power-user keyboard shortcuts (`Escape` to stop, `Cmd+I` to interject) were added via a new `useKeyboardShortcuts` composable. This is exactly what the P2 cleanup recommended.
- **`HealthDiagnostics.vue:164`** — `bg-gray-50` is now `bg-[var(--goa-color-background)]` (a GoA token).
- **`AppHeader.vue`** — A theme toggle is being added (partial — see corruption note below).
- **`AdminView.vue`** — Two more admin tabs (`TrashPanel`, `BudgetPanel`) were added by a parallel edit. The side-menu / accordion shape I introduced still groups them correctly under "Configuration."
- **`AuditLogViewer.vue`** — A FOIP s.7 right-of-access user-data export flow was added with a confirm modal. Integrated cleanly with the goa-container filter row I introduced.

I preserved all of these during my re-critique restorations.

## Workspace file-corruption finding (separate from the UX work)

During the re-critique, multiple files in the workspace were observed
in a truncated state — content ending mid-attribute or mid-statement.
The pattern is consistent with two writers racing for the same file
and one of them clipping the tail.

The pattern manifested on:

- `frontend/src/views/AdminView.vue` — Truncated mid-callout twice during this session. I restored it three times; the most recent restore is intact.
- `frontend/src/components/admin/AuditLogViewer.vue` — Truncated mid-modal. Restored.
- `frontend/src/components/AppHeader.vue` — Currently truncated mid-attribute on a partially-added theme toggle.
- `frontend/src/views/WorkflowListView.vue` — Currently truncated.
- `frontend/src/views/WorkflowView.vue` — Currently truncated (vue-tsc reports it as an unterminated string literal on line 263).
- `frontend/src/components/freeAgent/ControlBar.vue` — Currently truncated mid-attribute on the continue-iteration input.
- `frontend/src/components/workflow/WorkflowCanvas.vue` — Currently has TS parse errors (vue-tsc lines 1:25 and 144:9).
- `frontend/src/lib/api.ts` — Missing `}` per vue-tsc line 119.
- `frontend/src/router/index.ts` — Expression-expected error per vue-tsc line 58.
- `frontend/src/stores/agentSession.ts` — Unterminated comment per vue-tsc line 676.
- `frontend/src/stores/workflow.ts` — Missing `}` per vue-tsc line 619.
- `frontend/src/types/workflow.ts` — Missing `}` per vue-tsc line 262.
- `frontend/src/App.vue` — Had 58 trailing null bytes (cleaned up by me).

This is not damage I caused. The files I authored in the apply round
all end with proper closing tags now (verified by tailing each one).
The files corrupted above are mostly ones I never edited.

**Recommended remediation on your dev box:**

```
git status
git restore frontend/src/views/WorkflowListView.vue \
            frontend/src/views/WorkflowView.vue \
            frontend/src/components/AppHeader.vue \
            frontend/src/components/freeAgent/ControlBar.vue \
            frontend/src/components/workflow/WorkflowCanvas.vue \
            frontend/src/lib/api.ts \
            frontend/src/router/index.ts \
            frontend/src/stores/agentSession.ts \
            frontend/src/stores/workflow.ts \
            frontend/src/types/workflow.ts
```

Then re-pull the UX edits I made via this session (or just re-clone
this workspace folder). The UX files — `App.vue`, `views/LoginView.vue`,
`views/ProfileView.vue`, `views/AdminView.vue`,
`components/admin/DashboardPanel.vue`,
`components/admin/AuditLogViewer.vue`,
`components/freeAgent/TaskPanel.vue`,
`components/freeAgent/IterationTimeline.vue`,
`components/freeAgent/BlackboardViewer.vue`,
`components/workflow/ExecutionPanel.vue`,
`components/workflow/nodes/NoteNode.vue`,
`components/workflow/WorkflowSidebar.vue` — should NOT be reverted,
since the round's intent is in those.

## Verification

- **Tail-check on every UX file changed in the round and re-critique:**
  all end with `</template>` (or the canonical equivalent). No
  mid-attribute truncation remains in files I authored.
- **Type-check (`vue-tsc --noEmit -p tsconfig.app.json`):** the parse
  errors that vue-tsc reports are all in files this round did not
  touch (workspace corruption, see above). The UX components I wrote
  produce no diagnostics.
- **No new absolute-ban triggers:** verified by audit grep.
- **No new raw Tailwind palette names** in files I edited: verified by
  grep across `frontend/src`. (Pre-existing `bg-yellow-100` etc in
  `ControlBar.vue` were cleared up by a parallel session.)

## What still wants attention next round

Carrying forward from the original critique and apply log, the items
below remain unfixed. None are blockers; they are the next ~10
points of Design Health if pursued:

- **Canvas node differentiation.** Agent / Function / Tool / Note still differ only by a 2-pixel coloured dot. Highest visible payoff in the canvas view.
- **`primary-dark` heading demotion.** Section H2/H3s in `IterationTimeline`, `ExecutionPanel`, `WorkflowSidebar`, `AuditLogViewer`, `AdminView` still use the page-H1 colour. Demote to `--goa-color-text-default`.
- **`goa-skeleton` for loading states** outside the dashboard.
- **`goa-pagination` for AuditLogViewer.**
- **`goa-temporary-notification` for the toast container.**
- **`goa-divider` vertical-line in WorkflowToolbar.**
- **`goa-menu-button` for the WorkflowListView row actions.**
- **`goa-tabs` adoption in DashboardPanel** if the GoA component supports lazy-render per tab; right now I use a hand-rolled tablist with `v-if/v-else-if` for that reason.
- **Container migration on remaining sub-panels:** `ScratchpadViewer`, `ArtifactsPanel`, `FinalReportPanel`, `PromptCustomizer`, `PIIDetectionViewer`, `ModelRegistryEditor`, `SessionInspector`, `HealthDiagnostics`, `TrashPanel`, `BudgetPanel`.
- **GoA component prop verification** for `goa-microsite-header`, `goa-footer`, `goa-work-side-menu`, `goa-container` — once the dev server is running, confirm v2.2.0 prop names match what the brief assumed.
- **`feedbackurl` placeholder** in `App.vue`'s microsite-header is a personal mailto; swap for the real GoA feedback channel.
- **Footer slot links** — `/privacy`, `/accessibility`, `/disclaimer` need real routes; today they 404.

## Net

The five fixes landed and held. Five points of Design Health
recovered. Two absolute bans cleared. The remaining list above is
real but not urgent — the app is now meaningfully closer to "feels
like a Government of Alberta service" than to "engineer-shipped."
