# ADR-0002: Vue Flow for the workflow canvas

- **Status:** Accepted
- **Date:** 2026-05-22
- **Deciders:** ABC core engineering

## Context

The workflow builder needs a visual canvas where users drag Agent, Function,
Tool, and Note nodes onto a 2D surface, connect them with directed edges,
edit node properties in a side panel, and trigger execution. The spec app
used React Flow for this; we ported intent only (not code) and needed a
Vue-ecosystem equivalent.

Constraints we cared about:

- **Vue 3 + TypeScript-native.** Wrapping a React component would have
  added React-DOM to the bundle (~150 KB minified) and a paradigm mismatch
  for every contributor.
- **Custom-node rendering.** Each of the four node kinds needs a unique SFC
  with controls, ports, classification badges, validation hints.
- **Programmatic graph mutation.** The frontend store (`stores/workflow.ts`)
  needs `addNode`, `removeNode`, `setEdges`, etc. to flow from
  store actions, not from canvas-internal state.
- **Render-only diff overlay.** Bot 14's version-diff feature needs to
  decorate existing nodes with classes without mutating data.
- **Performance budget.** A 100-node ministry workflow should pan/zoom at
  60 fps on a typical GoA-issued laptop.
- **License compatibility.** GoA standard procurement allows MIT/Apache
  packages; copyleft licenses require review.

## Decision

Adopt [Vue Flow](https://vueflow.dev/) (`@vue-flow/core@^1.48`, plus
`@vue-flow/background` and `@vue-flow/minimap`).

Concretely:

- `frontend/src/components/workflow/WorkflowCanvas.vue` wraps `<VueFlow>` and
  maps store state to its `nodes` / `edges` props.
- Each node kind is a separate SFC under
  `frontend/src/components/workflow/nodes/` registered via the `nodeTypes`
  prop.
- All mutations go through the workflow store — Vue Flow's `useVueFlow`
  composable is **not** used for state, only for viewport ops.
- A `diffOverlay` prop (Bot 14) applies CSS classes by node/edge id without
  touching `canvas_data`.

## Consequences

**Positive.**

- Vue 3 native — no React-DOM, no paradigm mismatch.
- MIT license, actively maintained (>3k GitHub stars, regular releases).
- TypeScript declarations ship in-package.
- Composable architecture: custom nodes, custom edges, custom backgrounds,
  custom minimap — every aspect we needed to customise was customisable.

**Negative.**

- Bundle size: ~80 KB minified+gzipped (compared to a hand-rolled SVG
  canvas at ~20 KB). Acceptable given the saved engineering time.
- Less mature than React Flow — some edge cases (e.g. handle-based edge
  routing for branching) needed local workarounds rather than upstream APIs.
- Single-author project; bus factor is a risk. Mitigated by the MIT license
  — if it goes dormant we can fork.

**Operational notes.**

- Bundle-size CI guardrail (Backlog D4) tracks Vue Flow growth.
- We pin to the `^1.48` minor; majors get reviewed.

## Alternatives considered

1. **Hand-rolled SVG canvas.** Rejected: re-implementing pan/zoom/drag/snap
   would have absorbed weeks; community-tested libraries handle it.
2. **`vis-network`.** Rejected: physics-based force layout, not the
   pinned-position user-controlled positioning we need.
3. **`cytoscape.js`.** Rejected: graph-analysis library, not optimised for
   drag-edit workflows; bridging into Vue would need a wrapper of comparable
   complexity to just adopting Vue Flow.
4. **`d3.js`.** Rejected: too low-level. We'd be writing the same boilerplate
   Vue Flow already abstracted away.
5. **React Flow wrapped in `vue-react`.** Rejected: see Context (bundle size,
   paradigm mismatch).
