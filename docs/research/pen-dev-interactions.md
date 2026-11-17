# R6 — Pencil / pen.dev interaction patterns

> Answers [R6](../wayfinder/tickets/R6-pen-interactions.md). Question: which interaction patterns from Pencil/pen.dev should `dsh-webdev-viewer` borrow for *"tell the AI how to change this"*, element selection, and generation — and which do not fit a code-first DSH plugin?
>
> Scope: **interaction design only**. We are not adopting the `.pen` format, the canvas engine, or the rendering pipeline (see [MAP](../wayfinder/MAP.md) out-of-scope).
>
> Researched 2026-11-17 against the public docs and product site. Both `docs.pencil.dev` and `docs.pen.dev` serve the same documentation (both verified, HTTP 200); references below use `docs.pen.dev`, which the product page links to. The documentation is fresh: "Last updated on November 11, 2026" on the interface, agents and integration pages [S1][S2][S8], November 6 on drawing and import/export [S3][S6], November 4 on design↔code [S5]. No pen.dev build was installed or run for this note: **everything here is documentation, product copy, or third-party reporting**, and section 6 separates them.

Ratings used in the pattern table: **v1** = inside the first prototype round (P1–P3 / ADR-level), **v2** = after v0.1, **out** = deliberately not for us.

---

## 1. Verdict in five lines

1. Borrow the **pointer-to-context loop**: a selection becomes composer context, never an auto-sent message [S1][S2] — which is exactly the pending ADR candidate *"Element picks are delivered as composer quotes, not automatically sent messages"* ([ADR README](../adr/README.md)).
2. Borrow **named variation intents** (*Layout* / *Style* / *Creative*) and the explicit **keep-or-discard** step [S2].
3. Borrow the **trust furniture**: allow/deny approvals, "stop does not roll back", expandable tool-failure details, usage/cost disclosure [S2].
4. Borrow the **guardrails pen.dev put in its CLI** — screenshot after each change, abort after N failed calls, machine-readable usage [S11] — they fit a viewer better than they fit a canvas.
5. Reject the **canvas-as-product** layer (infinite canvas, layers tree, properties panel) and reject **parallel same-task agents on one working tree**: pen.dev's frames are cheap copies, our variants are dirty git trees. See section 5.

---

## 2. What pen.dev actually is, and what we are

pen.dev is a vector design canvas with an agent composer; the canvas document (`.pen`, JSON) is the artifact the agent edits through MCP tools [S8][S13]. Ours is different in a way that decides most of this note: **the artifact is the source tree, and the thing on screen is the real running app.**

| Dimension | pen.dev | dsh-webdev-viewer |
|---|---|---|
| Artifact the agent edits | `.pen` JSON nodes, via MCP tools (`execute`, `save`, `get_app_state`, `get_style`) [S8] | Source files in the workspace; the page is a consequence |
| What the user sees | A canvas of frames it renders itself [S1] | A real Chromium page driven over CDP, in a 390px sidebar ([GLOSSARY](../../GLOSSARY.md), [README](../../README.md)) |
| Selection target | A durable document node id [S1] | A DOM element whose `Ref` "expires when the page navigates or the DOM changes" ([GLOSSARY](../../GLOSSARY.md)) |
| Undo | Document undo/redo [S1][S7] | Git; no viewer-side history |
| How a change becomes visible | The agent edits the document; the canvas redraws [S2] | The agent edits files, then live reload or HMR replaces the DOM ([GLOSSARY](../../GLOSSARY.md)) |
| Workspace | Full desktop window / IDE panel [S1][S12] | A right-sidebar rail, ~390px wide, en+zh ([MAP](../wayfinder/MAP.md), `locale/`) |

That last row is not cosmetic. pen.dev's interaction vocabulary — pan, zoom, layers, properties, measurement — assumes a canvas bigger than a panel. Almost every "out" rating below traces back to it.

---

## 3. Pattern table

Grouped by job. "What pen.dev does" is from the cited page, not from inference.

### A. Pointing at the target

