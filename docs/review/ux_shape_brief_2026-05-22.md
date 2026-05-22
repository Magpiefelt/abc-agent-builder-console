# Shape Brief — P0/P1 UX/UI Round

**Date:** 2026-05-22
**Source critique:** `docs/review/ux_ui_critique_2026-05-22.md`
**Anchors:** `PRODUCT.md` (just-written), `DESIGN.md` (just-written)
**Scope this round:** Five fixes, mid-to-high fidelity, shipping-quality code edits on real `.vue` files. Implementation order is the order below.

Five sub-briefs, each one a shape under the impeccable schema.

---

## 1. Admin Dashboard Rebuild

### Feature Summary
Replace the current `DashboardPanel.vue` (two rows of three hero-metric cards + a 2×2 grid of identical status cards) with a single operational-health surface that an Admin owner can read in five seconds at the start of the day.

### Primary User Action
*Read* — confirm the system is healthy. Secondary: click into Audit Log / PII / Sessions when something looks off.

### Design Direction
- **Color strategy:** Restrained (per `DESIGN.md`). One accent: `--goa-color-interactive-default` for the system-status pill and any "needs attention" affordance.
- **Theme scene sentence:** "An INFRA director at their desk at 8:05am, glancing at the dashboard for thirty seconds before standing up." → Light, calm, readable at arm's length.
- **Anchor references:** Stripe Atlas dashboard (calm operational summary row), AWS Service Health Dashboard (status-first), GoA design.alberta.ca examples/dashboard.
- **Probes skipped:** No image generation in this harness. The references above + the existing token palette are enough direction.

### Scope
- Fidelity: production-ready
- Breadth: one component (`DashboardPanel.vue`) — caller stays as-is
- Interactivity: shipped, refreshes on the existing 60s poll, tab switch preserves state via `<KeepAlive>`
- Time intent: ship-quality

### Layout Strategy
Vertical rhythm, top to bottom:

1. **Header row.** Page H2 ("Dashboard"), "Updated HH:MM:SS" + Refresh button on the right. *No change from today.*
2. **System-status strip.** Full-width `goa-callout type="information"` (or `success` when nothing flagged) summarising the day in one plain-language sentence: "12 sessions, 3 workflow runs, 0 PII events blocked today. All systems nominal." Replaces the "operational snapshot. Refreshes every minute…" subhead.
3. **Three operational tiles (the lede).** A single `goa-grid columns="3"` row of three `goa-container`s — each container houses one metric for *today*: Sessions today / Workflow runs today / PII blocked today. Each tile renders: small metadata label, large value, a one-line delta ("+8% vs 7-day average"). This *replaces* the six 24h/7d/30d cards entirely.
4. **Tabbed deep-dive.** A `goa-tabs` strip with four tabs: **Sessions**, **Workflows**, **Models**, **PII**. Each tab body is *one* well-built chart-or-list, not four small ones:
   - Sessions: 30-day status breakdown (a `goa-linear-progress` per status, stacked, with counts; replaces the hand-rolled progress bars).
   - Workflows: 30-day status breakdown + the Top tools `goa-table` (move it under this tab; it was lower on the page).
   - Models: 30-day usage list with the model name and a single linear-progress bar per model.
   - PII: Two-column list of "By type" + "By action" inside one container — no extra outer wrapper.
5. **Footer row.** Empty in v1 — leave room for a future "Recent admin actions" feed.

No more identical card grids. No more hero-metric template.

### Key States
- **Loading first-paint:** `goa-skeleton` for each tile and the active tab body. (Currently shows "Loading dashboard…".)
- **Error:** existing `goa-callout type="emergency"` stays at the top.
- **Empty (no activity today):** Tiles show "0" with the delta line saying "No activity in the last 24h." System-status callout switches to `type="information"` with copy "No sessions or runs today. All systems nominal."
- **Stale (>5 min since last refresh):** "Updated HH:MM" turns amber + the Refresh button gets a `goa-badge type="important" content="stale"` next to it.

