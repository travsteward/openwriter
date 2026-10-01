# Accepting a fix resolves the comments it covers

## Context

The editing loop is: the user leaves comments on a draft, an agent proposes
fixes as pending changes, the user accepts or rejects them. Each accepted
fix left its comment open, so the user had to find and resolve it by hand.
Resolved comments also had no way back from the app.

## Current invariants

- **One rule, shared.** `server/comment-coverage.ts` is pure and has no
  imports, so the browser bundle and the server both use it. The browser
  runs it on single accept and Accept all (`src/decorations/resolve.ts`,
  the only accept path); the server runs it on folder Accept all
  (`batchResolve`).
- **Accept resolves, never deletes.** Covered comments get `resolvedAt`
  through the existing resolve route. Reject never touches comments.
- **Covered means the change touches the comment's words.** A comment is
  attached to a paragraph by `nodeId` / `nodeIds`. For a rewrite, the
  changed span is the text left after the common start and end of the
  original and proposed text; the comment is covered when its words overlap
  that span in either version (the words may be in the original, where the
  fix replaced them, or in the proposal). A pure insertion inside a
  paragraph replaces nothing, so it covers the comments it touches or sits
  next to with only whitespace between; the insertion point is slid left as
  far as it can equally sit, since the common start can run into inserted
  text that begins like what follows. A delete covers every comment on
  the paragraph, an insert covers none, a group covers every comment on
  its original paragraphs, and a rewrite with no original kept covers the
  whole paragraph.
- **Can't place it, leave it open, unless it's alone.** A comment whose
  words are in neither version (reworded earlier, "Wording changed") stays
  open, except when it is the paragraph's only open comment: then the
  rewrite of that paragraph is taken as its fix.
- **Coverage is read before the accept.** Accepting strips the pending
  attrs the rule needs.
- **Resolved comments are restorable.** The Review tab's Comments section
  lists them behind a collapsed "N resolved" toggle, newest first, each
  with Restore (the existing unresolve route). `GET /api/comments/:file`
  returns them only with `?resolved=1`, so the underline and counts are
  unchanged.

## Decision log

### 2026-09-30 — initial build

Chose to detect accepts where they happen (browser accept functions and
server batch resolve) over inferring them server-side from doc-update
diffs: a diff can't tell an accept from a reject-then-type within one
autosave, while the accept call knows exactly what was accepted.

Did not use the pending highlight offsets (`pendingOriginalFrom/To`): they
run from the first changed sentence to the paragraph end, so an untouched
sentence after the fix would have been resolved. Seen live on a test doc;
the text comparison fixed it.

Tested on an isolated server: accepting a fix to "very very tired"
resolved only that comment, leaving one later in the same paragraph and
one in another paragraph open; Restore reopened it; Reject left a comment
open; Accept all resolved the covered one.

### 2026-10-01 — insertions and reworded comments

Two misses seen in use. A fix that inserted a sentence right after the
commented "Pigeons pecking keys for grain." left it open: an insertion has
an empty span in the original, so nothing overlapped. Insertions now count
touching words (whitespace between allowed). This is limited to insertions;
a rewrite still leaves the next sentence open, or every fix would resolve
its neighbours.

A comment already showing "Wording changed" stayed open after a later fix
on its paragraph. When it's the paragraph's only open comment, the fix now
resolves it; with other open comments there we still can't tell which the
fix addresses, so it stays open.

### 2026-10-01 — Resolved underline stayed until reload

Resolve, unresolve and delete work by comment id, and their routes (and
the resolve_comments tool) announced comments-changed for the server's
live doc. A tab refetches comments only for the doc it shows, and with
per-tab views the live doc can be another tab's, so the user's editor kept
the underline of a comment it had just auto-resolved. Seen live while a
second tab held another doc. The three now share one walk that returns the
docs it changed, and callers announce exactly those. Verified with two
tabs: accepting a fix next to a comment cleared its underline while the
server's live doc was the other tab's.
