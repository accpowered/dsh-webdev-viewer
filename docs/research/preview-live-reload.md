# R4 — Static preview, live reload, project runner, security

> Research note for [R4](../wayfinder/tickets/R4-preview-live-reload.md) (`dsh-webdev-viewer`).
> Answers: how to serve a workspace folder as a safe loopback preview, reload it on change, run a
> real dev server, and not turn a local HTTP server into a directory-disclosure or code-execution
> hole.
>
> Verification legend — **[V]** verified in this session by reading the installed source/docs or by
> running a probe; **[D]** documented by a cited primary source, not exercised here; **[E]**
> engineering judgement / estimate; **[U]** could not be verified.

Environment used: DSH Desktop `0.2.2-rc.3`, Electron `44.7.0` (`process.versions.node` =
`24.21.0`), Windows 11, profile `desktop`, GUI `http://127.0.0.1:57841`, install root
`$DSH = C:\Users\accpo\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai`.

---

## 0. Verdict and the five findings that drive the design

**GO**, with the five findings below as non-negotiable constraints for P2:

1. **A per-preview `node:http` server on its own loopback port is the right shape, and DSH already
   documents the exact login idiom** (`token in first URL → 303 → persistent cookie`) in
   `ctx.connection.authorizeIndex` / `authenticatedUrl`, implemented by `dsh-host-frontend-static`
   **[V]** (README lines 46, 52, 68). But the preview must gate **every** byte, not only the index
   URL: DSH's own dist server deliberately leaves assets public (README:46 **[V]**) and the prior
   art hosts through that origin, whereas our assets are the user's private files.
2. **Containment must be a fence, not a segment blacklist**: decode once, reject structural
   segment hazards (backslash, NUL, `:`, trailing dot/space, Win32 device names), let `..`
   normalize, then require the resolved path to stay under the root *and* re-check canonical
   (realpath) identity. Measured on this machine: 23/23 traversal cases behaved correctly, but
   `//server/share/x` is contained (not a UNC escape) only because segments are split and joined
   explicitly — the naive `path.resolve(root, rawUrlPath)` version is an escape **[V, §3.4]**.
3. **`ctx.fs` is a read seam with no sandbox fence**, and its `watch()` is explicitly
   non-recursive ("one file or a directory's direct entries … without polling or recursive
   watching", `@deepseek-ai/dsh-fs-local` README:59) **[V]**. So: containment comes from
   `resolve()`+`contains()`, and the file watcher must be `node:fs.watch` (recursive on
   Windows/macOS) or an explicit recursive walk — not `ctx.fs.watch` per directory on a remote
   backend.
4. **The runner cannot spawn a package manager on Windows without solving the `.cmd` problem.**
   Measured: `child_process.spawn('npm.cmd', …)` → `EINVAL`, because Node does not execute
   `.bat`/`.cmd` without a shell **[V]**; `ctx.subprocess`'s Windows provider launches its target
   through `CreateProcessW` in a Job-owned runner **[V]**, so a resolved `npm.cmd`/`pnpm.cmd` shim
   is not a valid argv[0]. Design: resolve the PM to a real executable, or use one fixed
   `cmd.exe /d /s /c` wrapper with a token-allowlisted command line.
5. **Windows job/child containment is already solved for us, and its one big trap is
   `windowsHide`**: `dsh-subprocess-local` runs ordinary Windows children inside a kill-on-close
   Job (descendants inherit; breakaway processes excluded) and hides their windows **[V]**
   (README:28, 43, 151). That is exactly right for a dev server and exactly wrong for an Electron
   app, whose window would be invisible — Electron needs its own launch path (feeds R5/P3).

**Riskiest security case — see §8.1:** a *containment bypass* (junction / symlink / 8.3 alias /
drive-relative spelling) letting the **previewed page itself** `fetch()` arbitrary local files
with its own session cookie attached. The attacker does not need the token: the page already runs
on the preview origin, so the cookie is automatic and the response is readable by that page. Blast
radius is everything the host user can read, including `~/.dsh` credentials and SSH keys.

---

## 1. What DSH already provides (design constraints, verified)

### 1.1 The primitives we build on

| Need | Seam | What the installed contract actually says | Source |
|---|---|---|---|
| Path identity + containment | `ctx.fs.resolve(path,{cwd})`, `ctx.fs.contains(parent, child)` | `resolve` returns a stable `FsTarget`; the local backend's `targetKey` **is the realpath**, so aliases share identity. `contains` "test[s] canonical containment without exposing or parsing backend target keys" | `@deepseek-ai/dsh-fs` contract **[V, Inspect]**; `@deepseek-ai/dsh-fs-local` README:76 **[V]** |
| Reject symlinks before following | `ctx.fs.lstat(path)` | "path-shaped, not target-shaped … lets a consumer reject the path itself before that follow happens" | `@deepseek-ai/dsh-fs` contract **[V, Inspect]** |
| Bounded byte reads | `ctx.fs.readBytes(t, signal, maxBytes)`, `ctx.fs.readByteRange(t, {offset,length}, signal)` | bounds live at the seam: `readBytes` fails `FS_TOO_LARGE` instead of truncating; `readByteRange` transfers at most `length` and never buffers the file | `@deepseek-ai/dsh-fs` README:57 **[V]** |
| Text streaming | `ctx.fs.streamText` | decoded text only, **binary rejected** — not usable for images/fonts/wasm | contract **[V, Inspect]** |
| Watching | `ctx.fs.watch(target, changed, signal)` | one file **or one directory's direct entries**; no polling, no recursion; close fn must be awaited | `@deepseek-ai/dsh-fs-local` README:59, `@deepseek-ai/dsh-fs` README:38 **[V]** |
| Children | `ctx.subprocess.spawn(spec) → {stdin,stdout,stderr,collected,done,terminate,waitForExit}` | `done` settles the **direct command**; `waitForExit()` observes the **whole managed range** (Job/scope/PGID). Disposal of the service terminates every live managed process and awaits exit | `@deepseek-ai/dsh-subprocess` contract **[V, Inspect]**; `dsh-subprocess-local` README:66 **[V]** |
| Output capture | `collected.stdout.readFrom(offset)` | offset-based, **non-consuming**, keeps last `maxBytes`, optional spill file with full stream; reads past the tail report `lossy` + `spillPath` | `dsh-subprocess-local` README:47 **[V]** |
| Login idiom | `ctx.connection.authorizeIndex(request,response)`, `ctx.connection.authenticatedUrl(url)` | "Authenticate one frontend index request, **owning a token redirect or 401**. The cookie this mints is `Secure` when the mounted Web carrier serves TLS"; `authenticatedUrl` "add[s] the fresh process token to an ordinary Web application URL" | `ctx.connection` Service contract **[V, Inspect]**; behaviour at `dsh-host-frontend-static` README:46 **[V]** |

Two more facts that shape the design:

- **`ctx.fs` reads are not sandbox-fenced.** The desktop profile mounts
  `@deepseek-ai/dsh-fs-sandbox` (which "extends [fs-local] and adds only the mode fence"; the
  fence is a per-call `sandboxPolicy` argument on **mutations** — write/edit/patch/delete/move)
  **[V]**. Preview reads are therefore *our* containment problem, not the sandbox's.
- **`config.cwd` is not containment**: "absolute paths and `..` escape it. Enforce containment with
  a stricter `ctx.fs` backend or a permission plugin" (`dsh-fs-local` README:32,133) **[V]**.

### 1.2 Prior art: `dsh-web-preview-panel` 0.2.4 — license checked, security partially reviewable

Fetched from jsDelivr **[V]**: `package.json`, `README.md`, `LICENSE`, and the jsDelivr file list
(`lib/index.js` 35,711 B host half, `lib/client.js` 61,530 B, `cordis.patch.yml`, `LICENSE`).

- **License: MIT**, `Copyright (c) 2026 zoumutou` (`LICENSE`, 1,065 B) **[V]**. MIT is
  compatible with our Apache-2.0-governed fork plan; attribution + license text must be carried if
  any code is copied. Recommendation: **do not copy** — the architecture differs (§1.3).
- **What it does** (README, Chinese): per-session sidebar preview; workspace static hosting
  *through DSH's own HTTP service* at `/__dsh-preview/<sessionId>/…`; Markdown/code/image rendering;
  project detection for Cargo / `package.json` / `go.mod` / Python with run/stop and log streaming;
  `localhost:PORT` extraction to auto-load the preview; element marking; dropping files into
  `.dsh-drops/` (64 MiB cap); link takeover. Host half is `webServer` routes + `subprocess` +
  `fs`; client half talks to `POST /__dsh-preview/api` (`set-root pages resolve-path
  detect-project run-project project-status stop-project state`).
- **Security read (README/metadata level only):**
  - Hosting on the **DSH origin** means it inherits DSH's browser cookie auth and shares an origin
    with the GUI. That is why it cannot serve a *separate-profile* CDP Chromium: no DSH cookie.
    It also means a same-origin XSS anywhere in the GUI can read workspace files.
  - The drop endpoint writes client-supplied `X-File-Name` under `<root>/.dsh-drops/`; the README
    does not describe name sanitization **[U]**. If we ever add drop-to-workspace, generate the
    filename ourselves and never join a client path.
  - **No live-reload injection is documented** — that feature is our addition, not borrowed.
- **Verification gap [U]:** `lib/index.js` is served as `application/javascript`, which this
  session's fetch path rejects, and the registry metadata carries **no `repository` field**, so
  there is no readable source elsewhere. The review above is therefore README/metadata-level; any
  future decision to *copy* code requires reading the tarball first.

### 1.3 Why not mount the preview on `ctx.webServer`

`ctx.webServer.register({resource})` is available and attractive (`GET`/`HEAD` only, 405 with
`Allow`, backpressure and gzip handled, `request.signal` aborts on disconnect, `dsh-host-webserver`
README:63 **[V]**). It is still the wrong seam for this feature:

1. **Different profile, different cookie jar.** The CDP Chromium is a separate profile; it has no
   DSH browser cookie, and DSH's own index auth would 401 it unless we mint a `connection` token
   for it — coupling a preview to the GUI's auth lifecycle.
2. **Origin separation is a security control.** A preview of arbitrary user HTML must not share an
   origin with the GUI that can call `/api`. A random port gives us a distinct origin for free.
3. **Absolute-root serving.** `/<user-app-path>` on the DSH origin collides with real routes and
   needs a prefix, which breaks apps that emit root-absolute URLs (`/assets/app.js`).
4. **Lifetime.** A preview must die with the preview, not with a shared route table, and must not
   appear in the GUI's route inventory.

So: one `node:http` server per preview, bound to `127.0.0.1:0`.

---

## 2. Per-preview loopback server

### 2.1 Identity

```ts
interface Preview {
  id: string;            // crypto.randomUUID() — UI + logs only
  port: number;          // OS-assigned, from server.address()
  origin: string;        // `http://127.0.0.1:${port}`  (never localhost, never 0.0.0.0)
  cookieName: string;    // `dshpv_${id.slice(0, 8)}` — unique per preview, see §2.5
  cookieValue: string;   // base64url(randomBytes(32)) — never logged
  tokens: Map<sha256hex, { expiresAt: number; used: boolean }>;
  rootTarget: FsTarget;  // ctx.fs.resolve(workspaceRoot)
  rootPath: string;      // canonical absolute path (also used for watcher + prefix checks)
  generation: number;    // bumped by the watcher; monotonic; survives reconnects
  server: http.Server;
  sse: Set<http.ServerResponse>;
  watcher?: { close(): Promise<void> };
}
```

### 2.2 Boot sequence (the only path that mints a session)

```
createPreview(root, opts):
  target   = await ctx.fs.resolve(root)                  // realpath identity
  assert await ctx.fs.stat(target)?.type === 'directory'
  assert NOT driveRoot(target) && NOT isInside(dshDataDirs, target)   // §8 guard rails
  secret   = base64url(randomBytes(32))
  token    = base64url(randomBytes(32))
  tokens.set(sha256(token), { expiresAt: now + tokenTtlMs, used: false })
  server   = http.createServer(handler)
  server.on('clientError', dropSocket)                   // no error pages, no header echo
  server.keepAliveTimeout = 5_000
  await listen(server, { host: '127.0.0.1', port: 0, exclusive: true })
  port     = server.address().port
  url      = `http://127.0.0.1:${port}/__dsh/enter?t=${token}`   // the ONLY URL with a token
  startWatcher(preview)
  return { id, url, origin }
