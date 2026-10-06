# Beats — Methodology

A beat is the smallest unit of forward movement: one shift in the reader's understanding, attention, or emotional state. The fundamental unit the editor operates on with the author.

This doc: query-first principle, beats-as-commitments rule, the fractal hierarchy, beat density, the per-chapter beat map, the 5-pass extraction, the minion handoff.

## Beat unit definition (v2 lock 2026-05-20)

**One flat beat definition. No sub-beats.**

- **A beat = one atomic teaching move = one dispatch unit.** Each beat gets its own /authors-voice Apply Protocol call. Never bundle multiple beats in one dispatch.
- **Beat sizes vary by job, not by uniform target.** 80w aphoristic-compression beats ("Sleep is the foundation") through 800w grounded unpacks (mechanism walks, study breakdowns, historical context). 500-650w is the typical sweet spot for case-study and demonstration beats.
- **Beats group conceptually under Acts** in the chapter beats doc for chapter-architecture thinking. Acts are organizational headers, not dispatch units.
- **Empirically validated lock (2026-05-20):** seven pilot tests at single-beat scope (500-650w each) produced gold-standard prose. One multi-beat dispatch (~1300w covering 7 beats) collapsed density across all 7. Minion quality budget is per-dispatch, not per-word — give it one outcome to land.
- **Naming:** beats use declarative-claim names (`B6 — JET LAG IS THE CLEANEST DEMONSTRATION.`). Per-beat prose docs use `Ch N — Bk: <Short Name>` (`Ch 2 — B6: Jet lag`). Beat number is the dispatch handle — point at work by number+name, not by ambiguous group labels.

## Query-first principle: pull, don't propose

The editor STRUCTURES what the author owns. Author owns substance + beat material; editor owns process + shape.

When beats are needed — to add to a Beat Map, fill a gap, extend a chapter — the editor's DEFAULT is to QUERY the author, never propose from cold.

**Failure mode:** editor mines source docs / argument arc / their own intuition → proposes 2-3 candidate beats → author rejects them all because they came from outside the author's brain. Wasted turn, material the author doesn't recognize as theirs.

**Correct move:** editor identifies the SIGNAL in the author's recent modifications (what did the author just sharpen? what direction did they push? what categorical word did they kill?) → formulates ONE focused question that pulls the next beat material OUT of the author → author talks → editor structures the beat from the author's words.

The author's recent edits are always a signal. Sharpened B1 toward mechanism specificity → next beats in their head are likely also mechanism-sharpening. Killed a soft framing and named a force → next work is likely naming the next soft framing.

**Query patterns that work:**

- "You just sharpened B1 by adding the adenosine-clearance mechanism. Looking at the spine, which other beat feels soft on mechanism specificity?"
- "You killed TIREDNESS in B5 and replaced it with SLEEP PRESSURE as the named force. Is there another categorical word in the spine covering for a force that needs naming?"
- "You added these three sub-beats. What's the thread you've been thinking about that still hasn't made it into the beat map?"
- "Walking the spine top to bottom — which arc beat feels under-served when you read it back?"

Each query has the same shape: name the author's RECENT WORK as evidence, ask a SPECIFIC question with a CONCRETE direction, give the author room to talk.

**When proposing IS the right move** (rare):
- Author explicitly asks "give me 3 candidates"
- Candidates are mechanically derived from existing source material the author owns (e.g., "your concept doc lists 5 mechanisms; I'm proposing each becomes a beat — does that fit?") — presented as restructuring, not invention
- Low-stakes draft work, author wants to move fast

Otherwise: default to query. The editor's intuition for "missing" beats is dramatically worse than the author's; extract the author's intuition, don't substitute your own.

## Beats are commitments, not content

A beat is the OUTCOME the writer must produce in the reader. NOT the content the writer uses to produce it.

**Failure mode:** editor packs the beat with specifics — "use these 10 species," "cite this study," "name the mechanism in these terms." Minion has nothing left to invent; editor has quasi-written the prose by pre-selecting all load-bearing content. The minion's training data — which contains the reference material baked in — gets silenced; the minion can only reproduce what the editor pre-selected.

