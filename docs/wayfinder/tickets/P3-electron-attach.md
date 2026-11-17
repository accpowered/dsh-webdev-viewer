---
id: P3
type: prototype
status: in_progress
blocked_by: []
owner: lead
write_scope: src/host/electron/, tests/electron/
---

# P3 — Electron attach

## Question

Can the viewer attach to an Electron app's renderer over CDP, show it in the sidebar, and capture the app's process logs, with a clean stop/restart?

Build a throwaway spike that:

1. Starts a minimal Electron app with `--remote-debugging-port` (or attaches to one already started).
2. Polls `/json/version` and selects the app window target from `/json/list`.
3. Reuses the existing CDP session to stream frames, forward input, and read console/network.
4. Captures the main-process stdout/stderr into the log drawer.
5. Stops the app, detaches, and reconnects after a restart.

## Why it matters

The user explicitly wants Electron app development. The realistic boundary (renderer attach, not native-window embedding) must be proven early so the UX and docs are honest.

## Acceptance

- A recorded walkthrough with a minimal Electron app: window visible in the sidebar, click/type works, renderer console visible, main-process log visible, stop works.
- A reconnect test after killing/restarting the app.
- A compatibility note for `electron-vite`, `electron-forge`, and a plain `electron .` launch.
- A clear list of what is impossible (native window embedding, main-process UI control, packaged apps without a debug port).
- A go/no-go note in `## Resolution`.

## Hints

- Start with a one-file Electron app; do not use the user's real project for the spike.
- Check how the flag reaches the renderer in each template; some dev runners swallow extra args.
- Keep the CDP endpoint loopback-only; treat the debug port as a local code-execution surface.
- The upstream `browser-view` has an attach mode; reuse it rather than writing a second CDP client.

## Progress (2026-11-17)

- Added `webdev_electron_attach` / `webdev_electron_detach`. They switch the existing service to a validated loopback CDP endpoint at runtime and back to the configured source; the panel, snapshot/click/type/console/network/screenshot path is unchanged.
- Verified the endpoint switch against the attached Edge CDP endpoint (one adopted page target survived attach/detach). This proves the attach plumbing, not an actual Electron app.
- No standalone Electron binary was found in the workspace/installed programs, so the minimal Electron app, window visibility, main-process log lane, restart/reconnect, F12 contention, and orphan check remain unverified.
- Intended workflow for a real app: start it with `--remote-debugging-port=9222`, optionally via `webdev_run` with an explicit command so main-process stdout/stderr appears in `webdev_logs`, then `webdev_electron_attach` endpoint `http://127.0.0.1:9222`. The panel mirrors the renderer, not the native window; main-process JS is not reachable on this port.

## Resolution

<!-- Fill when closed. -->
