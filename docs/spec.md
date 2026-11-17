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

## 4. Panel protocol v2

The current upstream protocol is v1. P1 bumps it to **v2** and updates both halves together. A first frame with the wrong `v` closes the socket with code 1002.

### Commands (panel → host)

- `attach { sessionId? }` — subscribe this socket to a session's page.
- `select-tab { tabId }`
- `request-frame`
- `close-tab { tabId }`
- `input { event }` — one mouse/wheel/key/text/IME event; see §5.
- `pick { requestId, x, y }` — resolve the element at frame coordinates.
- `style { requestId, action: 'set' | 'reset' | 'reset-all', ref?, selector?, property?, value? }` — temporary style override (P4).
- `preview { path? }` / `run { kind, script? }` / `stop { runId? }` — optional panel-initiated Host actions; the same operations are agent tools. **TBD** whether these stay on the panel socket or use exact HTTP routes.

### Events (host → panel)

- `hello { state }`
- `state { tabs, activeTabId, running, mode, cdpEndpoint?, message? }`
- `frame { tabId, seq, width, height, data }` — base64 JPEG; latest-frame-wins.
- `action { trace }` — one-line agent action.
- `pick-result { requestId, element }` — element metadata; see §6.
- `style-state { requestId, properties, applied }` — computed/applied values (P4).
- `logs { runId, stream: 'stdout' | 'stderr', text, at }` (runner/Electron)
- `error { code, message }`

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
- Quote: `inputActions.insertQuote(text, summary)`; if it returns `false`, show an error (draft changed/locked) and keep the picks. The quote includes page URL, page version, each element's label/selector/fingerprint/box/source, and the user's note. It is **not auto-sent**.
- **Explain/Change chips** (R6, v1 small set): `Explain this` inserts a read-only-intent quote; `Change…` pre-fills a change request. The read-only badge is derived from the tools the agent actually called, not from which chip was pressed. A v2 `viewer_pick_request` lets the agent ask the user to pick.

## 7. Temporary style inspector (P4 / R7 pending)

- Picking an element opens a compact style panel with the **common visual set**: typography (font, size, weight, line-height, color), size/opacity, spacing, layout, border/radius, effects.
- Changes apply live as a plugin-owned temporary override (inline style or a marked `<style>`), not as source edits.
- Each change records `property`, `before`, `after`, and the element identity. A Reset control reverts one property or all; a reload clears the overrides.
- "Send to agent" inserts a quote with the element identity + the change list + the user's note; the plugin never writes source.
- **TBD (R7)**: inline style vs `CSS.setStyleTexts`; source hints; multi-element shared edits; invalid value handling; pseudo-elements/media queries.

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
2. P1: human input + pick→quote; geometry decision; latency numbers.
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
