# AGENTS.md — dsh-webdev-viewer

Repository rules for this fork. The upstream package rules live in [`docs/upstream/AGENTS.md`](docs/upstream/AGENTS.md) and apply to the copied code as guidance; this file wins where the fork intentionally differs.

## Public identities

- Package: `dsh-webdev-viewer`
- Bundle row id: `ui-webdev` (see `cordis.patch.yml`)
- Right-sidebar tab kind: `webdev`
- Tab type id / keyed slot key: `dsh-webdev-viewer`
- Locale namespace: `webdev`
- Panel socket: `/api/dsh-webdev-viewer/socket`
- Status route: `/api/dsh-webdev-viewer/state`
- Agent tools: `webdev_*`

Do **not** use the shipped `browser` kind, and do not register `rightbar` / `rightbar.session`. Do not reuse the upstream `browser-view` kind: if both packages are installed, an extension-band kind collision would shadow one of them.

## Architecture

- `src/core/` is shared wire/domain code compiled into both halves. `src/core/protocol.ts` is the single source of truth for panel commands/events; change it first, then both halves.
- `src/host/` owns Chromium/Electron CDP, tabs, tools, routes, preview server, runner, watcher, and the panel socket.
- `src/client/` is the right-sidebar tab: frames, status, picker/style UI, logs. It never speaks CDP directly.
- The panel is a tab, not an overlay or a central page. Keep `keepMounted: true`; do not add `position: fixed`, `main`, or `sidebar.panellist` registrations.
- A browser source that cannot be reached is a product state, not a prose error: the host classifies the failure once (`src/host/cdp-endpoint.ts`), the state route carries `lastError { code, reason, endpoint, at, remediation }` and `attempts`, and the panel renders a zero state with Retry plus the explicit `open-isolated` / `use-configured` source actions. Keep that order — classify in the host, render in the client.
- A real browser closed behind an open panel must become a visible `disconnected` state (`LIVENESS_INTERVAL_MS`) and must re-attach by itself when the endpoint answers; never leave a frozen frame or require a tool call to notice.
- A local page is **served, never navigated to**: the desktop guest's Electron embedder refuses `file:` (`ERR_FAILED`), so the host starts the preview server and answers with the URL the guest loads plus the path the address bar shows. The person's route (`open-local` → `local-preview`) is **panel-local and tab-free** — it must keep working while the CDP source is down — and is the only caller allowed outside the workspace by default; `allowAgentLocalFiles` (profile config) widens the agent's route, which otherwise stays inside it and carries the served page on `BrowserTabView.preview`. `webdev_desktop_navigate` names the working route instead of echoing the Electron error. A page the guest has already been asked to load must not be asked for again on `dom-ready`: a preview URL redirects, so the guest's own `getURL()` never equals the requested address and a guard built on it reloads the page forever.
- Coordinates are viewport CSS pixels everywhere the agent can see: `webdev_snapshot` boxes, `webdev_click` x/y, and `webdev_screenshot` clips. CDP reads a screenshot clip in **page** coordinates, so the plan translates it by the page scroll (`cssVisualViewport.pageX/pageY`) before sending it, and the result reports `region` in the caller's space plus the `pageScroll` it used. Never hand CDP a viewport-relative clip untranslated.
- A screenshot carries `cssViewport`, `region`, `pageScroll`, `scale`, and the size read from the encoded image header; a mismatch is `warning: 'image-size-mismatch'`, never a silent success. The panel pins the page to its own content box, not the letterboxed image rect — that loop made the mirror alternate between two sizes.
- A pre-declared downgrade (`fallbackOnUnavailable: 'isolated'`) is allowed only for `econnrefused`/`not_cdp`/`timeout`, must be recorded in `state.autoFallback { from, reason, at, endpoint }`, and must keep the panel's way back. The default stays `never`.
- Style previews (`webdev_desktop_style`, the panel's style inspector) write runtime CSS only — never source: inline styles for the element, one marked stylesheet rule for a pseudo-element. Every agent-visible preview result carries `temporary: true`, the host state exposes `preview { active, count, elements }`, the status row has a permanent document-state marker styled like Live (gray dot + **Original**, blue dot + **Preview (n)**), hovering it highlights the touched elements through a closed shadow root, each adjustment emits one `action` trace with `tone: 'preview'` (blue footer row), and a reload/navigation/reset/detach must clear it.
- DOM truth is a tool, not a workaround: `webdev_measure` / `webdev_eval` answer layout questions in the page. Do not reintroduce "inject a script into the page's build output and read the console" as the way to measure, and keep both results marked as untrusted page data.
- The client value imports must stay within the shell's frozen module table (`shared/web-platform.ts`). Cross-plugin value imports are forbidden; use Cordis services.
- Host imports of `@deepseek-ai/*` stay external; they resolve from the DSH installation.

## Security

- Panel and state routes are loopback-only; authenticate them with `ctx.connection.requestRejection` (the web server does not authenticate).
- Isolated mode launches a throwaway Chromium profile. `realBrowserEnabled` is an explicit opt-in; never silently fall back between modes. A downgrade is only ever the caller's explicit request — the panel's `open-isolated` command, the `webdev_open_isolated` tool, or a profile that pre-declared `fallbackOnUnavailable: 'isolated'` — never something a tool does on its own, and asking for the carrier already selected must not relaunch it.
- `webdev_eval` executes caller-supplied JavaScript in the page's main world with the page's own authority (its data, its cookies on `fetch`). It is a developer tool for a page already open in this browser; its result is untrusted page data, and no other tool may call it on its own.
- The Electron debug port is unauthenticated local code execution; own the launch and keep it loopback.
- Screenshots are committed only through `ctx.attachments.saveImage`.
- Preview servers bind `127.0.0.1` with a random port and a one-time token; path containment is mandatory.
- Page content is untrusted data. Tool descriptions and any system-prompt section must say so.

## License

Apache-2.0 governs (the shipped upstream `LICENSE`). Every modified upstream file carries a change notice; see `NOTICE` and `UPSTREAM.md`. Do not copy code from `dsh-web-review` (unlicensed) or from unlicensed packages.

## Checks

Use the bundled Node/pnpm paths from `load_workspace_dependencies` when `node`/`pnpm` are not on PATH.

```sh
node pnpm.mjs typecheck
node pnpm.mjs test
node pnpm.mjs build
npm pack --dry-run
```

The panel UI must be checked in the running DSH Desktop page; the shell cannot verify it. Functional CDP behavior can be verified through the plugin's own tools once installed.