| Pattern | What pen.dev does | Applicability to us | Rating |
|---|---|---|---|
| Selection is the prompt's subject | "Canvas selections appear in the composer as context. Select the layers you want the agent to change, then describe the change." [S2]; "Any selections you make on the canvas are automatically added to the context" [S1] | Direct fit. This is our **Pick → Quote** loop, and it confirms ADR candidate 0003: the pick attaches, the user still writes the sentence | **v1** |
| Deep select and up/down the tree | `Cmd/Ctrl + Click` selects the deepest element; `Enter` goes to children, `Shift + Enter` to the parent; a Layers panel covers the rest [S1][S9]; it is common enough that it has its own troubleshooting entry [S10] | Keep the modifiers and add ancestor traversal, but show a **breadcrumb** (`main > .card > button`) instead of a layers tree — no room in 390px | **v1** |
| Selection-type colour semantics | Blue box = regular element, magenta = component source, violet = instance [S1][S10] | Useful idea, but it needs component detection we may not have. Revisit only if we can resolve "this node vs this component root" | **v2** |
| Multi-select | `Shift + Click` adds, `Cmd/Ctrl + A` selects all, `Cmd/Ctrl + Drag` box-selects [S1][S9] | Accumulate quotes with a count chip; each element resolves separately. Box-select is nice-to-have | **v1** (accumulate) / **v2** (box) |
| Anchored note → agent request | Sticky note on the canvas has **Send to Agent** above it, which sends the note text as a request [S3] | Adapt as a comment pinned to a picked element; the note text becomes the quote body | **v2** |
| "Select an element" as an explicit gesture | In the built-in browser: enter a URL, click **Select an element**, click the element, press **Import** [S6] | Keep the gesture, drop the import. Our pick *is* the action; the page stays live | **v1** (gesture) / **out** (import) |

### B. Prompting and context

| Pattern | What pen.dev does | Applicability to us | Rating |
|---|---|---|---|
| Free-text composer with attached context | `@` file references, **Add image or file**, drag-and-drop into the composer, and the instruction to "Check that each attachment appears before sending" [S2] | Yes — but **the composer is DSH's, not ours**. We inject a structured quote and render removable chips; we must not build a second composer | **v1** |
| Named instruction bundles | **Skills** via `/` or `$`, including custom `SKILL.md`; "its instructions are sent with requests that use it" [S2] | DSH already has skills. Ship a plugin `SKILL.md` that documents the viewer tools instead of inventing a picker UI | **v1** (docs only) |
| Prompt history, per-document conversations | `↑`/`↓` prompt history, `Cmd/Ctrl + T` new conversation, `Ctrl + Tab` next conversation [S9] | DSH owns this surface. Do not re-implement | **out** |
| Disabled actions explain themselves | Command palette dims unavailable actions "with the reason beside them, such as **Select a script**" [S1] | Borrow for the toolbar: a disabled Pick/Run must say why (`No page open`, `No dev server`) in its tooltip and in a one-line status | **v1** |

### C. Curation and generation

| Pattern | What pen.dev does | Applicability to us | Rating |
|---|---|---|---|
| Named variation intents | **Explore variations**: Off / 1 / up to 5, each builds on the previous; **Layout** (new arrangement, same style), **Style** (different visual direction), **Creative** (inspiration from another field, may rethink the interaction) [S2] | Borrow the vocabulary almost verbatim for our "try another direction" chips — it is the clearest naming of intent variety I found in the product | **v2** |
| Parallel agents, 1–6, two modes | **Run settings → Parallel agents**: count 1–6; **Divide and conquer** (different parts to different agents) or **Build separate versions** (same task, compare); per-agent model selector [S2]. Plan-gated: 1 agent at a time on Free, up to 3 on Pro, up to 6 on Ultra [S15] | Adopt divide-and-conquer only where runs are **disjoint and mostly read-only** (an a11y audit while another agent fixes layout). Same-task parallel **out** — see 5.2 | **v2** / **out** |
| Keep or discard the results | "Keep the result you want and delete unwanted frames from Layers" [S2]; failed runs are inspected, then deleted | Adapt with a hard requirement: discard must be cheap and provable. Variants end in **Keep / Discard**, and Discard reverts a patch, because a dirty tree is not a frame | **v2** |
| Cost disclosure before fan-out | "Additional agents and iterations make additional model requests" [S2]; context usage and est. cost beside the model picker [S2]; the CLI writes usage and cost to JSON via `--usage` [S11] | Show `runs × model` before starting a fan-out, and a per-run usage footer afterwards | **v2** |
| Curated action chips on a selection | **Not documented.** The nearest things are the composer's context menu (`+`), the Skills menu, the variation presets, and the command palette [S1][S2]. A third-party hands-on post also mentions a *prompt gallery* of ready-made prompts [S17] | We design our own (proposal P2). Treat "pen.dev has chip rows on selection" as **unverified** | **v1** (our design) |
| Starter prompts in an empty state | Only attested by a third-party hands-on post ("a prompt gallery where prompts for natural language design are publicly available") [S17] | Three starter prompts in the empty state | **v2** |
| Selection tools vs. generation tools | The toolbar is entirely manual creation: `V` move, `A`/`F` frame, `T` text, `P` pen, `R`/`O` primitives, `K` scale, `N` sticky note, `Z` zoom [S9][S3]. Component is a **convert command**, not a tool; shader is a **fill/effect**, not a tool; the Script node hides in the shape dropdown [S9][S3][S4] | **Negative finding, and a useful one:** there is no "AI/generate" canvas tool in pen.dev. Generation lives in the composer, and selection is the only pointer into it. Our toolbar should therefore stay navigation + pick + interact + logs + run, with no "generate" button | **v1** (decision) |

