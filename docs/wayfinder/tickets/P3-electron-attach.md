---
id: P3
type: prototype
status: open
blocked_by: [G1, R5]
owner: null
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

## Resolution

<!-- Fill when closed. -->
