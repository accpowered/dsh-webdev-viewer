---
id: P1
type: prototype
status: in_progress
blocked_by: [G1, R3]
owner: lead
write_scope: src/core/, src/client/, src/host/service.ts, src/host/routes.ts, src/host/tools.ts, tests/core/, tests/client/
---

# P1 — Fork + human input + element picker

## Question

Does the fork of `@linxin666/dsh-client-ui-browser-view` support the two experiences that decide the product: **the user can interact with the same page the agent drives**, and **a click can turn into a composer quote**?

Build a throwaway spike that:

1. Renames the package/tab kind/tool prefix to `dsh-webdev-viewer` / `webdev` / `webdev_*`.
2. Opens the right-sidebar tab and streams a page.
3. Forwards mouse down/up/move, wheel, key down/up, and a simple IME/`Input.insertText` path from the panel to CDP.
4. Adds a Pick mode: click an element, resolve selector/id/text/role/box, and insert a structured quote via `inputActions.insertQuote`.
5. Measures click-to-frame and type-to-frame latency on Windows.

## Why it matters

If input forwarding or picker insertion is impractical, the architecture changes (Electron webview, view-only panel, or a separate annotation plugin). This is the highest-risk assumption in the plan.

## Acceptance

- A local branch/directory that can be installed or run in the Desktop profile without touching the user's other plugins.
- A recorded walkthrough (text + screenshot) of: open tab, click a button, type in an input, scroll, pick an element, see the quote in the composer.
- Latency numbers and known failure cases (IME, DPR, canvas content, iframes).
- A go/no-go note in `## Resolution` with the next change if no-go.
- No writes outside the scope; the spike is disposable.

## Hints

- The upstream has a `BrowserViewCommand` union, a panel socket, and `core/actions.ts`; add input as a new command rather than rewriting.
- The tab body is session-scoped, so `inputActions` is a standard slot prop.
- Keep the picker overlay in the panel (not the page) if possible; use CDP `DOM.getNodeForLocation` to resolve the element under the click.
- Use a headed/isolated browser for the spike; do not attach to the user's real Chrome.

## Progress (2026-11-17)

- Added additive v1 protocol commands `input` and `pick`, and the `pick-result` event, with validators.
- Added `src/core/input.ts` (mouse/wheel/key/text via the same CDP primitives the agent actions use) and `src/core/pick.ts` (element-at-point, selector, fingerprint, box, source hints, page version).
- Added panel Interact/Watch and Pick toggles, pointer/wheel/key/paste/IME input, a hidden IME textarea, a multi-pick bar, and `inputActions.insertQuote` with a clipboard fallback.
- Added `viewport` and `pick-mode`. The panel sizes the page viewport to its content box (sharp 1:1 frame) and the page-side picker, adapted from the MIT `dsh-web-preview-panel` marking code, lets a click in the **real browser window** become a pick through a CDP binding.
- Added a **native Desktop webview** mode (`src/client/native-browser.tsx`) using the same `dshDesktop.browser` bridge and Electron `<webview>` tag as the shipped sidebar browser. It is native rendering/interaction; the page picker runs in the guest and reports through a console marker. CDP remains the fallback and the current agent-tool transport.
- `pnpm typecheck` and `pnpm build` pass; the protocol test passes (`tests/core/protocol.spec.ts`).
- Live-verified: real-browser attach, agent tools, panel socket `pick`, `input`, `viewport` (390×800 frames), and page-side pick (`pick-result` with selector/classes/box). The panel's own pointer/pick/quote path still needs the user's visual confirmation after refreshing the DSH page.

## Resolution

<!-- Fill when closed. -->
