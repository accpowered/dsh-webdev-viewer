---
id: T4
type: task
status: open
blocked_by: [G1, R1, R2, R3, R4, R5, R6, R7]
owner: null
write_scope: docs/spec.md, docs/adr/, GLOSSARY.md
---

# T4 — Locked spec and ADRs

## Question

Write the implementation spec from the map's decisions: feature list, tool schemas, protocol, routes, config, security, edge cases, test plan, and milestones. Record the hard-to-reverse choices as ADRs.

## Why it matters

The spec is the contract for implementation and review. Without it, the fork and the new features drift.

## Acceptance

- `docs/spec.md` covers: goals/non-goals, user flows, panel states, protocol v2, HTTP routes, tool schemas, config, security, failure modes, tests, acceptance criteria.
- ADRs exist for: CDP vs Electron webview, fork vs compose, picker-to-composer, preview server auth, Electron attach boundary.
- `GLOSSARY.md` has every resolved term.
- The spec is consistent with the research notes and the user's G1 answers.

## Resolution

<!-- Fill when closed. -->
