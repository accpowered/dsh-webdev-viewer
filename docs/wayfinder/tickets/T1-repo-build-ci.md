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

## Resolution

<!-- Fill when closed. -->
