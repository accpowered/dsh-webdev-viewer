# R1 — DSH plugin APIs and constraints

Research note for `dsh-webdev-viewer` (bundle: Host half + `dsh.client` browser half).
Ticket: [`R1-dsh-plugin-apis.md`](../wayfinder/tickets/R1-dsh-plugin-apis.md).

- **Install examined:** DSH Desktop **0.2.2-rc.3** (`dsh/package.json:4` → `"version": "0.2.2-rc.3"`).
- **Path shorthand used below:** `BASE` = `C:\Users\accpo\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai`.
  All citations below are `BASE\<package>\<file>:<line>`, or `dsh/docs/...` for the installed docs under `BASE\dsh\docs`.
- **Method:** installed docs (`dsh/docs/subsystems/*.md`), package `src/` inside the ASAR (read with the Host file-read tool / an `ELECTRON_RUN_AS_NODE=1` directory reader), plus `cordis_inspect_query` for the live Host service catalog. Nothing was installed, enabled, or modified; the only file written is this note.
- Every claim carries a package/file/line citation read from the installed 0.2.2-rc.3 artifacts. Sentences marked **Inference** are my derivation from those facts, not a documented contract. §14 lists what could not be verified.

---

## 1. Compatibility table

`Class` is the stability judgement for this plugin: **stable** = documented subsystem contract or generated Cordis catalog entry; **private** = reachable and typed but undocumented/internal or explicitly unstable; **avoid** = do not depend on it.

