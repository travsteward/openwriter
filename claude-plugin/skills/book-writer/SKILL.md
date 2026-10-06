---
name: book-writer
description: |
  Orchestration skill for book-scale long-form writing (fiction or
  nonfiction). Owns the SHAPE of a book project — chapter architecture,
  beats methodology, workspace management, book mode, scene/science
  split, vignette library, long-form orchestration. Delegates VOICE
  (prose generation) to /authors-voice via the Apply Protocol minion
  dispatch. Loads as governing context at session start when a book
  project is detected, OR via explicit invocation.

  Use when: "/book-writer", "/book", "write a book", "book project",
  "chapter beats", "chapter architecture", "beat map", "TOC", "table
  of contents", "book outline", "book reshape", "draft a chapter",
  "long-form", "multi-chapter", "book mode", "book workspace", any work
  involving multi-chapter book structure.

  NOT for: single-chapter essays, blog posts, tweets — those go to
  /authors-voice directly. Voice-only setup (anchor blend, NEVER rules,
  fingerprints, corpus analysis) lives in /authors-voice.
metadata:
  author: travsteward
  version: "0.4.0"
license: MIT
---

# Book Writer

Book-scale orchestration skill. Pairs with `/authors-voice` (voice pipeline). Together: this skill specifies WHAT must land in each beat; `/authors-voice` specifies HOW the prose sounds.

## FIRM RULES

