---
id: R7
type: research
status: closed
blocked_by: []
owner: research-style
write_scope: docs/research/style-editing.md
---

# R7 — Temporary visual style inspector

## Question

How should the viewer implement a **temporary visual style inspector** on a picked element: live common-property edits, reset, and a structured change list that the agent turns into source edits — without the plugin writing source?

Cover at least:

- CDP commands for computed styles and stylesheets: `CSS.enable`, `DOM.getDocument`, `DOM.querySelector`, `CSS.getComputedStyleForNode`, `CSS.getMatchedStylesForNode`, `CSS.getInlineStylesForNode`, `CSS.setStyleTexts` / `CSS.setPropertyValue`, `Runtime.evaluate`.
- Applying a temporary override: inline `element.style` vs a plugin-owned `<style>` rule vs CDP CSS edits; which survives HMR/reload, which is reversible, how to reset one property/all.
- Capturing before/after values and the element identity (selector, fingerprint, box, page version).
- The property groups for the v1 panel (layout, spacing, typography, color, border, effects) and sensible controls/ranges.
- Source hints: stylesheet URL/line, matched rule, React/Vue component hints; what is reliable and what is not.
- Multi-element behavior: per-element edits vs a shared edit; what the quote should contain.
- UX: pick → style panel → live preview → "send to agent" (manual, no auto-send); reset; unsaved changes; reload behavior.
- Prior art: `@canglongcl/dsh-web-review` (MIT) does visual adjustments; inspect its published client bundle/types and document what to borrow, with license care.
- Risks: invalid values, `!important`, CSS custom properties, pseudo-elements, media queries, shadow DOM, cross-origin stylesheets.

## Why it matters

The user explicitly added visual CSS editing to v1. It must be a **code-first inspector that produces an agent request**, not a design canvas and not a direct source writer.

## Acceptance

A cited Markdown note at `docs/research/style-editing.md`:

- A concrete command sequence and data model for one edit and for a multi-property change list.
- A property/control table for the v1 panel.
- A quote format that preserves before/after values and element identity.
- A reset/reload/unsaved-change policy.
- A go/no-go for the P4 prototype and the top three risks.
- Source hints: what to show, what to omit, and why.

## Hints

- The `dsh-web-review` npm package is MIT; inspect its `lib/client-official.js`/README via jsDelivr. Do not copy code without attribution.
- Prefer `CSS.getComputedStyleForNode` for the initial values and `Runtime.evaluate`/inline styles for the temporary override; verify which is reversible and visible in the screencast.
- Keep the panel usable at 390px; do not build a full layers tree.

## Resolution

Resolved by [`docs/research/style-editing.md`](../../research/style-editing.md). **GO for P4, narrowly scoped.** Use inline CSSOM (`element.style.setProperty`) for the live preview; read computed values with `CSS.getComputedStyleForNode`; reset by restoring the original inline value/priority. A full reload loses every override — never auto-reapply. Keep P1's identity plus `backendNodeId`; re-verify fingerprint/computed values before send and block send on stale identity. The v1 panel exposes 26 allowlisted properties in six groups (layout, spacing, typography, color, border, effects), validated by `CSS.supports()` and a control-character/`url(`/`@import`/`expression(`/`!important` filter. The quote carries authored values (not just computed px) with source hints, `@media`/`!important`, a preview-lost marker when relevant, and the user's note; max 4 targets/12 edits; no auto-send, no source writes. Deferred: dimensions/position/z-index/overflow, font-family, transform/filter, custom properties, pseudo-elements, inspector stylesheet. P4 kill criterion: a token-heavy/Tailwind fixture quote must become a source change that reproduces the preview at another viewport.