**Correct shape:** each beat = one sentence naming the OUTCOME (what registers in the reader). The writer brings the specifics from training data. Author owns the FRAME and AUTHOR-UNIQUE content; writer owns EXAMPLES, CITATIONS, CANONICAL REFERENCES.

**Example contrast:**

| Content brief (wrong) | Commitment (right) |
|---|---|
| "ROSTER: dolphins sleeping one hemisphere at a time, migrating birds micro-napping mid-flight, fruit flies losing coordination when deprived, elephants on two hours a night, brown bats on twenty — every species pays the sleep tax in its own currency" (~60 words, content) | "Land the cross-species roster — reader registers sleep as a universal biological mandate, not a human quirk" (~15 words, outcome) |
| "Cohort data: short sleepers show 40% impaired glucose response within one week of restriction (representative lab finding)" | "Land the empirical anchor — sleep restriction as one of the fastest measurable metabolic insults ever documented" |
| "Modern sleep-debt causal stack: artificial light, caffeine half-life, alcohol fragmentation, anxiety loops, screens in bed, irregular schedules" | "Name the sleep-debt causal stack — reader sees multiple intersecting modern attacks on a fixed biological need" |

The right-column beat tells the writer WHAT must land. The writer's training data contains the species examples, the study citations, the mechanism pathways. Minion picks specific examples that best serve the beat in voice register. Editor ensures the OUTCOME lands; minion curates supporting material.

**Beat commitments use the same shape as Apply Protocol TASK commitments.** The shape that produces excellent writing: abstract SEMANTIC statements of what must land — what claims, what register, what avoidances, what sequence — phrased so the model has freedom on HOW to deliver. When the editor specifies the prose instead of the move, the minion can't bring its moves. Same rule, same discipline, same shape at both layers.

When the minion drafts a chapter-arc beat, the section beats under it become TASK commitments VERBATIM. If a section beat reads like content-prescription (concrete examples packed in), it produces content-prescriptive prose. If it reads like an outcome commitment, the minion's training data brings the content in voice. The Beat Map IS a structured catalog of TASK commitments organized by chapter-arc beat.

**Inject specifics into a beat (the exceptions):**
- **Author-unique content.** Coined term, author-framed mechanism, lived-experience scene the minion cannot invent — list as MUST-APPEAR.
- **Load-bearing constraints.** Beat MUST land a specific phrase, callback to a prior chapter, or use a specific example for argumentative reasons — name it as a literal commitment (editor-as-co-author for that beat).
- **Author has strong preference on which example carries the beat.** "The dolphin's one-hemisphere sleep specifically, not just any animal example" — name it.

Otherwise: state the outcome, let the writer's training data bring the content.

## Research-after-draft inversion

Consequence of "beats are commitments": Research Notes are built AFTER the draft, not before.

Conventional order is research → outline → draft. With an AI minion drawing from training data, that inverts:

1. **Beat Map** — outcome commitments (no content prescription)
2. **Draft** — minion writes against commitments; training data brings examples, citations, frameworks
3. **Research Notes (enrichment pass)** — editor + author review draft, identify references that need to be made canonical (specific URLs, DOIs, author-name-year citations), build Research Notes keyed to relevant draft passages

The model already has reference material baked into its weights. Editor's research-stage job: CATEGORIZE and CATALOG the references the draft used, so they become canonical and citable.

**When inversion does NOT apply:** topic at frontier of recent research (post-training-cutoff data), or niche source material the model can't be trusted on, or specific contested citations (author wants Smith 2019 not Jones 2020) — then Research Notes built BEFORE the draft and injected into the minion brief. Default is post-draft; flip when content demands it.

## What a beat is

The smallest unit of forward movement. One move. One click forward.

Not a paragraph (typography). Not a sentence. Not a section. A beat is the move itself — the moment the reader registers a shift.

**Test:** if you removed it, what does the reader stop registering? Nothing → not a beat, filler. A specific shift in recognition or emotion → beat.

