# Reading in the existing Focus editor

## Context

Editor tabs and agents share active-document state. Opening a second editor to
compare sources navigated the first editor too, without explaining why. Changing
that model would require scoping every write, review, export, and plugin action.

## Current invariants

- Reading uses the normal editor in Focus mode, retaining selections, comments,
  pending review, and editing. There is no separate read-only renderer.
- Old `/read/:docId` links resolve the stable ID and redirect to
  `/d/:docId?focus=1`; missing documents return 404.
- The editor consumes the Focus request once and uses its existing panel
  transition. Shared active-document navigation is unchanged.

## Decision log

### 2026-09-07

Chose the audit's explicit shared-editor/independent-view contract. Native links
support keyboard activation, copying addresses, and browser tabs without an
asynchronous popup mechanism or changes to agent collaboration.

### 2026-09-08 — Consolidate into Focus mode

The separate reader prevented the author from marking passages for an agent.
Removed that renderer and its titlebar link/Shared label. The existing editor
now serves reading and manipulation together; old links enter Focus mode.
This does not add independent per-tab editor state.
