# Privacy gate timing and provenance

## Context

This repository is public and its maintainer writes long-form prose in the
product itself. Personal material has leaked into it three times.

1. **2026-05-16 — test fixtures.** The block-identity matcher recognises
   paragraphs by the shape of their prose: sentence lengths, edge word
   sequences, punctuation rhythm. A convincing test wants writing that was
   really written and really revised. The nearest such writing was the
   maintainer's manuscript, so roughly 7,700 words of it became the corpus.
2. **2026-05-23 — bundled skill docs.** Worked examples needed a book
   workspace. The real one was open, so its name and vocabulary shipped.
3. **2026-09-20 — an internal instruction file.** `AGENTS.md`, a near-copy of
   the deliberately gitignored `CLAUDE.md`, was committed.

The first two were scrubbed (`551441e`, `297abc4`) and a denylist gate was
built. Neither stopped the third, and neither removed anything: a scrub edits
the current files and nothing else, so all of it remains in public history and
in the repository's fork. That was accepted knowingly in September 2026.

Two properties of the old design made recurrence certain.

**The gate ran too late.** It ran at publish and release. For a public repo the
push *is* the publication, so by release time content has been on GitHub for
days or weeks. A release-time gate can only ever confirm damage.

**The gate could only recognise what someone had already listed.** It was a
denylist of personal terms. It did not know the maintainer's two book titles
until 2026-09-21, four months after it was built, which is why incident 2
survived it. A denylist cannot cover an open-ended private vocabulary, and the
failure mode is silent.

Underneath both: the incentive is structural. Real material is permanently the
most convenient and most realistic input for tests and examples, because the
product is a writing tool and its author writes in it. Policing that is a
losing position; the fix has to remove the reason to reach for it.

## Current invariants

- **The push is the gate.** `scripts/check-push-privacy.mjs` runs from
  `.githooks/pre-push` and blocks before anything enters the public record.
  `core.hooksPath` is set by the root `prepare` script, so a fresh clone is
  covered without anyone remembering.
- **Added lines are scanned, not the resulting tree.** Content added in one
  commit and removed in a later one still lands in permanent history. Scanning
  only the final tree would have passed both historical scrubs.
- **Commits already on the remote are excluded.** Existing history, which is
  knowingly retained, never re-triggers the gate. Only new content is judged.
- **One definition of the rules.** Both gates import
  `scripts/privacy-patterns.mjs`. A second copy of a denylist is how a rule
  goes stale unnoticed.
- **Personal terms stay out of tracked files.** They live in the gitignored
  `scripts/privacy-denylist.local.json`. An earlier scanner listed them inline,
  publishing a labelled index of exactly what the maintainer considers private.
  Never move them back.
- **A denylist pattern that cannot match is a hard error.** A JSON `"\b"`
  decodes to a backspace rather than a word boundary, producing an entry that
  silently never fires. The loader exits rather than run blind.
- **Fixtures declare their origin.** Every corpus stage must appear in
  `corpus/SOURCES.md`, enforced by `scripts/check-fixture-provenance.mjs` at
  pre-push and at release. This is the half a denylist cannot do: it catches
  prose nobody thought to list, by refusing fixtures whose source was never
  stated.
- **The release-time whole-tree gate stays.** It answers a different question —
  "is the tree clean now?" — and catches drift the push gate never saw.

## Decision log

### 2026-09-21 — move the gate to the push boundary, add provenance

- **Change.** Added `scripts/privacy-patterns.mjs` (shared rules),
  `scripts/check-push-privacy.mjs` (pre-push, scans added lines of unpushed
  commits), `scripts/check-fixture-provenance.mjs` (corpus stages must declare
  a source), `.githooks/pre-push`, and `corpus/SOURCES.md`. Refactored
  `check-skill-privacy.mjs` onto the shared module. Wired provenance into
  `prepublish.cjs`. Root `prepare` script sets `core.hooksPath`.
- **Why.** Release-time checking cannot protect a public repo, and a denylist
  cannot cover vocabulary nobody enumerated. These are the two properties that
  let the same class of leak recur three times.
- **Verified.** The push gate exits 1 on a planted term, and still exits 1 when
  a second commit removes it — the precise pattern both historical scrubs used.
  The provenance check fails on an undeclared stage and passes on the current
  16. The refactored release gate is unchanged in behaviour, clean on a clean
  tree and failing on a planted term.
- **Not done.** History was not rewritten. The manuscript prose, the book
  titles and the old inline denylist remain readable in this repository's
  history and in its fork. That was the maintainer's call once the fork made
  full remediation dependent on a third party.
