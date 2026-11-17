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
- `pnpm typecheck` passes; `pnpm build` emits `lib/index.js` (144 kB) and `lib/client.js` (123 kB).
- `pnpm install` needs the repo-local `.npmrc` (`node-linker=isolated`, `auto-install-peers=false`) and `pnpm-workspace.yaml` to deny the five native build scripts the sandbox cannot run; a clean install then succeeds.
- Installed into the `desktop` profile as a link; result `restart-required` (`package-moved`), so the plugin is not live until DSH restarts.
- Tests: 14/20 files and 229/238 tests pass. The 6 failing files are environment/test-harness issues, not build failures: two host `removeTempProfile` cases are denied temp/home access by the sandbox; four client files need the upstream monorepo's test-only transitive deps (`clsx`, `shiki`, `zustand`) and a React `act`-flushing harness. Fix before claiming T1 complete.
- `npm pack --dry-run` and CI have not been verified yet.

## Resolution

<!-- Fill when closed. -->
