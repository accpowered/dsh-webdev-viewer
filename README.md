# dsh-webdev-viewer

A DeepSeek Harness (DSH) plugin for building and verifying web and Electron UIs **inside the right sidebar**, together with an agent.

> Status: **research / prototype scaffold (v0.0.0-dev)**. This repository is not installable yet. The first working preview is planned for the end of Phase 2 in [`docs/wayfinder/MAP.md`](docs/wayfinder/MAP.md).

## What it aims to do

- Run a real Chromium page in a right-sidebar tab, not a screenshot poll.
- Let the user and the agent drive the **same page**: click, type, scroll, navigate, inspect.
- Select elements on the page and insert a structured reference into the DSH composer.
- Adjust common visual styles on a picked element with a live temporary preview; send the before/after change list to the agent, which edits the source.
- Preview a workspace folder as a static site and reload it when files change.
- Run a project dev server (Vite, Next, etc.) or attach to an Electron renderer over CDP.
- Give the agent full page detail: DOM/ARIA snapshot with refs, console, network, screenshots.
- Open any HTTP(S) URL, including loopback services.
- Float or fullscreen the tab, or mirror the page in a headed Chrome/Electron window.

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
- [ ] Research round (DSH APIs, prior art, Pencil/pen.dev interactions, CDP input, preview, Electron)
- [ ] Scope and license decisions (grilling round 1)
- [ ] Fork spike: human input + element picker
- [ ] Temporary visual style inspector
- [ ] Static preview + live reload
- [ ] Project runner + Electron attach
- [ ] Tests, docs, release

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
