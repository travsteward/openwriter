import { z } from 'zod';
import type { ToolDef } from './mcp.js';
import { atomicWriteFileSync } from './helpers.js';
import { listDirtyDocs } from './documents.js';
import { tiptapToBlocks } from './node-blocks.js';
import { harvestSentenceHashes, harvestCharCount } from './enrichment.js';
import { tiptapToMarkdown } from './markdown.js';
import { getCanonical, cloneWithPendingReverted, setMetadata, getMetadata, bumpDocVersion, save, invalidateDocCache, type PadDocument } from './state.js';
import { broadcastMetadataChanged, broadcastDocumentsChanged, broadcastActivityEvent } from './ws.js';

interface EnrichmentTarget {
  isActive: boolean;
  document: PadDocument;
  metadata: Record<string, any>;
  title: string;
  filePath: string;
}

export function createEnrichmentTools(resolveDocTarget: (docId: string) => EnrichmentTarget): ToolDef[] {
  return [
  {
    name: 'mark_enriched',
    description: 'Mark one or more documents as freshly enriched. Stamps openwriter-maintained baselines (lastEnrichedAt, lastEnrichedCharCount, lastEnrichedSentences) atomically with the supplied logline, clears enrichmentStale, and retires legacy enrichment fields (domain, concepts, docRole, and any LLM-written status). The agent never touches the sentence-hash layer — openwriter computes the baseline from current canonical content. Accepts an array so a workspace-wide sweep is one call. Schema simplified in v0.19.0: only logline is LLM-written; status is now agent-owned via create_document / set_metadata; domain / concepts / docRole are gone. See brief 2026-05-21-simplify-enrichment-schema-three-fields.',
    schema: {
      docs: z.array(z.object({
        docId: z.string().describe('Target document by docId (8-char hex from list_documents).'),
        logline: z.string().max(150).describe('Précis (non-fiction) or logline (fiction). Under 150 chars. Describe the content, not the kind of doc.'),
      }).strict()).describe('One or more docs to mark enriched. Single-doc calls are a length-1 array. Strict schema — passing domain / concepts / docRole / status will fail validation (v0.19.0 schema simplification).'),
    },
    handler: async ({ docs }: { docs: Array<{ docId: string; logline: string }> }) => {
      const now = new Date().toISOString();
      const results: Array<{ docId: string; ok: boolean; error?: string }> = [];
      let anyTitleSideEffect = false;

      for (const item of docs) {
        try {
          const target = resolveDocTarget(item.docId);

          // Harvest current sentence hashes + char count from canonical view.
          // Active doc: getCanonical() returns the no-overlay primary state.
          // Non-active: cloneWithPendingReverted on the cached/loaded document.
          const canonical = target.isActive
            ? getCanonical()
            : cloneWithPendingReverted(target.document);
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

          if (target.isActive) {
            // Active doc: setMetadata mutates state.metadata but doesn't bump
            // docVersion on its own — without an explicit bump, save() would
            // hit the no-op gate (docVersion === lastSavedDocVersion when
            // there's no body change). bumpDocVersion forces save() through.
            // writeToDisk's staleness check will see the just-stamped baseline
            // (volumeRatio=1, drift=0) and NOT flip the flag back to true.
            setMetadata(update);
            const liveMeta = getMetadata();
            for (const k of LEGACY_FIELDS_TO_RETIRE) delete liveMeta[k];
            bumpDocVersion();
            save('agent');
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
          }
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
    description: 'List documents that need enrichment — never enriched (no lastEnrichedAt) or flagged stale by openwriter (drift/volume thresholds tripped). Returns identity + reason only; no enrichment fields, no bodies. The minion calls this first to know what to work on. Docs in opted-out workspaces (enrichmentDisabled: true) are excluded. See brief 2026-05-18-frontmatter-enrichment-system.',
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
