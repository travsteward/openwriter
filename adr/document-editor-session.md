# Document identity owns editor history

## Context

PadEditor retains one editor view across document switches to avoid expensive
remounts. Replacing its content kept the previous document in the same Undo
history. Opening A, switching to B, then Undo replaced B with A and autosaved it.
This was reproduced through the browser on isolated fixtures while verifying
manuscript editing drafts.

## Current invariants

- App supplies stable metadata docId to every PadEditor surface, using filename
  only when old metadata has no ID.
- On an identity change, the editor view stays mounted but receives a fresh
  EditorState containing the new document and the same plugin definitions.
  History, selection, and other document-scoped plugin state start fresh.
- Same-document content updates retain the existing editing session.
- Resetting state dispatches no body change and cannot autosave old content.
- Versions remains the cross-session restore mechanism.

## Decision log

- **2026-09-07** — Isolated EditorState at document switches. Clearing or closing
  a history event alone would leave document-specific plugin state coupled to
  the previous body; resetting the state preserves the performance benefit of
  the stable view while giving each document its own editing session.

- **2026-09-07 — Rename safety.** Browser verification caught the initial caller
  passing filename as identity. Auto-title promotion changed it while the silent
  rename retained the old initialContent prop, resetting the view to its initial
  empty body. All five PadEditor surfaces now use stable docId. New-document
  typing, promotion, Undo to empty, and Redo to the typed text passed together.