**BOOK HAS A CANON DOC OR CANON SKILL? LOAD IT FIRST.** If the book keeps a canon (settled facts, known corrections, the author's ruled positions) as a doc in Book Spine or as its own skill, load it before any work and paste its corrections and positions into every agent packet.

### 0. Author owns substance. The agent QUERIES — it does not propose from cold.

The load-bearing rule. It governs every book-start, not just beat work, and it is stated here (not only in `docs/beats.md`) so it is in context the moment any book begins. **Author owns substance + beat material; the agent owns process + shape.**

On ANY book-start intent — "write a book", "start writing it", "start a book project", "draft a chapter" — the substance comes OUT of the author before any beats or prose exist. The default is to QUERY, never to manufacture:

- **Every book (and every chapter) begins with the author DUMP** (`docs/beats.md` → 5-pass, Pass 1): the author brain-dumps the material; the agent captures it verbatim, then structures it. No beats, no chapter shape, and no prose exist before the author has dumped.
- **Never propose beats from cold** — mined from the premise, source docs, or the agent's own intuition. The documented failure mode: the author rejects them because they came from outside the author's brain. Pull the material out of the author with focused questions; structure what comes back.
- The agent proposes only in the narrow documented cases (`docs/beats.md` → "When proposing IS the right move"): the author explicitly asks for candidates, the agent is mechanically restructuring source the author already owns, or the author has said move fast on low-stakes draft work. Anything the agent originates this way is shown to the author as a proposal — the agent never calls its own output "locked."

If you reach for beats or prose and the author has not dumped the material, you have skipped step one. **STOP and run the dump.**

Full method: `docs/beats.md` (Query-first principle + the 5-pass extraction). Fiction runs the scene-shaped fork of the same 5-pass — `docs/beats-fiction.md`.

### 1. Book orchestration loads BEFORE per-chapter work.

The book-class question, chapter architecture, and workspace management must commit before any per-chapter beat work begins. Per-chapter beats without committed chapter containers land in arbitrary places, spill across boundaries, and produce a book the reader can't carry.

If the user asks for chapter-level work and the book hasn't run through architecture: **STOP** and run architecture first. Architecture passes are cheap; beat work in wrong containers is expensive.

**Whole-book beat-shape locks before any drafting (default, author-overridable).** Complete and lock every chapter's beats across the entire book before the prose draft pass begins. Finish the shape, then draft and polish. Drafting against an unlocked global shape risks rework when a later chapter forces a structural change upstream. The author may override per request (e.g. draft a pilot chapter early to validate voice), but the default is shape-complete-first.

**Beats lock only when dump-shaped, never when manufactured.** A chapter's beats may be ratified (locked) only when they originate from a genuine author brain-dump (Pass 1 of the 5-pass) — the author's own enumeration of the material. Beats an agent manufactured from pre-existing docs (old drafts, concept docs, the architectural brief) are a DRAFT, not a lock, no matter how coherent they read. Coherence is not authorship. If a chapter has no dump doc and the author does not recall dumping it, run a real dump before locking. The dump is the authorship gate.

### 2. Prose generation always delegates to /authors-voice.

This skill owns SHAPE — chapter containers, beats, workspace organization, vignette slots, the TASK brief. `/authors-voice` owns VOICE — anchor blend, NEVER rules, fingerprints, minion dispatch, post-write audit. When a chapter draft or any prose pour is needed, this skill's job ends at "the brief is locked"; the prose call goes through `/authors-voice`'s Apply Protocol with the brief as the TASK.

**If this skill catches itself drafting prose: STOP and spawn a authors-voice minion** — even for one sentence, one transition, one closer. Same Rule 1 as authors-voice, applied at the orchestration layer.

Two carve-outs (mirroring authors-voice):
- **Beat structure text** (declarative claim names, commitment paragraphs, chapter briefs, vignette slot descriptions) is editor territory — these are commitments, not prose.
- **Doc metadata** (frontmatter, structural flags, reshape history entries, source provenance notes, TODO lists) is editor territory.

### 3. Workspace management is enforced at creation, not retrofitted.

Every doc created during book work goes into its lifecycle-correct container at creation time. Per `docs/workspace-management.md` (v2 chapter-first lock 2026-05-20):
- **Book Spine** (top-level) — architectural docs (Thesis, TOC, Argument Arc, Voice & Form, etc.)
- **Working Notes** (top-level) — scratch, pilot tests, ephemera
- **Ch N — <Title>** (one container per chapter) — holds the chapter's Beats doc + Research Notes doc + a Drafts sub-container
- **Drafts** (sub-container under each chapter) — one per-beat prose doc (`Ch N — Bk: <Name>`)

**Ascending-order convention:** sidebar containers and ordered doc lists go ascending top-to-bottom (Ch 1 at top, Ch N at bottom; B1 at top, BN at bottom). Fix sidebar order in the same pass as any insert/reorder.

Creating in the wrong container, skipping the container parameter, or leaving newest-first ordering produces sidebar mess that takes a full pass to clean up.

### 4. Catalogue citations in `Ch N — Research Notes` as you find them.

Every chapter has a Research Notes doc alongside Beats. Sources land there the moment you find them — academic citations, URLs, supporting data, key quotes. Beats docs reference Research Notes by docId; never inline citations. Catalogue during build, not at the end.

### 5. Every doc-to-doc reference is declared via `link_to` at create/edit time.

When any workspace doc draws from another workspace doc, call `link_to(source_doc_id, target_doc_id)` at the moment the connection is made. Writes the target into the source's `references:` frontmatter — metadata only, no prose mutation. Idempotent. The target's inbound list (backlinks) is computed live by scanning every doc's references, so the target picks the connection up without any work on its end.

Applies to:
- **Every beat-prose draft** → links to its Beats doc + Research Notes + any Concept doc whose content it draws on.
- **Every Beats doc** → links to its Research Notes + every Concept doc it references + sibling chapter Beats it does callbacks to.
- **Every Research Notes doc** → links to every Concept doc it cites in the source list.
- **Any later edit that pulls in a new Concept doc** → link in the same pass as the edit lands.

**External references** (papers, DOIs, web URLs) stay inline markdown `[Author Year, Journal](URL)` in Research Notes. They don't need `link_to` — backlinks are an internal-workspace primitive.

If the editor skips `link_to` as the workspace fills in, the graph drifts. Downstream context-recovery crawls (`get_graph`) miss load-bearing connections, and the agent loses the ability to walk from a chapter back to its concept sources or its sibling chapter beats.

## The book-class question (run FIRST, every book project)

Before any chapter work, answer two questions:

### Question 1 — Fiction or nonfiction?

| Signal | Class |
|---|---|
| Narrative, scene-structured, character-driven | Fiction |
| Argument, mechanism, evidence, source-material-driven | Nonfiction |
| Memoir / personal essay collection | Nonfiction (treat as domain-driven, the domains are life-themes) |
| Hybrid (Sebastian Junger, John McPhee — narrative nonfiction) | Nonfiction with fiction-style scene structure inside chapters |

### Question 2 — Nonfiction only: argument-driven or domain-driven?

Detail in `docs/chapter-architecture.md` (the book-class question section runs the full decision logic). Quick form:

| Signal | Class |
|---|---|
| Author has one extended argument to make; no rich knowledge graph yet | Argument-driven |
| Author has concept docs / research notes / prior drafts / a domain library | Domain-driven |
| Prescriptive transformation popular science | Domain-driven default |
| One big idea unpacked | Argument-driven |
| "Complete picture of X domain" | Domain-driven |

**Fiction handling:** fiction runs the **scene-shaped fork** of the same methodology — `docs/beats-fiction.md`. The beat unit changes from a declarative CLAIM to a SCENE (who wants what, what blocks it, how the value turns), and two of the 5 passes read on that unit (DRIVE, CATEGORY). Everything else is shared with nonfiction `docs/beats.md`: author owns substance + beat material, the agent QUERIES, the DUMP comes first, one beat = one dispatch, prose pours through /authors-voice. At the book-class question, fiction → `docs/beats-fiction.md`; nonfiction → `docs/beats.md`.

## Architecture

```
book-writer/
├── SKILL.md                       (this file — router + firm rules + book-class question)
└── docs/                          (loaded on routing match)
    ├── chapter-architecture.md    (chunk-to-container commit; substantive-name rule; 2 pipelines)
    ├── beats.md                   (per-chapter beat methodology; nonfiction default — declarative claims)
    ├── long-form-orchestration.md (book-scale workflow pipeline; multi-minion patterns)
    ├── book-mode.md               (per-session book-writing workflow + openwriter integration)
    ├── workspace-management.md    (container hierarchy + doc naming + rename discipline)
    ├── shape-table.md             (canonical project dashboard — chapters × beats × drafts × % done)
    └── manuscript-binding.md      (outline of doc: links → manuscript → EPUB/DOCX; never flatten the beats)
```

`docs/` is canonical; any copy elsewhere defers to it.

## Routing

| User intent | Action |
|---|---|
| "/book-writer" / "/book" / "start a book project" | Run **Book-Class Question** → **Workspace Setup** (`docs/workspace-management.md`) → **Chapter Architecture** (`docs/chapter-architecture.md`) → **Per-Chapter Beat Work** (`docs/beats.md`) |
| "chapter architecture" / "TOC" / "chapter list" / "book outline" | `docs/chapter-architecture.md` |
| "chapter beats" / "beat map" / "beat draft" / "beat sheet" | `docs/beats.md` (nonfiction — declarative-claim beats) · `docs/beats-fiction.md` (fiction — scene beats). Both start with the author DUMP; never propose beats from cold. |
| "workspace organize" / "where does X go" / "container structure" / "rename chapter" | `docs/workspace-management.md` |
| "shape table" / "project shape" / "where are we" / "% done" / "book status" / "progress" / "dashboard" | `docs/shape-table.md` |
| "book mode" / "session workflow" / "openwriter book setup" | `docs/book-mode.md` |
| Book-scale orchestration / multi-minion patterns | `docs/long-form-orchestration.md` |
| "stitch the book" / "compile" / "assemble the manuscript" / "single file" / "publish" / "KDP" / "export to EPUB/DOCX" / "manuscript binding" / "add chapter to the manuscript" | `docs/manuscript-binding.md` — the binding-not-a-file convention, the `doc:`-link outline, order-by-line-position, building the Manuscript, Add chapter, downloads. Once a book has a manuscript, read *After the manuscript is built* first. |
| "draft this chapter" / "write the beat as prose" / any PROSE work | **Delegate to /authors-voice Apply Protocol.** This skill's job ends at the locked brief. |

## Delegation to /authors-voice

For any prose generation (chapter draft, beat-as-prose translation, transition pour, vignette draft, opener, closer, bridge):

1. **This skill produces:**
   - Locked beat structure (declarative claims per `docs/beats.md`)
   - TASK brief (outcome-shape commitments per `docs/beats.md` — NOT content prescription)
   - Chapter-context summary (where the beat sits in the chapter; what came before; what comes after)
   - Voice-anchor selection (if a book-specific anchor exists in `voice/anchor-<book>.md`, name it; otherwise default `voice/anchor.md`)
   - Length target
2. **Delegate:** call /authors-voice Apply Protocol with the assembled brief as the TASK
3. **/authors-voice produces:** voice-matched prose via Opus minion, NEVER-patched, post-write-audited, integrated into the openwriter doc
4. **This skill receives** the integrated prose and:
   - Runs cross-section coherence review if multi-section
   - Updates chapter-level doc structure (move to Chapter Drafts container if it landed elsewhere)
   - Updates beat doc to mark which beats have been drafted
   - Captures any author feedback as agent marks for next-pass refinement

The two skills compose cleanly: book-writer specifies WHAT must land; authors-voice specifies HOW the prose sounds. Neither does the other's job.

## Workflow phases for a new book project

1. **Book-Class Question** — fiction or nonfiction; argument or domain (nonfiction)
2. **Workspace Setup** — create workspace + project-level containers (Book Spine, Working Notes) + per-chapter containers as chapters lock (each chapter container holds Beats doc + Research Notes + Drafts sub-container) per `docs/workspace-management.md` v2 chapter-first scheme
3. **Architectural Docs in Book Spine** — Thesis, Audience & Reader Journey, Voice & Form, Source Material inventory, Argument Arc (or Global Beat Sheet for argument-driven; Domain Identification for domain-driven), Concept Dump, Open Questions, Decisions Log
4. **Chapter Architecture** — 5-pass commit (argument-driven) or 7-phase pipeline (domain-driven). Output: committed TOC with substantive chapter names per the convention
5. **Per-Chapter Beat Draft** — for each chapter, run beats methodology. Output: locked beat structure per chapter (declarative claims)
6. **Pilot Chapter** — pick densest chapter; run full draft loop via /authors-voice delegation. Validates the 4-act pattern and beat-as-commitment shape
7. **Parallel Chapter Drafts** — after pilot validates, remaining chapters draft in parallel via /authors-voice
8. **Cross-chapter coherence** — blinder audit, transitions, redundancy elimination
9. **Polish + /anti-ai pass** — global fingerprint scrub (via authors-voice + /anti-ai)
10. **Author comment pass** — the author reads each edited chapter and leaves inline comments in OpenWriter; work them one chapter at a time

Each phase commits before the next begins. Returns to earlier phases when needed (e.g., chapter beats consistently feel "too much" or "too thin" → return to chapter architecture).

## Companion skills

- **/authors-voice** — voice pipeline (anchor + minion + post-write audit + analysis + tiers). REQUIRED for any prose generation. This skill cannot draft prose without it.
- **/anti-ai** — final AI-tells fingerprint scrub. Recommended for book-class work after each chapter polish pass.
- **openwriter** — the workspace/document MCP. REQUIRED for the workspace management this skill governs (create_document with container parameter, move_item, rename_item, etc.).

## When to skip this skill

- Single-chapter essays, blog posts, tweets, threads — go directly to /authors-voice
- Pure analysis or research with no draft target — go directly to /authors-voice or use research-only tools
- Voice-only setup (building anchor blend, adding corpus samples, regenerating voice profile) — /authors-voice
- One-off scenes or vignettes outside a book context — /authors-voice
