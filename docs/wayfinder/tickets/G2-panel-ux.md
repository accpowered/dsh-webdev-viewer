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
- The user pointed at the shipped sidebar browser: the Desktop app already has a
  native browser surface, and asked for that in the plugin.

Resolution:

- Found the shipped `@deepseek-ai/dsh-client-ui-sidebar-browser` (MIT): DSH Desktop
  exposes `globalThis.dshDesktop.browser` and enables Electron's `<webview>` tag. The
  shipped browser acquires a guest partition/lease through the bridge and mounts a
  real webview in the sidebar.
- Implemented `src/client/native-browser.tsx` using that same bridge/tag. On Desktop
  the panel now mounts a real guest renderer: native text, native scrolling, native
  input, no JPEG/PNG frame pipeline. The address bar navigates the guest, back/forward/
  refresh operate on it, and the page picker runs via `executeJavaScript` and reports
  picks through a console marker.
- CDP remains the fallback on the web (no Desktop bridge) and the current agent-tool
  transport. The native guest is not yet exposed to `webdev_snapshot/click/...`; that
  bridge is the next task, and the README/panel label it explicitly.
- A mode button switches between Native and CDP for diagnosis/fallback.

The native mode is the answer to the user's requirement; verify it visually with a
hard refresh and then build the native tool bridge.

## Resolution

<!-- Fill when closed. -->
