---
id: T2
type: task
status: in_progress
blocked_by: [P1]
owner: lead
write_scope: docs/wayfinder/tickets/T2-install-verify.md
---

# T2 — Install and verify in DSH Desktop

## Question

Install the plugin into the `desktop` profile and verify it against the acceptance table, with the user's visual confirmation.

## Why it matters

A plugin that builds but does not install or render is not delivered. The panel UI cannot be fully verified from the shell; the user must look at it.

## Acceptance

- `plugin_manager` install/link result is recorded.
- The plugin row appears in Plugins; enabling does not crash the client.
- The `WebDev Viewer` guide capsule opens the tab.
- The functional checklist passes: arbitrary URL, interact, pick/quote, static preview/live reload, project runner, screenshot/console/network.
- Light/dark, 390px, zh/en checked.
- The user's visual confirmation is recorded; any remaining limitation is listed.
- Profile state is restored after testing.

## Progress (2026-11-17)

See [`docs/verification/2026-11-17-live.md`](../../verification/2026-11-17-live.md).

- Plugin loaded after restart; config entry `include:ui-webdev` present; client slot occupant `dsh-webdev-viewer` active.
- Real-browser mode attached to a dedicated Edge on port 9222; `webdev_tabs`/`webdev_navigate` work.
- Agent tools verified: snapshot, type, click, console, screenshot; network/scroll/press not individually exercised.
- Panel socket smoke test verified `pick-result` and `input` dispatch.
- Remaining: the user must open the panel and test human pointer/keyboard input, Pick → Add to input, docked-width readability, and latency. Static preview/live reload, runner and Electron are later phases.

## Resolution

<!-- Fill when closed. -->