| Surface | Call / artifact | Class | Evidence | Fallback if inspection is unavailable |
|---|---|---|---|---|
| Tab-type registry | `ctx.sidebarRightTabs.register(definition)` (Client) | stable | `dsh/docs/subsystems/sidebar-right.md:36`; `BASE\dsh-client-ui-sidebar-right\src\client\tab-registry.ts:94,253` | Read the package's `README.md` §"Tab-type registration" and `src/client/tab-registry.ts`; slot body in `contract/slots.ts` |
| Tab navigation | `ctx.sidebarRight.openTab(kind,{params,…})`, `openResource(address,{…})` | stable | `…\src\client\service.ts:243,250`; doc `sidebar-right.md:78,84-88` | Doc table of options + `README.md:95-101` |
| Tab lifecycle ops | `close/hide/active/focus/split/float/dock/toggleExpanded` | stable | `…\src\client\service.ts:255-297`; `README.md:103` | — |
| Open in a *named* Session | `ctx.sidebarRight.openResourceIn` / `openTabIn` | **private** | `…\src\client\service.ts:403,416` — concrete-class methods; absent from `ISidebarRight` (`:216-298`) and from `sidebar-right.md` | Not needed: open from the on-screen Session (`openTab`/`openResource`, or `tab.actions.*` inside the body) |
| Tab body slot | `ctx.slots.register({name:'sidebar.right.pane.tab', key:<definition.id>}, Body)` + `useTabInfo()` | stable | `sidebar-right.md:104-110`; `…\contract\slots.ts:189,193` | Owning package `README.md:86` |
| Dock layout engine | `@deepseek-ai/dsh-client-ui-dockkit` (`LayoutState`/`LayoutOp`) | **avoid** | `sidebar-right.md:18` ("an internal dependency of `ui-sidebar-right`, not a stable interface") | Use `ctx.sidebarRight` operations only |
| HTTP routes | `ctx.webServer.register(route)` | stable | `dsh/docs/subsystems/web-server.md:207-222`; `BASE\dsh-host-webserver\src\index.ts` (`WebRoute`, `WebResourceRoute`) | Generated Cordis catalog in `web-server.md` §"Cordis API" |
| WebSocket upgrade | `ctx.webServer.registerUpgrade({path, handler(req,socket,head)})` | stable | `BASE\dsh-host-webserver\src\index.ts:77-82,460`; `web-server.md:224-230` | Same catalog section; exact-path, duplicate path throws |
| Route authentication | `ctx.connection.requestRejection({headers})` → `401\|403\|undefined`; `admit({headers})` → `{peer}` / `{rejection}` | stable | `BASE\dsh-client-connection\src\rpc.ts:98-104,119-121`; `…\src\rpc-host.ts:123-137`; `web-server.md:138,145` | `web-server.md` §`ctx.connection` |
| Index transforms | `ctx.webServer.tapIndex(transform)` | **private** (doc: "escape hatch") | `web-server.md:259-267` | Prefer structured `webserver/index-inject` rows |
| File watching | `ctx.fs.watch(target, changed, signal)` — **direct entries only** | stable | `dsh/docs/subsystems/filesystem.md:402-411`; `BASE\dsh-fs-local\src\index.ts:75-93` (`depth: 0` at `:82`) | Per-directory watches (see §4) |
| Workspace file watch (Remote) | `remote.workspaceFiles.changes(sessionId, path, signal)` | stable | `sidebar-right.md:138`; `BASE\dsh-api-workspace-files\src\changes.ts:39` | Shipped files tree pattern (`BASE\dsh-client-ui-sidebar-files\src\client\face.ts:45,64`) |
| Child processes | `ctx.subprocess.spawn(spec)` → `SubprocessHandle` | stable | `dsh/docs/subsystems/subprocess.md:308`; handle contract `:148-176` | `subprocess.md` §"The fully-explicit spawn spec" |
| Durable images | `ctx.attachments.saveImage({data, mediaType, name})` | stable | `BASE\dsh-attachment\src\index.ts:186`; `…\src\types.ts:127-133` | `attachments` row of the Host service catalog |
| Tool registry / definitions | `defineTool({…})` + `ctx.tools.register(def)` | stable | `BASE\dsh-tools\src\schema.ts:555-557,484-546`; `…\src\index.ts:128` | Generated catalog in `dsh/docs/subsystems/tools.md` |
| Composer insertion | `inputActions.insertQuote / captureInsertion / insertText` | stable | `BASE\dsh-client-ui-conversation\src\client\contract\input.ts:264-280`; `…\contract\slots.ts:395-402` | `conversation.md` + `src/client/input/facade.ts:149-151` |
| Theme tokens | `--dsw-alias-*`, `--dsw-specific-sidebar-fill` CSS vars; `theme/change`; `ctx.theme.overrideTokens` | stable | `BASE\dsh-client-ui-theme\src\client\index.ts:153-168,133-145,388` | `cordis_inspect_query(Theme.listTokens)` when a page is attached |
| Locale | `ctx.locale.register(ns, dicts)` / `ctx.locale.bind(ns)` | stable | `BASE\dsh-client-locale\src\client\index.ts:390-403,443-459` | `web-client.md` / package README |
| Client bundle format | `window.__ModuleLoader__.load({id, factory(require){…}})`, `require` limited to platform seed words | stable | Template `BASE\dsh-agent-preset\skills\dsh-doc\templates\decoration\client.js:1-22`; `BASE\dsh-client-modules\src\client\manifest.ts:362,397-413`; resolution `…\src\client\system.ts:328-340` | Seed list extracted in §9 |
| `dsh.client` manifest | `{platform:'web', immediately?, inject?, external?}` + `./client` export | stable | `…\src\client\manifest.ts:52-68`; validation `…\src\index.ts:905`; template `templates/decoration/package.json:6-20` | Template `package.json` |
| Externals | `dsh.client.external` = package rows (`<pkg>/client` aliases `<pkg>`) or static-table seed words | stable | `BASE\dsh-client-modules\src\index.ts:543-545,567-573` | — |
| Volatile config | schema `meta.volatile` fields; event `loader/volatile-update(paths)` | stable | `BASE\cordis-plugin-loader\src\index.ts:34`; `…\src\config\entry.ts:144-156,184-199`; `…\src\config\diff.ts:18` | Loader `docs`/source; treat as event-only |
| Tool execution context | `exec.agent` → `Agent.id` (public) / `agent.session` (runtime augmentation) | stable (with caveat) | `BASE\dsh-tools\src\contracts.ts:188,245`; `BASE\dsh-agent\src\types.ts:16-19`; `BASE\dsh-agent\src\runtime-types.ts:191-195` | Prefer `exec.agent?.id` (§12) |
| HMR event stream | `dsh-client-hmr` `/plugins/events` SSE + socketless bundle stat poll | **avoid** | `BASE\dsh-client-hmr\src\index.ts:4-5,72,168,207` | Dev-only; do not build features on it |
| Uninstalled type package | `import … from '@deepseek-ai/dsh-client-ui-slots'` on disk | **avoid** | Not present under `BASE` (only `dsh-client-ui-renderer`); it *is* a browser seed word (§9) | Write the client half as plain JS (template) or hand-authored `.d.ts` |
| Cross-plugin DOM/styles | reading another plugin's DOM, stylesheet, or component source | **avoid** | `dsh-agent-preset…\references\ui-plugin.md:13` | Choose a slot that already allocates space |

---

## 2. Right sidebar

**Two registrations per tab type.** "A tab type is two registrations that share the definition's `id`: a static definition in `ctx.sidebarRightTabs` … and a keyed slot registration supplying its body" — `dsh/docs/subsystems/sidebar-right.md:13`. One docking surface per Session: `sidebar-right.md:11`.

**Registration definition** (`BASE\dsh-client-ui-sidebar-right\src\client\tab-registry.ts:94-139`), field by field:

```ts
export interface SidebarRightTabDefinition {
  readonly id: string          // :102  implementation identity, unique across all registrations
  readonly kind: string        // :104  type discriminator; what openTab names
  readonly multiple?: boolean  // :106  "Each open by kind creates independent content;
                               //        omission keeps one page per kind in each pane."
  readonly keepMounted?: boolean // :107-108 "Lazily keep a visited body mounted through hiding,
                                 //        Session changes and docking; default false."
  readonly patterns?: readonly string[]      // :119  omit for a page type
  readonly priority?: SidebarRightTabPriority // :121  default 'extension'
  readonly canOpen?: (address: string) => boolean // :130
  readonly title: (address: string) => string     // :136  captured at open time
  readonly guide?: readonly SidebarRightGuideEntry[] // :138
}
```

`register(definition): () => void` — `tab-registry.ts:253`; duplicate `id` throws `:258`, disallowed kind collision throws `:261`. Priority bands are string literals `extension` (default, highest) / `builtin` / `fallback` — `sidebar-right.md:43`, `README.md:88`; the `id` is also the key the body and title register under — `README.md:85`.

**Opening.** `ISidebarRight` (`…\src\client\service.ts:216-298`) exposes exactly:

| Method | Line | Signature |
|---|---|---|
| `openResource` | 243 | `(address: string, options?: SidebarRightOpenResourceOptions): void` |
| `openTab` | 250 | `<K extends string>(kind: K, options?: SidebarRightOpenTabOptions<K>): void` |
| `close` / `hide` / `active` | 255 / 260 / 265 | `(tabId)`, `(tabId)`, `(): TabRecord \| undefined` |
| `isExpanded` / `toggleExpanded` | 270 / 272 | `(): boolean`, `(): void` |
| `focus` / `split` / `float` / `dock` | 277 / 286 / 292 / 297 | see source |

Options (`sidebar-right.md:84-88`): `paneId`, `replaceTab`, `revealIfOpened` (default `true`), `preferNewPane`, `params`; `openResource` additionally accepts `destination: 'sidebar' | 'float'` and `kind`. Both throw on a wiring mistake (unclaimed address / unregistered kind) — `sidebar-right.md:78`; doc for `destination` (including the "move a copy between hosts" semantics) is `README.md:101`.

**Floating / fullscreen.** `float(tabId, rect?)` — `service.ts:292`; `destination: 'float'` — `README.md:101`; `toggleFullscreen(target)` applies the panel control's display-mode action — `README.md:103`. A body reads both from the injected hook: `useTabInfo()` returns `{ sidebar, panel, tab }` where `sidebar.expanded`/`sidebar.fullscreen` and `panel.id`/`panel.isFloating` follow moves — `contract\slots.ts:189,193`; `sidebar-right.md:110`.

**`keepMounted`.** Definition field `tab-registry.ts:107-108`; behaviour "retains visited bodies across tab and Session changes, collapse, and docking … Unvisited bodies are not mounted eagerly" — `README.md:112`.

**Slots declared by the sidebar** (`sidebar-right.md:104-108`): `sidebar.right.pane.tab` (keyed by `definition.id`, Session scope — the body, docked or floating), `sidebar.right.pane.tab.title`, `sidebar.right.tab.guide` (chain), `sidebar.right.tab.menu.item` (list), `sidebar.right.tab.document` (keyed, for document renderers).

**Service wiring (why the browser half must own this).** `BASE\dsh-client-ui-sidebar-right\src\client\index.ts:92-96` augments `Context` with `sidebarRight: SidebarRightController` and `sidebarRightTabs: SidebarRightTabRegistry`; both are provided from the **client** plugin — `:182-183` (`ctx.reflect.provide('sidebarRightTabs', tabs)` / `provide('sidebarRight', controller)`). A Host half cannot register a tab type.

**Inference (design-relevant):** `openResourceIn`/`openTabIn` exist only on the concrete controller (`service.ts:403,416`) and the README mentions `openResourceIn` (`README.md:101`), but they are not in `ISidebarRight` and not in the subsystem reference. Treat as private; this plugin does not need them.

---

## 3. HTTP routes, WebSocket upgrades, and authentication

**Route shapes** (`BASE\dsh-host-webserver\src\index.ts`):

```ts
export type WebResource = (request: Request, peer?: PeerScope) => Promise<Response>      // :65
export interface WebResourceRoute { kind: WebRouteKind; path: string; resource: WebResource } // :68-74
export interface WebUpgradeRoute {                                                      // :77-82
  path: string   // "Absolute pathname, no trailing slash."
  handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => void | Promise<void>
}
```

`WebRouteKind` is `'exact' | 'prefix'`; match order is "exact table first, then longest matching prefix, then the registered fallback" — `dsh/docs/subsystems/web-server.md:11-25,47`.

**Registration.** `register(route: WebRoute | WebResourceRoute): () => void` — `web-server.md:207-222`; duplicate `(kind,path)` throws. `registerUpgrade(route: WebUpgradeRoute): () => void` — `web-server.md:224-230`: "Register an **exact-path** HTTP upgrade route. Duplicate paths throw because one socket can have only one protocol owner." Implementation `index.ts:460`.

