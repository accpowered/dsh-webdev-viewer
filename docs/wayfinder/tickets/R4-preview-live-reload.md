---
id: R4
type: research
status: closed
blocked_by: []
owner: research-preview
write_scope: docs/research/preview-live-reload.md
---

# R4 — Static preview, live reload, project runner, security

## Question

How should the plugin serve a workspace root as a static preview, reload it on file changes, run a project dev server, and stay safe on a local machine?

Cover at least:

- Per-preview loopback HTTP server: random port, token in the first URL, HttpOnly cookie, redirect, `Referrer-Policy`, `no-store`.
- Path containment: `..`, absolute paths, symlinks/realpath, Windows drive/UNC paths, case-insensitivity; dotfiles.
- MIME types, directory index, SPA fallback, 404, range requests, large files, cancellation, backpressure.
- HTML injection of a live-reload script; SSE endpoint; reconnect; multiple previews.
- File watching: recursive scan + mtime/size vs `chokidar`; ignore list (`node_modules`, `.git`, `dist`, `build`, `.next`, `out`, `coverage`, `target`, `vendor`); debounce; change coalescing.
- Project detection: package manager, `scripts.dev/start/serve`, Vite/Next/Nuxt/Astro/Svelte/Angular, static `index.html`, Cargo/Go/Python; runner command allowlist.
- Dev-server log parsing for `http://localhost:PORT`, ANSI stripping, multiple URLs, readiness timeout.
- Process lifecycle: `ctx.subprocess.spawn`, terminate + `waitForExit`, child tree, plugin/session teardown.
- Security: no arbitrary shell by default, no public bind, no token in logs, CDP endpoint loopback only.

## Why it matters

Static preview + live reload is a headline feature, and a sloppy local server is a directory-disclosure or code-execution risk.

## Acceptance

A cited Markdown note at `docs/research/preview-live-reload.md`:

- A concrete route/cookie/containment design with a pseudo-code check.
- A watcher design with the exact ignore/debounce defaults.
- A runner design with detection rules and the failure/cleanup paths.
- A security checklist and the tests that will prove it.
- A port/URL detection strategy with examples from real Vite/Next logs.

## Hints

- The DSH host is a separate Node process; use `node:http` for the preview server, `ctx.subprocess` for runners.
- The CDP browser is a separate Chromium profile; token/cookie auth must work without DSH cookies.
- Look at `dsh-web-preview-panel` for prior art, but do not copy without checking its license and security choices.

## Resolution

Resolved by [`docs/research/preview-live-reload.md`](../../research/preview-live-reload.md). **GO.** A per-preview `node:http` server on its own loopback port is right; use a 303 + unique HttpOnly cookie and require that cookie for **every** preview byte (DSH's own static server leaves assets public, which is wrong here). Containment is a three-layer fence: decode once → reject structural segments (backslash, NUL, `:`, trailing dot/space, Win32 device names) → let `..` normalize → lexical fence → `lstat` before `resolve` → canonical `contains`; deny symlinks/junctions and refuse preview roots at a drive root, the home directory, or a DSH-profile ancestor. The 23-probe traversal table is a blocking test. Watch recursively with `fs.watch({recursive:true})` where available, per-directory walks on Linux, and a poll fallback; no chokidar needed. Windows package managers cannot be spawned as `.cmd` (`EINVAL`): run `<node> <pm-cli.js> run <script>` by default. `ctx.subprocess` forces `windowsHide`, so a visible Electron window needs a direct Node spawn path (hand to P3). Cookies are host-scoped, not port-scoped: use a unique preview cookie name, never log `Cookie`, and do not treat `SameSite=Strict` as a CSRF boundary on loopback.
