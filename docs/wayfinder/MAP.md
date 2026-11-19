# Wayfinder map: dsh-webdev-viewer

## Destination

A published, installable `dsh-webdev-viewer` v0.1: a DSH right-sidebar workbench where a user and an agent build and verify web and Electron UIs together. The page is a real, interactive browser; the agent can snapshot, act, read console/network, and see screenshots; the user can pick elements into the composer and adjust common styles with a temporary preview; local files preview and reload; any HTTP(S) URL opens; the repository is open source with tests, docs, and a release.

## Notes

- **Methodology baseline**: local copy of matt-skills `ver_1.3.1` (`mattpocock/skills` tag `v1.3.1`) at `C:\Users\accpo\wkp\code\261028_matt_skills_adoption\matt-skills\ver_1.3.1`. Follow `wayfinder`, `grilling`/`grill-me`, `research`, and `domain-modeling`.
- **Execution is carried into this map** (the user wants the plugin built, not only decided). Research tickets may run in parallel; grilling and prototype tickets resolve one at a time.
- **Environment**: DSH Desktop `0.2.2-rc.3`, Windows 11, Electron 44.7.0, Node 24.21.0, profile `desktop`, GUI `http://127.0.0.1:57841`.
- **Leading architecture**: fork `@linxin666/dsh-client-ui-browser-view` 0.4.19; single CDP browser shared by user and agent; add human input forwarding, pick/annotation, temporary style inspector, static preview + live reload, project runner, Electron attach, standalone-window options.
- **License finding confirmed**: upstream `package.json`/README say BSD-3-Clause, but the shipped `LICENSE` and the repository root `LICENSE` are Apache-2.0. Treat Apache-2.0 as governing; add `NOTICE` and Apache-2.0 §4(b) change notices; get the author's written answer before release. See `UPSTREAM.md`.
- **Dependency reality**: `dsh-web-review` 0.6.0 has no license field and no LICENSE file in its tarball — use it as **pattern reference only**, never copy code. `dsh-web-preview-panel` is MIT but iframe-based/dormant; patterns only.
- **Research correction**: tool-result images are supported by the DeepSeek adapter (`dsh-llm-deepseek/src/images.ts:49-50` allows images in user messages and tool results; `dsh-tool-fs/src/read-image.ts:200-204` returns text + image from a tool; `tool.call.images` renders settled image-bearing calls). The R1 caveat applies to assistant-authored images/non-image adapters, not to our screenshot tool.
- **Pencil/pen.dev inspiration**: selection is the prompt's subject, never auto-send; use Explain/Change chips; keep generation in the composer, not a toolbar button; variation intents are v2; avoid canvas-as-product in a 390px rail. See [`docs/research/pen-dev-interactions.md`](../research/pen-dev-interactions.md).
- **Geometry constraint (R3)**: the sidebar panel is ~300–500 px while the upstream pins a 1280×800 viewport, so text is ~0.31×. P1 must choose a panel-sized viewport, an expandable/fullscreen panel, or a headed-window fallback; do not ship an unreadable scaled frame.
- **Electron constraint (R5)**: renderer mirror + process logs only; own the launch and pass `--remote-debugging-port=0`; the debug port is unauthenticated local code execution. No native-window embedding.
- **Fallback if P1 misses the input-latency bar**: dual carrier (Electron webview for the human, CDP attach for the agent on the same renderer) is an architecture change; do not start it until P1 measures.
- **Style editor scope**: temporary overrides + structured before/after quote; common visual properties; live preview + manual send; **no direct source writes**.
- **Scaffold**: repository, README, license, notice, research tickets, and this map were created 2026-11-17.
- **First fork installed (2026-11-17)**: typecheck and build pass; the bundle is linked into the `desktop` profile. The install reports `restart-required` (`package-moved`), so the plugin is not live until DSH restarts. The first build is the upstream view-only layer; P1-P4 add input, picking, preview and style.

## Decisions so far

