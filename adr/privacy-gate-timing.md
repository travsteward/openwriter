# Privacy gate timing and provenance

## Context

This repository is public, and the product is a writing tool whose maintainer
writes in it. Personal material has reached the tree on three separate
occasions, by three different routes:

1. **Test fixtures.** The block-identity matcher recognises paragraphs by the
   shape of their prose: sentence lengths, edge word sequences, punctuation
   rhythm. A convincing test wants writing that was really written and really
   revised, and invented filler has uniform, artificial shape that passes tests
   the real thing fails. So the pressure is to reach for real writing.
2. **Bundled skill docs.** Worked examples needed a realistic workspace, and a
   real one was open.
3. **An internal instruction file.** A near-copy of a deliberately gitignored
   file was committed, because the public twin had no rule attached to it.

Each was cleaned up when found, and a denylist gate was added after the first.
The gate did not prevent the later ones. Two properties explain why, and both
are design faults rather than lapses of attention.

**The gate ran too late.** It ran at publish and release. For a public repo the
push *is* the publication — content is live and permanent the moment it lands,
and editing it afterwards changes the current files and nothing else. A
release-time gate can only ever confirm damage.

**The gate could only recognise what someone had already listed.** It was a
denylist of personal terms, and a denylist cannot cover an open-ended private
vocabulary. Terms that were never added were never caught, and the failure was
silent: the gate reported clean.

Underneath both, the incentive is structural. Real material is permanently the
most convenient and most realistic input for tests and examples here. Policing
that is a losing position, so the design has to remove the reason to reach for
it and has to fail closed when it cannot.

## Current invariants

- **The push is the gate.** `scripts/check-push-privacy.mjs` runs from
  `.githooks/pre-push` and blocks before anything enters the public record.
  `core.hooksPath` is set by the root `prepare` script, so a fresh clone is
  covered without anyone remembering a setup step.
- **Added lines are scanned, not the resulting tree.** Content added in one
  commit and removed in a later one still lands in permanent history. A check
  that reads only the final tree sees a clean repo and passes.
- **Commits already on the remote are excluded.** Only new content is judged,
  so the gate stays quiet about the past and loud about the present.
- **One definition of the rules.** Both gates import
  `scripts/privacy-patterns.mjs`. A second copy of a denylist is how one copy
  goes stale unnoticed.
- **Personal terms stay out of tracked files.** They live in the gitignored
  `scripts/privacy-denylist.local.json`. A tracked denylist would publish a
  labelled index of exactly what the maintainer considers private, which is
  worse than most of what it protects. Never move them into the repo.
- **A pattern that cannot match is a hard error.** A JSON `"\b"` decodes to a
  backspace rather than a word boundary, producing an entry that silently never
  fires. The loader exits rather than run blind.
- **A gate that cannot read its rules refuses.** Missing rules mean "cannot
  check", never "nothing to check". The loader exits non-zero instead of
  reporting clean, and every passing run states which rule sets actually ran.
- **Worktrees source the one denylist, they do not get a copy.** A worktree
  checks out tracked files only, so the gitignored denylist is not in it. The
  loader derives the main checkout from the shared git directory and reads the
  file there. A copy per worktree would drift, which is the same silent failure
  spread over more places.
- **Absence can be acknowledged, never assumed.** A clone with no personal
  vocabulary to protect sets `OPENWRITER_PRIVACY_NO_DENYLIST=1`, and the run
  then says out loud that personal-term checking is off.
- **Fixtures declare their origin.** Every corpus stage must appear in
  `corpus/SOURCES.md`, enforced at pre-push and at release. This is the half a
  denylist cannot do: it catches prose nobody thought to list, by refusing
  fixtures whose source was never stated.
- **The release-time whole-tree gate stays.** It answers a different question —
  "is the tree clean now?" — and catches drift the push gate never saw.
- **Incident specifics are not recorded here.** This file is public. A public
  post-mortem that names what leaked, how much, and where it can still be read
  is a retrieval guide for the exact material it discusses. Reasoning belongs
  here; particulars belong in the gitignored notes.

## Decision log

### 2026-09-21 — move the gate to the push boundary, add provenance

- **Change.** Added `scripts/privacy-patterns.mjs` (shared rules),
  `scripts/check-push-privacy.mjs` (pre-push, scans added lines of unpushed
  commits), `scripts/check-fixture-provenance.mjs` (corpus stages must declare
  a source), `.githooks/pre-push`, and `corpus/SOURCES.md`. Refactored
  `check-skill-privacy.mjs` onto the shared module. Wired provenance into
  `prepublish.cjs`. Root `prepare` script sets `core.hooksPath`.
- **Why.** Release-time checking cannot protect a public repo, and a denylist
  cannot cover vocabulary nobody enumerated. Those two properties are what let
  one class of mistake recur three times.
- **Verified.** The push gate exits non-zero on a planted term, and still does
  when a following commit removes it. The provenance check fails on an
  undeclared stage and passes on the current sixteen. The refactored release
  gate is unchanged in behaviour.

### 2026-09-21 — remove incident particulars from this file

- **Change.** Replaced the narrative of the three incidents with their
  mechanisms. Dropped volumes, identifiers and retrievability notes; those live
  in the gitignored notes.
- **Why.** The first version of this ADR explained the design by documenting
  precisely what had been exposed and where it remained reachable. That turns a
  needle in a thousand commits into a signposted one. An ADR has to justify the
  design without indexing the thing it protects.

### 2026-09-21 — a missing denylist refuses instead of passing

- **Change.** `loadPersonalDeny` now resolves the personal denylist from, in
  order: `OPENWRITER_PRIVACY_DENYLIST`, this checkout, then the main checkout
  found via the shared git directory. When none can be read it exits non-zero
  rather than returning null. Both gates dropped their warn-and-continue
  branch and now name the rule sets that ran on success.
  `scripts/test-privacy-denylist-resolution.ps1` locks the behaviour with a
  throwaway repo, a worktree, and a denylist of invented terms.
- **Why.** The denylist is gitignored and a worktree holds tracked files only,
  so in a worktree the file was absent, personal-term checking was skipped, and
  the gate printed clean and exited 0. All machine-authored work happens in
  worktrees, so the gate was half-running in the one place it most needed to
  run, and the only signal was a stderr warning inside a git hook. A check that
  cannot obtain its rules has not checked anything.
- **Considered and rejected.** Tracking the terms in encrypted or hashed form.
  Hashes only match whole tokens, which throws away the substring and
  word-boundary matching the denylist depends on, and a tracked ciphertext
  still publishes the count and shape of what is protected while needing a key
  distributed out of band — the same absent-file problem one layer down.
  Copying the file into each worktree was rejected for drift.
- **Verified.** In a throwaway repo, a commit made in a worktree containing an
  invented personal term blocks the push; a clean commit passes and names the
  main checkout as the rule source; removing the denylist everywhere refuses
  with exit 2 and lists where it looked; the acknowledgement variable restores
  a generic-only run and says so. The release gate run from this worktree
  resolves the real denylist from the main checkout and reports clean.