Every beat has three parts:
1. **Purpose** — what work it does for the reader
2. **Delivery** — the actual prose that does the work
3. **Effect** — what changes in the reader after it lands

**A beat's prose carries NO headings** — no chapter title, no section header, not even its own title. A beat is pure prose: the move and nothing else. All heading structure (chapters, sections, sub-sections) is declared in the **manuscript binding**, never authored into the atom — a title baked into a beat couples it to one position and one book. If a section header should sit above a beat, it goes in the manifest, not at the top of the beat. See `docs/manuscript-binding.md` → *Headings belong to the binding, never the beat*.

## Beat = dopamine

Beats and dopamine are functionally linked. Dopamine is the brain's forward-motion signal; it fires on four mechanisms — the same four that make a beat land:

1. **Prediction error** — gap between what reader expected and what arrived
2. **Reward anticipation** — not the payoff itself, the priming that says "payoff coming"
3. **Novelty / curiosity** — unfamiliarity flagged as "pay attention"
4. **Pattern recognition** — the reveal where noise resolves into signal

A beat that lands hits at least one (often all four): creates surprise (prediction error), resolves a tension planted earlier (anticipation paid off), opens a new tension (curiosity primed for next beat), reveals a pattern not yet seen.

Filler does none of these — dopamine-quiet prose. Reader's neurochemistry stops paying attention. The fourth restating of the same trait fires NO dopamine — habituation. **Repetition is metabolic cost for zero reward** — why bloated chapters feel long even when they aren't.

The chapter as a whole is a **dopamine sequence**: an interlocking chain of small tensions and resolutions, each beat both closing the prior cliffhanger and opening the next.

## Beat density (craft choice, not recording prescription)

Prose moves at different densities. An aphoristic Naval paragraph fires more dopamine hits per page than a Sapolsky mechanism walk. Both work; pick deliberately for the chapter's velocity and the voice register.

| Density anchor | Typical words/beat | Effect |
|---|---|---|
| Aphoristic (Naval) | 50-100 | Every line is the beat |
| Punchy (Manson, Taleb) | 150-250 | Mid-paragraph reveals, fast turns |
| Argumentative (Caplan) | 250-400 | Paragraph-per-claim |
| Developed (Peterson) | 400-600 | Heavy development per beat |
| Mechanism walk (Sapolsky) | 500-1000 | Long turns, slower dopamine spacing |

**Density is a craft choice. Recording structure is fixed: flat.** Within a chapter you might have an aphoristic 80w beat next to a 600w grounded unpack next to a 200w vignette — that variation IS the rhythm. But every beat is recorded the same way: one numbered entry in the chapter beats doc, one dispatch when prose lands. The two-level "chapter-arc beats with section beats nested underneath" recording style is deprecated (v2 lock 2026-05-20) — it produced multi-sub-beat dispatches that collapsed prose density.