- [G1 — Round 1: scope, base, window, picker, license](tickets/G1-scope-license.md): Desktop-first; fork `browser-view`; floating/fullscreen + headed Chrome/Electron; Interact + Watch; multi-select + annotation + composer quote; Apache-2.0; Electron renderer attach + main-process logs; v1 includes a temporary style inspector; static preview/Vite/Next/Electron in scope.
- [R1 — DSH plugin APIs and constraints](tickets/R1-dsh-plugin-apis.md): theme tokens are `--dsw-*`; `ctx.fs.watch` is non-recursive; plugin routes must authenticate via `ctx.connection.requestRejection`; WS upgrades are exact-path; use `ctx.sidebarRight.openTab`, not private `openTabIn`.
- [R2 — Existing plugins and prior-art evaluation](tickets/R2-prior-art.md): fork `browser-view`; license conflict confirmed; `dsh-web-review` unlicensed (patterns only); live reload is new work; shipped browser is a fallback human carrier, not the agent page.
- [R3 — CDP screencast, input forwarding, screenshot, snapshot](tickets/R3-cdp-input.md): GO for P1 narrowly; input is an additive command; geometry is the product blocker; latest-frame-wins; no native IME candidate window; explicit cross-origin/canvas limits.
- [R4 — Static preview, live reload, project runner, security](tickets/R4-preview-live-reload.md): GO; per-preview loopback server with 303 + unique cookie for every byte; three-layer containment with 23 traversal probes; recursive watcher via fs.watch/per-dir/poll; Windows package managers need `<node> <pm-cli.js>`; `ctx.subprocess` hides Electron windows.
- [R5 — Electron attach over CDP](tickets/R5-electron-cdp.md): GO for renderer mirror + logs; own the launch with port 0; loopback-only RCE surface; Windows hidden-window throttling risk; no native window embedding.
- [R6 — Pencil/pen.dev interaction patterns](tickets/R6-pen-interactions.md): select-then-prompt; Explain/Change chips (v1); variation intents (v2); no generate button in the toolbar; never leave a dirty tree when comparing variants; stale picks must be re-resolved.
- [R7 — Temporary visual style inspector](tickets/R7-style-editing.md): GO for P4, inline CSSOM, 26 properties in six groups, backendNodeId identity, authored-value quote, no reload persistence, no auto-send/source writes.
- [B1 — Unavailable real browser](tickets/B1-real-browser-unavailable.md): a failed source is classified once in the host (`econnrefused` / `not_cdp` / `spawn_denied` / `not_installed` / `timeout` / `unknown`) and exposed as `lastError` + `attempts`; the panel renders a zero state with Retry and an explicit, user-clicked **Open in isolated Chromium** (no silent fallback; the mode change is visible and reversible); a real browser closed mid-session becomes `webdev.real_browser_disconnected` within ~2 s and re-attaches by itself when the endpoint answers.
- [B1 follow-up — mirror sharpness, agent style preview, Original/Preview state](tickets/B1-real-browser-unavailable.md): the CDP mirror takes the panel's `devicePixelRatio` with its viewport, no longer caps frames at 1280×800, and upgrades a settled page to a device-scale still; `webdev_desktop_style` gives the agent `get`/`set`/`reset`/`inspect` of any CSS property (including `relation: parent` and `::before`/`::after`) on the native guest as a runtime-only preview (`temporary: true`, no source writes); the status row carries a permanent document-state marker styled like Live — gray dot + **Original**, blue dot + **Preview** — driven by the host's `preview { active, count }` state and cleared on reset/reload/navigation/detach.
- [B2 — Agent-visible isolated fallback](tickets/B1-real-browser-unavailable.md): after a classified real-browser failure the agent switches with the explicit `webdev_open_isolated { url? }` and keeps working in the same turn — the panel's **Open in isolated Chromium** and the tool call one host method. The call is idempotent on the already-selected carrier (no relaunch, tabs kept), a failed launch reports `webdev.isolated_browser_unavailable` / `not_installed` instead of a silent success, and the failure JSON carries `nextStep` so nothing has to fall back on its own.

