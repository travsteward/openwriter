# Per-tab view: a tab moves only when it navigates

## Context

The server holds one live in-memory document (the active doc). Every browser
tab used to mirror it: any switch, from any tab or any agent tool, was
broadcast as `document-switched` to every tab. So one tab opening a doc moved
every other tab, and an agent creating a blank doc moved the user's tab.

Live evidence (2026-09-28): the user was reviewing a chapter draft in Focus
mode. Another agent had opened the OpenWriter UI in a second browser tab to
check a blog post. Each time that tab loaded its doc link, or clicked a doc,
it sent `switch-document`, and the user's tab jumped to the blog post. The
server event log showed every jump as a browser-originated
`ws-switch-document`, and none as an MCP tool. A two-client repro on an
isolated server confirmed it: agent writes to doc B left tab A alone, but a
second tab opening B moved tab A.

A tab that shows a doc other than the live one cannot simply be left alone.
It receives no live agent edits for its doc, so its next autosave would write
stale content over them. That is why the old design moved every tab.

## Current invariants

- **Attached tabs.** `ws.ts` keeps `attached`, the set of tabs showing the
  live doc. Only attached tabs receive the live doc's content messages
  (`node-changes`, `id-rewrites`, `document-reloaded`, `metadata-changed`,
  `title-changed`, external-write conflicts). Global messages (document list,
  pending-docs, activity, spinners) still go to every tab.
- **Who follows a `document-switched`** is the caller's explicit audience:
  - `{ tab }`: a tab's own navigation (WS `switch-document`,
    `create-document`, `create-template`; HTTP create, duplicate, variant,
    open and switch carrying `X-OW-Tab`). Only that tab moves. Other attached
    tabs get `view-detached` and keep their view.
  - `'viewers'` (default): the attached tabs follow the live doc. Used for a
    refresh of the same doc, a rename, and the fallback after the live doc is
    deleted or archived.
  - `'all'`: an explicit "show the user": MCP `switch_document`, MCP
    `open_file`, HTTP open or switch with no tab named, and profile switch.
- **Agent tools never change the live doc** except those explicit shows (and
  the deletion fallback). `create_document` with `empty: true` writes the file
  without switching, like the two-step create.
- **Detached tabs are read-only.** The client makes the editor non-editable,
  shows "This document is open in another tab" with an "Edit here" button,
  and drops live-doc writes (`doc-update`, `pending-resolved`,
  `title-update`). The server independently drops those messages from a
  non-attached tab when they target the live doc. "Edit here" sends
  `switch-document` for the tab's own doc, which reloads it from the server
  and re-attaches.
- **Reconnect never moves a tab.** The WS URL carries `?tab=` and, on
  reconnect, `?view=<filename>`. A tab whose view is the live doc gets fresh
  state and attaches. Any other tab is told it is detached.

## Decision log

### 2026-09-28 — per-tab view replaces "every tab mirrors the live doc"
Chose attach/detach over two alternatives:
- Sending a tab's own switch only to that tab, and nothing else, would stop
  the jump but leave the other tab editing a doc that no longer gets live
  edits. Its autosave would then overwrite agent work.
- A true multi-live-doc server (one in-memory doc per tab) would remove
  detaching entirely, but it rewrites the single-active-doc state model in
  `state.ts`, which is out of scope here.

Detaching keeps the one-live-doc model, makes the stale-write path
unreachable, and costs the user one click when two tabs compete for the
live doc.
