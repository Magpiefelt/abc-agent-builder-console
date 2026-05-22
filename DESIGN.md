# Design

The visual system is the **Alberta Design System (GoA DS)** — `@abgov/design-tokens` for the palette, type, spacing, radii, elevation; `@abgov/web-components` (`goa-*`) for behavior. Tailwind v4 is in the stack for layout utilities only. Where we reach for a custom value, we reach via a token CSS variable, never a Tailwind color name.

## Theme

Light. Government service in office daylight or hotelling-desk fluorescents, on a ministry-issued laptop. Dark mode is not in scope.

## Color

Strategy: **restrained.** Tinted neutrals carry the surface; the GoA interactive blue (`--goa-color-interactive-default`) is the one accent and is used sparingly for primary actions, focus rings, selection, and `primary-dark` for the highest-level page heading.

Local aliases (in `src/assets/main.css`) bind app-scoped names to the canonical GoA tokens:

```
--goa-color-primary         → --goa-color-interactive-default
--goa-color-primary-dark    → --goa-color-interactive-hover
--goa-color-primary-light   → --goa-color-info-light
--goa-color-text            → --goa-color-text-default
--goa-color-text-secondary  → --goa-color-greyscale-700
--goa-color-border          → --goa-color-greyscale-200
--goa-color-background      → --goa-color-surface-50
--goa-color-surface         → --goa-color-greyscale-white
--goa-color-success         → --goa-color-success-default
--goa-color-warning         → --goa-color-important-default
--goa-color-error           → --goa-color-emergency-default
--goa-color-info            → --goa-color-info-default
```

Hard rule: **no raw Tailwind palette names** (`bg-gray-100`, `bg-yellow-100`, `bg-green-100`, `bg-red-100`, `bg-orange-100`) anywhere in the app. They bypass GoA tokens and produce off-brand swatches. Every existing instance is a defect to close.

Semantic mappings for status:

- **Idle / neutral / midtone** → `goa-color-greyscale-200` track + `goa-color-text-secondary` label, or `goa-badge type="midtone"`.
- **Running / in-progress / informational** → `--goa-color-info-default` / `goa-badge type="information"`.
- **Completed / success** → `--goa-color-success-default` / `goa-badge type="success"`.
- **Paused / important** → `--goa-color-important-default` (GoA "important" is amber) / `goa-badge type="important"`.
- **Error / emergency** → `--goa-color-emergency-default` / `goa-badge type="emergency"`.

`primary-dark` is reserved for the **top-level page heading only**. Section headings (`<h2>/<h3>`) use `--goa-color-text-default`. Today, every heading in the app uses `primary-dark`; that flattens the type hierarchy and reads as monochrome navy.

## Typography

Font family: `var(--goa-font-family-sans)` (set on body, declared by `@abgov/design-tokens`).

Body: 18px / 1.6 (set globally in `main.css`). This is the GoA baseline and should not be overridden site-wide; component-level `text-sm` (14px) and `text-xs` (12px) use is restricted to metadata, badge content, and table cells.

Hierarchy (target, on light surface):

| Role | Size | Weight | Color |
|---|---|---|---|
| Page H1 | 28–32px | 700 | `--goa-color-primary-dark` |
| Section H2 | 22–24px | 600 | `--goa-color-text-default` |
| Subsection H3 | 18–20px | 600 | `--goa-color-text-default` |
| Body | 18px | 400 | `--goa-color-text-default` |
| Secondary / meta | 14px | 400 | `--goa-color-text-secondary` |
| Caption / label | 12px | 600 uppercase tracking-wide | `--goa-color-text-secondary` |
| Code / mono | 0.85em | 400 | inherits, `var(--goa-font-family-number)` |

Whenever practical, prefer `goa-text` over a hand-rolled `<h1 class="text-2xl …">`. It keeps the ramp consistent across the app.

## Layout

Two shells:

1. **App shell** — `goa-app-header` (top), `<main>`, `goa-footer` (currently missing — add).
2. **Public/auth shell** — `goa-microsite-header` + `goa-app-header` + a focused sign-in container + `goa-footer`. Today the LoginView has none of these.

Inside the app shell, three page archetypes:

- **List/Index** (WorkflowListView): page header row → filter row → table → empty state.
- **Detail/Workspace** (WorkflowView, FreeAgentView): toolbar/control bar → 3-column workspace (left config / center canvas / right inspector or memory) → bottom panel (execution / timeline).
- **Section index** (AdminView, ProfileView): left side menu (`goa-side-menu` / `goa-work-side-menu`) → content surface.

Spacing scale follows GoA's 4 / 8 / 12 / 16 / 24 / 32 / 48 step. Default surface padding on a content block is 16–24px; toolbars are 8–12px vertical. Don't invent in-between values (e.g. `py-1.5` should map to 8px or 12px, not 6px).

