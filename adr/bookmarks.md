# Bookmarks: private paragraph markers

## Context

While editing a long revision draft the user wants to stop and later return to
exact places, each with a note to self. Comments already exist, but they are
addressed to agents and get resolved; a place marker is for the user only and
stays until the user removes it.

## Current invariants

- A bookmark attaches to a paragraph's node ID, never to a position or a text
  match. Node identity carries it through edits above and around it.
- One bookmark per paragraph. Adding to an already-bookmarked paragraph
  updates that bookmark's note.
- Storage is a sidecar at `_bookmarks/{filename}.json` under the profile data
  dir, moved on rename next to the comments sidecar. The `.md` file never
  contains bookmarks.
- Bookmarks are browser-only. No MCP tool reads or writes them, so agents never
  see or act on them.
- The editor draws them only as decorations (margin icon, jump highlight).
  Adding, editing or removing a bookmark never changes the document or its
  undo history.
- The client keeps one shared list for the active filename. The right-click
  menu, the margin icons and the Review rail section all read it. The server
  sends a global `bookmarks-changed` message, and each tab refetches only when
  it shows that file.
- Right-click targets the paragraph under the pointer, not the prior cursor
  selection that comments use.
- Bookmarks are few, so the rail has no stepping for them: a "Back to
  bookmark" button at the top of the Review tab jumps to the newest one.
  Comments are many, so their rail section steps previous/next with no
  list; the underline's hover shows each one. Only a reworded (unplaced)
  comment shows its note and a Resolve button, since it has no underline.
- Bookmark and comment jumps share one path (`jumpToBlock`), and its
  highlight is drawn by the bookmark plugin for any block.

## Decision log

### 2026-09-30 — Initial implementation

Right-click "Add bookmark" on any paragraph puts an icon in the left margin
(left of the pending-change bar) with an optional note. The Review tab lists
bookmarks in reading order below the approval controls, or under "All caught
up" when nothing is pending, with previous/next stepping like pending changes.
Clicking the margin icon edits or removes it. Several bookmarks per doc are
allowed. The jump highlight is a decoration because ProseMirror redraws away
classes set directly on its DOM. Verified on an isolated server: add, a note,
an insert between two bookmarks, reload persistence, stepping with wraparound,
margin-icon edit, removal, and a clean `.md` file.

### 2026-09-30 — Bookmark items on the comment menu

Right-clicking commented text opens the comment-only menu, which offered no
bookmark items, so a paragraph could not be bookmarked from its commented
words. The comment menu now appends the same bookmark items the main menu
builds. Verified on an isolated server: add from commented text, then
Edit/Remove offered, comment intact.

### 2026-09-30 — Quick return and comment navigation

Bookmarks proved low-volume, so their previous/next arrows were replaced by a
one-click "Back to bookmark" button at the top of the Review tab (newest
bookmark, hidden when none). Comments gained a Review section with
previous/next stepping and a scrolling list, above Bookmarks. The jump helper
and highlight were generalized from bookmarked blocks to any block so both
lists use them. Verified on an isolated server: return button targets the
newest bookmark, comments list in reading order, stepping wraps, and each jump
highlights the referenced block.

### 2026-09-30 — Rail uses the editor's comment placement

A comment whose quoted words were later reworded had no underline, but the
rail found its paragraph by node ID and listed it as normal, with no way to
resolve it (resolve lives on the underline). The rail now asks the comment
plugin where it underlines each comment (`locateComment`, the same matching
the decorations use), so the two can never disagree. Unplaced comments show
"Wording changed", jump to their paragraph when it exists, and carry their own
Resolve button.

### 2026-09-30 — Comments: arrows only

The comment list cluttered the rail; the user reads comments by hovering the
underline. The section is now just previous/next and a counter. The one line
kept: when the current comment is unplaced, its note and Resolve appear under
the arrows, because it has no underline to hover or right-click. Verified on
an isolated server: no list, stale line only on the reworded comment, Resolve
drops the count, the placed comment keeps its underline.

### 2026-09-30 — Resolved comments behind a toggle

The Comments section now also shows a collapsed "N resolved" toggle that
expands to the resolved comments, each with Restore. Collapsed by default so
the section stays arrows-only. See adr/comment-auto-resolve.md.