```

The tokenized URL is handed to the CDP browser and **nowhere else**: not to logs, not to the panel
protocol (the panel gets `origin` after login or an opaque handle), not to the agent's tool result.
`tokenTtlMs` default `120_000`; `maxPreviews` default `4`.

### 2.3 Route table

Served at the origin root, so user apps keep their own absolute paths:

| Route | Method | Auth | Behaviour |
|---|---|---|---|
| `/__dsh/enter?t=<token>` | GET | token | 303 → `/`; mints cookie; consumes token; `no-store`, `no-referrer` |
| `/__dsh/live` | GET | cookie | SSE stream (§5.2) |
| `/__dsh/live.js` | GET | cookie | the injected client script (constant, `no-store`) |
| `/__dsh/rev` | GET | cookie | `{"generation":N}` — polling fallback for SSE |
| `/__dsh/health` | GET | cookie | `{"ok":true,"port":N}` — readiness probe only |
| everything else | GET/HEAD | cookie | static file (§3, §4) |
| any route | others | — | 405 + `Allow: GET, HEAD` |

There is **no** POST/PUT body handling in v0.1: no uploads, no file writes, no `set-root` over
HTTP. Preview management stays on the Host RPC/panel protocol, never on the HTTP surface. That
removes a whole class of CSRF and body-parsing bugs.

### 2.4 Header policy

Applied to every response, then overridden per route:

```
Cache-Control: no-store                     // HTML, /__dsh/*, 4xx
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Cross-Origin-Resource-Policy: same-origin
Cross-Origin-Opener-Policy: same-origin
X-Frame-Options: SAMEORIGIN                 // we do not need to be framed by anything else
Permissions-Policy: ()                      // optional; keeps generated pages boring
```

- **No CORS headers, ever.** We want cross-origin reads of this origin to fail.
- **No `Server` banner** (`server.keepAlive`/`res.setHeader('Server', …)` omitted; Node sends none
  by default).
- **`no-referrer` on the `/__dsh/enter` response specifically**, so the tokenized URL cannot leak
  through a `Referer` from anything the browser does before/around the redirect.
- `Content-Security-Policy` is **not** set for user content: it would break real apps and the
  origin holds nothing but the preview. (The preview is `http://127.0.0.1:P`, which browsers treat
  as a *potentially trustworthy* origin, so `crypto.subtle`, service workers and secure-context
  APIs work — a deliberate benefit of loopback.)

### 2.5 The login handler, exactly

```
handleEnter(req, res):
  hostHeader = req.headers.host ?? ''
  if hostHeader !== `127.0.0.1:${port}`            -> 403 (DNS-rebinding guard, §8)
  if req.method !== 'GET'                           -> 405
  t = url.searchParams.get('t') ?? ''
  if t === ''                                       -> 401
  key = sha256(t)
  rec = tokens.get(key)
  if !rec || rec.used || rec.expiresAt < now:
      tokens.delete(key)                            // one look, no oracle
      warn('preview login rejected', { id, reason: rec ? (rec.used ? 'replay' : 'expired') : 'unknown' })
      return send401(res)
  rec.used = true                                   // single use: consume BEFORE minting
  // no string comparison of the presented token: the Map key IS sha256(presented),
  // so a wrong token simply misses the entry (fixed-length digest, no prefix oracle)
  res.writeHead(303, {
    Location: '/',
    'Set-Cookie': `${cookieName}=${cookieValue}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`,
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
  })
  res.end()
```

Why each attribute:

| Attribute | Decision | Reason |
|---|---|---|
| `HttpOnly` | yes | the previewed page must not be able to read its own session cookie (it does not need it) |
| `SameSite=Strict` | yes | same-origin only; nothing legitimate arrives cross-site |
| `Path=/` | yes | assets live at arbitrary paths |
| `Max-Age=43200` | 12 h | browser keeps the session across a dev-server restart; dispose clears server state, not the cookie — see the caveat below |
| `Secure` | **no** | we serve plain HTTP on loopback. Adding `Secure` would depend on browser-specific loopback exceptions, and loopback HTTP is not a downgrade we are defending against (an attacker who can sniff `127.0.0.1` already runs as the user) |
| `Domain`, `__Host-` prefix | omitted | the prefix requires `Secure`; `Domain` would widen the cookie's host |

**Cookie-jar caveat that must be in the code review [D, RFC 6265 §4.1.2, §5.4]:** cookies are
scoped by host and path, **not port**. So `127.0.0.1:P` and DSH's `127.0.0.1:57841` *share* a
cookie jar: our preview requests will carry DSH's cookies in `Cookie`, and a page on the preview
origin can set cookies that the GUI later sends. Consequences baked into the design:
never log/echo `Cookie`; per-preview random cookie names; and (checklist item) treat the GUI's
own session cookie as HttpOnly-only — see §8.2.

### 2.6 One-time token semantics

- Stored as `sha256(token)`, compared by map key (no plaintext comparison, no timing oracle).
- `used` is set **before** the redirect is written, so a concurrent second request loses.
- Expiry is checked on read; expired entries are deleted opportunistically (`maxPreviews` previews
  × a handful of tokens — bounded).
- Replay, expiry and unknown token all return the **same** body-less 401, and are logged with
  identity only (never the presented value).
- Tokens are minted only by preview creation/restart. There is no "regenerate" route; a compromised
  token is useless after first use or 120 s.
- **Not** in the URL after login: the 303 sends the browser to `/`, so history/bookmarks hold the
  clean origin. `Referrer-Policy: no-referrer` covers the window during the redirect.

### 2.7 Multiple previews

- One `http.Server`, one port, one cookie name, one token store **per preview**; the registry is a
  `Map<previewId, Preview>` on the plugin's fiber, capped at `maxPreviews` (default 4).
