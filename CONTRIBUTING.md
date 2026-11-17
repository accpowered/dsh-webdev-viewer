# Contributing

This repository is an open-source DSH plugin. Keep changes small, testable, and explicit about the
desktop/CDP boundary.

## Development

Use the Node and pnpm binaries available from DSH if `node`/`pnpm` are not on `PATH`. From the repository:

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm pack --pack-destination .tmp
```

`tests/client/**` are the copied upstream UI suites. They need the DSH monorepo's test-only peer
packages and are excluded from the release gate; the Host/core suite covers the protocol, preview
server, tabs, actions, routes and tools.

## Rules

- Never put credentials, debug tokens, absolute user paths, or private session data in the repository.
- Debug ports are unauthenticated local code execution. Keep preview/CDP servers loopback-only and
  close temporary keys after use.
- Do not copy code from unlicensed packages. MIT/Apache sources need their notice and license text in
  `NOTICE`/`LICENSES`.
- Panel-visible strings go through `src/client/locales.ts` (zh/en). Do not use "Native View"/"Native
  Browser" labels in the panel chrome.
- Host-side changes should keep the CDP fallback working; native Desktop changes must degrade to the
  mirror when `dshDesktop.browser` is absent.
- Run the full check set before opening a pull request and include the exact evidence in the summary.

## Pull requests

Describe the user-visible behavior, the tested path, and any remaining limitation. Changes to the
wire protocol must update both halves and `tests/core/protocol.spec.ts`.
