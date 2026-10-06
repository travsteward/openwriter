# Beat Method

The shaping layer between extraction and voice. Owns: how extracted material gets locked as commitments for the voice layer to fill.

## Beat = type + job + slot

Every beat has three parts:

1. **Type** — the CATEGORY tag from extraction Pass 3 (CLAIM / REFRAME / MECHANISM / EVIDENCE / STORY / APHORISM / PIVOT / OBJECTION).
2. **Job** — the one-line purpose. What this beat must accomplish for the reader. The OUTCOME the reader registers.
3. **Slot** — what voice fills in. The actual prose, written in the operator's voice to fulfill the beat's job. No fixed length budget at this layer (no channel slot type) — the beat's natural density determines length.

## Beats are commitments, not content

Adopted verbatim from `/book-writer`. Every beat names the OUTCOME (what the reader registers / what shift lands). The voice layer brings the specific words.

**Failure mode**: editor packs the beat with specifics — "use this example," "cite this stat," "phrase it this way." Voice layer has nothing to invent; editor has quasi-written the prose by pre-selecting all the content. Voice goes flat.

**Correct shape**: each beat = one sentence naming the OUTCOME. Voice layer brings the words from training data + operator's anchor.

| Content brief (wrong) | Commitment (right) |
|---|---|
| "Open with: 'Most founders think X but the data shows Y.'" *(content pre-written)* | "Opening CLAIM beat — invert the conventional wisdom. Reader registers: I had this backwards." *(outcome)* |
| "Cite the 2019 sleep-deprivation cohort study on reaction time" | "EVIDENCE beat — land the empirical anchor. Reader registers: this isn't speculation." *(outcome)* |
| "Use the night-shift nurse example for circadian disruption" | "STORY beat — concretize the mechanism via a lived example. Reader registers: this is biology, not a lifestyle choice." *(outcome)* |

The right-column beat tells voice WHAT must land. Voice brings the words.

## Inject specifics into a beat (the exceptions)

- **Operator-unique content** — a coined term, a proprietary scene, a customer's exact words. List as MUST-APPEAR.
- **Load-bearing constraint** — callback to a specific prior beat, specific phrasing for argumentative reasons. Name it literally.
- **Operator has strong preference** — "use the night-shift nurse example specifically, not just any anecdote." Name it.

Otherwise: state the outcome, let voice bring the words.

## Density (no fixed budget, but density still matters)

`/beat-writer` doesn't have channel-specific slot types or constraint budgets — the channel isn't picked yet. But beats still have natural density:

| Density anchor | Words per beat | When it fits |
|---|---|---|
| Aphoristic | 30–80 | Standalone insight, claim, callout |
| Punchy | 80–200 | Quick reveal, mid-paragraph turn |
| Argumentative | 200–400 | One claim with reason + example |
| Developed | 400–600 | Mechanism walk, deep unpack |

Pick density per beat's job. Don't lock a uniform target — variation IS the rhythm.

## The handoff to /authors-voice

When a beat is locked (typed, job-committed), delegate prose to `/authors-voice` Apply Protocol with the OPERATOR'S DEFAULT ANCHOR (personal voice):

1. **Assemble the brief** — TASK = the beat's commitments (semantic, outcome-shaped — what must land, not how to phrase). Optional: cadence prescription for high-stakes prose. Preservation scope = pure generation (no source prose) unless rewriting existing material.
2. **Use the default anchor** — `/authors-voice` Apply Protocol loads `voice/anchor.md` automatically (operator's default). No anchor swap; this skill uses personal voice — that's the point of the channel-agnostic draft.
3. **Spawn the minion** via `/authors-voice` Apply Protocol — opus, general-purpose subagent, assembled skeleton.
4. **Receive prose**, patch any NEVER violations or brief-error meta-references (Apply Protocol step 6), integrate into the Draft doc by `docId`.
5. **Hand off to `/polish`** for the 90/100 push, then `/anti-ai`, then a naive-reader pass (`pipeline.md` Phase 7).

The editor (this skill) NEVER writes prose directly. Same Rule 1 as `/authors-voice`.

## Pipeline position

```
Extract → Beat Map (this doc) → Voice Pour via /authors-voice → Polish → Anti-AI → Congruence
                                                                                       ↓
                                                                              Optional: Refactor to channel-master
```

Full pipeline: `pipeline.md`. Refactor handoff: `refactor.md`.