- Previews never share a root or a port; the watcher and the SSE set are per preview.
- Disposal order per preview: stop watcher → `res.end()` every SSE response → `server.close()` +
  `closeAllConnections()` (copying `dsh-host-webserver`'s disposal shape, README:89 **[V]**) →
  stop any runner owned by the preview.
- `ctx.effect()` owns the registry, so plugin unload closes every server even if the UI forgets.

---

## 3. Path containment (Windows-first)

### 3.1 Threats and the decision for each

| Input shape | Example | Why it matters | Decision |
|---|---|---|---|
| dot-dot segments | `/../x`, `/%2e%2e/x`, `/a/../../x` | classic traversal | normalize, then fence; escape → **403** |
| encoded separator | `/..%5cx`, `/a%2fb` | Windows accepts `\` as separator; some stacks decode twice | decode once, reject any `\` in the result → **403** |
| double encoding | `/%252e%252e/x` | second decode by a proxy/framework | reject if a `%HH` survives decoding → **403** |
| absolute / drive | `/C:/Windows/win.ini`, `/%43%3a/…`, `C:Windows\x` | drive-absolute and drive-*relative* (`C:foo`) all leave the root | any `:` in a segment → **403** |
| UNC | `//server/share/x`, `\\server\share\x` | `path.resolve(root,'//server/share')` is `\\server\share` = escape | never pass the raw URL path to `path.resolve`; split segments; a literal `\` → **403**; a `//`-prefixed *URL* path becomes a relative path inside the root and 404s |
| symlink / junction | `link → C:\Users\x\.ssh` | the file is inside the root lexically, outside canonically | `lstat` rejects a symlink path; **and** canonical `contains(root, resolved)` must pass → **403** |
| 8.3 short names | `/PROGRA~1/x` | `~` aliases bypass string comparisons | canonical check resolves them; lexical check is not trusted alone |
| case | `/INDEX.HTML` | NTFS is case-insensitive by default | allowed (resolves to the same file); never compare case-sensitively on Windows |
| reserved device names | `/CON`, `/nul.txt`, `/com1` | `<root>\CON` is a *device*, not a file | reject the Win32 reserved set → **403** |
| trailing dot/space | `/index.html.`, `/x%20` | Win32 strips them ⇒ maps to a different real file | reject segments ending in `.` or ` ` → **403** |
| alternate data streams | `/a::$DATA`, `/a.txt:zone` | colon syntax reads streams / other files | covered by the `:` rule → **403** |
| NUL and control chars | `/x%00.png` | truncates paths in native APIs | reject `\0` (and `<0x20`) → **403** |
| dotfiles | `/.env`, `/.git/config`, `/sub/.env` | secrets live in dotfiles | deny by default (allowlist `.well-known`) → **403** |
| percent-garbage | `/%c0%ae%c0%ae/x` | overlong UTF-8 tricks | `decodeURIComponent` throws → **400/403** |
| long segments | 4 000-char segment | ENAMETOOLONG / DoS | reject segment > 255 → **414** |

### 3.2 Three layers, in order (all must pass)

1. **Syntactic fence** — decode exactly once, then per-segment rejects above. Cheap, no I/O, and it
   is what turns malformed input into a clean 403 instead of an `fs` error.
2. **Lexical fence** — `path.resolve(root, ...segments)` and require
   `rel = path.relative(root, resolved)` to satisfy `rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))`.
   This is the same shape as DSH's own `serveStatic` fence, including its Windows lesson: compare
   with `path.sep`, not `'/'` ("`resolve()` emits backslash paths on Windows, where a `/` suffix
   would reject every legitimate subpath as traversal", `dsh-host-frontend-static` README:68 **[V]**).
3. **Canonical fence** — `canonical = realpath(root)` vs `realpath(target)` (native, so junctions
   and 8.3 aliases resolve), then `ctx.fs.contains(rootTarget, childTarget)` where an `FsTarget`
   is available. Handles symlinks, junctions, case and short names in one step.

**Deliberate policy choices:**

- `..` that *normalizes inside* the root is served (browsers and proxies do send `/a/b/../c`; DSH's
  own fence works the same way) **[E]**.
- **Symlinks and junctions are denied by default** (`followSymlinks: false`). The canonical fence
  should catch an escaping link on its own, but that depends on Node resolving Windows *reparse
  points* correctly on the path the backend uses, and a dev preview rarely needs links. Opt-in
  `followSymlinks: true` keeps the canonical fence as the only gate, for pnpm-style workspaces and
  monorepo `public/` links.
- A symlink *inside* the root under the default policy is still a 403: the rule is "no links",
  not "no escaping links", because a rule that is easy to state is a rule that is easy to test.

### 3.3 Pseudo-code (this is the version that was executed)

```ts
const RESERVED = /^(con|prn|aux|nul|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])(\..*)?$/i;
const ALLOWED_DOT_PATHS = new Set(['.well-known']);   // the only dot-segment we serve

async function resolveRequest(rawPath: string): Promise<Result<Target>> {
  if (rawPath.includes('\\')) return reject('raw-backslash');
  let decoded: string;
  try { decoded = decodeURIComponent(rawPath); } catch { return reject('bad-percent'); }
  if (decoded.includes('\\'))  return reject('encoded-backslash');
  if (decoded.includes('\0'))  return reject('nul');
  if (/%[0-9a-f]{2}/i.test(decoded)) return reject('double-encoding');

  const segments: string[] = [];
  for (const seg of decoded.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { segments.push('..'); continue; }         // normalized by the fence
    if (seg.length > 255)        return reject('segment-too-long');
    if (seg.includes(':'))       return reject('colon');
    if (/[ .]$/.test(seg))       return reject('trailing-dot-or-space');
    if (RESERVED.test(seg))      return reject('reserved-name');
    if (seg.startsWith('.') && !ALLOWED_DOT_PATHS.has(seg)) return reject('dotfile');
    segments.push(seg);
  }

  const abs = path.resolve(root, ...segments);                    // lexical fence
  const rel = path.relative(root, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return reject('escapes-root');

  const info = await ctx.fs.lstat(abs);                            // reject the path, not the target
  if (info === undefined) return { notFound: true };
  if (info.type === 'symlink') {
    if (!followSymlinks) return reject('symlink');
    // opt-in: fall through to the canonical fence — it is the only gate left
  } else if (info.type !== 'file' && info.type !== 'directory') {
    return reject('not-a-file');
  }

  const child = await ctx.fs.resolve(abs);                         // canonical fence
  if (!ctx.fs.contains(rootTarget, child)) return reject('canonical-escape');
  const canonical = await ctx.fs.stat(child);
  if (canonical === undefined) return { notFound: true };
  if (canonical.type === 'directory') return { directory: child };
  if (canonical.type !== 'file') return reject('not-a-file');
  return { file: child, size: canonical.size };
}
```

Note the two-pass shape: **`lstat` before `resolve`** is exactly the ordering `dsh-fs` prescribes
("callers that reject symlink sources use `lstat` before `resolve`", README:124 **[V]**).

### 3.4 Measured behaviour of this algorithm (23 cases, run on Windows)

Fixture: `<temp>\fixture\` with `index.html`, `sub/a.css`, `sub/.env`, `sub/deep/`; secret file
`<temp>\outside-secret.txt` outside the root. Symlink creation was **not possible in this session**
(`EPERM`, no Developer Mode), so the symlink rows are the one unexercised path — see §3.6.

| Request path | Result |
|---|---|
| `/index.html` | **SERVE** `index.html` |
| `/sub/deep/../a.css` | **SERVE** `sub\a.css` (normalized, contained) |
| `/sub/../index.html`, `/./sub/../index.html` | **SERVE** `index.html` |
| `/INDEX.HTML` | **SERVE** (NTFS case-insensitive; canonical check passes) |
| `//server/share/x` | 404, contained as `server\share\x` — **not** a UNC escape |
| `\\server\share\x` | REJECT `raw-backslash` |
| `/../outside.txt`, `/a/../../outside.txt`, `/../../outside.txt` | REJECT `escapes-root` |
| `/%2e%2e/outside.txt`, `/%2E%2E/outside.txt`, `/%2f%2e%2e/x`, `/..%2fx` | REJECT `escapes-root` |
| `/sub/%2e%2e/%2e%2e/outside.txt`, `/sub/../../outside.txt` | REJECT `escapes-root` |
| `/C:/Windows/win.ini`, `/C:Windows/win.ini`, `/a%3a/b` | REJECT `colon` |
| `/sub/.env` | REJECT `dotfile:.env` |
| `/index.html%00.png` | REJECT `nul` |
| `/%c0%ae%c0%ae/x` | REJECT `bad-percent` (invalid UTF-8) |

The interesting negative result: **`//server/share/x` is only safe because the implementation never
passes the raw URL path to `path.resolve`.** A naive `path.resolve(root, req.url)` turns
`//server/share/x` into the UNC path `\\server\share\x`, and the fence then either rejects a
legitimate-looking request or — worse, in an implementation without a fence — opens a network
share. Split-then-join is the rule; write it down in the code.

### 3.5 Dotfiles, deny list, and other serving policy

- **Dotfiles denied by default** (any segment starting with `.`), allowlist `{'.well-known'}`.
  This is the single most valuable rule: `.env`, `.git/config` (which can contain credentials in
  remote URLs), `.npmrc`, `.aws/`, `.ssh/` are all one segment away.
- **Root guard rails:** refuse a preview root that is a drive root (`C:\`), the user's home
  directory itself, `%USERPROFILE%\.dsh`, `%APPDATA%`, or any ancestor of the DSH profile
  directory. Rationale: containment at `C:\` is vacuous, and previewing `~` would expose the DSH
  credential store by design.
- **`node_modules` is readable but not watched** (§6): Vite-style apps reference it from
  `/node_modules/.vite/...` and blocking it breaks real previews; it contains no secrets by
  convention.
- **No directory listing.** A directory without `index.html` is 404 (or the SPA fallback, §4.2).
  DSH makes the same call for its dist server (README:42 **[V]**).
- Response for a rejected path is **403 with an empty body** (DSH's choice, README:52 **[V]**), and
  the reason string goes to the Host log only — never to the browser (no path echo, no oracle).

### 3.6 What could not be verified here **[U]**

Creating a file symlink failed with `EPERM` (unprivileged Windows without Developer Mode), and
`cmd.exe`/`mklink` is blocked in this research sandbox (`EPERM` on spawn), so the junction case is
designed but not executed. P2 must cover it: `mklink /J <root>\escape <outside>` needs no
elevation, and `ctx.fs.contains` (realpath identity) is the mechanism that must catch it.
Also unverified: behaviour on a per-directory case-sensitive NTFS folder (WSL), and a workspace on
a UNC path (where `path.relative` between two UNC paths is still lexical and fine, but should be
tested once).

---

## 4. Serving files

### 4.1 MIME

Fixed table (extension → media type), no sniffing, no `mime-db` dependency:

```
.html .htm              text/html; charset=utf-8
.js .mjs .cjs           text/javascript; charset=utf-8      // RFC 9239: text/* is COMMON, application/javascript is OBSOLETE
.css                    text/css; charset=utf-8
.json .map .webmanifest application/json; charset=utf-8 / application/manifest+json
.svg                    image/svg+xml
.png .jpg .jpeg .gif .webp .avif .ico   image/*
.woff2 .woff .ttf .otf  font/woff2 | font/woff | font/ttf | font/otf
.wasm                   application/wasm
.md .txt .xml .csv      text/markdown; charset=utf-8 | text/plain | application/xml | text/csv
.mp4 .webm .mp3 .wav    video/* | audio/*
.pdf                    application/pdf
everything else         application/octet-stream        + X-Content-Type-Options: nosniff
```

`text/javascript` is the HTML default and the only COMMON registration; `application/javascript`
is listed as an obsolete alias (RFC 9239 §2, §6.1.1, §6.2 **[D]**). Serve `.mjs`/`.cjs` as
`text/javascript` too — `.mjs` means "parse as a module", not "different media type" (RFC 9239
§6.1.1). Never rely on the OS MIME registry on Windows (it maps `.js` to `text/plain` on some
installs) **[E]**.

### 4.2 Index, SPA fallback, 404

```
GET /                 -> <root>/index.html
GET /sub/             -> <root>/sub/index.html   (else 404; no listing)
GET /sub              -> 301 to /sub/  IF <root>/sub is a directory  (relative links stay correct)
otherwise             -> file, or 404
```

- **301 for a directory without the trailing slash** is required, not cosmetic: without it,
  `sub/page.html` resolves `a.css` to `/a.css` instead of `/sub/a.css`.
- **SPA fallback is opt-in per preview** (`spaFallback: false` default). When it is on, a `GET`
  with `Accept: text/html`, **no file extension in the last segment**, and not under `/__dsh/`
  serves `index.html` with **200**. Everything else 404s. DSH's dist server deliberately does *not*
  fall back ("a stale link or a mistyped pathname is an explicit failure rather than a silent SPA
  fallback", README:52 **[V]**); we keep the same default and let the runner path (Vite/Next)
  provide real SPA routing anyway.
- **404 is empty**, no HTML, no path echo. Asset misses in a preview app are extremely common; an
  HTML 404 page from us would be injected into `<img>`/`fetch` handlers and confuse the app.
- **403 for rejected paths, 405 for methods**, per §2.3.

### 4.3 Range requests

Support **single** byte ranges only; the browser cases that matter are `<video>`/`<audio>` seeking
and download resume.

```
parseRange(header, size) -> {start,end} | 'full' | 'unsatisfiable'
  m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())   // multi-range -> no match -> 'full' (200) is legal
  if !m                                     -> 'full'
  a = m[1]; b = m[2]
  if a === '' && b === ''                   -> 'full'
  if a === '':                              // suffix: last N bytes
      n = Number(b); if n === 0             -> 'unsatisfiable'
      start = Math.max(0, size - n); end = size - 1
  else:
      start = Number(a); end = (b === '' ? size - 1 : Number(b))
  if start >= size || start > end           -> 'unsatisfiable'   // 416 + `Content-Range: bytes */${size}`
  if end >= size: end = size - 1            // clamp, do not 416
  return { start, end }                     // 206 + Content-Range + Content-Length = end-start+1
```

Statuses are exactly the three the spec names: 206 on success, 416 when no range overlaps, 200
when ranges are unsupported (MDN "HTTP range requests" **[D]**). `Accept-Ranges: bytes` goes on
every successful file response, not only ranged ones, so clients know they may ask. Honour
`If-Range` by comparing our weak ETag: mismatch ⇒ serve the full 200 (MDN **[D]**). We do **not**
implement `multipart/byteranges`; a multi-range request gets a full 200, which is always legal.

### 4.4 Large files, cancellation, backpressure

The seam gives us exactly the right primitive: `readByteRange(target, {offset,length})` is bounded
by the *window*, not by the file ("a backend transfers at most the requested `length` bytes … and
never buffers the whole file", `dsh-fs` README:57 **[V]**).

```ts
async function serveFile(req, res, file: FsTarget, size: number) {
  const etag = `W/"${size.toString(16)}-${mtimeMs.toString(16)}"`;   // no hashing cost
  const range = parseRange(req.headers.range, size);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', 'no-cache');                        // revalidate, never stale-serve
  if (req.headers['if-none-match'] === etag && !range) return res.writeHead(304).end();
  if (range === 416) { res.writeHead(416, {'Content-Range': `bytes */${size}`}); return res.end(); }

  // HTML injection path is the only place we buffer, and only up to HTML_MAX (5 MiB)
  if (isHtml && injectLiveReload && size <= HTML_MAX) {
    const bytes = await ctx.fs.readBytes(file, ac.signal, HTML_MAX);   // bounded by HTML_MAX
    const html  = inject(new TextDecoder('utf-8').decode(bytes), generation);
    res.writeHead(range ? 206 : 200, { ...typedHeaders(range, size), 'Content-Length': Buffer.byteLength(html) });
    return res.end(html);
  }

  const { start, end } = range ?? { start: 0, end: size - 1 };
  res.writeHead(range ? 206 : 200, typedHeaders(range, size));       // 200 -> Content-Length: size
  if (req.method === 'HEAD') return res.end();

  const CHUNK = 256 * 1024;
  let offset = start;
  while (offset <= end) {
    if (ac.signal.aborted) return;                                   // client gone: stop reading
    const want = Math.min(CHUNK, end - offset + 1);
    const buf  = await ctx.fs.readByteRange(file, { offset, length: want }, ac.signal);
    if (buf.byteLength === 0) return;                                // file shrank while serving
    offset += buf.byteLength;
    if (!res.write(buf)) await once(res, 'drain');                    // backpressure, not buffering
  }
  res.end();
}
```

- **Cancellation** is one `AbortController` per request, aborted from `res.on('close')` (fires on
  both normal end and client abort in Node 24). It is passed to every `ctx.fs` read; no
  half-finished `fs` handle outlives the response. `dsh-host-webserver` relies on the same
  "client disconnect aborts `request.signal` and cancels the body" property (README:63 **[V]**).
- **Backpressure**: `res.write() === false` ⇒ `await once(res, 'drain')`. Never buffer a whole file.
- **`HEAD`** sends headers only, and must still be correct (`Content-Length`, `ETag`,
  `Accept-Ranges`).
- **No compression**: SSE and ranges must not be transformed, and DSH's own carrier excludes both
  from gzip (README:41 **[V]**). A dev preview on loopback has no bandwidth argument.
- **Timeouts**: `server.headersTimeout = 30_000`, `server.requestTimeout = 0` (a preview is
  long-lived and the SSE response must not be reaped), `keepAliveTimeout = 5_000`.
- **File removed mid-serve**: `readByteRange` returns empty ⇒ end the response silently (do not
  throw, do not log a stack per asset during a rebuild).

---

## 5. HTML injection and SSE live reload

### 5.1 Injection rules

- Only for `text/html` responses with status 200, `Content-Length` known, size ≤ 5 MiB, method
  `GET`, and only when `injectLiveReload` is on.
- Insert **before the last `</body>`** (case-insensitive, last occurrence) else append at EOF.
- Idempotence marker: skip if `<script id="__dsh-live"` is already present.
- Never inject under `/__dsh/*`, and never into the runner's dev-server traffic: Vite/Next own
  their HMR, and injecting there would double-reload.
- Content:

```html
<script id="__dsh-live" src="/__dsh/live.js" data-generation="{{n}}"></script>
```

External file (not inline) keeps the HTML cacheable, keeps the injected bytes tiny, and — because
it is *same-origin* — survives a page CSP of `script-src 'self'`. A page that sets a nonce/hash
policy will block it; that is acceptable and documented (the page's own policy wins).

### 5.2 SSE endpoint

```ts
function handleLive(req, res, p: Preview) {
  if (p.sse.size >= SSE_CAP) return res.writeHead(503, {'Retry-After': '5'}).end();  // before headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',           // harmless here, correct if someone fronts it
  });
  res.write(`retry: 1000\n\n`);
  send(res, 'hello', { generation: p.generation });   // send = (res,event,obj) => res.write(`event: ${event}\ndata: ${JSON.stringify(obj)}\n\n`)
  p.sse.add(res);
  const hb = setInterval(() => res.write(': ping\n\n'), 15_000);
  const done = () => { clearInterval(hb); p.sse.delete(res); };
  res.on('close', done);
}
```

Events:

| event | data | client action |
|---|---|---|
| `hello` | `{generation}` | record generation, do **not** reload |
| `reload` | `{generation, path, reason}` | if `generation >` seen ⇒ `location.reload()`, preserving scroll |
| `css` | `{url, generation}` | re-request `<link>` with `?v=generation` (no full reload) |
| (comment) | `: ping` | keep-alive; browsers ignore it |

The client script (~25 lines, served as `/__dsh/live.js`):

```js
(() => {
  var gen = Number(document.getElementById('__dsh-live').dataset.generation || -1);
  var es = new EventSource('/__dsh/live');
  es.addEventListener('hello', e => { gen = Math.max(gen, JSON.parse(e.data).generation); });
  es.addEventListener('reload', e => {
    var g = JSON.parse(e.data).generation;
    if (g <= gen) return;                      // dedupe: hello + reload races
    gen = g;
    try { sessionStorage.setItem('__dsh_scroll', String(scrollY)); } catch (_) {}
    location.reload();
  });
  es.addEventListener('css', e => {
    var d = JSON.parse(e.data);
    document.querySelectorAll('link[rel=stylesheet]').forEach(l => {
      var u = new URL(l.href, location.href);
      if (u.pathname !== new URL(d.url, location.href).pathname) return;
      var n = l.cloneNode(); n.href = u.pathname + '?v=' + d.generation;
      l.addEventListener('load', () => l.remove(), { once: true }); l.after(n);
    });
  });
  // SSE unavailable (proxy, CSP, too many connections) -> poll the same generation
  es.onerror = () => { setTimeout(() => {
    fetch('/__dsh/rev').then(r => r.json()).then(d => {
      if (d.generation > gen) { gen = d.generation; location.reload(); }
    }).catch(() => {});
  }, 2500); };
  try { var y = sessionStorage.getItem('__dsh_scroll'); if (y) scrollTo(0, +y); } catch (_) {}
})();
```

### 5.3 Reconnect semantics

- `EventSource` reconnects automatically; `retry: 1000` pins the delay to 1 s instead of the
  implementation-defined default (typically a few seconds) — we want a snappy dev loop
  **[D, MDN EventSource]**.
- The stream is stateless: a reconnecting client gets `hello {generation}` and reloads only if its
  own generation is older. This removes the need for `Last-Event-ID` replay logic entirely — with a
  monotonic generation counter, "latest state" is the only state **[E]**.
- Heartbeat every 15 s defeats idle-connection reaping and gives the client a positive liveness
  signal.
- If a file changes **while** a reload is in flight, the new event carries a higher generation and
  triggers exactly one more reload (the client dedupes by generation, so no storm).

### 5.4 Multiple previews

- One SSE set per preview; a change in preview A never touches B (separate watchers, separate
  ports, separate `generation` counters).
- **Connection budget**: over HTTP/1.1 browsers cap SSE at ~6 connections *per browser + origin*
  (MDN EventSource warning **[D]**). Each preview is its own origin (its own port), so previews do
  not stack, but many tabs of *one* preview do. Guard: cap SSE responses per preview at 8; when
  the cap is hit, answer `503` to `/__dsh/live` — the injected client already degrades to polling
  `/__dsh/rev`. When the preview server goes down, the stream ends and the polling fallback takes
  over (it 401s, so the client stops polling after 3 failures).
- A preview reload does not drop the SSE connection (same page origin), so one tab holds exactly
  one connection.

---

## 6. File watching

### 6.1 Choosing the mechanism **[V for the constraints, E for the choice]**

| Option | Recursive? | Watchers | Cross-platform | Verdict |
|---|---|---|---|---|
| `ctx.fs.watch` per directory | **No** — "one file or a directory's direct entries … without polling or recursive watching" (`dsh-fs-local` README:59) | 1 per directory ⇒ thousands | yes, but each dir is a provider round-trip | reject as primary |
| `node:fs.watch(root, {recursive: true})` | yes on Windows/macOS; `ERR_FEATURE_UNAVAILABLE_ON_PLATFORM` elsewhere | **1** | Windows/macOS native; Linux needs the walk | **primary** |
| `node:fs.watch` per directory (walk) | by walking | 1 per dir (inotify limit) | yes | **Linux fallback** |
| `chokidar` 6 | yes (its `auto` backend literally is "native recursive watching on macOS and Windows and native per-directory watching elsewhere") | 1 / N | yes | not needed; adds a dependency and its glob-free `ignored` API for what we do in 30 lines |
| stat polling | yes | 0 | yes | **degraded mode** (network drives, `ENOSPC`, watcher failure) |

Chokidar's own README is the honest summary of why raw `fs.watch` needs help: it "reports many
changes as a non-transparent `rename`, can fire twice for one change, and recursive watching differs
across platforms" **[D]**. Our design takes the primitive that is reliable where we ship (Windows
native recursive) and adds the two normalizations that matter (mtime+size dedupe, debounce).

`ctx.fs.watch` remains the right seam if a future version previews a *remote* workspace; that is
explicitly out of scope for v0.1 and must be noted in the UI.

### 6.2 Exact defaults

```ts
const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', '.jj',
  'dist', 'build', 'out', '.next', '.nuxt', '.output', '.svelte-kit', '.angular', '.astro',
  '.vercel', '.netlify', 'coverage', 'target', 'vendor',
  '.venv', 'venv', 'env', '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.tox',
  '.gradle', '.idea', '.vscode', '.turbo', '.cache', '.parcel-cache', '.vite', '.pnpm-store',
  '.yarn', '.dsh', '.dsh-drops',
]);
const IGNORED_FILE = /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$|\.(log|tmp|swp|swx|swo|tsbuildinfo)$|~$/i;

const WATCH_DEFAULTS = {
  debounceMs: 150,        // trailing edge
  maxWaitMs: 1000,        // leading-max so a continuous build still notifies once/second
  dedupeWindowMs: 250,    // same path+mtime+size ignored again inside this window
  maxDirs: 2000,          // recursive-walk fallback budget
  maxFiles: 50000,
  scanConcurrency: 8,
  scanTimeoutMs: 3000,
  pollIntervalMs: 1000,   // degraded mode only
  sseCapPerPreview: 8,
};
```

Rationale for each group: `node_modules` is 10⁴–10⁵ files and churns during install; `.git`
churns on every status/fetch and contains packed objects; `dist`/`build`/`out`/`.next`/… are
*generated by the very processes we watch*, so watching them creates a reload feedback loop;
caches and editor/IDE dirs are noise. File patterns cover editor scratch files and logs that would
otherwise reload on every line appended.

### 6.3 Pseudo-code

```ts
// per-preview state: seen: Map<rel,{mtimeMs,size}>, pending: Map<rel,{css}>, debounce timer
async function startWatcher(p: Preview) {
  const onEvent = (abs: string) => {
    const rel = toPosix(path.relative(p.rootPath, abs));
    if (isIgnored(rel)) return;                              // JS-side filter (see §6.4)
    const st = statOrNull(abs);                              // unlink -> null
    const prev = seen.get(rel);
    if (st && prev && prev.mtimeMs === st.mtimeMs && prev.size === st.size) return; // dup event
    seen.set(rel, st && { mtimeMs: st.mtimeMs, size: st.size });
    if (!st && !prev) return;                                // vanished before we saw it
    pending.set(rel, { css: /\.css$/i.test(rel) });
    schedule();                                              // debounce 150 / maxWait 1000
  };

  try {
    // one native subscription; we do not distinguish rename from change (stat decides)
    const w = fs.watch(p.rootPath, { recursive: true, persistent: false }, (_ev, file) => {
      if (file === null) return scheduleRescan();             // platform gave no name: rescan
      onEvent(path.join(p.rootPath, file.toString()));
    });
    w.on('error', () => degradeToPolling(p));
    p.watcher = { close: async () => w.close() };
  } catch (err) {
    if (err.code === 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM') return startPerDirectoryWatchers(p);
    return degradeToPolling(p);
  }
}

function flush() {
  const batch = [...pending.entries()];                      // [[rel, {css}], …]
  pending.clear();
  if (batch.length === 0) return;
  p.generation += 1;
  const cssOnly = batch.every(([, b]) => b.css);
  broadcast(cssOnly ? 'css' : 'reload', { generation: p.generation, path: batch[0][0] });
}
```

Dedupe/coalescing rules, in order: ignore filter → mtime+size identity → debounce window
(`150 ms` trailing, `1000 ms` max wait) → batch classification (`css` only if *every* path in the
batch ends in `.css`). A burst of 20 writes from a formatter is one reload; a `tsc --watch`
rewriting 200 files once a second is at most one reload/second.

### 6.4 Bounds and failure modes

- **Where the ignore list is enforced differs by platform, and that difference matters.** On Linux
  the per-directory walk *never subscribes* to `node_modules`/`.git`/`dist`, so an `npm install` is
  invisible to us. On Windows/macOS a single recursive subscription is OS-level and cannot exclude
  subtrees: we still receive (and must cheaply drop) events for `node_modules`, and a very large
  churn can overflow the OS change buffer. Mitigation: filter in the callback (no `stat` for ignored
  paths — test the path first), and treat a burst above 5 000 events/s as "polling for 2 s, then
  one coalesced reload" rather than trying to track every event. Chokidar documents the same hazard
  from the other direction — "Chokidar watches everything under the paths you give it, so scope
  them" **[D]**.
- Recursive-walk fallback: breadth-first, `maxDirs`/`maxFiles` caps, `scanConcurrency 8`,
  `scanTimeoutMs 3000`; exceeding a cap logs `preview.watch.degraded` and keeps watching only the
  directories already opened, plus polling for the rest.
- `file === null` from `fs.watch` (no filename reported): schedule one full rescan instead of
  guessing which path changed.
- `ENOSPC` (Linux inotify) / `EMFILE`: log once with the actionable hint (chokidar documents the
  same failure and the `fs.inotify.max_user_watches` fix, README "Troubleshooting" **[D]**) and
  switch to polling.
- Watcher dies (`'error'`) or the root disappears: keep the server up, emit no reloads, surface a
  panel warning with a "restart preview" action. Never crash the Host over a watcher.
- Never watch the preview server's own files (nothing is written by us).
- `persistent: false` so a watcher can never keep the Host process alive at shutdown.

---

## 7. Project detection and runner

### 7.1 Detection (marker → kind)

| Marker (in root) | Kind | Default script | Default port |
|---|---|---|---|
| `package.json` + `vite.config.{js,ts,mjs,cjs}` | Vite | `dev` | 5173 |
| `next.config.{js,ts,mjs}` | Next | `dev` | 3000 |
| `nuxt.config.{js,ts}` | Nuxt | `dev` | 3000 |
| `astro.config.{js,ts,mjs}` | Astro | `dev` | 4321 |
| `svelte.config.js` | SvelteKit | `dev` | 5173 |
| `angular.json` | Angular | `start` (`ng serve`) | 4200 |
| `package.json` with `react-scripts` | CRA | `start` | 3000 |
| `package.json` only | npm script | `dev` → `start` → `serve` → `develop` → `watch` | — |
| `Cargo.toml` | Cargo | `cargo run` | — |
| `go.mod` | Go | `go run .` | — |
| `pyproject.toml` / `app.py` / `manage.py` | Python | `manage.py runserver` / `uvicorn` / `python -m http.server` | 8000 |
| `index.html` and none of the above | **static** | no runner — serve it ourselves (§3) | our port |

Order matters: framework config files beat a generic `package.json` script list, and a static
`index.html` with no package manager must never trigger a run attempt.

### 7.2 Package manager and script choice

```
packageManager field in package.json (corepack) -> that exact PM + version
else pnpm-lock.yaml                           -> pnpm
else yarn.lock / .yarnrc.yml                  -> yarn
else bun.lock / bun.lockb                     -> bun
else package-lock.json / npm-shrinkwrap.json  -> npm
else (no lockfile)                            -> npm
```

Script: intersect `package.json.scripts` with `['dev','start','serve','develop','watch']` and take
the first match; validate with `/^[A-Za-z0-9:@._-]{1,64}$/` before it ever reaches an argv. If
`scripts.dev` exists but the framework marker says otherwise (e.g. a `next` config with
`"dev": "node scripts/serve.js"`), the **script** wins — it is what the project actually runs.

### 7.3 The command allowlist, and the Windows `.cmd` problem

**Only these argv shapes are constructible.** The runner has no `command` string input from the
model or the UI, so "run this shell command" is not expressible. Mode (a) — the default — never
names a `.cmd`:

```
# (a) no shell: real executables only
[nodePath,  <pmCliJs>, 'run', script]        // npm  -> <npm>/bin/npm-cli.js
                                             // pnpm -> <pnpm>/bin/pnpm.cjs
                                             // yarn -> <yarn>/bin/yarn.js
[bunPath,   'run', script]                   // bun is a native .exe on Windows
['cargo',   'run']                           // Cargo
['go',      'run', '.']                      // Go
[pythonPath,'-m', 'http.server', String(port)] // static fallback only

# (b) explicit shell wrapper, only when the resolved PM is a .cmd/.bat shim
['cmd.exe', '/d', '/s', '/c', `${pm} run ${script}`]   // pm ∈ {npm,pnpm,yarn}, script validated
```

Never constructible: a user/model-supplied command, a package script name outside
`[A-Za-z0-9:@._-]{1,64}`, `&&`, `|`, `>`, quotes, or a second argument after the script.

Measured facts that shape the wrapper **[V]**:

- `child_process.spawn('npm.cmd', ['--version'])` with no shell throws **`EINVAL`** on Windows:
  Node cannot execute `.bat`/`.cmd` directly. `resolveExecutable` on Windows *will* resolve a bare
  `npm` to `npm.cmd` (it appends `PATHEXT` entries). So a naive
  `spawn({argv:['npm','run','dev']})` fails at the seam.
- `ctx.subprocess`'s Windows provider launches the target through `CreateProcessW` inside a
  kill-on-close Job runner (`windows-job.ts`, `spawn-runner.ts`), so it inherits the same
  restriction — a `.cmd` shim is not a valid argv[0].

Two acceptable solutions; **prefer (a)**:

**(a) Bypass the shim — resolve the PM's JS entry and run it with Node.**
`resolveExecutable('node')` gives a real `.exe`; then the PM CLI relative to the resolved shim
(`<node>\node_modules\npm\bin\npm-cli.js`, `pnpm\bin\pnpm.cjs`, `yarn\bin\yarn.js`) or the
`packageManager`-pinned corepack shim. Pros: no shell, real process tree, no quoting. Cons:
per-PM path knowledge, versions move files around.

**(b) One fixed `cmd.exe` wrapper, token-allowlisted.** `argv = ['cmd.exe','/d','/s','/c', line]`
where `line` is built **only** from the enum above plus a regex-validated script name; no user
string, no `&&`, no `|`, no quotes from outside. Pros: works for every PM and version. Cons: it is
a shell, so the allowlist must be airtight and reviewed; `cmd.exe` inherits the Job and is killed
with the tree (good).

The design keeps (a) as the default and (b) as an explicit, config-gated fallback
(`runner.shellWrapper: 'cmd' | 'auto' | 'never'`, default `'auto'` = use `cmd.exe` only when the
resolved PM path ends in `.cmd`/`.bat`). Either way the *command string* is never attacker-shaped.

> **[U]** Whether `cmd.exe` is spawnable at all under the DSH runtime was **not** testable here:
> this research sandbox rejected `cmd.exe` spawns with `EPERM` (same for a bare `npm`), which is a
> sandbox policy, not Node behaviour. P2 must confirm (a) and (b) inside a real DSH session.

### 7.4 Log parsing and readiness

Real startup banners (user-reported, treated as data — external, unverified as product
documentation, but these are the shapes we must parse) **[D]**:

```
# Vite 7 (vite.dev, from a user terminal transcript)
VITE v7.0.4  ready in 345 ms
➜  Local:   http://localhost:5173/
➜  Network: use --host to expose
➜  press h + enter to show help

# Next.js 16 (Turbopack)
▲ Next.js 16.0.7 (Turbopack)
- Local:        http://localhost:3000
- Network:      http://198.18.12.81:3000
✓ Starting...
✓ Ready in 983ms

# Nuxt 4
│ ● Nuxt 4.5.2 (with Nitro 2.13.4, Vite 8.2.1 and Vue 3.5.41)
➜ Local: http://localhost:3000/
➜ Network: use --host to expose

# Astro (note: no colon after "Local", and box-drawing bullets)
┃ Local    http://localhost:4321/
┃ Network  use --host to expose
🚀 astro v3.1.4 started in 200ms

# Angular (ng serve)
Watch mode enabled. Watching for file changes...
➜  Local:   http://localhost:4200/
➜  press h + enter to show help
```

Design consequences, all of which come straight out of the samples:

1. **The bullet glyph is not stable** (`➜`, `┃`, `-`, `│`). Do not anchor on it.
2. **The label may or may not have a colon** (Astro `Local    http://…` vs Vite `Local:`), and the
   label word varies (`Local`, `Listening`, `Running`, `Server`, `URL`).
3. **Raw bytes contain ANSI**, `\r` progress rewrites, and box-drawing characters. Strip ANSI
   first, split on `\r` as well as `\n`.
4. **Two candidate URLs are normal** (Local + Network). Pick Local; the Network URL is usually a
   non-loopback address we must not navigate the CDP browser to (and may not be reachable at all
   behind a VPN).

```ts
const ANSI = /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;
const URL_RE = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])(?::(\d{1,5}))?([^\s"'<>`]*)?/gi;
const POS = /\b(local|listening|running|ready|started|url|server)\b/i;
const NEG = /\b(network|lan|ipv[46]|expose|devtools|docs?)\b/i;

function candidateFromLine(line: string): { url: string; score: number } | null {
  const clean = line.replace(ANSI, '').replace(/\r/g, '');
  const m = URL_RE.exec(clean);
  if (!m) return null;
  let host = '127.0.0.1';
  const port = m[1] ? Number(m[1]) : null;
  if (port === null || port < 1 || port > 65535) return null;
  let path = (m[2] ?? '/').replace(/[.,;:)\]}]+$/, '') || '/';   // trailing punctuation
  let score = 0;
  if (POS.test(clean)) score += 2;
  if (NEG.test(clean)) score -= 3;
  if ([5173, 3000, 4200, 4321, 8000].includes(port)) score += 1;
  return { url: `http://${host}:${port}${path}`, score };
}
```

Readiness is a **race of three** (first wins):

1. **URL detected** → probe loop: `GET` the URL every 250 ms, up to 1.5 s, accept *any* HTTP status
   (dev servers legitimately answer 404/500 on first hit — the port answering is the signal);
2. **`handle.done` settles** before (1) → fail fast with `RUNNER_EXITED_EARLY`, exit code, last 40
   log lines;
3. **`readyTimeoutMs` (default 120 000)** → `RUNNER_READY_TIMEOUT`, then terminate.

Fallback when no banner is ever parsed: probe `http://127.0.0.1:<framework default port>` a few
times (some servers print nothing), then fail with `RUNNER_NO_URL` and the log tail; the action is
"the URL field is editable" — the user can paste it and the panel navigates.

