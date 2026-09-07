# Canonical delivery with production proof

## Context

OpenWriter relied on legacy prose and ad-hoc restarts. GrepRAG's recorded delivery
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
- local-app is recorded only after live SHA and artifact proof; npm is recorded
  only after registry integrity and GitHub release verification.
- Public releases use the generic repository skill, privacy gate, and fresh
  plugins. Local delivery does not automatically publish an npm version.

## Decision log

### 2026-09-07

Adopted the GrepRAG-owned locks, merge guard/provenance, gate, verification, and
ledger instead of copying another repo's shared gate code. OpenWriter owns its
build input check, process restart, build stamp, and npm artifact verification.
The user confirmed main is the intended default branch; no branch rename occurs.
