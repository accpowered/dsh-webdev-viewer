# dsh-webdev-viewer

A DeepSeek Harness (DSH) plugin for building and verifying web and Electron UIs **inside the right sidebar**, together with an agent.

> Status: **v0.2.0 preview**. A native Desktop side-panel browser with element picking, numbered markers,
> notes, a temporary style inspector, static preview with live reload, project runner, Electron/CDP attach,
> local files opened from the address bar (served through the private preview server, because the Electron
> guest refuses `file:`), and agent tools that drive the same guest — including HiDPI CDP frames, an
> always-visible Original/Preview document state, element-hover highlights, and blue style-adjustment
> traces. Repository: <https://github.com/accpowered/dsh-webdev-viewer>.
> The copied upstream client UI suites are excluded from the release gate; core/Host tests pass.

## What it does

- Mount a **native Electron webview** in the right sidebar on DSH Desktop (the same renderer bridge the shipped sidebar browser uses), with a CDP mirror fallback on the web.
- Drive a real Chromium page from the tab: click, type, scroll, navigate, inspect.
- Let the user and the agent drive the **same page** through the CDP tools when attached to the real browser; the native webview is the interactive Desktop surface.
- Select elements with hover/active outlines and persistent numbered markers; add a note to the last pick and insert a structured quote into the DSH composer. The page-side picker works in the native Desktop guest and in the real browser window.
- Tweak common visual properties (`color`, background, font size, padding, margin, radius) live on the native guest, reset them, and send the temporary change to the agent as a quote. The agent can do the same preview itself with `webdev_desktop_style` (`get`/`set`/`reset`/`inspect`, any CSS property, parent or `::before`/`::after` layers, before/after values) — runtime styles only, never a source write. The status row always shows which document state you are looking at: gray dot + **Original**, or blue dot + **Preview (n)** while overrides are active; hovering the marker highlights the touched elements like DevTools does.
- Preview a workspace folder over a token-gated loopback server and reload it when files change.
- Open a **local HTML file** from the desktop view's address bar: paste a Windows path (`C:\site\guide.html`), a POSIX path, or a `file:` URL and press Enter. The desktop guest is an Electron `<webview>`, whose embedder refuses `file:` navigations (`ERR_FAILED`), so the host serves the file and its sibling assets from the same private preview server and the standard view renders it — the address bar keeps showing the path, not the loopback address. This route is panel-local: it needs no CDP tab, so it works while the real-browser endpoint is down (the CDP view keeps its own tabs). Only the person may open a file outside the workspace by default; the `allowAgentLocalFiles` switch (Plugins row config or the Web Extensions card) lets `webdev_navigate` reach outside it too.
- Run a detected project dev server or an explicit command, stream logs, detect a localhost URL, and open it.
- Attach to an Electron app's renderer over CDP with `webdev_electron_attach`; pair it with a `webdev_run` launch to capture main-process stdout/stderr via `webdev_logs`.
- Give the agent full page detail: DOM/ARIA snapshot with refs, console, network, screenshots (PNG or JPEG).
- Give the agent DOM truth: `webdev_measure` reports real `getBoundingClientRect()` boxes, computed styles, scroll boxes and the ancestor that actually clips an element, and `webdev_eval` runs one expression in the page — both in the same CSS space as a snapshot box and a screenshot clip, so a layout claim can be checked instead of guessed from pixels. A screenshot result now states its CSS viewport, captured region, page scroll and scale, and flags an image whose encoded size disagrees with the plan.
- Pre-declare the unattended downgrade with `fallbackOnUnavailable: "isolated"`: when the configured real browser is not there, the host switches to the isolated Chromium once and says so (`state.autoFallback`, an **Auto fallback** note in the status row, and `mode`/`autoFallback` in `webdev_tabs`), with the one-click way back intact. The default stays "report the classified failure and wait for an explicit switch".
- Open any HTTP(S), `data:`, or `about:` URL, including loopback services.
- Mirror the page in a headed Chrome/Edge window over CDP.
- Recover without opening a second browser window: when the configured real browser is unreachable, the tab shows the mode, the exact CDP target, the classified reason and time, plus **Retry** and an explicit **Open in isolated Chromium** action that renders the page in the panel. The same switch is available to the agent as `webdev_open_isolated` — the failed tool error names it as JSON `nextStep` — so an unattended session recovers in the same turn instead of waiting for a human click; calling it while the isolated browser is already the carrier keeps its open tabs instead of relaunching. A browser closed mid-session becomes a visible disconnect within about a second and re-attaches by itself when the endpoint answers again.