**Authentication is not provided by the carrier.** "The carrier owns no authentication or Origin policy" — `web-server.md:102`. Connection supplies it:

```ts
requestRejection(request: ConnectionTrustRequest): ConnectionRequestRejection // = 401 | 403 | undefined
admit(request: ConnectionTrustRequest): PeerAdmission                         // { peer } | { rejection }
```

Types: `BASE\dsh-client-connection\src\rpc.ts:98-104` (`ConnectionTrustRequest` = `{ readonly headers: Headers | Record<…> }`, `ConnectionRequestRejection`), `:119-121` (`PeerAdmission`), `:124-130` (`ConnectionAdmission`, adds `409` for a second API socket owner). Implementation `…\src\rpc-host.ts:123-137`: `requestRejection` is literally `admit(...)` collapsed to a status; `admit` applies `isTrusted` (Host/Origin fence → `403`), then browser-session cookie auth, then API-credential lookup → `401`. Notes: `isTrusted` reads `ctx.webServer` host/protocol (`rpc-host.ts:164-167`), and the cookie is `Secure` when the carrier serves TLS (`web-server.md:164-171`).

**For a WS upgrade on this deployment:** the upgrade handler receives no Peer, so the Host half must call `ctx.connection.requestRejection({ headers: req.headers })` itself, then write the status and `socket.destroy()` on rejection; on success either keep the raw socket or use `admit` when a `PeerScope` is needed. Both are documented service methods in the generated catalogs (`web-server.md:138,145`).

---

## 4. File watching — `ctx.fs.watch` is **not** recursive

```ts
watch(target: FsTarget, changed: (error?: Error) => void, signal: AbortSignal): Promise<() => Promise<void>>
```
"Observe **one file or a directory's direct entries** in this provider's execution world." — `dsh/docs/subsystems/filesystem.md:402-411`.

The local provider makes the limit explicit (`BASE\dsh-fs-local\src\index.ts:75-93`):

```ts
override async watch(target, changed, signal) {
  …
  const watcher = watch(root, {
    ignoreInitial: true, depth: 0,                    // :82
    ignored: entry => !directory && resolve(entry) !== root && resolve(entry) !== path,
  })
```

So `depth: 0` is a **provider implementation detail with the same effect as the contract**: only the target's own entry (or, for a directory, its direct children) produces events. It is not a caller-supplied option.

**Options for a recursive preview root (recommended order):**

1. **Reuse the shipped tree pattern: one watch per directory, lazily.** The files plugin does exactly this — `BASE\dsh-client-ui-sidebar-files\src\client\face.ts:45` "Observe one directory without recursively watching its descendants" and `:64` `open: lifetime => remote.workspaceFiles.changes(sessionId, path, lifetime)`; `…\src\client\directory-node.ts:120-127` iterates that stream per directory node and handles a `workspace-file/watch-unsupported` code by degrading. Client-side, `remote.workspaceFiles.changes` is the documented Remote (`sidebar-right.md:138`), yields `{kind:'ready'}` then `{kind:'change', change}`, and is what the shipped `files` tab uses.
2. **Host-side fan-out**: `ctx.fs.watch` on the root plus `ctx.fs.listDir` to enumerate, adding/removing watchers as subdirectories appear — correct but O(dirs) watchers; must be inside `ctx.effect` so disposal closes every one (the close function is async: `Promise<() => Promise<void>>`).
3. **Poll**: `ctx.fs.stat`/`listDir` and compare `FsVersion` **by equality only** — versions are opaque tokens whose comparison semantics are unstated (`filesystem.md:44-53`, "MUST NOT interpret this token").
4. `ctx.fs.watch` itself may throw when a backend does not support watching (`filesystem.md:409`), so every watcher needs a degraded path.

---

## 5. Child processes — `ctx.subprocess`

Service: `spawn(spec: SubprocessSpawnSpec): SubprocessHandle` plus `resolveExecutable`, `spawnTerminal`, `terminalEnvironment` — `dsh/docs/subsystems/subprocess.md:280-318`.

**Spawn spec is fully explicit, no defaults** (`subprocess.md:91-133`): `argv: readonly string[]` (never shell-interpreted, `:93`), `cwd`, `stdio` (`{stdin, stdout, stderr, control?}`, `:82-89`), `graceMs` (positive finite, bounded by `MAX_TIMER_DELAY_MS`, `:110-117`), optional `signal` (starts the terminate escalation, `:118-123`), optional `env` merged on the scrubbed parent base (`:124-131`).

**Log collection** — collect mode with optional spill (`subprocess.md:52-68`): `{ maxBytes, spill?: { maxBytes } }`. Result shape `CollectedOutput` = `{ text, truncated, spillPath? }` where `text` is the **tail** when truncated (`:29-37`). Reading is offset-based and non-consuming: `handle.collected.stdout?.readFrom(fromByte)` → `{ text, nextOffset, lossy, spillPath? }` (`:186-209`); "`readFrom(0)` after settlement is the batch result" (`:181-185`). Collected output stays readable after exit (`:225`).