### 7.5 Failure and cleanup paths

| Failure | Detection | Response |
|---|---|---|
| No runnable script | detection result empty | `RUNNER_NO_SCRIPT` + the list of available scripts; no spawn |
| Port already in use | log contains `in use` / `EADDRINUSE`; Vite says `Port 5173 is in use, trying another one...` | keep waiting — the *next* banner carries the real port; if none appears, `RUNNER_PORT_IN_USE` naming the port |
| Exits non-zero before ready | `done` rejects/settles, exitCode ≠ 0 | `RUNNER_EXITED_EARLY` + code + tail |
| Non-zero **after** ready | `done` settles while ready | panel state `crashed`, logs kept, preview stays on the last good URL |
| Stop while starting | `stop()` during the readiness race | abort race → `terminate()` → `await waitForExit(graceMs)`; if still alive, `RUNNER_STOP_TIMEOUT` and keep the handle for retry |
| Double start | state ≠ `idle` | reject `RUNNER_ALREADY_RUNNING`; UI shows Stop |
| Plugin unload / session teardown | `ctx.effect` disposal | `terminate()` every runner, `await waitForExit()`; the service's own disposal guarantees termination of live managed processes anyway (`dsh-subprocess` contract **[V]**) |
| Host crash / power loss | — | out of scope: only JavaScript-observable exits clean up; a real `SIGKILL`/crash needs an external supervisor (`dsh-subprocess-local` README:66,155 **[V]**) |

