---
id: R5
type: research
status: closed
blocked_by: []
owner: research-electron
write_scope: docs/research/electron-cdp.md
---

# R5 — Electron attach over CDP

## Question

How can the plugin show and drive an Electron app's renderer in the sidebar, and what are the limits?

Cover at least:

- Launching Electron with `--remote-debugging-port`; how the flag reaches the renderer (main-process `app.commandLine`, CLI args, `electron-vite`/`electron-forge` templates).
- The CDP HTTP endpoints `/json/version` and `/json/list`; which target is the app window; multiple windows; devtools protocol version.
- Attaching the existing `browser-view` CDP session to an Electron target; `Target.setDiscoverTargets` / `attachToTarget({flatten:true})`; screenshots/input/network on Electron.
- Main-process stdout/stderr logs: capturing via `ctx.subprocess`, crash/restart, app quit.
- Renderer reload vs full app restart; HMR; source maps.
- Reconnection when the app restarts; port collision; security (loopback, no auth on CDP).
- What is impossible from a DSH plugin: embedding the native OS window in the sidebar, controlling the main process UI, packaged-app restrictions.

## Why it matters

"乃至 Electron app" is a user requirement. The realistic answer is renderer attach + process logs, not native-window embedding; the research must make that boundary explicit.

## Acceptance

A cited Markdown note at `docs/research/electron-cdp.md`:

- A step-by-step attach sequence with exact URLs/commands.
- A target-selection rule and a reconnect strategy.
- A log/error handling design.
- A compatibility table for common templates.
- A clear "cannot do" list and the fallback UX.
- A go/no-go for the P3 prototype.

## Hints

- Prefer a minimal Electron app (one BrowserWindow, one HTML page) for the spike.
- Check Chrome's 136+ remote-debugging behavior and Electron's `--remote-debugging-port` semantics.
- Do not install or launch the user's real Electron apps for this ticket.

## Resolution

Resolved by [`docs/research/electron-cdp.md`](../../research/electron-cdp.md). **GO for P3** scoped to renderer mirror + input + process logs. Own the launch: pass `--remote-debugging-port=0` on our own argv and parse `DevTools listening on ws://…` from stderr; do not trust a template to forward the flag. Attach uses the existing CDP client unchanged. The port is unauthenticated local code execution — loopback only. On Windows, `ctx.subprocess` may start the app window hidden and Chromium may throttle frames; mitigate with `--disable-renderer-backgrounding` and on-demand `Page.captureScreenshot`. No native-window embedding, no main-process UI control, no attach without a launch-time switch; `Target.closeTarget` is unreliable on Electron, so stop via `terminate()`.
