# Changelog

## v0.1.2 (2026-11-18)

- Real-browser failures are classified once in the host: `webdev.real_browser_unavailable` with `endpoint`, `reason` (`econnrefused`, `not_cdp`, `spawn_denied`, `not_installed`, `timeout`, `unknown`), `remediation`, and the underlying text; tool errors carry the same fields as JSON and `/api/dsh-webdev-viewer/state` exposes `lastError { code, message, at, reason, endpoint, remediation, detail }` plus `attempts`.
- The panel renders an actionable zero state instead of a blank tab: configured mode, exact CDP target, last failure reason and time, **Retry**, and an explicit user-clicked **Open in isolated Chromium** that restores the last page here — `realBrowserEnabled` still never falls back on its own, and `use-configured` goes back.
- A real browser closed behind an open panel is detected within ~1 s (`webdev.real_browser_disconnected`), the panel shows Reconnect, and the viewer re-attaches by itself once the endpoint answers.
- CDP mirror is HiDPI-correct: the panel declares its `devicePixelRatio` with its viewport, live frames are no longer capped at the old 1280×800 default, and a page that stops changing is upgraded to a device-scale still (`clip.scale`), so reading and layout work is sharp on 1.5x/2x displays. The wire keeps CSS-pixel frame sizes, so picks and input mapping are unchanged.
- Isolated launches report `spawn_denied` with the browser's crashpad/ACL stderr instead of a silent exit; spawn failures keep working without a stderr pipe (the profile's own `stderr.log` is read on failure).
- `webdev_desktop_style` gives the agent the same live preview the panel's style inspector has: `get`/`set`/`reset` of any CSS property on the element the user picked in the desktop webview, with before/after values and an explicit `temporary: true`. It writes runtime inline styles only — no source file, no commit, and a reload/navigation discards it.
- `webdev_desktop_*` calls now fail immediately with `webdev.panel_not_mounted` when no mounted panel owns the native guest, instead of waiting 30 s for a detached socket.
- Tests: 236 Host/core tests pass; the copied upstream client suites are excluded because their standalone test-only peers are not installed.

## v0.1.1 (2026-11-17)

- Native Desktop sidebar browser via the DSH `dshDesktop.browser` bridge and Electron `<webview>`; native rendering, scrolling, input, address bar, history and reload.
- `webdev_desktop_navigate/snapshot/click/type/press/scroll/console/network/screenshot` drive the native guest the user sees.
- Persistent numbered element markers and per-pick notes; the pick quote stays editable in the composer.
- Compact native style inspector for color, background, font size, padding, margin and border radius; temporary preview, reset, and an agent quote.
- Static preview with token-gated loopback server and live reload; project detection/runner with logs and URL detection.
- CDP browser tools, real-browser attach, Electron renderer attach via `webdev_electron_attach`, and CDP fallback for the web client.
- Tests: 216 Host/core tests pass; the copied upstream client suites are excluded because their standalone test-only peers are not installed. `pnpm pack` includes lib, src, docs, licenses and the attribution files.

## v0.1.0 (2026-11-17)

- Initial public repository: fork of `@linxin666/dsh-client-ui-browser-view` 0.4.19 with Apache-2.0 notices, CDP tools, preview server, runner, and Electron attach scaffolding.
