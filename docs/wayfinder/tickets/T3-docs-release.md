---
id: T3
type: task
status: blocked
blocked_by: [P1, P2, P3, P4]
owner: null
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

## Resolution

<!-- Fill when closed. -->
