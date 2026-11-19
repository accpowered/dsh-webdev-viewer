# dsh-webdev-viewer — implementation spec (draft)

> Status: **draft**. Locked by [T4](wayfinder/tickets/T4-spec-adr.md) after R7 and the panel prototype. The [wayfinder map](wayfinder/MAP.md) is the authoritative decision record until then. Items marked **TBD** are decisions for P1/G2 or R7.

## 1. Goals and non-goals

### Goals

- A right-sidebar `WebDev Viewer` tab with a real Chromium page streamed from the Host over CDP.
- The user and the agent operate the **same page**: mouse, wheel, keyboard, IME, navigation, snapshots, screenshots.
- Any HTTP(S) URL opens, including loopback dev servers; no iframe/X-Frame-Options dependency.
- Pick an element (or several) and insert a structured quote into the DSH composer.
- Adjust common visual styles on a picked element with a live temporary preview; send the before/after change list to the agent, which edits source.
- Preview a workspace folder as a static site and reload it on file changes.
- Run a detected project dev server; attach to an Electron renderer and show its process logs.
- Float/fullscreen the tab; mirror the page in a headed Chrome/Electron window when a real window is requested.
- Open-source repository with tests, docs, license/attribution, and a release.

### Non-goals (v1)

- Replacing the shipped `browser` tab.
- Direct source writes from the style inspector; a full design canvas/layers tree; `.pen` format.
- OS-level Electron `BrowserWindow` embedding inside the sidebar.
- Multi-user collaboration, mobile apps, network body replay/HAR, general computer use.
- Full-page screenshot stitching (viewport/element capture only).

## 2. Public identities

| Item | Value |
|---|---|
| Package | `dsh-webdev-viewer` |
| Bundle row | `ui-webdev` |
| Tab kind | `webdev` |
| Tab type id / slot key | `dsh-webdev-viewer` |
| Locale namespace | `webdev` |
| Panel socket | `/api/dsh-webdev-viewer/socket` |
| Status route | `/api/dsh-webdev-viewer/state` |
| Tools | `webdev_*` |

The shipped `browser` kind and the upstream `browser-view` kind are never reused. `keepMounted` stays true; the panel never registers `main`/`sidebar.panellist`/`rightbar`.

## 3. Architecture

```
Agent tools ──► Host service ──► CDP ──► Chromium (isolated)
                    │                  ├─ attached Chrome (CDP)
                    │                  └─ Electron renderer (CDP)
                    ├── Panel WebSocket ──► sidebar tab (frames, input, picker, style, logs)
                    ├── Preview server (loopback, token/cookie, live reload SSE)
                    ├── Project runner (dev server logs/URL)
                    └── File watcher (preview root)
User ──► sidebar tab (pointer/keyboard) ──► CDP Input.*
```

- Host: `src/index.ts` + `src/host/`; owns the CDP session, tabs, tools, routes, preview, runner, watcher.
- Client: `src/client/`; renders frames/status/picker/style/logs; never speaks CDP.
- Shared: `src/core/`; `protocol.ts` is the single wire contract.

## 4. Panel protocol (v1, additive)

The current wire version stays **v1**. The input and pick commands are additive kinds; a future breaking change bumps the version and closes a mismatched first frame with code 1002.

### Commands (panel → host)

