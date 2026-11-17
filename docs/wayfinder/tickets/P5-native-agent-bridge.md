---
id: P5
type: feature
status: completed
blocked_by: []
owner: lead
write_scope: src/client/, src/host/, src/core/protocol.ts, tests/
---

# P5 — Native webview agent bridge

## Question

Can `webdev_*` tools drive the **native Desktop `<webview>`** the user is actually looking at, so the agent and the human share one native surface instead of a separate CDP browser?

## Why it matters

The native Desktop mode (G2) removed the stream and gave the user real rendering/input, but the agent tools still target the CDP attachment. Agent clicks and user clicks are then on two different page instances. This is the remaining correctness gap in the native path.

## Proposed shape

- `native-attach { sessionId }` / `native-detach` from the panel; the service records the active native sink.
- Host → panel: `native-request { requestId, op, args }`; panel → Host: `native-result { requestId, result?, error? }`.
- Ops: `navigate`, `snapshot` (reuse `buildSnapshotExpression`), `click` (selector/ref/point + `sendInputEvent`), `type`/`press` (key events), `scroll`, `screenshot` (`capturePage` → PNG), `console` (ring from `console-message`), `back`/`forward`/`reload`.
- Network is limited: the webview tag does not expose request/response events. Return a clear limitation or a performance-resource approximation; do not fake status codes.
- Fall back to CDP when no native panel is attached or the bridge is unavailable; label the active transport in the panel.
- Timeouts and panel close must reject pending requests instead of hanging a tool.

## Resolution

Implemented and verified live on the desktop Bing guest:

- `webdev_desktop_navigate` loaded `https://cn.bing.com`.
- `webdev_desktop_snapshot` returned the real DOM with refs.
- `webdev_desktop_type` + `webdev_desktop_press` submitted a search.
- `webdev_desktop_screenshot` returned a 1295×1508 PNG of that same guest.
- The panel re-sends `native-attach` whenever its socket is open, so a Host reload does not leave the guest detached.
- The desktop screenshot is PNG-only; network remains a documented CDP path. Unit tests for timeout/correlation are still a follow-up, but the live bridge is proven.
