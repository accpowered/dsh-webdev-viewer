---
id: P2
type: prototype
status: open
blocked_by: [G1, R4]
owner: null
write_scope: src/host/preview/, src/host/runner/, src/host/watcher/, tests/preview/, tests/runner/
---

# P2 — Static preview + live reload

## Question

Can the plugin serve a workspace folder as a safe static preview, reload it on file changes, and run a real dev server with logs and URL detection?

Build a throwaway spike that:

1. Starts a loopback HTTP server for a chosen workspace root on a random port.
2. Authenticates the first request with a token, sets an HttpOnly cookie, redirects to a clean URL.
3. Serves HTML/CSS/JS/images with correct MIME and blocked path traversal/symlink escapes.
4. Injects a live-reload script and reloads the page when a file under the root changes.
5. Detects a Vite/Next/static project, starts its dev script with `ctx.subprocess`, parses `http://localhost:PORT` from logs, and navigates the viewer.
6. Stops the server/process cleanly on request and on plugin unload.

## Why it matters

Live preview is the feature that makes the sidebar a development workbench rather than a browser tab. The security of a local file server is non-negotiable.

## Acceptance

- A recorded walkthrough: open `index.html`, edit it, see the page reload; start a Vite dev server, see logs and the page; stop it.
- A security test list with results for `..`, absolute paths, symlink escape, missing token, wrong cookie, non-GET.
- A runner failure test: missing script, port in use, process exit, stop while starting.
- A go/no-go note in `## Resolution`.

## Hints

- Use `node:http` for the preview server, not a DSH route, so absolute paths and a clean origin work.
- The CDP browser is a separate profile; token/cookie auth must not depend on DSH cookies.
- Use `ctx.subprocess` for runners and `ctx.fs`/Node fs for files; keep the process tree cleanup explicit.
- Do not bind to anything but `127.0.0.1`; do not expose the token in logs.

## Resolution

<!-- Fill when closed. -->
