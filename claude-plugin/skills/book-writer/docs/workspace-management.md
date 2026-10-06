# Workspace Management

Conventions for organizing book-scale projects in OpenWriter (or any doc workspace). Applies to all long-form non-fiction and fiction work. The default container hierarchy + naming convention + rename discipline below prevents the mess that emerges when chapter beats, drafts, and meta docs accumulate without architecture.

This doc is loaded as part of any book-scale orchestration. Pairs with `docs/chapter-architecture.md` (which produces the chapter-container shape) and `docs/book-mode.md` (which integrates the workspace into the writing flow).

## The container hierarchy (v2 lock 2026-05-20: chapter-first)

```
<Book Title> (workspace)
├── Book Spine                       — architectural / meta docs (project-level)
├── Working Notes                    — scratch, pilot tests, open questions (project-level)
├── Ch 1 — <Title>/                  — chapter container
│   ├── Ch 1 — Beats: <Title>        — beats doc (loose in chapter container)
│   ├── Ch 1 — Research Notes        — citations (loose in chapter container)
│   └── Drafts/                      — sub-container for per-beat prose docs
│       ├── Ch 1 — B1: <Name>        — one prose doc per beat
│       ├── Ch 1 — B2: <Name>
│       └── ...
├── Ch 2 — <Title>/
│   ├── Ch 2 — Beats: <Title>
│   ├── Ch 2 — Research Notes
│   └── Drafts/
└── Ch 3 — <Title>/ ...
```

### Why chapter-first (supersedes the lifecycle-grouped v1)

- **Chapter is the natural mental unit.** Day-to-day work is "I'm working on Ch X" — everything for that chapter lives in one place.
- **Drafts sub-container scales with per-beat dispatches.** Each chapter accumulates 15-25 prose docs (one per flat beat per `docs/beats.md`). A flat sidebar would become unscannable; the sub-container contains it.
- **Beats + Research Notes stay loose inside chapter container** because each is single-doc per chapter — sub-container would be over-engineered.
- **Book-level docs (Book Spine, Working Notes) stay top-level** because they're cross-chapter.

### Container responsibilities

| Container | What lives here | Lifecycle |
|---|---|---|
| **Book Spine** (top-level) | TOC, Argument Arc, Global Beat Sheet, Thesis, Voice & Form, Audience & Reader Journey, Decisions Log, Source Material, Open Questions, Concept Dump, Introduction draft. | Stable. Edits rare after lock. |
| **Working Notes** (top-level) | Pilot prose tests, scratch, ad-hoc analysis, brainstorm dumps, transient experiments. | Ephemeral. Promote or delete when done. |
| **Ch N — <Title>** (per chapter) | The chapter's beats doc + research notes doc, plus the Drafts sub-container. | Active for the chapter's lifecycle. |
| **Drafts** (sub-container of each chapter) | One `Ch N — Bk: <Name>` doc per flat beat (e.g., `Ch 2 — B6: Sleep cycles`). | Accumulates as beats get dispatched via /authors-voice. |

## Ascending-order convention (locked)

**All ordered lists in the sidebar go ascending top to bottom.** Ch 1 at top, Ch 2 below, Ch N at bottom. Same rule for beat-prose docs inside Drafts (B1, B2, B3...). Same rule for any future numbered grouping.

Project-level containers (Book Spine, Working Notes) sit above the chapter containers. Within each chapter container: Beats doc → Research Notes → Drafts sub-container (creation order is fine; chapter materials are few).

When inserting / reordering / renumbering, fix the sidebar order in the same pass — newest-first is wrong default.

## v1 deprecation note

