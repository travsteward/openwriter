import { z } from 'zod';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import matter from 'gray-matter';
import type { ToolDef } from './mcp.js';
import { atomicWriteFileSync, canonicalizePath } from './helpers.js';
import { listDirtyDocs } from './documents.js';
import { tiptapToBlocks } from './node-blocks.js';
import { harvestSentenceHashes, harvestCharCount } from './enrichment.js';
import { tiptapToMarkdown } from './markdown.js';
import { getCanonical, getExternalMtimeDrift, cloneWithPendingReverted, setMetadata, getMetadata, bumpDocVersion, save, invalidateDocCache, type PadDocument } from './state.js';
import { broadcastMetadataChanged, broadcastDocumentsChanged, broadcastActivityEvent } from './ws.js';

interface EnrichmentTarget {
  isActive: boolean;
  document: PadDocument;
  metadata: Record<string, any>;
  title: string;
  filePath: string;
  lastModified: Date;
}

// adr: adr/enrichment-claims.md
const IDLE_MS = 5_000;
const LEASE_MS = 5 * 60_000;
interface Claim {
  token: string;
  revision: string;
  expiresAt: number;
}

/** One registry on the HTTP primary; MCP proxy clients share this owner.
 * Claims are disposable. Stale frontmatter is the durable backlog. */
