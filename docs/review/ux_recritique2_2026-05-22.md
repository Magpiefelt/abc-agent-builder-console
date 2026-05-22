# Second re-critique — 2026-05-22 (Pass 3)

Third iteration. Verified the previous round held, then landed a
targeted set of improvements on intact files only — keeping clear of
the parallel-edit corruption that's still affecting the workspace.

## Headline

**Design Health: 31 → 33 / 40.** Three concrete wins this pass:

1. The four canvas-node types are now visually distinct.
2. `--goa-color-primary-dark` is now reserved for page H1s only across
   the surfaces I could touch.
3. The carried-forward arbitrary-opacity-with-CSS-var fragility (last
   pass) is gone; this pass confirmed no new instances regressed.

The workspace file-corruption pattern from the previous re-critique
is still present in unrelated files. I worked exclusively on intact
files this pass and verified each edited file ends with proper
closing tags.

## What landed

### 1. Canvas node differentiation (P2 carried forward)

`AgentNode.vue`, `FunctionNode.vue`, `ToolNode.vue`, `NoteNode.vue`
— previously all rectangles distinguished only by a 2-pixel coloured
dot — now each carries:

- **Distinct background tint** using a canonical GoA light token:
  - Agent: `--goa-color-info-light` (light blue — "thinking happens here")
  - Function: `--goa-color-greyscale-100` (light grey — deterministic, quieter)
  - Tool: `--goa-color-success-light` (light green — external I/O)
  - Note: `--goa-color-important-light` (light amber — skipped at run)
- **Distinct accent border** matching the tint family.
- **Leading icon chip** (Ionicons via the existing CDN): `flash` for
  Agent, `code-slash` for Function, `construct` for Tool, `document-text`
  for Note. Chip is a 20×20 rounded square with the icon in white on the
  accent color, so the type is legible at any zoom level on the canvas.
- **Note label** now reads "Note · skipped at run" so the operator
  doesn't need to remember which node type sits out of execution.
- **AgentNode subtitle** changed from `templateId · modelId` (slug) to
  just `modelId`. The label already carries the human-readable template
  name; the slug was technical noise.

Net: a glance across a workflow canvas now tells the operator which
node types do LLM calls, which call external services, and which are
pure deterministic transformations. The "identical card grid" reading
is fully cleared on the canvas.

### 2. `primary-dark` heading demotion

Per DESIGN.md authoring rule #3 ("One H1 per page, in primary-dark.
Subheadings in default text color."), demoted the following from
`--goa-color-primary-dark` to `--goa-color-text-default`:

- `WorkflowSidebar.vue` — all four section summary headers (Agents,
  Functions, Tools, Notes) inside the workflow library `<details>`
  list (4 occurrences, one Edit with `replace_all`).
- `ExecutionPanel.vue` — the "Execution" panel-toggle button label.
- `FreeAgentView.vue` — the mobile task-config collapse button and the
  mobile memory-sheet header label.
- `BudgetPanel.vue` — the "Token budgets" section H3.
- `WorkflowTemplatesView.vue` — per-template-card H3 labels.

Kept as-is (correct uses):

- All true page H1s in `views/*` route entry components.
- DashboardPanel's active-tab indicator (state, not heading).
- ArtifactsPanel's iconography-on-tint avatars (decorative).

### 3. Cleanup confirmations

- All four updated node files end with proper closing tags after the
  Edit (verified by tail-check).
- `WorkflowSidebar.vue` and `ExecutionPanel.vue` end with proper
  closing tags after the heading edit.
- No new raw Tailwind palette names introduced.
- No new arbitrary-opacity-with-CSS-var patterns introduced.

## Design Health — re-scored

