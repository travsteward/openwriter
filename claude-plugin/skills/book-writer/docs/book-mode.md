# Book Mode

Workflow for long-form book projects. Inverts the usual minion model: author conjures BEATS, minion materializes PROSE from beats ONE BEAT AT A TIME. Editor keeps beats sharp and detects when a specific beat's prose has gone stale relative to that beat.

Invoked when project is a multi-chapter book and author signals book-mode work (creating a new book project, working on a chapter, dumping ideas). Sits on top of Apply Protocol — Apply runs inside this per-beat orchestration loop.

Orienting principle: **done > polished.** Generate fast, polish never — until the whole book is generated. Anchor Iteration is deferred to a later phase.

## Prerequisites: Argument Arc → Global Beat Sheet → Chapter Architecture → Reorg

Book Mode operates INSIDE committed chapter containers, AFTER beats have been sorted into them. The upstream chain:

1. **Argument Arc** — book's logical spine, in the author's voice.
2. **Global Beat Sheet** — every beat the book needs, in approximate argument order, no chapter assignment yet. Built via 5-pass extraction (`docs/beats.md`) at the BOOK level. Supplies raw material for chapter architecture.
3. **Chapter Architecture** (`docs/chapter-architecture.md`) — reads Argument Arc AND Global Beat Sheet together as evidence; commits chapter container shapes with substantive names, validated boundaries, one-sentence chapter promises. 5-pass protocol: ARC + BEATS RE-READ → CHUNK → NAME → BOUNDARY VALIDATION → COMMIT TOC.
4. **Reorg Beats by Chapter** — sort the Global Beat Sheet into committed containers. Resolve fuzzy boundaries. Output: each chapter container holds its assigned beats.

