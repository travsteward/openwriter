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

- **Every tab has a view.** `ws.ts` keeps `views`, tab to the doc it shows.
  The server's single live doc is a cache: a tab's write (`doc-update`,
  `pending-resolved`, `title-update`) for a doc that is not live first
  switches the server to that doc, then applies. There is no attach, detach
  or read-only state.
- **Live doc content messages** (`node-changes`, `id-rewrites`,
  `document-reloaded`, `metadata-changed`, `title-changed`, external-write
  conflicts) go to the tabs viewing the live doc. Global messages (document
  list, pending-docs, activity, spinners) go to every tab.
- **Other viewers update in the background.** After a tab write, every other
  tab viewing that doc gets the full doc as `document-switched` with
  navigation `refresh` (not a navigation, so no scroll or sidebar reveal). A
  disk write to a doc that is not live (agent tools, accept-all flush,
  pending strip) is pushed the same way, loaded from disk, via
  `onDocFileWritten` in `state.ts`.
- **Revision guard.** Each doc has a revision and the tab that set it. Every
  `document-switched` carries the revision; the client stamps it on each
  write. A write whose revision is not current, from a tab that did not make
  the current revision, is refused: the tab gets the latest copy and a notice
  that its last change was not saved. So a stale tab can never autosave over
  newer work. Agent edits to the live doc still go through the docVersion
  merge path, which bumps the revision for the other viewers.
- **Who follows a `document-switched`** is the caller's explicit audience:
  - `{ tab }`: a tab's own navigation (WS `switch-document`,
    `create-document`, `create-template`; HTTP create, duplicate, variant,
    open and switch carrying `X-OW-Tab`, and a first connect with `?open=`).
    Only that tab moves. Other tabs keep their view.
  - `'viewers'` (default): the tabs viewing the live doc follow it. Used for
    a refresh of the same doc, a rename, and the fallback after the live doc
    is deleted or archived.
  - `'all'`: an explicit "show the user": MCP `switch_document`, MCP
    `open_file`, HTTP open or switch with no tab named, and profile switch.
- **Agent tools never change the live doc** except those explicit shows (and
  the deletion fallback). `create_document` with `empty: true` writes the file
  without switching, like the two-step create.
- **Reconnect never moves a tab.** The WS URL carries `?tab=` and, on
  reconnect, `?view=<filename>`. The server makes that doc live if needed and
  sends it with its current revision.

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

### 2026-09-29 — a doc link opens its doc in the handshake
A fresh page on `/d/<docId>` sent `switch-document` from a mount effect, before
the WebSocket was open. `sendMessage` drops messages on a closed socket, so the
switch was lost and the on-connect message delivered the live doc instead; the
URL then flipped to that doc. A user accepted all changes in the wrong doc this
way. The page now sends `?open=<docId>` on its first connect only. The server
resolves it and opens that doc with audience `{ tab }`, the same as the tab's
own `switch-document`: other attached tabs are detached, not moved. Reconnects
still carry `?view=` and never use `open`. An unknown docId falls back to the
live doc. The mount effect keeps only the scroll target and sidebar reveal.

### 2026-09-29 — nothing sent while disconnected is silently lost
`sendMessage` dropped every message sent while the socket was closed. Now it
reports whether a message went out, and queues the rest: navigations (only the
latest is kept) and review actions like `pending-resolved` are replayed after
the server's first message on the new connection, `document-switched` or
`view-detached`, so they reach the right view. `doc-update` is never queued,
because it is a full snapshot and a stale one could overwrite newer work.
Instead the tab keeps its unsent edits across the reconnect when the server's
copy equals what the tab last sent (compared without the editor's null
attributes), resends them at once, and otherwise takes the server's copy and
shows a warning. The diff baseline only advances when a send succeeded. This
needed the server's startup lock removed (adr/agent-lock-per-doc.md).

### 2026-09-29 — a detached tab refuses changes instead of faking them
Read-only mode only stops typing. Accept all, Reject and focus-mode review
change the editor by command, so in a detached tab they still rewrote the
page, while every save was dropped because the tab is detached. The user saw
21 rewrites accepted; none reached the server. Seen live: a doc link opened in
a new tab took the live doc, detaching the review tab. A detached tab now
refuses every document change and shows "Click Edit here", checked against
the same flag that drops the saves, so the page can never show work that is
not saved. The flag clears before the server's copy arrives on "Edit here",
so re-attaching is unaffected.

### 2026-09-29 — live tabs replace attach/detach
The detached state kept failing the user: a doc link in a new tab detached the
review tab, and "Edit here" was one more thing to notice. The user asked for
any tab to act on its own doc, with other tabs showing that doc changing in
the background, and no focus concept. The server now treats its live doc as a
cache that follows whichever tab or agent writes, pushes each change to the
other viewers, and guards every tab write with a per-doc revision so a stale
tab's autosave is refused instead of overwriting newer work. Tested on an
isolated server: two tabs on different docs both save, a background tab sees
another tab's edits and an agent's pending insert, accept-all from a tab whose
doc is not live persists to disk and clears the sidecar, and a replayed stale
save is refused with the notice while the newer text stays.
