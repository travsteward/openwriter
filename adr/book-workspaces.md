# Book behavior belongs to an existing workspace

## Context

A separate Books list above the global Timeline duplicated navigation without
giving the writer a home for the brief, outline, manuscript and source material.
Agent-written schema enrichment describes a workspace and cannot safely enable
product behavior by itself.

## Current invariants

- workspaceType is an explicit General/Book choice. The descriptive schema stays
  independent. There is one workspace creation path and later conversion.
- Book attachments use stable document IDs. The outline is an existing manuscript
  content-type document; its manuscript uses the existing masterDocId relation.
  One candidate can be reused; ambiguous candidates require an explicit choice.
- Pins are a presentation, never a tree move. Switching back to General retains
  attachments, files, folders, pending reviews and original tree positions.
- The brief is an ordinary separate document, never an outline compilation input.
  Existing sources can be linked without rewriting or moving them.
- Agent-boundary guidance resolves actual workspace membership, including nested
  revisions. Shared-book membership remains ambiguous until a workspace is named.
- Only accepted brief text is delivered. A content fingerprint of the brief and
  its directly linked sources refreshes context within the same agent session.
  User-book material stays in the private profile; bundled method is generic.
  A live document uses its canonical in-memory text, so a human edit is visible
  before the save timer. Leaving Book explicitly withdraws its earlier context.
- book.workflow is the writer's choice of how the agent works: guided (the default, also
  for books saved before it existed) or custom. It is the only switch; the brief's How we work section holds the writer's own description,
  never a second setting. It is part of the book context fingerprint, so a change reaches
  the agent at its next touch. The agent sets it only at the writer's word.

## Decision log

### 2026-10-16

Extended the workspace with explicit type and book attachments. Reused the
outline/manuscript relation instead of creating another book model. The UI offers
the same type settings from right-click and a visible menu button. Generic book
method uses the existing versioned guidance envelope; private direction arrives
from the attached brief, separately from the tool's original result.

### 2026-11-01

configure_book_workspace takes createBrief and createOutline, which call the same
createWorkspaceBrief and createWorkspaceOutline as the Workspace type dialog, so
an agent starting a book makes the identical scaffold rather than a hand-made
second format. Book context now ends with the writer's voice status on every
touch, outside the brief fingerprint, since Learn my voice changes it outside
the book.

The empty brief gains a How we work section between Voice and form and Author
decisions: the arrangement the writer chose (who writes the prose, how they plan,
how they review), which later sessions follow. It is the one place that choice
lives, so the generic guidance can stay non-prescriptive.

### 2026-11-01 — The writer picks guided or leading

Operator: most writers have no method of their own, so the operator's method is the
default, switchable per book. A role-play of a brand-new writer whose agent creates the
book placed it: the Workspace type dialog alone is never opened (the agent did the
setup), so the agent says it in one line when it starts the book, the pins show "Step by
step · Change" or "Your way · Change", and Change opens the dialog, titled Book settings
for a book, at two choices. Stored as book.method beside the attachments; absent means
guided so existing books keep the method. The brief's How we work stops being the
switch (the previous entry) and keeps only the writer's own description. The voice
status repeats only when it changed for the session, since it was noise on every touch
for a writer who writes their own prose.

### 2026-11-01 — Workflow: Guided / Custom

Operator: settings are named the way software names options, not as first-person
phrases. The choice is now a Workflow setting with Guided and Custom, stored as
book.workflow ('guided' | 'custom') and set through configure_book_workspace workflow.
It replaces book.method ('guided' | 'writer') from 0.53.0, shipped the same day; a
stored method is ignored and the book reads as Guided. The pins line reads
"Workflow: Guided · Change".
