---
id: G2
type: grilling
status: in_progress
blocked_by: []
owner: lead
write_scope: docs/wayfinder/tickets/G2-panel-ux.md
---

# G2 — Panel UX after the first prototype

## Question

Review the first working panel with the user and settle:

- Toolbar density and discoverability: address bar, pick, preview, run, logs, interact toggle, float/fullscreen.
- Pencil-inspired prompt flow: select → prompt bubble → curated actions → quote or direct send.
- Multi-select/annotation behavior and how picks survive reloads.
- Log/console/network presentation and "send to chat".
- Empty states, first-run flow, and the "no viewer open" agent-tool UX.
- Light/dark theme, 390px width, keyboard accessibility, Chinese/English copy.

## Why it matters

The panel is the product. The first prototype will reveal whether the toolbar, picker, and log surfaces are usable or crowded.

## Acceptance

- The user's feedback is recorded here.
- The spec (`docs/spec.md`) is updated with the settled panel behavior.
- Any new decision gets an ADR if it is hard to reverse.
- Follow-up tasks are added to the map.

## Feedback (2026-11-17)

The user's first look:

- The sidebar **feels like a browser being streamed**, not a browser running in the
  sidebar.
- The page was **blurry** at the docked width.
- Interact clicks did not visibly respond, and there were no selection markers.
- Earlier: the real browser window was activated and its page elements interacted
  normally, but development picking was not available there.

Actions taken in response:

- Page-side picker (adapted from the MIT `dsh-web-preview-panel` marking code) lets
  a click in the **real browser window** become a pick; hover/active outlines are
  drawn in the page.
- `viewport` sizes the page to the panel's content box; `pick-mode` and the PNG
  screencast remove JPEG blur.
- The page is now visibly interactive in the real browser; the sidebar remains a
  live CDP view.

The remaining question is architectural, not cosmetic: the installed DSH UI
guidance says to render plugin pages as React components and **not** to serve an
HTML page from the Host and embed it in an iframe. The shell gives plugins no
native BrowserView/webview. A literal browser surface inside the sidebar is not
available at the plugin layer; the shipped browser tab also uses CDP. The native
surface is the real browser window, with the sidebar as controller/mirror. Record
the user's decision before changing the architecture.

## Resolution

<!-- Fill when closed. -->