### Interaction Model
- The three tiles are *not* clickable — they're glanceable summaries.
- Clicking a tab swaps the deep-dive body.
- Refresh button: forces an immediate poll; otherwise the existing 60s interval continues.
- The system-status callout has a `Manage in Admin →` link that scrolls to the active tab.

### Content Requirements
- **System-status sentence templates:**
  - All clear: "N sessions, M workflow runs, 0 PII events blocked today. All systems nominal."
  - With PII: "N sessions, M workflow runs, P PII patterns blocked today. Review under PII."
  - With failed runs: "N sessions, M workflow runs, Q failed. Review under Workflows."
- **Tile labels:** "Sessions today", "Workflow runs today", "PII events blocked today" — sentence case, no uppercase metadata.
- **Delta line:** "+8% vs 7-day avg" / "−12% vs 7-day avg" / "No change vs 7-day avg" / "First activity today".

### Recommended impeccable references during implementation
- `distill.md` — kill the hero-metric grid.
- `layout.md` — re-establish vertical rhythm.

### Open Questions
- The current API (`/api/admin/dashboard`) returns 24h/7d/30d windows but not "today-with-7d-comparison." Either compute the comparison frontend-side from the 30d data or add a server-side field. Implementer should choose; the brief assumes frontend-side computation.

---

## 2. `goa-container` Migration

### Feature Summary
Replace every hand-rolled `<div class="bg-[var(--goa-color-surface)] border border-[var(--goa-color-border)] rounded-md p-X">` with the GoA `goa-container` web component, and reach for `goa-block` / `goa-divider` instead of `flex flex-col gap-X` + hand-drawn dividers for grouping within.

### Primary User Action
None — this is a foundational migration that makes every subsequent page change cheaper and locks the surface to GoA tokens.

### Design Direction
- Color strategy: Restrained (same as PRODUCT.md / DESIGN.md).
- Scene sentence: unchanged — same project context.
- Anchor references: the GoA Container, Block, and Divider component docs themselves.

### Scope
- Fidelity: production-ready
- Breadth: cross-cutting — touches ProfileView, FreeAgent `IterationTimeline`, `BlackboardViewer`, `ExecutionPanel`, `AuditLogViewer` filter row, plus any leftover hand-rolled bordered divs after #1 (DashboardPanel) lands. Workflow canvas *nodes* are out of scope; they are intentional custom Vue Flow components.
- Interactivity: visual + structural; no behaviour change
- Time intent: ship-quality

### Layout Strategy
- One `goa-container` per top-level grouped surface. **Do not nest containers.** A list of items inside a container is just a `<ul>` / `<goa-block>` / divider-separated rows — never a container per row.
- Where today's code uses N identical containers as a list (`IterationTimeline`, `ExecutionPanel`, `BlackboardViewer` entries), refactor to **one outer `goa-container`** + an internal divider-separated row pattern. Each row carries the per-iteration / per-stage metadata as a single line.
- `ProfileView`'s three containers (Identity / Saved prompts / Favourites) become three real `goa-container`s, but with different *content density* per section so they don't look identical — Identity is a tight definition-list, Saved prompts is a divided list with action buttons, Favourites is a single column of link-buttons.

### Key States
- Each container retains today's loading / empty / error states; the only change is the surface element.
- Empty states get fresh copy where they read as engineer-shipped (see Content Requirements).

### Interaction Model
- No new interactions. Hover / focus on row items keep their existing affordances.
- One small upgrade: in `BlackboardViewer`, the category filter chips change from `goa-button` to `goa-filter-chip`. This is the right pattern and lets us drop the active/secondary toggle.

### Content Requirements
- ProfileView Saved-prompts empty: "No saved prompts yet. From Free Agent, write a prompt and choose **Save this prompt**." (Already close — keep.)
- BlackboardViewer empty: "The agent hasn't written to the blackboard yet. Entries appear as the iteration progresses." (Replaces the current "Blackboard is empty.")
- ExecutionPanel empty: "No stages in this workflow." (No change.)
- Iteration timeline empty: "No iterations yet. Start the agent to see live progress." (No change.)

