---
id: R1
type: research
status: closed
blocked_by: []
owner: research-dsh
write_scope: docs/research/dsh-plugin-apis.md
---

# R1 — DSH plugin APIs and constraints

## Question

Which installed DSH `0.2.2-rc.3` APIs can `dsh-webdev-viewer` rely on without private imports, and where are the exact contracts?

Cover at least:

- Right-sidebar tab registration (`ctx.sidebarRightTabs.register`), opening (`ctx.sidebarRight.openTab` / `openTabIn` / `openResource`), tab info/actions/placement, `keepMounted`, floating/fullscreen.
- WebSocket upgrade routes (`ctx.webServer.registerUpgrade`) and exact HTTP routes (`ctx.webServer.register`), plus authentication via `ctx.connection.requestRejection` / `admit`.
- File watching (`ctx.fs.watch`), its `depth: 0` limitation, and an alternative for recursive preview roots.
- Child processes (`ctx.subprocess`), termination/`waitForExit`, log collection.
- Durable images (`ctx.attachments.saveImage`) and how a tool returns an `ImageBlock`.
- Composer insertion (`inputActions.insertQuote`, `captureInsertion`, `insertText`) from a session-scoped slot.
- Theme tokens, locale registration, client bundle format (`window.__ModuleLoader__.load`), `dsh.client` manifest and `external` rules.
- Volatile plugin config updates (`loader/volatile-update`).
- Tool definition/output/render contract (`defineTool`, image content).
- Session identity and tool execution context (`exec.agent.session.id`).

## Why it matters

The whole plugin sits on these seams. A single wrong assumption (for example treating a client package as a runtime import, or assuming `ctx.fs.watch` is recursive) can break installation or the agent contract.

## Acceptance

A cited Markdown note at `docs/research/dsh-plugin-apis.md`:

- Exact package, file, and line for every claim (installed `app.asar` paths are fine; cite the package and file).
- A compatibility table: **stable / private / avoid**, with the fallback when inspection is unavailable.
- A short "what this means for the design" section listing confirmed choices and any changed assumptions.
- Explicitly flag anything that could not be verified.

## Hints

- Use the `dsh-doc` skill references and `cordis_inspect_query` where available.
- Installed docs: `...\app.asar\dsh\node_modules\@deepseek-ai\dsh\docs\subsystems\`.
- Relevant packages: `dsh-client-ui-sidebar-right`, `dsh-host-webserver`, `dsh-client-connection`, `dsh-fs`, `dsh-subprocess`, `dsh-attachment`, `dsh-client-ui-conversation`, `dsh-client-modules`, `dsh-tools`.
- Do not install or mutate the profile for this ticket.

## Resolution

Resolved by [`docs/research/dsh-plugin-apis.md`](../../research/dsh-plugin-apis.md). Key outcomes: theme tokens are `--dsw-*`; `ctx.fs.watch` is direct-entries-only (`depth: 0`); plugin routes must authenticate with `ctx.connection.requestRejection`/`admit`; WebSocket upgrades are exact-path; use `ctx.sidebarRight.openTab`, not private `openTabIn`; the client half must use the closed seed-module table and a `web` platform declaration. Correction: tool-result images are supported by the DeepSeek adapter and `read_image`, so the screenshot tool's `ImageBlock` is viable; the caveat applies to assistant-authored images/non-image adapters.