**Termination / exit** (`subprocess.md:148-176`):

- `terminate(): void` — "Begin the provider's documented termination procedure on the managed range — the seam's only termination verb. Idempotent, a no-op once that range is gone, and also triggered by the spec's abort signal."
- `waitForExit(signal?: AbortSignal): Promise<boolean>` — "Wait until the same managed range is empty — **not just until the spawned command reports its outcome**, so surviving work remains observable." Returns `false` if the signal aborted first; throws when the provider can no longer observe the range.
- `done: Promise<SubprocessOutcome>` — `{ exitCode: number | null; signal: Signals | null }`, deliberately **no** timeout/cancel classification (`:227-240`); the caller classifies from the signal it owns.
- "Disposal of the service terminates all still-running managed processes and awaits their exit" (`:277`).

**Inference:** the recommended teardown ladder for a preview dev server is `handle.terminate()` → `await handle.waitForExit(shortBound)` → read `handle.collected.stdout/stderr.readFrom(0)` for the final log; do not rely on `done` alone to mean "gone".

---

## 6. Durable images and `ImageBlock`

**Saving** (`BASE\dsh-attachment\src\index.ts:186`, `…\src\types.ts:127-133`):

```ts
abstract saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef>
// SaveImageAttachment = { data: Uint8Array; mediaType: ImageMediaType; name?: string }
```

Accepted media types are `image/png | image/jpeg | image/webp | image/gif` (`types.ts:8`); the ref is durable/serializable (`types.ts:11-32`) with `attachmentId`, verified `mediaType`, `bytes`, `width`, `height`, optional `name`. Batch: `saveImages` (`index.ts:116-121`); the service also offers `readImage(ref, signal?)` (`:195`) and **`imageHostPath(ref): string | undefined`** (`:203`) — a host path for the stored bytes, which is exactly what a Host-side HTTP route would serve.

**Returning an image from a tool.** A tool definition's content projection returns `ContentBlock[]` — `BASE\dsh-tools\src\contracts.ts:21` and `schema.ts:492-499` (`output: { schema, render(args, value): ContentBlock[] }`). `ImageBlock` is a `ContentBlock` member (`BASE\dsh-llm\src\types.ts:147`):

```ts
export interface ImageBlock { type: 'image'; attachment: ImageAttachmentRef; offloaded?: true }  // types.ts:86-96
```

**Caveat that changes the design** — `dsh-llm/src/types.ts:80-85`: "assistant-side rendering is forward compatibility — **the current production adapters declare text-only output, so only user messages may carry images**." And `dsh-tools/src/presentation.ts` has no image `ToolResultView` kind (kinds present: search `:357`, fetch `:376`, plus generic/read views). So an `ImageBlock` in tool output reaches the model as text/placeholder at best and is not a UI image.

---

## 7. Composer insertion from a session-scoped slot

Every session-scoped slot component receives `inputActions` as a standard prop — `BASE\dsh-client-ui-conversation\src\client\contract\slots.ts:395-402`:

```ts
interface SessionStandardProps {
  useConversation: UseConversation
  useInput: SnapshotSelectorHook<InputState>
  inputActions: InputActions   // ":401 Stable public input actions for this Session."
}
```

and `SessionMaybeStandardProps.inputActions: InputActions | undefined` for scopes that can exist without a Session (`:404-411`).

`InputActions` (`…\contract\input.ts:264-289`):

```ts
insertQuote(text: string, summary?: QuoteSummary): boolean   // :271 nonblank text → Markdown blockquote in the sent message
captureInsertion(): TokenSpan                                // :273 revision-guarded copy of the current selection
insertText(text: string, span: TokenSpan): boolean           // :280 "Insert asynchronous text without replacing
                                                             //       subsequent edits or reference chips"; false when
                                                             //       the draft changed or submission locked the editor
```

Shapes are confirmed by the facade wiring — `…\src\client\input\facade.ts:149-151`: `insertQuote: (text, summary) => this.insertQuote(text, summary)`, `captureInsertion: () => ({ ...this.caretSpan(), draftRev: this.rev })`, `insertText: (text, span) => …`.

**Practical rule:** capture the insertion point *before* the async work, then `insertText` after; a `false` return means the edit was rejected and the caller must not assume insertion.

---

## 8. Theme tokens and locale

**Theme tokens are `--dsw-*`, not `--dsh-*`** (`BASE\dsh-client-ui-theme\src\client\index.ts:153-168`, `BUILTIN_INSPECT_TOKENS`):