Containers: prefer `goa-container` to express "this is a grouped surface." Repeated identical bordered divs (the current pattern in ProfileView, DashboardPanel, IterationTimeline, ExecutionPanel) are anti-hierarchy — when everything is a card, nothing is. Use `goa-container` only for top-level groupings (Identity / Saved prompts / Favourites in ProfileView), and use `goa-block` plus dividers for the rows inside.

## Components

Source of truth: the 50 components published at `https://design.alberta.ca/components`. The codebase already imports `@abgov/web-components`, so every one of them is available.

Currently in use: `goa-app-header`, `goa-button`, `goa-badge`, `goa-callout`, `goa-input`, `goa-textarea`, `goa-dropdown`, `goa-dropdown-item`, `goa-table`, `goa-modal`, `goa-tabs`, `goa-tab`, `goa-checkbox`, `goa-notification`, `goa-form-item`.

Available and **not yet adopted** (target for migration):

- `goa-microsite-header` — required at the top of the auth shell; recommended at the top of the app shell.
- `goa-footer` — required at the bottom of every page; currently absent.
- `goa-container` — replaces every hand-rolled `<div class="bg-...-surface border border-...-border rounded-md p-X">`.
- `goa-block` — replaces hand-rolled `flex flex-col gap-X` groupings.
- `goa-grid` — replaces hand-rolled `grid grid-cols-N gap-X` in DashboardPanel and ProfileView.
- `goa-side-menu` / `goa-work-side-menu` — replaces the hand-rolled `<button>` left rail in AdminView.
- `goa-details` / `goa-accordion` — replaces the native `<details>` blocks in TaskPanel and WorkflowSidebar.
- `goa-icon-button` — replaces the hand-rolled SVG close button in FreeAgentView mobile sheet.
- `goa-divider` — replaces hand-rolled `<div class="h-6 w-px bg-...-border" />` vertical lines in WorkflowToolbar.
- `goa-filter-chip` — replaces hand-rolled goa-button category chips in BlackboardViewer.
- `goa-link` / `goa-link-button` — replaces ad-hoc `<router-link class="text-primary hover:underline">`.
- `goa-menu-button` — replaces the open-rendered action pair (Use as template / Delete) in WorkflowListView row actions.
- `goa-skeleton` — replaces "Loading …" text on data-heavy views (WorkflowListView, AdminView dashboard, AuditLogViewer).
- `goa-circular-progress` — replaces "Starting…" / "Running…" labels in ControlBar with a progress indicator.
- `goa-pagination` — replaces the "limit reached — increase to see more" pattern in AuditLogViewer.
- `goa-temporary-notification` — replaces the hand-positioned top-right toast container (use the canonical bottom placement).
- `goa-tooltip` — replaces `title="..."` attributes on toolbar buttons in WorkflowToolbar.
- `goa-drawer` / `goa-push-drawer` — replaces the hand-rolled WorkflowHistoryPanel and (optionally) the Properties panel on small screens.
- `goa-text` — wraps headings / paragraphs in the canonical type ramp.

Canvas (Vue Flow) is the one place where custom Vue components must persist — `goa-*` web components don't ship workflow nodes. The four node types (Agent / Function / Tool / Note) should still source colors and spacing from GoA tokens, and should visually differentiate beyond a 2-pixel coloured dot (icon, accent strip on the handle side, distinct shape language).

## Elevation

Three levels. Anything more is decoration.

- `none` — flat default for content blocks.
- `low` — `shadow-sm`, used by selected canvas nodes and active drag affordances.
- `high` — reserved for `goa-modal`, `goa-drawer`, `goa-popover`, toasts. Never on cards.

## Motion

- Use only `transition-colors` and `transition-opacity` for hover/active/selected states. 120–180ms, ease-out.
- Do not animate layout (`height`, `width`, `padding`, `margin`). For expanding panels, use `max-height` paired with `opacity`, or use `goa-drawer` / `goa-details` (both already handle their own motion correctly).
- No bounce, no elastic, no decorative entrance animations. `prefers-reduced-motion: reduce` must collapse all motion to instant.

## Iconography

Ionicons (already loaded via CDN in `index.html`) for the `goa-button leadingicon="..."` prop, in line with how the GoA web components consume them. Where a custom SVG appears (e.g. the mobile sheet close button), replace with `goa-icon-button` + an Ionicons name.

## Authoring rules

1. Reach for `goa-*` first; if none fits, ask why before hand-rolling.
2. Color via CSS variable, never literal Tailwind palette names.
3. One H1 per page, in `primary-dark`. Subheadings in default text color.
4. Don't nest `goa-container`s. Don't repeat identical containers as the primary hierarchy mechanism.
5. Status is always {color + label + icon}, never color alone.
6. Every interactive element has a visible `:focus-visible` ring using `--goa-color-primary`.
7. Body type is 18px; only override down for table cells, metadata, and badge text.
8. Modals are a last resort. Inline edit, push drawer, and progressive disclosure come first.
