# Corpus provenance

Every stage in this directory must appear below with a declared source.
`node scripts/check-fixture-provenance.mjs` fails if a stage is missing, and
that check runs at pre-push and at release.

## The rule

**Fixture prose is written for the fixture. It is never copied, paraphrased, or
sliced from a real document — not the maintainer's, not a user's, not a
customer's.**

This directory is the reason the rule exists. The block-identity matcher
recognises paragraphs by the *shape* of their prose: sentence lengths, word
sequences at the edges, punctuation rhythm. Testing it convincingly wants
writing that was really written and really revised, and the nearest such
writing is always whatever the maintainer happens to be working on. That is how
an unpublished manuscript ended up in this repository in May 2026, and it is
still in the public history, because a scrub removes content from the current
files and from nowhere else.

So the temptation is structural, not a lapse of attention, and the answer is a
source that is always at hand and always safe.

## Where to get prose for a new stage

1. **Extend an existing source below.** Preferred. The registered sources are
   written to have ordinary prose statistics — varied sentence length, real
   punctuation, paragraphs that differ from one another.
2. **Write new prose about a neutral technical or everyday subject.** Give it
   uneven sentence lengths. Uniform, generated-looking filler is not just
   unsafe practice, it is a *weaker test*: it lacks the collisions and
   near-misses the matcher has to survive.
3. **Public-domain text** is acceptable if you record the work and its edition
   here.

Never: your own drafts, anything out of a live OpenWriter workspace, anything
from a user, or a paraphrase that keeps a real document's structure.

## Registered stages

| Stage | Source |
|---|---|
| stage1-flat | Written for the fixture. Sleep and circadian rhythm, plain register. |
| stage1b-flat-adversarial | Written for the fixture. stage1 prose plus deliberate near-duplicate blocks. |
| stage2-structured | Written for the fixture. Headings and lists over the same neutral subject. |
| stage3-inline-marks | Written for the fixture. Short prose carrying inline emphasis, links and code. |
| stage4-nested | Written for the fixture. Nested list and quote structures. |
| stage5-adversarial | Written for the fixture. Blocks chosen to collide under the fingerprint. |
| stage6-type-changes | Written for the fixture. Same text across paragraph, heading and list forms. |
| stage7-graveyard | Written for the fixture. Minimal blocks exercising delete and restore. |
| stage8-large-doc | Written for the fixture. A distributed-systems field guide, long-form. |
| stage9a-single-block | Written for the fixture. One block, edge case. |
| stage9b-all-headings | Written for the fixture. Headings only, no body prose. |
| stage9c-math-collisions | Written for the fixture. Blocks with identical character counts. |
| stage9d-long-paragraph | Written for the fixture. One long unbroken paragraph. |
| stage9e-empty-doc | Empty by definition. No prose. |
| stage9f-deeply-nested | Written for the fixture. Deep nesting, little text. |
| stage9g-tiny-blocks | Written for the fixture. Very short blocks, edge case. |

Adding a stage: create the directory, add its row here, run the check.
