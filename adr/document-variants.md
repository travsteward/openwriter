# Document variants

## Context

The editor already groups derivative documents beneath a master using
`masterDocId` and `variantType`. Format variants project existing fields into
the target writing format. The implementation originally lived inside the
large document lifecycle module; its older design notes are local-only.

## Current invariants

- `masterDocId` identifies the parent; children are discovered from document
  metadata and rendered in the existing variant tree.
- `content_type` owns the editor surface. Format variants scaffold that type's
  context rather than inheriting unrelated source contexts.
- Body content always transfers. A title-bearing source projected into a
  body-only format keeps its title in the body.
- A variant has independent identity and content. It does not synchronize
  changes back to its parent.
- Duplicate remains the verbatim-copy operation.

## Decision log

### 2026-09-08 — Isolate variant creation

Moved the existing format-projection operation into `document-variants.ts`
and its unchanged type derivation into `content-type-meta.ts`. HTTP imports
the operation directly, keeping document lifecycle ownership separate and
avoiding a return dependency when revision creation is added. Behavior is
unchanged. This ADR carries the public implementation invariants previously
documented only in the local variant notes.
