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

### 2026-09-07

Extracted the archive lifecycle from documents.ts before changing it. Placement
capture and restoration use the workspace module's existing path validation and
tree operations. The browser exposes restoration as an explicit action.
