# Product

## Register

product

## Users

Government of Alberta ministry staff (analysts, policy officers, program managers, administrators) using ABC inside their normal workday from a desktop browser on a managed GoA device, sometimes on a small tablet at a meeting. They are signed in via Entra ID SSO with a ministry scope. They are not engineers; some have never seen an agent-orchestration tool before. They expect government-of-Alberta visual cues (header, tokens, audit posture) to feel native — anything that does not look like the rest of GoA web reads as foreign and lowers trust.

Two distinct jobs run in the same product:

- **Free Agent** — drop in a task, pick a model and a classification, watch an agent iterate, optionally interject, end with a final report. This is the everyday surface.
- **Workflow Canvas** — drag agents, functions, tools, and notes onto a Vue Flow canvas to compose a multi-stage workflow, then save, version, execute, and inspect results.

Cross-cutting jobs: profile / saved prompts / favourite workflows; a six-tab Admin console (Dashboard, Audit Log, PII Detections, Model Registry, Sessions, Health) for owners.

## Product Purpose

ABC lets Alberta ministry staff safely compose agentic LLM workflows against an approved model registry, with PII scanning, classification gating, ministry scoping, and an immutable audit trail. The frontend is a pure presentation layer — no secrets, no orchestration — over a thick Node backend that runs the iteration loop and streams SSE events back to the canvas.

Success looks like: a policy analyst can describe a task in plain language, pick "Claude Sonnet" and "Protected B", hit Start, and watch a structured timeline of thinking, tool calls, and outputs unfold — confident the right guardrails are enforced and that an auditor could later replay every decision the system made on their behalf.

## Brand Personality

Three words: **trustworthy, plain-spoken, capable.**

Voice/tone: senior public service. Direct, calm, accurate. No hype, no surprises, no marketing energy. Errors are honest and specific. Confirmations don't celebrate; they just confirm. It should feel like the rest of the Alberta.ca service estate — not like a consumer SaaS dashboard, not like a research lab interface.

Emotional goal at peak moments (Run, Stop, Delete, classification mismatch): reassurance. The user should never feel "did that work?" — state is always visible, actions are reversible where possible, and irreversible ones are confirmed in plain language.

## Anti-references

This should NOT look like:

- **OpenAI Playground / Anthropic Workbench** — too developer-toolkit, too dark-mode-default, too token-counter-as-vibe.
- **n8n / Make / Zapier** — too colourful, too node-soup, too consumer-prosumer.
- **Linear / Vercel / Supabase dashboards** — too startup-cool, too gradient-and-glassmorphism, wrong register for government.
- **Salesforce / ServiceNow admin** — too dense, too form-heavy, too 2010s.
- **Internal "engineer-coded" Bootstrap admin** — grey, generic, no design system rigour.

Specifically forbidden patterns (impeccable absolute bans):

- Side-stripe accent borders on cards.
- Gradient text.
- Glassmorphism as default.
- Hero-metric template (big number / small label / accent).
- Identical card grids repeated endlessly.
- Modals as first thought for in-context tasks.

## Design Principles

1. **GoA-native first.** When a `goa-*` web component exists for the job, use it. Hand-rolled Tailwind is a last resort, and when it lands it must use design-token CSS variables, not literal Tailwind palette colors.
2. **Visible state, audit-friendly.** Status, classification, ministry, dirty-state, and PII-blocked counts should always be one glance away, because that's what a reviewer will ask first. Never hide compliance signal behind hover.
3. **Senior public-service voice.** Microcopy is short, factual, and explains consequences in plain language. No exclamation marks. No "Oops!". Errors name what failed and what to do next.
4. **Hierarchy before decoration.** Pages have one obvious primary action and one obvious primary heading. Density is earned by data, not by chrome. Repeated bordered containers are not hierarchy.
5. **Differentiate work modes.** Free Agent (live execution) and Workflow Canvas (visual composition) are different mental models. The shared shell stays consistent; the working surfaces should feel purpose-built, not interchangeable.

## Accessibility & Inclusion

- WCAG 2.1 AA, aligned to GoA accessibility expectations. AAA where reasonable on text content.
- All interactive targets ≥ 44×44px on touch surfaces.
- Visible, GoA-token focus rings on every interactive element (`:focus-visible`).
- Keyboard parity for every drag-drop interaction on the canvas; the mouse-only state is a known gap to close.
- `aria-live` regions for streaming SSE updates (status, iteration counter, reconnect notice).
- Plain-language status terms (not "needs_assistance" raw — render "Needs input").
- Reduced-motion respected for any future canvas animations.
- Colour is never the only signal — every status badge carries a label and an icon.
