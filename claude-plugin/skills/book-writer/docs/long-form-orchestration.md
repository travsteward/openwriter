# Long-Form Orchestration (book-scale work)

For book-scale projects with a logical arc or a rich source-material library. Editor builds architectural artifacts the minion drafts against and that survive context resets.

**Two pipelines, determined by book class. Always run the book-class question FIRST.** See `docs/chapter-architecture.md` for the decision criteria and the full protocols.

## The book-class question

| Class | Inputs | Pipeline |
|---|---|---|
| **Argument-driven** | Author has an extended argument to make | Argument Arc → Global Beat Sheet → Chapter Architecture (5-pass) → Reorg → Per-Chapter Beats → Draft |
| **Domain-driven** | Author has pre-existing concept docs / research / a knowledge graph | Source Inventory → Domain Identification → Act Grouping → Chapter Pattern → Candidate TOC → Reshape → Lock → Pilot → Draft |

When in doubt for popular-science / reference / transformation work: **domain-driven** is the better default. Argument-driven books in this class collapse into one abstract action call and starve on prescription. Full decision criteria in `docs/chapter-architecture.md`.

## Pipeline A: Argument-driven

```
Argument Arc  →  Global Beat Sheet  →  Chapter Architecture  →  Reorg Beats by Chapter  →  Per-Chapter Beat Draft  →  Chapter Draft  →  Research Notes
(book-level)     (all beats for the    (TOC + chapter briefs;    (sort global beats into    (refine per-container       (minion writes      (POST-draft enrichment:
                  book, pre-chapter,    bounded containers        committed containers;      beat list; sequence;        per beat;            canonicalize the references
                  raw material)         committed; fuzzy          resolve fuzzy              compression; sub-beats)     training data        the draft actually used)
                                        boundaries OK)            boundaries)                                            brings content)
```

Each phase commits before the next begins. Order is hybrid by design: Global Beat Sheet supplies raw material BEFORE architecture so containers commit on evidence; chapter architecture commits container shapes BEFORE reorg so beats have somewhere to land; per-chapter beat work refines INSIDE committed containers so dopamine flow is local. Skipping Chapter Architecture is the most common silent failure.

Stages, each built by querying the author:

1. **Argument Arc** — logical flow of the whole argument, beat by beat, in the author's words. Built by asking the author to talk through their argument and capturing verbatim where possible. Lives as a doc in the project workspace.

2. **Global Beat Sheet** — every beat the book needs, in approximate argument order, no chapter assignment yet. Built via 5-pass extraction in `docs/beats.md` (DUMP → TENSION → CATEGORY → SEQUENCE → COMPRESSION) at the BOOK level. Raw material chapter architecture will chunk into containers.

3. **Chapter Architecture** — TOC commit. 5-pass protocol (ARC + BEATS RE-READ → CHUNK → NAME → BOUNDARY VALIDATION → COMMIT TOC). Spec: `docs/chapter-architecture.md`.

4. **Reorg Beats by Chapter** — sort Global Beat Sheet into committed chapter containers using chapter brief as the test.

5. **Per-Chapter Beat Draft** — refine assigned beats into final per-chapter beat list. 5-pass extraction from `docs/beats.md` runs again at chapter level.

6. **Chapter Draft** — Apply Protocol per chapter-arc beat with section beats as commitments.

7. **Research Notes per chapter** — POST-draft enrichment. See `docs/beats.md` "research-after-draft inversion."

## Pipeline B: Domain-driven

```
Source Inventory  →  Domain ID  →  Act Grouping  →  Chapter Pattern  →  Candidate TOC  →  Reshape  →  Lock + Pilot  →  Draft
(read existing       (containers    (3-act book      (4-act chapter    (title + beats     (author       (one chapter      (parallel
 concept docs /       become         structure)       internal          + vignette         marks up      end-to-end to     against
 research notes)      candidate                       structure)        slots + source     inline)       validate          validated
                      domains)                                          mapping)                         format)           pattern)
```

