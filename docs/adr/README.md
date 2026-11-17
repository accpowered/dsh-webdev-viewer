# Architecture decision records

One decision per file, numbered `NNNN-kebab-title.md`. Create an ADR only when all three are true:

1. **Hard to reverse** — changing it later has a meaningful cost.
2. **Surprising without context** — a future reader will ask "why this way?"
3. **A real trade-off** — there were genuine alternatives with specific reasons.

Otherwise record the decision in the map or the spec.

## Template

```markdown
# NNNN — Title

- Status: proposed | accepted | superseded by NNNN
- Date: YYYY-MM-DD

## Context

What forced a decision.

## Decision

What we chose.

## Alternatives

What we did not choose and why.

## Consequences

What becomes easier, harder, or impossible.
```

## Candidate ADRs

- 0001 — Use one CDP browser shared by user and agent, not an Electron webview plus a separate Playwright browser.
- 0002 — Fork `@linxin666/dsh-client-ui-browser-view` rather than compose three plugins or start clean-room.
- 0003 — Element picks are delivered as composer quotes, not automatically sent messages.
- 0004 — Static preview uses a per-preview loopback server with token/cookie auth, not a DSH path prefix.
- 0005 — Electron support attaches to the renderer over CDP; the native OS window is not embedded.