`--dsw-alias-bg-base`, `--dsw-alias-bg-layer-1`, `--dsw-alias-bg-layer-2`, `--dsw-alias-bg-overlay`, `--dsw-alias-border-l1`, `--dsw-alias-border-l2`, `--dsw-alias-brand-primary`, `--dsw-alias-label-primary`, `--dsw-alias-label-secondary`, `--dsw-alias-state-error-primary`, `--dsw-alias-state-idle-primary`, `--dsw-alias-state-success-primary`, `--dsw-alias-state-warn-primary`, `--dsw-specific-sidebar-fill` (all `requiresLightAndDark: true`).

- Token descriptor: `ThemeTokenInspection { name, description, valueType, requiresLightAndDark, cssVariable? }` — `:120-131`.
- Runtime API: `overrideTokens(source: string, tokens: ThemeTokenOverrides): () => void` — `:388`; change notification is the `theme/change` emit (`:137-145`).
- `--dsh-*` names do exist but for boot/window chrome only: `--dsh-boot-bg` (`…\dsh-client-ui-theme\src\boot-theme.ts:20-21`) and `--dsh-windows-sidebar-width` (sidebar README `:48`). Do not build the viewer on them.

**Locale** (`BASE\dsh-client-locale\src\client\index.ts`): `register(ns, dict)` / `register(ns, locale, dict)` — overloads at `:390-403`, duplicate namespace+locale throws `:421`; `bind(ns)` returns `(key, params) => string` reading the active locale at call time — `:443-468`; selecting an unregistered locale id throws `:254-258`. The packaged manifest also exports `./locale/*.json` for Plugin Manager/`meta.title` display (`host-plugin.md:31-52`).

---

## 9. Client bundle format, `dsh.client`, and `external`

**Bundle file** — the canonical shape (`BASE\dsh-agent-preset\skills\dsh-doc\templates\decoration\client.js:1-22`):

```js
window.__ModuleLoader__.load({
  id: '@local/my-decoration',           // must equal the package name
  factory(require) {
    const React = require('react')      // platform seed word
    …
    return { inject: ['slots'], apply(ctx) { ctx.slots.inject('conversation.composer.dock', () =>
      ctx.slots.register({ name: 'conversation.composer.dock', id: 'my-decoration', order: 5 }, Decoration)) } }
  },
})
```

"That factory registers a lazy factory whose id equals the package name" and "Keep factories free of side effects. Register styles, timers, listeners … inside `apply` with `ctx.effect`/`ctx.on`" — `dsh-agent-preset…\references\ui-plugin.md:9,13`. Manifest doc: `dsh-client-modules/src/client/manifest.ts:362` ("One client bundle's factory registration submitted through `window.__ModuleLoader__.load`"), target type `:397-413` (`window.__ModuleLoader__?: ClientModuleLoaderTarget`).

**`require` is a closed table** — `…\src\client\system.ts:328-340`: seed word → materialized module → registered package factory; otherwise it **throws** "require(… ) missed the module table — not a platform seed word, not a materialized module, and no registered package factory". The seed words (extracted from the built shell, `BASE\dsh-web-frontend\dist\assets\index-Ciz7DZxv.js` @≈1060895, function `qJ`) are:

```
react, react/jsx-runtime, react-dom, react-dom/client, @deepseek-ai/cordis, zod,
@tanstack/react-virtual, @deepseek-ai/dsh-client-store, @deepseek-ai/dsh-client-ui-slots,
@deepseek-ai/dsh-client-ui-primitives, @deepseek-ai/dsh-client-ui-dockkit
```

**`dsh.client` manifest** — `BASE\dsh-client-modules\src\client\manifest.ts:52-68` (`WebBootEntry`): `id` (== package name), `url`, `rev`, `inject?`, `immediately?` (stage-one prefetch), `external?` ("Non-baseline module specifiers this row requests"). Validation: `platform` must be **`'web'`** or the package is skipped — `…\src\index.ts:905` (`if (decl === undefined || decl.platform !== 'web') return null`); `inject`/`external` must be string arrays (`manifest.ts:148-184`). Declared in `package.json`:

```json
"exports": { ".": "./index.js", "./client": "./client.js" },
"dsh": { "bundle": { "patch": "./cordis.patch.yml" },
         "client": { "platform": "web", "immediately": true,
                     "inject": ["@deepseek-ai/dsh-client-ui-conversation"] } }
```
(template `templates/decoration/package.json:6-20`).

**`external` rules** — "An `external` specifier is either the package row it names (`<pkg>/client` aliases the bare package) or a static-table name that adds no graph edge" (`…\src\index.ts:543-545`); a row naming its own package throws `:569-574`; the composed order guarantees a requested package row precedes its consumer `:551-583`.

---

## 10. Volatile plugin config updates