Per-chapter beat work + prose materialization (Book Mode's core loop) begin AFTER all four prerequisites complete.

If a project enters Book Mode without these — no global beat sheet, no committed TOC, or with an "inherited" chapter list that was never validated — STOP. Run the upstream phases first. Generating per-chapter beats inside wrong containers is the most expensive error in the pipeline.

When the TOC shifts during the project (chapters merge, split, rename), the workspace container structure updates in lockstep — NEVER DELETE any chapter container; merged/absorbed chapters become Variants of the receiving chapter.

## Unit of sync is the BEAT, not the chapter

Load-bearing distinction. A chapter is not "stale" or "current" as a single unit. Each beat has its own materialization state:

- **not-written** — beat exists in beat sheet, no prose materialized yet. Default state. Most beats in most chapters at most points in time.
- **current** — beat is materialized AND beat sheet's revision matches the revision that produced the prose.
- **stale** — beat is materialized but beat sheet's revision of that beat has changed since.

Chapter "completeness" is a roll-up readout: "Ch 2 has 2/7 beats current, 0 stale, 5 not-written." Information for the author, not a binary flag the methodology acts on.

A chapter in mid-draft with most beats unwritten is the NORMAL state. Not a broken state. The methodology handles it as default.

## FIRM RULE: NEVER delete without explicit per-item permission

In book mode the editor never deletes anything. Not a materialized beat doc. Not a Variants doc. Not an Ideas doc. Not a Beats doc. Not a Concept Dump entry. Not a legacy draft. Not a "workshop fragment" that looks superseded. Nothing.

Editor MAY: move, rename, set frontmatter, append flags to titles (`[STALE]`), append annotations, propose deletions for the author to act on. Deletion only happens on explicit author approval for that specific doc.

Beat drafting is iterative. Same prose may be wanted again. A doc that looks like a "workshop fragment" today turns out to be the canonical source tomorrow when a regen disappoints. Recoverability from OS trash is not a substitute — trash gets cleared, restores get missed, author shouldn't have to hunt for what the editor judged "redundant."

When in doubt, move to Variants. Variants exists to hold anything the editor isn't sure about.

## Workspace structure

One container per chapter at workspace root, holding both the beats authority and the per-beat materializations:

```
<Book Workspace>/
├── Concept Dump                       (workspace-level scratchpad, unsorted ideas)
├── Book Spine/                        (Argument Arc, Thesis, Audience, Voice & Form, Decisions Log, TOC)
├── Ch 1/
│   ├── Ch 1 — Beats                   (canonical authority — beat headers + sub-beat commitments)
│   ├── Ch 1 — Ideas                   (chapter-scoped scratchpad)
│   ├── Materialized Beats/            (one doc per beat that has been written)
│   │   ├── B1 — <beat title>
│   │   ├── B2 — <beat title>
│   │   └── ...
│   └── Variants/                      (anything not in active rotation; nothing here is deleted by the editor)
│       └── ...
├── Ch 2/
│   └── (same shape)
└── ...
```

The Concept Dump catches ideas that don't yet belong to a specific chapter. Editor sweeps and proposes chapter/beat slots.

Each chapter's Ideas doc catches chapter-scoped fragments — scenes, mechanisms, citations, half-formed arguments. Editor sweeps and proposes which existing beat absorbs the idea or where to insert a new sub-beat.

The Materialized Beats subcontainer is the chapter's actual prose, one doc per beat. When B1 is regenerated, prior B1 doc moves to Variants and new one takes the B1 slot. Chapter's full text is the in-order concatenation of these docs. (A consolidated `Ch N — Manuscript` doc is OPTIONAL — generate only when chapter is materially complete or author needs to read the full flow.)

The Variants subcontainer holds anything older or alternative: prior beat versions after regeneration, legacy wholesale drafts predating per-beat materialization, alternate takes the author wants to keep around for line salvage.

## Per-beat sync link (frontmatter on each materialized beat doc)

Every materialized beat doc carries frontmatter linking it to its source beat:

```yaml
beat_id: B1
beat_title: "Adenosine is the chemistry of tiredness"
generated_from_beats_doc: <docId of the chapter's Beats doc>
generated_at: <ISO date>
status: current   # current | stale
source_note: <optional — where the prose came from if not a fresh minion run>
coverage_note: <optional — flags sub-beats that aren't fully covered>
```

`source_note` is set when prose was extracted from an existing doc (legacy wholesale draft, prior multi-beat workshop doc) rather than produced by a fresh Apply Minion run. Format: `"Extracted from <source-doc-title> (<docId>) in Variants. Apply + Rewrite passes applied."`

`coverage_note` is set when materialized prose doesn't cleanly cover every sub-beat in the current Beats doc. Format: `"Covers sub-beats 2.0-2.4, 2.6, 2.7. Missing 2.5 (visual-ornament roster) explicitly."` Use when a beat is "current but incomplete" — author then decides whether to add missing material or accept partial coverage.

When the editor regenerates the beat, these fields update on the new doc. When beat sheet's text for that beat changes but no regeneration has run yet, editor flips `status: stale` on the materialized doc and appends `[STALE]` to its title.

## Beat extraction (where beats come from)

Beats arrive in the Beats doc by two paths:

**1. Cold-start (greenfield chapter).** Chapter is empty, author has the topic in their head. Run the **5-pass extraction** in `docs/beats.md` (DUMP → TENSION → CATEGORY → SEQUENCE → COMPRESSION). Editor walks author through each pass, captures beats verbatim, structures into Beat Map artifact. Output: ~30 section beats grouped under 8-12 chapter-arc beats.

**2. Incremental sweep (ongoing additions).** Chapter already has beats; author dumps new ideas into workspace `Concept Dump` or chapter `Ideas` doc. Editor sweeps and proposes slots ("new sub-beat in Ch 5 between 5.3 and 5.4"; "expands beat 7.2 with the chimp-coalition mechanism"). Author approves. Editor writes the new sub-beat into the Beats doc. Any materialized beat whose commitment changed gets marked `stale`.

Both paths apply the principles from `docs/beats.md`: **query the author, never propose from cold; beats are commitments (outcomes), not content; let the minion's training data carry references.**

The 5-pass is for cold-start. Incremental sweep is the ongoing default once a chapter has an initial beat structure.

## Extraction path (existing prose → Materialized Beats)

When prior work exists as a wholesale chapter draft or multi-beat workshop doc, the editor can extract it into per-beat docs without regenerating. Use when existing prose is good enough to ship and re-materializing fresh would lose voice work already done.

Pattern:

1. Source doc stays in (or moves to) Variants with `draft_type` frontmatter (`legacy_wholesale`, `extraction_source`, etc.) and a clarifying note. NEVER DELETE the source.
2. Editor reads source and identifies beat boundaries (typically marked by h2 headers like `B1 — ...`, `B2 — ...`).
3. Editor creates one `B<N> — <title>` doc per beat in Materialized Beats and populates with beat's prose verbatim (just paragraphs, no h2 header).
4. Frontmatter on each new doc: `status: current` (prose IS current to source), `source_note: "Extracted from <source-doc-title> (<docId>) in Variants."`
5. If extracted prose doesn't cleanly cover every sub-beat in the current Beats doc, add `coverage_note` flagging missing material. Surface the gap to the author.

Source doc stays in Variants as audit trail. NEVER DELETE it.

## The loop

1. **Author dumps ideas.** Workspace Concept Dump for unsorted; chapter Ideas doc for chapter-scoped fragments.
2. **Editor sweeps.** Reads new entries, proposes slots: "new sub-beat in Ch 5 between 5.3 and 5.4" or "expands beat 7.2 with the chimp-coalition mechanism."
3. **Author approves.** Editor writes to the relevant Beats doc.
4. **Editor flips affected beat-doc status.** Only materialized beats the change touched get `status: stale` + `[STALE]` in title. Untouched beats stay current. Not-written beats stay not-written.
5. **Materialization signal.** Author signals "write B3" or "regenerate B1" OR a not-written beat hits saturation (no pending ideas) and author signals ready. Editor fires Apply Minion against THAT BEAT'S commitment (not the whole chapter).
6. **Old beat-doc → Variants.** If regenerating an existing beat, prior version moves to `Ch N / Variants / B<N> — <title> v<n>`. New beat doc takes the Materialized Beats slot with fresh frontmatter.
7. **No polish during draft phase.** Skip Anchor Iteration per beat. Goal is a complete book, not a polished beat.
8. **Polish phase opens later.** When every chapter has every beat materialized and current, polish phase opens. Editor consolidates beats into per-chapter Manuscript docs, runs Anchor Iteration per chapter, runs /anti-ai cleanup per chapter. Own phase, not interleaved with drafting.

## Editor's role per phase

**Drafting:**
- Sweep Concept Dump and Ideas docs (on-demand, when author dumps fresh material)
- Propose beat slots with specific positions ("between 5.3 and 5.4", "expands 7.2", "new top-level beat after B6")
- Maintain beat sheets — canonical authority
- Track per-beat sync state via frontmatter on materialized beat docs
- Fire Apply Minion per beat on materialization signals
- Archive superseded beat versions to Variants on regeneration
- Provide chapter completeness roll-ups on request

**Polish (later):**
- Per chapter: consolidate materialized beats into a single Manuscript doc
- Per chapter: fire Anchor Iteration to converge at 90/100
- Per chapter: fire /anti-ai cleanup pass (MANDATORY after Anchor Iteration)
- Surface anchor-critique convergent diagnostics to the author per FIRM RULE 2 — discuss before revising
- Apply agreed cuts directly; spawn revision minions for agreed rewrites
- Solicit author's read-through comments and inline marks; surgically address each

## Minion's role

Apply Minion materializes prose from a SINGLE beat's commitments. Brief shape per the standard Apply Protocol (`docs/apply-protocol-deep.md`) — COMMITMENTS section contains just that one beat's sub-beats (and any necessary adjacent-beat context for seam continuity if not the first beat).

Rewrite Minion is rarely needed in book mode. When a beat changes, editor re-fires Apply for that beat against the updated commitment. Apply's no-source-prose-ceiling property is preserved.

Anchor Iteration polish minion is NOT fired per beat during drafting. Save for polish phase, where it fires per CHAPTER on the consolidated Manuscript.

## Chapter completeness readout

On request ("status of Ch N", "how is the book"), editor produces a per-chapter table:

```
Ch 2 — Sleep Pressure (7 beats)
  B1 — Adenosine is the chemistry of tiredness        CURRENT
  B2 — Caffeine blocks the signal, not the debt       CURRENT
  B3 — Sleep pressure builds linearly while awake     not-written
  B4 — The circadian rhythm is an independent clock   not-written
  B5 — The two systems normally rise and fall together  not-written
  B6 — Jet lag is the two systems desynchronized      not-written
  B7 — The afternoon dip is built in, not earned      not-written

  Roll-up: 2/7 current, 0 stale, 5 not-written
```

Working dashboard for drafting.

## Anti-patterns

- **Treating the chapter as the sync unit.** Chapters aren't stale; beats are. Marking a whole chapter `[STALE]` because one beat drifted hides which beat needs regen and slows the loop.
- **Materializing the whole chapter at once.** Apply fires per beat in this mode. Wholesale generation produces prose that isn't independently regenerable beat-by-beat and forces full rewrites on small commitment changes.
- **Polishing during drafting.** Tempting after a beat lands well. Resist. Polish phase exists for a reason — prose isn't done until the whole book exists.
- **Editing the materialized beat directly during drafting.** If prose needs to change, change the BEAT in the Beats doc and regenerate that beat. Direct prose edits don't propagate to the beat sheet, so beats become a stale record of intent.
- **Hoarding ideas in your head.** Dump immediately. Even half-formed. Ideas docs are cheap; lost ideas are expensive.
- **Editor deleting Variants on its own initiative.** Variants is the audit trail and the line-salvage library. Editor never deletes its contents. Author may instruct deletion of specific docs at any time; that decision is the author's alone.
- **Spawning Clarity-style review passes.** Already tested. Already failed. Apply → (later) Anchor Iteration → (later) /anti-ai. Three passes, no more.

## Initial setup for a new book project

1. Create the workspace.
2. Create the Spine container with: Argument Arc, Thesis, Audience & Reader Journey, Voice & Form, Decisions Log.
3. Create workspace-level Concept Dump doc.
4. **Build the Argument Arc** — query the author through the book's logical spine; capture verbatim. Add as doc in Spine container.
5. **Build the Global Beat Sheet** — run 5-pass extraction (`docs/beats.md`) at the BOOK level. Every beat the book needs, in approximate argument order, NO chapter assignment yet. Add as doc in Spine container.
6. **Run Chapter Architecture** (`docs/chapter-architecture.md`) — 5-pass protocol (ARC + BEATS RE-READ → CHUNK → NAME → BOUNDARY VALIDATION → COMMIT TOC) that commits the TOC. Add TOC doc to Spine container. Do NOT skip to step 7 with an inherited or assumed chapter list.
7. For each chapter the COMMITTED TOC names: create `Ch N` container with `Ch N — Beats`, `Ch N — Ideas` docs, and empty `Materialized Beats/` and `Variants/` subcontainers. Chapter container names reflect the TOC's substantive chapter names, not categorical placeholders.
8. **Reorg Beats by Chapter** — sort the Global Beat Sheet into the `Ch N — Beats` docs. Each beat picks a home; beats that don't fit go to a chapter's Variants with a note; beats that suggest a missing chapter trigger a Chapter Architecture re-run.
9. **Per-Chapter Beat Draft** (per chapter, as ready to draft) — run 5-pass extraction again at chapter level on assigned beats; refine into 8-12 chapter-arc beats with sub-beats. `Ch N — Beats` now holds the per-chapter beat list ready for materialization.

After setup, the loop runs. Author dumps. Editor sweeps. Minion writes a beat at a time. The book materializes.
