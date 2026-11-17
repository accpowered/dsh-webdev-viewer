# R7 — Temporary visual style inspector

> Answers [R7](../wayfinder/tickets/R7-style-editing.md). Question: how can a picked element open a
> compact style inspector that previews common CSS changes live, resets cleanly, and produces a
> structured before/after quote the agent turns into **source** edits — while the plugin never writes
> source?
>
> Researched 2026-11-17. **No live browser was available in this workspace** (the same Windows
> sandbox limit as [R3 §6.5](cdp-input.md)): every CDP field and return shape below was read from the
> protocol mirrors linked in the sources, not exercised against a running page. Statements marked
> **Inference** are design reasoning from those facts; §15 lists what P4 must still verify.
>
> **Verdict: GO for P4, narrowly scoped.** The v1 preview should be a temporary **inline style**
> override applied through the page's CSSOM, verified by re-reading the computed style, reset by
> restoring the element's original inline declarations, and turned into **one manual quote**. The
> plugin-owned `<style>`/inspector-stylesheet route is viable but not v1; editing the page's own
> stylesheet rules is rejected.

Rating used for mechanisms: **chosen**, **v2**, **rejected**.

---

## 1. The v1 shape in one page

1. **P1 owns the target.** P1 will supply a selector, fingerprint, box, optional source hint and
   `pageVersion` ([R6 P1 payload](pen-dev-interactions.md)). The style work adds the CDP handle the
   Host needs: **`backendNodeId`** (and `frameId` when the pick came from a frame) [S3][S46]. No
   second identity system is invented.
2. **Read once per open.** Enable `DOM` then `CSS`, resolve the node, then read
   `CSS.getComputedStyleForNode`, `CSS.getMatchedStylesForNode` and `CSS.getInlineStylesForNode`
   [S2][S39][S40][S44].
3. **Preview with inline CSSOM.** Resolve the element to a JS object
   (`DOM.resolveNode`) and call `element.style.setProperty(property, value, priority)` via
   `Runtime.callFunctionOn` [S3][S4]. DevTools itself recommends the inline declaration workflow
   because inline declarations have higher specificity than external rules [S6].
4. **Prove it happened.** Validate with `CSS.supports()` [S12], apply, then re-read the computed
   value and record `applied | overridden | invalid` [S2][S12].
5. **Reset exactly.** Restore the inline value/priority that existed before the edit, or
   `removeProperty` when the property was not inline before [S11].
6. **The artifact is a quote, not a file.** At send time the panel freezes the current edit list,
   builds one Markdown quote and calls `inputActions.insertQuote(text, summary?)`; the user presses
   Send [S28]. No automatic send, no source write.
7. **Multi-element is per-element by default.** A shared change is an explicit "apply to all picked"
   action that writes the same value to each element; the quote lists every target and its own
   before/after.
8. **Deliberately out of v1:** editing pseudo-elements, media-query-scoped rules, CSS custom
   property definitions, widths/heights/positioning, a layers tree, a design canvas, and any direct
   source write.