- A schema field opts in with `meta.volatile`: `BASE\cordis-plugin-loader\src\config\diff.ts:18` — `if (schema?.meta?.volatile) return true`.
- When a config change touches only volatile fields, the Loader **does not remount**: `…\src\config\entry.ts:144-156` — `volatileOnly` requires `changes.length === 1 && changes[0] === 'config'`, `fiber.state === ACTIVE`, an unchanged context prototype, and `equalExceptVolatile(...)`; then `this.fiber.rawConfig = …` and `_commitVolatile()`.
- Committed values are pushed into the running fiber's references and then announced: `…\src\config\entry.ts:184-199` → `fiber.ctx.emit(self, 'loader/volatile-update', paths)`; event type `…\src\index.ts:34` — `'loader/volatile-update'(paths: readonly (readonly string[])[]): void`.
- Failure semantics are safe by design: an invalid candidate is logged and leaves live references unchanged (`:162-179`); a listener throw is logged and does not fail the update (`:195-198`).

---

## 11. Tool definitions and output

`defineTool` (`BASE\dsh-tools\src\schema.ts:555-557`) over `DefineToolOptions` (`:484-546`):

```ts
{
  name, description,
  parameters,                                  // per-property schema compiled to an open object root (:489-490)
  output: { schema, render(args, value): ContentBlock[], presentationMeta? },  // (:492-499)
  deferLoading?, timeoutMs?,
  isConcurrencySafe?(args),
  execute(args, exec: ToolRunContext): Promise<value>,   // (:516)
  projectContent?, finalizeContent?, presentCall?, presentResult?
}
```

Registered with `ctx.tools.register(definition, options?)` — `…\src\index.ts:128`. `ToolDefinition` requires `output` ("Mandatory canonical output declaration") and `execute` returns "only its canonical lossless-JSON value" while observing `exec.signal` — `…\src\contracts.ts:27-40`. The executor's contract: a successful call yields `content: ContentBlock[]` (`contracts.ts:154-155`), plus `projectContent`/`finalizeContent` last-mile hooks (`:50,62`). Tool results are persisted and replayed, so `presentResult` must be pure and tolerate obsolete logged arguments (`schema.ts:548-551`).

---

## 12. Session identity in a tool

- `ToolExecution.agent?: Agent` — `BASE\dsh-tools\src\contracts.ts:188`; `ToolRunContext extends ToolExecution` — `:245`.
- Public `Agent` face: `export interface Agent { readonly id: SessionId }` — `BASE\dsh-agent\src\types.ts:16-19`.
- Runtime augmentation adds the session: `interface Agent { … readonly session: Session }` — `BASE\dsh-agent\src\runtime-types.ts:191-195`; `SessionHeader.id: SessionId` — `BASE\dsh-session\src\types.ts:95-102`.

**Recommendation:** use `exec.agent?.id` — it is on the public interface and already a `SessionId`; `exec.agent.session.id` only exists through the runtime augmentation. Either way the optional chain matters: `agent` is absent for some executions, and the policy layer treats `exec.agent.session` as an opaque key guarded by an optional chain (`dsh/docs/subsystems/filesystem.md:319-325`).

---

## 13. What this means for the design

**Confirmed choices**

1. **One package, two halves.** `package.json` carries `dsh.bundle.patch` (Host row) *and* `dsh.client` (`platform: 'web'`, `inject`, optional `external`) with `"./client": "./client.js"` — exactly the template shape (§9). Nothing else installs a client half.
2. **Tab type registered from the browser half only.** `ctx.sidebarRightTabs.register` + `ctx.slots.register({name:'sidebar.right.pane.tab', key: id})` — the services are provided by `dsh-client-ui-sidebar-right`'s client plugin (§2). Use a page kind (`openTab('webdev-preview', { params })`) — `patterns` are only needed for `dsh-resource://` addresses; `multiple: true` if several previews may coexist in one pane (`tab-registry.ts:106`).
3. **`keepMounted: true` for the preview body**, because a dev-server iframe/log panel must survive tab switches, collapse and docking (`tab-registry.ts:108`, `README.md:112`). Read `sidebar.fullscreen` / `panel.isFloating` from `useTabInfo()` rather than tracking layout yourself.
4. **Control channel = `ctx.webServer.registerUpgrade` on one exact path**, authenticated by the Host half with `ctx.connection.requestRejection({headers: req.headers})`; keep HTTP asset/log routes on `ctx.webServer.register` (`resource` form when it answers GET/HEAD, `handler` form when it needs a Peer or holds the response open, e.g. SSE) — §3.
5. **Recursive preview roots: per-directory watches**, following the shipped files-tree pattern (`remote.workspaceFiles.changes` per expanded node, or `ctx.fs.watch` + `listDir` fan-out), never a single recursive watch — `ctx.fs.watch` is `depth: 0` (§4).
6. **Dev server via `ctx.subprocess.spawn`** with `stdio` collect + `spill`, `graceMs`, and a caller-owned `AbortSignal`; teardown `terminate()` → `waitForExit()` → read `collected.*.readFrom(0)` (§5).
7. **Images:** `ctx.attachments.saveImage` for durability, then either `imageHostPath(ref)` behind our own HTTP route (UI) or `{type:'image', attachment}` inside a tool's `output.render` content (model). Do **not** expect the ImageBlock to render in the transcript (§6).
8. **Composer action:** from a session-scoped slot, `insertQuote(text, summary)`; for async inserts `captureInsertion()` before awaiting and `insertText(text, span)` after, honouring `false` (§7).
9. **Theme:** style with `--dsw-alias-*` / `--dsw-specific-sidebar-fill`; if overriding, supply light **and** dark values (`requiresLightAndDark: true`) through `ctx.theme.overrideTokens`, and refresh on `theme/change` (§8).
10. **Locale:** `ctx.locale.register('dsh-webdev-viewer', { en, zh })` + `bind`; also ship `locale/*.json` for Plugin Manager metadata (§8).
11. **Live settings without remount:** declare the fields with `meta.volatile` and react to `loader/volatile-update(paths)` (§10).
12. **Tools** via `defineTool` with `output.schema` + `render`, registered on `ctx.tools`; identify the Session with `exec.agent?.id` (§11-12).

