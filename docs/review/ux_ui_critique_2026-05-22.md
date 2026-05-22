# ABC Frontend — UX/UI Critique

**Date:** 2026-05-22
**Reviewer:** impeccable (full-app audit, visual polish & hierarchy focus)
**Surfaces audited:** App shell (AppHeader, App.vue, main.css), LoginView, WorkflowListView, WorkflowView (Toolbar, Sidebar, Canvas, PropertiesPanel, ExecutionPanel, four node components), FreeAgentView (TaskPanel, ControlBar, IterationTimeline, BlackboardViewer), AdminView (DashboardPanel, AuditLogViewer), ProfileView, ToastContainer.
**Constraint:** GoA Design System (`@abgov/design-tokens` + `@abgov/web-components`) is the source of truth. 50 components are available; the codebase uses 15.

---

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 4 | SSE stream, iteration counter, dirty/saved-ago badge, aria-live — solid. |
| 2 | Match System / Real World | 2 | Raw enum values surface in UI: `needs_assistance`, `protected_a`, status pill in ControlBar shows "Idle"/"Running" but Iteration timeline shows `running`/`completed` lowercase. "Blackboard" / "Scratchpad" jargon never defined. |
| 3 | User Control and Freedom | 3 | Confirm-modal for delete, `beforeunload` on unsaved canvas — good. No undo on node delete. No way to cancel a partially-completed Save. |
| 4 | Consistency and Standards | 2 | Hand-rolled containers dominate where `goa-container` should; raw Tailwind palette colors (`bg-yellow-100`, `bg-orange-100`, `bg-gray-100`) appear in ControlBar and DashboardPanel; AdminView left rail uses native `<button>` instead of `goa-side-menu`. |
| 5 | Error Prevention | 3 | Classification mismatch callout, save-before-run guard — competent. Properties panel allows entering `${nodeId.path}` syntax with no validation/preview. |
| 6 | Recognition Rather Than Recall | 3 | Most actions are icon + label. But canvas nodes render `templateId` (a slug) instead of the template's display name, and parameter inputs in PropertiesPanel have helptext but no example values for upstream references. |
| 7 | Flexibility and Efficiency | 3 | Cmd+S/Cmd+Enter on WorkflowView (discoverable only in `title=` tooltip). No bulk select on workflows table. No drag-keyboard parity on canvas. |
| 8 | Aesthetic and Minimalist Design | 2 | Repeated identical bordered cards as primary hierarchy; every heading is `--goa-color-primary-dark` (monochrome navy); DashboardPanel is a six-cell hero-metric grid (impeccable ban); type ramp flattens to 14/12px in component bodies. |
| 9 | Error Recovery | 3 | Errors are named and retryable; models-store retry button is good. PropertiesPanel has no recovery path if a referenced upstream nodeId is deleted. |
| 10 | Help and Documentation | 1 | No empty-state coaching, no "what is X?" tooltip on Blackboard / Scratchpad / Artifacts, no first-run tour, no inline help on classification levels, no admin-tab documentation pointers. |
| **Total** | | **26 / 40** | **Competent, ships — but ~6 points of unrealized craft.** |

A 26 means the app works and is mostly trustworthy. The deductions are not bugs; they're the difference between "internal tool that runs" and "feels like a Government of Alberta service."

---

## Anti-Patterns Verdict

**LLM assessment:** Two of the six impeccable absolute bans are triggered.

1. **Hero-metric template — `frontend/src/components/admin/DashboardPanel.vue` lines 141–166.** Two `grid md:grid-cols-3` rows of identical bordered cards, each "Big number, small uppercase label." Three for sessions windows (24h/7d/30d), three for executions windows. Six near-identical hero-metric cards stacked on first paint. This is the SaaS cliché the brand should not look like.
2. **Identical card grids.**
   - `DashboardPanel.vue` lines 168–276: a 2×2 grid of identical bordered containers (Session status, Session classification, Workflow status, Model usage), each with its own hand-rolled inline progress bars.
   - `ProfileView.vue` lines 62–178: three identical bordered containers (Identity / Saved prompts / Favourite workflows). Same padding, same border, same radius, same heading style — when everything looks the same, hierarchy collapses.
   - The four canvas node components (`AgentNode`, `FunctionNode`, `ToolNode`, `NoteNode`) are visually identical except for a 2px dot in a different color and a one-line subtitle. The canvas reads as a homogeneous grid of cards rather than a typed graph.

