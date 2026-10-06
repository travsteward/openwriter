# Enrichment lifecycle

OpenWriter owns work claims and freshness. The acting agent supplies model
execution during authorized document work. No standalone model service runs.

Use the [worker procedure](../agents/openwriter-enrichment-minion.md):
`claim_enrichment` returns up to 12 exclusive canonical snapshots; summarize
those snapshots and complete with one `mark_enriched` call carrying each
`claimToken`. The server only clears staleness when content still matches.

A dirty count includes in-flight work. Empty claims mean stop. Claims expire
in five minutes; recently edited documents settle for five seconds. Failed or
abandoned work stays pending, including after a server restart. Do not promise
fixed timing or cost, or repeatedly dispatch workers from a nonzero count.

For helpers, pass this procedure through the active harness. An explicit docId
list only narrows candidates; it does not replace claiming. Multiple workers
may claim independently because OpenWriter assigns disjoint work. Respect the
harness concurrency limit and use one bounded inline batch when helpers cannot
access MCP. Keep workspace opt-outs and only report actual completion.
