# Chapter Architecture

Phase: container commit. Output: committed TOC — N chapter containers, each with a substantive chapter brief, a one-sentence promise, a validated adjacent boundary, source/beat mapping. Run unconditionally for book-scale work.

**There are two pipelines, determined by the book class. Run the book-class question FIRST.**

## The book-class question (run FIRST)

Before any chapter work, answer: **what kind of book is this?**

Two classes, two pipelines:

### Argument-driven books
One extended argument is the value. Newport (*Deep Work*), Pinker, Haidt, popular essays that became books. The author's value-add is the argument itself; chapters are beats of the argument.

**Inputs:** Argument Arc, Global Beat Sheet.
**Pipeline:** Argument Arc → Global Beat Sheet → Chapter Architecture (5-pass) → Reorg → Per-Chapter Beats → Draft.

### Domain-driven books
Popular science / reference-rich / source-material-heavy. Sapolsky's *Behave*, Wrangham's *Catching Fire*, Dawkins' *Selfish Gene*, Christopher Ryan's *Sex at Dawn*. The author has pre-existing concept docs / research / a knowledge graph. The book's value is the COMPLETE PICTURE of a scientific or conceptual terrain. Chapters = the domains; the through-line is implicit, never stated as a single argument.

**Inputs:** Source-material inventory (concept docs, research notes, prior drafts), optionally an Argument Arc as implicit through-line.
**Pipeline:** Source Inventory → Domain Identification → Act Grouping → Chapter Pattern → Candidate TOC → Reshape → Lock → Pilot.

### How to decide

| Signal | Class |
|---|---|
| Author has an extended argument to make, no existing knowledge graph | Argument-driven |
| Author has a rich source library / concept docs / research notes | Domain-driven |
| Author has both | Domain-driven (the argument becomes implicit through-line) |
| Author has neither yet | Argument-driven (build the arc first to discover the book) |
| Book is prescriptive/transformation popular science | Domain-driven default — argument-driven starves on prescription |
| Book is one big idea unpacked | Argument-driven |
| Book is "the complete picture of X domain" | Domain-driven |

When in doubt for popular-science / reference / transformation work: **domain-driven is the better default**. Argument-driven books in this class collapse into one abstract action call ("fix your light, time your meals, protect your wind-down") that doesn't justify the word count. Domain-driven books deliver a complete operating picture; the reader leaves changed because he sees himself as evidence, not because he was told what to do.

## Pipeline A: Argument-driven (one-argument book)

### Where it sits

```
Argument Arc                    (book's logical spine)
  ↓
Global Beat Sheet               (all beats for the book, pre-chapter)
  ↓
CHAPTER ARCHITECTURE            ← 5-pass commit
  ↓
Reorg Beats by Chapter          (sort global beats into committed containers)
  ↓
Per-Chapter Beat Draft          (refine the per-container beat list)
  ↓
Chapter Draft                   (minion materializes prose, beat by beat)
```

Hybrid order is the model that holds: pure top-down (chapters from just the Argument Arc) fails for lack of evidence; pure bottom-up (per-chapter beats without containers) fails for lack of structure. Architecture reads the beat sheet as evidence ("what bounded chunks does this material naturally form?") and commits container shapes the beats can be sorted into.

### Pass 1: ARC + BEATS RE-READ

Editor and author re-read Argument Arc AND Global Beat Sheet together. Not as outline — as content. What does the book argue? What beats exist as raw material? Arc shows the spine; beats show the texture.

### Pass 2: CHUNK (with beats as evidence)

Editor asks: "Looking at the arc and the beat sheet together — what bounded conceptual chunks does this material naturally form? Which beats cluster?"

Author talks. Editor structures the chunks as candidate chapter containers using beat-sheet clustering as evidence. No naming yet. Count is whatever falls out — typically 5-12, driven by material not a target.

Query-first principle from `docs/beats.md`: editor STRUCTURES what the author is grouping, doesn't propose chunks from cold.

### Pass 3: NAME

For each candidate container: "What is the chapter brief — the one-sentence statement of what this chapter does for the reader?"

Each name must be substantive (telegraphs content, not category), declarative or descriptive (claims something specific), holdable in one sentence.

