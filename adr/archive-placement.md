# Archive retains document placement

## Context

Archiving removed workspace references without recording them. Restore could
only clear the archived flag, leaving the document unassigned.

## Current invariants

- Archive captures each workspace, parent container identity, sibling position,
  and complete document item before removing the item from active trees.
- The snapshot travels in document metadata until restoration succeeds.
- Repeated archive requests retain the original snapshot.
- Restore uses stable container IDs, preserves child folders, and avoids
  duplicate references. If a destination disappeared, it uses the surviving
  workspace root or Documents and reports that fallback.
- Old archives without placement information remain restorable to Documents.
- Archive does not retire document identity or pending sidecars.

## Decision log

### 2026-10-16

Book workspace settings reuse the workspace writer and leave the tree intact.
Archived or removed attachments do not resolve as active pins; their documents
and original archive placements remain governed by this lifecycle.

### 2026-09-07

Extracted the archive lifecycle from documents.ts before changing it. Placement
capture and restoration use the workspace module's existing path validation and
tree operations. The browser exposes restoration as an explicit action.

### 2026-11-01

Not an archive change: renameWorkspace in the same module now refuses a missing or
blank title, since a rename request without one used to save the workspace with no
title at all.
