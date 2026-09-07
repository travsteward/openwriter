# Document identity owns editor history

## Context

PadEditor retains one editor view across document switches to avoid expensive
remounts. Replacing its content kept the previous document in the same Undo
history. Opening A, switching to B, then Undo replaced B with A and autosaved it.
This was reproduced through the browser on isolated fixtures while verifying
manuscript editing drafts.

## Current invariants

- App supplies document identity to every PadEditor surface.
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
