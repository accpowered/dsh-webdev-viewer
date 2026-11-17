# Wayfinder map conventions

This repository uses a local Markdown tracker for the [wayfinder](../../README.md) decision map because no GitHub issue tracker is configured yet. The files here are the canonical decision record until the GitHub repository and issues exist.

## Files

- `MAP.md` — the map: destination, notes, decisions so far, fog, out of scope, ticket index.
- `tickets/<id>-<slug>.md` — one decision/investigation ticket.

## Ticket format

```yaml
---
id: R1
type: research | prototype | grilling | task
status: open | in_progress | blocked | closed
blocked_by: [R2]
owner: null | agent-name
write_scope: docs/research/foo.md
---
```

The body has `## Question`, `## Why it matters`, `## Acceptance`, and `## Resolution` (empty until closed). A closed ticket records the answer in `## Resolution`, and the map's `## Decisions so far` gets one line linking to it.

## Rules

- A session claims a ticket by setting `status: in_progress` and `owner`, before doing the work.
- Research tickets may run in parallel and a session may resolve more than one research ticket.
- Grilling and prototype tickets are resolved one at a time and are HITL: the agent never answers the human's side.
- A ticket is unblocked when every `blocked_by` ticket is closed. The map's frontier is the open, unblocked, unclaimed tickets.
- Write scopes are advisory but disjoint: one ticket owns one file.
- The map is an index, not a store: the answer lives in the ticket, the map only gists it and links.

## Status vocabulary

- `open` — not started.
- `in_progress` — claimed.
- `blocked` — waiting on another ticket.
- `closed` — resolved; see `## Resolution`.
