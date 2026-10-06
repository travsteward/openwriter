---
name: anti-ai
description: |
  Anti-AI detection pass for any written text. Hard rules that strip the
  statistical fingerprints AI writing leaves behind — em-dash density,
  contrastive formula ("not X, it's Y"), nuclear phrases, copula inflation,
  sycophantic filler, uniform contractions, colon overuse, register
  monotony. Two tiers: hard rules (always fix) and voice-gated checks
  (verify against voice profile if present).

  Use when: "/anti-ai", "anti-ai pass", "anti-ai check", "strip ai signals",
  "does this sound like ai", "ai detection check", "humanize this",
  "remove ai fingerprints".
metadata:
  author: travsteward
  version: "0.1.1"
license: MIT
---

# Anti-AI Detection Rules

Two tiers. Tier 1 rules are **hard rules** — fix unconditionally, no voice profile override. These patterns are so statistically associated with AI that detectors flag them regardless of context. Tier 2 rules are **voice-gated** — check against the voice profile before fixing.

---

## Tier 1: Hard Rules (Always Fix)

**Em-dashes — eliminate, then calibrate.** AI uses em-dashes at 5-10x human density. This is one of the strongest AI signals.
- **Default (no profile or generic voice)**: Zero em-dashes. Convert to periods, commas, or parentheses.
- **With voice profile**: Check the author's samples. If they use em-dashes, match their frequency — never exceed it. An author at 1 per 300 words gets 1 per 300 words. An author who never uses them gets zero.

**Contrastive formula — never use.** These constructions are AI fingerprints:
- "It's not X, it's Y" / "This isn't X, it's Y"
- "Rather than X, we should Y"
- "Instead of X, consider Y"
- "Not merely X, but Y"
Rewrite without the formula. State the point directly.

**Nuclear phrases — kill on sight.** These phrases are 100-900x more frequent in AI text than human text. No human writes them at this density:
- "valuable insights" (902x) · "indelible mark" (319x) · "rich tapestry" (227x)
- "crucial role in shaping" (250x) · "adds a layer of complexity" (194x)
- "a stark reminder" (151x) · "fostering a sense" (138x) · "nuanced understanding" (115x)
- "unwavering commitment" (256x) · "multifaceted nature" (92x) · "beacon of hope" (58x)
- "delve deeper" (72x) · "navigate the complex" (87x) · "transformative power" (74x)
- "shed light on" · "serves as a testament" · "underscores the importance"

**Copula avoidance — use simple verbs.** AI replaces "is" with "serves as", "has" with "boasts", "shows" with "underscores." This is a telltale pattern. Use the simple verb.

**Sycophantic filler — cut unconditionally.** "Interestingly", "It's worth noting", "Notably", "It is important to note that", "It's crucial to understand" — these are AI padding. Delete them. They add nothing.

**Contraction consistency — mix intentionally.** Uniform contraction use (100% contractions OR 100% expanded) is an AI signal. Real humans are inconsistent. Use "don't" in one sentence and "does not" three sentences later. The inconsistency IS the authenticity signal. Check the voice profile (if present) for specific guidance.

**Colon density — cap usage.** AI overuses colons. Cap at about 1 per 400-500 words, or at the voice profile's observed rate if lower.

**Register uniformity — break it.** AI maintains a single consistent register throughout. Real writing mixes formal vocabulary with casual asides, academic precision with colloquial reactions. Intentionally vary register within a piece. This is the "bidirectional sophistication" principle from empirical testing (GPTZero 100% → 3%).

---

## Tier 2: Voice-Gated Checks (Check Profile First)

These patterns are suspicious but may match the author's voice. Check the profile before fixing.

- **AI vocabulary**: "additionally", "furthermore", "landscape", "tapestry", "interplay", "pivotal", "delve", "paradigm", "leverage", "robust", "seamlessly" — check every word against the author's diction. If they don't use it, you can't either
- **Inflated significance**: "marking a pivotal moment", "a significant milestone" — does the author elevate this way? If not, cut it
- **Vague attribution**: "Experts argue", "Studies show" — does the author cite this way or make direct claims?
- **Formula transitions**: "Despite these challenges", "Future Outlook", "In conclusion", "Moreover", "Furthermore" — does the author use these? Check discourse rules
- **Rule of three**: Forcing ideas into triplets. Some authors do this naturally (check rhetoric rules). If not, break it
- **Elegant variation**: Cycling synonyms — "the man...the individual...the person." Use whatever the author would repeat
- **Sentence length uniformity**: AI defaults to medium-length sentences. Check your short/medium/long/very-long percentages against the author's distribution. Force variation to match
- **Too-clean structure**: AI writes perfect essay structure. Real writing has asides, interruptions, unexpected turns. Match the author's discourse patterns
- **Uniform paragraph length**: AI writes ~3-4 sentence paragraphs consistently. Match the author's paragraph rhythm from samples
- **Mid-formal default**: AI gravitates toward neutral professional register. Match the author's register exactly, even if blunt, profane, or fragmentary
- **Hedging where the author asserts**: "could potentially", "it might be argued" — if the rhetoric rules say direct claims, delete all hedging

---

## Final Check

Re-read the complete output:
1. Count em-dashes. No profile: should be zero. With profile: does the count match the author's observed frequency? Convert any excess
2. Scan for any contrastive formula. Rewrite if found
3. Grep for nuclear phrases. Kill any survivors
4. Check contraction consistency. Are contractions mixed inconsistently (not 100% one way)?
5. Count colons. Within the frame's limit?
6. Check register variation. Is the tone monotonously consistent, or does it mix naturally?
7. Scan for copula inflation ("serves as", "boasts", "underscores"). Simplify to plain verbs
8. Would a reader who knows this author believe they wrote this?
9. Does any sentence sound like "AI writing" rather than this specific person?

If anything fails, rewrite that section. Don't patch — rewrite using the samples as reference.

---

## Usage

When invoked on a piece of text:
1. Run all Tier 1 checks unconditionally. Fix every match.
2. If a voice profile was used to write the text, the Tier 2 decisions are already pre-resolved — verify they hold. Otherwise, default-resolve Tier 2 toward plain language.
3. Re-read the full output against the Final Check list before declaring done.

Pairs with `/authors-voice`, which runs this as its final fingerprint scrub.
