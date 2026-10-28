# The sidebar shows one workspace at a time

Referenced by `packages/openwriter/src/sidebar/workspace-pick.ts`, `Sidebar.tsx`,
`WorkspacePicker.tsx`, `SidebarFiles.tsx`, `SidebarTimeline.tsx`, `SidebarBoard.tsx`, and across
repos by `repo:openwriter-web/client/phone/Home.tsx`.

## Context

The file tree stacked every workspace under one another, and the Timeline's filter defaulted to
"All workspaces". A writer with several workspaces (a book, a newsletter, social posts) scrolled
past the others to reach the one they were working in. The operator called showing everything
noise. A role-play of four actors (a writer with several workspaces, a new writer, a phone writer,
the agent) settled the shape below.

## Current invariants

- **One pick, shared.** Files, Timeline, Board and the web app's phone home read the same pick,
  stored per browser under `ow-workspace-pick`. Its values are a workspace filename or
  `DOCUMENTS` (the documents in no workspace). There is no "all workspaces" view; search covers
  everything and labels each result with its workspace.
- **No picker before the first workspace.** With no workspaces the sidebar lists documents as it
  always did. A remembered pick naming a deleted workspace shows Documents.
- **The pick follows the document the tab opens** (a click, search, a link, the agent's
  `switch_document`): when the open document is not in the pick, the pick moves to its first
  workspace, or Documents. Opening the app keeps the remembered pick. Creating or editing a
  document without opening it never moves the pick.
- **Nothing waits unseen.** A workspace with agent changes waiting has a dot in the picker list,
  and the closed picker shows a dot when any other pick has one.
- **New documents land in the pick.** The + in Files and Timeline creates in the picked workspace,
  or as a loose document under Documents.
- **Moving between workspaces is a right-click "Move to"**, since only one workspace is on screen.
  Dragging still reorders and files within the shown workspace.
- **Board's chip row is the picker.** Choosing a chip picks that workspace and opens it; the back
  button returns to the chips without changing the pick.

## Decision log

### 2026-10-27 — Created
One workspace at a time replaced the stacked tree and the "All workspaces" filter (operator). Left
out: reordering workspaces by drag (they keep their order) and dragging documents between
workspaces (Move to replaces it).

### 2026-10-28 — Workspace type window spacing
Not a picker change: the Workspace type window in the same file got room between each help line
and the field around it (paragraph margin 8px, fields 20px apart).
