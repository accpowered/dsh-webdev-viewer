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
- Style previews (`webdev_desktop_style`, the panel's style inspector) write runtime CSS only — never source: inline styles for the element, one marked stylesheet rule for a pseudo-element. Every agent-visible preview result carries `temporary: true`, the host state exposes `preview { active, count, elements }`, the status row has a permanent document-state marker styled like Live (gray dot + **Original**, blue dot + **Preview (n)**), hovering it highlights the touched elements through a closed shadow root, each adjustment emits one `action` trace with `tone: 'preview'` (blue footer row), and a reload/navigation/reset/detach must clear it.
- The client value imports must stay within the shell's frozen module table (`shared/web-platform.ts`). Cross-plugin value imports are forbidden; use Cordis services.
- Host imports of `@deepseek-ai/*` stay external; they resolve from the DSH installation.

## Security

- Panel and state routes are loopback-only; authenticate them with `ctx.connection.requestRejection` (the web server does not authenticate).
- Isolated mode launches a throwaway Chromium profile. `realBrowserEnabled` is an explicit opt-in; never silently fall back between modes. A downgrade is only ever the caller's explicit request — the panel's `open-isolated` command or the `webdev_open_isolated` tool — never something another tool does on its own, and asking for the carrier already selected must not relaunch it.
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
