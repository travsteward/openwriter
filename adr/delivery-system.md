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