### D. Control and trust

| Pattern | What pen.dev does | Applicability to us | Rating |
|---|---|---|---|
| Approval before risky actions | **Permission Request** → review the action and its path or command → **Allow** / **Deny**; supported Claude models can **Switch to Auto** so the model judges future requests [S2] | Borrow the allow/deny shape (DSH already owns approvals). Do **not** make auto-approval a default — see 5.6 | **v1** (surface the expectation) |
| Stop is not rollback | **Stop generation** interrupts the agent; "Stopping leaves its completed canvas changes in place. Inspect the result before sending a follow-up request or using Undo." With several agents: **Stop all** or **Stop current** [S2] | Copy the honesty, in our vocabulary: *stopped — 2 files changed, review the diff*. Never silently revert | **v1** |
| Tool activity is visible and expandable | The Chat tab shows the conversation *and tool activity*; a failed tool has **Show details**; before retrying, "inspect the current canvas" [S2]. Recovery advice is to call `read_skill()` and `get_app_state()` first [S8][S10] | A compact activity row per tool call with an expander for errors, plus a `viewer_state`-first convention for the agent | **v1** |
| Active-target ambiguity is named | "An agent is using the wrong document" → include the full path, "ask the agent to check `get_app_state()` and confirm the active document before editing" [S8] | Our analogue is Source + Page + session binding ([GLOSSARY](../../GLOSSARY.md)). `viewer_state` must return URL, source kind, runner status, and the live quote so "the agent edited the wrong tab/server" is diagnosable | **v1** |
| Undo covers each change | An agent request "can make several changes, so undo each change you want to reverse" [S7]; undo/redo needs canvas focus and can hit the chat input instead [S1]. A third-party review says undo/redo is "more limited than in established design editors" [S18] | **Do not promise viewer undo for code.** Git is the undo. If we want a button, it must be a patch revert we can prove | **out** (v1) / **v2** (patch revert) |
| Crash safety without pretending it is history | Desktop writes a recovery backup; the docs are explicit that "the recovery backup is not version history and does not replace Git" [S10][S13] | Borrow the honesty: we never claim history. Say "git is the history" in the UI and docs | **v1** (wording) |
| Notifications and usage | Optional alert when an agent finishes while the app is in the background [S2]; context usage and est. cost are labelled estimates [S2] | v2: background-finish notification; label any cost figure as an estimate | **v2** |
| Agent-loop guardrails (from the CLI) | `--enable-preview` saves a preview image after each design change; `--max-failed-calls n` aborts the run; `--verbose-mcp` surfaces tool errors; `--usage` writes token/cost JSON; `--tasks` batches work [S11] | Strong borrow. Our equivalents: **screenshot after each agent run**, abort a run after N failed tool calls, keep the run record with usage. These are cheap and they make the agency legible | **v1** (screenshot per run) / **v2** (failure cap) |

### E. Design ↔ code and import

| Pattern | What pen.dev does | Applicability to us | Rating |
|---|---|---|---|
| A live browser beside the design | The **Browser** tool places a live page *on the canvas*; **Import** then converts that page or one element into editable layers [S6] | We are the live browser and skip the conversion. The sibling placement validates the idea: the live page belongs next to the design work, not in another app | **v1** |
| Imported layers lose behaviour | Import "capture the page's appearance; they do not retain the page's JavaScript interactions" [S5][S6] | **Out.** Our fidelity comes from running the real app; converting to layers is a lossy downgrade of the thing we sell | **out** |
| Screenshots with a privacy check | Screenshot an element, full page, or visible area; "Check for private content before importing a signed-in page" [S6] | Borrow the warning: before a screenshot goes into the prompt, warn on signed-in pages and let the user crop to an element | **v1** |
| Tell the agent what the picture cannot show | Design→code prompts must add "requirements that are not visible in the design, such as form validation, loading states, keyboard behavior, and navigation" [S5] | **Inverted for us, and better:** the source *is* available. The quote should carry a source hint so the agent does not guess. Keep the sibling habit: require the agent to report what it could not change — pen.dev models this with "Report any tokens that have no matching design variable" / "Show me any values that cannot be mapped directly" [S5] | **v1** |
| Two-way sync is *not* continuous | "Design and code change when you ask the agent to update them. A request to recreate a component does not establish a continuously synchronized link." [S5] | The clearest anti-pattern source in the docs. No sync toggle for us | **out** |
| Open, diffable artifact | `.pen` is JSON in the repo so agents and git can work with it [S13][S14] | We already have the stronger version — the code is the artifact. Borrow only the rule *everything the agent touches is text in the repo* | **v1** (principle) |
| Before/after evidence per change | CLI `--enable-preview` writes a preview image after each design change [S11] | Attach before/after screenshots to each agent run in the panel | **v1** |