### 7.6 Process lifecycle details

```ts
const handle = ctx.subprocess.spawn({
  argv,                                   // from the §7.3 allowlist only
  cwd: preview.rootPath,
  stdio: {
    stdin: 'ignore',
    stdout: { maxBytes: 1 << 20, spill: { maxBytes: 32 << 20 } },
    stderr: { maxBytes: 1 << 20, spill: { maxBytes: 32 << 20 } },
  },
  graceMs: 5000,
  env: runnerEnv(),                       // minimal, see below
});

async function stop() {
  if (state === 'idle' || state === 'stopping') return;
  state = 'stopping';
  readyRace.abort();
  handle.terminate();                     // Job kill on Windows; scope/PGID on Linux
  const exited = await handle.waitForExit();   // true = managed range is quiescent
  state = exited ? 'idle' : 'stop-timeout';
}
```

- `done` and `waitForExit` are **different promises** and both matter: `done` is the direct child's
  outcome (what the user sees as "exit code"), `waitForExit` is the whole Job/scope becoming empty
  (what proves no orphan `esbuild`/`next-server` survives). Never `await done` and call it cleanup.
- `terminate()` already escalates per the provider's documented ladder (Windows: Job kill; fallback
  `taskkill /PID <pid> /T /F`, `dsh-subprocess-local/src/spawn.ts` **[V]**); do not hand-roll
  `taskkill`.
