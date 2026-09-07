# Search results belong to their query

## Context

Debouncing did not retire requests already in flight. An old response could
replace a newer query's results. Passage hits opened only the document, and
archived rows silently restored rather than opening.

## Current invariants

- Query change and clearing abort and retire outstanding work immediately.
  Only the current request can render results or an error.
- Loading is explicit; old results cannot be activated under a new query.
- Document-set changes rerun the current search, including restoration.
- Content results carry a document-specific passage request. The editor waits
  for that document, then selects and reveals the match, including same-document
  navigation and case-insensitive queries.
- Archived results have an explicit Restore button and refresh on acknowledgment.
- Native result buttons and keyboard-enabled rows provide Enter/Space activation,
  arrow navigation, Escape dismissal, and folder expansion state.

## Decision log

### 2026-09-07

Centralized request ownership in useDocumentSearch and shared result behavior
across modes. Passage navigation reuses the document-link route with a fresh
request sequence so an already-open target still receives navigation.