The previous lifecycle-grouped scheme (`Chapter Beats` / `Chapter Drafts` / `Research Notes` as flat top-level containers, all chapters' docs mixed by type) is deprecated. It broke down at the per-beat-dispatch density that flat-beat methodology produces (15-25 prose docs per chapter × 11 chapters = 165-275 docs in one `Chapter Drafts` container — unscannable). Existing v1 workspaces migrate by: create chapter containers, create Drafts sub-containers, move docs, delete the old flat containers.

## Doc naming convention

Per-chapter docs follow this exact pattern:

| Doc type | Filename pattern | Example |
|---|---|---|
| Beats | `Ch N — Beats: <Chapter Title>` | `Ch 1 — Beats: Circadian Rhythms (The Body Clock)` |
| Per-beat prose | `Ch N — Bk: <Beat Name>` | `Ch 2 — B6: Sleep cycles` |
| Research notes | `Ch N — Research Notes` | `Ch 3 — Research Notes` |

**Per-beat prose docs are the dispatch unit** (see `docs/beats.md` flat-beat convention). Each beat from the chapter beats doc gets its own prose doc in `Ch N/Drafts/`. Naming maps 1:1: beat `B6` in the beats doc → prose doc `Ch N — B6: <Name>`. When beat numbering changes in the beats doc, the prose doc renames in the same pass.

Architectural docs (Book Spine container) use natural names without `Ch N` prefix: `Argument Arc`, `Thesis`, `Voice & Form`, `Candidate TOC`, `Decisions Log`, etc.

Working notes use descriptive natural names: `Pilot Prose Tests`, `Open Questions`, `Concept Dump`.

### Rules

1. **Chapter number comes first** in the filename so the sidebar sorts numerically.
2. **Chapter title appears in the beats and draft filenames** so the doc is findable without opening it. Research notes drop the title for compactness (the chapter number is enough).
3. **Title format follows the substantive-name rule from `docs/chapter-architecture.md`** — declarative or descriptive, telegraphs content, holdable in one sentence. "The Ascent" fails; "Sleep Across the Lifespan" works.

## Rename discipline (load-bearing rule)

When a chapter renumbers (insert, delete, reorder, merge, split), the cascade is:

1. **All three docs for that chapter rename together.** Beats doc, draft doc, and research notes doc. Renaming only the beats doc orphans the others.
2. **Container memberships audit.** If renumbering moves a doc out of its lifecycle (e.g., a chapter gets absorbed into another), move it to the right container before renaming.
3. **All chapter-numbered docs DOWNSTREAM also renumber** if an insertion is happening (e.g., new Ch 1 inserted means old Ch 1 → Ch 2, old Ch 2 → Ch 3, all the way down).
4. **Update the TOC** (in Book Spine) in the same pass.
5. **Update cross-references** in Argument Arc, Global Beat Sheet, Decisions Log if any chapter number is hardcoded.

**Anti-pattern observed in the wild:** creating a new beats doc for a new chapter in one container while the old (now-renumbered) beats doc sits in a different container with its now-wrong name. Produces an unscannable sidebar with no clear hierarchy. The architecture lost its shape.

The fix when this happens: rename + move every affected doc in one structural-cleanup pass. Don't leave intermediate orphan state across a session boundary.

## Creation discipline

When creating a new chapter beats doc:
1. `create_document` with the proper `Ch N — Beats: <Title>` filename
2. Place in `Chapter Beats` container at creation (via `container` parameter on `create_document`)
3. Add the corresponding empty draft doc in `Chapter Drafts` and empty research-notes doc in `Research Notes` at the same time, OR defer their creation until the beat work locks (your call — but if deferred, track it as a TODO)

When creating ad-hoc working docs (pilot tests, scratch analysis):
1. Place in `Working Notes` container at creation
2. Use a descriptive natural name (no `Ch N` prefix unless the doc is genuinely chapter-scoped scratch)
3. Either promote to the right container when the doc earns its keep, or delete when its purpose is served

## The "where is this doc" test

The author should be able to answer "where is X doc" in one second by knowing the doc type:
- Beats doc → Chapter Beats container, sorted by `Ch N`
- Draft → Chapter Drafts container, sorted by `Ch N`
- Research → Research Notes container, sorted by `Ch N`
- Architectural → Book Spine, alphabetical or by stable conventional order (Thesis → Audience → Voice → TOC → Arc → Beat Sheet → Decisions → Source → Open Q → Concept Dump)
- Scratch / pilot → Working Notes

If the author has to ask "where did the agent put this," the convention has been violated.

## When the convention shouldn't apply

- Single-chapter projects or essays: one workspace, no chapter containers, just docs at root.
- Multi-book projects: separate workspace per book; this convention applies inside each workspace.
- Fiction with heavy character/setting/world-building load: add a `World Bible` container alongside `Book Spine` for character sheets, setting docs, glossary, timeline.
- Anthology-style books (independent essays under one cover): each essay is one doc in a single `Essays` container; no per-essay sub-docs needed.

## Loaded by

- `docs/long-form-orchestration.md` (book-scale orchestration entry point)
- `docs/book-mode.md` (per-session book-writing workflow)
- `docs/chapter-architecture.md` (chapter-container commit produces the structure this doc organizes)

When any of those load, this doc loads with them.