- **Environment**: pass a minimal env — `PATH`, `PATHEXT`, `SystemRoot`, `USERPROFILE`/`HOME`,
  `TEMP`/`TMP`, `LANG` — plus `BROWSER=none` (CRA/some tools open a browser otherwise),
  `NO_COLOR=1` and `FORCE_COLOR=0` (fewer ANSI sequences; we still strip), `CI` **unset** (setting
  it changes Next/Vite behaviour). Do **not** forward the Host's full env: the provider already
  scrubs `*KEY*/*PASSWORD*/*SECRET*/*TOKEN*` names (`dsh-subprocess-local` README:156 **[V]**),
  but a dev server has no business seeing the rest of the Host's variables.
- **`windowsHide` trap**: the Windows provider starts ordinary children hidden — including "GUI
  windows that honor the process startup visibility setting" (README:28,43 **[V]**). A dev server
  is the intended case; an **Electron** app launched through this seam would be invisible. Electron
  therefore needs its own launch path/config (R5/P3), or an explicit exception.
- **Log retention**: a ring buffer of 500 lines / 256 KiB per runner in the Host, plus the
  provider's spill file for the complete stream when a user asks for it. ANSI stripped before
  storage. Redact `/(?:token|secret|password|api[_-]?key)\s*[:=]\s*\S+/gi` before the buffer, so a
  chatty dev server cannot leak a `.env` value into the panel or the agent's context.