export function createEnrichmentTools(resolveDocTarget: (docId: string) => EnrichmentTarget, clock = Date.now): ToolDef[] {
  const claims = new Map<string, Claim>();
  const keyFor = (target: EnrichmentTarget) => canonicalizePath(target.filePath);
  function expireClaims() {
    for (const [key, claim] of claims) if (claim.expiresAt <= clock()) claims.delete(key);
  }
  function snapshot(docId: string) {
    const target = resolveDocTarget(docId);
    // Do not summarize or overwrite an active view whose external reload has
    // not arrived yet. Non-active cache freshness is handled by the resolver.
    if (target.isActive && getExternalMtimeDrift()) throw new Error('Document is awaiting external reload; try again after it settles.');
    const canonical = target.isActive ? getCanonical() : cloneWithPendingReverted(target.document);
    const content = matter(tiptapToMarkdown(canonical, target.title, {})).content;
    const revision = createHash('sha256').update(JSON.stringify([target.title, content])).digest('hex');
    return { target, canonical, content, revision };
  }
  return [
  {
    name: 'claim_enrichment',
    description: 'Claim up to 12 stale documents after 5 seconds idle. Returns full canonical content, title, revision, claimToken and expiresAt for each. Summarize this snapshot, not read_pad. Claims are exclusive for 5 minutes and recover after restart. Empty docs means stop; retryAfterMs indicates settling/leased work. Complete with mark_enriched including each claimToken. Workspace opt-outs and archives are excluded.',
    schema: {
      workspaceFile: z.string().optional(),
      docIds: z.array(z.string()).max(12).optional().describe('Optional explicit candidates; only eligible stale documents can be claimed.'),
      limit: z.number().int().min(1).max(12).optional(),
    },
    handler: async ({ workspaceFile, docIds, limit = 12 }: { workspaceFile?: string; docIds?: string[]; limit?: number }) => {
      expireClaims();
      const docs = [];
      const errors = [];
      let retryAfterMs: number | undefined;
      const defer = (ms: number) => { retryAfterMs = Math.min(retryAfterMs ?? Infinity, ms); };
      for (const doc of listDirtyDocs(workspaceFile)) {
        if (docIds && !docIds.includes(doc.docId)) continue;
        if (docs.length >= limit) break;
        try {
          const { target, content, revision } = snapshot(doc.docId);
          const key = keyFor(target);
          const existing = claims.get(key);
          if (existing) { defer(existing.expiresAt - clock()); continue; }
          const modified = Math.max(statSync(target.filePath).mtimeMs, target.lastModified.getTime());
          const wait = modified + IDLE_MS - clock();
          if (wait > 0) { defer(wait); continue; }
          const claim = { token: randomUUID(), revision, expiresAt: clock() + LEASE_MS };
          claims.set(key, claim);
          docs.push({ docId: doc.docId, title: target.title, workspaceFile: doc.workspaceFile, content, revision, claimToken: claim.token, expiresAt: new Date(claim.expiresAt).toISOString() });
        } catch (err) {
          errors.push({ docId: doc.docId, error: String(err instanceof Error ? err.message : err) });
        }
      }
      return { content: [{ type: 'text', text: JSON.stringify({ docs, errors, retryAfterMs }) }] };
    },
  },
  {
    name: 'mark_enriched',
    description: 'Complete claimed enrichment in one batch. First call claim_enrichment and summarize its exact content. Requires each claimToken; expired, changed, archived or opted-out documents are not marked fresh. Successful writes atomically stamp baselines and logline, preserve status, clear staleness and retire legacy domain/concepts/docRole fields. Never submit an unclaimed summary.',
    schema: {
      docs: z.array(z.object({
        docId: z.string().describe('Target document by docId (8-char hex from list_documents).'),
        claimToken: z.string().describe('Token returned by claim_enrichment for the content summarized.'),
        logline: z.string().max(150).describe('Précis (non-fiction) or logline (fiction). Under 150 chars. Describe the content, not the kind of doc.'),
      }).strict()).min(1).max(12).describe('Complete the claimed batch with only docId, claimToken, and logline.'),
    },
    handler: async ({ docs }: { docs: Array<{ docId: string; claimToken: string; logline: string }> }) => {
      expireClaims();
      const eligible = new Set(listDirtyDocs().map(doc => doc.docId));
      const now = new Date().toISOString();
      const results: Array<{ docId: string; ok: boolean; error?: string }> = [];

      for (const item of docs) {
        try {
          const { target, canonical, revision } = snapshot(item.docId);
          const key = keyFor(target);
          const claim = claims.get(key);
          if (!claim || claim.token !== item.claimToken) throw new Error('Missing or expired claim; call claim_enrichment and summarize the returned snapshot.');
          if (!eligible.has(item.docId) || claim.revision !== revision) {
            claims.delete(key);
            throw new Error('Document changed or is no longer eligible; summary not applied. Claim again if still pending.');
          }

          // Harvest current sentence hashes + char count from canonical view.
          // Active doc: getCanonical() returns the no-overlay primary state.
          // Non-active: cloneWithPendingReverted on the cached/loaded document.
          const blocks = tiptapToBlocks(canonical);
          const lastEnrichedSentences = harvestSentenceHashes(blocks);
          const lastEnrichedCharCount = harvestCharCount(blocks);

          // Build the atomic enrichment payload. v0.19.0: only logline is
          // LLM-written. The legacy fields (domain / concepts / docRole) get
          // retired on this write — `LEGACY_FIELDS_TO_RETIRE` is deleted from
          // the merged metadata so disk slowly converges to the new schema
          // as each doc gets re-enriched (lazy migration path from the brief).
          const update: Record<string, any> = {
            lastEnrichedAt: now,
            lastEnrichedCharCount,
            lastEnrichedSentences,
            enrichmentStale: false,
            logline: item.logline,
          };
          const LEGACY_FIELDS_TO_RETIRE = ['domain', 'concepts', 'docRole'];
          const verifyReceipt = () => {
            const persisted = matter(readFileSync(target.filePath, 'utf8')).data;
            if (persisted.lastEnrichedAt !== now || persisted.logline !== item.logline || persisted.enrichmentStale !== false) {
              throw new Error('Enrichment was not persisted; claim remains pending until expiry.');
            }
          };

          if (target.isActive) {
            // Active doc: setMetadata mutates state.metadata but doesn't bump
            // docVersion on its own — without an explicit bump, save() would
            // hit the no-op gate (docVersion === lastSavedDocVersion when
            // there's no body change). bumpDocVersion forces save() through.
            // writeToDisk's staleness check will see the just-stamped baseline
            // (volumeRatio=1, drift=0) and NOT flip the flag back to true.
            const previous = { ...getMetadata() };
            try {
              setMetadata(update);
              const liveMeta = getMetadata();
              for (const k of LEGACY_FIELDS_TO_RETIRE) delete liveMeta[k];
              bumpDocVersion();
              save('agent');
              verifyReceipt();
            } catch (err) {
              // Keep memory consistent with unfinished disk work if save()
              // declines or fails. No await separates this metadata transaction.
              const liveMeta = getMetadata();
              for (const k of [...Object.keys(update), ...LEGACY_FIELDS_TO_RETIRE]) {
                if (Object.hasOwn(previous, k)) liveMeta[k] = previous[k];
                else delete liveMeta[k];
              }
              bumpDocVersion();
              throw err;
            }
            broadcastMetadataChanged(getMetadata());
          } else {
            // Non-active: write directly to disk, bypassing flushDocToFile's
            // staleness check (which would otherwise see stale state for one
            // serialize cycle before the new baseline lands). Disk write +
            // cache invalidation mirrors set_metadata's non-active path.
            const newMeta = { ...target.metadata, ...update };
            for (const k of LEGACY_FIELDS_TO_RETIRE) delete newMeta[k];
            const markdown = tiptapToMarkdown(target.document, target.title, newMeta);
            atomicWriteFileSync(target.filePath, markdown);
            invalidateDocCache(target.filePath);
            verifyReceipt();
          }
          claims.delete(key);
          results.push({ docId: item.docId, ok: true });
        } catch (err: any) {
          results.push({ docId: item.docId, ok: false, error: String(err?.message ?? err) });
        }
      }

      // Single broadcast at the end so sidebar refreshes once for the whole batch.
      broadcastDocumentsChanged();

      const okCount = results.filter((r) => r.ok).length;
      const failCount = results.length - okCount;
      const summary = failCount === 0
        ? `Enriched ${okCount} doc${okCount === 1 ? '' : 's'}`
        : `Enriched ${okCount} doc${okCount === 1 ? '' : 's'}, ${failCount} failed`;

      // Right-rail Activity: single summary line for the whole batch. adr: adr/right-rail.md
      broadcastActivityEvent({
        kind: 'enrichment',
        headline: summary,
      });
      return { content: [{ type: 'text', text: `${summary}\n${JSON.stringify({ docs: results })}` }] };
    },
  },
  {
    name: 'list_dirty_docs',
    description: 'Read-only inventory of stale documents, including in-flight claims. Use claim_enrichment to acquire actual work and its canonical snapshot. Opted-out workspaces and archives are excluded.',
    schema: {
      workspaceFile: z.string().optional().describe('Scope to one workspace. Omit to scan all workspaces.'),
    },
    handler: async ({ workspaceFile }: { workspaceFile?: string }) => {
      const docs = listDirtyDocs(workspaceFile);
      return { content: [{ type: 'text', text: JSON.stringify({ total: docs.length, docs }) }] };
    },
  },
  ];
}
