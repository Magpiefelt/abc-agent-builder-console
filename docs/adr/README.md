# Architecture Decision Records (ADRs)

This directory records the load-bearing architectural decisions behind the
ABC Agent Builder Console. Each ADR captures **what** was decided, **why**,
and **what we considered first** — so a future engineer (or auditor) can
understand the system's shape without grepping PR descriptions or chat
threads.

## Why ADRs

A normal codebase tells you what the system *is*. It rarely tells you what
it *isn't*, and why it isn't. When a year-later engineer asks "why don't
we use WebSockets?" or "why did we put orchestration on the server instead
of the client?" the answer often lives in the head of someone who has since
moved on. ADRs externalise that knowledge so the decision survives
turnover.

Reference: Michael Nygard's
[Documenting Architecture Decisions](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions),
which set the template most teams now use.

## Format

Each ADR is a Markdown file with this skeleton:

```
# ADR-NNNN: Short title

- **Status:** Accepted | Superseded by ADR-NNNN | Deprecated
- **Date:** YYYY-MM-DD
- **Deciders:** Names of the people who made the call

## Context
Why are we deciding this? What forces are at play?

## Decision
What did we decide? State it plainly.

## Consequences
What follows from the decision — both good and bad.

## Alternatives considered
What we looked at first and why we passed.
```

Keep ADRs **short** (one page is great, two is acceptable, four is too long).
The goal is durable institutional memory, not a design dissertation.

## When to write a new ADR

Write one when:

- A decision constrains future work (we picked X, so all future code must
  assume X).
- The decision is non-obvious — a reader looking at the code alone would
  ask "why is it like this?"
- The decision is **reversible-but-expensive** — switching feels like a
  6-month project.
- A previous ADR is being overturned.

Don't write one for:

- Tactical PRs ("we used `Map` instead of `Object` here").
- Code-style decisions covered by lint / formatter config.
- Decisions captured equivalently in `DESIGN.md` or `CLAUDE.md`.

## Numbering

ADRs are numbered sequentially from `0001`. Never reuse a number. If an
ADR is **superseded**, leave the original in place (status changed to
"Superseded by ADR-NNNN") and write a new one — never delete or rewrite
history.

## Index

| # | Title | Status | Date |
|---|-------|--------|------|
| [0001](0001-thin-client-thick-server.md) | Thin client, thick server | Accepted | 2026-05-22 |
| [0002](0002-vue-flow-canvas.md) | Vue Flow for the workflow canvas | Accepted | 2026-05-22 |
| [0003](0003-pgcrypto-encryption.md) | pgcrypto for at-rest secret encryption | Accepted | 2026-05-22 |
| [0004](0004-sse-over-websockets.md) | SSE over WebSockets for streaming | Accepted | 2026-05-22 |
| [0005](0005-ministry-scoping.md) | Ministry-scoped row-level data partitioning | Accepted | 2026-05-22 |

## Adding an ADR

1. Pick the next number in the index above.
2. Copy the format skeleton into `docs/adr/NNNN-short-title.md`.
3. Fill in Context, Decision, Consequences, Alternatives.
4. Add a row to the index table.
5. Open a PR linking the new ADR in the description.
