# dsh-webdev-viewer

A DeepSeek Harness (DSH) plugin for building and verifying web and Electron UIs **inside the right sidebar**, together with an agent.

> Status: **v0.1.0 preview**. It builds, links into the Desktop profile, and the core flow is live-verified: native Desktop sidebar webview, real-browser CDP attach, snapshot/click/type/console/screenshot, element pick-to-quote, static preview with live reload, project runner, and Electron/CDP attach. Not yet published. The native-webview agent bridge, style inspector, native network capture, and full upstream client test harness remain.

## What it does

- Mount a **native Electron webview** in the right sidebar on DSH Desktop (the same renderer bridge the shipped sidebar browser uses), with a CDP mirror fallback on the web.
- Drive a real Chromium page from the tab: click, type, scroll, navigate, inspect.
- Let the user and the agent drive the **same page** through the CDP tools when attached to the real browser; the native webview is the interactive Desktop surface.
- Select elements with hover/active outlines, then insert a structured reference into the DSH composer. The page-side picker works in the native webview and in the real browser window.
- Preview a workspace folder over a token-gated loopback server and reload it when files change.
- Run a detected project dev server or an explicit command, stream logs, detect a localhost URL, and open it.
- Attach to an Electron app's renderer over CDP with `webdev_electron_attach`; pair it with a `webdev_run` launch to capture main-process stdout/stderr via `webdev_logs`.
- Give the agent full page detail: DOM/ARIA snapshot with refs, console, network, screenshots (PNG or JPEG).
- Open any HTTP(S), `data:`, or `about:` URL, including loopback services.
- Mirror the page in a headed Chrome/Edge window over CDP.

## Architecture truth

DSH Desktop exposes a renderer-side browser bridge (`globalThis.dshDesktop.browser`) and enables
Electron's `<webview>` tag; the shipped sidebar browser uses the same pair. Our panel uses it to mount
a **real guest renderer in the sidebar**, so text, scrolling and input are native, not frames.

The CDP screencast remains the fallback for the web client (no Desktop bridge) and is still the
transport the agent tools use. The next step is a native-webview tool bridge so snapshot/click/type/
screenshot can target the guest the user is actually looking at; until then the agent's CDP attachment
is a separate, explicitly labelled surface.

## Known limitations

- **Native agent bridge pending (P5).** The native Desktop guest is interactive for the user and its
  picker works, but `webdev_snapshot/click/type/...` still target the CDP attachment. Use the Native/CDP
  switch to compare; P5 is the next correctness task.
- **Style inspector not in 0.1.** The panel picks elements and quotes them; temporary CSS editing is
  still planned (P4).
- **Electron is renderer attach only.** A debug port must exist at launch; native menus/dialogs/window
  chrome and main-process JavaScript are not reachable. Main-process text logs come from a
  `webdev_run` launch and `webdev_logs`.
- **Native network capture is limited.** The `<webview>` tag does not expose request/response events;
  CDP mode remains the full network path.
- **Web build has no native bridge.** It uses the CDP mirror; the native surface requires DSH Desktop.
- **Debug ports have no authentication.** They are local code execution; keep them loopback-only and
  close them when finished.

## Design direction

The leading candidate is a fork of [`@linxin666/dsh-client-ui-browser-view`](https://www.npmjs.com/package/@linxin666/dsh-client-ui-browser-view), which already provides a CDP-driven Chromium, a screencast panel, snapshot refs, screenshots, and console/network capture. We add human input forwarding, element picking, static preview/live reload, a project runner, and Electron attach.

See:

- [`docs/wayfinder/MAP.md`](docs/wayfinder/MAP.md) — the decision map and current frontier.
- [`docs/research/`](docs/research/) — cited research notes.
- [`docs/adr/`](docs/adr/) — architecture decision records.
- [`UPSTREAM.md`](UPSTREAM.md) — the upstream base, license findings, and attribution.

## Repository map

```
src/core/    CDP, tabs, actions, snapshots, screenshots, protocol
src/host/    browser service, routes, tools, preview server, runner, watcher
src/client/  right-sidebar tab, screencast, input, picker, logs, toolbar
src/shared/  wire types shared by both halves
docs/        wayfinder map, research, ADRs, plugin detail
locale/      en/zh UI copy
tests/       unit, integration, component tests
scripts/     build and packaging helpers
```

## Development status

- [x] Repository scaffold and decision map
- [x] Research round (DSH APIs, prior art, Pencil/pen.dev interactions, CDP input, preview, Electron)
- [x] Scope and license decisions (grilling round 1)
- [x] Fork spike: human input + element picker
- [x] Static preview + live reload (basic security tests pass)
- [x] Project runner (detection, logs, URL detection, stop)
- [ ] Temporary visual style inspector
- [ ] Electron attach
- [ ] Full test suite, docs/release, GitHub publication

## Development

Requires Node 24 and pnpm 11. In this workspace the bundled paths are available from `load_workspace_dependencies`; if `node`/`pnpm` are not on `PATH`, run pnpm as `node <pnpm.mjs>`.

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
npm pack --dry-run
```

The panel UI must be checked in the running DSH Desktop page; the repository tests cover the Host/CDP layers and the component logic. See [`docs/wayfinder/MAP.md`](docs/wayfinder/MAP.md) for the current state.

## License and attribution

The repository currently ships the Apache License 2.0 text because the upstream package's shipped `LICENSE` is Apache-2.0, even though its `package.json` and README badge say BSD-3-Clause. This discrepancy is tracked in [`UPSTREAM.md`](UPSTREAM.md) and must be resolved before the first release. See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).

## Contributing

Not open for contributions until the v0.1 scope is locked. The wayfinder map is the place to discuss decisions.
