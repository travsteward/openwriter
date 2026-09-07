# Sidebar mutations require acknowledgment

## Context

The sidebar removed records before DELETE completed. HTTP rejection resolved the
fetch promise, bypassing its catch; a pending-delete filter then hid the real
document indefinitely. Other optimistic actions had the same failure contract.

## Current invariants

- Sidebar CRUD and tag actions keep the acknowledged view until the server
  accepts the mutation. Both network failures and HTTP rejection produce errors.
- Accepted mutations refresh the affected document/workspace projection.
- A refresh failure is reported separately from a failed mutation.
- Only the latest projection request can replace current UI data.
- No client tombstone can hide a document the server still owns.

## Decision log

### 2026-09-07

Removed the optimistic mutation/rollback split in favor of one checked request
contract. This reduces state ownership while keeping server broadcasts and local
acknowledgment refreshes compatible during concurrent operations.