Test: can the author state the chapter's brief without looking at the arc? No → container hasn't crystallized; return to Pass 2.

### Pass 4: BOUNDARY VALIDATION (fuzzy is OK; shape must be right)

For each pair of adjacent containers:
- Do they share central concepts? (Spillover = wrong boundary)
- Is one too big / too thin? (Split or absorb)
- Does the transition feel natural? (Forced = wrong boundary)

Boundary commits as chunk SHAPE. Per-beat assignment refines in Reorg. Don't burn cycles on a single beat's home in Pass 4.

### Pass 5: COMMIT TOC

Output: chapter number, name, one-sentence promise, word target, arc-beat mapping. Reorg begins immediately after.

## Pipeline B: Domain-driven (source-material-rich book)

### Where it sits

```
Source Material Inventory          (read existing concept docs / research)
  ↓
Domain Identification              (natural containers → candidate domains)
  ↓
Act Grouping                       (3-act book structure: cluster domains)
  ↓
Chapter Pattern                    (4-act internal structure per chapter)
  ↓
Candidate TOC                      (title + beats + vignette slots + sources)
  ↓
Author Reshape (inline comments)
  ↓
Lock + Pilot                       (one chapter end-to-end to validate format)
  ↓
Draft the rest                     (pattern validated, proceed in parallel)
```

The pipeline reverses the argument-driven order: instead of "build the argument, then chunk it into chapters," it's "see what's already in the source material, find the natural domains, group into acts, design the chapter pattern, draft the TOC against what exists." Source-driven, not argument-driven.

### Phase 1: Source Material Inventory

Read or surface the author's existing material:
- If author has an OpenWriter Concepts workspace: `list_workspaces` → `get_workspace_structure` surfaces the structure. Crawl each container's docs for first paragraph (lightweight — don't read full bodies yet).
- If material is in files/notes scattered around: glob/grep to inventory. Get titles + first paragraphs into a single survey doc.
- If author has prior book drafts: list those too (they become vignette material later, not chapter material).

Goal: know what the author already has authority on. The inventory is the WORKING SET that all subsequent decisions reference.

### Phase 2: Domain Identification

**The natural groupings in the source material ARE the candidate scientific/conceptual domains.** Don't impose categories from outside.

If the Concepts workspace has containers (e.g., Sleep Pressure / Circadian Rhythm / Dreaming / Sleep Debt) — those containers are the candidate domains. If material is unstructured, propose groupings to the author and let them confirm.

Each domain becomes a CANDIDATE chapter (or 2-3 chapters if dense enough). Domain count per book typically 5-8 for trade nonfiction.

Note thin domains (1-2 docs only) — they may need to be absorbed into adjacent richer domains, or expanded with new source material.

### Phase 3: Act Grouping (3-act book structure)

**Cluster the domains into 3 acts that produce a coherent emotional/conceptual flow at book level.**

The 3-act grouping is the dopamine flow above chapter level. It's the meta-structure the reader feels even if it's never named. Typical patterns:

| Act pattern | Best for |
|---|---|
| Architecture / Mechanism / Behavior | Popular science. "What you are / how it works / how you live as it." |
| Diagnosis / Reframe / Practice | Transformation books with prescriptive lean |
| Origin / Evolution / Manifestation | Narrative-history popular science |
| Foundation / Forces / Application | Reference-rich domain books |

The 3-act grouping is for the author's structural clarity and the reader's emotional flow. **Acts don't need to be labeled in the book itself** — they're often invisible to the reader, but they make the chapter sequence feel like a journey rather than a checklist.

Chapter count per act is driven by source density. Roughly balanced is ideal (3+3+3 or 4+3+3), but uneven is fine if the material demands it.

### Phase 4: Chapter Pattern (4-act internal structure)

**Every chapter runs the SAME internal pattern. Defining the pattern explicitly is load-bearing — it's what makes domain-driven books feel coherent across chapters even when the domains are heterogeneous.**

The 4-act chapter pattern:

1. **Introduce the mechanism.** The science. What it is, how it works, why it exists.
2. **Explore the logic.** Comparative evidence (other species, ancestral data, cross-cultural examples), the implications of the mechanism, the deep unpack.
3. **Bridge to modern (vignettes).** Short 200-400 word a-ha moments showing the mechanism operating in current life. Punctuation, not main course. See "Vignette library" below.
4. **Setup next.** The implication that pulls the reader to the next chapter.

**Why this pattern is load-bearing for domain-driven books:**

Bridge-to-modern vignettes are how a domain-driven book delivers prescription WITHOUT self-help register. The reader sees the mechanism running in his actual life via the vignettes — and the action becomes obvious from accuracy. No "now do these 5 things" chapter is needed because the reader has already seen himself as evidence.

This is the structural answer to "how does a popular science book transform the reader without becoming a self-help book." Sapolsky's *Behave* does this. Wrangham's *Catching Fire* does this. The reader closes the book changed, but at no point was he prescribed a behavior change.

### Phase 5: Candidate TOC draft

For each chapter: **title + word target + 5-8 beats + bridge-to-modern vignette slots + source-doc mapping.**

Format: compact, scannable, one screen if possible. The candidate TOC is for the author to react to, not to read as prose.

```
### Ch N — Chapter Title  (Xk words)
- Beat one in short form
- Beat two
- ...
- *Vignettes:* candidate a-ha drops for the bridge-to-modern section
- *Sources:* Concept docs / research notes the chapter draws from
```

The source-doc mapping is critical. It:
- Prevents drift (chapter can be traced back to canonical source material)
- Lets the author verify coverage (no domain doc orphaned)
- Makes chapter drafting straightforward (the drafter knows what to read first)

### Phase 6: Author reshape via inline comments

