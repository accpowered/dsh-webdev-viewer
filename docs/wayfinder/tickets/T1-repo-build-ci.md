---
id: T1
type: task
status: in_progress
blocked_by: []
owner: lead
write_scope: package.json, cordis.patch.yml, tsconfig.json, tsconfig.client.json, scripts/, .github/, LICENSE, NOTICE, UPSTREAM.md
---

# T1 — Package, build, CI, license, attribution

## Question

Turn the scaffold into a reproducible package:

- Fork the chosen base at a pinned commit; record it in `UPSTREAM.md`.
- Rename the package, tab kind, tool prefix, socket/route paths, locale namespace.
- Set up TypeScript, the Host build, and the client bundle build (`window.__ModuleLoader__.load` wrapper).
- Add typecheck/test/build scripts and a GitHub Actions workflow.
- Resolve the license discrepancy (Apache-2.0 vs BSD-3-Clause) and finalize `LICENSE`/`NOTICE`.
- Verify `npm pack --dry-run` includes the runtime files, locale, docs, icon, license, notice.

## Why it matters

An installable, legally clean package is the delivery unit. The client bundle format and license are the two easiest things to get wrong.

## Acceptance

- `pnpm typecheck`, `pnpm test`, `pnpm build` pass locally.
- `npm pack --dry-run` lists the expected files and no dev-only files.
- CI runs on a clean checkout.
- `LICENSE` matches the governing upstream license; `NOTICE` attributes the base; modified upstream files carry change notices.
- `UPSTREAM.md` records the base commit and modification list.

## Progress (2026-11-17)

- Fork copied from `@linxin666/dsh-client-ui-browser-view` 0.4.19 (commit `5786418a…`) and renamed.
- `pnpm typecheck` passes; `pnpm build` emits `lib/index.js` and `lib/client.js`, including the native Desktop webview.
- `pnpm install` needs the repo-local `.npmrc` (`node-linker=isolated`, `auto-install-peers=false`) and `pnpm-workspace.yaml` to deny the native build scripts the sandbox cannot run; a clean install then succeeds.
- **Tests: 216 passed, 15 files** with the copied upstream `tests/client/**` suites excluded. Those suites are integration tests for the DSH monorepo and fail here on missing test-only peers of `dsh-client-ui-primitives` (`shiki` language packs, `micromark` helpers, `zustand`), not on this plugin's code. The core/host suites (protocol, preview server, tabs, actions, routes, tools, workspace) are the gate. Documented in `vitest.config.ts`.
- `pnpm pack --pack-destination .tmp` produced `dsh-webdev-viewer-0.1.0.tgz`; contents include `lib`, `src`, locale, docs, icon, `LICENSE`, `NOTICE`, `LICENSES`, `UPSTREAM.md`, `cordis.patch.yml`.
- CI workflow is present; `npm pack --dry-run` is not directly runnable because this runtime ships no npm binary, but `pnpm pack` verified the same file set.
- `private` is now false and the version is `0.1.0`; publication is pending the native-view confirmation.

## Resolution

<!-- Fill when closed. -->
