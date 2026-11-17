---
id: R3
type: research
status: closed
blocked_by: []
owner: research-cdp
write_scope: docs/research/cdp-input.md
---

# R3 — CDP screencast, input forwarding, screenshot, snapshot

## Question

Can a CDP screencast panel forward real human mouse, wheel, keyboard, and IME input to the page with acceptable latency and fidelity, and what exact CDP commands and limits apply?

Cover at least:

- `Page.startScreencast` / `Page.screencastFrame` / `Page.screencastFrameAck`; frame format/quality, frame pacing, backpressure, staleness.
- `Input.dispatchMouseEvent` (move/down/up/wheel), `Input.dispatchKeyEvent`, `Input.insertText`, IME composition, modifier keys, focus.
- Coordinate mapping: canvas CSS size vs frame width/height, device pixel ratio, scroll position, page zoom, viewport pinning.
- `DOM.getNodeForLocation` / `DOM.describeNode` / `DOMSnapshot.captureSnapshot` for element picking; shadow DOM/iframe behavior.
- `Runtime.evaluate` for selectors, text, accessibility names, React/Vue source hints.
- `Page.captureScreenshot` clip/scale/format, viewport vs full page, size limits; how to return an `ImageBlock`.
- `Runtime.consoleAPICalled` / `Runtime.exceptionThrown` / `Network.*` event rings.
- Latency/fidelity measurements on Windows: click-to-frame, type-to-frame, scroll smoothness, IME.

## Why it matters

This is the core of "the user and agent share one page". If input forwarding is unusable, the whole product direction changes toward an Electron webview or a view-only panel.

## Acceptance

A cited Markdown note at `docs/research/cdp-input.md`:

- A command sequence for each interaction (mouse, wheel, key, IME, pick).
- A coordinate-mapping algorithm with edge cases (DPR, zoom, scroll, letterboxing).
- Measured or clearly estimated latency, with the measurement method.
- A list of browser/OS cases that will not work (e.g., native IME candidate window, canvas-rendered editors, cross-origin iframes).
- A go/no-go recommendation for the P1 prototype.

## Hints

- Prefer primary sources: Chrome DevTools Protocol docs, Electron/Chromium source, the upstream `browser-view` implementation.
- A small spike page with buttons/inputs/scroll areas is enough; do not build the plugin for this ticket.

## Resolution

Resolved by [`docs/research/cdp-input.md`](../../research/cdp-input.md). **GO for P1, narrowly scoped.** The upstream action layer already dispatches mouse/key/wheel/`Input.insertText`; human input needs one additive panel command and a coordinate map. The real blocker is geometry: a ~300–500 px sidebar panel versus a pinned 1280×800 viewport makes text ~0.31×, so P1 must choose a panel-sized viewport, an expandable/fullscreen panel, or a headed-window fallback. Add latest-frame-wins backpressure and a `Runtime.exceptionThrown` ring. Native IME candidate-window fidelity, cross-origin iframe/canvas picking, and browser shortcuts are explicit limits. Falsification thresholds: p95 click→paint > 150 ms, or scroll < 30 fps → headed-window fallback.