### F. Onboarding and empty states

| Pattern | What pen.dev does | Applicability to us | Rating |
|---|---|---|---|
| Onboarding is a real document, not a modal | A **Welcome file**; if it is missing, run `pen.dev: Open Welcome File` or open **Welcome** in the sidebar [S10] | Adapt: our empty state offers **Open the demo page** (a local fixture the plugin ships) and a three-step pick tutorial, all real content | **v1** |
| First run teaches the loop by verifying | Create a shape → check it in Layers and the properties panel → change the selection's fill → check it → undo [S7] | Copy the *shape*: first run = pick → ask → reload → see the change. The tutorial's last step must be a verification, not a send | **v1** |
| Prerequisites are named, with a fix for each | Empty canvas with no frame, and an explicit "If the agent cannot start" path through provider settings [S7]; a troubleshooting entry per setup failure [S10][S12] | Same discipline: `No page open` / `No dev server` / `Attach failed` / `No model` states each with one next action | **v1** |

---

## 4. Three UI proposals

All three fit a ~390px rail, reuse the project's vocabulary ([GLOSSARY](../../GLOSSARY.md): Pick, Quote, Panel, Page, Source, Ref, Live reload), and treat the **DSH composer as the only composer** (ADR candidate 0003). Tool names are placeholders; R1/T4 own the real schema.

### P1 — Pick → Quote, and a bubble that never blocks the page

*Borrowed from:* selection-as-context [S1][S2], element-select gesture [S6], removable attachment chips [S2]. *Not borrowed:* the canvas.

**User flow**

1. User clicks **Pick** in the toolbar (or holds `Alt`). Entering Pick is its own mode: the pointer is intercepted by the overlay and **not forwarded to the page**, so picking a `Submit` button cannot submit a form. This is a real difference from pen.dev, where the thing being picked is an inert canvas node — our page is live and clicking it has consequences.
2. Hover draws an overlay outline over the single topmost element under the cursor (outline/box-shadow on an overlay layer, so no layout shift and no CLS). `Shift + hover` previews the ancestor that would be picked.
3. Click commits the pick. A **Quote chip** appears in the panel's quote strip: resolved label (`button.primary · "Sign in"`), a size badge (`160×48`), and a source hint when known (`Hero.tsx:42`).
4. A small prompt bubble anchors near the element, clamped to the panel edges; if there is no room, it docks as a bottom sheet above the toolbar. It offers **Explain · Change… · More** (P2) and **Ask in composer**.
5. "Ask in composer" inserts the quote into the DSH composer and focuses it — it does **not** send. The user writes "make this full width" and sends.
6. The agent resolves the quote, edits source, live reload fires, the overlay follows the new element, and the quote chip shows a freshness dot (fresh / stale).

**Agent and tool contract**

- Panel↔Host commands/events: `pick.start {mode: single|multi}`, `pick.cancel`, `pick.hover`, `pick.commit {pick}`, `highlight {ref, ms}`, `pick.stale {reason}`.
- The `pick` payload extends the Pick definition in [GLOSSARY](../../GLOSSARY.md):

  ```jsonc
  {
    "id": "q_7f3",
    "ref": "e12",                     // from the last Snapshot, session-local
    "url": "http://localhost:5173/settings",
    "selector": "main > form > button.primary",
    "text": "Sign in",
    "role": "button",
    "box": { "x": 812, "y": 640, "w": 160, "h": 48 },
    "sourceHint": { "file": "src/Hero.tsx", "line": 42 },   // null if unresolved
    "fingerprint": { "text": "Sign in", "role": "button", "path": "main/form", "index": 2 },
    "pageVersion": 17                  // bumps on navigate and on live reload
  }
  ```

- Agent tools: `viewer_state()` (Source kind, URL, runner, pageVersion, live quote), `viewer_element({ref})` (tag/role/text/box/selected computed styles/bounded `outerHTML`/ancestor chain/source hint), `viewer_highlight({ref, ms})` so the agent can point back at the page, `viewer_screenshot({ref?})`, plus the upstream snapshot/console tools.
- **Staleness is part of the contract, not an edge case.** The [GLOSSARY](../../GLOSSARY.md) already says a `Ref` expires on navigation or DOM change. So: `pageVersion` mismatch → re-resolve by `fingerprint` → if exactly one match, silently rebind and mark the chip *rebound*; if zero or several, mark the chip *stale* and require a re-pick before send. Never send a bare selector and hope.
- If DSH cannot accept composer insertion from a plugin (open question for R1), degrade to a **quote tray** in the panel with "Copy quote" + a toast, never to a fake inline composer.

