---
id: T3
type: task
status: in_progress
blocked_by: []
owner: lead
write_scope: README.md, README.zh.md, docs/, locale/, icon.svg, CHANGELOG.md, CONTRIBUTING.md, SECURITY.md, .github/workflows/
---

# T3 — Docs, packaging, release, GitHub publish

## Question

Prepare the open-source release: README(en/zh), plugin detail page, icon, locale, security/limitations, contributing, changelog, CI, tag, GitHub repository, and optional npm publish.

## Why it matters

The user asked for an open-source repo. The release must be honest about limitations (CDP port, Electron renderer only, Chrome requirement) and legally clean.

## Acceptance

- README and README.zh explain what it does, how to install, how to use, and what it cannot do.
- `docs/DETAIL.md` + `preview.svg` follow the DSH plugin-details rules.
- Icon is original or properly attributed; locale metadata is complete.
- `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md` exist.
- CI is green; tag `v0.1.0` exists.
- GitHub repo `accpowered/dsh-webdev-viewer` is public, with the map/research/spec in it.
- Optional npm package `dsh-webdev-viewer` is published or the install command is documented.
- The license/attribution is final and consistent.

## Progress (2026-11-17)

- Public repository created and pushed: <https://github.com/accpowered/dsh-webdev-viewer>, main plus tag `v0.1.0`; the temporary deploy key was removed and `/keys` verified empty.
- README(en/zh), CHANGELOG, CONTRIBUTING, SECURITY, `docs/DETAIL.md`/`.zh.md` and `docs/preview.svg` added.
- Locale metadata now names WebDev Viewer and declares the detail documents.
- v0.1.1 source release candidate includes the native Desktop webview, desktop tools, numbered picks/notes, compact style inspector, preview/runner, and Electron/CDP attach.
- Remaining: npm registry publication (optional), final v0.1.1 tag/push, and the copied upstream client test harness.

## Resolution

<!-- Fill when closed. -->
