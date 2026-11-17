# dsh-webdev-viewer

A DeepSeek Harness (DSH) plugin for building and verifying web and Electron UIs **inside the right sidebar**, together with an agent.

> Status: **working prototype (v0.1.0-dev)**. It builds, links into the Desktop profile, and the core flow is live-verified: real-browser attach, snapshot/click/type/console/screenshot, panel input, element pick-to-quote, static preview with live reload, project runner, and a PNG screencast. Not yet released; style inspector, Electron attach, full test coverage, and the GitHub release remain.

## What it does

- Drive a real Chromium page from a right-sidebar tab: click, type, scroll, navigate, inspect.
- Let the user and the agent drive the **same page**; human clicks and agent actions hit the same CDP target.
- Select elements with hover/active outlines, then insert a structured reference into the DSH composer. The page-side picker also works from the **real browser window**.
- Preview a workspace folder over a token-gated loopback server and reload it when files change.
- Run a detected project dev server or an explicit command, stream logs, detect a localhost URL, and open it.
- Give the agent full page detail: DOM/ARIA snapshot with refs, console, network, screenshots (PNG or JPEG).
- Open any HTTP(S), `data:`, or `about:` URL, including loopback services.
- Mirror the page in a headed Chrome/Edge window over CDP.

## Architecture truth

The sidebar tab is a **live CDP view**: Chromium renders the page, and the tab displays lossless PNG
frames while forwarding trusted pointer/key events back to it. It is not a native browser surface.
The installed DSH plugin model renders a React slot and gives plugins no native `BrowserView`/`webview`;
the UI guidance also says not to serve an HTML page from the Host and embed it in an iframe. The shipped
`browser-view` tab has the same architecture. For native rendering and full browser chrome, use the
attached real browser window; the sidebar is the controller/mirror and the element-picking surface.

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