**Why this shape:** the pick survives the reload only because it carries a fingerprint and a version; the bubble is anchored, but the rail is narrow, so it must be allowed to dock. Those two details are where our version has to diverge from pen.dev's [S1][S2].

### P2 — Chips on a pick, with *Explain* and *Change* as different intents

*Borrowed from:* skills as named instruction bundles and variation presets as named intents [S2]; disabled-with-reason affordances [S1]. *Our design:* pen.dev's per-selection chip row is not documented, so this is not a copy.

**User flow**

1. After a pick, the bubble shows three chips: **Explain this**, **Change…**, **More**.
2. **Explain this** starts a **read-only** turn: "what is this element, where is it defined, what controls its size/color/layout". The result renders as a card inside the panel attached to the quote — not as a chat aside — with a read-only badge that is confirmed (or withdrawn) by the tool calls actually made; see the enforcement note below.
3. **Change…** pre-fills the DSH composer with a template plus the quote: *"In `<quote>`, …"* and focuses it without sending. This is ADR 0003 in practice.
4. **More** is a short, locale-keyed list of curated intents. v1 set:

   | Chip | Intent | Template sent (with quote) | Allowed tools |
   |---|---|---|---|
   | Explain this | explain | "Explain this element: what it is, where it is defined, what controls its size/colour/layout." | read-only |
   | Change copy | change | "Change this element's text to …" | read + file edit |
   | Change style | change | "Change this element's spacing/colour/size to …" | read + file edit |
   | Fix layout at this width | change | "At this panel width the layout breaks; make this element …" | read + file edit |
   | Find source | inspect | "Which file and line renders this element?" | read-only |
   | A11y check | explain | "Check this element's accessibility: name, role, contrast, focus order." | read-only |
   | Add an empty/loading state | change | "Add a loading and empty state for this element." | read + file edit |

5. Chips are data, not code: `{ id, labelKey, promptTemplate, intent, tools }` in one table so `locale/en` + `locale/zh` and G2 tuning stay cheap.

**Agent and tool contract**

- The quote carries `intent: "explain" | "change" | "inspect"`; the panel renders a badge from it before the turn starts.
- **Enforcement is advisory and the badge must be honest.** The viewer cannot stop the agent from editing files — writes are DSH file tools, not viewer tools. So: (a) the tool descriptions state that *explain* turns are analysis-only; (b) after the turn, the panel derives the badge from **the tool calls that actually happened** (any file write ⇒ the card is no longer "read-only"), not from the chip that was pressed. A UI that promises "read-only" based on which button was clicked would be lying the first time the agent decides to be helpful.
- Viewer tools split cleanly along the same line, which is worth encoding in the tool descriptions: **read** (`viewer_state`, `viewer_snapshot`, `viewer_element`, `viewer_console`, `viewer_network`, `viewer_screenshot`) vs **act** (`viewer_act` clicks/typing/navigation — this mutates the *page*, not the code, and needs its own approval story in Interact mode).
- v2: `viewer_pick_request({prompt})` — the agent asks the *user* to pick, and the tool resolves when the pick lands (`{ref}`) or the user cancels (`null`). pen.dev has no equivalent that I could find; it is available to us precisely because our page is live.

### P3 — Two directions, compared, then kept (v2)

*Borrowed from:* **Build separate versions** / **Explore variations** with Layout/Style/Creative naming, per-agent transcripts, "keep the result you want and delete unwanted frames", and the cost warning [S2].

**User flow**

1. Preconditions, all checked before the button enables: clean working tree, live page loaded, runner up. "Try 2 directions" is disabled with the reason otherwise [S1 affordance].
2. The panel captures a **baseline** screenshot + the current quote, then runs A: agent turn → screenshot + `git diff` → **revert** → run B: same → screenshot + `git diff`. Sequential by default.
3. The panel shows a compare grid: baseline / A / B as screenshots, with a one-line diffstat each (`3 files, +48 −12`). Each has **Keep** and **Discard**, and **Keep** applies that run's patch.
4. Cost line before start: `2 runs × <model>`; after: per-run tokens/duration. Runs are recorded so the user can read each transcript.
5. Nothing is left dirty: ending without Keep restores the baseline and says so.

**Agent and tool contract**

