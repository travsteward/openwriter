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
- Revision is a variant role, not a content type. It preserves the source
  writing format; a manuscript compiles into an ordinary document revision.
- Revisions copy accepted text only, with fresh identity, source references,
  review enabled, and an original-copy version. They add no workspace row.
- Migrating an existing draft changes its parent metadata, not its body,
  node identities, comments, pending overlay, or version history.
- Version restore preserves current identity, parent, role, and review preference.

## Decision log

### 2026-09-08 — Isolate variant creation

Moved the existing format-projection operation into `document-variants.ts`
and its unchanged type derivation into `content-type-meta.ts`. HTTP imports
the operation directly, keeping document lifecycle ownership separate and
avoiding a return dependency when revision creation is added. Behavior is
unchanged. This ADR carries the public implementation invariants previously
documented only in the local variant notes.

### 2026-09-08 — Revision reuses the existing variant tree

Added Revision to the existing variant menu. The common creation service handles
ordinary documents and compiled manuscripts; the older create_editing_draft
tool remains a compatibility entry. UI creation opens the child; agent creation
stays background. Existing format conversions keep their field projection.
Legacy type derivation follows the same body-bearing precedence as the editor.
Removed special editing-draft navigation and the separate reader. Focus mode
keeps the ordinary editor available for comments and surgical edits.

A regression restoring a pre-migration snapshot reproduced loss of the new
parent relationship. Restoration now retains current identity/parent/review
fields while restoring the snapshot body exactly, including explicit false
auto-accept settings. The test covers this alongside accepted-only copying,
format retention, source independence, pending edits, and baseline restores.

### 2026-09-08 — Separate expansion from document opening

Variant parents use a leading folder-style chevron beside the unchanged document
icon. Clicking row space or the icon expands/collapses; only the title opens the
parent. Native disclosure and title buttons provide separate keyboard actions.
Existing context menus, rename on the title, drag, and modified multi-selection
retain their behavior. Leaf documents still open from the whole row.