### Files affected (exhaustive)
- `frontend/src/views/ProfileView.vue` — 3 bordered divs → 3 `goa-container`s with differentiated internal layout.
- `frontend/src/views/AdminView.vue` — the right-hand section wrapper is fine as-is (no border) but verify spacing.
- `frontend/src/components/freeAgent/IterationTimeline.vue` — outer is a `goa-container`; per-iteration article becomes `<article>` with a `goa-divider` between, not a re-bordered card.
- `frontend/src/components/freeAgent/BlackboardViewer.vue` — per-entry article ditto; replace `goa-button` chips with `goa-filter-chip`.
- `frontend/src/components/freeAgent/ScratchpadViewer.vue`, `ArtifactsPanel.vue`, `FinalReportPanel.vue` — apply the same pattern (need to read these but the surface is the same).
- `frontend/src/components/workflow/ExecutionPanel.vue` — outer is a `goa-container`; per-stage row uses divider, not re-bordered card.
- `frontend/src/components/admin/AuditLogViewer.vue` — the filter "card" becomes a `goa-container`; if `DashboardPanel` is already rebuilt by then, follow that file's pattern.
- `frontend/src/components/admin/PIIDetectionViewer.vue`, `ModelRegistryEditor.vue`, `SessionInspector.vue`, `HealthDiagnostics.vue` — same pattern (need to read each, but rule of thumb: containers, not card-stacks).

### Recommended impeccable references during implementation
- `extract.md` — if `goa-container` props don't map 1:1, lift an `<AppContainer>` shim.
- `polish.md` — at the end of this round.

### Open Questions
- Does `goa-container` v2.2.0 support `padding="none"` or only preset sizes? If only presets, we may need to override one preset via a slot — implementer to verify at first migration.
- For the IterationTimeline rows, today's hover state is `hover:bg-[var(--goa-color-background)]`. Inside a single outer container, we want hover on the *row* not the container — implementer to confirm `goa-divider` doesn't capture the hover.

---

## 3. LoginView — GoA Auth Shell

### Feature Summary
Replace the current quiet centered-card LoginView with a proper GoA auth shell: `goa-microsite-header` (alpha) at the top, `goa-app-header` (signed-out variant), a focused sign-in container with strong identity, `goa-footer` at the bottom.

### Primary User Action
Click "Sign in with Microsoft." Everything else on the page exists to make the user confident they're in the right service.

### Design Direction
- Color strategy: Restrained.
- Scene sentence: "A new ministry analyst, mid-morning, following a link from a manager's email on a managed laptop, deciding in three seconds whether this looks like a real GoA service."
- Anchor references: alberta.ca homepage header pattern, design.alberta.ca examples/public-form (microsite-header at top), Service Alberta digital service login pages.

### Scope
- Fidelity: production-ready
- Breadth: one view (`LoginView.vue`) + small change to `App.vue` to allow the alternate shell pre-auth
- Interactivity: shipped
- Time intent: first-impression fix; commit to it

### Layout Strategy
Top → bottom:

1. `goa-microsite-header type="alpha"` — "Service Alberta · Agent Builder Console · alpha · [Give feedback]"
2. `goa-app-header` (signed-out): the existing component, but the right slot shows only "Sign in" (existing pattern).
3. **Hero area.** A two-column layout (`goa-grid columns="2"`) on `md+`, single column below:
   - Left column: the sign-in `goa-container`. Heading "Sign in to continue." Body: "Agent Builder Console is a Government of Alberta tool for composing agentic LLM workflows. Sign in with your work account to access workflows scoped to your ministry." Sign-in `goa-button type="primary"`. Below it, in `goa-color-text-secondary`: "Your session is restricted to your ministry. Activity is logged for security and compliance."
   - Right column: a small "What you can do here" panel — three bullets, no icons, in a single `goa-container`: "Compose a Free Agent task," "Build a multi-stage workflow," "Review audit and PII activity (admins)."
