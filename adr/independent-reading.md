# Independent reading alongside a shared editor

## Context

Editor tabs and agents share active-document state. Opening a second editor to
compare sources navigated the first editor too, without explaining why. Changing
that model would require scoping every write, review, export, and plugin action.

## Current invariants

- The editor labels its shared-session behavior and links to independent reading.
- Reading uses stable IDs, accepts no writes, and opens no WebSocket. Document
  links navigate to reading views without moving the shared editor.
- Reading shows accepted text; refresh reads current content. Background editor
  navigation cannot replace the reading document.
- Editing is an explicit link back to the shared editor.
- Raw document HTML is not executed in the reading page.

## Decision log

### 2026-09-07

Chose the audit's explicit shared-editor/independent-view contract. Native links
support keyboard activation, copying addresses, and browser tabs without an
asynchronous popup mechanism or changes to agent collaboration.
