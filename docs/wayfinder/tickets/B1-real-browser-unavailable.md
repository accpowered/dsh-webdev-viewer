---
id: B1
type: task
status: closed
blocked_by: []
owner: lead
write_scope: src/host/, src/client/, src/core/protocol.ts
---

# B1 — Sidebar renders nothing when the configured real browser is unavailable

## Question

When `realBrowserEnabled: true` and the configured CDP endpoint has nothing behind it, what should the `webdev` right-sidebar tab show and return — and how does the agent tell "the user did not start a browser" apart from "this environment refuses to start one"?

## Symptom

Reported from a real frontend-debugging session (DSH Desktop 0.2.2.0, Windows 11, profile `desktop`, GUI `http://127.0.0.1:57388`, `dsh-webdev-viewer` 0.1.1, config `ui-webdev.realBrowserEnabled: true` — `cordis.patch.yml:80-84`).

1. The `webdev` tab is **completely blank**: no frame, no status row, no error text. The user sees an empty panel and cannot tell whether the plugin loaded.
2. Every tool call fails with the same raw string:

   ```
   Error: Could not connect to the real browser at http://127.0.0.1:9222: fetch failed.
   Start Chrome/Edge with --remote-debugging-port and a non-default --user-data-dir.
   Chrome 136+ ignores remote debugging switches on its default data directory.
   No isolated-browser fallback was attempted.
   ```

   Reproduced on `webdev_tabs` and `webdev_navigate`.
3. `webdev_desktop_snapshot` / `webdev_desktop_navigate` fail with
   `Error: the native view did not answer snapshot within 30s` / `... navigate within 30s`
   (see B1-a below).
4. Once Chrome 157 was started manually with `--remote-debugging-port=9222 --user-data-dir=<dedicated>` , `webdev_tabs` immediately returned the adopted tab and the sidebar mirrored the page. **The viewer pipeline works; only the unavailable-endpoint path is broken.**

## Evidence: the documented remediation is not always executable

The error text tells the reader to start a browser with `--remote-debugging-port`. In this environment that instruction cannot be followed from an agent shell:

```
[1118/183210.382:ERROR:third_party\crashpad\crashpad\client\crashpad_client_win.cc:431] OpenProcess: 拒绝访问。 (0x5)
[1118/183210.421:ERROR:third_party\crashpad\crashpad\client\crashpad_client_win.cc:145] crash server failed to launch, self-terminating
```

Chrome exits immediately, `chrome procs: 0`, nothing listens on 9222. Re-running the *identical* launch with a widened sandbox permission (`danger-full-access`) started it at once (`DevTools listening on ws://127.0.0.1:9222/...`). So the failure mode is environmental and silent: the agent sees the same `fetch failed` as when the user simply has no browser open, and has no way to report the real cause.

Also observed: closing the Chrome window later leaves the tab blank again until an agent restarts the browser by hand. There is no in-panel recovery.

## Why it matters

The panel is the product. A blank tab with a prose error, in a mode where recovery may be impossible for the caller, makes the first-run and the broken-session experience identical, and pushes the cost onto the agent (which then has to discover the crashpad restriction by trial). It also violates the honest-UX bar set in P3/R5: the user must always know which carrier is showing the page and why.

## Root cause

1. **No degraded path.** `realBrowserEnabled` is an explicit opt-in and AGENTS.md line 30 forbids *silent* fallback. Correct rule — but it was implemented as "no fallback at all", so an unreachable endpoint yields a dead tab. The rule bans silent switching, not a user-visible, explicitly labeled action.
2. **Unclassified errors.** The connect failure surfaces as a raw `fetch failed` string from the host. There is no stable code and no distinction between `econnrefused`, `not_cdp` (something else on the port), `spawn_denied` (crashpad/ACL refusal), and `not_installed`.
3. **No zero state.** The client tab renders nothing when the host has no session; it needs a disconnected frame carrying mode, target, last failure, and a reconnect control.
4. **State route cannot explain a blank tab.** Healthy response today:

   ```json
   {"state":{"tabs":[{"id":"D62BA2E3...","url":"http://127.0.0.1:5173/","title":"Beavon 办公助手","origin":"adopted"}],
    "activeTabId":"D62BA2E3...","running":true,"mode":"cdp","cdpEndpoint":"http://127.0.0.1:9222"}}
   ```

   There is no `lastError` / `attempts` field, so neither the panel nor a diagnostics reader can say why a tab is empty.
5. **No liveness detection.** A closed browser is never noticed; the panel stays blank instead of reporting `disconnected`.

## Acceptance

1. With an unreachable endpoint the tab renders an actionable zero state: configured mode (`real`), exact CDP target, last failure reason + timestamp, **Retry**, and — when `realBrowserEnabled` is on — an explicit user-clicked **"Open in isolated Chromium"** action whose mode change is visible in the status row. No silent switch.
2. Tool calls return a structured error with a stable code and fields, e.g.
   `{ code: "webdev.real_browser_unavailable", endpoint, reason: "econnrefused" | "not_cdp" | "spawn_denied" | "not_installed", remediation }`,
   so an agent can branch without parsing prose.