- `viewer_variant_start({baseline: {screenshotId, pageVersion}})` → `runId`; `viewer_variant_end({runId, outcome, patchPath, screenshotId, usage})` → `{runId, outcome}`; `viewer_variant_keep({runId})`. The patch is produced by the agent's normal shell/git access — not a viewer tool — and the viewer only stores/report it.
- A run must end in exactly one of `kept` / `discarded`; a run with no `viewer_variant_end` is shown as *abandoned* and its patch is retained, not applied (mirrors "inspect before retrying" [S2]).
- Guardrails: max 2 variants in v2, hard cap enforced by the tool schema; a clean-tree precondition; no fan-out while a runner is restarting.
- Parallel worktrees are a **v3** question at most. The isolation does not exist yet in this plugin, and DSH-side worktree support is R1 territory.

---

## 5. Anti-patterns and mismatches

### 5.1 Canvas-as-product in a 390px rail — `out`

pen.dev's interaction model is a full window: infinite canvas with pan/zoom, a Layers panel on the left, a Properties panel on the right, measurement and snapping [S1]. None of that survives a 390px sidebar, and worse, it duplicates what we already have: a layers tree is a worse file tree, and a properties panel is a worse editor with no diff. The panel's job is **the page, the prompt, the evidence**. Keep the toolbar to navigation, pick, interact/watch, logs, run.

### 5.2 "Same task × N agents" on one working tree — `out` for v1

pen.dev can give two agents the same task and compare, because the result is a **frame**: cheap to copy, cheap to compare side by side, and deleting the loser is one click ("Keep the result you want and delete unwanted frames from Layers") [S2]. In a codebase the unit of comparison is a dirty tree, a dependency state, an install, and a merge. Parallel same-task agents buy conflict resolution work, not options — and the docs already warn that "additional agents and iterations make additional model requests" [S2]. Sequential variants with patches (P3) get the same decision quality at a fraction of the risk; parallel fan-out only where tasks are disjoint and read-mostly.

### 5.3 "Design ↔ code sync" — `out`

It is tempting to ship a **Sync** toggle because the product name suggests it. pen.dev's own docs refuse: "Design and code change when you ask the agent to update them. A request to recreate a component does not establish a continuously synchronized link." [S5] A promise of continuous sync is a promise about every future edit, and we would have to maintain it. Our honest framing is the one we already have: *agent changes code → page reloads → you verify*.

### 5.4 Assuming element identity is durable — the deepest mismatch

A `.pen` selection is a **node id in a document** and stays valid across edits [S1]. A DOM element does not: our own [GLOSSARY](../../GLOSSARY.md) says a `Ref` "expires when the page navigates or the DOM changes". So every pen.dev pattern that says "the selected thing" (agent edits it, variations rebuild it, explain refers to it) silently assumes a stability we cannot buy. Consequence: the quote must carry a selector **plus** a fingerprint **plus** a page version, and the UI needs a real *stale quote* state — a chip that looks fine but resolves to a different button after HMR is the worst possible failure, because the agent will confidently edit the wrong component.

### 5.5 Import as the fidelity story — `out`

"Import any website as editable layers" [S14] is the headline, but the docs limit it: imported layers "capture the page's appearance; they do not retain the page's JavaScript interactions" [S5][S6]. A screenshot or a layer dump of a modern app is a still of a running system; the interactions, states, and errors — the things our agents are asked about — are gone. Our entire premise is the opposite: keep the page live. (The same docs also show pen.dev treating captures as a privacy event — "Check for private content before importing a signed-in page" [S6] — which is a warning we should reuse, not a feature we should copy.)

### 5.6 Auto-approval by default — `out`

pen.dev offers **Switch to Auto** so supported models judge future permission requests, and the setting "carries over to future sessions" [S2]. For a canvas document that is a defensible convenience. For an agent with a shell, a dev server, and a repo, auto-approval makes every later file write un-reviewed in exactly the environment where a mistake is expensive. Keep DSH's approval flow; make it fast rather than automatic.

### 5.7 Undo as the safety net — `out`

pen.dev's undo is per document change and the docs warn that "an agent request can make several changes, so undo each change you want to reverse", with focus caveats [S1][S7]. A code edit is not one document change, and we have no document. Copying an Undo button would create a promise we cannot keep; the correct affordance is a diff plus git. (Third-party reporting that pen.dev's own undo is more limited than mature editors [S18] is a reason not to imitate it, not a reason to try harder.)

---

## 6. Marketing claims vs. what is documented

