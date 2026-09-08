import { listDirtyDocs } from './documents.js';

// adr: adr/enrichment-claims.md
const procedure = 'During authorized document work, use claim_enrichment to acquire up to 12 snapshots. Summarize the returned canonical content in loglines of at most 150 characters, then call mark_enriched once with docId, claimToken and logline per document. Use your harness helper or a bounded inline batch. Empty claims mean stop; work may be settling or already claimed. Do not poll or spawn workers from the dirty count alone.';

export function enrichmentFooter(): string {
  const count = listDirtyDocs().length;
  return count ? `\n\n⚠ ${count} docs need enrichment (including in-flight work). ${procedure}` : '';
}

export function buildEnrichmentInstructions(): string {
  const docs = listDirtyDocs();
  if (!docs.length) return '';
  const groups = new Map<string, number>();
  for (const doc of docs) groups.set(doc.workspaceFile ?? '', (groups.get(doc.workspaceFile ?? '') ?? 0) + 1);
  const attribution = [...groups].map(([workspace, count]) => workspace ? `${count} in ${workspace}` : `${count} unfiled`).join(', ');
  return `\nENRICHMENT_STATUS: ${docs.length} docs need enrichment (${attribution}; including in-flight work). ${procedure}`;
}
