# R3 — CDP screencast, input forwarding, screenshot, snapshot

- Status: research complete; **no live-browser measurement was possible in this workspace** (see §6.5)
- Date: 2026-11-17
- Owner: research-cdp
- Upstream read: `@linxin666/dsh-client-ui-browser-view` 0.4.19 (`lib/types/**/*.d.ts` from the npm tarball) and the GitHub source at `packages/dsh-browser-view` (`dev` branch, fetched 2026-11-17). Published 0.4.19 and `dev` agree on the protocol constants and the CDP calls quoted here; re-check line drift before forking.
- CDP parameter lists were read from the auto-generated protocol mirror at <https://pub.dev/documentation/puppeteer/latest/> (generated from `browser_protocol.json`); the canonical pages are linked next to each command.

## Answer first — go/no-go

**GO for the P1 prototype, narrowly scoped.** Mouse, wheel, keyboard and a commit-only IME path are ordinary CDP commands; the upstream already dispatches them for the agent, so the work is a transport addition (panel → host socket → `Input.*`) plus a coordinate map, not new browser machinery. Element picking is GO for the main frame and open same-origin DOM; screenshot → `ImageBlock` is already implemented upstream.

**Do not promise in P1:** native IME candidate-window fidelity, picking inside cross-origin iframes, picking inside canvas/WebGL content, and "indistinguishable from local" latency. Those are the cases that can still flip the architecture (§7, §8).

The sharpest product risk is not a CDP command; it is **geometry and latency together**: the sidebar column is ~300–500 px wide (`panel.module.css` header comment) while the pinned page viewport is 1280×800 (`DEFAULT_VIEWPORT`, `lib/types/core/protocol.d.ts`), i.e. the user interacts with the page at ~0.31× scale. See §5.

## 1. What the upstream already implements

| Area | Where | What exists |
|---|---|---|
| CDP transport | `src/core/cdp.ts` | one WebSocket, request ids, pending map, per-method listeners, flat sessions, 30 s command deadline |
| Tabs | `src/core/tabs.ts` | `Target.createTarget` / `attachToTarget {flatten:true}` / `closeTarget`, per-tab `Page.enable`, `Runtime.enable`, `Network.enable`, `Log.enable` |
| Screencast | `src/core/tabs.ts` | `Page.startScreencast {format:'jpeg', quality:70, maxWidth, maxHeight, everyNthFrame:1}`; ack-first on `Page.screencastFrame`; frame `width/height` from `metadata.deviceWidth/deviceHeight` |
| Viewport | `src/core/tabs.ts` | `Emulation.setDeviceMetricsOverride {width:1280, height:800, deviceScaleFactor:1, mobile:false}` on created tabs only |
| Mouse/key/wheel | `src/core/actions.ts` | `Input.dispatchMouseEvent` (moved → pressed → released), `mouseWheel` at 640,400 by default, `Input.insertText`, `Input.dispatchKeyEvent` (keyDown/char/keyUp) |
| Screenshot | `src/core/tabs.ts`, `src/core/screenshot.ts` | `Page.captureScreenshot`, clip/scale planning, 8192 px side and 2048² pixel output caps, scale ≤ 3, `captureBeyondViewport:false` |
| Snapshot | `src/core/snapshot.ts` | in-page `Runtime.evaluate` walk, 4000 nodes, ref = depth-first index, selector map in `TabManager`, `getBoundingClientRect` boxes (viewport CSS px) |
| Console/network | `src/core/tabs.ts` | 500-entry rings from `Runtime.consoleAPICalled`, `Log.entryAdded`, `Network.requestWillBeSent`, `Network.responseReceived`, `Network.loadingFailed` |
| Image block | `src/host/tools.ts` (d.ts) | screenshot bytes → `saveImage` → durable `{attachmentId, mediaType, bytes, width, height}` → `ImageBlock` |

**What does not exist upstream:** any human input path. The panel only renders an `<img>` and sends `attach` / `select-tab` / `request-frame` / `close-tab` (`lib/types/core/protocol.d.ts`); `BrowserViewCommand` has no input kind. There is also no `Runtime.exceptionThrown` subscription and no response-body capture.

Because `actions.ts` already resolves a viewport point and dispatches trusted CDP input, P1 should add **one new command kind and one host forwarder**, not a second input system.

## 2. Exact CDP commands and event sequences

Coordinates below are CSS pixels relative to the **main frame's viewport** — the protocol says so for `Input.dispatchMouseEvent.x/y`, and that is the single most important fact for §4.

### 2.1 Attach / session baseline

```
Target.setDiscoverTargets {discover:true}                    // adopted/real-browser mode only
Target.attachToTarget {targetId, flatten:true}               // → sessionId
Page.enable / Runtime.enable / Network.enable / Log.enable   // per session, before events
Emulation.setDeviceMetricsOverride {width:1280, height:800, deviceScaleFactor:1, mobile:false}
```

Flat mode multiplexes browser-level and page-level traffic on one socket; browser-level commands must omit `sessionId` (`cdp.ts` comment). For OOPIF/cross-origin-iframe work, add `Target.setAutoAttach {autoAttach:true, waitForDebuggerOnStart:false, flatten:true}` and attach each child session.

### 2.2 Screencast (view path)

