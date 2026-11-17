---
id: R6
type: research
status: closed
blocked_by: []
owner: research-pencil
write_scope: docs/research/pen-dev-interactions.md
---

# R6 — Pencil/pen.dev interaction patterns

## Question

Which interaction patterns from Pencil/pen.dev should `dsh-webdev-viewer` borrow for "tell the AI how to change this", element selection, and generation tools, and which do not fit a code-first DSH plugin?

Investigate:

- The canvas + agent composer + toolbar layout, and how the user points at a specific area/element when prompting.
- "Prompt entire screens or specific parts directly in context", curated actions, and any select/annotate tool.
- Multi-agent (1–6 agents) and parallel generation; variants/exploration.
- Import an existing web page or Figma file; design-to-code / code-to-design; `.pen` open format, MCP/CLI/IDE integration.
- History, approvals, and how tool activity is shown.
- Onboarding/first-run flow and empty states.
- Anything about "selection" vs "generation" tools (e.g., select, frame, pen, text, component, shader) that maps to a webdev viewer.

## Why it matters

The user explicitly asked for Pencil-inspired interaction, not its rendering/design-file architecture. We need concrete patterns for: pick an element, tell the AI what to change, generate alternatives, and keep the human in control.

## Acceptance

A cited Markdown note at `docs/research/pen-dev-interactions.md`:

- A pattern table: **pattern / what Pencil does / applicability to us / v1, v2, or out**.
- Three concrete UI proposals for our viewer, each with the user flow and the agent/tool contract.
- At least one anti-pattern or mismatch (why a design-canvas idea does not map to code-first web dev).
- Sources: docs.pencil.dev pages, product page, reputable reviews; avoid copying marketing claims as facts.

## Hints

- Start at <https://docs.pencil.dev/>; likely pages: getting started, core concepts / AI agents, design ↔ code, canvas/tools, prompting.
- The product was formerly called Pencil and is now pen.dev; search both names.
- This is a design/interaction note, not a code prototype. P4/G2 will prototype the chosen interactions.

## Resolution

Resolved by [`docs/research/pen-dev-interactions.md`](../../research/pen-dev-interactions.md). Adopt: selection is the prompt's subject (never auto-send); Explain/Change chips (v1); stale-pick rebinding via fingerprint/pageVersion; no generate button in the toolbar; tool activity is inspectable and Stop is not rollback. Defer: two-direction variation comparison (needs clean-tree/baseline/diff policy). Avoid: canvas-as-product at 390px, same-task parallel agents on one tree, and any "design ↔ code sync" promise.