- `attach { sessionId? }` — subscribe this socket to a session's page.
- `select-tab { tabId }`
- `request-frame`
- `close-tab { tabId }`
- `input { event }` — one mouse/wheel/key/text event; see §5.
- `pick { requestId, x, y }` — resolve the element at frame coordinates (panel-side fallback picker).
- `pick-mode { enabled }` — install/toggle the page-side picker in the displayed tab. The page editor then picks clicks made in the real browser window as well as through the panel.
- `viewport { width, height, deviceScaleFactor? }` — render the page at the panel's content size so the frame is 1:1 instead of scaled. `deviceScaleFactor` is the panel's `window.devicePixelRatio` (1–3): the CSS viewport stays the panel size while captures render at that density. The frame's `width/height` stay CSS pixels; the encoded image may be larger, and a page that stops changing is upgraded to a device-scale still after `CRISP_FRAME_SETTLE_MS`.
- `reconnect` — retry the configured source once. The user's Retry; never switches the source.
- `open-isolated { url? }` — the user clicked "Open in isolated Chromium": switch the source to the browser the host launches itself and render the page here instead of asking for a manually started window. The new `mode` is pushed to every panel. The agent tool `webdev_open_isolated` calls the same Host method, so both callers switch identically; asking for the carrier that is already selected keeps the live browser and its tabs instead of relaunching them.
- `use-configured` — forget an explicit isolated/attached source and return to the profile's configured browser.
- `style-preview { keys }` — replace the panel's share of the temporary-style key set (`self|selector||property` strings). The host merges it with the agent tool's keys for the Preview state.
- `preview-reset` — drop every temporary-style key: the page was reloaded or navigated.
- `style { requestId, action: 'set' | 'reset' | 'reset-all', ref?, selector?, property?, value? }` — planned panel command for the CDP mirror; not implemented. The native style panel and `webdev_desktop_style` use `native-request` style ops instead.
- `preview`/`run`/`stop` remain agent tools for now; the panel's actions will call the same Host methods. **TBD** whether they need panel commands.

### Events (host → panel)

- `hello { state }`
- `state { tabs, activeTabId, running, mode, cdpEndpoint?, message?, lastError?, attempts?, isolatedAvailable?, realBrowserConfigured? }`
  - `lastError { code, message, at, reason?, endpoint?, remediation?, detail?, mode? }` — the classified last browser-source failure. A tab with no picture is always explainable from this field alone.
  - `attempts` — consecutive failed starts since the last live session (absent at zero).
  - `isolatedAvailable` — whether this host can launch an isolated Chromium; the panel only offers that action when true.
  - `realBrowserConfigured` — a real browser is configured although the isolated one is showing; the panel offers the way back.
  - `preview { active, count, elements }` — temporary runtime style overrides are applied to the visible page. `count` is the number of distinct elements in `elements` (selector + relation). The status row keeps the connection state (`Live`) and shows a permanent document-state marker in the same style: gray dot + **Original**, or blue dot + **Preview (n)** while overrides are active; hovering the marker draws a translucent box around each element. Reload/navigation/reset/detach clears it.