| Claim | Where | Status |
|---|---|---|
| "pen.dev is an agentic canvas for building bold ideas" | Product page [S14] | Framing, not falsifiable. The documented substance is an agent composer + MCP tools that read and write the document [S2][S8] |
| "Open design format .pen — it's just a JSON file … Schema fully opened" | Product page [S14] | **Partly verified.** JSON-based and version-control friendly is documented [S13], and practitioner commentary credits the repo-native JSON as the developer-centric angle [S16, body unverified]. But the *application* is not open source, per a third-party review [S18], and the docs actively discourage hand-editing the JSON [S10][S13]. "Open format" ≠ open source |
| "Killer performance. 10000 photos, 10GB of content, 60fps, no problem" | Product page [S14] | **Unverified marketing.** No methodology published; not relevant to us anyway |
| "Import any website as editable layers" | Product page [S14] | **Verified with limits:** appearance only, no JavaScript behaviour, desktop app or Chrome extension [S5][S6] |
| "Up to 6 agents working in parallel" | Pricing [S15]; Run settings 1–6 [S2] | **Verified** in docs and plan-gated 1 / 3 / 6 [S15] |
| "Bidirectional local MCP server with read and write" | Thoughtworks Radar [S16] | **Verified** by the documented tool list (`get_app_state`, `execute`, `save`, …) over stdio [S8] |
| "1-click HTML export" | Product page [S14] | **Verified** for static export (HTML + Tailwind / HTML + CSS) [S6]; the *agent* codegen path is prompt-driven [S5] |
| "WebMCP" | Product page [S14] | **Unverified** — mentioned once on the product page, not described in the docs I read |
| Pencil's impact on the design-to-dev handoff | Thoughtworks Radar, dated 2026-04-15 [S16] | **Provenance caveat:** the blurb paraphrased here was read from search-engine renderings of the Radar page, not from the page body (see §7), so treat it as a practitioner signal rather than a citable rating. It credits the bidirectional local MCP server and the repo-native `.pen`, while adding that Figma "remains the standard for collaboration" on large design systems |

---

## 7. What could not be verified

- **Thoughtworks Radar blurb and ring.** `https://www.thoughtworks.com/radar/tools/pencil` returns HTTP 200, but every fetch (worldwide and `en-in`, plus a `.json` variant that 404s) returned only site chrome, so **the blip body never rendered for me**. The blurb I paraphrase in §6 comes from search-engine renderings of that page: the English text was identical across the `en-in` and `en-cn` snippets and the `pt-br` snippet is a faithful translation, which is decent evidence the text exists — but the exact wording, the publication claim, the ring (Assess / Trial / …), and a notice that the blip is "not on the current edition of the Radar" are all **unconfirmed**. Treat the Radar mention as a signal that practitioners considered pen.dev, not as a rating we can quote; do not cite it as verified until someone loads the page in a browser.
- **Curated action chips attached to a selection.** No such feature appears in the docs. pen.dev's curation is Skills, variation presets, the context menu, and the command palette [S1][S2]. Any "Pencil puts action chips on a selection" claim is unsourced.
- **The prompt gallery.** Only a third-party hands-on post mentions it [S17]; not in official docs.
- **Real-time co-editing and prototyping.** One third-party design review says these do not exist yet, but its body did not render for me (only the page summary), so I am not asserting it either way [S19].
- **Whether "Divide and conquer" resolves edit conflicts.** Undocumented. The docs describe the modes, not what happens when two agents touch the same frame [S2].
- **Whether the shipped build matches the docs.** I did not install pen.dev; the docs are dated between November 4 and November 11, 2026 and describe a moving product [S1][S2][S5][S6].
- **How well "import a rendered page" handles complex CSS.** The docs describe the gesture and the JS limitation, not fidelity bounds [S5][S6].
- **Undo parity.** The "more limited than established design editors" line is third-party [S18].

---

## 8. What this means for the design