4. `goa-footer` — standard GoA footer with Privacy / Accessibility / Disclaimer / Contact links + "© Government of Alberta."

### Key States
- **Default signed-out.** As above.
- **Loading session check (`auth.loading`).** Sign-in button shows "Checking your session…" (existing).
- **Sign-in error.** `goa-callout type="emergency"` above the button (existing) — leave behavior unchanged, just inside the new container.
- **`?returnTo=` present.** Add a small line under the button: "After sign-in, you'll be returned to `[path]`." Path renders as code-styled inline text. This is a meaningful trust signal — confirms what will happen after authentication.

### Interaction Model
- Click "Sign in" → `auth.login(returnTo.value)` (no change).
- The "Give feedback" link in the microsite-header opens a `mailto:` or a feedback form URL (placeholder for now — open question).

### Content Requirements
- Page H1: "Sign in to continue." (replaces "Agent Builder Console" H1; service name now lives in microsite-header + app-header).
- Subtext: as above.
- Microcopy under primary button: "Your session is restricted to your ministry. Activity is logged for security and compliance."

### Files affected
- `frontend/src/views/LoginView.vue` — full rebuild.
- `frontend/src/App.vue` — conditionally render the standard `<AppHeader />` only when authenticated; for the login route, the view supplies its own `goa-microsite-header` + `goa-app-header` + `goa-footer`. (Alternative: keep `App.vue` shape stable and only add the microsite-header inside LoginView. Open question — defer to implementation.)

### Recommended impeccable references during implementation
- `clarify.md` — microcopy.
- `polish.md` — final pass.

### Open Questions
- Feedback URL for the microsite-header "Give feedback" link. Email alias, ServiceNow ticket form, or Forms link?
- Should the right-column "What you can do here" panel survive, or is it noise? It's there to give Jordan (first-timer) context. Cuttable.
- App.vue change vs LoginView-owns-shell — implementer to decide based on `goa-microsite-header` placement constraints.

---

## 4. AdminView — `goa-work-side-menu`

### Feature Summary
Replace the hand-rolled `<button>` left rail in `AdminView.vue` with `goa-work-side-menu`. Promote the "All actions on this page are audit-logged" message from a side-rail footnote to a callout at the top of the active tab's content area.

### Primary User Action
Navigate between the six admin tabs (Dashboard, Audit Log, PII Detections, Model Registry, Sessions, Health Diagnostics) with keyboard or pointer, with the active tab clearly indicated and reflected in the URL hash.

### Design Direction
- Color strategy: Restrained.
- Scene sentence: "INFRA admin opening Admin from the global nav, glancing at the menu to find Audit Log, then settling in for ten minutes of review."
- Anchor references: design.alberta.ca/components/work-side-menu, Linear's left sidebar (for the active-state visual language).

### Scope
- Fidelity: production-ready
- Breadth: one view (`AdminView.vue`); each tab content component is unchanged
- Interactivity: keyboard nav (arrow keys, Home/End), URL hash sync (existing behavior preserved)
- Time intent: ship-quality

### Layout Strategy
- Left rail: `goa-work-side-menu` with six items. Section grouping if `goa-work-side-menu` supports it: "Operations" (Dashboard, Health) / "Compliance" (Audit Log, PII Detections) / "Configuration" (Model Registry, Sessions). If grouping isn't supported in v2.2.0, render the flat six and add visual separation via the menu's built-in dividers.
- Right pane: the `<KeepAlive>` content stays. Add a *single* `goa-callout type="information"` strip directly under the tab heading — "All actions on this page are audit-logged. Audit entries are retained for [retention window]." — that appears on every tab so the audit signal is part of the chrome, not a footnote.

