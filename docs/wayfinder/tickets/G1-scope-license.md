---
id: G1
type: grilling
status: closed
blocked_by: []
owner: lead
write_scope: docs/wayfinder/tickets/G1-scope-license.md
---

# G1 — Round 1: scope, base, window, picker, license

## Question

Settle the decisions that shape the architecture before prototypes:

1. **Platform**: Desktop-first (Web degrades to same-origin preview) vs Desktop+Web equal vs Web-first.
2. **Base**: fork `browser-view` vs compose existing plugins vs clean-room vs Electron webview + Playwright.
3. **Separate window**: sidebar floating/fullscreen + headed Chrome/Electron vs OS-level Electron window vs in-sidebar only.
4. **Interaction**: default Interact with Watch toggle vs view-only.
5. **Picker**: multi-select + annotation + composer quote (no auto-send) vs auto-send vs single-click copy.
6. **Live reload**: static always + dev-server HMR default vs all-reload vs manual.
7. **Runner scope**: detected scripts + Electron attach + config allowlist vs arbitrary commands vs no runner.
8. **Vision fallback**: screenshot image, clear error when the route lacks image input vs text-only fallback.
9. **License/repo**: Apache-2.0 (actual upstream LICENSE) vs BSD-3 (package.json claim) vs clean-room MIT; repo `accpowered/dsh-webdev-viewer`, package `dsh-webdev-viewer`.
10. **v1 boundary**: exclude visual CSS editor, multi-user, mobile, full-page stitching, network body replay.

Recommended answers are in `docs/wayfinder/MAP.md` and the plan in the conversation. The user may override any of them.

## Why it matters

These decisions fix the fork/license path, the panel interaction model, and the v1 scope. Prototypes P1–P3 and the spec should not start until they are settled.

## Acceptance

- The user's answers are recorded here as a numbered resolution.
- Each answer that changes an ADR candidate creates or updates an ADR file.
- The license decision is explicit and matches `LICENSE`/`NOTICE`.
- The map's `Decisions so far` is updated and dependent tickets unblocked.

## Current answers (2026-11-17)

1. **Platform**: Desktop-first. Web degrades to same-origin iframe preview with a clear limitation notice.
2. **Base**: Fork `@linxin666/dsh-client-ui-browser-view`.
3. **Separate window**: sidebar floating/fullscreen + headed Chrome/Electron window; native OS-level window embedding is out.
4. **Interaction**: default Interact, with a Watch toggle.
5. **Picker**: multi-select + annotation + composer quote; no auto-send.
6. **License**: treat the shipped Apache-2.0 LICENSE as governing; keep NOTICE and modified-file notices.
7. **Electron**: renderer attach over CDP + main-process logs.
8. **v1 scope**: static preview + Vite/Next + Electron attach **plus a visual CSS editing surface**.
9. **Live reload**: default recommended — static preview always reloads; dev servers use HMR, with an optional all-reload toggle.
10. **Runner scope**: default recommended — detected scripts only, arbitrary commands behind config allowlist.

**Visual CSS editing follow-up (2026-11-17):**

- **Depth**: temporary overrides + annotation to the agent. The plugin does **not** write source directly.
- **Property set**: common visual properties — text, color, font, size, line-height, dimensions, opacity, spacing, layout, border, radius, effects.
- **Apply**: live preview via temporary overrides; the user clicks "send to agent" manually. No auto-send.

## Resolution

G1 is closed. The decisions above are the v1 baseline:

- Desktop-first.
- Fork `browser-view`; Apache-2.0 governs.
- Sidebar floating/fullscreen + headed Chrome/Electron; no native OS-window embedding.
- Default Interact with a Watch toggle.
- Multi-select pick + annotation + composer quote; no auto-send.
- Static preview + Vite/Next + Electron renderer attach + main-process logs.
- Temporary visual style inspector (common properties, live preview, manual send).
- Static preview always reloads; dev servers use HMR with an optional all-reload toggle.
- Runner uses detected scripts only; arbitrary commands behind config allowlist.

Dependent tickets are unblocked accordingly. The visual style work is tracked by R7/P4; the panel UX review is G2.
