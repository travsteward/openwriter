# Enrichment

OpenWriter owns stale-document detection, exclusive claims and completion.
An active agent supplies the logline; no background model account is required.

- Save-time defaults remain 0.10 Jaccard sentence drift and 1.5 volume ratio.
- `list_dirty_docs` is inventory, including in-flight work.
- `claim_enrichment({ workspaceFile?, docIds?, limit? })` returns at most 12 full
  canonical snapshots after five seconds idle, each with a five-minute claimToken.
- `mark_enriched({ docs: [{ docId, claimToken, logline }] })` completes the batch.
  Loglines have a 150-character limit. Changed, expired, archived and opted-out
  documents cannot become fresh. Status and pending proposals remain untouched.
- The HTTP primary owns claims for its MCP proxies. Restart discards claims
  without clearing the durable stale-document backlog.
- Empty claims end the batch. Retry hints do not mean poll or spawn more workers.
  A later authorized interaction can resume work.

See [the worker](../skills/openwriter/agents/openwriter-enrichment-minion.md) and
[decision record](../adr/enrichment-claims.md). Old tokenless completion fails
schema validation; clients must discover the new claim tool.

## Verification — 2026-09-07

App/plugin build, enrichment claim/detection/completion/notice tests, and browser
merge tests pass. Disposable-profile HTTP/browser tests proved exclusivity,
rejection after edits, fresh completion, continued typing saved to disk, and
unfinished work recovered after an actual process restart.

Follow-on typing exposed stale browser merges skipping save-version bookkeeping.
They now install through updateDocument; newer server proposals remain preserved.