**Not triggered:** No gradient text, no glassmorphism, no modal-as-first-thought, no decorative side-stripe borders (the `border-left: 3px` in `.prose blockquote` is a true semantic blockquote and is fine).

**Visual overlays / deterministic scan:** not run in this pass. If you want the bundled detector to also walk the codebase, ask for it as a follow-up — the manual read already covers the territory at the granularity that matters for visual polish.

---

## Overall Impression

ABC is a competent, GoA-aware product that already gets the hard things right: SSE state visibility, audit posture, classification gating, dirty-state confirmation, accessible focus rings. It is in no way embarrassing.

But it currently reads as **engineer-shipped, not designer-shipped.** Every page leans on the same hand-rolled bordered container as the primary hierarchy mechanism, every heading is `primary-dark`, and the GoA component library is half-adopted — 15 of 50 components in use, with the rest of the work done in raw Tailwind utilities that bypass tokens (`bg-yellow-100`, `bg-orange-100`, `bg-gray-100`).

The single biggest opportunity is **stop hand-rolling containers.** Replace `<div class="bg-...-surface border border-...-border rounded-md p-X">` with `goa-container`, then use type hierarchy and surface elevation to express grouping. That one change alone reshapes ProfileView, DashboardPanel, FreeAgent IterationTimeline, ExecutionPanel, BlackboardViewer, and the AuditLogViewer filter row. After that, the next-biggest wins are: a real `goa-side-menu` on Admin, replacing the LoginView with an actual GoA-shape auth shell (microsite header + footer), and breaking the DashboardPanel hero-metric grid into a real operational overview.

---

## What's Working

1. **SSE / streaming state UX.** The IterationTimeline auto-expands the running iteration, collapses completed ones, and surfaces tool-call duration and success per call. The dot+token+duration row is information-dense without being noisy. `aria-live` on status pill and Replay banner is correct.
2. **Token discipline in CSS.** The local alias block at the top of `main.css` is exactly the right pattern: app-scoped names that resolve to canonical GoA tokens. This is the foundation that makes a full migration achievable without touching every component.
3. **Compliance signal is present.** Ministry badge in the header, classification dropdown in TaskPanel + WorkflowToolbar, PII-blocked badge in ExecutionPanel, audit-log warning in the Admin side rail. The bones of a Protected-B-ready surface are all there — they just need to be more visible.

---

## Priority Issues

Ranked by impact on senior, public-service trust.

### P0 — Replace hand-rolled containers with `goa-container`

**What.** Every page builds its surface groupings from `<div class="bg-[var(--goa-color-surface)] border border-[var(--goa-color-border)] rounded-md p-X">`. There are 30+ instances of this pattern across ProfileView, DashboardPanel, FreeAgent IterationTimeline / BlackboardViewer / ExecutionPanel, AuditLogViewer filter row, and the workflow node components.

**Why it matters.** This is the difference between "looks GoA" and "looks like a Bootstrap dashboard with GoA buttons stapled on." It also bypasses GoA's elevation, padding, and a11y conventions baked into `goa-container`. And because it's hand-rolled, when GoA updates container radii / shadows, ABC will drift.