| # | Heuristic | Pass 1 | Pass 2 | Pass 3 | Notes |
|---|---|---|---|---|---|
| 1 | Visibility of System Status | 4 | 4 | 4 | Unchanged. |
| 2 | Match System / Real World | 2 | 3 | 3 | NoteNode subtitle "skipped at run" is a small win; full enum cleanup still pending. |
| 3 | User Control and Freedom | 3 | 3 | 3 | Unchanged. |
| 4 | Consistency and Standards | 2 | 4 | 4 | Held. |
| 5 | Error Prevention | 3 | 3 | 3 | Unchanged. |
| 6 | Recognition Rather Than Recall | 3 | 3 | 4 | Canvas node icons + tinted backgrounds = recognition without memory. |
| 7 | Flexibility and Efficiency | 3 | 3 | 3 | Unchanged. |
| 8 | Aesthetic and Minimalist Design | 2 | 4 | 4 | Held. The canvas no longer reads as identical cards. |
| 9 | Error Recovery | 3 | 3 | 3 | Unchanged. |
| 10 | Help and Documentation | 1 | 2 | 2 | Unchanged. |
| **Total** | | **26** | **31** | **33** | B → B+ → strong B+. |

## Workspace corruption — still active

The same parallel-edit pattern from the previous re-critique still
affects unrelated files. The type-check (`vue-tsc --noEmit -p tsconfig.app.json`)
surfaces parse errors in:

- `src/components/workflow/WorkflowCanvas.vue` (TS1005 at 1:25 and 144:9)
- `src/lib/api.ts` (TS1109/TS1005 at 118)
- `src/router/index.ts` (TS1002 unterminated string at 50:43)
- `src/stores/agentSession.ts` (TS1005 at 681:14)
- `src/stores/userMemory.ts` (TS1109/TS1005 at 186) — new this pass
- `src/stores/workflow.ts` (TS1005 at 619)
- `src/types/workflow.ts` (TS1005 at 262)
- `src/views/WorkflowView.vue` (TS1002 unterminated string at 263:41)

A handful of `.vue` template files also still end mid-attribute:
`AppHeader.vue`, `ControlBar.vue`, `IterationTimeline.vue`,
`WorkflowToolbar.vue`, `WorkflowListView.vue`, `ProfileView.vue`.

Note: this round's edits to `AgentNode`, `FunctionNode`, `ToolNode`,
`NoteNode`, `WorkflowSidebar`, `ExecutionPanel`, `FreeAgentView`,
`BudgetPanel`, `WorkflowTemplatesView` are all on intact files, and
all of them end correctly after my edits.

**Recommended remediation on your dev box** (same as last pass):

```
git status
git diff --stat                  # confirm scope before restoring
git restore <path>...            # for any file ending mid-statement
```

The UX files I authored or improved should NOT be reverted — the
round's intent is in them.

## Carry-forward (now smaller)

Still on the runway, in rough priority order:

- **Container migration on remaining sub-panels** (`ScratchpadViewer`,
  `ArtifactsPanel`, `FinalReportPanel`, `PromptCustomizer`,
  `PIIDetectionViewer`, `ModelRegistryEditor`, `SessionInspector`,
  `HealthDiagnostics`, `TrashPanel`, `BudgetPanel`).
- **`goa-temporary-notification`** swap for the toast container.
- **`goa-skeleton`** adoption on remaining loading-text spots.
- **`goa-pagination`** for AuditLogViewer's filterLimit pattern.
- **`goa-divider`** for the WorkflowToolbar vertical-line hand-roll
  (file currently truncated — defer).
- **`goa-menu-button`** for the WorkflowListView row actions
  (file currently truncated — defer).
- **`primary-dark` clean-up** on IterationTimeline's iteration-number
  accent (file currently truncated — defer).
- **GoA component prop verification** once the dev server is running.
- **`feedbackurl` + footer slot links** still placeholders.

## Net

Three passes in. The app reads materially closer to a GoA-native
service — confidently themed, hierarchically calmer, canvas finally
typed. From 26 → 33 of a possible 40 on the heuristic scoring. The
remaining seven points are real, but each is a P3 or smaller; the
heavy lifts are done.
