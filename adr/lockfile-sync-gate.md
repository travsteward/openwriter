# Lockfile sync gate

## Context

`package-lock.json` is the only record of which platform-specific binaries a
clean install may pick from. Three dependency families here ship one build per
operating system and CPU — esbuild (via vite), rollup, and sharp's `@img`
packages — and none of them is ever depended on directly. Each parent declares
its whole platform set as optional dependencies and picks the matching one at
install time. If the lockfile ever held only the entries matching the machine
that generated it, every install on a different operating system would fail,
and nothing on the generating machine would show a symptom.

Nothing in the repo checked that. The lockfile was reviewed by eye, during
whatever task happened to regenerate it.

That review is not reliable, because a version bump regenerates the lockfile as
a side effect and the resulting diff is dominated by deletions of
platform-specific entries — exactly what lost platform coverage would also look
like. Two consecutive releases were interrupted by that diff and the lockfile
was hand-reverted, which put the stale entries straight back for the next
release to rediscover.

The deletions were correct. The lockfile had accumulated entries that no
declared dependency reached:

- A `tsx` install tree, offered by vite as an *optional* peer dependency and
  never asked for by any package here. It dragged in its own esbuild and that
  esbuild's 26 platform builds — 30 entries for a tool the repo does not
  declare and does not build with.
- Workspace folders that had been deleted or renamed (`packages/site`,
  `plugins/platform`), left behind as entries marked extraneous.

An unreachable entry is not inert. It is deleted by the next command that
writes the lockfile, so it converts a routine bump into a large, alarming diff
and hides a real coverage loss inside the noise. Keeping the lockfile
reachable-clean is what makes a bump a one-line diff, and a one-line diff is
what makes a genuine platform-coverage loss visible without anyone having to
inspect anything.

The npm version running here (11.x) prunes unreachable entries; npm 10.5.2,
which the repo's `packageManager` field declared, leaves them in place. That
mismatch was the reason two npm versions disagreed about the same lockfile.
Aligning the declaration to the version in use removes the disagreement;
freezing the toolchain at the older version would only have preserved the stale
entries indefinitely.

## Current invariants

- `scripts/check-lockfile-sync.mjs` reads `package-lock.json` offline and
  fails if either half of the sync property is violated. It runs from
  `.githooks/pre-push` and from `npm run check:lockfile`.
- **Nothing declared may be absent.** Every name in a lock entry's
  `dependencies` or `optionalDependencies` must resolve to another lock entry,
  resolving outwards from the entry's own folder as node does. A missing
  optional dependency is the signature of lost platform coverage and is
  reported as such.
- **Nothing present may be unreachable.** Every lock entry must be reachable
  from the root package or a workspace that still exists on disk. An entry
  flagged extraneous fails regardless of reachability.
- Roots are the root package, every non-`node_modules` entry whose
  `package.json` exists on disk, and the `node_modules` link entry npm creates
  for each such workspace. A workspace folder that was deleted or renamed is
  therefore not a root, and its leftover entry is an orphan.
- **Optional peer dependencies are not followed.** An optional peer is an offer,
  not a requirement; npm deletes one that is present but unasked-for. Following
  it would make the check accept exactly the stale trees it exists to find.
  Unmet peers are never reported as missing — that is npm's business.
- `packageManager` names the npm version actually in use. The lockfile is
  expected to be stable under that version: regenerating produces no diff.

## Decision log (append-only)

### 2026-09-21 — initial implementation

- Friction: a version bump rewrote the lockfile and removed 554 lines. The
  removal read as platform pruning, was reverted by hand twice, and returned on
  the next release.
- Diagnosis: not platform pruning. Every removed entry was unreachable —
  an undeclared `tsx` tree with its own esbuild and 26 platform builds, plus two
  deleted workspaces. Platform coverage for rollup, sharp and vite's esbuild was
  intact before and after.
- Architectural fix: make lockfile/declaration sync a checked invariant instead
  of a diff someone reads. Commit the reachable-clean lockfile so a bump is a
  one-line diff, and gate pushes on the sync check so a real coverage loss fails
  mechanically.
- Files changed:
  - `scripts/check-lockfile-sync.mjs` — new gate.
  - `.githooks/pre-push` — runs it before the privacy gate.
  - `package.json` — `check:lockfile` script; `packageManager` aligned to the
    npm in use.
  - `package-lock.json` — 32 unreachable entries removed.
- Verified: the check passes on the cleaned lockfile, reports all 32 orphans on
  the previous one, and reports the missing builds when non-Windows platform
  entries are deleted from an otherwise clean lockfile. A clean install and a
  full build both succeed from the cleaned lockfile, and a throwaway version
  bump now changes one line.
