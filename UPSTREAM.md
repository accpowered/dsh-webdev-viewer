# Upstream base

## Leading candidate

| Item | Value |
| --- | --- |
| Package | `@linxin666/dsh-client-ui-browser-view` |
| Version surveyed | `0.4.19` (published 2026-11-16) |
| Repository | <https://github.com/zhu1090093659/dsh-web> |
| Source path | `packages/dsh-browser-view` |
| DSH compatibility | `>=0.2.2-rc.3` |
| Runtime dependency | `ws` |

## Why this base

It already implements the hard parts: a lazy Chromium process, CDP client and flat-session tab manager, snapshot refs, screenshots returned as image blocks, console/network rings, a WebSocket panel protocol, isolated and real-browser attach modes, owner/session tab binding, and idle cleanup. The gaps we plan to fill are human input forwarding, element picking/annotation, static preview/live reload, project running, Electron workflow, and open-source packaging.

## License finding (must resolve before release)

The package is **inconsistent**:

- `package.json` declares `"license": "BSD-3-Clause"`.
- The README badge says `BSD-3-Clause`.
- The shipped `LICENSE` file is **Apache License 2.0** (11,358 bytes).
- The upstream repository root `LICENSE` is also **Apache License 2.0** (confirmed by R2).

Until the upstream author clarifies, this repository ships the Apache-2.0 text (the actual license file) and a `NOTICE` attribution. If the governing license is confirmed BSD-3-Clause, replace `LICENSE` and simplify `NOTICE`. If it is Apache-2.0, mark modified files with a prominent change notice as Apache-2.0 section 4(b) requires.

Do not copy source from the upstream repository until this is resolved and the base commit is recorded below.

## Base commit

- Tag: `v0.4.19`
- Commit: `5786418aababf43e9f4756bef01e08e3c3956cf8`
- Date: 2026-11-16

Record the exact source tree actually copied here once the fork lands. Do not mix files from a later commit without updating this section.

## Modifications

Source copied on 2026-11-17 from `v0.4.19` (commit `5786418aababf43e9f4756bef01e08e3c3956cf8`).

- Package renamed `@linxin666/dsh-client-ui-browser-view` → `dsh-webdev-viewer`.
- Tab kind renamed `browser-view` → `webdev` so the upstream package and this fork can coexist in the same sidebar; the shipped `browser` kind is still untouched.
- Tab type id / keyed slot key renamed to `dsh-webdev-viewer`; locale namespace renamed to `webdev`.
- Panel socket and status route moved to `/api/dsh-webdev-viewer/{socket,state}`.
- Agent tools renamed `browser_*` → `webdev_*`; descriptions updated accordingly.
- Settings/bundle row ids renamed to `ui-webdev`; the bundle patch inserts that row.
- Build preset copied from the upstream repository's `shared/tsdown.client.ts` and `shared/web-platform.ts` (Apache-2.0) with a local `tsdown.config.ts` that externalizes all `@deepseek-ai/*` host imports.
- Every modified upstream source/test file carries an Apache-2.0 §4(b) change notice at the top.
- Upstream README/AGENTS/package/patch files are retained under `docs/upstream/` for attribution and reference; they are not the active package instructions.

The functional additions (human input, picker, style inspector, preview/live reload, runner, Electron attach) are tracked in the wayfinder map and are not part of the copied base yet.
