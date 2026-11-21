# Live verification — 2026-11-21 (Local files in the desktop guest)

Plugin: working tree on `88c9185` + the local-file change, Desktop profile (`link:` install), DSH
Desktop 0.2.2.0, Windows 11, native Desktop sidebar panel, isolated browser as the CDP carrier.

## What was reported

Opening `C:\Users\accpo\wkp\code\261120_learn_matt_skill\matt-skills-guide.html` in the standard
(native) view produced:

```
Error invoking remote method 'GUEST_VIEW_MANAGER_CALL': Error: ERR_FAILED (-2) loading 'file:///C:/Users/accpo/wkp/code/261120_learn_matt_skill/matt-skills-guide.html'
```

The same page rendered in the CDP view.

## Reproduced, and narrowed

- `webdev_navigate` to the `file:` URL: the isolated Chromium loads it (`title: Matt Pocock Skills ·
  系统理解指南`), so the file and its markup are fine.
- `webdev_desktop_navigate` to the same `file:` URL: `ERR_FAILED (-2)` — the desktop guest's
  Electron embedder refuses `file:` navigations. `about:blank` and `https://example.com` load in the
  same guest, so the guest itself is healthy; the scheme is the variable.
- `http://127.0.0.1:<preview port>/...` loads in the guest, and the preview server's token URL
  (`/__dsh_webdev_bootstrap?token=…`) completes its cookie exchange inside the guest's own partition
  (a direct `/probe.html` load answers `preview cookie required`, the bootstrap URL lands on the
  page). This is the mechanism the fix uses: the host names the URL the guest loads.

## Workaround used during the check (no code change)

`python -m http.server 8791 --bind 127.0.0.1` in the file's directory, then `webdev_navigate` to
`http://127.0.0.1:8791/matt-skills-guide.html`: the standard view rendered the full guide (native
screenshot, 1295×1414). Temporary and unauthenticated; it is not the shipped path.

## Shipped path (needs one DSH Desktop restart)

- Panel address bar: a local path or `file:` URL is sent as the `open-local` command. The host serves
  the file (root = its directory, so sibling CSS/images resolve) from the token-gated preview server
  and answers `local-preview { url, displayUrl }`; the panel loads that URL in the desktop guest and
  keeps showing the path in the bar. Deliberately **tab-free**: the first attempt routed the file
  through a CDP tab and failed silently in native mode when the profile's real-browser endpoint
  (`http://127.0.0.1:9222`) was down — that failure is what the user saw as "no reaction".
- The bar is a draft state (`nativeDraft`), not "value or address": a controlled input that falls back
  to the address when empty refills itself on the last backspace, which is the second bug reported.
- `webdev_navigate` with a workspace path/`file:` URL goes through the same preview route and carries
  `BrowserTabView.preview` for the native view; a path outside the workspace is refused for the agent,
  and `webdev_desktop_navigate` refuses local files with the working route named.
- Host side checked by tests: `open-local` answers with the served page without starting a browser
  (`tests/host/service.spec.ts`), and `serveLocal` serves the file plus a sibling asset and refuses an
  outside path for the agent (`tests/host/workspace-local-file.spec.ts`).
- `node pnpm.mjs typecheck`, `node pnpm.mjs build`, and the suite (280 passing; the two
  `tests/host/chrome.spec.ts` junction cases also fail on clean `HEAD` in this environment).

## Pending

- The address-bar path is live only after DSH Desktop restarts (the host half is an in-process
  module); the panel alone can be refreshed, but `open-local` needs the new host.

## Second round: the live run exposed three things (same day)

The first live run did open the file, and then:

- **The guest reloaded the page forever.** Every `dom-ready` called `load(props.url)`, whose guard
  compared the guest's `getURL()` with the requested address. A preview URL answers with a 303, so
  `getURL()` is the final address and never matches: title flickered between the document title and
  `127.0.0.1`, the page jittered, and the panel showed `ERR_ABORTED (-3)` for the bootstrap URL. The
  panel now tracks the address it requested (`requestedRef`) and loads it once; the toolbar's own
  typing still forces a fresh load.
- **The address bar could not be emptied.** `value={nativeAddress || displayUrl}` refills itself on the
  last backspace with the current address. It is a draft now (`nativeDraft`), empty stays empty,
  Escape drops it, blur restores the address, and a pending `open-local` gives up after 8 s with a
  sentence instead of silence.
- **The agent/person split is now a switch.** `allowAgentLocalFiles` (default off, in both settings
  surfaces) lets `webdev_navigate` leave the workspace; the address bar always may.

Checked: `typecheck`, `build`, and 282 host/core tests (the new ones cover `open-local` without a
browser, the refusal path, the sibling asset, the containment refusal and the profile switch).