Why inline rather than a new stylesheet: it is node-targeted (no selector to go stale), it works
inside open shadow roots (element-level styling is allowed inside a shadow tree [S14]), and it is
exactly what the DevTools Styles pane does when it adds to `element.style` — the style attribute shows
up in the DOM tree [S8]. Its costs are equally real and shape §4 and §9: it pollutes the `style`
attribute (visible to the app, to MutationObservers, and to the agent's snapshot), it cannot express
`::before`/`@media`, and the page can overwrite it.

---

## 2. What the repository already provides

| Piece | Where | Consequence for P4 |
|---|---|---|
| One wire contract for both halves | `src/core/protocol.ts:18-19` (`BROWSER_VIEW_API_VERSION`, socket path), `:81-107` (event/command unions), `:171-188` (decoder) [S30] | Style commands/events are added here **first**, then implemented on both sides; bump the version because a stale panel bundle must be rejected, not guessed at. |
| Host owns CDP; panel never speaks it | `AGENTS.md:20-22` [S29] | The Host resolves nodes, reads styles and applies overrides; the panel only renders state and builds the quote. |
| Flat CDP session per tab | `src/core/tabs.ts:280-284` (`sessionOf`), transport on the browser session (`src/host/service.ts:100-101`) [S31][S17][S15] | A style service calls `transport.send(method, params, tabs.sessionOf(tabId))`; it does not open a second socket. |
| Damage-driven screencast | `src/core/tabs.ts:472-483` starts JPEG `Page.startScreencast`; upstream's `actions.ts` forces a capture after every action because the screencast "only emits when the compositor sees a change" [S31][S16] | A visible style change should produce a frame by itself; a non-visual change may not. The panel must not treat "no new frame" as "the edit failed". |
| Panel is one `<img>` with a 38 px toolbar | `src/client/panel.module.css:1-11` [S32]; R3 §3 [S26] | The selection outline is a **panel overlay**, not page pixels; the style sheet must live inside the tab body (the panel is a tab, not an overlay; `AGENTS.md:23` [S29]). |
| No picker or style code yet | ticket P1/P4 write scopes [S33] | P4's new code belongs in `src/client/style/`, `src/host/style/` and `tests/style/`; the protocol additions are shared. |
| Composer insertion | `inputActions.insertQuote(text, summary?)` inserts a Markdown blockquote; `captureInsertion()`/`insertText()` is the async path; both return a boolean [S28] | The quote is **text**, not a structured object passed to the model; everything the agent needs must be in that text. |

**Inference:** a style session must be owned per tab, not per panel socket. Two panels can watch the
same tab (`BrowserViewService` broadcasts frames to every sink), but exactly one style session should
apply overrides; otherwise reset-all from one panel silently removes another panel's preview. The
Host is the only place that can enforce this. (This is also why a style session, like a tab binding,
must survive a panel reconnect: a lost socket must not leave overrides behind.)

---

## 3. Exact CDP sequence

The canonical domain reference is [S1]. Its single-page viewer did not render in this workspace, so
the exact method/field text below is cited to the generated protocol mirror [S2]; the mirror is
generated from the same browser-protocol JSON, but P4 should re-check the handful of fields it
depends on against the Chromium shipped in DSH Desktop (§15).

### 3.1 Read: computed, matched and inline styles

Enable order matters. The CSS agent depends on the DOM agent; a DevTools client that skipped
`DOM.enable` received `CSS.enable` → *"DOM agent needs to be enabled first"* [S35], and the protocol
documents `DOM.getDocument` as implicitly enabling DOM events [S3]. So:

```text
DOM.enable
CSS.enable                                  // wait for the command result
// while the tab is open: collect CSS.styleSheetAdded / styleSheetRemoved headers
DOM.describeNode { backendNodeId, depth: 0 }             → nodeId
CSS.getComputedStyleForNode { nodeId }                   → computedStyle[]
CSS.getMatchedStylesForNode { nodeId }                   → inlineStyle?, matchedCSSRules[], inherited[], pseudoElements[]
CSS.getInlineStylesForNode { nodeId }                    → inlineStyle?, attributesStyle?
```

Facts that drive the implementation:

- **`DOM.getNodeForLocation` gives `backendNodeId` and `frameId`; `nodeId` is only present when the
  DOM domain is enabled** [S46][S3]. P1 should therefore keep the `backendNodeId`; the style Host
  resolves it with `DOM.describeNode({backendNodeId})` (which "does not require domain to be
  enabled" and accepts `backendNodeId` [S3]) and uses the returned `nodeId` for the CSS reads.
  `nodeId` is a front-end mirror id and is invalidated by document updates; `backendNodeId` is the
  better handle to keep across a pick.
- **The normal path starts from `backendNodeId`; the document/selector pair is the fallback.**
  `DOM.getDocument` returns the root (and implicitly enables DOM events) [S3], and
  `DOM.querySelector({nodeId: root, selector})` resolves a selector [S3]. Those are the right calls
  when a style session is opened from a stored selector without a node handle; they are the wrong
  default for a pick, because the selector may have been reused since the pick. `Runtime.evaluate`
  is likewise a fallback (page-side support checks, selector search), not the apply path [S4].
- **Computed values come back as a flat `{name, value}` array** [S44]; filter it to the v1 allowlist
  (§6) and ignore the rest. `getComputedStyleForNode` has no pseudo-element parameter — pseudo
  styles are not returned here [S2]. Pseudo matches do come back from `getMatchedStylesForNode`
  (with `pseudoType`/`pseudoIdentifier` and their own rule matches [S43]); v1 shows them read-only
  (§10.2).
- **Matched styles include the full declaration of every matching rule** — `inlineStyle`,
  `attributesStyle`, `matchedCSSRules`, `inherited`, `pseudoElements`, keyframes and at-rule
  collections [S39]. On utility-CSS pages this can be large; keep only the per-property candidate
  rules you are going to hint, not the whole payload.
- **`CSSProperty` is where the authored value lives:** `text` is "the full property text as
  specified in the style" (so it preserves `var(--brand)`, `0.75rem`, `calc(...)`), `important`
  carries the flag, `longhandProperties` exposes a shorthand's parsed longhands, and `range` locates
  the declaration in its stylesheet [S38]. This is what makes a computed px value explainable.
- **`CSSStyleSheetHeader` is the URL/line source:** `sourceURL`, `origin`
  (`regular | inspector | injected | user-agent`), `isInline`, `isMutable`, `sourceMapURL`,
  `startLine`/`startColumn` [S36]. Headers are delivered by `CSS.styleSheetAdded`; cache them by
  `styleSheetId` and drop on `styleSheetRemoved` [S2]. **P4 must verify** that enabling the CSS agent
  replays `styleSheetAdded` for sheets that already existed; if it does not, the first source hint
  degrades to a sheet URL only (§15).
- **`CSSRule` is where the selector, media context and origin live:** `selectorList.text` and
  per-selector `specificity`, `origin`, `style`, `media[]` (with `text`, `source`, `sourceURL`),
  layers/scopes/supports [S37][S42]. `RuleMatch.matchingSelectors` tells which selector in the list
  actually matched [S37].
- **Exact rule/declaration line:** use `CSS.getLocationForSelector(styleSheetId, selectorText)` to
  get the selector's `SourceRange[]` [S2], or add `header.startLine` to a declaration's
  `CSSProperty.range.startLine` [S36][S38]. If both are missing, show the sheet URL without a line —
  a wrong line is worse than no line.
- **A second useful read** is `CSS.getInlineStylesForNode`, which separates the real `style`
  attribute from presentational attributes (`attributesStyle`, e.g. a legacy `width="20"`) [S40].
  The before value for a property that was set as an attribute (`width="20"`) is not an inline
  declaration and cannot be reset through `style`; treat it as a normal source rule.
- **Live changes:** `CSS.trackComputedStyleUpdatesForNode({nodeId})` on the active target and
  `CSS.computedStyleUpdated` is the protocol's way to know a tracked node's computed style changed
  (one node tracked at a time) [S2]. It is optional for P4, but it is the cheapest way to notice
  that a page script or HMR reset the preview. `DOM.inlineStyleInvalidated` is the lower-level
  signal that an element's inline style was modified via a CSS property change [S3].

### 3.2 Apply one temporary override (inline, chosen)

```text
DOM.resolveNode { backendNodeId }                               → objectId
Runtime.callFunctionOn {
  objectId,
  functionDeclaration:
    "function (property, value, priority) {
       if (priority === 'important') this.style.setProperty(property, value, 'important');
       else this.style.setProperty(property, value, '');
     }",
  arguments: [{ value: 'padding-top' }, { value: '20px' }, { value: 'normal' }],
  returnByValue: true
}
CSS.getComputedStyleForNode { nodeId }                          // verify, then update the panel row
```

- **Never concatenate page/user strings into the JS source.** The function is fixed; the property,
  value and priority are arguments. That is both a correctness and a security rule: page CSS
  values are untrusted data (`AGENTS.md:34` [S29]). A selector + `Runtime.evaluate` is only a
  fallback when the node handle is gone; it reintroduces the selector-staleness problem the node
  object avoids.
- **The ticket's `CSS.setPropertyValue` is not in the current CSS method list** [S2]. The
  declaration editors that are present are `CSS.setStyleTexts` (a list of
  `{styleSheetId, range, text}` edits [S2][S48]) and `CSS.setEffectivePropertyValueForNode` (find
  the active rule for a node and set its value [S2]). Neither is used for the inline preview;
  `setStyleTexts` is reserved for the v2 inspector sheet (§3.4) and `setEffectivePropertyValueForNode`
  is rejected (§3.5). Do not design against the old command name.
- **Verify support first.** `Runtime.callFunctionOn` on the element with
  `function (property, value) { return CSS.supports(property, value); }` (or `Runtime.evaluate` in
  the same context) tells the panel whether the value is understood [S12]. `CSS.supports` is the
  page's own parser, so it is better than a hard-coded regex.
- **`!important` is a separate priority argument, not part of the value.** `setProperty` documents
  `value` must not contain `!important`; pass `"important"` as the priority [S11].
- **Readback is not proof of the final value when a transition runs.** A colour/opacity/transform
  change can produce an intermediate computed value. For the row, verify the **inline declaration**
  was accepted and show the computed value as "animating" if it differs; at send time, re-read the
  computed value (transitions will normally be over) and store that in the quote (§5, §8).
- **Only escalate to `!important` when the cascade requires it.** If the winning source declaration
  is `!important`, a normal inline declaration loses [S10]. The preview then sets inline
  `!important` and marks the row; the quote must carry both the source's `important` flag and the
  preview's priority, or the agent will misread the change.

### 3.3 Verify, reset one, reset all

```text
// verify: compare the computed value to the expected value for this property kind
CSS.getComputedStyleForNode { nodeId }
// reset one (restore what was there before this edit):
Runtime.callFunctionOn { objectId,
  functionDeclaration: "function (p, v, imp) {
    if (v === null) this.style.removeProperty(p);
    else this.style.setProperty(p, v, imp === 'important' ? 'important' : '');
  }",
  arguments: [{value:'padding-top'}, {value:'12px'|null}, {value:'normal'}] }
// reset all: the same calls in reverse edit order, then re-read the computed values
```

The original inline value/priority is captured **before the first edit of that property** via
`CSS.getInlineStylesForNode` (or the element's `style` attribute) [S40]. Do not snapshot and rewrite
the entire `style` attribute on reset: the app may have changed other inline properties in the
meantime. Per-property restore is narrower and idempotent.

Reset is "done" only when the computed value matches the captured baseline for each edited property
(normalising colours and lengths). If it does not — because the app changed the page while the
preview was open — mark the row `drifted` and show it; never claim a clean reset.

### 3.4 The plugin-owned stylesheet alternative (v2)

```text
Page.getFrameTree                                      → frameId
CSS.createStyleSheet { frameId }                       → styleSheetId   // "via-inspector" sheet [S2]
CSS.addRule { styleSheetId, ruleText: "<selector> { padding-top: 20px; }",
              location: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 } }   → CSSRule [S2]
CSS.setStyleTexts { edits: [{ styleSheetId, range, text }] }   → CSSStyle[]  // update a declaration [S2][S48]
CSS.setStyleSheetText { styleSheetId, text: "" }              // reset/clear (semantics to verify) [S2]
```

(The `0:0` rule location for a fresh inspector sheet is **Inference** from `addRule`'s "position
specified by location" contract [S2]; verify it before building the v2 route.)

This route is the right home for pseudo-elements (`<selector>::before`), media-query-scoped rules,
and one shared rule for several elements, and it does **not** touch the element's own `style`
attribute. It is deferred because it adds a selector generator, a specificity/`!important` strategy,
range bookkeeping, and a reset that the protocol does not directly provide: **the CSS domain has
`createStyleSheet` but no `removeStyleSheet` in the current method list** [S2], so "delete the
preview" has to mean clearing the sheet text (or leaving it and dropping the tab). It also does not
cross shadow boundaries [S14].

### 3.5 The page's own rules (`CSS.setEffectivePropertyValueForNode`, author-sheet `setStyleTexts`) — rejected

`CSS.setEffectivePropertyValueForNode(nodeId, propertyName, value)` "find[s] a rule with the given
active property for the given node and set[s] the new value" [S2]; `setStyleTexts` rewrites a
declaration by `styleSheetId` + range [S2][S48]. Both mutate the **page's own stylesheet/CSSOM**, not
the source file, and do not survive a reload (DevTools' own Changes panel says edits disappear on
reload [S7]). They are rejected for the preview because:

- reset requires keeping the original declaration text and ranges; a second edit invalidates the
  first;
- cross-origin `link` sheets are not mutable until DevTools modifies them [S36]; the edit fails in
  exactly the cases users are most likely to inspect;
- the "after" is the page rule's value, so the preview looks like a source edit while the quote
  would be about a different place — the opposite of the code-first contract.

### 3.6 What the screencast shows

The panel receives JPEG frames from `Page.startScreencast`; each `Page.screencastFrame` carries
base64 image data, frame metadata and a session id [S47], and is a capture of the rendered page
[S5][S31]. Because the override is an inline declaration on the page's element, it **is page
pixels**: it appears in the very next damage-driven frame, exactly as a real source change would.
The panel's selection outline is drawn over the `<img>` in the panel (R3 §3 [S26]) and is **not** in
the frame bytes; the style UI must refresh that box from `DOM.getBoxModel` after a layout-changing
edit rather than expecting the frame to carry it.

Two practical consequences:

- **Do not call `Page.captureScreenshot` per control tick.** It is a full capture (30–120 ms in R3's
  estimates [S26]); the damage-driven screencast already gives a frame for a visible change. If no
  frame arrives within a short window after a commit, the panel can use the existing
  `request-frame` command (host `TabManager.refreshFrame`, `src/core/tabs.ts:534-548` [S31]) once.
- **A no-op edit produces no frame.** Changing `color` to the same colour, or a value that the
  cascade blocks, leaves the picture unchanged; the panel's own row state is the feedback, not frame
  arrival.

### 3.7 What survives what

| Event | Inline CSSOM override | Inspector stylesheet | Author-sheet CDP edit |
|---|---|---|---|
| Full reload / navigation | **gone** (new document) [S7] | **gone** | **gone** (in-memory) [S7] |
| Static preview: CSS-only file change (link swap, no reload) | **survives** | **survives** | likely lost (the swapped sheet is a new stylesheet) |
| Vite CSS HMR (`<style>` replacement) | **survives** unless the DOM node is replaced/re-written | **survives** if the selector still matches | lost when that stylesheet is replaced |
| React Fast Refresh re-render | survives if the same DOM node is reused and the app does not write that property; lost on remount/`style` reset (**Inference**) | survives if the selector still matches; lost if the element's identity/path changes | survives only while the page's rule object lives |
| App code rewrites the element's `style` | may be overwritten; detect and mark `lost` | unaffected by element style | unaffected until reload |
| Panel/socket reconnect | survives (page untouched) | survives | survives |

The static-preview line comes from R4's live.js: a CSS-only change re-requests the `<link>` with a
new query string and does **not** call `location.reload()`; every other change does [S27]. Vite
injects CSS through `<style>` tags with HMR, and framework HMR updates without reloading the page or
blowing away application state [S9]. The React line is reasoning about DOM reuse, not a measured
result; §15 flags it.

The honest UI rule that follows: **the preview is never the record.** On any reload/navigation the
Host emits a `style-lost` event, the panel keeps the edit list (so the quote can still be sent) but
marks every applied value `lost`, and does **not** reapply automatically (§9). One edge case to keep
in the Host's verification: a back/forward navigation restored from the back-forward cache can bring
back the old document with its inline declarations intact; treat any navigation as lost until the
target and values are re-verified (**Inference**; common bfcache behaviour, not measured here).

---

## 4. Mechanism comparison

| | Inline `element.style` (CSSOM) | Plugin-owned inspector stylesheet | Injected page `<style>` | Page-rule edit (`setEffectivePropertyValueForNode` / author `setStyleTexts`) |
|---|---|---|---|---|
| Target addressing | node object (`backendNodeId`) | generated selector | generated selector | rule range |
| Specificity | inline normal beats all author normal rules [S10][S6] | author origin, selector specificity/order | author origin, selector specificity/order | changes the actual rule |
| `!important` source rule | inline normal loses; set inline `!important` [S10] | needs `!important` in the generated rule | same | preserves/edits the rule's own flag |
| Pseudo-elements | **no** | yes (`::before` selector) | yes | yes |
| Media queries | **no** (applies at every width) | yes (`@media` in the sheet text) | yes | yes, if that rule is edited |
| Custom properties | can set them, but they inherit to descendants [S13] | can set them | can set them | can edit declarations |
| Shadow DOM | **yes** (node-level style is allowed inside a shadow tree [S14]) | no (document sheets do not cross the boundary [S14]) | no | no |
| Cross-origin sheet | irrelevant (inline wins normal rules) | n/a | n/a | not mutable [S36] |
| Reset | exact per-property value/priority; reverse order | rewrite/clear the sheet; selector may drift | remove the style node | must restore original text; ranges shift |
| DOM side effect | `style` attribute visible to app, observers and agent snapshots [S8] | inspector-origin sheet | a `<style>` node in the DOM | page rule silently changed |
| Survives reload | no | no | no | no |
| Source write | none | none | none | none (but easy to mistake for one) |
| Implementation cost | **small** | medium | small | medium |
| Verdict | **chosen for v1** | v2 | rejected | rejected |

**Why not a plugin-owned `<style>` for v1:** it needs a selector, which is the part of DOM identity
that changes under HMR; inline uses the element object and therefore has no selector-staleness
failure mode at all. The shadow-DOM case settles it: inline works there, a document stylesheet does
not.

**Why not a design canvas / direct source writer:** the product contract is code-first. The plugin's
job is to produce a precise request; the agent edits source ([MAP](../wayfinder/MAP.md), [R6
§5.1](pen-dev-interactions.md)). Any mechanism above that leaves the page changed after the quote is
sent is a bug, not a feature.

---

## 5. Data model

### 5.1 Target identity

Reuse P1's pick verbatim where possible; add only the two handles the Host needs. The **quote** uses
the human/source fields; the **CDP session** uses the node handles.

```ts
interface StyleTarget {
  /** P1 pick identity. */
  pickId: string
  tabId: string
  url: string
  pageVersion: number              // P1's version: bumps on navigation/reload, not on HMR
  selector: string                 // best-effort, unique at pick time
  fingerprint: {                   // P1's re-resolution key
    tag: string
    id?: string
    classes: string[]
    text?: string
    path: string                   // e.g. "main/form"
    index: number
  }
  label: { tag: string; text: string; role?: string }
  box: { x: number; y: number; width: number; height: number }
  context: 'main' | 'shadow' | 'iframe'
  /** P1's best-effort component/file hint; null when unresolved. */
  sourceHint: { framework?: 'react' | 'vue' | 'svelte'; file?: string; line?: number; component?: string } | null
  /** Host-only handles; not needed in the quote. */
  backendNodeId: number
  frameId?: string
}
```

`pageVersion` is P1's, not a new counter. The Host should implement it as a per-tab **document
epoch**: bump when the top-level `loaderId` changes on `Page.frameNavigated`
(`src/core/tabs.ts:729-748` already tracks `loaderId` [S31]) and when `DOM.documentUpdated` says the
document was replaced. HMR is same-document, so it does **not** bump; that is why target freshness
needs a second check (`DOM.describeNode` + fingerprint), not just the version.

The `context` field comes from the node shape at pick time: `DOM.Node` carries `frameId` for a frame
owner and `shadowRootType` for a shadow root [S45]. Set it once in P1's pick result; do not infer it
from the selector.

### 5.2 One edit and a change list

```ts
type StyleProperty =
  | 'display' | 'flex-direction' | 'justify-content' | 'align-items' | 'gap'
  | 'margin-top' | 'margin-right' | 'margin-bottom' | 'margin-left'
  | 'padding-top' | 'padding-right' | 'padding-bottom' | 'padding-left'
  | 'font-size' | 'font-weight' | 'line-height' | 'letter-spacing' | 'text-align'
  | 'color' | 'background-color'
  | 'border-width' | 'border-style' | 'border-color' | 'border-radius'
  | 'opacity' | 'box-shadow'

interface StyleSource {
  origin: 'regular' | 'inspector' | 'injected' | 'user-agent'
  url?: string                     // CSSStyleSheetHeader.sourceURL when non-empty
  line?: number                    // header.startLine + property.range.startLine (or selector range)
  column?: number
  selector?: string                // the matching selector, not the whole selector list
  media?: string[]                 // innermost first, e.g. ["(max-width: 640px)"]
  layer?: string[]
  important: boolean
  shorthand?: string               // e.g. "padding" when the edited longhand came from one
  authoredText?: string            // CSSProperty.text of the winning declaration, verbatim
  inheritedFrom?: string           // ancestor selector when the value is inherited
}

interface StyleEdit {
  id: string
  targetId: string                 // StyleTarget.pickId
  property: StyleProperty
  before: {
    computed: string               // CSS.getComputedStyleForNode value at first edit
    source?: StyleSource           // best-effort winning declaration
  }
  /** The element's inline declaration before this edit; null = absent. */
  originalInline: { value: string; priority: 'normal' | 'important' } | null
  after: {
    value: string                  // exactly what was passed to setProperty
    unit: 'px' | 'rem' | 'em' | '%' | 'unitless' | 'keyword' | 'other'
    priority: 'normal' | 'important'
    computed?: string              // re-read at send/verify time
    status: 'pending' | 'applied' | 'overridden' | 'invalid' | 'lost' | 'drifted'
  }
  /** Same group id => one shared change across targets. */
  shareGroup?: string
  /** Preview was applied at least once; used for the lost/unsaved UI. */
  applied: boolean
  createdAt: number
  updatedAt: number
}
```

A **change list** is `StyleEdit[]` grouped by `targetId` (and by `shareGroup` inside a target group).
The panel never sends the data model to the agent; it renders it into the quote (§8). The model is
also the Host's reset ledger: each edit remembers the **original inline value/priority**, not just
the baseline computed value, so reset does not depend on the page being unchanged.

Rules for the fields:

- **`before.computed` is captured once**, when the property is first edited. It is the value the user
  saw before the change; later page changes must not rewrite history.
- **`before.source.authoredText` is preferable to `before.computed` in the quote** for source-facing
  meaning (`0.75rem`, `var(--brand)`, `padding: 12px 16px`). The panel displays the computed value
  and shows the authored value as a subtitle when they differ [S38].
- **`after.computed` is refreshed at send time** (and after any verification), because a transition,
  a later edit, or HMR may have changed the rendered result. If it no longer matches, mark
  `lost`/`drifted` and surface it.
- **`unit` is parsed from `after.value`**, not inferred from computed px. The agent needs the unit the
  user actually chose; the computed px is evidence.
- **`source.origin` controls display**: `regular` may show file/line; `inspector`/`injected`/`user-agent`
  never show a source file (§10).

### 5.3 Staleness and verification

The Host performs the same three-step check before every apply and again when the quote is built:

1. **Identity.** `DOM.describeNode({backendNodeId})` succeeds, the page still has the same
   `pageVersion`, and the node's tag/id/classes still match the fingerprint.
2. **Uniqueness fallback.** If the node handle is invalid but the fingerprint resolves to exactly one
   element (P1's helper), rebind the target and mark it `rebound`; if zero or several match, mark it
   `stale` and **block send** until the user re-picks. Never send a bare selector and hope (R6 §5.4
   [S34]).
3. **Preview state.** For each edit, re-read the computed value. If it does not match `after`:
   `lost` when the page re-rendered/reloaded, `overridden` when another declaration wins, `drifted`
   when the baseline itself changed. Stale identity blocks send; a lost preview does **not** block,
   but the quote says so explicitly and the panel warns that the before/after is historical.

---

## 6. v1 property and control table

Design constraints: ~390 px wide when docked [S32][S26], one column, no drag interactions that fight
the page, keyboard-usable, every row has a reset. Values in the "default" column are the computed
values the control should show when the property has not been changed; ranges are **UI hints** — the
hard validation is the allowlist + `CSS.supports` + a length cap.

| Group | Property | Control | Default shown | Range / step | Units / notes |
|---|---|---|---|---|---|
| Layout | `display` | menu | computed | block, inline, inline-block, flex, inline-flex, grid, none | Changes the box model; warn that children may reflow. |
| Layout | `flex-direction` | menu | computed | row, column, row-reverse, column-reverse | Enabled only for flex/inline-flex; otherwise collapsed/disabled with reason. |
| Layout | `justify-content` | menu | computed | flex-start, center, flex-end, space-between, space-around, space-evenly | Flex/grid only. |
| Layout | `align-items` | menu | computed | stretch, flex-start, center, flex-end, baseline | Flex/grid only. |
| Layout | `gap` | number | `normal` → 0 px | 0–96, step 1 | px; `normal` preset. |
| Spacing | `margin-{top,right,bottom,left}` | number + unit | computed px | −64–96, step 1 | px/rem/em/%; `auto` preset; negative allowed. |
| Spacing | `padding-{top,right,bottom,left}` | number + unit | computed px | 0–96, step 1 | px/rem/em/%; negative invalid. |
| Typography | `font-size` | number + unit | computed px | 8–120, step 1 | px/rem/em/%; show the px result. |
| Typography | `font-weight` | menu | computed | 100–900, normal, bold | numeric menu. |
| Typography | `line-height` | number / text | computed | 0.8–3 unitless, or px | presets `normal`, `1`, `1.2`, `1.5`, `2`; no % in v1. |
| Typography | `letter-spacing` | number | computed px | −2–10, step 0.1 | px/em; `normal` preset. |
| Typography | `text-align` | menu | computed | left, center, right, justify, start, end | — |
| Color | `color` | colour text + swatch | computed rgb | any valid colour | Does not set backgrounds; inherited values show the inherited hint. |
| Color | `background-color` | colour text + swatch | computed rgba | any valid colour | `transparent`/`none` allowed; alpha preserved. |
| Border | `border-width` | number | computed px | 0–16, step 1 | Applying width to a `border-style: none` element also needs a style; if the user changes width/colour while style is `none`, queue `border-style: solid` as a linked edit (two rows in the quote). |
| Border | `border-style` | menu | computed | none, solid, dashed, dotted, double | — |
| Border | `border-color` | colour text + swatch | computed rgb | any valid colour | — |
| Border | `border-radius` | number | computed px | 0–64, step 1 | Single value applies to all corners; a mixed computed value shows "mixed" and writing one value flattens it (record the shorthand). |
| Effects | `opacity` | slider + number | computed (1) | 0–100%, step 5 | Stored as 0–1; value is unitless to CSS. |
| Effects | `box-shadow` | text + presets | computed (`none`) | free text | Presets: none; `0 1px 2px rgb(0 0 0 / 0.05)`; `0 4px 12px rgb(0 0 0 / 0.15)`; `inset 0 1px 0 rgb(255 255 255 / 0.4)`. Validate. |

**Deferred to v2 (do not build in P4):** `width`, `height`, `min-*`, `max-*`, `position`, insets,
`z-index`, `overflow`, `font-family`, `text-decoration`, `text-transform`, `flex-wrap`,
`align-content`, `transform`, `filter`, `--*` custom properties, pseudo-elements, media-query-scoped
rule editing, and any shared-rule/generated-stylesheet editor.

**Value validation (both sides):**

- property must be in the allowlist; value length ≤ 200 characters; reject control characters and
  newlines;
- reject `url(`, `@import`, and `expression(` in a value (no network fetch, no legacy script, no
  generated rule injection) — a safety pattern also used by the prior art [S22];
- reject `!important` inside the value; importance is a separate control [S11];
- require `CSS.supports(property, value)` from the page before applying [S12];
- after applying, require that `element.style.getPropertyValue(property)` is non-empty (the
  declaration was accepted) and record the computed result; if the computed result is unchanged,
  show `overridden` rather than silently succeeding.

**What the panel displays per row:** the computed value in the control, the authored value and source
badge as a subtitle when available, a reset affordance when changed, and `!important`/`inline`/
`inherited`/`generated` badges where relevant. No row shows a raw computed value as if it were the
source value — that distinction is the whole point (§10).

---

## 7. Multi-element behaviour

P1's picker is designed to support a single or multi selection (`pick.start {mode: single|multi}` in
R6 P1 [S34]). The style inspector should extend that rather than invent its own selection model:

- **Default: per-element edits.** One active target; switching the target chip shows that element's
  edits. Each pick keeps its own edit list and its own baseline. This is the only mode where a
  "before" is unambiguous.
- **Opt-in shared change.** For a property the user is editing, an "Apply to all picked" toggle
  writes the **same authored value** to every target and records a `shareGroup`. Per-target
  `before.computed` and `after.computed` still differ; the quote keeps them. The quote marks the
  group as `shared` and repeats the same after value; the agent decides whether a shared token/rule
  or per-element edits are correct.
- **Caps.** 4 targets and 12 edits total (6 per target) in v1. When a cap is reached, the control is
  disabled with the reason ("Limit reached: send or reset some edits"), never silently ignored (R6
  borrows this "disabled says why" pattern [S34]). The caps are design choices, not protocol limits;
  they keep the quote and the 390 px composer readable. Prior art allows far more (48 changes per
  element, 20 annotations [S21]), which is exactly the scale this rail cannot show.
- **Partial failure.** If one target's apply is rejected (node gone, value overridden), keep the
  successful targets, mark the group `partial`, and surface a one-line count; do not roll back the
  whole group silently.
- **Shared source hint.** If every target's winning declaration resolves to the same
  `source.url + source.line + selector`, the quote says "all targets share this rule" — that is the
  strongest evidence a single source edit covers all of them. If not, the quote lists each hint and
  the agent must decide; do not fabricate a shared source.

Do not build a layers tree, a multi-select box, or a rule-set editor. The page, the picker and the
quote are the surface; the style sheet is a compact list of properties for the active target, with
target chips above it.

---

## 8. The quote

### 8.1 Format

One block, built from the frozen edit list at send time. It must be readable by a human in a 390 px
composer **and** unambiguous for the agent. Fixed grammar, no hidden structure — `Target`,
`- property: before → after`, and the indented `source:`/`preview:` lines are the contract; any
change to them is a quote-format change with tests:

```text
> **Style changes — temporary browser preview; source was not modified.**
> Page: http://localhost:5173/settings · pageVersion 17
>
> Target 1: button.primary “Sign in” — 160×48 — src/components/Hero.tsx:42 (hint)
> - padding-top: 12px → 20px
>   source: `.cta` @ src/styles/app.css:214; authored `0.75rem`
> - background-color: #2563eb → #10b981
>   source: `.cta` uses `var(--brand)` @ src/styles/theme.css:12; preview used !important
>
> Target 2: li.nav-item “Billing” — 88×32 — no source hint
> - color: rgb(107, 114, 128) → rgb(17, 24, 39)
>
> Request: tighten the primary button and darken the billing label.
> Apply these in source, keeping the existing units/tokens where the before value used them; report
> any value that has no source counterpart.
```

Rules:

- **Identity first, per target:** tag + stable class/id + visible text + box + source hint
  (`file:line`), plus the page and `pageVersion`. The selector is included when it is short and
  unique; the fingerprint is not dumped into the quote (it is a re-resolution key, not prose), but
  the selector + text + page version is enough for the agent to find the element.
- **Every change line is `property: before → after`.** `before` is the captured rendered value;
  when the authored value differs, put it in the source sub-line. `after` is the authored value the
  user chose, never the computed px only.
- **Shared changes are one block, not N copies.** When targets share a `shareGroup`, write
  `Shared change (targets 1–2): padding-top: 12px → 20px` and list each target's own before value
  beneath it; per-target computed differences stay visible. Otherwise every target gets its own
  change lines.
- **Source sub-lines are hints, and say so.** Include the matching selector, `file:line`, `@media` if
  present, the authored text when it differs from the computed value, `inherited from …` when
  applicable, and the `!important` fact. Omit the line when only the sheet is known. Append
  `(hint)` to the target's file/line.
- **Mark the preview state.** If the page was reloaded or the preview was lost, the line reads
  `preview lost after reload — the before/after is the user's intent; verify the current value`.
  Never present a lost preview as currently visible.
- **Mark importance.** If the preview had to use inline `!important`, say so and include the source
  rule's importance. The agent must not "clean up" an important rule into a normal one without the
  user's intent.
- **Include the user's note** (the pick bubble's comment) as a `Request:` line at the top or bottom;
  a note is optional when there are edits (the prior art's editor also allows confirming style-only
  changes without a comment [S20]).
- **Say what not to assume:** "temporary preview; source was not modified", "source hints are
  unverified", "keep existing units/tokens". These sentences are part of the quote, not UI chrome.

### 8.2 Caps and sanitisation

- Max 4 targets and 12 edits per quote in v1 (6 per target). When the user exceeds it, the send
  button is disabled with the reason; never silently truncate.
- Page-derived strings (element text, selector, source URL, authored CSS text, the user's note) are
  untrusted. Collapse whitespace, strip control characters/newlines, cap element text (e.g. 80
  chars), selectors (200), URLs (300) and values (200), and escape the quote's Markdown delimiters
  (a value containing a backtick is rendered with double quotes instead of a code span). The Host
  must cap the state before the panel sees it, and the panel must cap again before composing the
  quote; neither side is the only sanitizer.
- The quote is a **blockquote**, so every line is prefixed by the composer; do not put a fenced JSON
  block inside it. If a machine-readable appendix is ever needed, make it a separate "Copy JSON"
  affordance in the panel, not part of the composer text.

### 8.3 Interaction with the existing pick/annotation quote

- **One target, one identity.** The style quote is the pick quote plus changes. When the pick quote
  is still a panel draft (not inserted), the style send builds a **combined** block: identity once,
  then the changes. This is the common path: pick → style → "Add to prompt".
- **If the pick quote is already in the composer**, the panel cannot safely edit that block (the
  composer is DSH's; `insertQuote` only appends). It inserts a **continuation** block:
  `Style changes for the element in pick q_7f3 — button.primary “Sign in”, pageVersion 17` followed
  by the changes. Repeat the identity: composer text is the only carrier across turns, and the page
  may have changed. Never try to replace or "update" an earlier quote.
- **No duplicate ask.** Do not insert a separate instruction paragraph as ordinary composer text.
  The quote ends with the "apply these in source" sentence; the user still writes their own prompt
  when they want more than the changes. This keeps the picks-as-context, never-auto-send rule
  (R6 §3, ADR candidate "picks are delivered as composer quotes, not automatically sent messages"
  [S34]).
- **Check the return value.** `insertQuote` returns a boolean; when it is false, show "Copy quote"
  (and a toast) instead of pretending the quote landed [S28]. If the tab body does not receive
  `inputActions` at all, the copy fallback is the only path until R1/P1 confirms the slot props
  [S28].
- **Do not auto-send, ever.** The agent's next step is the user's Send. The style panel only inserts
  and focuses.

---

## 9. Panel UX, reset/reload/unsaved policy

### 9.1 Entry and layout

- **Entry point:** the pick bubble/chip's **Style** action. If P1's bubble is not ready in P4, a
  paintbrush button in the 38 px toolbar is acceptable, but it competes with the address field and
  refresh [S32]; the bubble is the better long-term home (it already has the element context).
- **Presentation:** an **absolutely positioned bottom sheet inside the tab body**, not a new sidebar
  tab (`AGENTS.md:23`: the panel is a tab, not an overlay or a central page [S29]). Keep it inside
  the tab root rather than adding a separate fixed-position layer. Height `min(60%, 420px)`, the
  frame remains visible above it so the preview is watchable. Header: element label, `pageVersion`,
  change count, Reset all, Done. Body: collapsible groups; one group open at a time (default: the
  group of the last edit, otherwise Color/Type), a dot on collapsed groups with changes. Footer:
  "Preview only — not saved" + "Add to prompt".
- **While the sheet is open, do not forward page input** (or explicitly show "preview lock: page
  clicks are disabled"). Otherwise a stray click can navigate or submit a form while the user is
  editing (R6's pick mode already intercepts pointers for the same reason [S34]).
- **390 px details:** full-width rows, label column ~72 px, value control flexible, reset and badges
  after it; 24 px minimum hit targets; no drag handles; no horizontal scroll; native `<select>`/
  `<input>`/range are acceptable and cheaper than custom widgets. Use `--dsw-alias-*` tokens for all
  colours (`AGENTS.md`/R1 §8 [S29][S28]).
- **States and reasons** (R6's "disabled says why" pattern [S34]): no page, no pick, resolving
  styles, ready, cross-origin iframe (source not editable; pick the parent), shadow target (inline
  preview only, no source hint), pseudo-element-only property (not editable in v1), stale target
  (re-pick), preview lost (re-apply or send anyway), limit reached (send/reset), unsupported value.
  Each state offers one next action; none is a dead end.

### 9.2 Live preview loop

1. The control updates **locally first** (optimistic) so the slider/field feels immediate.
2. Throttle applies to ~50 ms (or one per animation frame); each tick sends property/value/priority
   to the Host.
3. The Host validates, applies, and returns the verified state. A visible change also produces a
   screencast frame; a no-op does not — do not block the UI on a frame.
4. On commit (pointerup/blur/Enter), re-read the computed value and mark the row `applied`,
   `overridden` or `invalid`; update the element outline box if the edit changed layout.
5. If no frame is seen after a commit that should be visible, call `request-frame` once (host
   `refreshFrame`, ~30–120 ms [S26]); do not capture per tick.

### 9.3 Reset

- **One property:** restore the original inline value/priority (or `removeProperty` if it was not
  inline), then verify the computed value against the baseline. The row leaves the **pending edit
  list**, so the next quote no longer contains it; a quote already inserted into the composer is
  never edited.
- **All:** the same in reverse creation order; report any row that could not be restored as
  `drifted` and keep it visible. Never claim "all reset" while a row still differs.
- **Reset after a quote was inserted:** resetting does not edit the composer. Show "the quote you
  already sent still contains this change"; the user can send a follow-up or fix the source. The
  panel's job is to be truthful, not to reach into DSH's composer.
- **Reset does not undo source edits** — by design, the plugin never wrote source.

### 9.4 Reload, HMR and unsaved changes

- **Detect:** a `style-lost` event from the Host (it bumps the document epoch / pageVersion), or a
  navigation observed by the panel. Clear the `applied` state, keep the edit list, show a persistent
  banner: *"Preview reset by page reload. Your changes are still listed; re-apply only if you did not
  send them."*
- **Do not auto-reapply.** If the user sent the quote and the agent changed source, re-applying the
  old preview would mask the real result and make verification lie. Re-apply is an explicit button.
- **HMR without a document change:** keep the overrides but re-verify them (the DOM may have been
  remounted, or the app may have rewritten `style`). If a target is gone, mark stale; if a property
  was overwritten, mark lost. The pageVersion alone is not enough.
- **Unsaved edits:** the preview edits live in the tab's mounted state; the **quote is the only
  durable record**. Show a count badge on the Style entry and on the "Add to prompt" button. Do not
  build a blocking close-confirmation the sidebar cannot honour; instead, when the sheet is closed,
  the badge stays visible, and when the page reloads the banner explains what happened. If the user
  closes the tab, the preview goes with it — say so in the empty/close state, in one sentence.
- **User control checklist:** preview banner always visible while edits exist; every value shows
  before and after; Reset all is one click; Send is disabled without edits or with a stale target;
  the quote can be copied even when insertion fails; no source file is ever touched; nothing is sent
  without the user's own Send.

---

## 10. Source hints: what to show, what to omit, and why

The value the user edits is a **computed** value; the source may express it as a token, a unit, a
shorthand, a media query, or not at all (inherited/user-agent). The hint's job is to shorten the
agent's search, never to pretend certainty.

### 10.1 Pipeline (Host-side)

1. From `CSS.getMatchedStylesForNode`, gather declarations for the property: inline style, matched
   rules (including shorthand `longhandProperties` [S38]), and inherited entries [S39].
2. Choose a best-effort winning declaration using the cascade: `!important` before normal; inline
   before author rules of the same importance; within author normal/important rules, selector
   specificity ([S37]), then source order; use `CSS.resolveValues` or a normalised value compare to
   check the candidate against the computed value when available [S2]. Label the result a **hint**.
3. Resolve the sheet header from the `styleSheetAdded` cache by `styleSheetId`: `sourceURL`,
   `startLine`, `origin`, `isInline`, `sourceMapURL` [S36].
4. Compute the line:
   - declaration line = `header.startLine + property.range.startLine` (and column when same line)
     [S38];
   - rule/selector line = `CSS.getLocationForSelector(styleSheetId, selectorList.text)` [S2];
   - prefer the declaration line for "where the property is written", the selector line for "which
     rule"; show one, keep the other in the panel's details.
   (Both offsets are zero-based; the addition is **Inference** from the field docs and must be
   checked in P4 against a known file.)
5. Attach media (`rule.media[].text` [S42]), the matching selector index [S37], importance [S38],
   and whether it is a shorthand [S38].
6. If any step fails, degrade in this order: `selector @ url:line` → `selector @ url` → `selector` →
   no hint. Never show a guessed line or a component name that was not resolved.

### 10.2 Show / omit table

| Signal | Source | Show? | Why |
|---|---|---|---|
| Stylesheet URL + line | `CSSStyleSheetHeader.sourceURL`, `CSSProperty.range` [S36][S38] | **Yes**, as `file:line (hint)` | The cheapest real anchor; DevTools and the prior art both use it [S20][S24]. |
| Matching selector | `CSSRule.selectorList` + `RuleMatch.matchingSelectors` [S37] | **Yes**, the single matching selector | Tells the agent which rule, and is useful when the file/line is wrong (generated CSS). |
| Authored value | `CSSProperty.text` [S38] | **Yes**, when it differs from computed (`0.75rem`, `var(--brand)`) | Prevents the agent from hard-coding the computed px and losing the token/unit. |
| `!important` | `CSSProperty.important` [S38] | **Yes**, as a badge/line | It changes how the source edit must be written and why the preview needed importance. |
| Media query | `CSSRule.media[].text` [S42] | **Yes**, `@media …` | The same value at another width may be a different rule; the preview is width-global. |
| Cascade layer / `@supports` | `CSSRule.layers` / `supports` [S37] | Optional detail | Useful in design systems, too much for the quote; keep in the panel's details. |
| Inherited declaration | `inherited[]` [S39] | **Yes**, "inherited from `<ancestor>`" | Editing the child's inline style may be the wrong source change; the ancestor/token often owns it. |
| Inline `element.style` | `inlineStyle` [S40] | **Yes**, "element.style" | The agent must find the JSX/HTML style prop or component that writes it. |
| Tailwind/generated class | matched selector + element classes [S37][S45] | **Yes**, class + selector | The utility class (`px-3`) is the real source handle; the generated CSS line is not. |
| CSS-in-JS / constructed sheet | `origin`, empty `sourceURL`, `isConstructed` [S36] | **Omit file/line**, say "generated CSS" | The runtime sheet has no meaningful project line; a fake anchor sends the agent to the wrong file. |
| Source map | `sourceMapURL` [S36] | **Omit in v1**, optional v2 | Resolving maps is extra code and can be wrong for transformed CSS; add only after the basic hint proves useful. |
| React/Vue/Svelte component | P1's best-effort anchor (dev-mode framework internals) [S34][S24] | **Show if P1 already resolved it**, as a secondary hint | It is dev-only, absent in production, and prior art shows the shapes are framework internals (unlicensed code; pattern only [S18][S24]). Do not build a second extractor in P4. |
| User-agent / injected rules | `origin` [S36] | **Omit** | Noise; no source counterpart. |
| Cross-origin `link` sheet | `isMutable: false` [S36] | **URL only**, no line if `getStyleSheetText`/`getLocationForSelector` fails | The rule is readable but not editable; the URL still helps the agent find the dependency. |
| Shadow-root style | no author URL mapping [S14] | **Omit**, label "inside shadow DOM" | Document-level source hints do not correspond to the shadow tree's internal `<style>`. |
| Pseudo-element rule | `pseudoElements` [S39] | **Show as read-only context**, not editable | v1 cannot preview pseudo changes inline; showing it as an editable row would lie. |
| Attributes style (`width="20"`) | `attributesStyle` [S40] | **Omit from the property hint**, note "presentational attribute" | It is not a CSS declaration the agent edits; it is HTML. |

**Component hints are deliberately not a P4 deliverable.** CDP has no component metadata; DevTools'
React panel works through React DevTools' own hook, and the prior-art extractor reads React fiber
`_debugSource`, Vue `__vueParentComponent.type.__file`, and Svelte `__svelte_meta.loc` — all
framework internals, all absent in production builds [S24]. P1 may already resolve one; if so, reuse
it in the quote. If not, the stylesheet hint + selector + classes is the honest v1.

---

## 11. Prior art: what to borrow (patterns only)

`@canglongcl/dsh-web-review` 0.6.0 has a visual-adjustment editor for text, colour, font, size,
spacing, border and effects, previews edits immediately, and leaves source changes to the agent
[README](https://cdn.jsdelivr.net/npm/@canglongcl/dsh-web-review@0.6.0/README.md). **It is
unlicensed:** the published `package.json` has no `license` field [S18], and the tarball has no root
`LICENSE` (only third-party skill licences) [S19]. Under default copyright there is no reuse
permission. This note borrows **patterns**, not code, CSS, or type names (`AGENTS.md:38` [S29]).

Worth adapting:

- **Allowlisted properties, not free-form CSS.** Their list excludes URL-bearing/generated-content
  properties and validates values for control characters, `url(`, `expression(` and `@import`
  [S22]. Our v1 table is smaller and follows the same posture (§6).
- **Baseline map + changed-only diff + per-property reset.** The editor keeps `before` from a
  baseline, stores `after` per property, and only emits properties that changed [S20]. That is the
  same data model as §5, independently arrived at.
- **Validity probe before applying.** Their client checks the value with a detached element's
  `style.setProperty`/`getPropertyValue` [S20]; our page-side `CSS.supports` is the CDP equivalent
  [S12].
- **Grouped controls with sensible control kinds** (colour, number with step/min/max/presets, menu,
  raw) [S23]; a compact group/accordion layout works at our width.
- **Composite controls** (box model, radius, shadow, transform) are the right v2 direction; v1 keeps
  single-value rows and presets.
- **Caps and explicit limits** on changes/annotations [S21] — we lower them for a 390 px rail and a
  readable quote.

Do **not** borrow:

- the floating 400 px editor anchored to the element (their preferred widths are 374–414 px [S20]);
  our panel is ~390 px total and the page must remain visible;
- its same-origin iframe preview bridge (`preview-style`/`restore-style` per element [S25]); our page
  is driven over CDP, not an iframe;
- its source-anchor extraction as a v1 requirement (development-only framework internals [S24]);
- its text-content editing (`textChange`) — that is content editing, a different product surface,
  and would widen P4 past style;
- any code, CSS or type names from the package (unlicensed).

The MIT `dsh-web-preview-panel` is iframe-based and only a pattern source for the earlier fork
decision ([R2](prior-art.md)); it adds nothing specific to style editing.

---

## 12. Risks

### 12.1 Top three

**Risk 1 — the quote encodes a rendered value the source cannot reproduce (fidelity gap). Highest
impact.**
A computed `padding-top: 12px` may come from `0.75rem`, a `var(--spacing-3)` token, a shorthand, an
`@media` rule, or inheritance. An agent given only the computed number will hard-code px and lose
the token/responsive behaviour; the change then looks right at one width and wrong everywhere else.
*Mitigation:* always carry the authored text and source hint when available; show them in the panel
and quote; instruct the agent to keep units/tokens and to report values with no source counterpart;
never send a computed-only after value as the sole instruction; prototype against a token-heavy and
a Tailwind fixture, not a static HTML page.
*Kill criterion:* if the P4 fixture's quote cannot be turned into a source change that reproduces the
preview at the same and at another viewport, the format is not good enough to ship.

**Risk 2 — the target is stale or the user edits the wrong element. High impact.**
HMR remounts, route changes, multi-element edits and reused DOM nodes all break "the element I
picked". A quote that resolves to a different button is worse than no quote. P1's `Ref` already
"expires when the page navigates or the DOM changes" ([GLOSSARY](../../GLOSSARY.md)); the style
session adds a second chance to get it wrong because it holds several edits per target.
*Mitigation:* keep `backendNodeId` + `pageVersion`; re-verify before every apply and at send; use
fingerprint re-resolution only when it is unique; block send on stale identity; show target chips
and the element label with each quote group; prototype a React Fast Refresh remount fixture.
*Kill criterion:* if P4 cannot reliably re-identify a target after a component HMR update in the
fixture, limit v1 to one target and require re-pick after any HMR (still useful, but narrower).

**Risk 3 — the preview silently stops being the preview. High likelihood, medium impact.**
The app can rewrite the element's `style` on re-render; an author `!important` rule can beat a normal
inline declaration; a transition can show an intermediate value; a reload wipes everything. Users
will trust what they see, and a quote that claims a state the page no longer shows erodes the whole
feature.
*Mitigation:* verify after every change and at send; show `applied | overridden | lost | drifted` per
row; use inline `!important` only when the source requires it and mark it; make reload loss a visible
banner with no auto-reapply; keep reset per row and all-rows; make "Preview only — not saved" a
permanent part of the sheet, not a toast.
*Kill criterion:* if ordinary app re-renders overturn inline overrides in the P4 fixture without the
panel detecting it, the inline-only mechanism is not trustworthy enough; move to the inspector-sheet
mechanism (or restrict to pages without re-render) before shipping.

### 12.2 Secondary risks

| Risk | Why | Mitigation |
|---|---|---|
| Panel overcrowding at 390 px | 26 properties × controls; the toolbar is already 38 px [S32] | Accordion groups, one open, target chips, no layers tree; measure at 390 px in P4. |
| Slider/scrub latency | Each tick is a CDP round-trip; R3's click→paint p50 estimate is 25–50 ms [S26] | Optimistic local value, throttle ~50 ms, verify on commit only, frame optional. |
| `!important` escalation | Inline normal loses to author important [S10]; escalating changes the meaning | Only escalate when the winning source is important; record both flags in the quote. |
| Cross-origin stylesheets | `isMutable: false`; `getStyleSheetText` may fail [S36] | URL-only hint; inline preview still works; no sheet edits. |
| Shadow DOM | Inline works, document sheets do not [S14] | Inline-only, no source hint, label the context; P4 fixture. |
| Cross-origin iframe | Needs an OOPIF session; P1 is main-frame first (R3 §7 [S26]) | Disable style for iframe picks with a reason; no fake hint. |
| Pseudo-elements | Inline cannot target them; computed command has no pseudo parameter [S2] | Read-only context; v2 inspector sheet. |
| Media-scoped source | Inline override is global; source rule may be one breakpoint [S42] | Show `@media` in the hint; warn that the preview is width-global. |
| Custom-property edits | Setting `--x` inline inherits to descendants [S13] | Not editable in v1; if a value uses `var()`, quote the token and resolved value. |
| Quote formatting/injection | Page text/CSS may break Markdown; quoted data is untrusted | Strip/cap/escape (§8.2); no fenced JSON inside the blockquote. |
| `insertQuote` unavailable | Slot props are a client contract; returns boolean [S28] | Copy-quote fallback; P1 verifies the prop exists. |
| Two panels, one tab | Broadcast model has several sinks [S17] | Host owns one style session per tab; reject a second with a reason. |

---

## 13. Go/no-go for P4

**Go**, with this scope:

- one active target from P1 (plus opt-in "apply to all picked", max 4);
- 26 allowlisted properties (§6), inline overrides only;
- computed/matched/inline read on open; computed verify after every change;
- per-row and all-row reset; lost/stale states; no auto-reapply;
- one combined (or continuation) quote, manual insert, manual send; no source write;
- a bottom sheet that fits the ~390 px tab.

**No-go / re-scope if:** the fixture proves the quote cannot reproduce the preview in source; inline
overrides are silently overturned by normal re-renders; or the sheet cannot present the property set
usably at 390 px. The fallback in each case is narrower scope, not a source writer: read-only source
hints (Risk 1), single-target only (Risk 2), or inspector-sheet preview for specific cases (Risk 3).

### P4 acceptance checklist

1. **Read:** pick a local fixture element; every §6 row shows the computed value; a rule-backed
   property shows `file:line`, a selector, and the authored value when it differs.
2. **Preview:** change colour, padding, font-size, border-radius and box-shadow; the page changes in
   the screencast; each row shows the before/after and an applied badge; a `!important` fixture
   escalates correctly and marks it.
3. **Verify:** change a property to an invalid value (rejected with a reason); change one that an
   author `!important` rule wins (overridden with a reason).
4. **Reset:** reset one and all; computed values return to baseline; a page-rewritten property is
   reported as drifted, not silently "reset".
5. **Reload:** reload; overrides are gone; the sheet shows preview-lost; the quote still contains the
   before/after; no auto-reapply.
6. **Multi:** pick two elements; shared change applies to both; the quote lists both targets with
   per-target before values; one failed target is marked partial.
7. **Quote:** insert into the composer; it is one readable block; the agent can name the property,
   before, after, unit, target and source hint; no source file changed by the plugin (hash/mtime
   check).
8. **Panel:** 390 px, no horizontal scroll, keyboard-operable, light/dark tokens, en/zh strings.
9. **Record** the surviving property set and the go/no-go in the P4 ticket resolution.

---

## 14. What this means for the design

1. **The preview is a lens, the quote is the product.** Style edits exist to produce a precise
   request; the plugin must never write source and must never imply it did.
2. **Inline CSSOM is the v1 mechanism.** It is node-targeted, shadow-DOM-safe, exactly reversible and
   the workflow DevTools recommends for changes that must take effect [S6].
3. **Reuse P1's identity, not a second one.** Add `backendNodeId`/`frameId` for the Host and keep
   `selector + fingerprint + pageVersion + sourceHint` for the quote; block send on stale identity.
4. **The data model is a ledger.** Before is captured once, after is authored + computed, and the
   original inline value is what reset restores.
5. **26 properties, six groups, accordion.** No layers tree, no width/position controls, no design
   canvas; v2 is where the inspector sheet, pseudo-elements, media rules and custom properties go.
6. **The quote carries authored values, source hints, media, importance and a preview-state marker.**
   A computed-only quote is a trap.
7. **Manual only.** `insertQuote`, focus, user sends. No auto-send, no auto-reapply after reload.
8. **Verification is UI, not a log.** Every row shows applied/overridden/lost/drifted and the sheet
   keeps "Preview only — not saved" visible.
9. **P4 is a spyglass on a hard problem, not the final editor.** The prototype's job is to prove the
   read/apply/reset/quote loop on real fixtures; the inspector sheet and the broader property set wait
   for that evidence.

---

## 15. What could not be verified

1. **No live CDP run.** The workspace cannot launch Chromium (R3 §6.5 [S26]); every command/field
   above comes from the protocol mirrors, not from this machine. P4 must run the sequence against
   the exact Chromium inside DSH Desktop 0.2.2-rc.3 / Electron 44.7.0 before trusting it.
2. **Whether `CSS.enable` replays `styleSheetAdded` for sheets that already exist.** Headers are the
   only source of `sourceURL`/line; if enable does not replay them, source hints must fall back to
   `CSS.getStyleSheetText` + selector search or a sheet URL only. Verify first in P4.
3. **Whether `element.style` is addressable as a `CSSStyle` with a `styleSheetId` for
   `CSS.setStyleTexts`.** The protocol makes `styleSheetId` optional on `CSSStyle` [S41] and
   Chromium historically gave inline styles their own inspector sheet [S49]; v1 does not depend on
   this because it uses CSSOM, but the v2 inspector-sheet route should not assume it either.
4. **Inspector-sheet lifecycle.** `CSS.createStyleSheet` exists [S2], but no `removeStyleSheet` was
   in the current method list; whether clearing the text fully removes the sheet, and whether the
   sheet is visible to page script or to the agent's snapshot, was not tested. This is the main
   reason the route is v2.
5. **HMR/React behaviour** (§3.7, §12) is reasoned from the DOM/Vite model, not measured. A React
   Fast Refresh fixture and a Vite CSS-HMR fixture in P4 are the proof.
6. **Screencast timing for style changes** is unmeasured; R3's 25–50 ms click→paint estimates are the
   closest numbers [S26]. Do not build a per-tick screenshot path on the assumption that frames are
   free.
7. **Cross-origin `getStyleSheetText` / `getLocationForSelector`** behaviour was not tested; the
   header says the sheet is not mutable [S36], and the hint pipeline degrades to URL-only.
8. **Component-hint shapes** vary by framework version and are dev-mode only [S24]; P1's resolution
   may differ. The quote must treat them as hints, not as validated source locations.
9. **DSH `QuoteSummary` shape / exact `insertQuote` rendering** was taken from R1's read of the
   installed contract [S28]; the style quote deliberately depends only on the text argument, so a
   different summary shape cannot break it, but P1/P4 must verify the slot receives `inputActions`.
10. **Chrome DevTools documentation** was read through the `.md.txt` mirrors on
    `developer.chrome.google.cn` because `developer.chrome.com` was unreachable from this workspace;
    the canonical URLs are linked in the sources. The quoted wording is the same page content; if
    the live page has changed, re-check the statements used here (inline declarations are the
    recommended workflow; DevTools changes disappear on reload; adding to `element.style` shows a
    `style` attribute).
11. **Protocol snapshot.** The field/method mirror is `puppeteer` 3.27.0's generated protocol
    [S2], not necessarily the exact Chromium in the installed DSH. The v1 commands are long-standing
    APIs (the screencast and the CSS reads), but the v2 `createStyleSheet`/`addRule` route and any
    newer screencast tuning parameters must be feature-detected and checked against the installed
    Chromium at P4 time (R3 §2.2 [S26]).

---

## Sources

| Ref | Source | Used for |
|---|---|---|
| S1 | [CDP CSS domain](https://chromedevtools.github.io/devtools-protocol/tot/CSS/) | Canonical command/type reference (SPA; the field text was read through S2) |
| S2 | [CSS domain protocol mirror — `CSSApi`](https://pub.dev/documentation/puppeteer/3.27.0/protocol_css/CSSApi-class.html) | `enable`, computed/matched/inline reads, `setStyleTexts`, `createStyleSheet`, `addRule`, `getLocationForSelector`, `setEffectivePropertyValueForNode`, `trackComputedStyleUpdatesForNode`; method list has no `setPropertyValue` and no `removeStyleSheet` |
| S3 | [DOM domain mirror — `DOMApi`](https://pub.dev/documentation/puppeteer/3.27.0/protocol_dom/DOMApi-class.html) | `getDocument`, `getNodeForLocation`, `describeNode`, `resolveNode`, `getBoxModel`, `getInlineStylesForNode` companions |
| S4 | [Runtime domain mirror — `RuntimeApi`](https://pub.dev/documentation/puppeteer/3.27.0/protocol_runtime/RuntimeApi-class.html) | `evaluate`, `callFunctionOn`, `returnByValue`/`awaitPromise` |
| S5 | [Page domain mirror — `PageApi`](https://pub.dev/documentation/puppeteer/3.27.0/protocol_page/PageApi-class.html) | `startScreencast`, `stopScreencast`, `screencastFrameAck`, `reload`, `getFrameTree`, `frameNavigated`, `captureScreenshot` |
| S6 | [Chrome DevTools CSS reference](https://developer.chrome.com/docs/devtools/css/reference.md.txt) (read via [the .cn mirror](https://developer.chrome.google.cn/docs/devtools/css/reference.md.txt)) | Inline declaration workflow and its specificity rationale; `element.style`; new style rule; Styles-pane editing |
| S7 | [Chrome DevTools Changes panel](https://developer.chrome.com/docs/devtools/changes.md.txt) (read via [.cn mirror](https://developer.chrome.google.cn/docs/devtools/changes.md.txt)) | "If you reload either DevTools or your page, the changes disappear"; Local Overrides as the only persistence |
| S8 | [Chrome DevTools: View and change CSS](https://developer.chrome.com/docs/devtools/css.md.txt) (read via [.cn mirror](https://developer.chrome.google.cn/docs/devtools/css.md.txt)) | Adding a declaration to `element.style` shows a `style` attribute in the DOM tree |
| S9 | [Vite Features — HMR and CSS](https://vite.dev/guide/features.html) | CSS injected via `<style>` with HMR; framework HMR without page reload/state loss; React Fast Refresh |
| S10 | [MDN `!important`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/important) | Inline normal / inline important precedence; important beats specificity; user/UA important and transitions can override; custom-property importance |
| S11 | [MDN `CSSStyleDeclaration.setProperty`](https://developer.mozilla.org/en-US/docs/Web/API/CSSStyleDeclaration/setProperty) | `priority` parameter; `value` must not contain `!important` |
| S12 | [MDN `CSS.supports()`](https://developer.mozilla.org/en-US/docs/Web/API/CSS/supports_static) | Page-side validation of a property/value pair |
| S13 | [MDN: Using CSS custom properties](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascading_variables/Using_custom_properties) | Custom properties inherit from the parent; `var()` cannot be used in media queries |
| S14 | [MDN: Using shadow DOM](https://developer.mozilla.org/en-US/docs/Web/API/Web_components/Using_shadow_DOM) | CSS encapsulation; element-level styling inside a shadow tree; document CSS does not cross the boundary |
| S15 | [`@linxin666/dsh-client-ui-browser-view` `core/cdp.d.ts`](https://cdn.jsdelivr.net/npm/@linxin666/dsh-client-ui-browser-view@0.4.19/lib/types/core/cdp.d.ts) | Upstream transport: one WebSocket, flat sessions, `send`/`on` |
| S16 | [Upstream `core/actions.d.ts`](https://cdn.jsdelivr.net/npm/@linxin666/dsh-client-ui-browser-view@0.4.19/lib/types/core/actions.d.ts) | Screencast only emits on compositor change; every action refreshes a frame |
| S17 | [Upstream `host/service.d.ts`](https://cdn.jsdelivr.net/npm/@linxin666/dsh-client-ui-browser-view@0.4.19/lib/types/host/service.d.ts) | Host owns the CDP session and broadcasts to every panel sink |
| S18 | [`@canglongcl/dsh-web-review@0.6.0` package.json](https://cdn.jsdelivr.net/npm/@canglongcl/dsh-web-review@0.6.0/package.json) | **No `license` field** (unlicensed; patterns only) |
| S19 | [`@canglongcl/dsh-web-review@0.6.0` file list](https://data.jsdelivr.com/v1/package/npm/@canglongcl/dsh-web-review@0.6.0/flat) | **No root `LICENSE`** in the tarball; only `skills/LICENSE` |
| S20 | [`AnnotationEditor.tsx`](https://cdn.jsdelivr.net/gh/CanglongCl/dsh-web-review@main/packages/dsh-web-review/src/client/AnnotationEditor.tsx) | Baseline map, per-property reset, changed-only diff, probe validation, control widths (pattern only) |
| S21 | [`annotation-contract.ts`](https://cdn.jsdelivr.net/gh/CanglongCl/dsh-web-review@main/packages/dsh-web-review/src/annotation-contract.ts) | Change/annotation limits; optional framework anchor (pattern only) |
| S22 | [`annotation-properties.ts`](https://cdn.jsdelivr.net/gh/CanglongCl/dsh-web-review@main/packages/dsh-web-review/src/annotation-properties.ts) | Property allowlist; value safety checks (pattern only) |
| S23 | [`property-editor-config.ts`](https://cdn.jsdelivr.net/gh/CanglongCl/dsh-web-review@main/packages/dsh-web-review/src/client/property-editor-config.ts) | Control kinds, groups, presets (pattern only) |
| S24 | [`source-anchor.ts`](https://cdn.jsdelivr.net/gh/CanglongCl/dsh-web-review@main/packages/dsh-web-review/src/client/source-anchor.ts) | React/Vue/Svelte source-anchor shapes; dev-only framework internals (pattern only) |
| S25 | [`preview-bridge.ts`](https://cdn.jsdelivr.net/gh/CanglongCl/dsh-web-review@main/packages/dsh-web-review/src/client/preview-bridge.ts) | `preview-style`/`restore-style` per element in its iframe model (pattern only) |
| S26 | [`docs/research/cdp-input.md`](cdp-input.md) (R3) | Pick via `DOM.getNodeForLocation`; upstream screencast and refresh behaviour; panel `<img>` and geometry; no live browser |
| S27 | [`docs/research/preview-live-reload.md`](preview-live-reload.md) (R4) | CSS-only live reload swaps `<link>` without `location.reload()`; other changes reload |
| S28 | [`docs/research/dsh-plugin-apis.md`](dsh-plugin-apis.md) (R1) | `inputActions.insertQuote`/`insertText` contract and return values; tab body slot props; theme/locale rules |
| S29 | [`AGENTS.md`](../../AGENTS.md) | Protocol-first architecture; Host owns CDP; panel is a tab/`keepMounted`; no `position: fixed`; loopback/security; Apache-2.0; no code from `dsh-web-review` |
| S30 | [`src/core/protocol.ts`](../../src/core/protocol.ts) | Current version/command/event union and decoder; where style commands must be added |
| S31 | [`src/core/tabs.ts`](../../src/core/tabs.ts) | `sessionOf`, `Page.startScreencast`, `refreshFrame`, `loaderId`/`frameNavigated` |
| S32 | [`src/client/panel.module.css`](../../src/client/panel.module.css) | 38 px toolbar; "roughly 300–500px" column |
| S33 | [R7 ticket](../wayfinder/tickets/R7-style-editing.md) / [P4 ticket](../wayfinder/tickets/P4-style-inspector.md) | Questions, acceptance, write scope |
| S34 | [`docs/research/pen-dev-interactions.md`](pen-dev-interactions.md) (R6) | Pick payload/`pageVersion`, selection-as-context, no layers tree, disabled-with-reason |
| S35 | [Stack Overflow: "DOM agent needs to be enabled first"](https://stackoverflow.com/questions/26527127/brackets-dom-agent-needs-to-be-enabled-first) | Historical evidence that `CSS.enable` fails without the DOM agent |
| S36 | [CSS `CSSStyleSheetHeader` mirror](https://pub.dev/documentation/puppeteer/3.27.0/protocol_css/CSSStyleSheetHeader-class.html) | `sourceURL`, `origin`, `isInline`, `isMutable`, `isConstructed`, `sourceMapURL`, `startLine` |
| S37 | [CSS `CSSRule` mirror](https://pub.dev/documentation/puppeteer/3.27.0/protocol_css/CSSRule-class.html) | selector list + specificity, style, media/layers/supports, origin, `styleSheetId` |
| S38 | [CSS `CSSProperty` mirror](https://pub.dev/documentation/puppeteer/3.27.0/protocol_css/CSSProperty-class.html) | `text`, `important`, `longhandProperties`, `range`, `parsedOk` |
| S39 | [CSS `GetMatchedStylesForNodeResult`](https://pub.dev/documentation/puppeteer/3.27.0/protocol_css/GetMatchedStylesForNodeResult-class.html) | `inlineStyle`, `matchedCSSRules`, `inherited`, `pseudoElements`, at-rules |
| S40 | [CSS `GetInlineStylesForNodeResult`](https://pub.dev/documentation/puppeteer/3.27.0/protocol_css/GetInlineStylesForNodeResult-class.html) | `inlineStyle` vs `attributesStyle` |
| S41 | [CSS `CSSStyle` mirror](https://pub.dev/documentation/puppeteer/3.27.0/protocol_css/CSSStyle-class.html) | `styleSheetId` optional; `range`, `cssText`, properties |
| S42 | [CSS `CSSMedia` mirror](https://pub.dev/documentation/puppeteer/3.27.0/protocol_css/CSSMedia-class.html) | Media query text/source/sourceURL |
| S43 | [CSS `PseudoElementMatches` mirror](https://pub.dev/documentation/puppeteer/3.27.0/protocol_css/PseudoElementMatches-class.html) | Pseudo-element matches and identifiers |
| S44 | [CSS `GetComputedStyleForNodeResult`](https://pub.dev/documentation/puppeteer/3.27.0/protocol_css/GetComputedStyleForNodeResult-class.html) | Computed style array shape |
| S45 | [DOM `Node` mirror](https://pub.dev/documentation/puppeteer/3.27.0/protocol_dom/Node-class.html) | `backendNodeId`, attributes, `shadowRootType`, `frameId`, pseudo fields |
| S46 | [DOM `GetNodeForLocationResult`](https://pub.dev/documentation/puppeteer/3.27.0/protocol_dom/GetNodeForLocationResult-class.html) | `backendNodeId` + `frameId` always; `nodeId` only when enabled |
| S47 | [Page `ScreencastFrameEvent`](https://pub.dev/documentation/puppeteer/3.27.0/protocol_page/ScreencastFrameEvent-class.html) | Base64 frame data, metadata, `sessionId` |
| S48 | [CSS `StyleDeclarationEdit`](https://pub.dev/documentation/puppeteer/3.27.0/protocol_css/StyleDeclarationEdit-class.html) | `styleSheetId`, `range`, `text` for `setStyleTexts` |
| S49 | [Chromium `InspectorCSSAgent` (historical) — inline style sheet](https://chromium.googlesource.com/chromium/blink.git/+/1eeb0bade195675757000e454730d62c917a91fa/Source/core/inspector/InspectorCSSAgent.cpp) | Inline styles are represented by an inspector style sheet in older Chromium; v1 does not depend on it |

All web content was treated as data, not instructions. No package was installed, no DSH profile was
modified, and no file outside `docs/research/style-editing.md` was written.