- **Never** write the token or the `Cookie` header into logs: the preview server and the runner
  share the Host logger, so redaction belongs in one place.

---

## 8. Security checklist

### 8.1 The riskiest case, stated plainly

> **The previewed page reads arbitrary local files through a containment bypass.**
>
> The page runs *on* the preview origin, so it can `fetch('/…')` with its own HttpOnly cookie
> automatically attached, and it can read the response body. The attacker is therefore the
> content being previewed — an LLM-generated page, a cloned repo's dev app, a compromised npm
> dependency, or an XSS in the user's own code. A junction, symlink, 8.3 alias, drive-relative
> spelling, or a second-decoding proxy that slips past the fence turns `readdir` of the workspace
> into `read` of `%USERPROFILE%\.ssh\id_rsa`, `%USERPROFILE%\.dsh\profiles\desktop\…`, `.env`
> files, browser profile data, or DSH credentials.
>
> Mitigations, all required: three-layer containment (§3.2) with **`lstat` before `resolve` and
> canonical `contains`**; dotfile denial; a preview-root guard rail (never `C:\`, never `%USERPROFILE%`,
> never an ancestor of the DSH profile dir); `no-store`/`nosniff`; and the regression table in §9
> as a blocking test. Second-ranked risk: the shared cookie jar for host `127.0.0.1` (§2.5, §8.2).

### 8.2 Checklist

| # | Rule | Why |
|---|---|---|
| S1 | Bind `127.0.0.1` only, never `0.0.0.0`/`::`/LAN; assert `server.address().address === '127.0.0.1'` after listen | a LAN-exposed dev preview is a directory-disclosure service (`dsh-host-webserver` README:39 **[V]**, `dsh-bash-sandbox` precedent) |
| S2 | Port `0` (OS-assigned), never a fixed port | fixed ports collide and are predictable |
| S3 | Token minted per preview, stored only as `sha256`, single-use, 120 s TTL, looked up by digest (no plaintext compare, no prefix oracle) | a local process that scans ports must not get in |
| S4 | Token only in the first URL; 303 to `/`; `Referrer-Policy: no-referrer` on the exchange; never log it | history, `Referer`, and log-scraping leaks |
| S5 | Cookie: `HttpOnly; SameSite=Strict; Path=/; Max-Age`; **unique name per preview**; no `Secure` needed on loopback | cookie jar is host-scoped, not port-scoped (RFC 6265 §4.1.2) |
| S6 | Reject any request whose `Host` ≠ `127.0.0.1:<port>` | DNS rebinding turns an attacker page into a same-origin client |
| S7 | No CORS headers; `Cross-Origin-Resource-Policy: same-origin`; `X-Frame-Options: SAMEORIGIN` | other origins must not read or embed preview content |
| S8 | Only `GET`/`HEAD`; everything else `405 + Allow` | the preview surface is read-only by construction |
| S9 | Three-layer containment, `lstat` before `resolve`, canonical `contains` | the headline risk, §8.1 |
| S10 | Dotfiles denied by default; allowlist `.well-known` | `.env`, `.git/config`, `.npmrc` |
| S11 | Preview root guard rails (drive root, home, `%APPDATA%`, DSH profile ancestors) | containment at `C:\` is vacuous |
| S12 | 403/404 responses are empty; reasons go to the Host log only | no path echo, no oracle |
| S13 | Never log or echo `Cookie`, `Authorization`, or the token; redact `token/secret/password/key=` in runner logs | one logger, one redaction point |
| S14 | Runner argv comes only from the §7.3 allowlist; no model/UI-supplied command string; script name regex-validated | no arbitrary shell by default |
| S15 | Shell wrapper (`cmd.exe`) is opt-in, fixed-flag, token-constructed, and reviewed as a code path | §7.3(b) |
| S16 | Minimal runner env; `BROWSER=none`; never forward Host secrets | provider scrubs `*TOKEN*` etc., but do not rely on it |
| S17 | Runner output is bounded (ring buffer + provider spill), ANSI-stripped, redacted | a huge log is a Host OOM; a chatty log is a leak |
| S18 | `terminate()` then `await waitForExit()` on stop, dispose, and preview close; Job kill handles the tree | orphaned `esbuild`/`next-server` processes are the normal failure |
| S19 | CDP endpoint stays loopback-only and is never put in a URL handed to a page | R5; a `--remote-debugging-port` exposed beyond loopback is remote code execution |
| S20 | Preview never shares an origin with the DSH GUI; preview cookies never used for GUI calls | origin separation is the isolation boundary |
| S21 | `maxPreviews` cap, SSE cap, request/body limits on the HTTP surface | local DoS by a runaway page |
| S22 | Every preview disposed with `ctx.effect`; `server.close()` + `closeAllConnections()` | no listener survives a plugin unload |

Two items that are **not** ours to fix but must be raised with the GUI owner **[U]**: (1) DSH's own
browser cookie should be `HttpOnly` (otherwise a page on `127.0.0.1:P` could read it via
`document.cookie`, since cookies ignore ports); (2) the GUI's API should keep rejecting
mismatched `Origin` on same-site requests, which is what stops a preview page from CSRF-ing
`/api` (its `Origin` would be `http://127.0.0.1:P`).

---

## 9. Test plan (each row is a blocking case for P2)

Harness: `node:test` + a real `http.createServer` on port 0, requests issued with `fetch` and with
raw sockets for malformed input; fixtures created in `os.tmpdir()`; no CDP needed except the
recorded walkthrough.

**Server & auth**

| # | Case | Expected |
|---|---|---|
| T1 | `GET /` without cookie | 401, zero body bytes from any file |
| T2 | `GET /__dsh/enter?t=<valid>` | 303, `Location: /`, `Set-Cookie` has `HttpOnly; SameSite=Strict; Path=/`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store` |
| T3 | Replay the same token | 401 + one warning log, no `Set-Cookie` |
| T4 | Unknown token / empty `t` | 401, identical body and headers to T3 |
| T5 | Token after expiry (`tokenTtlMs: 1`) | 401 |
| T6 | Cookie from preview A on preview B | 401 |
| T7 | `Host: evil.example:<port>` | 403, no file access |
| T8 | `POST`/`PUT`/`DELETE`/`OPTIONS` on any route | 405 + `Allow: GET, HEAD` |
| T9 | `HEAD /index.html` | 200, empty body, correct `Content-Length` |
| T10 | `GET /` and `GET /sub/` | `index.html` served; no listing |
| T11 | `GET /sub` (dir without slash) | 301 → `/sub/` |
| T12 | SPA fallback on: `/route/x` vs `/route/x.js` vs `/__dsh/live` | 200 index, 404, SSE |
| T13 | SPA fallback off: `/route/x` | 404 |
| T14 | `Range: bytes=0-3` / `bytes=-500` / `bytes=1000-` / `bytes=5-2` / `bytes=0-1,4-5` | 206 + `Content-Range`; 206; 206; 416 + `bytes */size`; 200 full |
| T15 | `If-None-Match: <etag>` | 304, empty |
| T16 | 200 MiB file: serve, abort mid-stream | RSS delta bounded; no leaked fd (assert `process.getActiveResourcesInfo()` settling) |
| T17 | Client disconnects during HTML injection path | no unhandled rejection |
| T18 | 23-row traversal table (§3.4) | every row rejected/404, never the outside file's bytes |
| T19 | Dotfiles: `/.env`, `/.git/config`, `/sub/.env`; allowed: `/.well-known/x` | 403, 403, 403, 404 (contained) |
| T20 | Junction escape (`mklink /J`), Linux `ln -s` escape | 403 (canonical fence) |
| T21 | Symlink **inside** root (default policy) | 403 (`followSymlinks: false`) |
| T21b | Same symlink with `followSymlinks: true` | served; escaping link still 403 via canonical fence |
| T22 | MIME: `.js`, `.mjs`, `.wasm`, `.svg`, `.unknown` | `text/javascript`, `text/javascript`, `application/wasm`, `image/svg+xml`, `application/octet-stream` + nosniff |
| T23 | Grep the captured Host log for the token, `Set-Cookie` value, `Cookie:` header | zero hits |

**Live reload**

| # | Case | Expected |
|---|---|---|
| T24 | Edit `index.html` | exactly one `reload` within 500 ms; page reloads once |
| T25 | 20 writes in 100 ms | one reload (coalesced) |
| T26 | Edit `a.css` | `css` event, **no** full reload; `<link>` swapped |
| T27 | Two previews, edit A's root | only A reloads |
| T28 | Kill the SSE socket server-side | client reconnects within ~1 s and receives the next event |
| T29 | Two tabs of one preview | both reload; SSE count ≤ cap; `503` beyond cap then client polls `/__dsh/rev` |
| T30 | Page sets `Content-Security-Policy: script-src 'self'` | injected script still loads (same-origin) |

**Watcher**

| # | Case | Expected |
|---|---|---|
| T31 | Write in `node_modules/x`, `.git/HEAD`, `dist/a.js` | zero reload events |
| T32 | 20 000-file `node_modules` | watcher setup < 150 ms, 0 watchers inside it; memory delta bounded |
| T33 | Editor atomic save (tmp + rename) | exactly one event |
| T34 | Rename/delete a watched file | one `reload`, no crash |
| T35 | `chmod`/touch with no content change (same mtime+size) | no event |
| T36 | `fs.watch` failure injected (`ENOSPC`) | degrades to polling, logs once, server stays up |

**Runner**

| # | Case | Expected |
|---|---|---|
| T37 | Vite project | detects `dev`, spawns, parses `http://localhost:5173/`, navigates |
| T38 | Next 16 project | parses `- Local: http://localhost:3000`, ignores the Network URL |
| T39 | Astro project | parses `┃ Local    http://localhost:4321/` (no colon) |
| T40 | `package.json` without a runnable script | `RUNNER_NO_SCRIPT`, no spawn |
| T41 | Script exits 1 immediately | `RUNNER_EXITED_EARLY` + tail |
| T42 | Port in use (`Port 5173 is in use, trying another one...`) | second banner's port is used |
| T43 | `stop()` during startup | process gone (`waitForExit` true), no orphan (process-table assertion) |
| T44 | Unload the plugin with a runner live | child terminated |
| T45 | Windows argv assertion | `argv[0]` ends in `.exe`/`.js` (never `.cmd`) or is `cmd.exe` under the explicit wrapper |
| T46 | ANSI + `\r` progress output | URL still parsed; stored logs contain no `\u001b` |
| T47 | No URL ever printed | falls back to the default-port probe, then `RUNNER_NO_URL` |
| T48 | Log redaction | a line `API_TOKEN=abc123` is stored as `API_TOKEN=<redacted>` |

Recorded walkthrough for the ticket's own acceptance: open `index.html` → edit → see reload →
start Vite → see logs + page → stop → assert no orphan.

---

## 10. What this means for the design

**Locked decisions**

1. One `node:http` server per preview on `127.0.0.1:0`, separate origin, `GET`/`HEAD` only.
2. Login = one-time token in the first URL → 303 → `HttpOnly; SameSite=Strict` cookie (unique name
   per preview). Every byte after that requires the cookie, including assets.
3. Containment = syntactic segment rejects + lexical fence + canonical (`lstat` → `resolve` →
   `contains`) fence, with symlinks/junctions denied by default (`followSymlinks: false`; opt-in
   re-checks canonically). Implemented and measured on Windows; the junction row is P2's first
   test.
4. Serving: fixed MIME table (`text/javascript`, not `application/javascript`), single-range 206,
   416 with `bytes */size`, `no-cache` + weak ETag for assets, `no-store` for HTML/`/__dsh/*`,
   `readByteRange` in 256 KiB chunks with `drain` backpressure and an `AbortController` per request.
5. Live reload = injected same-origin `live.js` + `EventSource` with `retry: 1000`, `hello`
   generation handshake, heartbeat, and a generation-based dedupe that removes the need for
   `Last-Event-ID` replay.
6. Watcher = `fs.watch(root, {recursive:true})` on Windows/macOS (feature-detect
   `ERR_FEATURE_UNAVAILABLE_ON_PLATFORM`), per-directory walk on Linux, polling on failure;
   ignore list, 150 ms debounce / 1000 ms max wait, mtime+size dedupe, bounded scan.
7. Runner = marker-based detection, lockfile-based PM selection, validated script name, argv only
   from the allowlist, `.cmd` bypass via Node + PM JS entry (or opt-in fixed `cmd.exe` wrapper),
   URL ranking that survives four different banner formats, 120 s readiness race, `terminate()` +
   `waitForExit()` cleanup on stop/dispose/preview close.

**Config surface to add (defaults above):** `bind: '127.0.0.1'`, `tokenTtlMs: 120000`,
`maxPreviews: 4`, `injectLiveReload: true`, `followSymlinks: false`, `spaFallback: false`,
`directoryListing: false`, `dotfiles: 'deny'`,
`watch: {debounceMs: 150, maxWaitMs: 1000, maxDirs: 2000, maxFiles: 50000}`,
`runner: {readyTimeoutMs: 120000, shellWrapper: 'auto', maxLogLines: 500}`.

**Alignment with the repository rules (`AGENTS.md`, read after this note was drafted):** the
fork's security section already requires "Preview servers bind `127.0.0.1` with a random port and a
one-time token; path containment is mandatory", which is exactly §2–§3. One distinction matters for
whoever implements P2: `ctx.connection.requestRejection` is the required guard for the **panel and
state routes** (`/api/dsh-webdev-viewer/*`), **not** for the preview server — the preview runs on a
different origin in a separate CDP profile that has no DSH cookie, so it must keep its own
one-time-token + HttpOnly-cookie auth (§2.5). Applying `requestRejection` to the preview server
would either 401 the CDP browser or silently couple previews to the GUI session. `AGENTS.md` also
fixes where this lives (`src/host/` preview server, runner, watcher) and confirms the Electron
debug-port warning (§7.6/§8: the debug port is unauthenticated local code execution — own the launch,
keep it loopback).

**Open risks / follow-ups**

- The preview host shares the `127.0.0.1` cookie jar with the DSH GUI (§2.5). Documented as a
  limitation; consider serving previews on `localhost` instead of `127.0.0.1` to split the cookie
  jar — rejected for v0.1 because `localhost` may resolve to `::1` on machines where we listen on
  `127.0.0.1` only, so the URL would not connect. Revisit if DSH starts setting non-`HttpOnly`
  browser cookies.
- Electron launch cannot go through `ctx.subprocess` unchanged (hidden windows, §7.6) — hand off to
  R5/P3.
- Remote/SSH workspaces are out of scope: the preview reads through `ctx.fs`, so the seam is right,
  but the watcher and `fs.watch` are local-only.
- Node's recursive `fs.watch` on Linux is not guaranteed; the fallback path needs its own test
  matrix if we ship Linux as a first-class target (macOS is fine).
- Prior-art source was not readable (§1.2); keep the independent implementation, and if we ever
  copy, re-read the tarball first and carry the MIT notice.

**Go/no-go: GO.** Every required capability has a verified DSH seam, the one genuinely dangerous
piece (containment) has an executed prototype and a blocking test table, and the two behaviours
most likely to surprise us — `.cmd` spawning on Windows and hidden Electron windows — are measured
or documented rather than assumed.

---

## 11. Sources

Installed DSH (read in place from the ASAR; `$DSH` = `…\resources\app.asar\dsh\node_modules\@deepseek-ai`):

- `$DSH\dsh-subprocess\README.md` and the live `subprocess` Service contract via Inspect
  (`spawn`/`SubprocessSpawnSpec`/`SubprocessHandle`/`terminate`/`waitForExit`, disposal guarantee).
- `$DSH\dsh-subprocess-local\README.md` — lines 28, 43, 47, 66, 72, 151, 155, 156 (Job ownership and
  `windowsHide`; collect-mode tail + spill; disposal; failure classes; breakaway exclusion;
  JS-observable exits; credential-name scrub); `src/spawn.ts`, `src/spawn-runner.ts`,
  `src/windows-job.ts`, `src/index.ts` (CreateProcessW Job runner, `taskkill /T /F`, PATHEXT
  resolution).
- `$DSH\dsh-fs\README.md` — lines 36, 38, 57, 124 (error taxonomy, watch scope, bounds at the seam,
  `lstat` before `resolve`); the live `fs` Service contract via Inspect (`contains`, `readByteRange`,
  `FsTarget` identity).
- `$DSH\dsh-fs-local\README.md` — lines 32, 36, 59, 76, 133 (cwd is not containment, realpath
  identity, non-recursive chokidar watch).
- `$DSH\dsh-host-webserver\README.md` — lines 39, 41, 63, 89 (bind/host classification, compression
  exclusions, resource backpressure + `request.signal`, disposal).
- `$DSH\dsh-host-frontend-static\README.md` — lines 42, 46, 48, 52, 68 (traversal → 403, 303 + cookie,
  weak ETag/`no-cache`, explicit 404, `sep`-based fence).
- `ctx.connection` Service contract via Inspect (`authorizeIndex`, `authenticatedUrl`); desktop
  profile config entries `include:fs-sandbox`, `include:subprocess` via Inspect `Config.listConfigs`.
- Prior art: `dsh-web-preview-panel@0.2.4` — `package.json`, `README.md`, `LICENSE` (MIT,
  © 2026 zoumutou) via jsDelivr; registry metadata (no `repository` field) via
  <https://registry.npmjs.org/dsh-web-preview-panel>.

Standards and platform documentation:

- RFC 9239, *Updates to ECMAScript Media Types* — <https://www.rfc-editor.org/rfc/rfc9239.txt>
  (§2 `text/javascript` common, `application/javascript` obsolete; §6.1.1 registration).
- MDN, *HTTP range requests* — <https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Range_requests>
  (`Accept-Ranges`, 206/416/200, `Content-Range`, `If-Range`, multipart).
- MDN, *EventSource* — <https://developer.mozilla.org/en-US/docs/Web/API/EventSource> (stream format,
  auto-reconnect, HTTP/1.1 six-connection-per-origin note).
