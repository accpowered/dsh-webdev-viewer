# Changelog

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