```
Page.startScreencast {
  format: 'jpeg', quality: 70,
  maxWidth: 1280, maxHeight: 800,
  everyNthFrame: 1,
  // newer Chromium only; absent from upstream 0.4.19:
  maxFramesInFlight: 1,
  sendLastFrame: true
}
→ event Page.screencastFrame {data, metadata, sessionId}
   metadata = {offsetTop, pageScaleFactor, deviceWidth, deviceHeight,
               scrollOffsetX, scrollOffsetY, timestamp, monotonicTimestamp}
Page.screencastFrameAck {sessionId}                          // per frame, ack first
Page.screencastVisibilityChanged {visible}                   // optional
Page.stopScreencast
```

Sources: [`Page.startScreencast`](https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-startScreencast), [`ScreencastFrameMetadata`](https://pub.dev/documentation/puppeteer/latest/protocol_page/ScreencastFrameMetadata-class.html), upstream `tabs.ts`. `deviceWidth/deviceHeight` are **DIP**, `scrollOffsetX/Y` are **CSS px**, `pageScaleFactor` is the pinch/page scale (`ScreencastFrameMetadata` docs). With the upstream `deviceScaleFactor:1` pin, DIP == CSS px for the layout viewport, which is why upstream can use `deviceWidth/deviceHeight` as the frame's CSS size.

`maxFramesInFlight` defaults to 3 and `sendLastFrame` trades throughput for latency ("after screencastFrameAck arrives … the last produced frame … is immediately sent", [`startScreencast` mirror](https://pub.dev/documentation/puppeteer/latest/protocol_page/PageApi/startScreencast.html)). Upstream's ack-first handler serialises to ~1 frame in flight by itself, but adding these two params is the cheapest latency win in P1. Feature-detect them (they are recent); unknown params are not guaranteed to be ignored.

**Pacing and backpressure (measured elsewhere).** Screencast is damage-driven: upstream's own comment says "the screencast only emits when the compositor sees a change", and every action calls `refreshFrame()` because a click that opens nothing would otherwise leave the panel stale (`actions.ts`). A canvas redrawn every rAF at 1920×1080 through the screencast+relay path produced 151 frames in 5 s, **48.0 MB** of base64 CDP traffic and **4.47 s of Chrome CPU** in that 5 s window; the same measurement set reports about **4× less Chrome CPU and 15× less CDP traffic** for Chrome's native recorder path ([playwriter `native-screen-recording.md`, measured 2026-11-09, headless Chrome 156 on an M-series Mac](https://github.com/remorses/playwriter/blob/597c0f5bddeb9580a9745787bf4f8636e5e155be/plans/native-screen-recording.md)). Treat the 60 fps figure as achievable only on the native recorder, not on `startScreencast`. Two consequences: screencast is acceptable for a ~1 MP sidebar view and **not** a 60 fps guarantee; and "no new frame" does not mean "input failed".

**Staleness.** The panel drops frames whose per-tab `seq` is ≤ the last rendered one (`socket.ts`), but the host queues every frame it emits; a slow panel therefore accumulates frames in the socket instead of skipping them. P1 must make the host send latest-frame-wins (drop if `ws.bufferedAmount` is non-trivial) and count dropped seq values — otherwise latency grows without bound during scroll.

### 2.3 Mouse

```
Input.dispatchMouseEvent {type:'mouseMoved',  x, y, button:'none', buttons:0}
Input.dispatchMouseEvent {type:'mousePressed', x, y, button:'left', buttons:1, clickCount:1, modifiers:0}
Input.dispatchMouseEvent {type:'mouseReleased', x, y, button:'left', buttons:0, clickCount:1, modifiers:0}
```

Parameters verified: x/y CSS px in the main-frame viewport; `buttons` bitfield Left=1, Right=2, Middle=4, Back=8, Forward=16; `modifiers` Alt=1, Ctrl=2, Meta=4, Shift=8; plus `force`, `tangentialPressure`, `tiltX`, `tiltY`, `twist`, `pointerType: 'mouse'|'pen'` ([`dispatchMouseEvent`](https://chromedevtools.github.io/devtools-protocol/tot/Input/#method-dispatchMouseEvent), [mirror](https://pub.dev/documentation/puppeteer/latest/protocol_input/InputApi/dispatchMouseEvent.html)). For a drag: pressed at the origin, then `mouseMoved` with `buttons:1` (the pressed-button bitfield is how Blink knows a drag is in progress), then released. Double-click: second press/release with `clickCount:2`. Pen: `pointerType:'pen'` plus `force/tiltX/tiltY/twist` — relevant to R6.

Synthetic CDP input enters at the browser's input pipeline above the renderer, so it **does grant transient user activation** and is seen as a trusted event, unlike `element.click()` / `dispatchEvent` ([audit example](https://www.clearcotelabs.com/audit/checks/user-activation-vs-interaction)). Whether Blink also synthesises the full `PointerEvent` sequence, including `pointerType`, for `pointerdown/move/up` and pointer capture, was not verified here — canvas editors depend on it; make it a P1 check (§7).

### 2.4 Wheel

```
Input.dispatchMouseEvent {type:'mouseWheel', x, y, deltaX, deltaY, modifiers}
```

`deltaX/deltaY` are CSS px ([dispatchMouseEvent docs](https://pub.dev/documentation/puppeteer/latest/protocol_input/InputApi/dispatchMouseEvent.html)). Panel events carry `deltaMode`; convert `DOM_DELTA_LINE` (~16 px/line) and `DOM_DELTA_PAGE` (viewport height) to pixels before sending, and keep fractional trackpad deltas. Send the wheel at the cursor position so the element under the pointer receives it. Human wheel forwarding should stay on `mouseWheel`; `Input.synthesizeScrollGesture` (experimental) is for scripted/animated scrolling, not for a live device stream.

### 2.5 Keyboard

```
Input.dispatchKeyEvent {type:'rawKeyDown', key, code, windowsVirtualKeyCode, nativeVirtualKeyCode, modifiers, location, autoRepeat, isKeypad}
Input.dispatchKeyEvent {type:'char', key, code, text, unmodifiedText}         // printable only
Input.dispatchKeyEvent {type:'keyUp', key, code, windowsVirtualKeyCode, nativeVirtualKeyCode, modifiers}
```

Full parameter set: `type` ∈ {keyDown, keyUp, rawKeyDown, char}; `modifiers` Alt=1/Ctrl=2/Meta=4/Shift=8; `text` is layout-produced text, "not needed for keyUp and rawKeyDown"; `unmodifiedText` for shortcut handling; `commands` for editor commands ([`dispatchKeyEvent`](https://chromedevtools.github.io/devtools-protocol/tot/Input/#method-dispatchKeyEvent), [mirror](https://pub.dev/documentation/puppeteer/latest/protocol_input/InputApi/dispatchKeyEvent.html)).

Two cautions:
- Upstream `pressKey` sends `keyDown` **with** `text` and then a separate `char` with the same text (`actions.ts`). Puppeteer/Playwright send `rawKeyDown` (no text) when a `char` will follow. Blink's `kKeyDown` input type already carries the generated character, so the upstream pair may insert twice for printable keys. P1's human path should use `rawKeyDown` + `char`, and `browser_press` should be regression-tested against a text field.
- When Ctrl/Alt/Meta is held, send the modifier in `modifiers` and **no** `char`; otherwise Ctrl+A inserts "a". Emitting modifier-only key events (Shift/Ctrl press and release) keeps the page's own modifier state coherent.

### 2.6 IME

```
Input.imeSetComposition {text, selectionStart, selectionEnd, replacementStart?, replacementEnd?}
Input.imeSetComposition {text:'', selectionStart:0, selectionEnd:0}    // cancel composition
Input.insertText {text}                                                // commit (or plain typing)
```

`imeSetComposition` "sets the current candidate text for IME. Use imeCommitComposition to commit the final text. Use imeSetComposition with empty string as text to cancel composition" ([mirror](https://pub.dev/documentation/puppeteer/latest/protocol_input/InputApi/imeSetComposition.html)); `insertText` "emulates inserting text that doesn't come from a key press, for example an emoji keyboard or an IME" ([mirror](https://pub.dev/documentation/puppeteer/latest/protocol_input/InputApi/insertText.html)). CDP also exposes `Input.imeCommitComposition`; this note did not verify its parameters. Upstream only uses `insertText` (`typeText`).

There is **no CDP surface for the IME candidate window**. Chrome's own candidate-window API belongs to the `chrome.input.ime` extension API and requires the extension to own the active IME ([Chrome docs](https://developer.chrome.com/docs/extensions/reference/api/input/ime)); the Windows candidate list for Microsoft Pinyin is an OS window drawn against the focused native window. In the panel design the composition must therefore originate in a panel-side `<textarea>`: the OS candidate window appears at that textarea inside the DSH window, not at the page's caret inside the frame. Composition text is forwarded with `imeSetComposition`, commit with `insertText`. Functionally usable, spatially wrong; do not claim parity.

### 2.7 Viewport, zoom, focus

```
Emulation.setDeviceMetricsOverride {width, height, deviceScaleFactor, mobile:false}
Page.getLayoutMetrics   → {cssLayoutViewport, cssVisualViewport, cssContentSize}
Emulation.setFocusEmulationEnabled {enabled:true}
Page.bringToFront
```

`getLayoutMetrics` returns layout/visual viewports and the scrollable content size, all in CSS px ([mirror](https://pub.dev/documentation/puppeteer/latest/protocol_page/PageApi/getLayoutMetrics.html)). `setFocusEmulationEnabled` "simulates a focused and active page" ([mirror](https://pub.dev/documentation/puppeteer/latest/protocol_emulation/EmulationApi/setFocusEmulationEnabled.html)); a production DSH plugin uses it so a background/minimized page still reports `visible` and `hasFocus()` ([dsh-edge-cdp README, measured on Edge 155](https://www.npmjs.com/package/dsh-edge-cdp)). That matters for pages that pause work on blur and for `document.hasFocus()`-gated editors.

### 2.8 Element at a point (pick)

```
DOM.getNodeForLocation {x, y, includeUserAgentShadowDOM:true, ignorePointerEventsNone:false}
  → {backendNodeId, frameId, nodeId?}
DOM.describeNode {backendNodeId, depth:0, pierce:true}
DOM.getBoxModel {backendNodeId}          // or Runtime.evaluate getBoundingClientRect
DOM.resolveNode {backendNodeId} → objectId
Runtime.callFunctionOn {objectId, functionDeclaration, returnByValue:true}
Accessibility.enable
Accessibility.getPartialAXTree {backendNodeId, fetchRelatives:false}
```

`DOM.getNodeForLocation` takes viewport coordinates and returns the **frame** the node belongs to (`frameId`), which is the documented way to resolve the node in the right execution context ([Chromium commit adding frameId](https://chromium.googlesource.com/ios-chromium-mirror/+/62632650633a7fd6a118a3abeaaa55fad627d209)). `includeUserAgentShadowDOM` "False to skip to the nearest non-UA shadow root ancestor (default: false)"; `ignorePointerEventsNone` hit-tests through `pointer-events:none` ([mirror](https://pub.dev/documentation/puppeteer/latest/protocol_dom/DOMApi/getNodeForLocation.html)). `DOM.describeNode`'s `pierce` controls whether iframes and shadow roots are traversed ("Whether or not iframes and shadow roots should be traversed when returning the subtree", Chromium [PDL comment](https://chromium.googlesource.com/devtools/devtools-frontend/+/c128d4c6d5086ec57ce48b80ccfc76d6091b4922/third_party/blink/public/devtools_protocol/browser_protocol.pdl)). For a picker, hit-test first, then describe, then compute selector/role/name in the node's own session.

### 2.9 Snapshot

Two options, with different trade-offs:

1. **Upstream's in-page walk** (`snapshot.ts`): one `Runtime.evaluate`, depth-first, 4000-node cap, `getBoundingClientRect` boxes, selector per node, refs = array index, refs invalidated on the next snapshot. It skips script/style/noscript/template, reads text only for leaves, and walks `document.body`'s `children` — so **it never enters iframes or shadow roots**.
2. **`DOMSnapshot.captureSnapshot {computedStyles:[], includeDOMRects:true}`**: "full DOM tree of the root node (including iframes, template contents, and imported documents) in a flattened array, as well as layout and white-listed computed style information… Shadow DOM in the returned DOM tree is flattened" ([mirror](https://pub.dev/documentation/puppeteer/latest/protocol_dom_snapshot/DOMSnapshotApi/captureSnapshot.html)). Better for element picking and boxes; much larger payload (whole document), and OOPIF content still belongs to another session.

For the picker, `DOM.getNodeForLocation` + `describeNode` + AX is more precise than a DOM snapshot and avoids a full-document payload; keep the snapshot for the agent's page outline.

### 2.9a Resolving a node's identity with `Runtime.evaluate`

Once a node is known (hit test or snapshot ref), the fields a composer quote needs are cheap to compute in the page with `Runtime.evaluate {expression, returnByValue:true, awaitPromise:true}`:

- **Selector** — short-circuit on a stable id, otherwise `tagname:nth-of-type(n)` up to the nearest ancestor with an id, as `snapshot.ts` does. Escaping via `CSS.escape`; do not use a selector that may match multiple nodes.
- **Text** — `innerText` for what the user sees, `textContent` for canvas-adjacent hidden text; clip to a few hundred characters before it crosses the socket.
- **Accessible name/role** — prefer `Accessibility.getPartialAXTree` (it computes the real name, including `aria-labelledby` and native labels) over re-implementing the `aria-label`/`labels`/`alt`/`title` fallback that `snapshot.ts` uses. AX also gives the role the model should quote ("button", "link", "textbox") instead of the heuristic tag map.
- **Framework source hints** — React 16+ attaches `__reactFiber$…`/`__reactProps$…` keys to host elements, so `Object.keys(el).find(k => k.startsWith('__reactFiber'))` yields a fiber whose `type`/`_debugOwner` names the component; Vue 3 may expose `el.__vueParentComponent` and `__vue_app__` in dev builds, and both frameworks leave devtools hooks (`__REACT_DEVTOOLS_GLOBAL_HOOK__`, `__VUE_DEVTOOLS_GLOBAL_HOOK__`). These are best-effort, absent in production builds and never required for the pick itself — use them only to enrich the quote.

### 2.10 Screenshot → `ImageBlock`

```
Page.captureScreenshot {format:'png'|'jpeg'|'webp', quality?, clip?:{x,y,width,height,scale}, fromSurface?:true, captureBeyondViewport:false, optimizeForSpeed?}
→ {data: base64}
```

`clip` is in DIP (CSS px) relative to the viewport and `scale` is part of the clip; `format` defaults to png, `quality` applies to jpeg, `fromSurface` defaults to true, `captureBeyondViewport` defaults to false ([mirror](https://pub.dev/documentation/puppeteer/latest/protocol_page/PageApi/captureScreenshot.html), [`Viewport`](https://pub.dev/documentation/puppeteer/latest/protocol_page/Viewport-class.html)). Upstream plans the capture in `screenshot.ts`: viewport-sized unless a whole-pixel clip inside the viewport is given, default clip scale 2, max scale 3, max side 8192 px, max output 2048² pixels, `captureBeyondViewport:false` always.

Return path in this host: base64 → `Uint8Array` → `saveImage({data, mediaType, name})` → `DurableImageRef {attachmentId, mediaType, bytes, width, height}` → tool result as an `ImageBlock` that carries the durable reference, not base64 text (`host/tools.ts` declaration comment: "a screenshot smuggled in as base64 text is not an image to any model that can see one"). The exact DSH `ImageBlock` type is R1's finding; do not re-derive it here.

Screenshot pixels are not necessarily CSS pixels: `Page.captureScreenshot` renders at the surface's device scale (e.g. 2× on a HiDPI display), while a tab pinned to `deviceScaleFactor:1` yields CSS-pixel-sized output ([capture reference](https://github.com/mengxi-ream/read-frog/blob/48dccd04cfdf8432994608215ccad6db329f952b/.agents/skills/record-extension-demo/references/browser-capture.md); playwriter records the same 2× screenshot behaviour). With an explicit `clip.scale` this is deterministic; without one, read the encoded pixel size from the decoded image, never from the CSS viewport.

### 2.11 Console and network rings

```
Runtime.consoleAPICalled {type, args, executionContextId, timestamp, stackTrace?}
Runtime.exceptionThrown  {timestamp, exceptionDetails{text, url, lineNumber, columnNumber, stackTrace, exception}}
Log.entryAdded           {entry{level, text, ...}}
Network.requestWillBeSent / responseReceived / loadingFinished / loadingFailed
Network.getResponseBody {requestId} → {body, base64Encoded}
Network.getRequestPostData {requestId}
```

Event shapes confirmed by the upstream subscriber (`tabs.ts`) and the [Runtime mirror](https://pub.dev/documentation/puppeteer/latest/protocol_runtime/ExceptionThrownEvent-class.html). Upstream keeps 500 entries per tab (`EVENT_RING_SIZE`), resets them when the top-level loader changes, and never subscribes to `Runtime.exceptionThrown` — **an uncaught error is invisible in the current console ring**, a real gap for a dev tool. Response bodies are never captured and would need `Network.getResponseBody` (bodies can be evicted from the network buffer) plus size caps.

## 3. The shell around the image: what upstream actually shows

`panel.tsx` renders a single `<img src="data:image/jpeg;base64,…">` with `width`/`height` set from the wire frame and CSS `.frame { max-width:100%; height:auto; margin:auto; object-fit:contain }` inside a scrollable `.content`. There is no canvas, no pointer handler, no keyboard focus, no cursor rendering. Consequence for P1: a transparent overlay element above the image must own pointer/keyboard events; `getBoundingClientRect()` on that overlay is the only geometry source needed.

The wire frame's `width/height` are documented as "Frame size in CSS pixels" (`lib/types/core/protocol.d.ts`), and the host fills them from `metadata.deviceWidth/deviceHeight` with the pinned viewport as fallback. With `deviceScaleFactor:1` this is exactly the layout viewport; for adopted real-browser tabs (never pinned) it is still DIP, and the panel must not infer CSS size from the JPEG's encoded dimensions.

## 4. Coordinate-mapping algorithm

Given:
- frame size `FW × FH` (wire CSS px),
- page viewport `VW × VH` (CSS px, from `Page.getLayoutMetrics.cssLayoutViewport`, or the pin constant),
- display rect `R = overlay.getBoundingClientRect()`.

```ts
// 1. Uniform fit of the frame into the display box (contain semantics).
//    With today's `max-width:100%; height:auto` CSS there are no bars, but the
//    same math survives a fixed-aspect stage later.
const s  = Math.min(R.width / FW, R.height / FH);
const dw = FW * s, dh = FH * s;
const ox = R.left + (R.width  - dw) / 2;   // letterbox bars, if any
const oy = R.top  + (R.height - dh) / 2;

// 2. Panel CSS px -> frame px (fractional; never round a move).
const fx = (event.clientX - ox) / s;
const fy = (event.clientY - oy) / s;

// 3. Frame px -> page CSS px. Equal when pinned; use both ratios so a
//    downscaled screencast (maxWidth/maxHeight cap in adopted mode) still maps.
const sx = VW / FW, sy = VH / FH;
let cx = fx * sx, cy = fy * sy;

// 4. Clamp to the viewport; pick coordinates are integers, moves are not.
cx = Math.min(Math.max(cx, 0), VW - 1);
cy = Math.min(Math.max(cy, 0), VH - 1);
const pickX = Math.round(cx), pickY = Math.round(cy);
```

Scroll is **not** subtracted: the frame is the viewport, and `Input.dispatchMouseEvent` x/y are viewport-relative. Scroll only enters when converting *document-space* boxes to viewport space — e.g. `DOMSnapshot` layout bounds — where you add `metadata.scrollOffsetX/Y` (CSS px) or read `window.scrollX/Y` at pick time. Snapshot boxes from the upstream `Runtime.evaluate` walk are already `getBoundingClientRect` (viewport) coordinates and need no conversion.

Edge cases:

| Case | Rule |
|---|---|
| DPR (Windows 125/150%, HiDPI) | Pin `deviceScaleFactor:1` for created tabs. On adopted tabs, take `FW/FH` from `metadata.deviceWidth/deviceHeight`, which are DIP, and never from the JPEG's encoded size; the two-ratio step then normalises. |
| Screencast downscale (`maxWidth/maxHeight` cap) | Frame is a uniform downscale of the viewport (aspect kept, never upscaled); `sx`/`sy` absorb it. Assert `|sx − sy| < 0.01` and fall back to `sx` if not. |
| Letterbox bars | Only if the CSS stage fixes an aspect ratio; the `min/2` offsets above handle it. Today's `height:auto` produces none. |
| Sidebar scroll | `.content` scrolls; `getBoundingClientRect()` is viewport-relative, so scrolled panels are already correct. |
| Electron/DSH UI zoom | `clientX/Y` and `R` are in the same CSS-px space, so the ratio cancels. |
| Page zoom (Ctrl± in an adopted Chrome) | Both the frame and input coordinates are post-zoom CSS px; no correction. In pinned headless there is no browser zoom UI at all. |
| Pinch/page scale (`pageScaleFactor ≠ 1`, mobile emulation) | The frame shows the visual viewport; input is layout-viewport CSS px. Map through `visualViewport` in-page: `cx = vv.offsetLeft + (fx / FW) * vv.width`, same for Y. P1 should simply forbid this state (`mobile:false`, no `Emulation.setPageScaleFactor`). |
| Fractional move vs integer pick | `Input.dispatchMouseEvent` accepts numbers; `DOM.getNodeForLocation` is integer-typed. Round only for the pick. |
| Cursor | DevTools screencast does not render the OS cursor, so the panel must draw its own cursor at the last local pointer position; otherwise hover feels dead. |
| Frame/viewport mismatch after resize | Re-read `Page.getLayoutMetrics` on `Page.frameResized`/window resize in adopted mode; never cache the pin for adopted tabs. |

## 5. The geometry problem the commands cannot fix

`panel.module.css` opens with "The column is narrow (roughly 300-500px)… the frame scales to the width it is given." A 1280 px page in a 400 px column is a 0.31× image: 14 px body text renders at ~4.4 px, a 24 px button at ~7.5 px, and one panel pixel is 3.2 page pixels, so a 1 px border is 0.3 px and is unclickable. The same issue exists for the picker: the user aims at a 3 px-wide representation of a 10 px element.

This is a **product geometry decision, not a CDP limitation**, and P1 must settle it before polishing input:

1. pin a viewport that matches the panel (`Emulation.setDeviceMetricsOverride` with e.g. 420×760, `mobile:true`-ish or `mobile:false` responsive) — a device-preview experience, not a desktop-page experience; or
2. make the panel expandable (overlay/floating window) and pin 1280×800 only when it is wide enough; or
3. keep 1280×800 and accept view-only fidelity in the sidebar, with interaction in a separate window (§8).

Upstream's `pinViewport:true` + `DEFAULT_VIEWPORT 1280×800` was chosen for screenshot predictability for the *agent*, not for human pointing. P1 inherits that tension.

## 6. Latency and fidelity

### 6.1 What is verified, what is estimated

- **Verified:** upstream's ack-first serialization, 1-frame-at-a-time screencast use, `Page.captureScreenshot` after every agent action, 70-quality JPEG, 1280×800 pin, `seq`-based staleness drop in the panel.
- **Verified externally:** a screencast+relay at 1080p30 on a rAF-redrawn canvas produced 151 frames/5 s, ~318 KB base64 per frame, ~9.6 MB/s of CDP traffic and ~89% of one Chrome core (playwriter, §2.2).
- **Estimated, not measured on this machine:** every millisecond figure in §6.3. The authoring sandbox could not launch Chromium (§6.5); P1 must measure.

### 6.2 Measurement method (implement before the UI)

Host-side (Node/Electron main):
1. `t0 = performance.now()` before sending `Input.dispatchMouseEvent`; `t1` when its command result returns; `t2` when the next `Page.screencastFrame` arrives. Record `t1−t0` (dispatch), `t2−t0` (input→frame), and `metadata.timestamp`→arrival (encode+transport).
2. Repeat 30× for click, wheel step, one character, and a composition update; report p50/p95/max, warmup excluded.
3. Screenshot cost: time `Page.captureScreenshot` for PNG, JPEG q70, JPEG q70 `optimizeForSpeed:true` at the pinned size.
4. Page-clock cross-check: the page's click/input handler writes `Date.now()` into the DOM; after dispatch, read it back with `Runtime.evaluate`. Compare with the host's `Date.now()` when the frame arrives; same OS clock, so skew is ~1 ms and end-to-end is measurable for a diagnostic build.

Panel-side:
5. On frame receipt: `decodeStart`; `await img.decode()` (or `createImageBitmap`) → `decodeEnd`; then `requestAnimationFrame` + `requestAnimationFrame` after the React commit → `paintAt` (proxy for the compositor paint).
6. End-to-end = panel paint `Date.now()` − page handler `Date.now()` (same OS clock on one machine, so skew is small; the socket timestamp also isolates the host↔panel hop).
7. Scroll: 2 s of 60 Hz wheel deltas; count frames emitted vs frames displayed (`seq` continuity), interval p50/p95, and dropped-count. This is the number that decides "smooth".
8. Typing: 20 characters at 100 ms and at 30 ms spacing; count characters that appear per frame (coalescing) and per-character latency.
9. Run at 60 Hz and, if available, 120 Hz; with the page idle and with a busy page; on Windows 11 at the default 125% display scaling and at 100%.

### 6.3 Expected ranges on Windows (ESTIMATES — replace with §6.2 numbers)

| Segment | Estimate | Basis |
|---|---|---|
| CDP input dispatch (`t1−t0`, loopback WS) | 0.3–2 ms | local socket + renderer dispatch |
| Input → compositor damage → readback + JPEG encode | 8–25 ms | ~1 MP JPEG q70 encode; ~318 KB/frame at 1080p measured externally; encode is the dominant term |
| Type → caret frame, p50 | ~20–45 ms | same pipeline, usually one frame; fast typing coalesces |
| IME composition update → frame | ~20–45 ms per update | `imeSetComposition`, then commit frame |
| Host→panel WS hop (same machine, 130 KB base64) | 1–4 ms | loopback + WS framing |
| Base64→data URL + JPEG decode (1280×800) | 4–10 ms | browser image decode, off main thread |
| React commit + paint wait | 0–17 ms (60 Hz vsync) | next frame |
| **Click → pixels, p50** | **~25–50 ms** | sum, typical |
| **Click → pixels, p95** | **~60–120 ms** | encode spikes, GC, vsync phase |
| Sustained scroll | **~30–50 fps**, not 60 | ack-gated serial stream + ~10–25 ms encode |
| Idle page | no frame until damage; a forced capture per action | upstream comment + `refreshFrame()` |
| `Page.captureScreenshot` per event | **30–120 ms** | too slow for per-move/human feedback; keep it for agent actions and explicit refresh |

If P1 measures p95 click→paint above ~150 ms, or sustained scroll below ~30 fps, the "shared page" feel is not there. If IME composition round-trips slower than ~100 ms per keystroke, typing feels broken even when ASCII is fine.

### 6.4 Fidelity notes that the numbers hide

- Screencast only emits on visual change, so a click that opens nothing and a key swallowed by the page produce no frame. Do not derive "input worked" from frame arrival; ask the page (`Runtime.evaluate`) or force a refresh frame.
- A 1-frame-in-flight stream shows the **state at capture time**, not at display time. Fast typing coalesces: several characters may appear in one frame, and the caret may jump. That is normal and should be accepted, not "fixed" by forcing a screenshot per keystroke.
- JPEG q70 at ~0.31× display scale hides compression artifacts, but at 1:1 (expanded panel) text edges will show ringing. Consider q80 for expanded mode; the cost is bytes, not correctness.

### 6.5 Why this note has no measured numbers (and how P1 unblocks it)

A spike was attempted with the bundled Node 24.21.0 and the installed Edge 157.0.4341.60 (`--headless=new --remote-debugging-port=…`, isolated `--user-data-dir` in `%TEMP%`). Edge aborts before opening DevTools:

```
FATAL:mojo\public\cpp\platform\platform_channel.cc:187] Check failed: . : 拒绝访问 (0x5)
```

The DSH workspace sandbox denies Chromium's mojo named-pipe IPC, so no browser can be launched from this session; approval prompts are disabled, so this cannot be escalated from here. The harness in §6.2 is ready to run from a normal shell or from `pnpm` inside P1. Nothing in this note depends on the failed spike except the estimate column, which is labelled.

## 7. Cases that will not work (or need a workaround)

| Case | What breaks | Workaround / verdict |
|---|---|---|
| **Native IME candidate window** | The OS candidate list is rendered against a native focused window; the screencast carries page pixels only and CDP has no candidate-window API (§2.6). | Panel-side hidden textarea + `imeSetComposition`/`insertText`; candidate list floats over the DSH window at the panel caret, not at the page caret. Accept as "works, wrong place"; do not gate P1 on it. |
| **Canvas / WebGL editors** (Figma, Excalidraw, Google Docs canvas mode) | Pixels stream fine, but `DOM.getNodeForLocation` returns the `<canvas>`; no element/selector/role/text to pick; annotations degrade to coordinates. Apps that listen only to trusted pointer/key events may still work, but pointer-event synthesis is unverified (§2.3). | Pick as a screenshot region + page coordinates; label quote "canvas region". Do not promise semantic picking. |
| **Cross-origin iframes** (Stripe, YouTube, CodePen) | Input still routes at the browser level, but `Runtime.evaluate`/DOM snapshot cannot see inside; `getNodeForLocation` returns the iframe node and its `frameId`, and resolving the inner node needs that frame's own session. | `Target.setAutoAttach {flatten:true}` + per-OOPIF session for picking; defer past P1. Screenshot and input already work. |
| **Shadow DOM** | Upstream's walk uses `children` only, so open shadow roots are invisible to snapshots. `getNodeForLocation` may return the inner node (open roots) or the host (closed roots); `includeUserAgentShadowDOM` only affects UA roots. | Picker works best-effort; snapshot needs a walker that descends into `shadowRoot` and composes selectors. P1: pick works via hit test, snapshot is main-DOM only. |
| **Browser shortcuts** | CDP cannot trigger browser UI (Ctrl+T/W/L, F12, Ctrl+Shift+I) — documented as "these do NOT work via CDP" ([pydoll keyboard docs](https://github.com/autoscrape-labs/pydoll/blob/07f4d9a934c6c1bd4e68a63da0ce7ce902ecb27e/docs/pt/features/automation/keyboard-control.md)). Electron accelerators (Cmd/Ctrl+W, Ctrl+R) fire in the DSH window unless intercepted: `webContents.on('before-input-event', … event.preventDefault())` also **stops the event reaching the renderer**, so to keep page keybindings while suppressing the menu use `setIgnoreMenuShortcuts`/menu policy instead ([lesson](https://github.com/daintreehq/daintree/blob/e538fd75addd2cf5c32923559cb98d528463b72f/.lessons/2714.md)). | Panel intercepts its own shortcuts; page-level shortcuts (Ctrl+A/C/V, editor commands) are forwarded as key events. Clipboard paste may still need permissions/user activation. |
| **Focus** | Headless/background page reports `document.hasFocus() === false`, `window.blur` handlers fire, editors pause. | `Emulation.setFocusEmulationEnabled(true)` (measured to keep `hasFocus()` true while minimized, [dsh-edge-cdp](https://www.npmjs.com/package/dsh-edge-cdp)); plus a click to focus the right element. |
| **Scrollbars / layout** | Isolated launch passes `--hide-scrollbars` (`chrome.ts`), so page layout differs from the user's Chrome (width, scrollbar-gutter). | Documented divergence; for pixel-faithful preview run headed or drop the flag. |
| **Pointer outside the panel, pointer lock, fullscreen, popups** | Pointer capture works inside the panel element; dragging into another DSH region loses events. Fullscreen/popup creation needs a real browser window; headless has none. | Keep interactions inside the panel; treat fullscreen/popup as unsupported in isolated mode. |
| **Audio / video** | Screencast is video frames only; no audio. Headless autoplay policies may block media. | Out of scope for the viewer; `--autoplay-policy` if needed. |
| **Selection, context menu, drag-and-drop, file inputs** | Text selection works if the page receives the events and the panel does not steal them; right-click context menu is page-drawn only (no native menu); file input needs `DOM.setFileInputFiles`. | Implement selection with the overlay forwarding; file input as an explicit picker action later. |
| **Adopted real Chrome at DPR ≠ 1 or page zoom** | Frame size (DIP) ≠ screenshot size (device px); page zoom changes CSS viewport. | Use `getLayoutMetrics` per resize + two-ratio mapping (§4); never assume 1280×800. |
| **Concurrent screencast/recording** | Chrome refuses a second screencast on the same tab (`Screencast is already active`), and `Page.startScreenRecording` conflicts with it. | One consumer per tab; serialize P2 recording with the panel. |

## 8. Recommendation for P1

**Scope the prototype to:** pointer (move/press/release, drag, wheel), keyboard (rawKeyDown/char/keyUp with modifiers), commit-only text (`insertText`), picker on the main frame, and the existing screenshot/snapshot/console/network paths. Treat IME *candidate UI*, cross-origin iframes and canvas semantics as explicitly out of prototype scope.

Concrete plan:

1. **Wire contract:** add `input` commands (pointer/wheel/key/ime) to `BrowserViewCommand` and a host handler that validates the tab still exists and forwards to that tab's session. Keep the existing loopback auth fence; input is a bigger capability than viewing, so reuse the socket's origin/session checks rather than adding a second channel. Adding command kinds is a contract change for both halves — bump `BROWSER_VIEW_API_VERSION` if any host/panel skew is possible.
2. **Panel overlay:** absolutely-positioned div over the `<img>`; `setPointerCapture` on press; `wheel` listener with `{passive:false}` and `preventDefault` (otherwise the sidebar scrolls instead of the page); a focusable hidden `<textarea>` for IME and for `paste`; track modifier state from keydown/keyup; draw a local cursor sprite on pointermove. Keys must not leak to DSH shortcuts (Electron `before-input-event` + menu policy per §7).
3. **Mapping:** implement §4 as a pure function with unit tests for (pinned 1280×800 at 400 px wide), (letterboxed stage), (adopted viewport change), (DPR 1.5), (fractional move vs integer pick). Read `Page.getLayoutMetrics` on resize in adopted mode.
4. **Screencast tuning:** pass `sendLastFrame:true`/`maxFramesInFlight:1` when the protocol supports them; keep ack-first; make the host drop frames when the panel socket is backed up instead of queueing; count dropped `seq` values and expose them in the trace line.
5. **Picker:** `DOM.getNodeForLocation` at the click point with `includeUserAgentShadowDOM:true`; `DOM.describeNode`; compute a stable-ish selector, AX role/name via `Accessibility.getPartialAXTree`, box via `DOM.getBoxModel`; fall back to "region at x,y" when the node is a canvas or a cross-origin iframe. Insert the quote with `inputActions.insertQuote` (P1) — same pattern as the agent's `browser_snapshot` refs, but with a fresh four-field quote: tag, id/class, AX name/role, box, and selector.
6. **Measure first:** build §6.2 before any UI polish, record numbers in the P1 ticket, and keep the harness as a script. Also regression-test `browser_press` for double insertion (§2.5).
7. **Geometry decision:** pick one of the three options in §5 with the user before building the picker UI. The panel's default width cannot show a 1280×800 page legibly.

**What would change the architecture (kill criteria):**
- Click→paint p95 > ~150 ms, or sustained scroll < ~30 fps after `sendLastFrame`/drop tuning → the shared-page interaction is not credible in a screencast panel; fall back to a headed browser window next to DSH (view-only panel, human drives the real window, agent drives the same page over CDP), or a WebRTC-style remote-input path.
- IME composition unusable for CJK users → restrict v1 to ASCII/`insertText` and label the limitation, or make the headed-window mode the CJK path.
- Pointer-event synthesis/capture insufficient for the target canvas app → interaction fidelity is per-app; do not generalise.
- Panel geometry cannot be widened or made expandable → input forwarding still works technically but is a demo, not the product; re-open the G1 UX decision.

## What this means for the design

The CDP layer is the easy half: every interaction P1 needs is a small, documented command set, and the upstream already has the tab/session framing, the viewport pin, the screenshot planner and an input executor for the agent. Human input is an additive wire command plus a coordinate map, not a rewrite. The hard half is **experience**: a 1280×800 page shown at ~0.31× in a 300–500 px sidebar cannot be pointed at precisely, and the ack-gated damage-driven JPEG pipeline will feel like 25–50 ms best case and 60–120 ms at p95 — visible but probably acceptable for clicking, marginal for typing, and visibly "remote" for dragging.

**Go/no-go: GO for P1**, with the explicit acceptance that P1 measures click→paint, scroll fps and IME round-trip on Windows before the picker UX is designed, and with the geometry decision (§5) taken up front. The prototype must not assume native IME candidate-window fidelity, semantic picking inside canvas/iframes, or 60 fps streaming.