Hand the candidate TOC to the author. **Author marks up directly via inline comments on the TOC doc** (or the editor's equivalent — OpenWriter agent marks, Google Docs comments, etc.). Editor reads the comments, identifies which are structural changes vs content additions vs confirmations, and updates the TOC accordingly.

Author owns substance; editor owns structure. Don't argue with author comments — incorporate or ask one clarifying question.

Iterate v1 → v2 → v3 until the author signals the shape is right ("this matches my view perfectly"). Resolve comments after each pass so the doc stays clean.

### Phase 7: Lock spine + pilot

Once author approves the reshape, **lock the TOC**.

Then pick ONE chapter to pilot end-to-end with the 4-act pattern — typically the chapter with the **densest source material** (lowest risk, fastest validation). The pilot tests the format: does the 4-act pattern work, do the vignettes land, does the chapter promise hold across the word count?

After pilot validation, the rest of the chapters draft in parallel against the validated pattern.

## The 4-act chapter pattern (deeper unpack)

Both pipelines benefit from a defined internal chapter pattern. For domain-driven, the 4-act pattern above is the load-bearing default. For argument-driven, the chapter pattern is usually simpler: setup → argument-beat → evidence → bridge.

### Act 1: Introduce the mechanism
- The scientific claim, named cleanly
- What it is, in plain language
- Why it exists (the evolutionary / structural reason)
- Establish the conceptual handle the rest of the chapter uses

Length: ~10-15% of chapter word count.

### Act 2: Explore the logic
- Comparative evidence (other species, other cultures, ancestral data)
- Deep unpack — the science with rigor, not abstraction
- Implications — what follows from the mechanism being true
- This is where the chapter EARNS the reader's belief; the science gets the room

Length: ~50-60% of chapter word count.

### Act 3: Bridge to modern (vignettes)
- 2-5 short vignettes (200-400 words each) showing the mechanism in current life
- Each vignette is punctuation, not main course — quick a-ha, then back to the science
- Vignettes drop in naturally where the science calls them, not as a separate section break
- The reader sees himself / sees current culture as the mechanism running

Length: ~20-25% of chapter word count, distributed throughout Acts 2 and 3.

### Act 4: Setup next
- The implication that the next chapter resolves
- The question the reader is now sitting with
- The pull that makes him turn the page

Length: ~5-10% of chapter word count.

### Failure modes
- **All mechanism, no bridge.** Chapter feels academic. Reader respects it but doesn't change.
- **All bridge, no mechanism.** Chapter feels like pop-culture writing. Reader skims.
- **Bridge as a separate section break.** Loses the inline rhythm. Vignettes should weave into the science, not punctuate from outside.
- **No setup-next.** Chapter ends. Reader closes the book.

## The 3-act book grouping (deeper unpack)

Acts at book level are the meta-structure above chapters. The reader rarely notices them explicitly, but they make the chapter sequence feel like a journey.

The act grouping answers: "What's the emotional flow across chapters?" Typical answers:

- **Architecture / Mechanism / Behavior** — what you are, then how it works, then how you live it.
- **Diagnosis / Reframe / Practice** — current state, new frame, new operation.
- **Origin / Evolution / Manifestation** — where it came from, how it changed, where it lives now.

**The 3-act grouping is a tool for the author, not a label for the reader.** Most domain-driven books don't print "Act 1" / "Act 2" / "Act 3" on the page. They just feel structured because the author grouped that way during architecture.

### When to use 4 acts vs 3

3 is the default. 4 works if the book has a clear closing synthesis chapter that stands apart from the prescription/manifestation act. Example: 3 acts of domain exposition + 1 closing chapter that pulls the whole picture together.

Don't go above 4 — beyond that, the reader can't hold the structure.

## The vignette library (flat, deploy by natural fit)

Vignettes are 200-400 word a-ha moments showing a scientific mechanism operating in modern life. The bridge-to-modern Act 3 of every chapter deploys vignettes.

### Library architecture

**Flat library, not pre-mapped to chapters.** Each vignette is its own short doc (or its own paragraph block in a single Vignettes doc). Tagged with the concepts it relates to. Vignettes deploy WHERE THEY NATURALLY FIT during chapter drafting — the science calls forth which vignettes drop in.

**Don't pre-assign vignettes to chapters.** Pre-assignment forces decisions before they need to be made. Flat library + natural-fit deployment is more flexible and matches how chapter drafting actually works.

### Vignette extraction

Sources for vignettes:
- **Prior book drafts (agent extracts).** Full chapters from prior drafts often distill to single 300-word vignettes in the new structure (the chapter's a-ha core, stripped of the scaffolding). The author already wrote them; the agent compresses.
- **Research notes (agent extracts).** Specific studies, case stories, surfaced moments worth naming.
- **The author's own observations (AUTHOR PROVIDES).** Field examples, personal anecdotes, lived recognitions. Agent never invents these — it asks. See "Scene = author, science = agent" below.
- **Cultural moments worth naming (mixed).** The looksmaxxer subculture. The QB as cultural icon. The rockstar enchanting the crowd. Agent can surface candidates from observable culture; if the vignette requires lived experience of the moment to land, ask the author.

### Vignette form

- 200-400 words. Shorter is better. Long-form is a sign the vignette wants to be a chapter (or is hiding multiple a-ha moments — split).
- Single mechanism per vignette. Don't try to make one vignette do double duty.
- Visceral, concrete, specific. Not abstract claim. Not list. A moment, a scene, a recognition shock.
- Ends without a moral. The mechanism speaks; the reader draws the implication.

### Inventory pass

Run a light vignette inventory pass during chapter drafting, not before. For each chapter being drafted, scan the vignette library for natural-fit candidates, drop them into the bridge-to-modern act. Iterate.

## Scene = author, science = agent (firm rule)

A load-bearing division of labor across both pipelines and every chapter: the AUTHOR supplies scenes; the AGENT supplies science. Violating this produces inauthentic books regardless of how polished the prose is.

### Definitions

**Scene** = any lived moment, autobiographical material, personal observation, recognition shock, specific human experience. The vignettes that drop into Act 3 of every chapter. The opening hook of an introduction. A credibility paragraph. Any place the reader needs to feel a person, not a model.

**Science** = mechanism, evidence, comparative biology, theory, structure, exposition, transitions, implication, setup-next hooks. Everything around the scene.

### The rule

The agent NEVER invents scenes. When a beat or section calls for lived material, the agent inserts a placeholder and asks the author:

```
[SCENE PLACEHOLDER — author provides]
What the slot needs: <one-line description>
Candidate moments from author's known material:
- <option from author's life / prior writing>
- <option>
- <option>
```

The author drafts 1-2 paragraphs of raw lived material (or signals which candidate to develop). The agent produces everything around it — opening framing, transition into the scene, implication after.

### Why

Invented scenes lack lived detail. Readers detect agent-confected experience instantly — the wrong sensory beats, the too-clean arc, the absent specific that someone who was actually there would have noticed. A book of agent-invented scenes reads as inauthentic even when technically polished.

The author's voice lives in the scenes. The agent's voice can carry the science. Mixing this up — author drafts dry mechanism, agent invents lived moments — produces the worst of both: the book reads as inhuman AND under-evidenced.

### When to ask vs when to write

| Material type | Source |
|---|---|
| Lived moment / personal anecdote | Author |
| Vignette (bridge-to-modern) | Author for the moment; agent for framing |
| Opening hook (introduction or chapter) | Author |
| Author credibility / biographical paragraph | Author |
| Cultural moment used as vignette | Either; if author has lived it, prefer author |
| Mechanism / theory / exposition | Agent |
| Comparative biology / cross-species evidence | Agent |
| Research synthesis / citations | Agent |
| Transitions between beats | Agent |
| Setup-next chapter hooks | Agent |
| Implication / "what follows" | Agent |

### Workflow

1. Agent identifies that a beat needs lived material
2. Agent inserts `[SCENE PLACEHOLDER — author provides]` with one-line description + 2-4 candidate scene TYPES pulled from the author's known life / source material (NOT invented scenes)
3. Author drafts 1-2 paragraphs of raw lived material, or names which candidate to develop
4. Agent produces everything around the scene — opening framing, transition into the scene, implication after, link to next beat

### Sub-rule: don't invent candidate scenes either

Drafting three "candidate opening hooks" for the author to pick from is still invention — even framed as a menu. The scenes aren't real and the author shouldn't have to react to confected material as if it were a real choice.

What the agent CAN do: list candidate scene SLOTS pulled from the author's known life / prior writing / source material ("the all-nighter that backfired," "the first week with a sleep tracker," "the jet-lag conference disaster"). The author then picks a slot and writes the actual scene.

What the agent CANNOT do: draft prose pretending to be the author's lived moment. Even labeled "candidate" or "draft for review" — it pollutes the doc and primes the author to react to fiction instead of supplying truth.

### Operational rule for chapter and intro drafting

Before drafting any section that calls for lived material:
1. STOP — do not draft the scene.
2. Insert the placeholder + slot candidates.
3. Ask the author which slot to develop, or ask for a fresh slot from his life.
4. Wait for the author's 1-2 paragraphs.
5. Resume drafting everything around the scene.

This applies to both pipelines. It applies in beats. It applies in introductions. It applies in transitions. It applies anywhere the human animal is required and the model is not enough.

## What a committed chapter container is (both pipelines)

1. **Bounded conceptual chunk.** Holds ONE coherent move. If describing requires "and also" multiple times, container is wrong — split, or rename to bundle under a unified frame.
2. **Substantive name (the chapter brief).** Names like "The Missing Manual" or "Sleep Pressure: The Chemistry of Tiredness" telegraph what's inside. Categorical labels ("Chapter 1", "Hook", "Setup", "Diagnosis") don't.
3. **Boundaries that don't bleed (but are fuzzy at commit).** Adjacent chapters don't share territory. Boundary SHAPE commits at architecture time. Per-beat assignment refines in Reorg.
4. **Holdable size.** Too big = reader can't carry. Too thin = the chapter is actually a sub-beat of an adjacent chapter.

## Downstream: Reorg Beats by Chapter (argument-driven only)

For argument-driven books, after TOC commits, sort the Global Beat Sheet INTO the chapter containers using the chapter brief as the test.

For domain-driven books, Reorg is unnecessary — chapter sources are already mapped (Phase 5 of the domain-driven pipeline). The equivalent step is the **vignette inventory pass** that runs during chapter drafting.

## Workspace implication (Book Mode integration)

Chapter containers in `docs/book-mode.md` get created AFTER the TOC commits. Container shape stays the same regardless of pipeline.

When TOC shifts (chapters merge, split, rename), update container structure in lockstep and move docs into their new homes. **NEVER DELETE** any chapter container — merged or absorbed chapter container becomes a Variant of the receiving chapter, preserving the work.

## When chapter architecture must re-run

- Argument Arc shifts materially (argument-driven)
- New source material lands that changes domain identification (domain-driven)
- Author re-class: book turns out to be the other class than originally assessed
- Chapter beats consistently feel "too much" or "too thin"
- Reader feedback shows confusion at chapter boundaries
- A new conceptual frame emerges that re-groups chapters more coherently

Architecture passes are cheap. Beat work in wrong containers is expensive. Re-validate when in doubt.

## Anti-patterns

- **Skipping the book-class question.** Defaulting to argument-driven because that's what `chapter-architecture.md` historically documented. For prescriptive popular science, this produces a "narrow" book — heavy diagnosis, thin prescription, one abstract action call. Always run the book-class question first.
- **Pillar method as the back-half fix.** Recognizing the argument-driven book is starving on prescription and bolting on a pillar-method back half (body / marriage / work / etc.). This works but turns the book into self-help. If the author wants popular science, switch to domain-driven and use the 4-act pattern + vignettes instead.
- **Inherited TOC unvalidated.** Chapter list fixed because someone wrote one. Validate through the protocol for the current book class.
- **Per-chapter beats before containers.** Generating beats inside a specific chapter before chapter containers are committed.
- **Architecture without source/beat evidence.** Trying to commit chunks in the abstract.
- **Categorical chapter names.** "Hook", "Setup", "The Central Thesis", "Mechanism", "Diagnosis" — writer's working labels, not reader's holding units.
- **Forcing a target count.** Right count is whatever the material's conceptual chunks demand.
- **Vignettes pre-mapped to chapters.** Forces decisions before they need to be made. Flat library, natural-fit deployment.
- **Vignettes as section breaks.** Loses the inline rhythm. Vignettes weave into the science, not punctuate from outside.
- **No 3-act book grouping (domain-driven).** Chapter sequence reads as a checklist rather than a journey. Group into acts even if invisible to the reader.
- **Agent invents scenes.** Drafting lived moments, autobiographical hooks, or "candidate" scene options for the author is invention even when labeled as a draft. ASK; don't write. See "Scene = author, science = agent" above.

## Pipeline (full reference)

```
Argument-driven:
  Argument Arc → Global Beat Sheet → Chapter Architecture (5-pass) → 
  Reorg Beats by Chapter → Per-Chapter Beat Draft → Materialized Beats → Manuscript

Domain-driven:
  Source Inventory → Domain Identification → Act Grouping → Chapter Pattern → 
  Candidate TOC → Reshape → Lock → Pilot → Draft (in parallel)
```

Each phase commits before the next begins. When a later phase exposes a problem with an earlier phase, return to that phase, fix, re-commit, propagate forward.

## When to skip chapter architecture

For one-off pieces (single essays, blog posts, tweets, threads) — sub-chapter scale, no boundaries to validate.

For book work: NEVER skip. Even if the book seems to have a "natural" structure, validate as a chapter-architecture pass (using whichever pipeline matches the book class). One architecture session saves weeks of beat rework.

## Precedent in the writing literature

- **Zinsser, *On Writing Well*** — chapter is the unit of organization.
- **Adler, *How to Read a Book*** — book is a hierarchy of containers; well-structured book = reader can restate each chapter's claim in one sentence.
- **Sol Stein, *Stein on Writing*** — chapter shape is the load-bearing decision.
- **McKee, *Story*** — every act/chapter is a promise + payoff. PROMISE is the chapter's identity.
- **Sapolsky, *Behave*** — domain-driven popular science exemplar; chapters organized by biological time scale, 4-act internal pattern.
- **Wrangham, *Catching Fire*** — domain-driven popular science exemplar; narrow thesis explored across ethological domains.
- **Newport, *Deep Work*** — argument-driven exemplar with structural Part 1 (argument) / Part 2 (practices) split.

Formal terms across these traditions: **chapter brief**, **chapter promise**, **chapter logline**. All describe the same thing — the one-sentence statement of what the chapter does for the reader.
