---
id: P5
type: feature
status: in_progress
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

## Acceptance

- A recorded native walkthrough: agent `webdev_snapshot`/`click`/`type` change the **same native guest** the human sees; screenshot is of that guest; console shows its entries.
- Tool results match the CDP shape so the model sees no special case.
- Panel close/timeout/switch to CDP rejects pending calls with an actionable error.
- Network limitation is documented in the tool description and README.
- Unit tests for request/response correlation and timeout; one browser-level integration test with the desktop bridge.