- RFC 6265, *HTTP State Management Mechanism* §4.1.2, §5.4 — cookie scope is host+path, not port:
  <https://www.rfc-editor.org/rfc/rfc6265>.
- Microsoft, *Naming Files, Paths, and Namespaces* —
  <https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file> (reserved device names,
  trailing dot/space, `C:foo` drive-relative, UNC, `\\?\` and `\\.\` namespaces, "do not assume case
  sensitivity", 8.3 aliases).
- chokidar 6.0.0 README (npm) — `ignored` matcher semantics, `backend: 'auto'` = native recursive on
  macOS/Windows, `atomic`, `awaitWriteFinish`, `ENOSPC`/`EMFILE` guidance:
  <https://cdn.jsdelivr.net/npm/chokidar@6.0.0/README.md>.
- Node.js `child_process` on Windows (`.bat`/`.cmd` cannot be launched without a shell; measured
  `EINVAL` here) — <https://nodejs.org/api/child_process.html>; `fs.watch` `recursive` support and
  `fs.realpathSync.native` — <https://nodejs.org/api/fs.html>.
- Dev-server banner samples (external user-reported output, treated as data, not documentation):
  Vite 7 transcript <https://wenku.csdn.net/answer/7cpc9xgrgv>, Next.js 16 thread
  <https://nextjs-forum.com/post/1448428788265517166>, Nuxt 4 / Astro samples via
  <https://bun.com/docs/guides/ecosystem/nuxt> and
  <https://bun.com/docs/guides/ecosystem/astro>, Angular install docs
  <https://v20.angular.dev/installation>.

Probes run in this session (Windows, Node 24.21.0): 24-case containment table (§3.4), prior-art
license/metadata fetch, `spawn('npm.cmd')` → `EINVAL`, ASAR source greps. Probe scripts and raw
output live outside the repository (OS temp) and are reproducible from the pseudo-code above.
