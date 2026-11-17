# Glossary

Project vocabulary. Keep this free of implementation details; resolved terms only.

- **Viewer** — the right-sidebar tab that displays a live browser page.
- **Panel** — the client-side UI inside the Viewer: screencast canvas, toolbar, picker, logs.
- **Page / Target** — one CDP page target the Host drives; the thing both the user and the agent see.
- **Source** — where the page comes from: `isolated` (a Chromium the plugin launches), `attached` (a Chrome the user started with remote debugging), or `electron` (an Electron renderer attached over CDP).
- **Session binding** — the rule that maps one DSH Session to one Page, so two agents do not fight over one tab.
- **Command / Event** — the WebSocket messages the Panel and Host exchange.
- **Snapshot** — a bounded DOM/ARIA view of the page, with stable `ref`s for actions.
- **Ref** — a session-local element handle from a Snapshot; it expires when the page navigates or the DOM changes.
- **Pick** — a user gesture that selects one page element and produces structured metadata (selector, id, text, box, optional source hint).
- **Quote** — the composer insertion that carries picked elements into the user's next prompt.
- **Preview root** — the workspace directory the static preview server exposes.
- **Runner** — a Host-owned child process for a project dev server or an Electron app.
- **Watch mode** — the Panel presentation where input is not forwarded to the page.
- **Interact mode** — the Panel presentation where pointer and keyboard input are forwarded to the page.
- **Live reload** — automatic page reload after a file under the preview root changes.