## Frontier

Open, unblocked, unclaimed tickets:

- T1 — Package, build, CI, license, attribution (in progress, lead)
- T4 — Locked spec and ADRs (draft written; finalize after G2)
- P1 — Fork + human input + element picker
- P2 — Static preview + live reload
- P3 — Electron attach

## Not yet specified

- Pencil-style Explain/Change chips and stale-pick rebinding in the panel (candidate v1; R6 proposes the contract).
- Viewport preset / panel geometry policy after the P1 measurement.
- Two-direction variation comparison (v2; needs clean-tree/baseline/diff policy).
- History/undo of agent actions in the viewer.
- Screenshot diff / visual regression.
- Accessibility and performance panels.
- Storybook / component-library awareness.
- Network body replay, request mocking.
- Collaboration / LiveShare.

## Out of scope

- Replacing the shipped `browser` tab or the built-in browser.
- Direct source writes from the style inspector; full design canvas, layers tree, or `.pen`-compatible format.
- OS-level Electron `BrowserWindow` embedding in the sidebar (no DSH plugin API).
- Multi-user live collaboration.
- Mobile app / native mobile preview.
- General-purpose computer use outside the web page.
- Full network response-body replay and HAR export.

## Tickets

| ID | Type | Title | Status | Blocked by | Owner | File |
|---|---|---|---|---|---|---|
| R1 | research | DSH plugin APIs and constraints | closed | — | research-dsh | [R1](tickets/R1-dsh-plugin-apis.md) |
| R2 | research | Existing plugins and prior-art evaluation | closed | — | research-prior | [R2](tickets/R2-prior-art.md) |
| R3 | research | CDP screencast, input forwarding, screenshot, snapshot | closed | — | research-cdp | [R3](tickets/R3-cdp-input.md) |
| R4 | research | Static preview, live reload, project runner, security | closed | — | research-preview | [R4](tickets/R4-preview-live-reload.md) |
| R5 | research | Electron attach over CDP | closed | — | research-electron | [R5](tickets/R5-electron-cdp.md) |
| R6 | research | Pencil/pen.dev interaction patterns | closed | — | research-pencil | [R6](tickets/R6-pen-interactions.md) |
| R7 | research | Temporary visual style inspector | closed | — | research-style | [R7](tickets/R7-style-editing.md) |
| G1 | grilling | Round 1: scope, base, window, picker, license | closed | — | lead | [G1](tickets/G1-scope-license.md) |
| G2 | grilling | Panel UX after the first prototype | completed | — | lead | [G2](tickets/G2-panel-ux.md) |
| P1 | prototype | Fork + human input + element picker | in_progress | G1, R3 | lead | [P1](tickets/P1-fork-input-picker.md) |
| P2 | prototype | Static preview + live reload | in_progress | — | lead | [P2](tickets/P2-preview-live-reload.md) |
| P3 | prototype | Electron attach | in_progress | — | lead | [P3](tickets/P3-electron-attach.md) |
| P4 | prototype | Visual style inspector prototype | completed | — | lead | [P4](tickets/P4-style-inspector.md) |
| P5 | feature | Native webview agent bridge | completed | — | lead | [P5](tickets/P5-native-agent-bridge.md) |
| T1 | task | Package, build, CI, license, attribution | in_progress | — | lead | [T1](tickets/T1-repo-build-ci.md) |
| T4 | task | Locked spec and ADRs | open | G1, R1–R7 | — | [T4](tickets/T4-spec-adr.md) |
| T2 | task | Install and verify in DSH Desktop | in_progress | P1 | lead | [T2](tickets/T2-install-verify.md) |
| T3 | task | Docs, packaging, release, GitHub publish | in_progress | — | lead | [T3](tickets/T3-docs-release.md) |
| B1 | task | Sidebar blank when the configured real browser is unavailable | closed | — | lead | [B1](tickets/B1-real-browser-unavailable.md) |