Source-driven, not argument-driven. Reverses the argument-driven order: instead of "build the argument, then chunk it," it's "see what's already in the source material, find the natural domains, group into acts, design the chapter pattern, draft the TOC against what exists."

Stages:

1. **Source Material Inventory** — read or surface the author's existing material. If author has an OpenWriter Concepts workspace: `list_workspaces` → `get_workspace_structure` surfaces the structure. Crawl each container's docs for first paragraph (lightweight — don't read full bodies yet). Goal: know what the author already has authority on.

2. **Domain Identification** — the natural groupings in the source material ARE the candidate scientific/conceptual domains. Don't impose categories from outside. If the Concepts workspace has containers, those ARE the candidate domains.

3. **Act Grouping** — cluster the domains into 3 acts that produce a coherent emotional/conceptual flow at book level. Typical patterns: Architecture / Mechanism / Behavior; Diagnosis / Reframe / Practice; Origin / Evolution / Manifestation. The 3-act grouping is invisible to the reader but makes the chapter sequence feel like a journey.

4. **Chapter Pattern** — every chapter runs the same 4-act internal structure: introduce mechanism → explore logic → bridge to modern (vignettes) → setup next. This is load-bearing — it's how the book delivers prescription without self-help register.

5. **Candidate TOC** — for each chapter: title + word target + 5-8 beats + bridge-to-modern vignette slots + source-doc mapping. Compact, scannable.

6. **Author reshape via inline comments** — author marks up the TOC directly. Editor structures the reshape, iterates v1 → v2 → v3 until shape locks.

7. **Lock + Pilot** — lock the TOC, pick the chapter with densest source material, draft end-to-end to validate the 4-act pattern. Then draft the rest in parallel against the validated pattern.

8. **Vignette inventory** — runs DURING chapter drafting, not before. Flat library; vignettes deploy by natural fit.

9. **Research Notes per chapter** — same as Pipeline A.

Full domain-driven protocol in `docs/chapter-architecture.md`.

## Query method (build arc, beats, domains)

Architectural artifacts built the same way regardless of pipeline: editor asks the author focused questions, author talks, editor structures back. Author owns substance; editor owns structure.

**Query-first is the DEFAULT.** Even when author asks "what beats should we add?" or "what domains should we cover?", editor's first move is to ask back. Proposing structure from cold (editor brain → suggestion) is the failure mode. See `docs/beats.md` "Query-first principle: pull, don't propose" for the full rule.

**Scene = author, science = agent.** Anywhere a beat needs lived material — opening hooks, vignettes, autobiographical credibility paragraphs — the agent NEVER invents. It inserts a `[SCENE PLACEHOLDER — author provides]`, lists 2-4 candidate slots from the author's known life / source material, and waits for the author's 1-2 paragraphs of raw lived material. Then the agent produces everything around the scene. Full rule in `docs/chapter-architecture.md` "Scene = author, science = agent (firm rule)."

Pattern for the **Argument Arc**:

1. Ask one foundational question (e.g., "What's the central move of Ch X — the thing the reader walks out knowing?").
2. Author talks. Editor captures verbatim where possible, structures into arc-beat slots, writes to the doc.
3. Ask the next gap-filling question. Iterate until arc is dense enough.
4. Where project has a Concepts (source-material) workspace, MINE it before asking the author to recreate from scratch. Read the relevant source docs. Identify what's already canonical. Ask only for the gaps.

Pattern for the **Global Beat Sheet** (argument-driven): 5-pass extraction in `docs/beats.md` at BOOK level.

Pattern for **Chapter Architecture**:
- Argument-driven: 5-pass protocol (ARC + BEATS RE-READ → CHUNK → NAME → BOUNDARY VALIDATION → COMMIT TOC)
- Domain-driven: 7-phase pipeline (Inventory → Domain ID → Act Grouping → Chapter Pattern → Candidate TOC → Reshape → Lock + Pilot)

Pattern for **Per-Chapter Beat Draft**: 5-pass extraction again from `docs/beats.md` at chapter level.

Forward motion comes from asking the right next question — never from prescribing structure the author hasn't yet articulated.

## Companion: Research Notes per chapter (post-draft enrichment)

Built AFTER the chapter draft. Minion's training data brings reference material into the draft; Research Notes makes those references canonical. See `docs/beats.md` "research-after-draft inversion" — including when the default flips (frontier research, contested citations, niche source material).

Post-draft enrichment:

1. Editor + author read the draft together
2. Identify references that need to be canonical (specific URLs, DOIs, author-year, journal, page numbers)
3. Catalog into the Research Notes doc, keyed to the relevant draft passage

Each chapter's Research Notes typically contains:

- **Source-material docs cited** — every Concepts doc the draft drew from. Call `link_to(source, target)` for each (per SKILL.md firm rule 5 — metadata-only since v0.20; the target's inbound list fills in live, no body mutation). Apply universally across the workspace, not just here.
- **Research URLs** — every paper, study, or external reference the draft cited. Inline markdown links `[Author Year, Journal](URL)`. Web-search for DOIs / canonical URLs during the enrichment pass. External refs do not use `link_to`.
- **Key supporting concepts index** — clean enumerated list of every Concepts doc this chapter draws from. Each entry's `link_to` connection is already declared (per above); this list is the human-readable surface.
- **Key research citations index** — clean enumerated list of every cited study with its full URL.
- **Draft-passage-keyed evidence** — for each draft passage needing canonical citation, the reference lives here keyed to passage location (e.g., "Section on glucose response under restriction: representative cohort study, journal citation, [URL]").

When inversion flips (Research Notes built BEFORE the draft), editor packs the relevant entries into the minion's brief as MUST-CITE constraints. Default is post-draft; exception is content-driven.

## Scoping a chapter against the arc / domain

Before building a Per-Chapter Beat Draft (argument-driven) or drafting a chapter (domain-driven), RE-READ the chapter's committed brief from the TOC. The chapter brief is the boundary — beats stay inside it.

Common drift: pulling content from the next chapter into the current chapter because both touch the same domain. Fix is precision about what each chapter specifically accomplishes.

If beats consistently feel "too much" or "too thin" inside a container, the container is wrong — re-run Chapter Architecture (`docs/chapter-architecture.md`), don't paper over at the beat layer.

## Architectural artifact recovery (when chapters or beats get cut)

If the author cuts a chapter or beat as errant, preserve the work as a module doc in a project subfolder (e.g., a `Modules/` container in the workspace). Don't delete — book architecture pivots are common; previously-cut material often gets reintroduced in a later structural pass. Same for Beat Maps that get reshaped: keep prior version as a versioned doc, not a destructive overwrite. (FIRM RULE from `docs/book-mode.md`.)

## Suggested project workspace structure

```
<project workspace>/
├── Spine/
│   ├── Argument Arc                       (Pipeline A primary; Pipeline B optional through-line)
│   ├── Global Beat Sheet                  (Pipeline A only)
│   ├── Table of Contents                  (both — committed TOC artifact)
│   └── (other project-level architectural docs)
├── Ch 1/ ... Ch N/                        (per docs/book-mode.md)
│   ├── Ch N — Beats                       (Pipeline A primary; Pipeline B uses 4-act pattern instead)
│   ├── Ch N — Ideas
│   ├── Materialized Beats/
│   └── Variants/
├── Vignettes/                             (Pipeline B — flat library)
├── Research Notes/
│   ├── Ch 1 — Research Notes
│   └── ...
└── Concepts/ (source-material workspace, possibly separate workspace)
    └── (canonical concept docs — Pipeline B's load-bearing input)
```

Concepts workspace can be separate if source material warrants its own organization. Per-chapter docs and Research Notes always live in the same workspace as Chapters so cross-references resolve cleanly. For Pipeline B (domain-driven), the Vignettes container holds the flat vignette library that chapters draw from during drafting.