**Assumptions this research changed**

| Assumed | Actually |
|---|---|
| Theme vars are `--dsh-*` | They are `--dsw-alias-*` / `--dsw-specific-*`; `--dsh-*` is boot/window chrome only (§8) |
| `ctx.fs.watch` watches a tree | Direct entries only; provider passes `depth: 0`; recursion must be composed (§4) |
| A tool `ImageBlock` shows a picture in chat | Adapters are text-only; no image `ToolResultView` exists; the plugin's own tab must render images (§6) |
| `ctx.sidebarRight.openTabIn` is the way to target a Session | Not in `ISidebarRight`; open from the on-screen Session, or use `tab.actions.*` inside the body (§2) |
| The client half can `import type … from '@deepseek-ai/dsh-client-ui-slots'` | That package is **not installed** under `BASE`; it exists only as a browser seed word. Write plain JS (template) or hand-authored types (§9) |
| The web server authenticates plugin routes | It does not — call `ctx.connection.requestRejection`/`admit` yourself (`web-server.md:102`) |
| `ctx.webServer.registerUpgrade` accepts prefix patterns | Exact path only; duplicate paths throw (§3) |
| Reusing the shipped `browser` tab is enough for a localhost preview | It already exists (`openTab('browser', {params:{url}})`, `sidebar-right.md:147`). The differentiator must be the agent tool + control channel, not "display a URL" |

---

## 14. Could not verify / open questions

1. **Live client inspection was unavailable.** `cordis_inspect_query` on the `client` platform timed out on every attempt (`Service.listService`, `Theme.listTokens`): *"Client inspect query … timed out after 10000ms. Open or reconnect the Harness page, then retry."* Consequences: the live Client slot tree (`Slots.listSubTree`), the live theme token directory, and the exact runtime props of `sidebar.right.pane.tab` could not be observed in this session. Everything client-side above is from installed source/docs, not from a live page.
2. **`openTabIn`/`openResourceIn` stability** is a judgement, not a documented rule (§2) — no deprecation or stability note was found either way.
3. **Whether an installed local bundle's `./client` is served without a rebuild** was not tested; `dsh.client` scanning, bundle transport and index injection exist (`clientModules` service), but installation was out of scope for this ticket.
4. **Which packages ship usable `.d.ts`**: verified for `dsh-client-ui-conversation` (`package.json:15,21-23` → `lib/types/client/index.d.ts`); not checked for every client package. Since `dsh-client-ui-slots` is absent, a TS client half cannot rely on the monorepo type graph regardless.
5. **`dsh-fs.watch` behaviour on a preview root outside the workspace/under the Windows sandbox** was not exercised; only the provider implementation was read.
6. **`ctx.subprocess` availability in a Desktop profile** was not exercised — only the service contract and its catalog entry were read.
7. **Sub-agent / background tool executions without `exec.agent`** are inferred from the optional field (`contracts.ts:188`) and the policy layer's optional chain; not observed at runtime.
8. The exact seed-word set was read out of a **minified** shell bundle (`index-Ciz7DZxv.js`, function `qJ`); it is a build artifact of 0.2.2-rc.3 and may change without a documented contract. Treat `external`/`require` targets outside the template's `react` as version-sensitive.

---

## Correction (2026-11-17, lead)

The §6 caveat that "only user messages may carry images" is too broad for our use case. The DeepSeek adapter explicitly supports images in **user messages and tool results** (`dsh-llm-deepseek/src/images.ts:49-50`), and `read_image` returns a text envelope plus an `ImageBlock` (`dsh-tool-fs/src/read-image.ts:200-204`). The shipped `tool.call.images` slot also renders durable images of a settled image-bearing tool call. A screenshot tool that returns an `ImageBlock` is therefore viable for the model; the caveat remains for assistant-authored images and text-only adapters. Use `attachments.imageHostPath(ref)` behind our own route for panel/UI images, not for the model path.