### Key States
- **Active tab:** `goa-work-side-menu` handles this. Bind the URL hash.
- **Hover / focus:** GoA-default.
- **Mobile:** `goa-work-side-menu` collapses to a top tab strip on narrow viewports (per GoA spec). Verify the URL-hash sync still works.

### Interaction Model
- Click / Enter to select.
- Arrow keys move selection.
- The audit-log callout has a `View audit log →` link that activates the Audit Log tab.

### Content Requirements
- Menu items: "Dashboard", "Audit log", "PII detections", "Model registry", "Sessions", "Health diagnostics" (sentence case).
- Audit-log callout: "All actions on this page are audit-logged. Entries are retained per the Government of Alberta retention schedule." Add a `View retention schedule →` link if `docs/privacy/retention_schedule.md` is shippable.

### Files affected
- `frontend/src/views/AdminView.vue` — left rail rebuild; new top-of-content callout; existing tab components untouched.

### Recommended impeccable references during implementation
- `harden.md` — keyboard nav verification.

### Open Questions
- Does `goa-work-side-menu` v2.2.0 expose a slot-based item API, or props-only? Implementer to verify and adjust the template.
- Whether the section grouping is supported. If not, we ship flat.

---

## 5. FreeAgent TaskPanel — Detangle

### Feature Summary
Restructure `TaskPanel.vue` so the primary action (Start Agent) is visually unmistakable and a first-time analyst doesn't have to scroll through 13 vertical groups to find it. Group the panel into three `goa-accordion` sections with a sticky `goa-button-group` for primary actions at the bottom.

### Primary User Action
Click Start Agent (or in replay mode, Exit replay). Everything else supports that one decision.

### Design Direction
- Color strategy: Restrained.
- Scene sentence: "A policy analyst, 2pm, prompt already in hand from an email thread, wants to start the agent without scanning the whole left rail."
- Anchor references: Linear's "Create issue" right-rail panel (clear primary, supporting fields), VS Code's run/debug panel (config above, action below), GoA Public form example.

### Scope
- Fidelity: production-ready
- Breadth: one component (`TaskPanel.vue`); the parent (`FreeAgentView.vue`) is unchanged except possibly removing the mobile collapse wrapper since `goa-accordion` already handles disclosure.
- Interactivity: shipped, accordion state remembered locally
- Time intent: ship-quality

### Layout Strategy
Top → bottom inside the panel:

