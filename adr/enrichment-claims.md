# Enrichment claims

## Context

An enrichment worker used to read independently, then submit only a logline.
Completion stamped a baseline from the content at write time, which could be
newer than the summarized text. Multiple MCP clients could also pick the same
dirty documents. Listing footers alone cannot establish ownership or freshness.

## Current invariants

- Stale frontmatter is the durable backlog. Claims live on the HTTP primary,
  shared by its MCP proxies; restart abandons claims without clearing staleness.
- `claim_enrichment` returns an exclusive five-minute token and full canonical
  snapshot after five seconds idle, at most 12 documents per call. Pending
  proposals do not become summary source material.
- Completion requires the token and unchanged title/canonical content, checked
  synchronously with the metadata write. SHA-256 of the serialized snapshot is
  the revision; sentence fingerprints remain the separate drift heuristic.
- Changed, expired, archived and opted-out work cannot be completed. Failure
  retains stale metadata; expiry makes abandoned work claimable again.
- The worker supplies only logline, identity and claim token. Status and prose
  remain untouched. Legacy tokenless calls fail with instructions to claim.
- No model provider, credential, billing, scheduler or database is introduced.
  An active agent still supplies model execution. Empty claims end its batch;
  retry hints do not authorize polling or unrelated background tasks.

## Decision log

### 2026-09-07 — Own the snapshot and completion boundary

Keep agent execution while moving concurrency and freshness into OpenWriter.
Use disposable leases over existing durable stale metadata. Supply the full
canonical text as part of the claim to avoid independent reads, truncation and
pending-overlay ambiguity. Validate completion against that snapshot, preserve
workspace exclusions, and retain the existing batch Activity summary.
