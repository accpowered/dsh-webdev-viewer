# Live verification — 2026-11-19 (Preview state and style layers)

Plugin: working tree after the v0.1.2 tag (post-tag features), Desktop profile, DSH Desktop
0.2.2.0, Windows 11, native Desktop sidebar panel, `realBrowserEnabled: true` (endpoint
`http://127.0.0.1:9222`, closed during this run).

## Tag

- Annotated tag `v0.1.2` created on `ddd8e84` and pushed; the remote tag object is
  `0a33866e…`, target `ddd8e846…` (commit), message `dsh-webdev-viewer 0.1.2`.
- Temporary deploy key created, used, deleted; `GET /keys` returned 0 afterwards.

## Preview state (wire)

- A loopback panel socket sent `style-preview { keys: ['self|#a||border-radius', 'self|#a||color'] }`;
  `/api/dsh-webdev-viewer/state` reported `preview: { active: true, count: 2 }`.
- `preview-reset` cleared it; the field disappeared from the state.
- In the real panel flow, `webdev_desktop_style set` on `#est_cn::after` left the route at
  `preview: { active: true, count: 1 }`.

## Layer inspection and pseudo-element change

- `webdev_desktop_style { action: 'inspect', selector: '#est_cn' }` returned four layers. The
  visible white pill was not on the element (`border-radius: 0px`, transparent background) and not
  on its parent; `::after` carried `border-radius: 24px` with `background-color: rgb(255, 255, 255)`
  and `position: absolute`.
- Setting `border-radius: 0` with `pseudo: '::after'` reported `before: 24px`, `after: 0px`; the
  native screenshot then showed the 国内版 pill as a square while 国际版 stayed rounded.
- The override is one marked stylesheet rule on the page instance: no source file changed, and a
  reload/navigation discards it (the panel sends `preview-reset` on `did-navigate`).

## Document-state marker and hover overlay

- The marker is permanent: gray dot + **Original**, or blue dot + **Preview (n)**. Colors are literal
  (`#9aa0a6` / `#0f6cbd`) because the desktop theme's brand token is near-black; geometry matches
  StateDot (10px slot, 6px core), text uses the muted label color and no border.
- Two pseudo-element overrides on `#est_cn` and `#est_en` produced
  `preview: { active: true, count: 2, elements: [{selector:#est_cn, relation:self}, {selector:#est_en, relation:self}] }`;
  the count is distinct elements, not properties, and pseudo targeting does not split an element.
- Hovering the marker sends `style-highlight` to the native guest, which draws one translucent box per
  touched element in a closed shadow root (DevTools-style) and removes it on leave. The overlay path is
  wired to the marker's hover handlers; visual confirmation requires hovering the marker in the panel.

## Footer action trace

- A loopback panel socket listened for `action` events while `webdev_desktop_style` set two properties on
  `#sb_form`. It received:
  `{"tool":"style","summary":"#sb_form · border-radius: 24px → 0px","tone":"preview"}` and
  `{"tool":"style","summary":"#sb_form · width: 975px → 320px","tone":"preview"}`.
- The footer renders rows with `tone: 'preview'` in `#0f6cbd`, the same blue as the Preview dot; the
  panel's own inspector adds local debounced rows through the same shape. The live panel display of the
  blue rows was not captured here (native panel chrome is outside the guest screenshot).

## Pending

- The permanent **Original** / **Preview** document-state marker is rendered by the new client bundle;
  the panel needs one hard refresh (Ctrl+Shift+R) to display it. The host state path was verified above.
