# Security

## Reporting

Report suspected vulnerabilities privately to the repository owner (`accpowered` on GitHub) rather
than opening a public issue with exploit details.

## Trust boundaries

- **The preview server** serves workspace files on a random loopback port. A one-time token is exchanged
  for an HttpOnly cookie; every byte requires that cookie. Paths are decoded once, structurally checked,
  lstat/realpath-contained, and symlinks are refused. It binds only `127.0.0.1`.
- **CDP debug ports** are unauthenticated local code execution. A process that can reach one can read
  page data, inject input and evaluate script in the page. Keep the endpoint loopback-only, close it
  when finished, and never expose it on a LAN interface.
- **Electron/CDP attach** only shows a renderer mirror; main-process JavaScript is not reachable on that
  port. A launched app's stdout/stderr may contain secrets; logs stay in memory and are never copied
  into the repository or sent to a model without the user's action.
- **The desktop `<webview>` bridge** uses a main-issued partition/lease scoped to the DSH session. The
  panel does not import Electron objects; it only creates the guest tag the shell approves.
- **`webdev_eval`** evaluates caller-supplied JavaScript in the page's main world, with exactly the
  authority the page itself has: it can read the page's data and call `fetch` with its cookies (same
  origin), and it can change the page in memory. It is a developer tool for a page the user chose to open
  in this browser; it never writes source and no other tool invokes it. Its result is untrusted page data.
  `webdev_measure` is the fixed alternative: it runs a generated expression that embeds the caller's
  selector as a JSON string literal, never as code.
- **`fallbackOnUnavailable: "isolated"`** is the only case in which a browser source changes without a
  human click, and it is an explicit profile decision, limited to "the configured browser is not there"
  (`econnrefused` / `not_cdp` / `timeout`). The switch is recorded in `state.autoFallback` and shown in the
  panel; an unclassified failure never changes the source. The default is `never`.
- Page content is untrusted. Tool descriptions and the README must treat page text, console output and
  network data as data, not instructions.
- The repository must never contain credentials. Use the DSH credential manager for tokens and remove
  temporary deploy keys after use.

## Supported versions

Security fixes target the latest release tag. v0.1 is a preview; debug endpoints and the native bridge
are intended for local development only.