3. A browser that fails to spawn reports `spawn_denied` and carries the crashpad/ACL signal, instead of the generic `fetch failed`.
4. `/api/dsh-webdev-viewer/state` exposes `lastError { code, message, at }` and `attempts`, so a blank tab is always explainable from the route alone.
5. A browser closed mid-session is detected within ~2 s and the panel offers Reconnect; reconnecting needs no agent turn.
6. **B1-a**: `webdev_desktop_*` returns an explicit "panel not mounted" error rather than hanging for 30 s.
7. AGENTS.md line 30 still holds: any source change is user-initiated or echoed back in the tool result with an explicit `mode` field.

## Reproduction

1. Set `ui-webdev.config.realBrowserEnabled: true`; confirm nothing listens on 9222 (`Test-NetConnection 127.0.0.1 -Port 9222` → `false`).
2. Open the `webdev` tab → blank. Call `webdev_tabs` → the error in `## Symptom` step 2.
3. Optional, to reproduce the second-order failure: from a confined shell, launch Chrome with the documented flags → crashpad error, process exits, port stays closed.
4. Start Chrome 157 with `--remote-debugging-port=9222 --user-data-dir=<dedicated profile>` → the tab attaches and renders. Confirms the defect is the unavailable-endpoint path, not CDP.

## Hints

- Change `src/core/protocol.ts` first (add `reconnect` / `open_isolated` commands and the `lastError` field), then both halves — per AGENTS.md architecture.
- Keep the classification in `src/host/` where the connect happens; the client should only render what the state route reports.
- An explicit `open_isolated` action is the sanctioned way to satisfy "never silently fall back" while still unblocking the user.
- Worth mirroring the same classification in `webdev_run`/`webdev_attach` guidance text once it exists.

## Out of scope

- `pnpm install` (`ERR_PNPM_SYMLINK_FAILED` stack overflow) and `git clone` pipe stalls hit in the consuming app's repo — separate reports.
- Anything inside the app under test (`beavon-work-agent`) itself.

## Resolution

Implemented and live-verified on 2026-11-18 (DSH Desktop 0.2.2.0, Windows 11, profile `desktop`, `realBrowserEnabled: true`, endpoint `http://127.0.0.1:9222`). Evidence: [`docs/verification/2026-11-18-b1-live.md`](../../verification/2026-11-18-b1-live.md).

**Classification (acceptance 2, 3).** `src/host/cdp-endpoint.ts` classifies every failed attach once into `econnrefused`, `not_cdp`, `spawn_denied`, `not_installed`, `timeout` or `unknown`, with a per-reason remediation. A failed real-browser attach throws `RealBrowserUnavailableError`; its message ends in one JSON object `{ code: "webdev.real_browser_unavailable", endpoint, reason, remediation }`, so an agent branches on fields. A failed isolated launch throws the same shape as `webdev.isolated_browser_unavailable`, and `ChromeProcess.launch` now captures the browser's stderr in the launch's own profile directory (no pipe, which a confined host may be refused) and quotes it in the failure — the crashpad/ACL evidence is carried instead of a silent exit (live-verified with a bad browser binary). No source switches automatically.

**State route (acceptance 4).** `/api/dsh-webdev-viewer/state` now exposes `lastError { code, message, at, reason, endpoint, remediation, detail?, mode? }`, `attempts`, `isolatedAvailable`, and `realBrowserConfigured`. `message` stays on the state for compatibility. Live: after a failed attach the route reported `webdev.real_browser_unavailable`, `reason: econnrefused`, `attempts: 2`.

**Panel zero state (acceptance 1, 7).** `src/client/panel.tsx` renders a zero state instead of a blank tab: configured mode, exact CDP target, failed attempts, localized reason, message, code and time, remediation and underlying detail; **Retry** sends `reconnect`, **Open in isolated Chromium** sends `open-isolated` (with the page the panel was showing, restored in the new browser), and the isolated mode chip in the status row is a button that sends `use-configured` to return. The status marker is never green "Live" while disconnected: it shows `Disconnected`/`No browser`. The mode change is pushed to every panel and visible in the status row; the user can reach a working page without starting a second browser window.

**Liveness (acceptance 5).** While a panel is open on the real browser, the host probes `/json/version` every second (one 250 ms recheck before believing a failure). A transport that closes is reported immediately; a probe-visible death within ~2 s. The panel offers Reconnect, and the host re-attaches by itself as soon as the endpoint answers — no agent turn and no click. Live: closing the watched browser over CDP produced `webdev.real_browser_disconnected` in **224 ms**, and restarting it re-adopted a page with no user action.

**B1-a (acceptance 6).** A panel socket that closes now releases the native guest: the service rejects in-flight native requests and forgets the sink, and `webdev_desktop_*` throws `webdev.panel_not_mounted` immediately (live-verified; the old path waited 30 s for a detached socket).

Wire contract: `reconnect`, `open-isolated { url? }`, `use-configured` commands were added in `src/core/protocol.ts`; the state fields are additive, so the version stays 1. `AGENTS.md` now records the classify-in-host / render-in-client rule and the liveness requirement.

Tests: 236 passed / 17 files (`tests/host/real-browser-unavailable.spec.ts` is new and covers classification, the state route shape, reconnect, open-isolated + use-configured, the disconnect/recovery cycle and the panel-not-mounted path; `tests/host/native-style.spec.ts` covers the agent-side style bridge). `pnpm typecheck`, `pnpm build`, `pnpm pack` pass. The panel was checked in the running GUI (screenshots captured during verification; the zero state, the isolated switch and the mid-session disconnect were observed live).