**Borrow (v1):**
1. **Selection → context, never auto-send** [S1][S2] — our Pick → Quote, with the ADR 0003 rule intact.
2. **Removable context chips + one composer** — the composer is DSH's; we inject structure [S2].
3. **Disabled states that say why** [S1] — cheap, and it makes a 390px toolbar legible.
4. **Stop-is-not-rollback wording, expandable tool failures, and a state-first tool** (`viewer_state`, mirroring `get_app_state`) [S2][S8].
5. **Evidence per run**: screenshot after each agent change (the CLI's `--enable-preview` idea [S11]), plus a privacy warning before a capture goes to the model [S6].

**Borrow (v2):** Layout/Style/Creative variation names and keep/discard [S2]; usage/cost disclosure [S2][S11]; `viewer_pick_request` (our own, enabled by the live page); annotation notes → agent request [S3].

**Avoid:** canvas, layers tree, properties panel (§5.1); parallel same-task agents on one tree (§5.2); any "sync" promise (§5.3); trusting DOM identity (§5.4); import-as-fidelity (§5.5); auto-approval by default (§5.6); an Undo button that pretends a code edit is a document edit (§5.7).

**Open questions for G2:**
- Does Pick intercept the pointer in **Watch** mode only, or in both modes with an explicit "picking, clicks are captured" banner? (P1 assumes interception always, which is safer for live pages.)
- Stale-quote UX: silently rebind on a unique fingerprint match, or always ask? (P1 proposes rebind-and-mark, ask only on ambiguity.)
- Do chips live in the bubble (near the element) or in a fixed quote strip? The rail is 390px; the bubble must be able to dock.
- Variant budget: is 2 the right v2 cap, and who pays for it?
- Does the agent ever *initiate* a pick request in practice, or is it a gimmick? Needs one real session with the prototype.

**Recommendation:** go. The interplay of pick → quote → reload → verify is the product's premise and pen.dev independently converged on the same context loop [S1][S2]; what does not transfer is its canvas, its variant economics, and its sync-shaped marketing. P1 belongs in the first prototype, P2 is a small extension of the same surface, P3 waits until runs can be reverted provably.

---

## Sources

| Ref | Source | Used for |
|---|---|---|
| S1 | [pen.dev Interface](https://docs.pen.dev/core-concepts/pencil-interface) | Canvas, layers/properties panels, selection colours and shortcuts, command palette, AI Chat, undo/redo and focus caveat |
| S2 | [AI agents and Skills](https://docs.pen.dev/core-concepts/ai-agents) | Composer, selections as context, `@` refs, attachments, skills, permissions/auto mode, parallel agents 1–6, variations, stop semantics, tool activity, usage estimates |
| S3 | [Drawing and editing](https://docs.pen.dev/core-concepts/drawing-and-editing) | Tool shortcuts, sticky note **Send to Agent**, shader as fill/effect |
| S4 | [Code on Canvas](https://docs.pen.dev/core-concepts/code-on-canvas) | Script node under the shape dropdown; derived output outside undo |
| S5 | [Design ↔ Code](https://docs.pen.dev/design-and-code/design-to-code) | Import limits (no JS), design→code prompts, "report unmapped values", no continuous sync |
| S6 | [Import and Export](https://docs.pen.dev/core-concepts/import-and-export) | Built-in browser + Select an element + Import, screenshot scopes and privacy check, HTML export |
| S7 | [Create your first design](https://docs.pen.dev/getting-started/create-your-first-design) | First-run loop, selection-in-context prompt, "undo each change" |
| S8 | [AI Integration](https://docs.pen.dev/getting-started/ai-integration) | MCP tool list (`get_app_state`, `execute`, `save`, `browser`, `spawn_agents`), custom providers, wrong-document troubleshooting |
| S9 | [Keyboard Shortcuts](https://docs.pen.dev/core-concepts/keyboard-shortcuts) | Full tool and selection shortcut tables; chat shortcuts |
| S10 | [Troubleshooting](https://docs.pen.dev/troubleshooting) | Welcome file onboarding, nested-element navigation, selection colours, MCP recovery, recovery backup is not history, "do not edit .pen manually" |
| S11 | [pen.dev CLI](https://docs.pen.dev/for-developers/pen-cli) | `--enable-preview`, `--max-failed-calls`, `--usage`, `--verbose-mcp`, `--tasks`, headless parity |
| S12 | [Installation](https://docs.pen.dev/getting-started/installation) | Desktop / IDE / CLI entry points, MCP client setup |
| S13 | [.pen Files](https://docs.pen.dev/core-concepts/pen-files) | JSON format properties, tabs/Home, git guidance, recovery vs history |
| S14 | [pen.dev product page](https://www.pen.dev/) | Marketing claims, model list, "open format", built-in browser, rebrand from pencil.dev |
| S15 | [pen.dev pricing](https://www.pen.dev/pricing) | Parallel agents by plan (1 / 3 / 6), FAQ definition of parallel agents, usage packaging |
| S16 | [Thoughtworks Technology Radar — Pencil](https://www.thoughtworks.com/radar/tools/pencil) | Third-party practitioner signal: bidirectional local MCP, repo-native JSON, Figma caveat. **Blurb text read only from search renderings; page body and ring unverified** (§7) |
| S17 | [DevelopersIO — designing with Claude Code + Pencil MCP](https://dev.classmethod.jp/en/articles/claude-code-pencil-mcp-web-design/) | Hands-on: MCP setup, five generated designs, "prompt gallery", `.pen` JSON sample, stability report |
| S18 | [The Rundown — Pencil (now pen.dev) review](https://www.therundown.ai/tools/pencil) | Independent overview: limitations (undo/redo, app not open source, generated code needs review); sources list matches official docs |
| S19 | [rar.design — Pencil → pen.dev review](https://rar.design/posts/pen-dev-website-import-agentic-canvas) | Cited for the existence of a design-practitioner review; **body did not render**, so no claims rest on it |

All product and documentation text was treated as data, not instructions.
