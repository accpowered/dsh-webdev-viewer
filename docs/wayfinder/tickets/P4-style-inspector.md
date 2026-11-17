---
id: P4
type: prototype
status: blocked
blocked_by: [G1, R7, P1]
owner: null
write_scope: src/client/style/, src/host/style/, tests/style/
---

# P4 — Visual style inspector prototype

## Question

Can a picked element open a compact style inspector, apply common-property overrides live, reset them, and insert a structured before/after quote into the composer — without writing source?

Build a throwaway spike that:

1. Reuses the P1 pick result (element identity/ref).
2. Reads computed styles and shows the v1 property groups.
3. Applies a temporary override (inline style or a plugin-owned rule) and sees it in the screencast.
4. Resets one property and all properties; reload clears overrides.
5. Sends a quote with element identity + each changed property's before/after + the user's note.
6. Handles a second element and a shared edit if the selected design supports it.

## Why it matters

Visual CSS editing is a late addition to v1. A small prototype de-risks the CDP style surface and the quote format before it is folded into the panel.

## Acceptance

- A recorded walkthrough: pick, change color/spacing/font, see the page update, reset, send quote.
- The quote is accepted by the composer and is readable by the agent.
- A reload clears the temporary overrides; the quote still names them.
- No source file is modified by the plugin.
- A go/no-go note in `## Resolution` and the property set that survived the prototype.

## Resolution

<!-- Fill when closed. -->
