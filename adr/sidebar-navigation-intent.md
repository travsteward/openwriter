# Editor fallback preserves sidebar location

## Context

Deleting the open document selects a remaining document in the editor. The
sidebar previously treated that fallback as deliberate navigation and expanded
and scrolled to the replacement, pulling users away from the folder being cleaned.

## Current invariants

- A browser deletion fallback updates editor content and the active-row marker,
  but does not expand folders, scroll, or pulse a sidebar row.
- The document-switched message carries navigation intent. The browser delivers
  it before updating active document state, so delayed workspace refreshes cannot
  undo the preserved location.
- Ordinary opens, initial loading, and explicitly directed reveals retain their
  existing behavior. Preserving location ends with the next deliberate navigation.
- Deletion target selection and document persistence are unchanged.

## Decision log

### 2026-09-07 — distinguish deletion fallback from navigation

The browser DELETE route marks its resulting document switch as `fallback`.
The shared sidebar reveal hook owns the policy across all sidebar modes and
cancels any pending reveal of the removed document. This replaces the assumption
that every active-document change should navigate the tree; it does not infer
deletion from timing or a transiently missing document-list entry.