**Fix.** Audit all `border-[var(--goa-color-border)] rounded` divs. Replace with `goa-container type="non-interactive"` (or `interactive` where it's clickable). Inside, use `goa-block` instead of `flex flex-col gap-X` for grouping, and a single section heading at the top. Where the existing pattern was used to indicate hierarchy *between* repeated rows (e.g. iterations in the timeline), do not wrap each row in a container — use a divider or a leading-number column instead.

**Suggested command:** `/impeccable extract` to lift the container pattern into a single `<AppContainer>` shim if `goa-container` props don't map 1:1, then `/impeccable polish` to walk the views.

### P0 — Rebuild DashboardPanel away from the hero-metric template

**What.** Two rows of three big-number cards stacked on top of a 2×2 grid of identical card-with-inline-progress-bars. Six metric cards followed by four progress-bar cards is the textbook SaaS dashboard cliché.

**Why it matters.** It violates two impeccable absolute bans (hero-metric template + identical card grids) and signals "AI-generated admin" on first glance. Admin is also the smallest user group but the highest-trust audience — owners, auditors. They notice when the chrome looks like a template.

**Fix.** Group the three sessions windows into a single `goa-container` with a small inline-stat treatment (label, number, sparkline-or-trend, in a row of three) — one container, not three. Same for executions. For the status/classification/model/PII grids, switch to a single Operational summary container with a tab strip (`goa-tabs`) — one chart at a time at a higher resolution beats four small ones. The "Top tools" `goa-table` is already correct; keep it.

**Suggested command:** `/impeccable distill` followed by `/impeccable bolder` on the resulting layout to commit to a single confident dashboard composition.

### P1 — Build the LoginView as a real GoA auth shell

**What.** LoginView is currently a single small bordered card centered on a neutral background. No `goa-microsite-header`, no `goa-app-header`, no `goa-footer`, no GoA wordmark/crest, no service-name treatment beyond an 18-px H1.

**Why it matters.** This is the first screen any user sees. For an internal-but-Entra-ID-authenticated GoA service, the absence of microsite-header (which carries "Government of Alberta", phase label like "Beta", and a feedback link) and the GoA footer makes the page read as a stand-in rather than a service. It is also the moment where the user decides whether to trust their credentials to the application.

**Fix.** Wrap in `goa-microsite-header` (type="alpha"/"beta" once decided) + `goa-app-header` (signed-out variant) + `goa-footer`. Use `goa-hero-banner` (restrained variant, not the marketing one) or a `goa-container` with a strong wordmark for the sign-in card. Add a "Need help?" / "Service status" inline link to the footer.

**Suggested command:** `/impeccable shape` followed by `/impeccable craft`.

### P1 — Replace AdminView side rail with `goa-work-side-menu`

**What.** AdminView builds its tab nav from native `<button>` elements with hand-rolled active/hover state. It also doubles as the page's identity (Administration heading + audit-log note), which is correct in intent but executed as flat text.

**Why it matters.** `goa-work-side-menu` is exactly this pattern. Using it gets keyboard nav, ARIA roles, GoA selected-state styling, and consistent spacing for free — and ties the surface to the rest of the GoA tooling estate.

**Fix.** Migrate to `goa-work-side-menu` with menu items; promote the "All actions on this page are audit-logged" line to a `goa-callout type="information"` at the top of the right-hand content surface, not a tiny footnote in the rail.

**Suggested command:** `/impeccable craft admin-side-menu` or a direct refactor.

### P1 — Detangle the FreeAgent TaskPanel into grouped sections

**What.** TaskPanel.vue is a single ~420-line section that stacks: Recent sessions, Saved prompts, Section heading, Replay callout, Task Description, Model, Classification, Max Iterations, Customize Prompt button (with badge), Classification mismatch callout, Start Agent, Save this prompt (with inline form), New Session. That's 13 vertical groups in one column with one heading.

**Why it matters.** Cognitive load is high; the primary action (Start Agent) is below the fold on smaller laptops; "Save this prompt" sits below the primary action which is the wrong adjacency.

**Fix.** Group with `goa-accordion`:
- **Library** (closed by default) — Recent sessions, Saved prompts.
- **Task** (open) — Description, Model, Classification, Max iterations.
- **Prompt customization** (closed) — Customize Prompt button with the override badge collapsed inside the accordion summary.

Pull Start Agent and New Session out of the accordion into a fixed bottom button stack inside the panel using `goa-button-group`. Move "Save this prompt" into a `goa-menu-button` next to Start ("More actions" → Save, Reset).

**Suggested command:** `/impeccable shape free-agent-task-panel` then `/impeccable craft`.

### P2 — Remove raw Tailwind palette colors

**What.** ControlBar status pill uses `bg-yellow-100 text-yellow-900`, `bg-green-100`, `bg-red-100`, `bg-orange-100`, `bg-gray-100`. DashboardPanel uses `bg-gray-100` for progress-bar tracks. WorkflowSidebar uses `hover:bg-[var(--goa-color-warning)]/20` (Tailwind v4's arbitrary-opacity-with-CSS-var syntax which is fragile).

**Why it matters.** Each one bypasses the GoA token system. Tomorrow when the design system updates `important` to a slightly different amber, these spots will drift. And `text-yellow-900` is not anywhere on the GoA palette — it's a Tailwind default chosen by reflex.

**Fix.** Replace the status pill in `ControlBar.vue` lines 33–48 with `goa-badge` (the type mapping is already half-done in IterationTimeline — copy that). Replace progress-bar tracks with `goa-color-greyscale-200` or use `goa-linear-progress` outright. Fix the warning hover by using a full CSS variable, not an arbitrary-opacity fragment.

**Suggested command:** `/impeccable colorize` constrained to "remove raw Tailwind palette names".

### P2 — Differentiate canvas node types beyond a 2-pixel dot

**What.** AgentNode / FunctionNode / ToolNode have identical shape, identical padding, identical layout. They differ only by the color of a 2px dot (primary / info / success) and a one-line subtitle. The label of an Agent node renders `data.templateId` (a slug) when no custom label is set, not the template's display name.

**Why it matters.** Workflow Canvas is the headline feature of the product. When all node types look the same, the canvas degrades to "boxes on a graph" and a glance can't distinguish an LLM call from a deterministic function. Identical card grids in a hot zone.

**Fix.** Three moves:
1. Distinct icon per type (brain / function / wrench / sticky-note), positioned in a small chip on the leading edge.
2. Distinct background-tint per type using `--goa-color-info-light` (Agent), `--goa-color-success-light` (Tool), `goa-color-greyscale-100` (Function), `--goa-color-important-light` (Note).
3. Agent node should look up the template's display name from `agentTemplates` and render that, not the templateId slug. (Same fix that PropertiesPanel already does via `currentTemplate`.)

**Suggested command:** `/impeccable shape canvas-nodes` then `/impeccable bolder` on the canvas.

### P2 — Demote `primary-dark` from "every heading" to "page H1 only"

**What.** Every page H1 is `text-[var(--goa-color-primary-dark)]`. Every section H2 is also `text-[var(--goa-color-primary-dark)]`. Every panel H3 too. Every `details` summary. The result is a wall of identical navy headings with the same weight band, and the only thing distinguishing levels is font size — which is also flattened (most H2s are `text-lg`, most H3s are `text-sm font-semibold`).

**Why it matters.** Type hierarchy is doing zero work. Eye flow has nothing to follow; the page reads as a mosaic.

**Fix.** Reserve `--goa-color-primary-dark` for the top-level page H1 only (1 per route). All H2/H3 use `--goa-color-text-default`. Wherever practical, swap raw `<h1 class="text-2xl …">` for `goa-text` so the type ramp comes from the design system rather than ad-hoc Tailwind sizes.

**Suggested command:** `/impeccable typeset` constrained to "heading color demotion + goa-text adoption".

### P3 — Add a `goa-footer` to App.vue

**What.** `App.vue` is `header / main / toasts`. No footer. Every GoA service is expected to render a footer with at minimum "Government of Alberta" link-out, privacy / accessibility / disclaimer / contact links.

**Why it matters.** Compliance + brand consistency. Auditors notice; users notice subliminally.

**Fix.** Add `<goa-footer>` after `<main>` with the standard GoA footer-nav sections. Don't invent fields; mirror what design.alberta.ca provides.

**Suggested command:** straightforward refactor; `/impeccable polish` would catch it.

### P3 — Replace `goa-notification` toasts with `goa-temporary-notification`

**What.** ToastContainer.vue positions a fixed top-right stack of `goa-notification` components. `goa-notification` is the page-level banner pattern; `goa-temporary-notification` is the bottom-of-screen ephemeral pattern.

**Why it matters.** GoA recommends notification *banners* for page-level concerns and *temporary notifications* for transient feedback (toasts). Using `goa-notification` for toasts mixes the two registers and steals visual weight from things that should be banner-level (e.g. session expired, network outage).

**Fix.** Swap the component, move the container to the bottom, and reserve `goa-notification` (banner) for genuine page-level state (replay banner, session-expiring warning, system-degraded).

**Suggested command:** `/impeccable clarify` on toast UX.

---

## Persona Red Flags

### Jordan — first-time ministry analyst

Has used Outlook, SharePoint, and the GoA intranet. Has never seen an agent canvas. Opens ABC for the first time after a manager forwards the link.

- **Lands on LoginView.** No microsite header to confirm this is a GoA service. The wordmark is text-only. The card says "Government of Alberta — sign in with your work account to continue." but doesn't say what the tool does. Hesitates.
- **Lands on Free Agent.** TaskPanel asks for "Task Description", "Model", "Classification", "Max Iterations", "Customize Prompt", "Save this prompt", with "Blackboard / Scratchpad / Artifacts" tabs on the right rail. None of these terms appear in their daily vocabulary. No tooltip explains "Blackboard" or "What does Max Iterations do?"
- **Lands on Workflows.** Sees `Use as template` and `Delete` buttons in the row. "Use as template" reads ambiguously — does it open the workflow, or duplicate it? (It duplicates.)
- **Abandons** at the model-classification mismatch warning, because it appears as a callout but the only path forward is to change the model dropdown — the warning text doesn't say "pick a different model."

### Alex — experienced power user (returning daily)

Already understands the model. Wants throughput.

- **WorkflowView.** Cmd+S / Cmd+Enter shortcuts exist but are only surfaced in `title=` tooltips. The discoverability gap means most users never learn them.
- **WorkflowListView.** No bulk select. No keyboard shortcut to create a new workflow. The search box and the New button are both on the top bar but the visual treatment doesn't suggest "press / to focus search" the way Linear/GitHub/Notion conventions imply.
- **Free Agent canvas.** Drag-drop only; no keyboard way to add an agent / function / tool. No "Tab to next iteration" navigation in the timeline.

### Reviewer — ministry compliance/auditor (project-specific persona)

Logs in to confirm a session's audit trail.

- **AppHeader.** Ministry badge is there — good.
- **Free Agent run.** Classification is visible in TaskPanel and shows in the status pill area. PII-blocked count is visible per-stage in ExecutionPanel. Good.
- **AdminView.** The "All actions on this page are audit-logged" note is in 11px text at the bottom of the side rail. For an auditor's first-glance read, that's hidden. Should be a callout at the top of every admin tab.
- **Audit Log.** Filters are good; CSV export works. The pager pattern ("limit reached — increase to see more") is a manual workaround; a real `goa-pagination` is the correct affordance.

---

## Per-View Findings (Compact)

**App shell.** `App.vue` lacks `goa-footer` and `goa-microsite-header`. The skip-link is good. The `main` element has `tabindex="-1"`; once we add a footer, set `main` `id="main-content"` is already present — keep it.

**AppHeader.** `goa-app-header` is used correctly. The user avatar circle (initials in a coloured disc) is hand-rolled; defensible since GoA doesn't ship an avatar component, but worth a comment in code calling that out. The "Sign in" link in signed-out state is a bare `<router-link>` — replace with `goa-link`.

**LoginView.** Card is too quiet; identity is anemic. See P1.

**WorkflowListView.** Top bar crams page title + search + dropdown + Import + New into a single flex row. On 1280-px wide screens this works; on a 1024-px-wide laptop the row wraps awkwardly. Split into two rows: page title row (left H1, right primary "New workflow" button), then a filter row (search, ministry dropdown, Import as `goa-menu-button` overflow). The table itself is well-handled with `goa-table`.

**WorkflowView.**
- WorkflowToolbar: the name `<input>` is native — replace with `goa-input variant="ghost"` if available, otherwise keep but add a visible label-on-focus pattern. The hand-rolled vertical dividers (`<div class="h-6 w-px bg-...-border">`) should be `goa-divider direction="vertical"`.
- WorkflowSidebar: native `<details>` for sections — replace with `goa-accordion`. The "Sticky Note" item uses `hover:bg-[var(--goa-color-warning)]/20` which is the fragile arbitrary-opacity-with-var pattern; replace with a `--goa-color-important-light` token.
- WorkflowCanvas: see P2 on node differentiation.
- PropertiesPanel: parameter inputs accept `${nodeId}` / `${nodeId.path}` syntax with a placeholder hint. Add a `goa-tooltip` with an example and validation feedback on focus.
- ExecutionPanel: per-stage `border-[var(--goa-color-error)]/30` is the arbitrary-opacity-with-var pattern again. Use a fully-defined token.

**FreeAgentView.** Three-column desktop layout is the right shape. Mobile sheet for memory tabs is well thought-through, but the close button is a hand-rolled SVG — replace with `goa-icon-button icon="close"`. See P1 on TaskPanel detangle.

**ControlBar.** Status pill is the worst color-token offender. See P2.

**IterationTimeline.** Information-dense and well-balanced. Minor: "Expand all" / "Collapse all" toggle and "X total" counter could share a `goa-button-group`.

**BlackboardViewer.** Category filters use `goa-button` toggles — replace with `goa-filter-chip`. Per-entry containers re-implement `goa-container`; see P0.

**AdminView.** See P1 on side menu.

**DashboardPanel.** See P0 on the hero-metric template.

**AuditLogViewer.** The filter row in a bordered card and the result count above the table both work. The "limit reached" pager is the only real issue; replace with `goa-pagination`.

**ProfileView.** Three identical containers stacked. See P0 / P1 on container pattern.

**ToastContainer.** See P3.

---

## Minor Observations

- The body font-size is set to 18px in `main.css` (line 31), which is correct for the GoA baseline. But many components override down to `text-sm` (14px) for non-metadata content (e.g. ProfileView's `<dd>` values are `text-sm`; should be 18px/body since these are primary fields).
- Vue Flow's default theme is imported as-is. The minimap override is good. The Background dots and Controls also accept theming — pass them tokens for consistency.
- `index.html` loads Ionicons via CDN (lines 7–8). That's fine for now but worth a self-hosting plan for the deploy bundle (offline / air-gapped behavior, plus first-paint cost).
- Typekit CSS is loaded directly via `https://use.typekit.net/bvu2qen.css` (`index.html` line 6) — confirm this isn't redundant with the `@abgov/design-tokens` font setup, and self-host if licensing allows.
- Several pages render plain `Loading…` text. Replace with `goa-skeleton` on the WorkflowListView table, DashboardPanel cards, and AuditLogViewer table for first-paint quality.
- The "Free Agent / Workflows / Admin" nav slot in AppHeader uses `RouterLink slot="navigation"` — confirm this slot-forwarding still works on the latest `@abgov/web-components` v2.2.0 release; if there are quirks under Vue 3.5, wrap each link in a `<span slot="navigation">`.
- WorkflowToolbar shows `v{{ workflow.version }}` as plain `text-xs text-secondary`. A `goa-badge type="midtone"` would be more on-brand and clickable into the History panel.
- Form labels with `:requirement="required"` on PropertiesPanel are correct GoA pattern; carry that consistency to TaskPanel (where everything except Customize Prompt is implicitly required).
- The "Free Agent / Workflow / Admin" tab in the AppHeader doesn't show the user's last-opened workflow. A breadcrumb (`/Workflows / Policy Drafter v3`) would help orientation on deep links.

---

## Questions to Consider

- What if the dashboard answered one question per fold instead of nine? "What ran today?" → headline. "What's degrading?" → second. "What needs admin attention?" → third. The current layout is presenting all nine at equal weight.
- Does the Workflow Canvas need to feel like a node graph, or like a "recipe"? A vertical step list with side-quests for branches is shipping-as-default in several recent agentic tools (LangFlow, Latitude) — a recipe view might serve Jordan better than free-form node placement, with the canvas reserved as a power-user view.
- What does the empty-state of Free Agent want to say? Right now it says "Describe what you want the agent to do…". A senior public-service voice version would be: "Outline the task in plain language. Be specific about the source documents the agent should use and what the final report should contain."
- Could the four admin tabs collapse to two? Audit + PII fit one surface (compliance review); Models + Sessions + Health fit another (operations). Dashboard could lead each.
- The classification dropdown shows `unclassified / protected_a / protected_b`. Should it render with the canonical GoA classification labels and brief consequences ("Protected B — restricted to approved models")? The current UI puts the burden on the user to remember rules.

---

## Recommended Action Plan (Pending Your Priorities)

Once you confirm priorities (next message), I will sequence as `/impeccable …` sub-commands. Likely order:

1. `/impeccable distill admin/DashboardPanel.vue` — kill the hero-metric template.
2. `/impeccable craft auth-shell` — rebuild LoginView with microsite-header + footer + identity.
3. `/impeccable extract container-pattern` — lift hand-rolled bordered divs into `goa-container` adoption across all views.
4. `/impeccable craft admin-side-menu` — `goa-work-side-menu` for AdminView.
5. `/impeccable shape free-agent-task-panel` then `/impeccable craft` — accordion + sticky button group.
6. `/impeccable colorize tokens-cleanup` — purge raw Tailwind palette names.
7. `/impeccable bolder canvas-nodes` — differentiate Agent / Function / Tool / Note visually.
8. `/impeccable typeset heading-demotion` — `primary-dark` for page H1 only.
9. `/impeccable polish` — footer, divider, icon-button, link, skeleton, filter-chip, accordion, tooltip, pagination, temporary-notification adoptions.

End-state target: Design Health score ≥ 32 / 40, zero impeccable absolute-ban triggers, GoA component adoption ≥ 35 / 50.