## Architecture truth

DSH Desktop exposes a renderer-side browser bridge (`globalThis.dshDesktop.browser`) and enables
Electron's `<webview>` tag; the shipped sidebar browser uses the same pair. Our panel uses it to mount
a **real guest renderer in the sidebar**, so text, scrolling and input are native, not frames.

The CDP screencast remains the fallback for the web client (no Desktop bridge) and is still the
transport for the `webdev_*` tools. The desktop guest has its own
`webdev_desktop_snapshot/click/type/press/scroll/console/network/style/screenshot/navigate` family,
routed through the panel socket; it must be hard-refreshed into the client before the first attach.
The mirror is HiDPI-aware: the panel sends its `devicePixelRatio` with the viewport, live frames are
captured at the panel's CSS size, and a settled page is upgraded to a device-scale still.

## Known limitations

- **Desktop tool bridge.** `webdev_desktop_navigate/snapshot/click/type/press/scroll/console/network/style/screenshot` target
  the native guest through the panel socket. A Host reload causes the panel to re-announce itself on the
  next socket open. The CDP family remains available for the separate real-browser attachment.
- **Style editing is native-only and element-scoped.** Six common properties are live-previewed in the
  native style panel, and `webdev_desktop_style` can set any property on the element the user picked (or
  the agent identifies); the CDP mirror has no style panel yet. A visual drawn by a child or
  pseudo-element (Bing's pill is one) still needs the right element picked, and the quote carries current
  values rather than a before/after diff.
- **Electron is renderer attach only.** A debug port must exist at launch; native menus/dialogs/window
  chrome and main-process JavaScript are not reachable. Main-process text logs come from a
  `webdev_run` launch and `webdev_logs`.
- **Native network capture is limited.** The `<webview>` tag does not expose request/response events;
  CDP mode remains the full network path.
- **The desktop guest cannot load `file:` URLs.** Its embedder refuses them, so a local page is
  served through the private preview server instead (panel address bar, or `webdev_navigate` for a
  workspace path). `webdev_desktop_navigate` says so instead of returning the raw Electron error.
- **Web build has no native bridge.** It uses the CDP mirror; the native surface requires DSH Desktop.
- **Debug ports have no authentication.** They are local code execution; keep them loopback-only and
  close them when finished.

## Design direction

Built on a fork of [`@linxin666/dsh-client-ui-browser-view`](https://www.npmjs.com/package/@linxin666/dsh-client-ui-browser-view) 0.4.19 (Apache-2.0). The fork adds a native Desktop `<webview>` surface via the same bridge the shipped sidebar browser uses, the desktop tool family, element picking with numbered markers and notes, a compact style inspector, preview/live-reload, a project runner, and Electron attach. The original CDP screencast remains the web fallback.

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

## Install (source)

The repository is source-first; build `lib/` and link the package into a DSH Desktop profile:

```sh
git clone https://github.com/accpowered/dsh-webdev-viewer.git
cd dsh-webdev-viewer
pnpm install
pnpm build
# add "dsh-webdev-viewer": "link:<absolute path>" to the profile package.json
# and "dsh-webdev-viewer" to dsh.profile.bundles, then restart DSH Desktop
```

A packed tarball is produced by `pnpm pack --pack-destination .tmp`. The npm registry package is not
published at this time.

## Development status

- [x] Repository scaffold and decision map
- [x] Research round (DSH APIs, prior art, Pencil/pen.dev interactions, CDP input, preview, Electron)
- [x] Scope and license decisions (grilling round 1)
- [x] Fork spike: human input + element picker
- [x] Static preview + live reload (basic security tests pass)
- [x] Project runner (detection, logs, URL detection, stop)
- [x] Native Desktop webview + desktop agent tools
- [x] Element markers, per-pick notes, compact style inspector
- [x] Electron renderer attach + main-process log workflow
- [x] GitHub publication and v0.2.0 release candidate
- [ ] Full upstream client UI test harness and npm registry publication

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

The repository is public. See [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`SECURITY.md`](SECURITY.md).
Reports and pull requests are welcome; keep the desktop/CDP boundary explicit and never commit
credentials or temporary debug keys.