**Beat-density math per voice setup** lives in `voice/beat-math.md` (the author's target density anchor). The chapter beats doc varies around that anchor by what each move's job demands.

## Beats run at two levels: global first, per-chapter after architecture

Beats methodology fires twice in the long-form pipeline, at two distinct scales:

**Level 1: Global Beat Sheet (book-level, pre-chapter).** Before chapter architecture, the 5-pass extraction runs at the BOOK level. Output: a FLAT list of every beat the book needs, in approximate argument order, with NO chapter assignment yet. Raw material chapter architecture chunks into containers. Without this, architecture has no concrete evidence to chunk on — tries to commit containers in the abstract from just the Argument Arc, and the chapter list ends up categorical and wrong.

**Level 2: Per-Chapter Beat Draft (chapter-level, post-Reorg).** After chapter architecture commits the TOC and the Reorg phase sorts global beats into containers, the 5-pass runs AGAIN — per chapter, on beats the container received. Output: a FLAT list of 15-30 beats per chapter (variable by chapter length and density), sequenced as that chapter's dopamine flow. Acts can group beats visually as organizational scaffolding, but acts are not dispatch units — only beats are.

Same methodology, two scales, two passes. Each pass produces a flat list at its scale. First feeds chapter architecture; second feeds the per-beat dispatches.

### Per-chapter beats live INSIDE committed chapter containers

Per-Chapter Beat Draft is downstream of Chapter Architecture (`docs/chapter-architecture.md`). The chapter container — substantive name, committed brief, boundary against adjacents — must exist BEFORE per-chapter beat work begins. Per-chapter beats with no committed container land in arbitrary places, spill across boundaries, produce a book the reader can't carry.

If a chapter container is unclear when per-chapter beat work begins (vague name, "and also" describing what it covers), STOP. Return to Chapter Architecture for that container. Architecture pass is cheap; beat work in a wrong container is expensive.

Signs the container is wrong, surfacing during per-chapter beat work:
- Beats consistently feel "too much" for the container (split the container or compress the beats)
- Beats consistently feel "too thin" (container is actually a sub-beat of an adjacent chapter)
- A beat keeps wanting to gesture at the next chapter's territory (boundary leak — re-validate adjacency or move the beat in Reorg)
- Chapter's promise can't be stated in one sentence (container hasn't crystallized)

## Beat naming convention

Every beat name must communicate the beat's SUBSTANCE — what the beat asserts, claims, shows, reveals — NOT what KIND of beat it is.

**Test:** can the author understand what the beat does from the name alone, without reading the beat? No → name is wrong.

The author uses the beat name to orient when formulating how to approach the beat. Categorical names ("THE CENTRAL THESIS," "MODERN DIAGNOSIS," "SETUP," "HOOK," "MECHANISM") force the author to read the beat to know what it asserts — mystery the author cannot use. A beat name that doesn't communicate is no different from a chapter titled "Chapter 2: The Central Thesis."

**Format:** declarative claim, present tense, 4-10 words, the active assertion the beat makes.

### Good (substantive, claim form)

- SLEEP IS THE PRICE OF PLASTICITY
- CAFFEINE BLOCKS THE SIGNAL, NOT THE DEBT
- EIGHT HOURS IS THE FLOOR AND YOU'RE TREATING IT AS A CEILING
- DREAMING IS OVERNIGHT THERAPY
- THE SHORT-SLEEP GENE IS VANISHINGLY RARE
- EVOLUTION NEVER MET THE ALARM CLOCK
- THE BODY KEEPS THE LEDGER
- THE DEBT COMPOUNDS, THE PAYMENT DOESN'T

Each tells the author exactly what the beat asserts. The author can picture the move, supporting beats, prose register required.

### Bad (categorical, meta-label)

- THE CENTRAL THESIS (thesis about what?)
- MODERN DIAGNOSIS (diagnosing what, finding what?)
- SETUP / HOOK / MECHANISM / TRANSITION / THE PAYOFF / SCOPE PRECISION

Structural-role labels, not substance.

### Where categorical tags DO belong

Category tags from the CATEGORY pass (REVEAL / REFRAME / MECHANISM / EVIDENCE / SCENE / APHORISM / PIVOT / REGISTER SHIFT) are analytical metadata, not beat names. Appear ALONGSIDE the beat name as a tag, never AS the beat name:

```
B3. SLEEP IS THE PRICE OF PLASTICITY [REVEAL]
```

Tag helps with structural balance checks (too many EVIDENCE beats = academic). Name carries the substance.

### Applied at every level

Convention applies equally to chapter-arc beats (8-12 per chapter), section beats (one tweet-length claim per beat), and project beats (argument arc — substantive claims at the book level).

## Per-chapter beat map artifact (v2 flat structure)

One doc per chapter (`Ch N — Beats: <Title>`). Reads top-to-bottom as the flow. Flat numbered list of beats with optional Act groupings as visual scaffolding. Pure beats only — no prose, no source detail, no research citations. Citations live in `Ch N — Research Notes`.

Structure:

```
# Ch N — Beats: <Chapter Title>

**Chapter brief.** [one paragraph]
**Word target:** ~Xw
**Pattern:** 4-act chapter structure. Single flat beat definition: one beat = one atomic teaching move = one dispatch unit. Beat sizes vary by job (80w naval-compression up to 800w grounded unpacks).

## Chapter arc — flat beat structure

### Act 1 — <Act name>  (~Xw)

**B1 — DECLARATIVE CLAIM IN CAPS.** (~Xw) One-paragraph outcome description carrying the load-bearing notes (the specific move, the citation handles, the closing aphorism if any). What must land in the reader after this beat.

**B2 — DECLARATIVE CLAIM.** (~Xw) Same shape.

[...]

### Act 2 — <Act name>  (~Xw)

**BN — DECLARATIVE CLAIM.** (~Xw) ...
```

Each beat = one declarative-claim name + a brief outcome paragraph naming the move, the references it carries, and any specific phrasing that MUST appear. Outcome shape (per the commitments-not-content rule) — the minion brings the prose, the editor names what must land.

**Why flat:** beat = dispatch unit. Recording structure matches dispatch structure. The minion writing B6 takes B6's beat entry verbatim into the TASK brief and writes ~500w of prose. No translation layer between recording and dispatch.

**Why Acts:** organizational scaffolding for the chapter's 4-act dopamine arc (mechanism → logic → bridge → setup-next). Acts let the author see the chapter's arc shape while scrolling the flat list. Acts are NOT dispatch units. A beat sits IN an act; an act does not get its own minion call.

Separation of concerns:

| Doc | Contents | Used by |
|---|---|---|
| **Chapter Beats** (`Ch N — Beats: <Title>`) | Flat beats with brief outcome notes, Act-grouped | Author (to see flow), editor (to assemble per-beat dispatch briefs) |
| **Chapter Research Notes** (`Ch N — Research Notes`) | Citations, URLs, hardened references | Editor when assembling dispatch briefs, author for verification |
| **Per-beat prose** (`Ch N — Bk: <Name>`, in `Ch N/Drafts/`) | One prose doc per beat — the minion's output | Author for review, editor for integration into full chapter draft |

The chapter beats doc is the load-bearing artifact. It drives every per-beat dispatch.

## The 5-pass extraction

The editor drives this with the author, one chapter at a time. Author owns substance; editor owns structure.

### Pass 1: DUMP

Author brain-dumps every interesting, counter-intuitive, sharp, lived, weird, or sticky idea on the chapter's topic. No filtering, no sequencing, no category, no length constraint. Editor captures verbatim into a working list.

Wide net by design. Target: 40-60 raw beat-candidates (more than will survive).

Editor prompts that help:
- "What's the counter-intuitive thing here?"
- "What's the scene from your own life that lands a piece of this?"
- "What's the part you keep coming back to in conversation?"
- "What's the reversal — the thing where the reader expected X and gets Y?"
- "What's the part where you go 'wait, but...'"
- "What's the part you'd put on a t-shirt?"

The DUMP must be unfiltered. Editor must not pre-judge what's "beat-sized" or "on-topic." Surprising material surfaces only when the author trusts the dump won't be criticized in flight.

### Pass 2: TENSION

For each raw beat, the editor tags:
- **What question does this beat ANSWER?** (the tension it resolves)
- **What question does this beat OPEN?** (the tension it primes — what the reader now wants to know)

Beats with no open question are dead ends. They land, but don't pull the reader forward. Flag for cut, merge, or repositioning at chapter close (where dead ends are fine — they're the resolution).

Beats with no answered question are non-sequiturs. Find the prior beat they SHOULD follow, or cut.

A clean beat: answers ONE question, opens ONE question. The dopamine handoff.

### Pass 3: CATEGORY

Tag each beat:

- **REVEAL** — new information lands, prediction-error fires
- **REFRAME** — old information gets re-seen in a new light
- **MECHANISM** — explains how/why something works
- **EVIDENCE** — proof for a prior claim (citation, study, data, scene)
- **SCENE** — lived experience that grounds an abstraction
- **APHORISM** — compressed claim, single-sentence beat
- **PIVOT** — directional turn (now we look at X)
- **REGISTER SHIFT** — emotional or rhetorical gear change

Confirm the MIX is right. All EVIDENCE reads academic. All APHORISM reads tweet-thready. All MECHANISM reads textbook. Good chapter has variety — typically 30-40% REVEAL/REFRAME, 20-30% EVIDENCE/MECHANISM, 10-20% SCENE, 10-15% APHORISM, with PIVOT and REGISTER SHIFT as connective tissue.

### Pass 4: SEQUENCE

Order beats by dopamine flow. Each beat's OPEN question becomes the next beat's TENSION.

Group section-beats under chapter-arc beats (B1, B2, etc).

Watch for:
- **Broken sequences** — beat N opens a question beat N+1 doesn't answer; reader waits and waits
- **Premature reveals** — payoff lands before setup primes the anticipation
- **Stacked openings without payoff** — chapter keeps promising and never delivers
- **Stacked payoffs without new tension** — chapter peaks then flatlines

The right sequence is the dopamine-optimal sequence — sometimes chronological, sometimes argumentative, sometimes thematic. Often it's the order where each beat hands the reader to the next.

### Pass 5: COMPRESSION

State each beat as one tweet-length sentence. If you can't compress it, it's still mush. The compression test forces the author to NAME the move precisely.

A beat that survives compression is shippable to the minion. A beat that requires three sentences to explain its move is two beats (or contains an embedded second beat). Split or cut.

### Final artifact

After all 5 passes: ~30 section beats grouped under 8-12 chapter-arc beats, each beat one sentence, ordered by dopamine flow, categorized by type. The Chapter Beat Map.

## The minion handoff

Chapter Beat Map becomes the minion's COMMITMENTS in the Apply Protocol TASK brief. Typical pattern:

- **One minion per chapter-arc beat** (B1, B2, ...) for long chapters
- Minion's commitments are the section beats under that chapter-arc beat
- Each section beat = one paragraph the minion writes
- Minion gets the beats, voice anchor, NEVER rules, examples — nothing else (no source prose, no prior chapter content unless substantively required)
- Cadence prescription varies per chapter-arc beat (see `docs/apply-protocol-deep.md`)

When the Beat Map has done its work — surface beats specific, sequenced, categorized, compressed — the minion's prose draft requires minimal surgery. The editor patches NEVER violations and meta-references; the structural shape was already locked at the beat layer.

## Per-author calibration: `voice/beat-math.md`

After the author's voice anchor exists, the editor calibrates beat math to their voice. Lives at `voice/beat-math.md`:

- **Target beats-per-chapter range** (e.g., "28-32 for a 6-7k word chapter")
- **Target words-per-beat average** (e.g., "~220, fast register")
- **Beat-category preferences** (which beat types this author hits best — e.g., "strong on REVERSAL beats and lived-SCENE beats, weaker on MECHANISM beats")
- **Beat density per chapter type** (different targets for tweet threads, essays, book chapters)
- **Author's coined beat shapes** (any reusable beat structures the author returns to)

Set up after the voice profile reaches Tier 1+ and the author has produced a few chapters/sections so density can be measured against output.

## Pipeline position

```
Argument Arc → Global Beat Sheet → Chapter Architecture → Reorg Beats by Chapter → Per-Chapter Beat Draft → Chapter Draft
                                                                                                              ↓
                                                                                                       Research Notes per chapter (companion)
```

Global Beat Sheet = raw material — every beat the book needs, no chapter assignment yet. Chapter Architecture chunks it into committed containers. Reorg sorts beats into containers. Per-Chapter Beat Draft refines per container. The per-chapter beat doc is pure beats inside a committed container, readable as the chapter's dopamine flow. Research Notes per chapter is the post-draft source-detail companion.

Full pipeline: `docs/long-form-orchestration.md`.

## When to skip beats methodology

- One-off short pieces (tweets, single-paragraph drafts, one-shot emails) — beats are overhead the piece can't earn back
- Iteration on already-drafted prose where structural rework isn't the goal — beats are upstream of prose, not downstream
- Author has a working draft they like and just wants polish — skip Beat Map, run Apply Protocol with existing prose as preservation-scope source

Beats methodology is the right investment for chapter-scale work, multi-section essays, and any piece where structure is load-bearing and the author wants the writing to land without massive post-draft surgery.