1. **H2** — "Task Configuration" (or "Session Replay" in replay mode). Just the heading; no callouts here.
2. **`goa-accordion`** with three sections (using `goa-details` for each if accordion-group control isn't available in v2.2.0):
   - **Library** (closed by default; collapsed entirely if there are no items). Recent sessions list + Saved prompts list — these are not the primary work, they're scaffolding.
   - **Task** (open by default). Description, Model, Classification, Max iterations. Classification mismatch callout renders *inside* this section, immediately below the Model dropdown so the cause-and-effect is local.
   - **Prompt customization** (closed by default). Customize Prompt button is the section trigger; the override count badge shows in the section header. Save this prompt UX moves into this section as well — it's a power-user feature, not a primary action.
3. **Replay callout.** If in replay mode, a `goa-callout type="information"` appears between the accordion and the bottom buttons, summarizing what's being replayed. (Existing.)
4. **Sticky bottom `goa-button-group`** (stays in view as the user scrolls the accordion):
   - **Start Agent** (`type="primary"`) — primary, never anywhere but here.
   - **New Session** (`type="secondary"`) — appears only in completed / error / paused / needs_assistance states.
   - **Exit replay** (`type="secondary"`) — in replay mode.

### Key States
- **Idle, prompt empty, no model selected.** Start Agent is disabled. Inline help under the prompt: "Describe the task in plain language. Include source documents the agent should consult and what the final report should contain."
- **Idle, classification mismatch.** Callout inside Task section names the mismatch. Start Agent stays disabled until resolved.
- **Creating / running.** All fields disabled. Start Agent shows the existing "Starting…" / "Running…" label and a `goa-circular-progress` next to the label (small).
- **Replay.** All fields locked; replay callout above; Exit replay is the only primary action.
- **Completed / Error.** "New Session" replaces "Start Agent" as the primary; reset path lives there.
- **Saved.** Transient `goa-temporary-notification` confirms; no inline saved-status badge needed.

### Interaction Model
- Accordion sections remember their open/closed state in `localStorage` (key: `abc.taskpanel.accordion.<section>`).
- **Cmd/Ctrl+Enter** anywhere in the panel triggers Start Agent (gated by `startDisabled`). Surface this in the button's `title=` plus an inline keyboard-hint badge: "Start (⌘↵)".
- The Save this prompt flow moves into the Prompt customization section: a small button inside that section, opening the existing inline form.

### Content Requirements
- Task Description placeholder: "Outline the task in plain language. Be specific about the source documents the agent should use and what the final report should contain." (Replaces "Describe what you want the agent to do…").
- Section names: "Library", "Task", "Prompt customization" (sentence case).
- Start Agent labels: "Start agent" (default), "Starting…" (creating), "Running…" (running), "Start new session" (completed/error).
- Inline help on Classification field: "Pick the highest classification of any data the agent will touch. Some models cap at lower levels."
- Inline help on Max Iterations: "Hard cap on agent turns. Default 10; raise carefully — long sessions cost more."

### Files affected
- `frontend/src/components/freeAgent/TaskPanel.vue` — restructure.
- `frontend/src/views/FreeAgentView.vue` — possibly remove the mobile collapse wrapper if `goa-accordion` covers it; otherwise no change.
- `frontend/src/composables/` — possibly a new `useAccordionState.ts` if accordion state-management gets non-trivial; otherwise inline.

### Recommended impeccable references during implementation
- `onboard.md` — first-run + empty-state coaching copy.
- `clarify.md` — placeholder + help-text microcopy.
- `harden.md` — verify keyboard parity, focus order on the accordion.

### Open Questions
- Does `goa-accordion` in v2.2.0 support an "open/closed by default" prop per section, or a controlled API? If only one section can be open at a time, that's incompatible with "Library closed, Task open" both being available simultaneously — fall back to `goa-details` per section if so.
- Sticky bottom button group: if the panel parent doesn't allow a sticky bottom, we render the buttons after the accordion (flow position) — confirm during implementation.

---

## Cross-cutting implementation rules

These apply to every fix above.

1. **Tokens, never literals.** No `bg-yellow-100`, `bg-orange-100`, `bg-gray-100`, `bg-green-100`, `bg-red-100`, `text-yellow-900`. Every color routes through `var(--goa-color-*)`.
2. **One container per group.** Never nest `goa-container`. Never use `goa-container` for repeated row patterns.
3. **`primary-dark` is for page H1 only.** All other headings use `--goa-color-text-default`.
4. **Headings via `goa-text` where possible.** Only fall back to raw `<h1>/<h2>/<h3>` if `goa-text` lacks the level.
5. **Status is always {color + label + icon}.** Never color alone.
6. **`:focus-visible` rings stay GoA-blue** (`--goa-color-primary`). Don't strip them.
7. **Body type stays at 18px.** Only override down for table cells, badge content, and metadata captions.
8. **No bouncy / elastic motion.** 120–180ms ease-out only.

## End-state target

- Design Health score moves from 26 / 40 to ≥ 32 / 40.
- Zero impeccable absolute-ban triggers.
- GoA component adoption grows from 15 / 50 to ≥ 25 / 50.
- Raw Tailwind palette literals: zero.

## Confirmation required

Reply with:

- **"Approved"** to lock the brief and proceed in the order above (Dashboard → Container migration → LoginView → Admin side menu → TaskPanel detangle).
- **"Approved, but ..."** with the specific change you want.
- **"Hold"** to pause and rework the brief.

Once approved, I'll move on each fix as a separate edit pass (one component focus per pass), commit-sized, and present diffs after each.