- `frame { tabId, seq, width, height, data }` — base64 PNG; latest-frame-wins. `width/height` are CSS pixels and the image may carry more (the panel's `deviceScaleFactor`); the panel lays the image out at the CSS size, so picks and input keep their coordinate space.
- `action { trace }` — one-line agent action. `tone: 'preview'` marks a temporary style adjustment (agent tool or panel inspector); the footer renders those rows in the Preview blue and the summary carries a compact before→after.
- `pick-result { requestId, element?, error? }` — element metadata; see §6.
- `pick-mode { enabled }` — acknowledgement that the page-side picker is on/off.
- `style-state { requestId, properties, applied }` — computed/applied values (P4, not implemented yet).
- `logs { runId, stream: 'stdout' | 'stderr', text, at }` (runner/Electron, not implemented yet)
- `error { code, message }`

### Unreachable sources (B1)

A source that cannot be reached is classified once, in the Host, and both the
panel and the agent read the same fields:

| `reason` | Meaning |
|---|---|
| `econnrefused` | Nothing listens on the loopback endpoint (never started, or closed). |
| `not_cdp` | Something answers, but it is not a DevTools endpoint. |
| `spawn_denied` | The OS refused the browser process (crashpad/ACL); the browser's own stderr rides `detail`. |
| `not_installed` | No Chrome/Edge binary is discoverable. |
| `timeout` | The endpoint accepted a connection but never finished the handshake. |
| `unknown` | Anything the Host cannot classify honestly. |

- A failed attach raises `RealBrowserUnavailableError`; its message ends with
  `{ code, endpoint, reason, remediation, nextStep }` as one JSON object, so a
  tool call is branchable without parsing prose and knows the action to take.
  `nextStep` names the explicit `webdev_open_isolated` tool. A failed isolated
  launch raises the same shape with `webdev.isolated_browser_unavailable`.
- `realBrowserEnabled` still never falls back on its own. The isolated browser is
  only selected by the explicit `open-isolated` command or the explicit
  `webdev_open_isolated` tool, and the resulting `mode` is visible in the status
  row (with `use-configured` as the way back). No ordinary tool turns a browser
  failure into a source switch on its own.
- `webdev_open_isolated { url? }` is that tool: it switches the source, returns
  `{ mode, switched, url?, tabs, activeTabId, summary }`, and opens `url` in the
  new browser when given. `switched` separates "the carrier changed" from "the
  isolated browser was already the carrier" (which keeps the live tabs). A host
  with no browser binary fails with `webdev.isolated_browser_unavailable` /
  `reason: "not_installed"` instead of succeeding silently or hanging.
- While a panel is open on a real browser, the Host probes the endpoint every
  `LIVENESS_INTERVAL_MS` (1 s, one short recheck before believing a failure).
  A closed browser becomes `webdev.real_browser_disconnected` with Reconnect; when
  the endpoint answers again the Host re-attaches without a tool call.

### Backpressure

The Host keeps at most one pending frame per tab; when a new frame arrives before the previous send, replace it. The panel drops frames whose `seq` is older than the last painted one. `Page.captureScreenshot` is used for explicit actions/screenshots, not for human feedback.

## 5. Interaction and geometry

- **Modes**: `interact` (default) forwards input; `watch` does not. Toolbar toggle; no input is forwarded while a modal/menu is open.
- **Viewport**: **TBD** between `fit-panel` (emulate the panel content size; default candidate), `1:1 scroll` (pinned 1280×800, panel scrolls), and `presets` (mobile/tablet/desktop). The upstream pinned 1280×800 makes text ~0.31× in a 300–500 px rail, which is unreadable. The decision must be made in P1 with a measured screenshot.
- **Coordinates**: map from the rendered image rect to frame CSS pixels; CDP input coordinates are CSS pixels. No DPR multiplication unless `Emulation.setDeviceMetricsOverride` changes the scale. The frame's `width/height` are authoritative.
- **Mouse**: `Input.dispatchMouseEvent` `mouseMoved`/`mousePressed`/`mouseReleased` with `button`, `buttons`, `clickCount`; wheel uses `mouseWheel` with `deltaX/deltaY`. Click focus/hover are real events (the upstream action layer already does this).
- **Keyboard**: `Input.dispatchKeyEvent` `keyDown`/`keyUp` with `key`/`code`/`windowsVirtualKeyCode`; printable text also uses `char` or `Input.insertText`.
- **IME**: composition updates use `Input.imeSetComposition`; committed text uses `Input.insertText`. The OS candidate window cannot be positioned at the page caret; the panel shows composition text in its own small overlay. Document this limit.
- **Focus**: enable focus emulation for the page (`Emulation.setFocusEmulationEnabled`) so typing works while the panel has focus.
- **Human/agent contention**: both drive the same page; there is no lock. Agent actions are traced; the panel shows them. A human click during an agent action is the user's decision.
- **Unsupported**: browser-level shortcuts (Ctrl+T/W), native IME candidate window, cross-origin iframe picking, canvas/WebGL content with no DOM element, native file dialogs.

## 6. Pick and annotation

### Pick result

```ts
interface PickedElement {
  pageVersion: number;          // incremented on navigation/DOM replacement
  selector: string;             // unique CSS selector
  fingerprint: string;          // tag + stable id/classes + text hash + DOM path hash
  tag: string;
  id?: string;
  classes?: string[];
  role?: string;
  name?: string;                // accessible name
  text?: string;                // bounded visible text
  box?: { x: number; y: number; width: number; height: number };
  source?: { file?: string; line?: number; component?: string }; // best-effort
}
```

- The panel intercepts pointer events in pick mode; the page must not receive the click (a pick on `Submit` must not submit a form).
- Hover draws a highlight overlay in the panel, not in the page.
- The Host resolves the element with `DOM.getNodeForLocation` + `Runtime.evaluate`; source hints are best-effort (`data-source`, React `_debugSource`, Vue component info).
- **Staleness is contractual**: if `pageVersion` changed, re-resolve by fingerprint; if exactly one match, rebind; otherwise mark stale and require a re-pick. Never send a bare selector without the fingerprint/page version.
- Multi-select keeps a list of picks; each has its own note.
- **P1 implementation status**: the panel keeps a multi-pick list, shows a pick bar with send/clear, and inserts the formatted quote through `inputActions.insertQuote`; the clipboard is the fallback when no composer seat is present. The page-side picker (adapted from the MIT `dsh-web-preview-panel` marking code) is toggled by `pick-mode`, draws hover/active outlines in the page, and sends picks from the **real browser window** through a CDP binding. Per-pick notes and Explain/Change chips are not implemented yet.
- Quote: `inputActions.insertQuote(text, summary)`; if it returns `false`, show an error (draft changed/locked) and keep the picks. The quote includes page URL, page version, each element's label/selector/fingerprint/box/source, and the user's note. It is **not auto-sent**.
- **Explain/Change chips** (R6, v1 small set): `Explain this` inserts a read-only-intent quote; `Change…` pre-fills a change request. The read-only badge is derived from the tools the agent actually called, not from which chip was pressed. A v2 `viewer_pick_request` lets the agent ask the user to pick.

## 7. Temporary style inspector (P4, native guest)

- Picking an element opens a compact style panel with the **common visual set**: `color`, `background-color`, `font-size`, `padding`, `margin`, `border-radius`.
- Changes apply live as a plugin-owned temporary override (`element.style.setProperty` on the native guest), not as source edits. The agent-side twin is `webdev_desktop_style { selector, action, property?, value? }`, which returns before/after values and `temporary: true`.
- Each change records `property`, `before`, `after`, and the element identity. A Reset control removes the inline property again; a reload or navigation clears every override.
- "Send to agent" inserts a quote with the element identity + the change list + the user's note; the plugin never writes source.
- Scope: native guest only (the CDP mirror has no style UI). The inspector is element-scoped: a visual the page draws with a child or pseudo-element needs that element picked. The agent tool goes further — `relation: parent`, `pseudo: ::before | ::after`, and `action: inspect` (probes self, parent and both pseudo-elements) — so a composite widget can be diagnosed and changed on the layer that really draws it. Pseudo overrides are one marked stylesheet rule, removed on reset/reload.
- While any override is active the status row shows a blue **Preview (n)** marker beside Live; when none is active it shows a gray **Original** marker (same dot/size/muted text, no border). `n` counts distinct elements (selector + relation), and hovering the marker draws a translucent DevTools-style box around each of them via a closed shadow root; the overlay never touches page styles or the DOM snapshot. The host state exposes `preview { active, count, elements }`; the marker clears on reset, reload, navigation, detach, or source reconfigure.
- Every adjustment also emits one `action` trace with `tone: 'preview'` (tool `style`, compact before→after), which the footer draws in the Preview blue. The panel inspector debounces keystrokes into one line per adjustment; Reset all is one line; the agent tool emits one line per set/reset.

## 8. Static preview, live reload, project runner

- Per preview, the Host starts a `node:http` server bound to `127.0.0.1` on a random port.
- The first request carries a one-time token; the server sets a unique `HttpOnly` cookie (`SameSite=Strict`, `Path=/`) and 303-redirects to a clean URL. **Every** preview byte requires the cookie (no public assets).
- The server serves only the selected preview root. Containment: decode once → reject backslash/NUL/`:`/trailing dot or space/Win32 device names → normalize `..` → lexical fence → `lstat` before `resolve` → canonical `contains`. Deny symlinks/junctions; refuse a drive root, the home directory, or a DSH-profile ancestor. The 23-case traversal table is a blocking test.
- MIME by extension (use `text/javascript`), directory index, SPA fallback, single-range 206/416, `If-Range`, `no-store`, cancellation/backpressure.
- HTML responses inject a same-origin `live.js` that opens an SSE channel (`generation` handshake, no `Last-Event-ID` replay) and reloads on change. CSS/JS are not transformed.
- Watcher: `fs.watch({recursive:true})` where supported (Windows/macOS), per-directory walks on Linux, poll fallback; ignore `node_modules`, `.git`, `dist`, `build`, `.next`, `out`, `coverage`, `target`, `vendor`, etc.; debounce 150–300 ms with a 1 s max wait.
- Runner: detect package manager/project type; run `<node> <pm-cli.js> run <script>` (never spawn a `.cmd` directly); stream logs; parse `http://localhost:PORT` from real Vite/Next/Nuxt/Astro/Angular banners; navigate the viewer; stop with terminate → wait → drain logs. `ctx.subprocess` is fine for hidden dev servers; a visible Electron window needs a direct Node spawn (the DSH Windows provider forces `windowsHide`).
- Cookie caveat: cookies are host-scoped, not port-scoped; use a unique preview cookie name, never log `Cookie`, and do not treat `SameSite=Strict` as a CSRF boundary on loopback.

## 9. Electron

- Renderer mirror + input + process logs only; no native-window embedding.
- The Host owns the launch: pass `--remote-debugging-port=0` on its own argv, parse `DevTools listening on ws://…` from stderr, then attach with the existing CDP client. Do not trust a template to forward the flag.
- The debug port is unauthenticated local code execution: loopback-only, never expose it.
- On Windows, a hidden child window may be throttled; launch visible with a direct Node spawn (not `ctx.subprocess`), and add `--disable-renderer-backgrounding`; use on-demand screenshots if frames are still sparse.
- Stop via `terminate()`/Node kill; `Target.closeTarget` is unreliable on Electron. Reconnect after restart; detach does not close an external browser.
- Document template differences (`electron .`, electron-vite, forge) and the packaged-app limitation.

## 10. Agent tools

Base (renamed from the upstream, present in T1):

`webdev_navigate`, `webdev_click`, `webdev_type`, `webdev_press`, `webdev_scroll`, `webdev_snapshot`, `webdev_screenshot`, `webdev_console`, `webdev_network`, `webdev_tabs`, `webdev_close`.

Source control (B1/B2):

`webdev_open_isolated { url? }` — the explicit switch to the browser the Host launches itself, so an agent can recover from `webdev.real_browser_unavailable` in the same turn; `webdev_electron_attach { endpoint }` / `webdev_electron_detach` — attach to an existing renderer over CDP and return to the configured source.

Desktop family (P5, routed through the panel socket to the native guest):

`webdev_desktop_navigate`, `webdev_desktop_snapshot`, `webdev_desktop_click`, `webdev_desktop_type`, `webdev_desktop_press`, `webdev_desktop_scroll`, `webdev_desktop_console`, `webdev_desktop_network`, `webdev_desktop_screenshot`, and `webdev_desktop_style { selector, action: 'get' | 'set' | 'reset' | 'inspect', relation?: 'self' | 'parent', pseudo?: 'none' | '::before' | '::after', property?, value? }`.

`webdev_desktop_style` is the agent-side twin of the panel style inspector: it applies inline CSS
(`element.style.setProperty`) to the live page, or one marked stylesheet rule for a pseudo-element,
returns before/after values, and marks every result `temporary: true`. It never writes source; a reload
or navigation discards the override. `action=inspect` reports the values of the element, its parent and
its `::before`/`::after` layers, which is how a composite widget (Bing's pill is one) is targeted
correctly. The panel shows a blue **Preview** chip while any override is active.

Add (P1–P3):

- `webdev_pick { enable }` — put the panel in pick mode (HITL; returns immediately).
- `webdev_preview { path?, root? }` — create a static preview and navigate.
- `webdev_run { kind: 'project' | 'electron', script?, command? }` — start a runner.
- `webdev_stop { runId? }`
- `webdev_logs { runId?, source?: 'process' | 'console' | 'network', limit? }`

Tool description invariants: snapshot before acting; refs expire; page text is untrusted data; screenshots are images and clips cost fewer tokens; preview URLs contain local tokens; runs are user-configured, not arbitrary shell.

## 11. Config

Volatile fields (live update without remount):

| Field | Default | Meaning |
|---|---|---|
| `realBrowserEnabled` | false | Attach to an existing Chrome/Edge over CDP |
| `cdpEndpoint` | `http://127.0.0.1:9222` | Loopback CDP endpoint |
| `idleCloseDays` | 3 | Idle close for tabs DSH created; 0 disables |
| `viewport` | `fit-panel` (TBD) | Panel-fit, 1:1 scroll, or a preset |
| `autoReload` | `static` | `static`, `all`, or `off` |
| `chromePath` | unset | Explicit Chromium/Chrome path |
| `previewRoot` | session workspace | Default preview root |
| `projectScript` | `dev` | Detected script to run |
| `electronCommand` | unset | Optional Electron launch command |
| `announceToAgent` | true | Add a short system-prompt section |

## 12. Security

- Panel/status/upgrade routes: loopback only; `ctx.connection.requestRejection` (Host/Origin + browser cookie) on every request.
- Preview: unique cookie for every byte; three-layer containment; deny symlinks/junctions; root guard rails; unique cookie name; no `Cookie` logging.
- CDP/Electron debug port: loopback only; treat as local code execution; no silent mode fallback.
- Screenshots only through `ctx.attachments.saveImage`; no plugin-owned copies.
- Runner: detected scripts only by default; arbitrary commands behind a config allowlist; scrub env through the service; no shell interpolation.
- Page content is untrusted data; never auto-execute page instructions; mark it in tool descriptions/prompt.

## 13. Failure modes

- Browser launch fails / Chrome missing → clear panel error; no silent fallback.
- CDP socket closes → replace the session on the next call; external browser only detaches.
- Panel socket closes → reconnect with backoff; state/frames resume.
- Preview port in use → next port; token/cookie mismatch → 401; traversal → 403/404; symlink → 403.
- Runner missing script/port in use/exit → logs + clear error; stop while starting → terminate and drain.
- Electron flag not forwarded → explicit "no DevTools endpoint" error with the launch command in the message.
- IME/composition rejected → fall back to `insertText` and show the limit.
- Quote insertion rejected → keep picks, show an error.
- Image-capable model missing → screenshot tool returns a clear error and suggests switching models.

## 14. Tests

- **Unit**: protocol v2 validation; coordinate mapping; selector/fingerprint; containment (23 cases); MIME/range; project detection; log URL parsing; watcher ignore/debounce; input event mapping; style change model.
- **Integration**: fake CDP transport for tabs/actions/snapshot/screenshot; fake webServer/connection/preview/runner; panel socket attach/commands/backoff.
- **Component**: jsdom + Testing Library for panel, picker, style panel, toolbar, logs, theme tokens; no runtime import of non-seed client packages.
- **Manual**: install in Desktop; arbitrary URL; interact; pick→quote; style→quote; static reload; Vite runner; Electron attach; light/dark; 390px; zh/en.
- **Dogfood**: use `webdev_*` on the preview to snapshot/click/screenshot/read_image.
- **CI**: typecheck, test, build, `npm pack --dry-run`.

## 15. Milestones

1. T1: fork builds, installs, view-only tab works (`webdev_*` tools, frames).
2. P1: human input + pick→quote; geometry decision; latency numbers. *(input and pick are built; live verification and geometry are pending a DSH restart.)*
3. P2: static preview + live reload + runner.
4. P3: Electron renderer attach + logs.
5. P4: temporary style inspector.
6. T3: docs, icon, detail page, release; GitHub publish.

## 16. Open items

- Viewport/geometry default (P1/G2).
- Style override mechanism and property set (R7/P4).
- Panel-initiated preview/run commands vs HTTP routes (P2).
- Visible Electron launch path (direct Node spawn vs a DSH seam change) (P3).
- Whether to add a header action/button as a second opening entry (G2).
- `webdev_reload` vs `webdev_navigate` action naming (T4).
