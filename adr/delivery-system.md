# Canonical delivery with production proof

## Context

OpenWriter relied on legacy prose and ad-hoc restarts. The recorded delivery
system separates merge serialization, provenance, target-held deployment locks,
repo-owned artifact checks, and live acceptance proof.

## Current invariants

- .greprag/delivery.json names main/origin and C:/openwriter as canonical.
- Worktrees build and test; main integrates by fast-forward under merge-lock.
- local-app and npm have separate process-held deploy locks and records.
- Build inputs must match committed HEAD. Unrelated local dirt is preserved.
- A build stamp binds artifacts to an unchanged commit; the HTTP process loads
  it once and serves it uncacheable. Old processes cannot echo new disk stamps.
- Save/entrypoint/listener verification precedes stopping only the HTTP primary.
- The listener's entrypoint is identified by the file its entry script resolves
  to (links followed), never by command-line text. The first check and the
  recheck before stopping the PID share one function in delivery-common.ps1.
- local-app is recorded only after live SHA and artifact proof; npm is recorded
  only after registry integrity and GitHub release verification.
- A published artifact is proven against the integrity recorded when it was
  handed to the registry, never against a later run's pack, and the registry is
  given bounded time to index it. Without such a record nothing is proven and
  the release refuses rather than passing.
- Public releases use the generic repository skill, privacy gate, and fresh
  plugins. Local delivery does not automatically publish an npm version.

## Decision log

### 2026-09-07

Adopted the shared locks, merge guard/provenance, gate, verification, and
ledger instead of copying another repo's shared gate code. OpenWriter owns its
build input check, process restart, build stamp, and npm artifact verification.
The user confirmed main is the intended default branch; no branch rename occurs.

Privacy checking recognizes operational tool/path tokens without excluding a
whole file or line. Remaining content still passes all deny rules; plain venture
references remain subject to the personal denylist. PowerShell files are scanned.

### 2026-09-20

Local deploy aborted on the genuine app because the listener check matched the
raw command line against the canonical path text. The app had been launched
through the npm development link, a junction onto the canonical package, so the
text differed while the file was identical. Identity is now decided by the
resolved file: the entry script is taken from the command line (first argument
that is not an option), resolved with the operating system's final-path lookup
through node, and compared case-insensitively with the resolved canonical
entry. No directory is special-cased. Relative, missing, or unresolvable
entries are refused, and the canonical path appearing as a later argument does
not count. A regression script builds its own junction fixture to lock both
the accepted and refused cases.

### 2026-09-21

A release threw immediately after a successful publish. The registry had
accepted the version and said in its own output that it might take a few
minutes to become available; the next line demanded it at once and got a
not-found. The release had in fact worked, and the operator was shown a
failure for it.

The same step could also never pass on a resume. It compared the registry
against the tarball the current run had just packed, and that tarball is not
reproducible: each run rebuilds and the build stamp carries a fresh time, so a
resumed run packs different bytes than the run that published. Re-running after
any interruption therefore compared the registry against an artifact nobody had
ever published, which defeated the resumability the rest of the wrapper
provides.

Verification no longer re-derives the artifact. The integrity of the tarball
handed to the registry is written beside it in the ignored release artifacts,
before the publish call so that a run ending between acceptance and the next
line cannot lose the only proof of which bytes were sent. Every later run
compares the registry against that record. A record for another version, an
unreadable one, or none at all counts as no proof and refuses; the step is not
weakened into a skip. The registry is given a bounded, progress-reporting wait
to index a new version, and a wait that runs out says plainly that the publish
is not in doubt and the wrapper can simply be re-run. Registry reads prefer the
network so a cached miss from before publication cannot answer for the
registry. A regression script locks the waiting, the bound, and each refusal
with its own temporary records and fake probes, contacting no registry.

### 2026-09-21 (2)

A delivery script's failure output is read by a person deciding what to do
next. The wrapper printed its explanation and then re-threw, so a PowerShell
exception dump landed underneath and buried it; deploy and merge had no
explanation at all. The v0.41.1 release, which had in fact succeeded, was
reported this way and read as a crash. Failures now route through one shared
reporter: the cause, the next step, then a non-zero exit, with no exception
furniture. The lock is released before the report so the guidance is the last
thing on screen. Release also traps preflight errors, which occur before the
lock exists and so never reached the handler.

The same rule applies one layer down. The build-input check refused by
throwing, printing a node stack trace over the file list the reader needs; it
now reports and exits when run as a script, while still throwing for
importers. Guarding "am I the entry point?" must use pathToFileURL rather than
a hand-built file:// string: on Windows the hand-built form does not match
node's own URL, and the mismatch silently disables the gate instead of making
it noisy. That regression is now locked by a test that gives the checker real
dirt and asserts it refuses.
