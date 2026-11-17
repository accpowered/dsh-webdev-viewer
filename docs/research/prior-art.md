# R2 — Existing plugins and prior-art evaluation

> Ticket: [`R2-prior-art.md`](../wayfinder/tickets/R2-prior-art.md). Survey date **2026-11-17**. Versions are frozen at the numbers below; nothing was installed and the DSH profile was not touched. Every claim is cited to the published file or page I actually read; claims I could not verify are marked **?** and listed in [§9](#9-unverified-and-limits).

## 1. Question and method

Which existing DSH plugins and AI browser/development tools already cover parts of `dsh-webdev-viewer`, and should the project **fork**, **compose**, or build **clean-room**?

Method:

1. Read the **published** npm artifacts through jsDelivr (package.json, `LICENSE`, README, `lib/types/*.d.ts`, and the shipped `src/` where published), not README badges.
2. Read publish metadata from the npm registry (`time`, versions, `license`) for maintenance and license signals.
3. Read the shipped DSH sidebar-browser package source (it publishes `src/`), not just its README.
4. Read the AI-tool prior art from the vendors' own docs (or a mirror of them when the vendor page blocked this environment).
5. Compare against the project's own written intent: [`MAP.md`](../wayfinder/MAP.md), [`UPSTREAM.md`](../../UPSTREAM.md), [`spec.md`](../spec.md).

## 2. Capability matrix — DSH plugins

Legend: **✅** implemented, **⚠️** partial or unbuilt-but-plausible, **❌** absent, **?** not verified.

| Candidate (version) | Agent control | Human input | Picker / annotation | Console & network logs | Screenshots to agent | Page preview | Live reload | Project runner | Electron | Arbitrary sites | License (actual) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `@linxin666/dsh-client-ui-browser-view` 0.4.19 | ✅ 11 CDP tools | ❌ view-only | ❌ | ✅ rings | ✅ image blocks, clip/scale | ⚠️ live page, no static serve | ❌ | ❌ | ⚠️ loopback CDP attach, untested | ✅ isolated + attached | **Apache-2.0 file / BSD-3-Clause metadata (conflict)** |
| `@canglongcl/dsh-web-review` 0.6.0 | ⚠️ annotation context only, no browser tools | ✅ real iframe | ✅ rich, multi-target, source hints | ❌ | ❌ | ✅ isolated proxy | ❌ | ❌ | ❌ | ⚠️ proxy + HTML rewrite | **none — unlicensed** |
| `dsh-web-preview-panel` 0.2.4 | ❌ | ✅ real iframe | ⚠️ basic mark + comment | ⚠️ runner logs only | ❌ | ✅ static host + URL | ❌ | ✅ detect + run + stop | ❌ | ⚠️ iframe / link takeover | **MIT** |
| `@deepseek-ai/dsh-client-ui-sidebar-browser` 0.2.2-rc.3 (shipped) | ❌ none by design | ✅ full, retained tabs | ❌ | ❌ | ❌ | ✅ browser | ❌ | ❌ | ✅ `<webview>` + lease | ✅ HTTP(S) + loopback | **MIT** |
| `@hy-sde-org/dsh-browser` 0.2.2-rc.3 (+ `dsh-tool-browser`) | ✅ host `ctx.browser` service, 4 backends | ⚠️ relay of user's own tabs | ❌ | ? | ? | ❌ | ❌ | ❌ | ⚠️ CDP attach backend | ✅ | **MIT** |
| `dsh-browser-companion` (Tianyu209) | ✅ ~41 tools | ✅ visible window, human login | ❌ | ? | ? | ❌ | ❌ | ❌ | ❌ | ✅ persistent profile | **MIT** (catalog; file not verified) |
| `meow-vision` 0.1.0 | ✅ 2 tools | ❌ | ❌ | ❌ | ✅ renders + returns image | ⚠️ renders a URL/HTML | ❌ | ❌ | ❌ | ⚠️ URL/HTML render | **MIT** |
| `@bhzhangsun/dsh-computer-use` | ✅ OS-level `computer_use` | ✅ sidebar toggle | ❌ | ❌ | ✅ window screenshot | ❌ | ❌ | ❌ | ❌ | n/a (OS apps) | **MIT** |

Each cell is evidenced in the matching candidate section (§4).

## 3. Capability matrix — AI browser / dev prior art

These are **pattern** sources, not code bases we can ship. None of them is a DSH plugin.

| Tool | Where the human and agent share state | Selection / annotation | Preview & reload model | Logs / evidence | What it proves |
|---|---|---|---|---|---|
| Codex app in-app browser | One rendered page in the thread, used by both | Visual comments attached to the page | Local dev servers and file-backed previews; no auth/signed-in pages | Page + comments in thread | Shared-view browser inside a coding agent is normal UX, not a hack |
| v0 Design mode | Live preview beside the app | Element picker + design panel + NL instruction; screenshot attached | App preview runtime; Apply → new chat version | Screenshot of selection | Select-then-prompt with pending edits and reviewable apply |
| Onlook | Browser-like DOM canvas | Direct DOM edit + AI chat | Live React/Tailwind DOM; code write-back | — | Mixed visual/chat editing on a live app is viable at scale |
| Huawei CodeArts Agent Browser | IDE built-in browser | Element select → comment bubble bound to DOM; CSS panel ↔ CSS view | Local HTML preview | Console listed as a perception entry | Comment-bound, element-scoped agent edits ship in an IDE |
| browser-use Cloud live view | Remote browser run | — | — | Live view URL + recording | Live-view URL + reattach is the standard remote-viewer contract |
| Playwright MCP | MCP agent ↔ real browser | Accessibility snapshot refs | — | Snapshot after actions | Snapshot-first, ref-based control beats coordinates |
| Chrome DevTools MCP | MCP agent ↔ live Chrome | — | — | DevTools-grade inspection (a11y/perf workflows named) | DevTools data is the log surface agents actually need |
| Stagehand | SDK agent ↔ Playwright page | `observe` proposes actions | — | — | Curated candidate actions + AI primitives as an API shape |

## 4. Candidate notes

### 4.1 `@linxin666/dsh-client-ui-browser-view` 0.4.19 — the leading base

**Architecture.** A cordis bundle with two halves. The host half owns a lazily started Chromium (or detaches into an externally started CDP browser), a minimal CDP WebSocket client with flat-mode sessions, a tab manager, and a fan-out to attached panel sockets; the browser half registers one right-sidebar tab of kind `browser-view` that paints `Page.startScreencast` frames. Sources: [README](https://cdn.jsdelivr.net/npm/@linxin666/dsh-client-ui-browser-view@0.4.19/README.md), [`lib/types/core/cdp.d.ts`](https://cdn.jsdelivr.net/npm/@linxin666/dsh-client-ui-browser-view@0.4.19/lib/types/core/cdp.d.ts), [`lib/types/host/service.d.ts`](https://cdn.jsdelivr.net/npm/@linxin666/dsh-client-ui-browser-view@0.4.19/lib/types/host/service.d.ts).

- **Agent control — ✅.** Eleven tools in a fixed registration order: `browser_navigate`, `browser_click`, `browser_type`, `browser_press`, `browser_scroll`, `browser_snapshot`, `browser_screenshot`, `browser_console`, `browser_network`, `browser_tabs`, `browser_close` ([`lib/types/host/tools.d.ts`](https://cdn.jsdelivr.net/npm/@linxin666/dsh-client-ui-browser-view@0.4.19/lib/types/host/tools.d.ts)). The service documents per-session tab binding and a four-step tab resolution order designed so an agent call cannot steal the page a person is watching ([`service.d.ts`](https://cdn.jsdelivr.net/npm/@linxin666/dsh-client-ui-browser-view@0.4.19/lib/types/host/service.d.ts)).
- **Human input — ❌.** "The tab is a **view**. Input comes from the agent through the tools; it does not forward your mouse or keyboard" ([README › Known limits](https://cdn.jsdelivr.net/npm/@linxin666/dsh-client-ui-browser-view@0.4.19/README.md)). The panel can select which tab is watched and receives action traces, but page input is one-way from the agent.
- **Picker / annotation — ❌.** No element-pick or annotation surface in the README, tools, or type surface.
- **Console & network — ✅.** Per-tab rings of console entries and network requests, cleared on top-level document replacement and kept on same-document navigation ([README › How it works](https://cdn.jsdelivr.net/npm/@linxin666/dsh-client-ui-browser-view@0.4.19/README.md); `BrowserConsoleEntry`/`BrowserNetworkEntry` in [`service.d.ts`](https://cdn.jsdelivr.net/npm/@linxin666/dsh-client-ui-browser-view@0.4.19/lib/types/host/service.d.ts)).
- **Screenshots — ✅.** PNG by default, JPEG optional; `clip` in CSS pixels, `scale` 1–3, out-of-bounds fails loudly; results are durable image parts, not base64 text ([README › Screenshot fidelity](https://cdn.jsdelivr.net/npm/@linxin666/dsh-client-ui-browser-view@0.4.19/README.md); [`tools.d.ts`](https://cdn.jsdelivr.net/npm/@linxin666/dsh-client-ui-browser-view@0.4.19/lib/types/host/tools.d.ts) documents the `saveImage` seam and `ImageBlock`).
- **Preview / live reload / runner — ❌.** It is a browser, not a static host: no workspace route, no file watcher, no child process. The only adjacent feature is the host-GUI auth top-up for loopback navigation.
- **Electron — ⚠️.** The `realBrowserEnabled`/`cdpEndpoint` mode attaches to any **loopback** DevTools HTTP endpoint and refuses non-loopback ([README › Configuration and Security model](https://cdn.jsdelivr.net/npm/@linxin666/dsh-client-ui-browser-view@0.4.19/README.md)). Electron exposes the same CDP endpoint when started with remote debugging, so attach is plausible, but there is no Electron-specific launch, detection, or test in 0.4.19. **?** until R5 proves it.
- **Arbitrary sites — ✅.** Isolated mode launches Chrome with a throwaway profile and random debug port; CDP mode attaches to a profile the user already signed into; both accept loopback and public HTTP(S) ([README](https://cdn.jsdelivr.net/npm/@linxin666/dsh-client-ui-browser-view@0.4.19/README.md)).
- **License — conflict, see §5.1.** `package.json` says `BSD-3-Clause` ([package.json](https://cdn.jsdelivr.net/npm/@linxin666/dsh-client-ui-browser-view@0.4.19/package.json)); the shipped `LICENSE` is the Apache License 2.0, 11,358 bytes ([LICENSE](https://cdn.jsdelivr.net/npm/@linxin666/dsh-client-ui-browser-view@0.4.19/LICENSE), [flat listing](https://data.jsdelivr.com/v1/package/npm/@linxin666/dsh-client-ui-browser-view@0.4.19/flat)); the upstream repository root `LICENSE` is also Apache-2.0 ([dsh-web LICENSE](https://raw.githubusercontent.com/zhu1090093659/dsh-web/main/LICENSE)).
- **Maintenance — very active.** Latest 0.4.19 published **2026-11-16T02:14:24Z** (one day before this survey); 11 versions from 0.4.9 (2026-10-26) to 0.4.19, roughly one release every two days ([npm registry time](https://registry.npmjs.org/@linxin666%2Fdsh-client-ui-browser-view)). Package ships tests/typecheck scripts (`vitest`, `tsgo`) and its published type files carry detailed design rationale.
- **What is reusable.** The CDP client, flat-session tab manager, snapshot-ref map, screenshot planning, console/network ring, panel WebSocket protocol, isolated/attached session factories, session→tab ownership, idle sweep, and the sidebar tab shell. That is the expensive half of our product.
- **What is missing for us.** Human input forwarding, picker/annotation, composer integration, static preview + live reload, project runner, Electron workflow, and a license-clean release. The README itself says the panel is a view, so input is the deliberate gap.

### 4.2 `@canglongcl/dsh-web-review` 0.6.0 — strongest picker/annotation art, but unlicensed

**Architecture.** A host half that runs an **independent loopback preview server** plus a same-origin control route, and a React client half that renders the preview and annotation editor. Every preview session gets its own random `*.localhost` origin; the server proxies and rewrites upstream HTML, pins DNS answers, caps bodies at 10 MB, expires sessions after 30 minutes, and injects a versioned bridge script into the frame. The frame talks to the host only through that bridge, and annotations are injected into the agent before its next step through a system-prompt section and `agent/pre-step` hook. Sources: [`src/index.ts`](https://cdn.jsdelivr.net/gh/CanglongCl/dsh-web-review@main/packages/dsh-web-review/src/index.ts), [`src/preview-server.ts`](https://cdn.jsdelivr.net/gh/CanglongCl/dsh-web-review@main/packages/dsh-web-review/src/preview-server.ts), [file listing](https://data.jsdelivr.com/v1/package/gh/CanglongCl/dsh-web-review@main/flat).

- **Agent control — ⚠️ indirect.** It registers **no browser tools** (`index.ts` imports no `dsh-tools` and calls no `ctx.tools`); it injects annotation context and registers eight UI-design skills ([`README_en.md`](https://cdn.jsdelivr.net/gh/CanglongCl/dsh-web-review@main/README_en.md)).
- **Human input — ✅.** The preview is a normal interactive frame served by the proxy, so the person clicks, types and scrolls in it.
- **Picker / annotation — ✅.** Hover-highlight, multi-target annotations, selectors, text, accessible names, source clues, plus a live visual-adjustment editor for text/color/font/size/spacing/border/effects ([README features](https://cdn.jsdelivr.net/gh/CanglongCl/dsh-web-review@main/README_en.md); source files `src/client/picker-core.ts`, `AnnotationEditor.tsx`, `source-anchor.ts`, `preview-bridge.ts` in the [repo listing](https://data.jsdelivr.com/v1/package/gh/CanglongCl/dsh-web-review@main/flat)). Temporary page tweaks are **not** written to project files; the agent edits source from the annotation payload ([README_en.md](https://cdn.jsdelivr.net/gh/CanglongCl/dsh-web-review@main/README_en.md)).
- **Console / network — ❌.** No capture or agent-facing log surface found.
- **Screenshots — ❌.** No screenshot tool; its eval harness uses Playwright separately (`eval/` in the repo), which is not the shipped plugin.
- **Preview — ✅.** Static and proxied HTTP(S) content, with an isolated origin per session ([`preview-server.ts`](https://cdn.jsdelivr.net/gh/CanglongCl/dsh-web-review@main/packages/dsh-web-review/src/preview-server.ts)). Because HTML is rewritten and scripts are path-rewritten, fidelity for complex SPAs is **?** — this is a proxy, not a real browser.
- **Live reload / runner / Electron — ❌.** The README's review loop is "refresh the preview", and neither the README nor the `src/` listing contains a file watcher, process runner, or Electron path ([README_en.md](https://cdn.jsdelivr.net/gh/CanglongCl/dsh-web-review@main/README_en.md), [repo listing](https://data.jsdelivr.com/v1/package/gh/CanglongCl/dsh-web-review@main/flat)).
- **Arbitrary sites — ⚠️.** The proxy accepts HTTP(S) targets (with DNS pinning and CSP `frame-ancestors`), but it is an HTML rewriter; sites that depend on service workers, strict CSP, or cross-origin scripting are likely to break. **?** for SPA fidelity.
- **License — ❌ none.** The npm package has **no `license` field** and ships **no LICENSE file**; the repo root `package.json` is `private` with no license, and the only LICENSE in the tree is inside `skills/` (third-party, 1,069 bytes) with `skills/UPSTREAM.md` ([npm package.json](https://cdn.jsdelivr.net/npm/@canglongcl/dsh-web-review@0.6.0/package.json), [published file listing](https://data.jsdelivr.com/v1/package/npm/@canglongcl/dsh-web-review@0.6.0/flat), [repo package.json](https://cdn.jsdelivr.net/gh/CanglongCl/dsh-web-review@main/package.json)). Under default copyright, **no reuse permission is granted**.
- **Maintenance.** 0.6.0 published **2026-09-05T04:08:37Z**, last registry modification the same day; 12 versions between 0.1.0 (2026-08-13) and 0.6.0, with CI provenance and a large eval suite, then no release for ~2.5 months ([npm registry time](https://registry.npmjs.org/@canglongcl%2Fdsh-web-review)). Active project, currently quiet.
- **What is reusable — patterns only.** The per-session-origin proxy with HTML rewrite + injected bridge, the annotation contract (selector, text, accessible name, source anchor, before/after values), the multi-target annotation bar, and the "pending edits never touch project files" model. **Do not copy code** (§5.2).

### 4.3 `dsh-web-preview-panel` 0.2.4 — static host + runner, MIT

**Architecture.** A plain-JS cordis bundle: the host half registers exact web-server routes under `/__dsh-preview/...` for static files, Markdown, code, images and uploads, plus a `POST /api` JSON-RPC (`set-root`, `pages`, `resolve-path`, `detect-project`, `run-project`, `project-status`, `stop-project`, `state`) and a subprocess runner; the client half is a React glass card that frames the route and owns mark mode, link takeover and per-session state. Sources: [README](https://cdn.jsdelivr.net/npm/dsh-web-preview-panel@0.2.4/README.md), [`lib/types/index.d.ts`](https://cdn.jsdelivr.net/npm/dsh-web-preview-panel@0.2.4/lib/types/index.d.ts), [`lib/types/client/index.d.ts`](https://cdn.jsdelivr.net/npm/dsh-web-preview-panel@0.2.4/lib/types/client/index.d.ts).

- **Agent control — ❌.** Host exports only `name`, `inject`, `apply`; no tools, no agent-facing events ([`lib/types/index.d.ts`](https://cdn.jsdelivr.net/npm/dsh-web-preview-panel@0.2.4/lib/types/index.d.ts)).
- **Human input — ✅.** Normal iframe preview.
- **Picker / annotation — ⚠️.** Mark mode with hover highlight, click-to-select, comment bubble, send to conversation, selector/HTML snapshot with internal classes stripped ([README](https://cdn.jsdelivr.net/npm/dsh-web-preview-panel@0.2.4/README.md)). No source hints, no multi-target set, no visual property editor.
- **Logs — ⚠️.** Runner logs stream in the panel and a "log → conversation" button forwards them; no browser console/network capture ([README](https://cdn.jsdelivr.net/npm/dsh-web-preview-panel@0.2.4/README.md)).
- **Screenshots — ❌.** No image tool.
- **Preview — ✅.** Workspace static hosting through the harness's own HTTP server, Markdown rendering, code with line numbers, images, raw HTML; each session gets its own root and preview state ([README](https://cdn.jsdelivr.net/npm/dsh-web-preview-panel@0.2.4/README.md)).
- **Live reload — ❌.** No file watcher in the README, routes, or type surface; the runner detects `localhost:PORT` and loads it, and the user refreshes manually.
- **Project runner — ✅.** Detects Cargo / `package.json` / `go.mod` / Python, run/stop, live logs, auto-load detected port ([README](https://cdn.jsdelivr.net/npm/dsh-web-preview-panel@0.2.4/README.md)).
- **Electron — ❌.** No Electron path.
- **Arbitrary sites — ⚠️.** Chat links (HTTP(S), paths) open in the panel, but the frame is a normal iframe, so `X-Frame-Options`/CSP-refusing sites fail unless opened externally ([README](https://cdn.jsdelivr.net/npm/dsh-web-preview-panel@0.2.4/README.md)).
- **License — MIT.** `"license": "MIT"` in [package.json](https://cdn.jsdelivr.net/npm/dsh-web-preview-panel@0.2.4/package.json) and a shipped MIT `LICENSE` © 2026 zoumutou ([LICENSE](https://cdn.jsdelivr.net/npm/dsh-web-preview-panel@0.2.4/LICENSE)).
- **Maintenance.** 0.2.4 published **2026-08-15T16:24:06Z**, after 0.1.0 on 2026-08-14; no release for ~3 months ([npm registry time](https://registry.npmjs.org/dsh-web-preview-panel)). One maintainer, small package (8 files, ~103 KB unpacked), no tests published.
- **What is reusable.** The route shape for static hosting, the project-detection/run/stop API, the "logs → conversation" affordance, and the per-session isolation model. MIT lets us copy with attribution, but its plain-JS style does not match our TS cordis bundle — see §6.

### 4.4 `@deepseek-ai/dsh-client-ui-sidebar-browser` 0.2.2-rc.3 — the shipped browser

**Architecture.** Client-only. `BrowserController` validates addresses and owns commands; `BrowserFrame` is a carrier-neutral navigation state machine with two implementations: `IframeImpl` (Web, sandboxed iframe with application-managed history) and `ElectronWebViewImpl` (Desktop, `<webview>` with a main-process guest lease, per-workspace storage partition, native history, and retained pages). It registers the `browser` sidebar tab; the README is explicit that it registers **no tool, prompt section, or session event** ("Model Experience: None"). Sources: [README](https://cdn.jsdelivr.net/npm/@deepseek-ai/dsh-client-ui-sidebar-browser@0.2.2-rc.3/README.md), [`src/types.ts`](https://cdn.jsdelivr.net/npm/@deepseek-ai/dsh-client-ui-sidebar-browser@0.2.2-rc.3/src/types.ts), [`src/client/electron/ElectronWebViewImpl.ts`](https://cdn.jsdelivr.net/npm/@deepseek-ai/dsh-client-ui-sidebar-browser@0.2.2-rc.3/src/client/electron/ElectronWebViewImpl.ts), [`src/client/browser/IframeImpl.ts`](https://cdn.jsdelivr.net/npm/@deepseek-ai/dsh-client-ui-sidebar-browser@0.2.2-rc.3/src/client/browser/IframeImpl.ts).

- **Agent control — ❌ by design.** No tools and no host half: the package's `lib/index.js` is 205 bytes while `lib/client.js` is 50 KB, and the README states it registers no tool, prompt section, or session event ([flat listing](https://data.jsdelivr.com/v1/package/npm/@deepseek-ai/dsh-client-ui-sidebar-browser@0.2.2-rc.3/flat), [README](https://cdn.jsdelivr.net/npm/@deepseek-ai/dsh-client-ui-sidebar-browser@0.2.2-rc.3/README.md)).
- **Human input — ✅.** Full native interaction, retained tabs, Back/Forward/Reload/Go/Open-in-system-browser, per-tab sandbox toggle, restore after restart.
- **Picker / logs / screenshots / preview / runner — ❌.** None; local files belong to the separate Document Preview package.
- **Electron — ✅.** `<webview>` plus a scoped bridge (`acquire`/`release`/`onOpenRequested`) that hands out a lease and a storage partition per canonical workspace; no Electron objects cross the bridge ([`src/types.ts`](https://cdn.jsdelivr.net/npm/@deepseek-ai/dsh-client-ui-sidebar-browser@0.2.2-rc.3/src/types.ts), [`ElectronWebViewImpl.ts`](https://cdn.jsdelivr.net/npm/@deepseek-ai/dsh-client-ui-sidebar-browser@0.2.2-rc.3/src/client/electron/ElectronWebViewImpl.ts)).
- **Arbitrary sites — ✅ with limits.** HTTP(S) incl. loopback; Web mode is a sandboxed iframe; many sites refuse framing and mixed content/private-network policy still applies ([README › Known Limitations](https://cdn.jsdelivr.net/npm/@deepseek-ai/dsh-client-ui-sidebar-browser@0.2.2-rc.3/README.md)).
- **License — MIT.** [`package.json`](https://cdn.jsdelivr.net/npm/@deepseek-ai/dsh-client-ui-sidebar-browser@0.2.2-rc.3/package.json) and the DSH repository; shipped `LICENSE` 1,065 bytes in the [flat listing](https://data.jsdelivr.com/v1/package/npm/@deepseek-ai/dsh-client-ui-sidebar-browser@0.2.2-rc.3/flat).
- **Reusable.** The tab registration pattern, the carrier-neutral navigation state machine, the iframe sandbox policy, and the Desktop webview lease design — all MIT, all official DSH idioms. It is also the package that owns tab kind `browser`, which is why the linxin666 plugin deliberately registers `browser-view` instead ([README › Interface seats](https://cdn.jsdelivr.net/npm/@linxin666/dsh-client-ui-browser-view@0.4.19/README.md)).
- **Gap for us.** It cannot be the agent's page. Its value is that it already gives the person a good browsing tab; our product's differentiator is the **same** page being driven by both, which this package's architecture (client-only iframe/webview) cannot provide.

### 4.5 `@hy-sde-org/dsh-browser` 0.2.2-rc.3 (+ `dsh-tool-browser`)

A host-side `ctx.browser` **service** for an agent browser tool, built on `playwright-core` CDP with four backends — launch (stealth-patched binary), patch (CloakBrowser), attach (existing CDP endpoint via `cdp_url`), and relay (the user's own Chrome tabs through an in-process relay server + a companion MV3 extension). It is explicitly "intended to be consumed by `@hy-sde-org/dsh-tool-browser`, never by the model directly." Sources: [package.json](https://cdn.jsdelivr.net/npm/@hy-sde-org/dsh-browser/package.json), [LICENSE](https://cdn.jsdelivr.net/gh/hy-sde/dsh-browser@main/packages/browser/browser/LICENSE).

- **Agent control — ✅ service level.** Tools live in the sibling package; this package owns connections, ARIA observation and relay.
- **Human share — ⚠️ relay only.** The relay backend drives the person's own tabs through an extension; there is no viewer UI, so the human watches their own Chrome, not a DSH panel.
- **Picker / preview / runner / Electron — ❌ / unbuilt.**
- **License — MIT**, with a detailed port provenance (oh-my-pi `omp`, DSH) and `THIRD-PARTY-NOTICES.md` ([LICENSE](https://cdn.jsdelivr.net/gh/hy-sde/dsh-browser@main/packages/browser/browser/LICENSE)).
- **Maintenance — not measured here.** The published version tracks DSH `0.2.2-rc.3` exactly ([package.json](https://cdn.jsdelivr.net/npm/@hy-sde-org/dsh-browser/package.json)); I did not fetch its publish history for this ticket.
- **Relevance.** Engineering proof that CDP attach + relay + ARIA observation is doable in a plugin, and a model for consent/lease semantics. Its dependency weight (`playwright-core`, optional `cloakbrowser`) is heavier than the base's hand-rolled CDP client.

### 4.6 `dsh-browser-companion` (Tianyu209)

Personal browser plugin: persistent profile, visible window by default, human-in-the-loop login in the popup, ~41 browser tools, MIT per the plugin directory ([dshplugin.online listing](https://dshplugin.online/plugins/tianyu209--dsh-browser-companion)). It is not published on npm under that name ([registry 404](https://registry.npmjs.org/dsh-browser-companion)), and the repository's `package.json` could not be located at the expected GitHub path, so the shipped LICENSE and the exact tool list remain **?** ([catalog listing](https://dshbase.com/plugins/dsh-browser-companion/)).

- **Architecture (as described).** A dedicated, persistent browser profile with a visible window, driven by agent tools; login is performed by the person in the popup and cookies persist in the same profile ([catalog listing](https://dshbase.com/plugins/dsh-browser-companion/)). The package was not opened, so the carrier (Playwright/Edge/CDP) is **?**.
- **Maintenance.** The catalog records a last push on 2026-08-15 and "updated 3 months ago" ([dshplugin.online listing](https://dshplugin.online/plugins/tianyu209--dsh-browser-companion)).
- **Relevance.** The "agent has a visible, persistent browser, and the person logs in themselves" pattern is a real product answer to auth; we should borrow the pattern, not the code.

### 4.7 `meow-vision` 0.1.0

Two tools: `meow_vision` (send an image to a configured vision model and return text, for non-multimodal sessions) and `meow_preview` (render a Vue demo, URL, or HTML file and return a screenshot as an image). Settings page picks the vision model. MIT, early 0.1.0. Sources: [GitHub package.json](https://cdn.jsdelivr.net/gh/meimiaoji-creator/meow-vision@main/package.json), [GitHub README](https://github.com/meimiaoji-creator/meow-vision), [catalog entry](https://dshbase.com/zh/plugins/meow-vision/).

- **Architecture.** Host-side tools plus a web route module (`lib/web/routes.js`, `lib/preview.js`) that renders a page and screenshots it; the client half is a settings UI ([package.json files](https://cdn.jsdelivr.net/gh/meimiaoji-creator/meow-vision@main/package.json)).
- **Maintenance.** 0.1.0; the catalog records a last push on 2026-08-21 and "updated 3 months ago" ([catalog entry](https://dshbase.com/zh/plugins/meow-vision/)).
- **Relevance.** Proves the "preview → screenshot → image part" loop and exposes the vision-model fallback gap (a text-only model needs a bridge). We should not depend on it: one package should own both the page and the screenshot.

### 4.8 `@bhzhangsun/dsh-computer-use` — boundary case

OS-level computer use: sidebar page, a `computer_use` tool with `status`/`windows`/`observe`/`click`/`type`/`key`/`scroll`, Windows-only, CUA driver, MIT ([npm](https://www.npmjs.com/package/@bhzhangsun/dsh-computer-use), [catalog](https://dshplugin.online/plugins/kinfxhk--dsh-computer-use)). It is outside this project's scope by [`MAP.md` › Out of scope](../wayfinder/MAP.md) ("General-purpose computer use outside the web page"); it matters only as evidence that DSH sidebar panels can host a live viewer with input, that tool-level permission/lease design is already a settled pattern, and that a viewer can be switched off from its own sidebar page (the catalog records it updated 8 days ago).

## 5. License findings (verified against shipped files)

### 5.1 The base's conflict is real and unresolved

| Evidence | Says |
|---|---|
| [`package.json`](https://cdn.jsdelivr.net/npm/@linxin666/dsh-client-ui-browser-view@0.4.19/package.json) | `"license": "BSD-3-Clause"` |
| [README badge](https://cdn.jsdelivr.net/npm/@linxin666/dsh-client-ui-browser-view@0.4.19/README.md) | BSD-3-Clause |
| Shipped [`LICENSE`](https://cdn.jsdelivr.net/npm/@linxin666/dsh-client-ui-browser-view@0.4.19/LICENSE) | Apache License 2.0 (11,358 bytes) |
| Published tarball [flat listing](https://data.jsdelivr.com/v1/package/npm/@linxin666/dsh-client-ui-browser-view@0.4.19/flat) | `/LICENSE` size 11,358 → Apache-2.0 text, not BSD-3 (≈1.5 KB) |
| Upstream repo root [`LICENSE`](https://raw.githubusercontent.com/zhu1090093659/dsh-web/main/LICENSE) | Apache License 2.0 |
| npm registry metadata for every `0.4.x` release | `license: BSD-3-Clause` |

The project already records this in [`UPSTREAM.md`](../../UPSTREAM.md:18-26) and ships Apache-2.0 in this repo ([`package.json`](../../package.json:7), [`LICENSE`](../../LICENSE), [`NOTICE`](../../NOTICE:1-11)). What this survey adds: the **repository** LICENSE is Apache-2.0 too, so Apache-2.0 is the only license text the upstream author has actually shipped; the BSD-3-Clause claim exists only in metadata/badge. Until the author says otherwise, our treat-as-governing choice is evidence-based, not arbitrary.

G1 must still record the decision and T1 must:
- keep Apache-2.0 as the repo license;
- carry the Apache-2.0 NOTICE and add a prominent "changed files" notice per Apache-2.0 §4(b) for every modified upstream file;
- record the exact base commit in [`UPSTREAM.md`](../../UPSTREAM.md:30-36) **before** copying source;
- not describe the fork as BSD-3-Clause anywhere.

### 5.2 `dsh-web-review` grants no rights

No `license` field in any published version, no LICENSE file in the tarball, no license in the repo root package.json; only the bundled third-party skills carry MIT. Absence of a license is not permissiveness. Consequence: **patterns and UX only, zero copied code, zero copied CSS, zero copied type names.** If its author later adds a license, revisit; do not plan around it.

### 5.3 Others

- `dsh-web-preview-panel` — MIT confirmed from the shipped `LICENSE` (© 2026 zoumutou) and package.json.
- Shipped `sidebar-browser` — MIT.
- `@hy-sde-org/dsh-browser` — MIT with provenance notices.
- `meow-vision` — MIT.
- `dsh-browser-companion` — MIT per catalog only; shipped file **?**.
- `dsh-computer-use` — MIT per catalog/npm.
- AI prior art — no license conclusion is needed because we copy no code; vendor features are cited only as interaction precedent.

## 6. Recommendation: **fork** `@linxin666/dsh-client-ui-browser-view` 0.4.19, clean-room the rest

**Decision: fork the base, and build picker, preview/live reload, runner and Electron attach as new code inside the fork.** Keep the fork's tab kind distinct from the shipped `browser` kind (upstream's `browser-view` already is; if we want to coexist with an installed upstream 0.4.x, choose our own kind and title so neither plugin shadows the other).

Why fork (vs compose or clean-room):

1. **The expensive, risky layer already exists and is tested.** CDP transport, flat sessions, tab ownership, snapshot refs, screenshot planning/attachment, console+network rings, isolated/attached modes, idle cleanup and the panel protocol are all in the package ([`service.d.ts`](https://cdn.jsdelivr.net/npm/@linxin666/dsh-client-ui-browser-view@0.4.19/lib/types/host/service.d.ts), [`cdp.d.ts`](https://cdn.jsdelivr.net/npm/@linxin666/dsh-client-ui-browser-view@0.4.19/lib/types/core/cdp.d.ts), [`tools.d.ts`](https://cdn.jsdelivr.net/npm/@linxin666/dsh-client-ui-browser-view@0.4.19/lib/types/host/tools.d.ts)). A clean-room rewrite duplicates weeks of work and the security reasoning (loopback fencing, throwaway profile, token top-up, adopted-tab never closed).
2. **License permits it** on the Apache-2.0 reading (§5.1), with standard NOTICE + change notices. Apache-2.0 is compatible with this repo's existing Apache-2.0 files.
3. **The gap is exactly our product, not a bug in the base.** The panel is deliberately view-only; we change the contract from "watch" to "share", which is a fork-sized change (host input path + panel input forwarding + origin/coordination rules), not a plugin-sized patch.
4. **Compose fails the product test.** Composing the shipped `sidebar-browser` (human, iframe/webview) with the CDP browser (agent) yields **two different pages**; that defeats "the user and the agent drive the same page." Composing `web-review` (annotation pane) or `preview-panel` (iframe pane) would add a second, third and fourth right-sidebar tab with separate page state and separate protocols, and `web-review` cannot be copied at all.
5. **Compose is still viable at the code level for small MIT pieces**, but I would not: two runtime styles (plain JS vs TS cordis bundle), two route conventions and two state models inside one tab is more work than reimplementing the ~200 lines of static hosting and the runner RPC we actually need.

Why not clean-room: it throws away the only mature CDP/screencast layer in the ecosystem and the only plugin that already returns screenshots as durable image parts ([`tools.d.ts`](https://cdn.jsdelivr.net/npm/@linxin666/dsh-client-ui-browser-view@0.4.19/lib/types/host/tools.d.ts)). It also ignores the user's explicit "reuse an existing solution if it fits."

### 6.1 Top two risks

**Risk 1 — License ambiguity blocks release (high likelihood, medium impact).**
The author's metadata says BSD-3-Clause while every shipped license text is Apache-2.0. If we fork and label the result BSD-3-Clause we would contradict the only license text upstream ships; if we label it Apache-2.0 and the author later asserts BSD-3-Clause, the badge/metadata mismatch becomes our problem to explain and downstream users get four different signals (metadata, badge, LICENSE file, repo LICENSE).
*Mitigation:* treat the shipped LICENSE as governing (Apache-2.0), document it in [`UPSTREAM.md`](../../UPSTREAM.md), keep the NOTICE, add §4(b) change notices, and ask the upstream author in writing before the first public release. G1 records the decision; T1 verifies the shipped LICENSE text byte-for-byte in CI. If the answer is BSD-3-Clause, the fork stays Apache-2.0 for our files and we add the upstream BSD notice — both are permissive and compatible.
*Kill criterion:* no public v0.1 release while the base commit is unrecorded or the NOTICE still says "draft".

**Risk 2 — Human input on a CDP screencast may not feel interactive (medium likelihood, high impact).**
No DSH plugin forwards human input into a CDP page today: the base explicitly does not ([README › Known limits](https://cdn.jsdelivr.net/npm/@linxin666/dsh-client-ui-browser-view@0.4.19/README.md)). Getting mouse/keyboard into the page means the CDP `Input` domain (`Input.dispatchMouseEvent`, `Input.dispatchKeyEvent`; [CDP Input](https://chromedevtools.github.io/devtools-protocol/tot/Input/)), correct coordinate mapping from the displayed frame to the pinned viewport, focus/IME handling, and a rule for when the agent and the person both act. Latency is also unproven: the base produces frames only when the page changes and pins a 1280×800 viewport in isolated mode ([README](https://cdn.jsdelivr.net/npm/@linxin666/dsh-client-ui-browser-view@0.4.19/README.md)).
*Mitigation:* R3 measures the input round-trip and P1 prototypes input on the screencast with explicit acceptance numbers (loopback click→frame p95 < 150 ms, key echo p95 < 50 ms, no lost keys during IME composition); serialize human and agent actions on one command queue; show an "agent is acting" lock in the toolbar.
*Kill criterion:* if P1 cannot hit the numbers, Desktop falls back to the shipped Electron `<webview>` as the **human** carrier with CDP attach on the same renderer for the **agent** (the lease pattern in [`ElectronWebViewImpl.ts`](https://cdn.jsdelivr.net/npm/@deepseek-ai/dsh-client-ui-sidebar-browser@0.2.2-rc.3/src/client/electron/ElectronWebViewImpl.ts) and the attach mode in the base make this feasible), and Web degrades to watch + pick. That is an architecture change, so G1 should name the fallback now.

## 7. What we borrow (interaction patterns, not code)

From **v0 Design mode** ([docs](https://v0.app/docs/design-mode)):
1. **Select → panel → instruction, combined on one element.** Panel tweaks and natural-language instructions can be combined before apply; the instruction automatically carries a screenshot of the selection.
2. **Inspect toggle, not a permanent mode.** Toggle between selecting and normal interaction with `Cmd/Ctrl+I`; `Escape` deselects. We should own a shortcut that does not clash with the browser's.
3. **Pending edits are not source edits.** Undo/redo/reset and a before/after toggle exist because edits are pending until Apply; leave-with-unapplied warns.
4. **Apply creates a reviewable version**, so every visual change is diffable and revertable. For us: apply = send a structured annotation to the composer, never a silent file write.

From **Codex app in-app browser** ([docs mirror](https://github.com/crasuna/openai-dev-docs-cn-mirror/blob/main/sources/en/codex/app/browser.md); official page returned 403 here):
5. **A shared view is the mental model**: the page lives in the thread, the person and the agent both see it, and visual comments attach to it.
6. **Preview scoped to development**, with a clear boundary for sign-in/extensions: use a real browser or extension for authenticated flows instead of pretending the in-app browser can do it.

From **Onlook** ([docs](https://docs.onlook.com), [FAQ](https://docs.onlook.com/faq)):
7. **Live DOM editing with code write-back** — the edit surface is the running app, not a mock; every visual change must map back to source or be explicitly temporary.
8. **Design-in-the-browser is a first-class workflow for React/Tailwind projects**, which is our primary audience.

From **Huawei CodeArts Agent Browser** ([Huawei practice](https://aidevbp.developer.huaweicloud.com/practices/p_5ba0c857), [demo](https://gitcode.com/I76B/browser-pet-page)):
9. **Comment bubbles bound to a DOM element, sent as a batch.** Element-level comments are capped (5 in that product) — show the cap and the count instead of failing silently.
10. **Element-scoped edits**: "the agent changes only the annotated element; unannotated areas stay untouched" is the acceptance test users apply, so our annotation payload must be precise enough to honor it.
11. **Bidirectional CSS inspector** (design panel ↔ CSS view ↔ component tree); even if we ship read-only inspect at first, the panel should show the same values the code uses.

From **browser-use Cloud live preview** ([docs](https://docs.browser-use.com/cloud/browser/live-preview)):
12. **A live-view URL that survives reattach.** The viewer is a URL with `browser.ready`/`browser.reattached` events; our panel socket should survive DSH reloads and re-attach to the same tab instead of resetting.
13. **Record the run** as an optional artifact — aligns with our screenshot/evidence goal.

From **Playwright MCP** ([snapshots](https://playwright.dev/mcp/snapshots)):
14. **Snapshot-first with refs**; stale ref yields an explicit error ("try capturing new snapshot"), never a silent misclick. The base already follows this; keep the wording in tool descriptions.
15. **On-demand snapshots** with `target`/`depth`/`boxes` and a `find`-by-text helper for large pages; boxes are the bridge between refs and screenshot clips.
16. **Combine snapshots with screenshots** for canvas/chart/image-heavy pages; do not force a choice.

From **Chrome DevTools MCP** ([Chrome for Developers](https://developer.chrome.com/docs/devtools/agents/get-started)):
17. **DevTools-grade inspection belongs in the viewer.** Chrome's own agent suite exists to bring DevTools workflows — including accessibility and performance debugging — to coding agents; one flat console list is not a dev viewer.
18. **Attach to a live browser instance**, not only a launched one — the same insight as the base's real-browser mode.

From **Stagehand** ([introduction](https://docs.stagehand.dev/v4/first-steps/introduction), [migration notes](https://docs.stagehand.dev/v4/migrations/playwright.md)):
19. **Curated candidate actions**: `observe` proposes concrete actions that can be replayed without inference. For the picker, offer a short, context-aware action list ("make it larger", "match the card above") instead of a blank prompt.
20. **Mix deterministic and AI primitives** in one workflow: picks and refs are deterministic; only the intent interpretation is model work.

Patterns to **not** borrow: a full visual CSS editor as the product center, a design-file format, auto-apply without review, automatic login/cookie import, or frame/proxy HTML rewriting as the primary carrier when a real browser is available.

## 8. What this means for the design

- **Go on fork** (subject to G1): fork 0.4.19, keep its CDP/tool layer, and treat the license as Apache-2.0 with NOTICE + change notices. This matches the current [`MAP.md`](../wayfinder/MAP.md:12) and [`UPSTREAM.md`](../../UPSTREAM.md:14-16), now with artifact-level evidence.
- **Do not compose** the shipped browser or the preview plugins into the product surface; they solve different problems (person-only browsing, annotation-only review, iframe preview). Compose only as a fallback risk response (Electron webview carrier).
- **New work, in order of risk:** human input forwarding (R3/P1) → picker + composer injection (P1) → static preview + live reload (R4/P2) → runner + Electron attach (P3). The preview/runner are the least novel; skip copying and build them inside our protocol.
- **License hygiene is a first-class task**, not paperwork: record the base commit before any copy, and make T1's CI assert the LICENSE/NOTICE texts.

## 9. Unverified and limits

- **Electron over CDP** for the base and for `@hy-sde-org/dsh-browser`: attach is architecturally plausible (both accept a loopback DevTools endpoint / `cdp_url`), but neither documents an Electron-specific flow. R5 must prove it.
- **`dsh-browser-companion`**: not on npm under that name; GitHub `main` package.json not found; tool count, license file and capability rows are **?** and come from a third-party catalog.
- **`dsh-web-review` SPA fidelity**: the proxied preview rewrites HTML rather than rendering in a real browser; complex sites are untested here.
- **Codex official docs** were blocked (HTTP 403) in this environment; the Codex claims cite a public mirror of the same doc. Confirm against the live page before quoting it publicly.
- **Chrome DevTools MCP** details beyond "MCP server + CLI + skills, connects an agent to a live browser" were not verified from the official repo page (page blocked); use it as a pattern, not a spec.
- **Publish times** are UTC from the npm registry and were read on 2026-11-17; they will drift.

## 10. Reference list (primary, read 2026-11-17)

Base:
- <https://cdn.jsdelivr.net/npm/@linxin666/dsh-client-ui-browser-view@0.4.19/package.json>
- <https://cdn.jsdelivr.net/npm/@linxin666/dsh-client-ui-browser-view@0.4.19/LICENSE>
- <https://cdn.jsdelivr.net/npm/@linxin666/dsh-client-ui-browser-view@0.4.19/README.md>
- <https://cdn.jsdelivr.net/npm/@linxin666/dsh-client-ui-browser-view@0.4.19/lib/types/host/tools.d.ts>
- <https://cdn.jsdelivr.net/npm/@linxin666/dsh-client-ui-browser-view@0.4.19/lib/types/host/service.d.ts>
- <https://cdn.jsdelivr.net/npm/@linxin666/dsh-client-ui-browser-view@0.4.19/lib/types/core/cdp.d.ts>
- <https://data.jsdelivr.com/v1/package/npm/@linxin666/dsh-client-ui-browser-view@0.4.19/flat>
- <https://registry.npmjs.org/@linxin666%2Fdsh-client-ui-browser-view>
- <https://raw.githubusercontent.com/zhu1090093659/dsh-web/main/LICENSE>

Other plugins:
- <https://cdn.jsdelivr.net/npm/@canglongcl/dsh-web-review@0.6.0/package.json>
- <https://cdn.jsdelivr.net/gh/CanglongCl/dsh-web-review@main/packages/dsh-web-review/src/preview-server.ts>
- <https://cdn.jsdelivr.net/gh/CanglongCl/dsh-web-review@main/packages/dsh-web-review/src/index.ts>
- <https://cdn.jsdelivr.net/gh/CanglongCl/dsh-web-review@main/README_en.md>
- <https://registry.npmjs.org/@canglongcl%2Fdsh-web-review>
- <https://cdn.jsdelivr.net/npm/dsh-web-preview-panel@0.2.4/README.md>
- <https://cdn.jsdelivr.net/npm/dsh-web-preview-panel@0.2.4/LICENSE>
- <https://cdn.jsdelivr.net/npm/@deepseek-ai/dsh-client-ui-sidebar-browser@0.2.2-rc.3/README.md>
- <https://cdn.jsdelivr.net/npm/@deepseek-ai/dsh-client-ui-sidebar-browser@0.2.2-rc.3/src/client/electron/ElectronWebViewImpl.ts>
- <https://cdn.jsdelivr.net/npm/@deepseek-ai/dsh-client-ui-sidebar-browser@0.2.2-rc.3/src/client/browser/IframeImpl.ts>
- <https://cdn.jsdelivr.net/npm/@hy-sde-org/dsh-browser/package.json>
- <https://cdn.jsdelivr.net/gh/hy-sde/dsh-browser@main/packages/browser/browser/LICENSE>
- <https://cdn.jsdelivr.net/gh/meimiaoji-creator/meow-vision@main/package.json>
- <https://dshplugin.online/plugins/tianyu209--dsh-browser-companion>
- <https://www.npmjs.com/package/@bhzhangsun/dsh-computer-use>

Prior art:
- <https://v0.app/docs/design-mode>
- <https://github.com/crasuna/openai-dev-docs-cn-mirror/blob/main/sources/en/codex/app/browser.md>
- <https://docs.onlook.com>
- <https://aidevbp.developer.huaweicloud.com/practices/p_5ba0c857>
- <https://docs.browser-use.com/cloud/browser/live-preview>
- <https://playwright.dev/mcp/snapshots>
- <https://developer.chrome.com/docs/devtools/agents/get-started>
- <https://docs.stagehand.dev/v4/first-steps/introduction>
- <https://chromedevtools.github.io/devtools-protocol/tot/Input/>
