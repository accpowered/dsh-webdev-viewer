# R5 — Electron attach over CDP

Research note for `dsh-webdev-viewer`. Ticket: [`R5-electron-cdp.md`](../wayfinder/tickets/R5-electron-cdp.md).
Scope: how the right-sidebar viewer can show and drive an **Electron app's renderer** over the Chrome DevTools Protocol (CDP), capture the app's **process logs**, and what is impossible.

- **Environment surveyed:** DSH Desktop 0.2.2-rc.3 on Windows 11, Electron 44.7.0, Node 24.21.0, GUI `http://127.0.0.1:57841` ([`MAP.md`](../wayfinder/MAP.md):11).
- **Method:** primary sources only — Electron docs, Chromium `content/` source for the CDP HTTP handler, `electron-vite`/`electron-forge` docs **and source**, Playwright's Electron launcher (a working external implementation), the upstream `browser-view` source, and the installed DSH subprocess docs. Nothing was installed, launched, or modified; the only file written is this note. **No Electron app was run for this ticket** (ticket hint: mental spike only).
- **Citation keys** are resolved in [§17](#17-references). `[E*]` Electron docs, `[C*]` Chromium/CDP, `[T*]` templates, `[P*]` Playwright, `[U*]` upstream `dsh-browser-view`, `[D*]` installed DSH docs.
- **Verified** = read in a source; **Inference** = my derivation from those facts; **Unverified** = listed in [§14](#14-what-could-not-be-verified).

---

## 1. Bottom line

**GO for P3, with a narrower product claim than "Electron app".**

An Electron app is a Chromium browser with an app-specific main process. Its **renderers** are ordinary CDP targets, so the CDP client the fork already has can attach to it with no protocol work: same `/json/version` discovery, same browser-level WebSocket, same `Target` + `Page`/`Input`/`Network` domains, same screencast and screenshot code. What differs is everything *around* the session: how the debug port is created (launch plumbing per template), how the port is discovered, how the app's lifecycle is observed, and where the main-process logs come from.

What must be said out loud in the UX and the docs:

- The sidebar shows a **mirror of the renderer** (CDP frames), not the app's native window. Native OS window embedding is impossible from a DSH plugin ([§11](#11-cannot-do-list)).
- **Main-process JavaScript is not reachable** through the renderer debugging port; only renderers are. Main-process *behaviour* is observable only as stdout/stderr text (plus, optionally, a second `--inspect` channel) ([§7](#7-main-process-logs-crash-quit)).
- Attach is only possible to an app that was **started with a debug port**. There is no way to switch it on afterwards ([§11](#11-cannot-do-list)).

Fallbacks when the port cannot be had: **logs-only mode** (we launched the app but the endpoint never answered) and **copyable launch instructions** (attach-only / packaged app). No silent downgrade to the plugin's own Chromium ([U1]).

---

## 2. What "attach" actually reaches

| Layer | Reachable over the debugging port? | Evidence |
|---|---|---|
| `BrowserWindow` / `WebContentsView` / `<webview>` renderer | **Yes** — each is a CDP `page` target: screencast, screenshot, DOM, Input, console, network | Electron's own debugging guide names exactly these as DevTools-debuggable renderer processes [E5]; Chromium exposes every `DevToolsAgentHost` through `/json/list` [C1] |
| Renderer `console`/`exception`, Network | **Yes**, same `Runtime`/`Network` events as Chrome | Electron's `webContents.debugger` example consumes `Network.requestWillBeSent` [E4] |
| Main process JavaScript (Node) | **No** through the renderer port. A **second** channel exists: `--inspect[=port]`, the V8 inspector on its own port (default 9229) [E1][E3] | Playwright drives `require('electron').app.quit()` through that second channel [P1] |
| Main process *text output* | **Yes**, indirectly: it is the child process's stdout/stderr (see §7) | Electron docs treat the terminal as the way to see main-process output [E3][E5] |
| Native window chrome, native menus, tray, native dialogs, OS-level IME windows | **No** — not part of any CDP domain; no page target exists for them | CDP surface ([C3]); no renderer to attach to |
| The app's own OS window as a live child surface inside DSH's sidebar | **No** — see [§11](#11-cannot-do-list) | — |

**Verified by Chromium source:** the debugging server is *renderer-facing*. It serves discovery over HTTP and protocol over WebSockets; the only "browser-level" target is the multiplexer (`/devtools/browser…`), not a Node context [C1].

> Naming: "Electron CDP" is the same protocol and the same endpoints as Chrome's; Electron does not add an Electron-specific domain. Protocol version is whatever the bundled Chromium reports (`Protocol-Version` in `/json/version`, set from `DevToolsAgentHost::GetProtocolVersion()` [C1]) — so **do not pin it**; read it and treat it as informational. Electron 44.x ships Chromium 152 per electron-vite's version map (`'44': '152'`) [T5], i.e. a modern protocol in this environment.

---

## 3. How `--remote-debugging-port` reaches Electron

### 3.1 The switch itself

Electron documents the switch as "**Enables remote debugging over HTTP on the specified `port`**" [E1]. The listener is created by Chromium's *content-layer* DevTools HTTP handler, and its traffic annotation says it plainly: "This is a remote debugging server, **only enabled by `--remote-debugging-port` switch.** It exposes debugging protocol over websockets… data: Debugging data, including any data on the open pages" [C1].

Two delivery routes:

| Route | Exact form | Notes | Evidence |
|---|---|---|---|
| Command line (any launch: `electron`, `electron-vite`, forge, packaged exe) | `--remote-debugging-port=<port>` in the process argv | Switch is parsed from the whole argv; `electron-vite` appends it **after** the app path and that is its documented debugging flow, so trailing position is fine | [E1]; append order `[entry].concat(args)` in [T5] |
| Main-process code, before `ready` | `app.commandLine.appendSwitch('remote-debugging-port', '8315')` | Requires changing the app; docs' own example uses this exact switch; must run before the `ready` event; "will not affect `process.argv`", it controls Chromium | [E1][E2] (appendSwitch section) |

Useful sibling switches (all Chromium-level, so pass them the same way):

- `--remote-allow-origins=<origin>` / `=*` — the **only** way to let a WebSocket client whose `Origin` is not the server's own origin connect; otherwise the server answers 403 with a message naming the flag [C1].
- `--enable-logging[=file]`, `--log-file=<path>`, `--log-level`, `ELECTRON_ENABLE_LOGGING`, `ELECTRON_LOG_FILE` — Chromium logging, not `console.log` (see §7.2) [E1][E6].
- `--inspect[=[host:]port]` / `--inspect-brk` — main-process V8 inspector on its **own** port [E1][E3].
- `--disable-renderer-backgrounding` — "Prevents Chromium from lowering the priority of invisible pages' renderer processes" [E1]; relevant because our app window may be hidden (§7.3, §11 #11).
- Port `0`: an ephemeral port. Not spelled out in Electron's switch list, but Chromium treats the port as ephemeral and publishes it — `DevToolsHttpHandler`'s constructor documents `active_port_output_directory` as "assumed the socket_factory was initialized with an ephemeral port (0)" [C2], and it prints the actual address [C1]. Playwright launches Electron with `--remote-debugging-port=0` and reads the port back [P1]. **Verified as a working pattern in Playwright, not as an Electron-documented guarantee.**

### 3.2 Per template

**Plain `electron .`** — the switch is just argv. The binary is `node_modules/electron/dist/electron.exe` on Windows; `electron-vite` resolves it through `path.txt` [T5] and Playwright resolves `require('electron/index.js')` to the real executable [P1] — both are better than shelling out to the `.bin\electron.cmd` shim, which is a batch wrapper and adds a shell layer.

```bat
:: spike launch, ephemeral port, Chromium logging on
cd C:\spike\electron-hello
node_modules\electron\dist\electron.exe . --remote-debugging-port=0 --enable-logging
```

**electron-vite** — first-class support, dev only:

- CLI: `electron-vite dev --remoteDebuggingPort <port>`; the dev-options table documents `--remoteDebuggingPort` as "Port for remote debugging … used for debugging with IDEs" [T1], and `src/cli.ts` implements it by setting `process.env.REMOTE_DEBUGGING_PORT` [T4].
- Env: `REMOTE_DEBUGGING_PORT=9222` is the documented VS Code route [T2].
- The runner then pushes `--remote-debugging-port=<value>` **only when `isDev`** and spawns Electron with `stdio: 'inherit'` [T5]. So the port reaches the app in `dev`, and is *not* injected in `preview`/`build`.
- Extra argv passthrough: everything after `--` becomes `ELECTRON_CLI_ARGS` [T4] and is appended to Electron's argv [T5] — `electron-vite dev -- --remote-debugging-port=0` also works at the Electron level.
- `--` in the WebStorm recipe is documented as `-- --sourcemap --remote-debugging-port=9222` [T2].
- `--watch` (`-w`) rebuilds and **restarts the Electron app** when main/preload files change; renderer gets Vite HMR through `ELECTRON_RENDERER_URL` [T3].

**electron-forge** — arguments after `--` are the documented passthrough, and `--enable-logging` is a first-class flag:

```
$ npx electron-forge start /path/to/project --enable-logging -- -d -f foo.txt
...will pass the arguments "-d -f foo.txt" to the Electron app.
```

That help text and `appArgs = process.argv.slice(doubleDashIndex + 1)` are in the CLI source [T6]. `-l, --enable-logging` maps to `StartOptions.enableLogging` [T6][T8], which the core start implementation turns into env `ELECTRON_ENABLE_LOGGING=true` **and** `ELECTRON_ENABLE_STACK_DUMPING=true` [T7]. `-i, --inspect-electron` prepends `--inspect` (main process only) [T6][T7]. Forge also spawns Electron with `stdio: interactive ? ['inherit','pipe','pipe'] : 'inherit'` [T7], so a non-interactive Forge child inherits *our* pipes and we still capture the app's stdout/stderr.

So the forge invocation we would document is:

```
npx electron-forge start --enable-logging -- --remote-debugging-port=0
```

**Other runners** (`vite-plugin-electron` and friends) typically expose the same idea as an env var or arg list; do not guess — detect the runner from `package.json` scripts and print the template-specific line rather than synthesising argv for an unknown runner (Inference).

### 3.3 The rule this yields

> **Pass `--remote-debugging-port=0` ourselves, on the argv of the process we spawn, and read the port back from stderr.** Do not rely on a template to inject it, do not reserve a fixed port, and never require the user to edit their app.

Only when we *cannot* own the launch (auto-attach to an already-running app) does the user supply the port, and then the fixed-endpoint path of §4.4 applies.

---

## 4. Discovery: `/json/version`, `/json/list`, and the stderr line

The handler is `content::DevToolsHttpHandler` [C1][C2]; Electron embeds Chromium's content layer, so this is the behaviour an Electron app shows.

### 4.1 `GET http://127.0.0.1:<port>/json/version`

Fields, exactly as constructed for the `version` command [C1]:

| Field | Value |
|---|---|
| `Protocol-Version` | `DevToolsAgentHost::GetProtocolVersion()` |
| `WebKit-Version` | `537.36 (<chromium git revision>)` |
| `Browser` | the embedder's product string (`GetProduct()`) |
| `User-Agent` | the embedder's user agent |
| `V8-Version` | V8 version string |
| `File-Path-Style` | `windows` / `posix` |
| `webSocketDebuggerUrl` | `ws://<Host header><browser_guid>` |

`browser_guid_` is `/devtools/browser` when the browser target is discoverable, otherwise `/devtools/browser/<random uuid>` [C1]. **Inference:** that UUID (or the port, when we did not choose 0) is a usable *launch identity* for detecting "the app restarted"; treat it as opaque and only compare it with the previous value.

Our plugin only needs `webSocketDebuggerUrl` (and logs `Browser`/`User-Agent` for diagnosis): that is exactly what `fetchCdpVersion`/`parseCdpEndpoint` already do, including a loopback-only and credential-free URL check [U3].

### 4.2 `GET http://127.0.0.1:<port>/json/list`

An array of target descriptors, **sorted by last activity, newest first** (`TimeComparator` on `GetLastActivityTime()`), with `type == "tab"` entries filtered out unless the query string contains `for_tab` [C1]. Each descriptor [C1]:

| Key | Meaning |
|---|---|
| `id` | target id — the same id used in `/devtools/page/<id>` and in `Target` commands |
| `type` | `DevToolsAgentHost` type string (a renderer webContents is a `page`) |
| `title` | target title, HTML-escaped |
| `description` | target description |
| `url` | current URL |
| `faviconUrl` | present only when the target has one |
| `parentId` | present for nested targets (e.g. out-of-process frames/workers) |
| `webSocketDebuggerUrl` | `ws://<host>/devtools/page/<id>` |
| `devtoolsFrontendUrl` | DevTools frontend URL for this target |

Neighbouring endpoints, for completeness: `/json/protocol` (compressed protocol JSON), `/json/new?<url>` (**PUT only** — anything else is answered 405 with "This action supports only PUT verb"), `/json/activate/<id>`, `/json/close/<id>` [C1]. `/json/activate` calls `AgentHost::Activate()` — the closest thing to "focus the app window" (Inference: it is the renderer's activate path, not a Win32 `SetForegroundWindow`).

### 4.3 The line that saves us a port

On startup the handler prints, to **stderr**:

```
DevTools listening on ws://127.0.0.1:<port>/devtools/browser/<guid>
```

`fprintf(stderr, …)` + `fflush(stderr)` in `StartServerOnHandlerThread` [C1]. It also writes `DevToolsActivePort` (`<port>\n<guid>`) **when an active-port output directory was supplied** [C1][C2] — Chrome supplies its profile dir; whether Electron does is **Unverified**, so do not depend on the file. Depend on stderr.

This is exactly how Playwright attaches to Electron: it launches with `--inspect=0 --remote-debugging-port=0`, registers `waitForLine(stderr, /^DevTools listening on (ws:\/\/.*)$/)` and `/^Debugger listening on (ws:\/\/.*)$/` *before* awaiting anything, then opens the WebSocket from the captured URL [P1]. Copying that pattern is the single highest-value borrowing in this ticket.

> Consequence: **no `/json/version` poll is needed on the launch path at all.** The WS URL arrives on stderr; `/json/version` is still worth one GET for diagnostics (`Browser`, `Protocol-Version`) and is the *only* discovery on the attach-to-existing path. Our client connects to whatever URL it is given (`CdpClient.connect(url)`) [U2], so both paths converge.

### 4.4 Port collision and wrong-endpoint cases

- Port busy: Chromium cannot start the server and logs `Cannot start http server for devtools.` via `LOG(ERROR)` [C1]. It is *not* the `DevTools listening` line, and on a normal run it may only be visible with Chromium logging enabled — so a fixed-port launch that produces no `DevTools listening` line within the timeout must be reported as **"endpoint did not start (port likely busy)"**, not retried forever.
- Wrong endpoint (something else already answers on that port): `/json/version` returns a `Browser`/`User-Agent` for a different product, and `/json/list` shows targets we did not launch. Show both strings and offer "attach anyway" vs "use a free port"; never swap the endpoint silently ([U1] "Failure is an error, not a downgrade").
- Default port choice: **0** on our own launches (no collision by construction); a configured fixed port only for attach-to-existing and for users who insist on a predictable port.

---

## 5. Target selection rule

Inputs: the `page` target list from §4.2 (or `Target.getTargets` over the browser session), the launch spec, and — for a running app — the user.

```
candidates = targets where
    type == 'page'
    and not url.startsWith('devtools://')
    and not url.startsWith('chrome-extension://')
    and not url.startsWith('about:blank') unless it is the only candidate   // a window before navigations
order = as returned by /json/list (last activity, newest first)            // [C1]

pick =
    the candidate whose url starts with the known entry URL   (electron-vite dev: ELECTRON_RENDERER_URL;
                                                               file: app: our own preview URL if we set one)
    else the candidate whose title equals the last title for this launch
    else candidates[0]
```

Why this shape:

- **The app window is a target, and the newest activity wins the sort** [C1]. For a one-window spike (`BrowserWindow` + `loadFile`/`loadURL`) this is unambiguous; for a multi-window app it is a heuristic, so expose the list.
- **Never attach to a non-`page` target for the mirror.** `devtools://`, workers, `background_page` and the browser target either have no `Page` domain or would show DevTools/extension UI instead of the app.
- **Persist the chosen `targetId` with its `url` and `title`.** After a renderer reload the target id normally survives (same webContents), but after an app restart it does not; rematch by URL/title and re-attach.
- **Multiple windows → a target picker** (chips), reusing the upstream `browser_tabs` listing shape [U1]. Do not try to infer "the main window" from window size or z-order; no CDP field exposes native window geometry.
- **Skip a target whose url is `devtools://devtools/…`** — opening the app's own DevTools is at best disruptive: Electron's in-app debugger detaches when "DevTools is invoked for the attached webContents" [E4], and the HTTP server opens a new `DevToolsAgentHostClientImpl` per WebSocket connection to a target [C1]. Expect contention — or a dropped session — when a user presses F12; §8 handles it.

**Inference:** Electron's API `webContents.fromDevToolsTargetId(targetId)` exists precisely because a CDP target id identifies one `webContents` [P1], which is what makes "the app window" and "a CDP target" the same object.

---

## 6. Attaching the existing CDP session

The fork's CDP client is already the right shape. From its module documentation and implementation [U2]:

- one WebSocket per endpoint;
- **flat-mode sessions**: `Target.setDiscoverTargets` + `Target.attachToTarget({ flatten: true })`, after which every message for a tab carries a `sessionId`, so one socket multiplexes browser-level and page-level commands;
- `connect(url)` takes the `webSocketDebuggerUrl` from `/json/version`;
- browser-level commands must **omit** `sessionId` (the browser rejects an explicit `null`);
- handshake timeout 30 s, per-command timeout 30 s;
- `closed` is sticky: a socket close/write failure rejects every pending command and callers are expected to replace the transport.

So the Electron path is:

```text
1. wsUrl = <webSocketDebuggerUrl from stderr line, or /json/version>
2. client = CdpClient.connect(wsUrl)                          // [U2]
3. Target.setDiscoverTargets({ discover: true })              // browser-level
4. list = Target.getTargets()  |  GET /json/list              // selection, §5
5. { sessionId } = Target.attachToTarget({ targetId, flatten: true })
6. per target session: Page.enable, Runtime.enable, Network.enable
7. Page.startScreencast / Page.captureScreenshot / Input.*     // unchanged from Chrome
8. Target.detachFromTarget({ sessionId }) on switch/teardown
```

Everything in step 7 is the panel's existing Chrome code path. Electron's renderers are Chromium renderers [E5]; the `Page`, `Input`, `Network` and `Runtime` domains are served by the same content-layer DevTools infrastructure as Chrome's [C3][C1]. The command-level details, coordinate mapping and event-ring design are **R3's** ticket ([`R3-cdp-input.md`](../wayfinder/tickets/R3-cdp-input.md)), not repeated here.

Electron-specific notes for that path:

- **Watch for DevTools contention on the page target.** Electron's own debugger API documents detach when DevTools is opened for the same `webContents` [E4]; the remote server creates one client per WebSocket connection to a target and ignores `AttachClient`'s success value [C1]. So a user opening F12 on the app window may disturb (or end) our capture — treat a session close with the app still alive as "detached (DevTools opened?)" and offer *Re-attach*.
- **Target death is signalled in-band**: when the agent host closes, the server sends `{"method":"Inspector.detached","params":{"reason":"target_closed"}}` and closes the socket [C1]. That is a cleaner signal than waiting for the socket to die.
- **Do not close windows through CDP.** Playwright explicitly avoids `Target.closeTarget` on Electron: it "can hang on Electron when the close races a committing navigation", and closes `webContents`/`BrowserWindow` from the main process instead [P1]. Our panel should offer *Reload* and *Stop app*, not *close window*.
- **Screenshots/screencast show page pixels only** — never the native title bar, menu, or any native dialog (§11). Same commands, same limits as Chrome.
- **Optional main-process channel:** if the launch also passes `--inspect=0`, the stderr line `Debugger listening on ws://…` is the main process's V8 inspector [P1][E1]; a *second* `CdpClient` can connect there for `Runtime.evaluate` in the main process (Playwright uses it for `app.quit()` [P1]). This is a bonus channel, not required for P3, and it is **not** a page target: no `Page`/`Input` domains there.

---

## 7. Main-process logs, crash, quit

### 7.1 What the log actually is

The app's stdout and stderr. `electron <app>` is a Node-backed process: `console.log` from the main process writes to stdout, uncaught exceptions to stderr, and Electron docs treat "launch it from a terminal" as the way to see main-process output [E3][E5]. Nothing about that is Electron-specific — it is just inherited or piped descriptors.

### 7.2 DSH's subprocess seam (what we must use)

`ctx.subprocess.spawn(spec)` is the installed host service; it returns a live handle synchronously, and the spec is fully explicit — no defaults [D1] (`subprocess.md:308`, `:102-132`):

```ts
// shape only; see subprocess.md:102-132
ctx.subprocess.spawn({
  argv: [electronExe, '.', '--remote-debugging-port=0', '--enable-logging=file', `--log-file=${logPath}`],
  cwd: projectDir,
  stdio: {
    stdin: 'ignore',
    stdout: { maxBytes: 256 * 1024, spill: { maxBytes: 8 * 1024 * 1024 } },   // keep the tail, spill the rest
    stderr: { maxBytes: 256 * 1024, spill: { maxBytes: 8 * 1024 * 1024 } },
  },
  graceMs: 5_000,
  env: { ELECTRON_ENABLE_STACK_DUMPING: '1' },   // explicit entries merge onto the scrubbed parent env
})
```

Semantics that shape the log drawer (all from the installed docs [D1]):

- `stdout`/`stderr` disposition is `'pipe' | 'inherit' | { maxBytes, spill? }`; collect mode "keeps only the in-memory tail" and **overflow keeps the TAIL** (`subprocess.md:59-67`, `:77`). Errors cluster at the end, which is the half we care about for a crash; the spill file holds the complete stream.
- Reads are **offset-based and non-consuming** (`readFrom(fromByte) → { text, nextOffset, lossy, spillPath? }`, `subprocess.md:186-209`), "so background and batch readers coexist before and after exit" ([`dsh-subprocess-local` README][D2]:47). The drawer can therefore read incrementally while a second reader takes a batch snapshot for the agent.
- `done` resolves `{ exitCode, signal }` — **exit facts only**, no cause classification, and collected output stays readable afterwards (`subprocess.md:225`, `:235-240`).
- `terminate()` is the only termination verb; `waitForExit()` observes the same managed range (`subprocess.md:148-175`).
- **Service disposal terminates all still-running managed processes and awaits their exit** (`subprocess.md:277`) — plugin unload/host shutdown must be treated as "the app dies too"; document it.
- The seam is optional: `ctx.get('subprocess')` with an undefined check, or a hard `inject: ['subprocess']` (live service catalog, `Service.listService`). If it is absent, no logs — degrade, do not fake them.

### 7.3 Windows specifics that will bite

- **Children start hidden.** "On Windows, non-terminal children and `taskkill` helpers start with their windows hidden so background operations do not take focus. **This also hides GUI windows that honor the process startup visibility setting.**" ([D2]:28) A Windows subprocess also "starts the private Job runner with `windowsHide` and request[s] hidden initial windows for native targets" ([D2]:43). **Inference:** an Electron app spawned through `ctx.subprocess` may start with its BrowserWindow hidden (Chromium/Electron may or may not honour `STARTUPINFO.wShowWindow`; **Unverified**). Two consequences: (a) this is *good* for a sidebar-only workflow — no stray native window stealing focus; (b) if the window is hidden/occluded, Chromium may throttle or stop producing frames for it, which is the classic "attach succeeds, panel is blank" failure (§11 #11). Mitigations: `--disable-renderer-backgrounding` [E1] and an on-demand `Page.captureScreenshot`; what we *cannot* do is force the native window visible (§11 #2).
- **Chromium child-process logs cannot be routed to stderr on Windows**: "On Windows, logs from child processes cannot be sent to stderr. Logging to a file is the most reliable way to collect logs on Windows." [E1]. So for Chromium/renderer logging use `--enable-logging=file --log-file=<path>` (`ELECTRON_LOG_FILE` is equivalent [E6]) and tail that file as a second lane; `ELECTRON_ENABLE_LOGGING` is equivalent to `--enable-logging` [E6].
- **Crash visibility:** `ELECTRON_ENABLE_STACK_DUMPING` "Prints the stack trace to the console when Electron crashes"; `ELECTRON_DEFAULT_ERROR_MODE` shows the Windows crash dialog ([E6]: those sections). Forge's `--enable-logging` sets *both* env vars [T7]. Recommend both in the launch env; the dialog is the one thing we cannot see or click (§11).
- **Termination range:** Windows ordinary subprocesses run under a private Job object ([D2]:43), and shutdown "kills each Windows runner so its sole Job handle closes" ([D2]:66) — so `terminate()` should take the Electron **tree** (main + renderers + GPU) down. **Unverified:** that no orphaned `electron.exe` remains after `terminate()`; P3 must check with `tasklist`.
- **stdin:** 'ignore' is right for a plain launch, but it disables Forge's interactive `rs`/`r` restart key ([T7]) — our restart is a relaunch, not a keystroke.

### 7.4 Log/error handling design

Two lanes, one ring each, both fed from `readFrom` offsets:

| Lane | Source | Use |
|---|---|---|
| `app` | `handle.collected.stdout` + `.stderr` | main-process output, Electron/Node errors, our own `DevTools listening` handshake, exit tail |
| `chromium` | `--log-file=<path>` tail (only when enabled) | renderer/GPU/network Chromium logging on Windows [E1] |
| `renderer` (existing) | `Runtime.consoleAPICalled`, `Runtime.exceptionThrown` on the page session | page console, same as the Chrome tab [U1] |

Rules:

1. **Never block the panel on logs.** Lanes are optional; a missing spill file or a `lossy` read is displayed as a marker, not an error ([D1] `readFrom` semantics).
2. **Strip ANSI, keep raw.** Show plain text in the drawer, keep the raw bytes (offsets) for export; do not reflow or truncate mid-line — buffer a partial trailing line per lane.
3. **Recognise the handshake and the failure lines**, not the whole log: `^DevTools listening on (ws://\S+)$` → endpoint; `^Debugger listening on (ws://\S+)$` → main inspector; `Cannot start http server for devtools.` → port collision [C1].
4. **Classify exit, do not diagnose it.** `done` gives `{exitCode, signal}` only; exit 0 = "app quit", non-zero/signal = "app exited unexpectedly", and in both cases the last N lines are the evidence, shown before any advice ([D1] `:225`).
5. **Tag each lane with the launch id** (port/GUID, §4.1) so a restart appends a new run instead of interleaving two app lifetimes.
6. **Do not log secrets**: the debug endpoint exposes page data [C1], and logs can contain tokens. Ring buffers stay in memory; spill files live under the host's private per-process temp directory with `0700`/`0600` ([D2]:47) — never copy them into the vault or a prompt without redaction.

### 7.5 Signals we can observe

| Event | Signal | Action |
|---|---|---|
| App quits cleanly | `handle.done` → `{exitCode: 0}` | keep logs, "App exited", offer Relaunch |
| App crashes | `handle.done` → non-zero/signal | keep logs, show last lines, offer Relaunch |
| Renderer crashes / window closes | page socket close, or `Inspector.detached` reason `target_closed` [C1]; new target list without our target | re-run selection (§5); if none, "no app window" |
| Debug session disturbed (F12 / another client) | session close, or capture stalls while `done` is still pending | "detached (DevTools opened?)", offer Re-attach [E4][C1] |
| App restarted behind our back (HMR/forge) | `DevTools listening` line again / new GUID or port | reconnect ladder (§9) |
| App frozen | commands time out (30 s, [U2]) | show "renderer not responding"; do not kill automatically |

---

## 8. Reload vs restart vs HMR

Three different things, three different reactions:

| Change | What happens inside the app | What our session sees | What the viewer does |
|---|---|---|---|
| Renderer module edit under electron-vite (Vite HMR) | modules hot-swap through `ELECTRON_RENDERER_URL`'s dev server; page not reloaded [T3] | same target, same socket; a screencast frame may arrive or not; `Runtime.consoleAPICalled` continues | nothing; frames continue |
| Preload script edit under electron-vite `--watch` | electron-vite "rebuilds and triggers renderer reload" for preload changes [T3] | same target id, execution context replaced (`Runtime.executionContextsCleared`/`Created`); page console ring should be cleared | clear page console/network rings, keep session |
| Main-process edit under electron-vite `--watch` | **full Electron restart** [T3] — new process, new port if 0, new GUID | socket dies; our child `done` does not resolve because the *runner* respawns the app; a **new** `DevTools listening` line arrives on our stderr pipe | full reconnect (§9), new launch id, keep old logs |
| Forge restart (`rs`/`r` or file watch) | old child is `SIGTERM`ed and a replacement spawned; Forge emits `restarted` [T7] | same as above, inside Forge's process | full reconnect |
| Manual stop in our UI | we `terminate()` the managed range | `done` resolves | keep logs, mark stopped |

Source maps: electron-vite's `--sourcemap` writes maps for the bundled main/preload/renderer code [T1][T2]. Over CDP, `Debugger.scriptParsed` carries `sourceMapURL`, and stack traces in `Runtime.consoleAPICalled` point at bundle URLs — mapping them back to source is **our** job, not the app's. **Inference / v1 position:** display bundle path + line:column verbatim (still actionable), and defer a real source-map fetcher; do not promise "click the stack to jump to source" in the first prototype.

---

## 9. Reconnect strategy

State machine per **launch** (not per app name):

```
LAUNCHING ──stderr "DevTools listening"──► ATTACHING ──Target.attachToTarget──► ATTACHED
    │  timeout (no line)                        │ connect/attach failure
    ▼                                           ▼
NO_ENDPOINT (port busy? wrong app?)          RETRYING ──backoff──► ATTACHING
ATTACHED ──socket close / Inspector.detached(target_closed)──► DETACHED
    ├── done pending?           → wait for exit → EXITED (0 → quit, ≠0 → crash)
    └── runner respawn detected → new "DevTools listening" line → ATTACHING (new launch id)
```

Rules:

1. **A restart is a new launch id**, not "the same tab reconnected": derive identity from the port (if we chose it) and/or the browser GUID (§4.1); a changed value means a new run, so start a new log lane and redo target selection.
2. **Attach-only mode polls** `GET /json/version` with a bounded backoff (e.g. 250 ms → 500 ms → 1 s → 2 s → 5 s, cap ~30 s), then reports the connection error verbatim. A refused connection means "the app is not running with a debug port", which is a *user-actionable* state, not an internal error.
3. **Never swap endpoints.** If the configured endpoint does not answer, fail the action and say so; do not fall back to the plugin's own Chromium ([U1]: "the plugin never falls back to the isolated browser").
4. **Keep the last frame and the rings** across a reconnect, marked stale; a restart clears only what belongs to the old launch id.
5. **Do not auto-restart the app** when the user's own edit triggered the restart; reconnect to whatever appears. Auto-relaunch only after an explicit "Relaunch" or "Run" action.
6. **One app per panel.** The upstream model is one browser per host [U1]; for Electron keep at most one managed launch per project/session and refuse a second concurrent launch on the same port.
7. **Teardown order**: `Target.detachFromTarget` → `client.close()` → `terminate()` → `waitForExit()` (bounded) → final drain of the log readers. `terminate()` is idempotent and a no-op once the range is gone ([D1] `:161-166`).

---

## 10. Security

Treat the debug port as **local code execution**, because it is:

- **No authentication exists.** In the default server mode the handler has no auth of any kind: the only request gates are (a) a Host-header check that answers 500 unless the Host is an IP or `localhost` (`RequestIsSafeToServe`), and (b) a WebSocket **Origin** allowlist (`--remote-allow-origins`), answered 403 with the flag name [C1]. Anything that can reach the port and pass those gates gets the protocol. Upstream states the same: "No authentication on the CDP endpoint: the devtools protocol has no credentials, so any process on this machine that can reach that port drives the same tabs" [U1].
- **What an attacker gets:** the renderer's DOM, cookies-as-seen-by-the-page, network, input injection, and `Runtime.evaluate` in the page. If the app enables Node integration (or exposes a wide preload bridge), that escalates to the user's OS account. Chromium's own traffic annotation admits the scope: "Debugging data, including any data on the open pages" [C1].
- **Loopback only, enforced on both sides.** The endpoint must be `http://127.0.0.1:<port>` or `http://localhost:<port>`; the fork's `parseCdpEndpoint` already fails closed on non-loopback hosts, credentials, paths, missing ports, and non-`http:` schemes [U3], and separately fences its own panel socket to loopback requests [U4]. Keep both fences; add the same check to the Electron launch path (we pass `--remote-debugging-port` only, never `--remote-debugging-address`, and never `--remote-allow-origins=*`).
- **Do not persist or display the endpoint as shareable.** The port is ephemeral (0) on our launches; a screenshot/log line containing `ws://127.0.0.1:PORT/...` is enough for another local process to hijack the session if replayed. Redact the GUID/port in exported logs.
- **`Page.addScriptToEvaluateOnNewDocument` and injected bindings persist across navigations** for the life of the session — anything the picker/annotation feature installs must be removed or the session closed on teardown, or it will follow the app into pages the user never asked us to instrument (Inference from the documented persistence of new-document scripts [C3]).
- **Plugin-side isolation:** the app we launch is the *user's* app with the *user's* profile and sign-ins. Console/network logs can contain tokens; ring buffers stay in memory and spill files stay in the host's private temp dir ([D2]:47). The upstream README's rule applies unchanged: the viewer reads pages, never the cookie jar [U1].

---

## 11. Cannot-do list

Each item is a hard boundary of a DSH plugin talking to Electron over CDP, with the reason:

| # | Cannot | Why | Fallback UX |
|---|---|---|---|
| 1 | Embed the app's **native OS window** inside the right sidebar | The sidebar is web content in DSH's own window ([`MAP.md`](../wayfinder/MAP.md):51 out-of-scope). No plugin API hands a foreign HWND to the sidebar; Electron's own embedding APIs (`BrowserView`/`WebContentsView`) run *inside* the app's process, not in a third party | CDP renderer mirror (screencast) + "the real window is its own window" copy |
| 2 | Control the **native window** (title bar, minimize/maximize, tray, native menus, native dialogs, crash dialogs) | No CDP domain reaches native UI; only renderers have targets [C1][C3]. `/json/activate` activates the renderer, it is not a window manager (Inference) | "Show/Focus" best-effort via `/json/activate/<id>`; otherwise tell the user |
| 3 | Run code in / inspect the **main process** through the renderer port | The browser-level target multiplexes renderers; there is no Node context there. Main-process JS needs `--inspect` on a second port [E1][E3] | logs from stdout/stderr; optional `--inspect` follow-up |
| 4 | Attach to an app **not started with a debug port** | The listener exists only with the switch [C1] | offer the exact launch command for the detected template; or logs-only |
| 5 | Attach to a **packaged app** without relaunching it with the flag | Same reason; and packaged apps "might have their own command line handling" [P1] | document launching the packaged binary with `--remote-debugging-port=0 --enable-logging` from a terminal |
| 6 | **Close the app window** reliably through CDP | `Target.closeTarget` "can hang on Electron when the close races a committing navigation" [P1] | Reload / "Stop app" (terminate the managed range) / "Quit" via the optional main-process channel |
| 7 | Show **all native windows at once** as one surface | one target per webContents; no composite view | one panel tab per target, or a picker |
| 8 | See native **IME composition/candidate windows**, OS drag-and-drop from the desktop, native context menus | page-level Input events only; native UI is outside the renderer (cf. R3's boundary) | text input through `Input.insertText`/key events; accept the loss |
| 9 | Keep working across an app restart without re-resolving | port and targets are per launch (§9) | automatic reconnect with a new launch id |
| 10 | Capture **stdout/stderr of an app we did not launch** | we only own the child's descriptors when `ctx.subprocess` spawned it ([D1]) | attach-only mode shows renderer console but not process logs |
| 11 | Guarantee frames from a **hidden/occluded** window | Chromium de-prioritises invisible pages (`--disable-renderer-backgrounding` exists for exactly that [E1]); the hidden-start behaviour of `ctx.subprocess` on Windows ([D2]:28) makes this likely, not hypothetical | `Page.captureScreenshot` on demand; document the flag; a visible window is the reliable path |
| 12 | Read the app's **Electron version/identity** as a formal API | no such endpoint; `/json/version` gives `Browser`/`User-Agent` [C1], and an app can customise its user agent, so identity detection by UA is unreliable (Inference) | show what `/json/version` reports; let the user name the app |

---

## 12. Compatibility table

Legend: **✔** works with our launch; **△** works with caveats; **✘** not supported.

| Launch shape | How the switch arrives | Renderer attach | Main logs | Restart/HMR | Evidence |
|---|---|---|---|---|---|
| **Plain `electron .`** (spike, `node_modules/electron`) | our argv: `<electron.exe> . --remote-debugging-port=0` | ✔ same CDP path | ✔ our pipes | manual relaunch; renderer reload via CDP page session | [E1]; argv shape [T5]; port discovery [P1][C1] |
| **electron-vite `dev`** | `--remoteDebuggingPort <port>` or `REMOTE_DEBUGGING_PORT` env → runner appends `--remote-debugging-port=` (dev only) [T4][T5]; or our own argv after `--` | ✔ | ✔ runner spawns Electron with `stdio: 'inherit'` [T5] | renderer HMR; `--watch` restarts app on main/preload changes [T3] | [T1][T2][T3][T4][T5] |
| **electron-vite `preview` / `build`** | injects nothing (`isDev` guard) [T5]; pass `--` ourselves | ✔ if we pass the flag | ✔ | manual | [T5] |
| **electron-forge `start`** | `electron-forge start -- --remote-debugging-port=0`; `--enable-logging` sets `ELECTRON_ENABLE_LOGGING` + `ELECTRON_ENABLE_STACK_DUMPING` | ✔ | ✔ non-interactive inherits our stdio; interactive pipes to Forge's App tab [T7] | `rs`/`r` restart and `restarted` event [T7] | [T6][T7][T8] |
| **Other runners (e.g. `vite-plugin-electron`)** | framework-specific env/args (that one documents `REMOTE_DEBUGGING_PORT`) [T9] | ✔ if it forwards | ✔ if it inherits stdio | runner-specific | [T9]; **not verified for each runner** |
| **Attach to an already-running app** | user's own launch with a fixed port | ✔ after `/json/version` answers | ✘ (not our child) | poll + reconnect | [U1][U3]; [C1] |
| **Packaged app (forge/builder output)** | user launches the `.exe` with the flag | △ flag must survive the app's own argv handling [P1] | △ only if launched from our runner/terminal | manual | [P1] |
| **App with `--inspect` also passed** | ours | ✔ same | ✔ | plus main-process evaluate channel [P1] | [E1][E3][P1] |

Environment note: Electron **44.7.0** ([`MAP.md`](../wayfinder/MAP.md):11) ⇒ Chromium **152** per electron-vite's map [T5] ⇒ modern `Target`/`Page`/`Network` domains; `Protocol-Version` still read from `/json/version`, never assumed [C1].

---

## 13. Step-by-step attach sequence (exact commands)

### 13.1 One-file mental spike

`main.js` (the "cannot pass CLI flags" variant — the app itself opens the port; documented route [E1][E2]):

```js
const { app, BrowserWindow } = require('electron')
// Optional: only if the launcher cannot pass CLI args. Must run before 'ready'.
// app.commandLine.appendSwitch('remote-debugging-port', '8315')
app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 900, height: 600 })
  win.loadFile('index.html')          // one page, one window
})
```

`index.html`: a button, an input, a `console.log` on click, and a `fetch('http://127.0.0.1:9/')` that always fails — enough to prove screencast, click, type, console and network.

### 13.2 Launch and discover (manual, from a terminal)

```bat
cd C:\spike\electron-hello
node_modules\electron\dist\electron.exe . --remote-debugging-port=0 --enable-logging
:: stderr, within a second or two:
:: DevTools listening on ws://127.0.0.1:53421/devtools/browser/8f0c…

curl http://127.0.0.1:53421/json/version
:: { "Protocol-Version": "…", "Browser": "…", "User-Agent": "…",
::   "webSocketDebuggerUrl": "ws://127.0.0.1:53421/devtools/browser/8f0c…" }

curl http://127.0.0.1:53421/json/list
:: [ { "id": "PAGEID", "type": "page", "title": "hello", "url": "file:///C:/spike/electron-hello/index.html",
::     "webSocketDebuggerUrl": "ws://127.0.0.1:53421/devtools/page/PAGEID", … } ]

curl -X PUT "http://127.0.0.1:53421/json/new?about:blank"   :: PUT is mandatory [C1]
curl "http://127.0.0.1:53421/json/activate/PAGEID"           :: best-effort focus [C1]
```

Note the exact field names come from the Chromium source [C1], so a `curl` that answers differently means "not an Electron/Chromium endpoint".

### 13.3 What the plugin does (the sequence to implement in P3)

1. **Detect the launch shape** from `package.json` (electron-vite / forge / plain `electron` dependency) and pick the argv + binary (§3.2). Never guess argv for an unknown runner — ask.
2. **Resolve the executable** with `ctx.subprocess.resolveExecutable(...)` (absolute or bare PATH name; relative paths with separators are rejected) [D1], preferring `<project>/node_modules/electron/dist/electron.exe` over the `.cmd` shim [T5][P1].
3. **Spawn** with `ctx.subprocess.spawn({ argv, cwd, stdio: {stdin:'ignore', stdout:{maxBytes,spill}, stderr:{maxBytes,spill}}, graceMs })` and env `ELECTRON_ENABLE_STACK_DUMPING=1` (+ `ELECTRON_ENABLE_LOGGING` or the file variants when Chromium logging is wanted) [D1][E6][T7].
4. **Watch stderr** for `/^DevTools listening on (ws:\/\/\S+)$/` and `/^Debugger listening on (ws:\/\/\S+)$/` from the moment of spawn (register before awaiting; lines can arrive first) [P1].
5. On timeout: read the collected stderr tail, look for `Cannot start http server for devtools.` [C1], and report "no endpoint (port busy or app failed to start)" with the tail.
6. **`GET /json/version`** on the derived origin (diagnostics + attach-only path) and validate loopback/scheme with the existing parser [U3].
7. **`CdpClient.connect(webSocketDebuggerUrl)`**, `Target.setDiscoverTargets({discover:true})`, `Target.getTargets`, apply the selection rule (§5), `Target.attachToTarget({targetId, flatten:true})` → `sessionId` [U2].
8. **Enable the panel's existing domains on that session** (`Page`, `Runtime`, `Network`), start the screencast, wire the console/network rings — unchanged code path (§6).
9. **Stream logs** into the drawer from the collect readers (§7.4), plus the Chromium log file lane if enabled.
10. **Relaunch/stop**: `terminate()` + `waitForExit()`; relaunch re-runs step 3 and produces a new launch id (§9).
11. **Reconnect**: on socket close/`Inspector.detached`, re-run 4–8 (attach-only: poll `/json/version` with backoff).

---

## 14. What could not be verified

1. **Chrome 136's default-profile restriction vs Electron.** Chrome 136 ignores `--remote-debugging-port`/`--remote-debugging-pipe` when targeting Chrome's *default data directory*, requiring a non-default `--user-data-dir` [C4]. That check is not present anywhere in content's `DevToolsHttpHandler` [C1] — it belongs to Chrome's own remote-debugging server — and Playwright drives current Electron with `--remote-debugging-port=0` and **no** `--user-data-dir` [P1]. **Inference (high confidence):** Electron is unaffected. **P3 must confirm once** on Electron 44.7.0 by launching the spike with the default userData and checking that `/json/version` answers. (For *Chrome* attach, the upstream rule stands: non-default `--user-data-dir` is mandatory [U1][C4].)
2. **Whether Electron writes `DevToolsActivePort`.** The handler writes it only when given an output directory [C1][C2]; Chrome passes its profile dir, Electron's value is unknown. The note therefore depends on stderr, not the file.
3. **Exact target `type` strings in an Electron app** (e.g. `page` for each window, plus what `<webview>`/workers add). `page` for a window's webContents is strongly implied by `webContents.fromDevToolsTargetId` [P1] and by Electron's renderer-debugging statement [E5], but the full set was not observed.
4. **Whether Electron honours `STARTUPINFO` hidden start** under `ctx.subprocess` on Windows ([D2]:28,43) — i.e. whether the app window appears at all. Determines whether §11 #11 is a bug or a feature.
5. **Screencast behaviour for a hidden/occluded BrowserWindow** (frame throttling): needs measurement.
6. **No orphaned `electron.exe` after `terminate()`** on Windows job-object teardown ([D2]:43,66).
7. **Main-process inspector line/format under Electron** (`Debugger listening on ws://…`, and whether `--inspect=0` is accepted): inferred from Playwright's regex [P1] and Node semantics.
8. **`--remote-debugging-port=0` acceptance in each runner's flag plumbing** (electron-vite sets the env string verbatim [T4]; `"0"` is untested there).
9. **`Browser`/`User-Agent` strings on Electron** (`Chrome/…`? `Electron/…`?) — and apps rewrite the UA, so identity detection by UA is explicitly *not* recommended.
10. **Frame-rate/latency numbers on this Windows host** — R3's territory; nothing was measured here.
11. **Whether a second client (the app's own DevTools) can coexist with our session on one target.** The server makes a client per connection but ignores `AttachClient`'s return value [C1]; Electron's in-app debugger detaches on DevTools open [E4]. Treat "F12 disturbs capture" as a risk to test in P3, not a decided behaviour.

---

## 15. Go / no-go for P3

**GO** — with a scoped prototype and two explicit conditions.

Why it is a go:

- The session layer needs **zero new protocol work**: one WebSocket, `/json/version`, flat `Target` sessions, then the panel's existing Page/Input/Network code [U2][C1][C3]. This is the cheapest possible extension of the fork.
- Port discovery has a **deterministic** answer that needs no user configuration: `--remote-debugging-port=0` + the stderr line [C1][P1].
- Log capture has a **contracted host primitive** with exactly the shape a log drawer needs — offset readers, tail-preserving collect mode, spill files, exit facts, tree termination on Windows [D1][D2].
- All template plumbing is documented and implemented in their own sources [T1][T4][T5][T6][T7], so the compatibility matrix is a documentation task, not a reverse-engineering task.

Conditions:

1. **Scope the claim to "renderer mirror + input + process logs".** No native window, no main-process UI control (§11). The panel must say this in one line, not in a doc nobody opens.
2. **Own the launch.** P3 must launch the app itself with its own argv and its own ephemeral port; the "attach to something already running" path is a *fallback* that requires the user to supply a fixed port. Do not build the prototype on the hope that a template forwards the flag.

Two things P3 must measure before we commit the UX (both §14): the hidden/occluded **frame** behaviour (§11 #11), and **orphan processes** after stop (§14 6). Both are one-evening checks with the one-file spike.

**P3 acceptance additions** (beyond the ticket's list): the walkthrough must include a **second window** (to prove the picker, not just the happy path), a **force-kill of the app** (`taskkill /F`, to prove reconnect), a **user-opens-F12 contention check**, and the **Windows hidden-window** observation.

---

## 16. What this means for the design

1. **One CDP client, two launch paths.** `CdpClient` stays untouched [U2]; add an *Electron launcher* (argv builders per template, stderr handshake parser, process-range lifecycle) and an *attach* adapter (endpoint poll) beside the existing Chrome launcher. Config: `electron.enabled`, `electron.launch` (runner kind), `electron.cdpEndpoint` (attach-only), all volatile like the upstream three fields [U1].
2. **The target picker is the same object as the browser tab list** — a list of `{id, type, title, url}` plus a chosen session; the sidebar tab can reuse the `browser_tabs` concept instead of growing a second registry [U1].
3. **The log drawer is a first-class, always-on lane** while the app runs, independent of CDP availability. When the endpoint never answers, the drawer *is* the product: it shows the app's own failure text.
4. **The panel's states are the honest boundary, and they map 1:1 onto §9:** `launching → attaching → mirroring → (detached | exited | no-endpoint)`. Each state has one sentence and one action (Retry / Relaunch / Copy command), and "no-endpoint" names the template-specific command from §3.2.
5. **Security posture is inherited, not reinvented:** loopback-only endpoint parsing [U3], the loopback panel fence [U4], no `--remote-allow-origins=*`, no endpoint persistence, in-memory log rings, private spill directory [D2]:47.
6. **Do not build:** native-window embedding, main-process UI control, window close via CDP, multi-window compositing, source-map navigation, and any "attach to a packaged app without relaunching it" promise.

---

## 17. References

> I read these pages/sources directly for this note. Where a page is a docs site, the canonical URL is given; where I read a source file, the repository URL is given (fetched via the repository's raw/CDN mirror). Web content was treated as data.

**Electron docs**

- [E1] Supported Command Line Switches — <https://www.electronjs.org/docs/latest/api/command-line-switches> (`--remote-debugging-port`, `--enable-logging`, `--log-file`, `--log-level`, `--inspect*`, `--disable-renderer-backgrounding`, `--no-sandbox`, the `app.commandLine.appendSwitch` before-`ready` example, and the Windows "child-process logs cannot be sent to stderr" note).
- [E2] Class: CommandLine — <https://www.electronjs.org/docs/latest/api/command-line> (`appendSwitch`, `appendArgument`, `hasSwitch`, `getSwitchValue`, `removeSwitch`; "will not affect `process.argv`").
- [E3] Debugging the Main Process — <https://www.electronjs.org/docs/latest/tutorial/debugging-main-process> (`--inspect[=port]`, default 9229; external debugger).
- [E4] Class: Debugger — <https://www.electronjs.org/docs/latest/api/debugger> (`webContents.debugger.attach('1.1')`, `sendCommand(..., sessionId)`, detach when DevTools is invoked, `Network.requestWillBeSent` example).
- [E5] Application Debugging — <https://www.electronjs.org/docs/latest/tutorial/application-debugging> (DevTools for `BrowserWindow`/`BrowserView`/`WebView` renderers; main process "a bit trickier"; `ELECTRON_ENABLE_LOGGING`/`--enable-logging`).
- [E6] Environment Variables — <https://www.electronjs.org/docs/latest/api/environment-variables> (`ELECTRON_ENABLE_LOGGING`, `ELECTRON_LOG_FILE`, `ELECTRON_ENABLE_STACK_DUMPING`, `ELECTRON_DEFAULT_ERROR_MODE`, `ELECTRON_NO_ATTACH_CONSOLE`).

**Chromium / CDP**

- [C1] `content/browser/devtools/devtools_http_handler.cc` — <https://chromium.googlesource.com/chromium/src/+/main/content/browser/devtools/devtools_http_handler.cc> (read as <https://cdn.jsdelivr.net/gh/chromium/chromium@main/content/browser/devtools/devtools_http_handler.cc>): `/json/version` fields and `webSocketDebuggerUrl`; `/json/list` sorting/filtering and descriptor fields; `/json/new` PUT-only, `/json/activate`, `/json/close`; `DevTools listening on ws://…` on stderr; `DevToolsActivePort`; `Cannot start http server for devtools.`; Host-header and Origin gates; `Inspector.detached`/`target_closed`; traffic annotation scope.
- [C2] `content/browser/devtools/devtools_http_handler.h` — <https://chromium.googlesource.com/chromium/src/+/main/content/browser/devtools/devtools_http_handler.h> (ephemeral-port / active-port-output-directory contract).
- [C3] Chrome DevTools Protocol — <https://chromedevtools.github.io/devtools-protocol/> (domains: `Target`, `Page`, `Input`, `Network`, `Runtime`, `Debugger`; the protocol-version surface).
- [C4] Chrome for Developers, "Changes to remote debugging switches to improve security" (published 2025-03-17) — <https://developer.chrome.com/blog/remote-debugging-port> (Chrome 136: switches no longer honoured for Chrome's default data directory; `--user-data-dir` required).

**Templates**

- [T1] electron-vite CLI — <https://electron-vite.org/guide/cli> (universal/dev/preview options; `--remoteDebuggingPort`, `--inspect`, `--rendererOnly`, `--sourcemap`, `--watch`).
- [T2] electron-vite Debugging — <https://electron-vite.org/guide/debugging> (VS Code `REMOTE_DEBUGGING_PORT: "9222"`, WebStorm `-- --sourcemap --remote-debugging-port=9222`, "renderer debugging can only be attached").
- [T3] electron-vite HMR and Hot Reloading — <https://electron-vite.org/guide/hmr-and-hot-reloading> (`ELECTRON_RENDERER_URL`; `--watch` rebuild/restart on main changes; preload change triggers renderer reload).
- [T4] electron-vite `src/cli.ts` — <https://github.com/alex8088/electron-vite/blob/master/src/cli.ts> (`--remoteDebuggingPort <port>` → `REMOTE_DEBUGGING_PORT`; `--` → `ELECTRON_CLI_ARGS`; `--inspect` → `V8_INSPECTOR_PORT`).
- [T5] electron-vite `src/electron.ts` — <https://github.com/alex8088/electron-vite/blob/master/src/electron.ts> (spawn `[entry].concat(args)`, `--remote-debugging-port=` only when `isDev`, `stdio:'inherit'`, `path.txt` executable resolution, Electron↔Chromium version map `'44': '152'`).
- [T6] Electron Forge CLI `electron-forge-start.ts` — <https://github.com/electron/forge/blob/main/packages/api/cli/src/electron-forge-start.ts> (help text: "Any arguments found after `--` will be passed to the Electron app"; `-l/--enable-logging`; `-i/--inspect-electron`).
- [T7] Electron Forge core `start.ts` — <https://github.com/electron/forge/blob/main/packages/api/core/src/api/start.ts> (`enableLogging` → `ELECTRON_ENABLE_LOGGING` + `ELECTRON_ENABLE_STACK_DUMPING`; `stdio` interactive vs `'inherit'`; `--inspect`/`--inspect-brk` prepend; `restarted` event and `rs` restart).
- [T8] Forge `StartOptions` API — <https://js.electronforge.io/interfaces/_electron-forge_core.StartOptions.html> (`args`, `enableLogging`, `inspect`, `inspectBrk`).
- [T9] `vite-plugin-electron` type declarations (that runner's env-var contract: `REMOTE_DEBUGGING_PORT` appends `--remote-debugging-port=<value>`) — <https://app.unpkg.com/vite-plugin-electron@1.1.0/files/dist/index-B2DXpDtf.d.cts>. Third-party package documentation, not read from the runner's own repository; listed as a hint for the compatibility row, not as a verified behaviour of our launch path.

**Playwright (external Electron attach implementation)**

- [P1] `packages/playwright-core/src/server/electron/electron.ts` — <https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/electron/electron.ts> (`--inspect=0 --remote-debugging-port=0`; `waitForLine` on stderr for `Debugger listening on` / `DevTools listening on`; `webContents.fromDevToolsTargetId`; `Target.closeTarget` hang note; `app.quit()` via the main-process channel; packaged-app caveat).

**Upstream `@linxin666/dsh-client-ui-browser-view` 0.4.19 (surveyed base)**

- [U1] `packages/dsh-browser-view/README.md` — <https://github.com/zhu1090093659/dsh-web/blob/dev/packages/dsh-browser-view/README.md> (attach mode `realBrowserEnabled`/`cdpEndpoint`, security model, "No authentication on the CDP endpoint", "Failure is an error, not a downgrade", Chrome 136 note, known limits).
- [U2] `packages/dsh-browser-view/src/core/cdp.ts` — <https://github.com/zhu1090093659/dsh-web/blob/dev/packages/dsh-browser-view/src/core/cdp.ts> (flat sessions via `Target.setDiscoverTargets` + `Target.attachToTarget({flatten:true})`; browser commands omit `sessionId`; 30 s timeouts; sticky `closed`).
- [U3] `packages/dsh-browser-view/src/host/cdp-endpoint.ts` — <https://github.com/zhu1090093659/dsh-web/blob/dev/packages/dsh-browser-view/src/host/cdp-endpoint.ts> (`parseCdpEndpoint`/`parseCdpWebSocketUrl` loopback-only, no credentials, explicit port; `fetchCdpVersion`).
- [U4] `packages/dsh-browser-view/src/host/loopback.ts` — <https://github.com/zhu1090093659/dsh-web/blob/dev/packages/dsh-browser-view/src/host/loopback.ts> (loopback request fence: socket address, Host header, forwarding headers, same-origin markers).

**Installed DSH 0.2.2-rc.3**

- [D1] `dsh/docs/subsystems/subprocess.md` — installed at `…\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh\docs\subsystems\subprocess.md` (`SubprocessSpawnSpec` `:102-132`; stdin/stdout/stderr modes `:43-89`; handle `:148-175`; offset readers `:186-209`; `done` exit facts `:225`, `:235-240`; `ctx.subprocess.spawn` `:308`; disposal `:277`).
- [D2] `@deepseek-ai/dsh-subprocess-local/README.md` — installed at `…\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-subprocess-local\README.md` (Windows hidden child windows `:28`; Job runner `:43`; collect/spill semantics `:47`; shutdown/taskkill `:66`).

Internal context: [`MAP.md`](../wayfinder/MAP.md):11 (environment), `:51` (native-window embedding out of scope); [`P3-electron-attach.md`](../wayfinder/tickets/P3-electron-attach.md); [`R3-cdp-input.md`](../wayfinder/tickets/R3-cdp-input.md) (screencast/input/snapshot details owned there); [`UPSTREAM.md`](../../UPSTREAM.md) (base package, license finding).
