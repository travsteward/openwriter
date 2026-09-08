/**
 * MCP stdio server: tool registry + stdio transport.
 * Uses compact wire format for token efficiency.
 * Exports TOOL_REGISTRY for HTTP proxy (multi-session support).
 */

import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync, readFileSync, statSync } from 'fs';
import { randomUUID } from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { getDataDir, ensureDataDir, resolveDocPath, generateNodeId, atomicWriteFileSync, readConfig } from './helpers.js';
import { manuscriptTools } from './manuscript/tools.js';

import {
  getDocument,
  getWordCount,
  getPendingChangeCount,
  getTitle,
  getStatus,
  getNodesByIds,
  findNodesByIds,
  getMetadata,
  setMetadata,
  mergeMetadataUpdates,
  applyChanges,
  applyTextEdits,
  updateDocument,
  save,
  markAllNodesAsPending,
  setAgentLock,
  setAgentLockActive,
  updatePendingCacheForActiveDoc,
  populateDocumentFile,
  applyChangesToFile,
  applyTextEditsToFile,
  getDocId,
  getFilePath,
  getIsTemp,
  extractText,
  countPending,
  updateCacheEntry,
  addDocTag,
  removeDocTag,
  getDocTagsByFilename,
  getCachedDocument,
  invalidateDocCache,
  isAutoAcceptActive,
  removePendingCacheEntry,
  getExternalMtimeDrift,
  reloadActiveDocFromDisk,
  getCanonical,
  cloneWithPendingReverted,
  bumpDocVersion,
  setSortProposalOnFile,
  clearSortRequestOnFile,
  type NodeChange,
  type PadDocument,
} from './state.js';
import { tiptapToBlocks } from './node-blocks.js';
import { readBlame, summarizeBlame } from './attribution.js';
import { outline, peek, searchInDoc, truncateRead, type PeekTarget } from './peek-outline.js';
import { createEnrichmentTools } from './enrichment-tools.js';
import { resolveTypeMeta } from './content-type-meta.js';
import { listDocuments, switchDocument, createDocument, createDocumentFile, deleteDocument, openFile, getActiveFilename, updateDocumentTitle, promoteTempFile, archiveDocument, unarchiveDocument, resolveDocId, filenameByDocId, searchDocuments, listDirtyDocs, crawlDocs, enrichmentFooter, buildEnrichmentInstructions, listPendingSorts, sortFooter, buildSortInstructions, stagePendingTitle } from './documents.js';
import { extractForwardLinks, readFrontmatter, writeFrontmatter, computeBacklinksFor, rebuildAllReferences, invalidateBacklinksCache } from './backlinks.js';
import { logger, generateRequestId, withRequestId } from './logger.js';
import { broadcastDocumentSwitched, broadcastDocumentsChanged, broadcastWorkspacesChanged, broadcastTitleChanged, broadcastMetadataChanged, broadcastPendingDocsChanged, broadcastPendingMetadataChanged, broadcastWritingStarted, broadcastWritingFinished, broadcastCommentsChanged, broadcastActivityEvent } from './ws.js';
import { listWorkspaces, getWorkspace, getDocTitle, getItemContext, addDoc, updateWorkspaceContext, createWorkspace, deleteWorkspace, addContainerToWorkspace, findOrCreateWorkspace, findOrCreateContainer, moveDoc, moveContainer, reorderWorkspaceAfter, removeContainer, renameWorkspace, renameContainer, removeDocFromAllWorkspaces, findWorkspacesContainingDoc, collectFilesInWorkspace } from './workspaces.js';
import type { WorkspaceNode } from './workspace-types.js';
import { findDocNode, findContainer } from './workspace-tree.js';
import { importGoogleDoc } from './gdoc-import.js';
import { toCompactFormat, compactNodes, parseMarkdownContent } from './compact.js';
import matter from 'gray-matter';
import { getUpdateInfo } from './update-check.js';
import { listVersions, forceSnapshot, writeSnapshotMarkdown, restoreVersion, getVersionContent, applyCurrentDocumentMetadata } from './versions.js';
import { markdownToTiptap, tiptapToMarkdown, splitFusedParagraphs } from './markdown.js';
import { loadDocFromDisk } from './pending-overlay.js';
import { getComments, getCommentCount, getGlobalCommentSummary, resolveComments, type Comment } from './comments.js';
import { readTasks, addTask, updateTask, removeTask } from './tasks.js';


/** Map a content type string to its frontmatter metadata object. */


interface DocTarget {
  filename: string;
  filePath: string;
  docId: string;
  isActive: boolean;
  document: PadDocument;
  title: string;
  metadata: Record<string, any>;
  wordCount: number;
  pendingCount: number;
  lastModified: Date;
}

/** Resolve a docId to a full document target. Fast path for active doc (zero I/O). */
function resolveDocTarget(docId: string): DocTarget {
  const filename = resolveDocId(docId);
  const activeFilename = getActiveFilename();

  // Fast path: active document — use in-memory state
  if (filename === activeFilename) {
    return {
      filename,
      filePath: getFilePath(),
      docId,
      isActive: true,
      document: getDocument(),
      title: getTitle(),
      metadata: getMetadata(),
      wordCount: getWordCount(),
      pendingCount: getPendingChangeCount(),
      lastModified: new Date(getStatus().lastModified),
    };
  }

  // Non-active: try cache, then disk
  const filePath = resolveDocPath(filename);
  const cached = getCachedDocument(filePath);
  if (cached) {
    const text = extractText(cached.document.content);
    return {
      filename,
      filePath,
      docId: cached.docId,
      isActive: false,
      document: cached.document,
      title: cached.title,
      metadata: cached.metadata,
      wordCount: text.trim() ? text.trim().split(/\s+/).length : 0,
      pendingCount: countPending(cached.document.content),
      lastModified: cached.lastModified,
    };
  }

  // Read from disk — load the MERGED view (canonical body + sidecar overlay).
  // The bare markdownToTiptap returns canonical-only; without applying the
  // sidecar, a doc that has pending content (typical after populate_document
  // or write_to_pad on a non-active doc) would surface here with 0 words and
  // 0 pending — silently dropping the user's just-written content. The
  // overlay-aware loader closes that asymmetry. adr: adr/pending-overlay-model.md
  if (!existsSync(filePath)) throw new Error(`Document file not found: ${filename}`);
  const loaded = loadDocFromDisk(filename);
  const resolvedDocId = loaded.docId || docId;
  const text = extractText(loaded.document.content);
  return {
    filename,
    filePath,
    docId: resolvedDocId,
    isActive: false,
    document: loaded.document,
    title: loaded.title,
    metadata: loaded.metadata || {},
    wordCount: text.trim() ? text.trim().split(/\s+/).length : 0,
    pendingCount: countPending(loaded.document.content),
    lastModified: statSync(filePath).mtime,
  };
}

export type ToolResult = { content: { type: 'text'; text: string }[] };

export interface ToolDef {
  name: string;
  description: string;
  schema: Record<string, z.ZodTypeAny>;
  handler: (args: any) => Promise<ToolResult>;
}

/** Human-friendly relative time for ISO timestamps. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!isFinite(then)) return '';
  const diff = Date.now() - then;
  if (diff < 0) return 'just now';
  const sec = Math.round(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 14) return `${day}d ago`;
  const wk = Math.round(day / 7);
  if (wk < 8) return `${wk}w ago`;
  const mo = Math.round(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.round(day / 365)}y ago`;
}

type CommentScope = 'workspace' | 'document' | 'all';

interface ResolvedCommentScope {
  byFile: Record<string, Comment[]>;
  scopeLabel: string;
}

/** Apply a scope filter to the comments index. Returns the matching comments
 *  grouped by file plus a human-readable label for the scope. */
function gatherComments(filename: string | undefined, scope: CommentScope | undefined): ResolvedCommentScope {
  const effectiveScope: CommentScope = scope ?? (filename ? 'workspace' : 'all');

  if (effectiveScope === 'document' && filename) {
    return { byFile: getComments(filename), scopeLabel: `document "${filename}"` };
  }

  if (effectiveScope === 'workspace' && filename) {
    const containing = findWorkspacesContainingDoc(filename);
    if (containing.length === 0) {
      // Doc isn't filed in any workspace — fall back to single-doc scope.
      return { byFile: getComments(filename), scopeLabel: `document "${filename}" (not in any workspace)` };
    }
    const ws = containing[0];
    const filesInWs = collectFilesInWorkspace(ws.filename);
    const byFile: Record<string, Comment[]> = {};
    for (const f of filesInWs) {
      const docComments = getComments(f);
      if (docComments[f] && docComments[f].length > 0) byFile[f] = docComments[f];
    }
    return { byFile, scopeLabel: `workspace "${ws.title}" (${filesInWs.length} docs)` };
  }

  return { byFile: getComments(), scopeLabel: 'all documents' };
}

function formatCommentsOutput({ byFile, scopeLabel }: ResolvedCommentScope): string {
  const entries = Object.entries(byFile);
  if (entries.length === 0) return `No comments found in ${scopeLabel}.`;

  const total = entries.reduce((sum, [, list]) => sum + list.length, 0);
  const lines: string[] = [`Comments in ${scopeLabel} — ${total} total:`];
  for (const [file, comments] of entries) {
    lines.push(`\n${file}:`);
    for (const c of comments) {
      const notePart = c.note ? ` — "${c.note}"` : '';
      const age = c.createdAt ? `  [${relativeTime(c.createdAt)}]` : '';
      lines.push(`  [${c.id}] "${c.text}"${notePart}${age}  (node:${c.nodeId})`);
    }
  }
  return lines.join('\n');
}

/** Hard cap on words returned per read_pad call. Above this, the response
 *  is truncated at a top-level node boundary and a continuation hint is
 *  appended pointing at peek_doc / outline_doc / search_docs. The cap exists
 *  so the agent can't accidentally token-blow a 50k-word doc — read_pad's
 *  contract is "doc opening + handle to continue," not "everything."
 *  v0.25 — see CHANGELOG. */
const READ_PAD_MAX_WORDS = 2000;
/** First-truncation FYI shows once per MCP process lifetime so the agent
 *  learns the new behavior without repeating the explanation. Resets on
 *  server restart. */
let firstTruncationShown = false;

/** MCP-9: metadata keys an agent must NEVER set via set_metadata. `autoAccept`
 *  governs the human accept/reject gate — letting the agent write it via
 *  open-ended frontmatter would self-grant auto-accept and bypass human review.
 *  These are operator-only (set through the UI toggle path). The metadata
 *  surface is otherwise intentionally open-ended, so this is a denylist of the
 *  finite, enumerable privileged keys rather than an allowlist of content keys. */
const AGENT_FORBIDDEN_METADATA_KEYS = new Set(['autoAccept']);

export const TOOL_REGISTRY: ToolDef[] = [
  {
    name: 'read_pad',
    description: `Read a document by docId. Returns compact tagged-line format with [type:id] per node. Default: first ~${READ_PAD_MAX_WORDS} words. Three knobs for longer docs:\n• \`slice: { from, to }\` — read a percentile range (floats in [0,1]). \`{from:0.5, to:1}\` = back half, \`{from:0.25, to:0.75}\` = middle 50%, \`{from:0.0, to:0.1}\` then \`{from:0.1, to:0.2}\` … = sequential 10% chunks. Snaps to top-level node boundaries; subject to the word cap unless force is set.\n• \`force: true\` — bypass the cap, return the full requested region (whole doc or whole slice). Use for full-doc audits/rewrites where you've accepted the cost.\n• When the cap kicks in, the response includes \`lastNodeId\` + continuation hints to \`peek_doc\` / \`outline_doc\` / \`search_docs\` / another \`read_pad\` slice.`,
    schema: {
      docId: z.string().describe('Target document by docId (8-char hex from list_documents).'),
      // Schemas use z.preprocess to coerce string inputs — some MCP clients
      // serialize complex / boolean params as JSON strings rather than native
      // types. Accepting both forms means agents work regardless of client.
      slice: z.preprocess(
        (v) => (typeof v === 'string' && v.trim().startsWith('{')) ? (() => { try { return JSON.parse(v); } catch { return v; } })() : v,
        z.object({
          from: z.number().min(0).max(1).describe('Start of the slice as a fraction of total word count (0 = beginning).'),
          to: z.number().min(0).max(1).describe('End of the slice as a fraction of total word count (1 = end). Must be > from.'),
        }).optional(),
      ).describe('Percentile range to read instead of the doc opening. Snaps to top-level node boundaries. Examples: { from: 0.5, to: 1 } = back half; { from: 0.25, to: 0.75 } = middle 50%.'),
      force: z.preprocess(
        (v) => (typeof v === 'string') ? v === 'true' : v,
        z.boolean().optional(),
      ).describe(`Bypass the ~${READ_PAD_MAX_WORDS}-word cap. Returns the full requested region in one call. Use for full-doc audits and rewrites where the cost is acknowledged.`),
    },
    handler: async ({ docId, slice, force }: { docId: string; slice?: { from: number; to: number }; force?: boolean }) => {
      const target = resolveDocTarget(docId);
      const trunc = truncateRead(target.document, { maxWords: READ_PAD_MAX_WORDS, slice, force });
      const compact = toCompactFormat(
        trunc.doc,
        target.title,
        trunc.returnedWords,
        target.pendingCount,
        target.docId,
        target.metadata,
      );
      const localCount = getCommentCount(target.filename);
      const { totalComments: otherCount, docCount: otherDocs } = getGlobalCommentSummary(target.filename);
      let hint = '';
      if (localCount > 0) hint += `\n[${localCount} comment${localCount !== 1 ? 's' : ''} on this document]`;
      if (otherCount > 0) hint += `\n[${otherCount} comment${otherCount !== 1 ? 's' : ''} on ${otherDocs} other document${otherDocs !== 1 ? 's' : ''}]`;
      if (hint) hint += '\n[call get_comments to review]';

      // Label forced / sliced reads so the response is self-describing.
      if (trunc.forced) {
        const region = trunc.slice
          ? `forced slice ${(trunc.slice.from * 100).toFixed(0)}–${(trunc.slice.to * 100).toFixed(0)}%`
          : 'forced full read';
        hint += `\n[${region.toUpperCase()} — ${trunc.returnedWords.toLocaleString()} words returned of ${trunc.totalWords.toLocaleString()} total. Cap bypassed.]`;
      } else if (trunc.slice && !trunc.truncated) {
        hint += `\n[SLICE ${(trunc.slice.from * 100).toFixed(0)}–${(trunc.slice.to * 100).toFixed(0)}% — ${trunc.returnedWords.toLocaleString()} of ${trunc.totalWords.toLocaleString()} words. Adjacent slices: read_pad({ docId: "${target.docId}", slice: { from: ${trunc.slice.to.toFixed(2)}, to: ${Math.min(1, trunc.slice.to + (trunc.slice.to - trunc.slice.from)).toFixed(2)} } }) for the next region.]`;
      } else if (trunc.truncated) {
        if (!firstTruncationShown) {
          hint += `\n\n[FYI: read_pad caps at ~${READ_PAD_MAX_WORDS} words to keep cost predictable. Override per-call with force:true, or read a specific region with slice:{from,to}. This notice shows once per session.]`;
          firstTruncationShown = true;
        }
        const anchor = trunc.lastNodeId ?? '<no-id>';
        const sliceLabel = trunc.slice
          ? ` of slice ${(trunc.slice.from * 100).toFixed(0)}–${(trunc.slice.to * 100).toFixed(0)}%`
          : '';
        hint += `\n[TRUNCATED — ${trunc.totalWords.toLocaleString()} words total, ${trunc.returnedWords.toLocaleString()} returned${sliceLabel}, ${trunc.remaining.toLocaleString()} remain. Continue with:`
          + `\n  read_pad({ docId: "${target.docId}", slice: { from: 0.5, to: 1 } })  — read the back half (or any percentile range)`
          + `\n  read_pad({ docId: "${target.docId}", force: true })  — entire body, cap bypassed`
          + `\n  peek_doc({ docId: "${target.docId}", target: { around: "${anchor}", after: 100 } })  — linear continuation by node`
          + `\n  outline_doc({ docId: "${target.docId}" })  — heading skeleton to jump to a section`
          + `\n  search_docs({ query: "...", docId: "${target.docId}" })  — find a specific passage]`;
      }
      return { content: [{ type: 'text', text: compact + hint }] };
    },
  },
  {
    name: 'write_to_pad',
    description: 'Preferred tool for all document edits. Send 3-8 changes per call for responsive feel. Multiple rapid calls better than one monolithic call. Content can be a markdown string (preferred) or TipTap JSON. Markdown strings are auto-converted. Changes appear as pending decorations the user accepts or rejects. Use afterNodeId: "end" to append to the document without knowing node IDs. Response includes lastNodeId for chaining subsequent inserts. Target document by docId (8-char hex from list_documents or read_pad).',
    schema: {
      changes: z.array(z.object({
        operation: z.enum(['rewrite', 'insert', 'delete']),
        nodeId: z.string().optional(),
        afterNodeId: z.string().optional(),
        content: z.any().optional(),
      })).describe('Array of node changes. Content accepts markdown strings or TipTap JSON.'),
      docId: z.string().describe('Target document by docId (8-char hex from list_documents or read_pad).'),
    },
    handler: async ({ changes, docId }: { changes: any[]; docId: string }) => {
      const filename = resolveDocId(docId);
      const processed = changes.map((change) => {
        const resolved = { ...change };
        if (typeof resolved.content === 'string') {
          resolved.content = parseMarkdownContent(resolved.content);
        }
        // Canonical form for every doc type (including X templates) is separate
        // paragraph nodes — one node per review unit, intra-paragraph single
        // <br>s preserved. Heal any fused double-<br> paragraph that arrives as
        // TipTap JSON: the markdown-string path above already splits via
        // markdown-it, but JSON content bypasses it, so an X-style fused node
        // would otherwise enter canonical and break the serialize→reparse
        // round-trip (sync-check FAIL), the node-identity matcher, and the
        // pending decorations. Idempotent on already-split content.
        // adr: adr/tweet-paragraph-convention.md
        if (resolved.content != null && resolved.operation !== 'delete') {
          const asArray = Array.isArray(resolved.content) ? resolved.content : [resolved.content];
          resolved.content = splitFusedParagraphs(asArray);
        }
        return resolved;
      });

      // Auto-clean: if doc has only a single empty paragraph and first change is
      // an insert, convert to a rewrite so the empty node gets replaced silently
      // (shows as green insert decoration, not a red delete).
      const activeDoc = getDocument();
      if (activeDoc.content?.length === 1) {
        const first = activeDoc.content[0];
        if (first.type === 'paragraph' && (!first.content || first.content.length === 0) && first.attrs?.id) {
          const insertIdx = processed.findIndex((c: any) => c.operation === 'insert');
          if (insertIdx !== -1) {
            processed[insertIdx] = { ...processed[insertIdx], operation: 'rewrite', nodeId: first.attrs.id };
            delete processed[insertIdx].afterNodeId;
          }
        }
      }

      const targetIsNonActive = filename && filename !== getActiveFilename();
      if (targetIsNonActive) {
        const { count: appliedCount, lastNodeId } = applyChangesToFile(filename, processed as NodeChange[]);
        broadcastPendingDocsChanged();
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: appliedCount > 0,
              appliedCount,
              ...(lastNodeId ? { lastNodeId } : {}),
              ...(appliedCount < processed.length ? { skipped: processed.length - appliedCount } : {}),
            }),
          }],
        };
      }

      const { count: appliedCount, lastNodeId } = applyChanges(processed as NodeChange[]);
      // broadcastPendingDocsChanged() already fires via onChanges listener in ws.ts
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: appliedCount > 0,
            appliedCount,
            ...(lastNodeId ? { lastNodeId } : {}),
            ...(appliedCount < processed.length ? { skipped: processed.length - appliedCount } : {}),
          }),
        }],
      };
    },
  },
  {
    name: 'get_pad_status',
    description: 'Get the status of a document: word count, pending changes. Cheap call for polling.',
    schema: {
      docId: z.string().describe('Target document by docId (8-char hex from list_documents).'),
    },
    handler: async ({ docId }: { docId: string }) => {
      const target = resolveDocTarget(docId);
      const status: Record<string, any> = {
        title: target.title,
        wordCount: target.wordCount,
        pendingChanges: target.pendingCount,
        lastModified: target.lastModified.toISOString(),
      };
      // Surface effective autoAccept (doc flag OR workspace/container inherited)
      // so the agent stops waiting for review when it's on.
      if (isAutoAcceptActive(target.filename, target.metadata)) status.autoAccept = true;
      // External-write drift: only meaningful for the active doc (non-active
      // docs are read fresh from disk on each access). If the file's on-disk
      // mtime differs from what we loaded, an external writer modified the
      // file — the next save would be blocked by the guard. Surface this so
      // agents can call reload_from_disk before re-attempting a write.
      // adr: adr/external-write-guard.md
      if (target.isActive) {
        const drift = getExternalMtimeDrift();
        if (drift) {
          status.externalWriteDetected = {
            diskMtime: new Date(drift.diskMtime).toISOString(),
            loadedMtime: new Date(drift.loadedMtime).toISOString(),
            note: 'File modified externally. Call reload_from_disk before writing or your changes will be blocked.',
          };
        }
      }
      const latestVersion = getUpdateInfo();
      const payload = latestVersion ? { ...status, updateAvailable: latestVersion } : status;
      return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
    },
  },
  {
    name: 'outline_doc',
    description: 'Get the structural skeleton of a doc — heading tree by default, optionally drill into one section. The right tool to orient on a long doc before reading anything. Heading tree only is ~5 tokens per heading vs read_pad\'s ~50–100 per block. For 1000-node docs the entire outline is typically <500 tokens. Drill into a section with `underHeading: nodeId` to see one section\'s block previews (~15 tokens/block). Falls back to top-level block previews when the doc has no headings. Use after `search_docs` finds the doc but before `read_pad` or `peek_doc`.',
    schema: {
      docId: z.string().describe('Target document by docId (8-char hex).'),
      underHeading: z.string().optional().describe('Heading nodeId — drill into that section and return all blocks beneath it (until the next same-or-shallower heading).'),
      depth: z.number().optional().describe('Cap on heading levels shown (1 = h1 only, 2 = h1+h2, etc.). Default 3. Ignored when underHeading is set.'),
      offset: z.number().optional().describe('Pagination start index (default 0). Useful for very long unstructured docs.'),
      limit: z.number().optional().describe('Pagination max lines (default 200).'),
    },
    handler: async ({ docId, underHeading, depth, offset, limit }: { docId: string; underHeading?: string; depth?: number; offset?: number; limit?: number }) => {
      const target = resolveDocTarget(docId);
      const text = outline(target.document, { underHeading, depth, offset, limit });
      return { content: [{ type: 'text', text }] };
    },
  },
  {
    name: 'peek_doc',
    description: 'Read a windowed slice of nodes from a doc — once you have a nodeId from search_docs or outline_doc. Six target shapes: { node } single block, { nodes } array of explicit IDs, { around, before, after } window around an anchor, { from, to } range between two anchors, { first } top N blocks, { last } bottom N blocks, { position, span } positional read (position 0.0–1.0). All return compact tagged-line format. Use this instead of read_pad whenever you only need part of a doc.',
    schema: {
      docId: z.string().describe('Target document by docId (8-char hex).'),
      target: z.union([
        z.object({ node: z.string() }).strict(),
        z.object({ nodes: z.array(z.string()) }).strict(),
        z.object({ around: z.string(), before: z.number().optional(), after: z.number().optional() }).strict(),
        z.object({ from: z.string(), to: z.string() }).strict(),
        z.object({ first: z.number() }).strict(),
        z.object({ last: z.number() }).strict(),
        z.object({ position: z.number(), span: z.number().optional() }).strict(),
      ]).describe('Target spec — exactly one shape. See description for the six options.'),
    },
    handler: async ({ docId, target }: { docId: string; target: PeekTarget }) => {
      const docTarget = resolveDocTarget(docId);
      const nodes = peek(docTarget.document, target);
      return { content: [{ type: 'text', text: compactNodes(nodes) }] };
    },
  },
  {
    name: 'get_nodes',
    description: 'DEPRECATED — superseded by peek_doc. Use peek_doc with target { nodes: [ids] } for the same behavior, or one of the other target shapes for richer windowed reads. This alias may be removed in a future release.',
    schema: {
      docId: z.string().describe('Target document by docId (8-char hex from list_documents).'),
      nodeIds: z.array(z.string()).describe('Array of node IDs to retrieve'),
    },
    handler: async ({ docId, nodeIds }: { docId: string; nodeIds: string[] }) => {
      const target = resolveDocTarget(docId);
      const nodes = target.isActive ? getNodesByIds(nodeIds) : findNodesByIds(target.document.content, nodeIds);
      return { content: [{ type: 'text', text: compactNodes(nodes) }] };
    },
  },
  {
    name: 'list_documents',
    description: 'List all documents. Shows title, docId, word count, last modified, active flag, and enrichment fields (logline, status, STALE marker) when present. Use the docId to target documents in other tools. v0.19.0: three-field enrichment schema — logline (LLM), status (agent: canonical / draft), STALE (system).',
    schema: {},
    handler: async () => {
      const docs = listDocuments();
      const lines = docs.map((d) => {
        const active = d.isActive ? ' (active)' : '';
        const id = d.docId ? ` [${d.docId}]` : '';
        const date = d.lastModified.split('T')[0];
        const enrichBits: string[] = [];
        // v0.19.0: only canonical surfaces — draft is the default and would
        // clutter the listing on every doc.
        if (d.status === 'canonical') enrichBits.push('canonical');
        if (d.enrichmentStale === true) enrichBits.push('STALE');
        const enrichTag = enrichBits.length > 0 ? ` (${enrichBits.join(', ')})` : '';
        const main = `  "${d.title}"${id}${active}${enrichTag} — ${d.wordCount.toLocaleString()} words — ${date}`;
        if (d.logline) return `${main}\n      → ${d.logline}`;
        return main;
      });
      const footer = `${enrichmentFooter()}${sortFooter()}`;
      return { content: [{ type: 'text', text: `documents:\n${lines.join('\n') || '  (none)'}${footer}` }] };
    },
  },
  {
    name: 'switch_document',
    description: 'Show a document in the user\'s browser. NOT required before reading or editing — all tools target documents by docId directly. Use only when you want to change what the user sees. Saves the current document first. Returns a compact read of the newly active document.',
    schema: {
      docId: z.string().describe('Target document by docId (8-char hex from list_documents or read_pad).'),
    },
    handler: async ({ docId }: { docId: string }) => {
      const filename = resolveDocId(docId);
      broadcastWritingFinished(); // Clear any in-progress creation spinner
      const result = switchDocument(filename);
      broadcastDocumentSwitched(result.document, result.title, result.filename);
      const compact = toCompactFormat(result.document, result.title, getWordCount(), getPendingChangeCount(), getDocId());
      return { content: [{ type: 'text', text: `Switched to "${result.title}" [${docId}]\n\n${compact}` }] };
    },
  },
  {
    name: 'create_document',
    description: 'Create a new document. content_type is REQUIRED — use "document" for plain docs, or "tweet"/"reply"/"quote"/"article"/"linkedin"/"newsletter"/"blog" for typed docs. Always provide a title. By default shows a sidebar spinner — call populate_document next to deliver content and clear it. This two-step flow is REQUIRED for all content documents: create_document → populate_document. Use empty=true ONLY for typed docs (tweets, articles) that start blank and get written to incrementally via write_to_pad. Placement accepts EITHER convention: name-based auto-create (workspace title + container name, created if absent) OR id-based targeting of existing items (workspaceFile + containerId, the same ids move_item/get_workspace_structure use). A placement param that cannot be honored (unknown workspaceFile/containerId, or a container with no workspace) is a hard error — the doc is never silently created unplaced. The result always states where the doc landed, or "UNFILED".',
    schema: {
      title: z.string().optional().describe('Title for the new document. Defaults to "Untitled".'),
      path: z.string().optional().describe('Absolute file path to create the document at (e.g. "C:/projects/doc.md"). If omitted, creates in ~/.openwriter/.'),
      workspace: z.string().optional().describe('Workspace title to add this doc to. Creates the workspace if it doesn\'t exist.'),
      container: z.string().optional().describe('Container name within the workspace (e.g. "Chapters", "Notes", "References"). Creates the container if it doesn\'t exist. Requires workspace.'),
      workspaceFile: z.string().optional().describe('Existing workspace by manifest filename (the *.json id used by move_item / get_workspace_structure). Id-based alternative to "workspace" (title). Must already exist — errors if not found. Use when you already hold the workspaceFile from another tool.'),
      containerId: z.string().optional().describe('Existing container by id (8-char hex, as used by move_item / get_workspace_structure). Id-based alternative to "container" (name). Must already exist in the resolved workspace — errors if not found. Requires a workspace (workspaceFile or workspace).'),
      empty: z.boolean().optional().describe('ONLY for content_type template docs (tweets, articles) that start blank. Skips the spinner and switches immediately. Do NOT set this for content documents — use the two-step flow (create_document → populate_document) instead.'),
      content_type: z.enum(['document', 'tweet', 'reply', 'quote', 'article', 'linkedin', 'newsletter', 'blog', 'manuscript']).describe('Required. Use "document" for plain documents. Tweet/reply/quote/article/linkedin/newsletter/blog set type-specific metadata automatically. "manuscript" = a binding doc whose body is an ordered list of [text](doc:ID) pointers under ## chapter headings; populate it with the manifest, then it compiles to EPUB/DOCX via the manuscript routes.'),
      url: z.string().optional().describe('Tweet URL — REQUIRED for content_type "reply" or "quote" (e.g. "https://x.com/user/status/123"). Sets tweetContext.url automatically. Ignored for other content types.'),
      afterId: z.string().optional().describe('Place the new doc immediately after this docId (8-char hex) or containerId inside its parent. Omit to append to the bottom of the parent (the default — matches ascending-order convention: newest at bottom). Requires workspace.'),
      status: z.enum(['canonical', 'draft']).optional().describe('Agent-owned lifecycle. "canonical" = committed to spine / load-bearing for the workspace (use for Beats docs that have locked, Research Notes, Master References). "draft" = working / not load-bearing yet / scratch (DUMP docs, first-pass beats). Defaults to "draft" when omitted. Change later via set_metadata({ status: ... }) on lifecycle transitions. v0.19.0.'),
      masterDocId: z.string().optional().describe('Make this doc a VARIANT of another doc. Pass the master doc\'s docId (8-char hex). The variant nests under its master in the sidebar (expandable tree). Use when creating a derivative — e.g. a tweet thread from a blog post. Pair with variantType. See docs/variants.md.'),
      variantType: z.string().optional().describe('Label for what kind of variant this is (e.g. "tweet", "blog", "linkedin"). Shows as a badge in the sidebar. Only meaningful alongside masterDocId.'),
    },
    handler: async ({ title, path, workspace, container, workspaceFile, containerId, empty, content_type, url, afterId, status, masterDocId, variantType }: { title?: string; path?: string; workspace?: string; container?: string; workspaceFile?: string; containerId?: string; empty?: boolean; content_type: string; url?: string; afterId?: string; status?: 'canonical' | 'draft'; masterDocId?: string; variantType?: string }) => {
      // Require url for reply/quote
      if ((content_type === 'reply' || content_type === 'quote') && !url) {
        return { content: [{ type: 'text', text: `Error: content_type "${content_type}" requires a url parameter (e.g. "https://x.com/user/status/123").` }] };
      }

      // Default title from content_type if not provided
      if (!title && content_type && content_type !== 'document') {
        const typeDefaults: Record<string, string> = {
          tweet: 'Tweet', reply: 'Reply', quote: 'Quote Tweet', article: 'Article',
          linkedin: 'LinkedIn Post', newsletter: 'Newsletter', blog: 'Blog Post',
        };
        title = typeDefaults[content_type];
      }

      // Resolve placement up front so the spinner renders in the right place.
      // Accept BOTH addressing conventions: the id-based one used across the rest
      // of the API (workspaceFile + containerId, targeting EXISTING items) and the
      // name-based auto-create one (workspace title + container name). Whichever is
      // given is resolved; a placement param that cannot be honored is a HARD ERROR
      // rather than a silent drop that orphans the doc.
      // adr: adr/create-document-placement-contract.md
      let wsTarget: { wsFilename: string; containerId: string | null } | undefined;
      if (workspace || workspaceFile || container || containerId) {
        // 1. Resolve the workspace. Prefer the explicit id (workspaceFile).
        let wsFilenameResolved: string | null = null;
        if (workspaceFile) {
          try { getWorkspace(workspaceFile); }
          catch {
            return { content: [{ type: 'text', text: `Error: create_document workspaceFile "${workspaceFile}" not found. Pass an existing workspace .json filename, or use "workspace" (title) to create one by name.` }] };
          }
          wsFilenameResolved = workspaceFile;
        } else if (workspace) {
          wsFilenameResolved = findOrCreateWorkspace(workspace).filename;
        }

        // 2. A container was requested but the workspace couldn't be resolved.
        //    Previously silently dropped — now a hard error.
        if ((container || containerId) && !wsFilenameResolved) {
          return { content: [{ type: 'text', text: `Error: create_document was given a container but no workspace. Pass "workspaceFile" (existing) or "workspace" (title, auto-created) alongside the container.` }] };
        }

        // 3. Resolve the container within that workspace.
        let resolvedContainerId: string | null = null;
        if (wsFilenameResolved) {
          if (containerId) {
            const wsObj = getWorkspace(wsFilenameResolved);
            if (!findContainer(wsObj.root, containerId)) {
              return { content: [{ type: 'text', text: `Error: create_document containerId "${containerId}" not found in workspace ${wsFilenameResolved}. Pass an existing containerId, or use "container" (name) to create one.` }] };
            }
            resolvedContainerId = containerId;
          } else if (container) {
            resolvedContainerId = findOrCreateContainer(wsFilenameResolved, container).containerId;
          }
          wsTarget = { wsFilename: wsFilenameResolved, containerId: resolvedContainerId };
          broadcastWorkspacesChanged(); // Browser sees container structure before spinner
        }
      }

      // Always state the final placement in the result, so a doc that lands in no
      // workspace says so loudly (UNFILED) — an unplaced doc can never read as a
      // bland success again. adr: brief 2026-07-09-create-document-placement-contract.
      let placement = ' (UNFILED — not added to any workspace; lives at ~/.openwriter)';
      if (wsTarget) {
        let wsLabel = wsTarget.wsFilename;
        let cLabel = '';
        try {
          const wsObj = getWorkspace(wsTarget.wsFilename);
          wsLabel = wsObj.title || wsTarget.wsFilename;
          if (wsTarget.containerId) {
            const found = findContainer(wsObj.root, wsTarget.containerId);
            if (found) cLabel = ` / ${found.node.name}`;
          }
        } catch { /* keep filename */ }
        placement = ` → workspace "${wsLabel}"${cLabel}`;
      }

      // Track the spinner key so catch can clear exactly this entry
      // (not siblings from a concurrent declare_writes).
      let spinnerKey: string | null = null;
      // v0.19.0: agent-owned status. Defaults to "draft" when not supplied —
      // canonical is reserved for docs that have committed to the workspace
      // spine (Beats, Research Notes, Master References). Agent flips to
      // canonical via set_metadata({ status: "canonical" }) on lifecycle
      // transitions. See brief 2026-05-21-simplify-enrichment-schema-three-fields.
      const statusMeta: Record<string, any> = { status: status ?? 'draft' };

      // Variant relationship (optional) — lands on the first disk write so the
      // doc nests under its master in the sidebar immediately. See docs/variants.md.
      const variantMeta: Record<string, any> = {};
      if (masterDocId) variantMeta.masterDocId = masterDocId;
      if (variantType) variantMeta.variantType = variantType;

      try {
        if (empty) {
          // Immediate switch — no spinner, no populate_document needed
          const result = createDocument(title, undefined, path);
          setAgentLock(result.filename);

          // Apply status + variant + type-specific metadata in one merge
          const initMeta: Record<string, any> = { ...statusMeta, ...variantMeta };
          if (content_type) {
            const typeMeta = resolveTypeMeta(content_type, url);
            if (typeMeta) Object.assign(initMeta, typeMeta);
          }
          setMetadata(initMeta);

          if (wsTarget) {
            // Resolve afterId: it may be a docId (8-char hex) or containerId.
            // filenameByDocId resolves docId→filename; if null, treat as containerId.
            const afterRef = afterId ? (filenameByDocId(afterId) ?? afterId) : null;
            addDoc(wsTarget.wsFilename, wsTarget.containerId, result.filename, result.title, afterRef);
          }

          const newDocId = getDocId();
          save('agent');
          broadcastDocumentsChanged();
          broadcastWorkspacesChanged();
          broadcastDocumentSwitched(getDocument(), getTitle(), getActiveFilename(), getMetadata());
          // Right-rail Activity: one entry per agent-created doc. adr: adr/right-rail.md
          broadcastActivityEvent({
            kind: 'doc-created',
            headline: `Created ${result.title || 'Untitled'}`,
            detail: content_type && content_type !== 'document' ? content_type : undefined,
            docId: newDocId,
            filename: result.filename,
          });
          return {
            content: [{
              type: 'text',
              text: `Created "${result.title}" [${newDocId}]${placement}${content_type ? ` (${content_type})` : ''} — ready.`,
            }],
          };
        }

        // Two-step flow: create file on disk WITHOUT switching the user's view.
        // The spinner persists in the sidebar until populate_document is called.
        // Merge status with any content-type metadata so it lands on the first
        // disk write.
        const typeMeta = content_type ? resolveTypeMeta(content_type, url) : undefined;
        const initialMeta = { ...statusMeta, ...variantMeta, ...(typeMeta || {}) };
        const result = createDocumentFile(title, path, initialMeta);

        if (wsTarget) {
          const afterRef = afterId ? (filenameByDocId(afterId) ?? afterId) : null;
          addDoc(wsTarget.wsFilename, wsTarget.containerId, result.filename, result.title, afterRef);
        }

        // Broadcast spinner keyed by filename so populate_document can clear exactly
        // this entry. Fires after the file exists, so documents-changed arrives with
        // the real entry that the sidebar filters behind the spinner until populate.
        spinnerKey = result.filename;
        broadcastWritingStarted(title || 'Untitled', wsTarget, spinnerKey, result.filename, result.docId);
        broadcastDocumentsChanged();
        // Right-rail Activity: one entry per agent-created doc. adr: adr/right-rail.md
        broadcastActivityEvent({
          kind: 'doc-created',
          headline: `Created ${result.title || 'Untitled'}`,
          detail: content_type && content_type !== 'document' ? content_type : undefined,
          docId: result.docId,
          filename: result.filename,
        });
        return {
          content: [{
            type: 'text',
            text: `Created "${result.title}" [${result.docId}]${placement} — empty. Call populate_document with docId "${result.docId}" to add content.`,
          }],
        };
      } catch (err) {
        if (spinnerKey) broadcastWritingFinished(spinnerKey);
        throw err;
      }
    },
  },
  {
    name: 'populate_document',
    description: 'Populate a document with content. Use after create_document (without content) to complete the two-step creation flow. Content appears as pending decorations for user review. Clears the sidebar creation spinner and shows the document. Pass the docId from create_document\'s response to ensure content goes to the right doc even if the user switched away.',
    schema: {
      content: z.any().describe('Document content: markdown string (preferred) or TipTap JSON doc object.'),
      docId: z.string().optional().describe('Target document by docId (8-char hex from create_document or list_documents). If provided and differs from the active doc, writes directly to disk without switching the user\'s view. Recommended — prevents race conditions when the user navigates during content generation.'),
    },
    handler: async ({ content, docId }: { content: any; docId?: string }) => {
      const filename = docId ? resolveDocId(docId) : undefined;
      try {
        let doc: any;

        if (typeof content === 'string') {
          // Canonical form is separate paragraph nodes for every doc type
          // (including X templates) — each paragraph a distinct review unit.
          doc = { type: 'doc', content: parseMarkdownContent(content) };
        } else if (content?.type === 'doc' && Array.isArray(content.content)) {
          doc = content;
        } else {
          broadcastWritingFinished(filename);
          return {
            content: [{ type: 'text', text: 'Error: content must be a markdown string or TipTap JSON { type: "doc", content: [...] }' }],
          };
        }

        // Heal fused double-<br> paragraphs that arrive as TipTap JSON (X-template
        // content bypasses the markdown-string split). Idempotent on the string
        // path above. adr: adr/tweet-paragraph-convention.md
        doc.content = splitFusedParagraphs(doc.content);

        // Non-active target: write directly to disk without disrupting the user's view
        const targetIsNonActive = filename && filename !== getActiveFilename();
        if (targetIsNonActive) {
          const result = populateDocumentFile(filename, doc);

          broadcastDocumentsChanged();
          broadcastWorkspacesChanged();
          broadcastPendingDocsChanged();
          broadcastWritingFinished(filename);

          return {
            content: [{
              type: 'text',
              text: `Populated "${result.title}" — ${result.wordCount.toLocaleString()} words`,
            }],
          };
        }

        // Active target (or no filename): existing flow.
        // Skip pending tagging when autoAccept is effectively on (doc flag or
        // inherited from workspace/container) — content commits directly.
        setAgentLock(filename || getActiveFilename()); // Block browser doc-updates during population
        if (!isAutoAcceptActive(filename || getActiveFilename(), getMetadata())) {
          markAllNodesAsPending(doc, 'insert');
        }
        // Preserve any pre-existing real content from canonical that the
        // incoming populate doesn't already cover, so a re-populate doesn't
        // clobber prior content. updateDocument(doc) overwrites
        // state.canonical wholesale; without this preserve step, anything
        // not in `doc.content` after this point disappears.
        //
        // Empty paragraphs are explicitly NOT preserved. createDocumentFile
        // mints a trailing empty paragraph as a TipTap "doc must have at
        // least one node" stub, and TipTap itself maintains a trailing
        // empty paragraph for cursor-landing. Preserving those during
        // populate leaves phantom empty paragraphs accumulating at the
        // end of the doc. adr: adr/pending-overlay-model.md
        const existingCanonical = getCanonical();
        if (existingCanonical?.content?.length) {
          const incomingIds = new Set(
            doc.content
              .map((n: any) => n?.attrs?.id)
              .filter((id: any) => typeof id === 'string'),
          );
          const preserved = existingCanonical.content.filter((n: any) => {
            const id = n?.attrs?.id;
            if (!id || incomingIds.has(id)) return false;
            const isEmptyParagraph = n.type === 'paragraph' && (!n.content || n.content.length === 0);
            return !isEmptyParagraph;
          });
          if (preserved.length > 0) {
            doc.content = [...doc.content, ...preserved];
          }
        }
        updateDocument(doc);
        updatePendingCacheForActiveDoc();
        save('agent');

        // Broadcast sidebar updates first (deferred from create_document) so the doc
        // entry and spinner removal arrive in the same render cycle
        broadcastDocumentsChanged();
        broadcastWorkspacesChanged();
        broadcastDocumentSwitched(doc, getTitle(), getActiveFilename());
        broadcastPendingDocsChanged();
        broadcastWritingFinished(filename || getActiveFilename());

        const wordCount = getWordCount();
        return {
          content: [{
            type: 'text',
            text: `Populated "${getTitle()}" — ${wordCount.toLocaleString()} words`,
          }],
        };
      } catch (err) {
        broadcastWritingFinished(filename);
        throw err;
      }
    },
  },
  {
    name: 'declare_writes',
    description: 'Declare a batch of documents to create at once. Use this when creating multiple documents in parallel (e.g. a series of blog drafts, a tweet thread saved as separate docs, newsletter variants). Each write gets its own sidebar spinner keyed to its filename — spinners persist across app refreshes and only clear when you call populate_document for that specific doc. Returns an array of { docId, filename, title }. Next step: call populate_document once per docId (in parallel is fine). For creating a single document, prefer create_document.',
    schema: {
      writes: z.array(z.object({
        title: z.string().describe('Title for the document.'),
        content_type: z.enum(['document', 'tweet', 'reply', 'quote', 'article', 'linkedin', 'newsletter', 'blog', 'manuscript']).describe('Content type. Use "document" for plain docs. "manuscript" = a binding doc of ordered doc: pointers.'),
        workspace: z.string().optional().describe('Workspace title to add this doc to. Creates the workspace if it does not exist.'),
        container: z.string().optional().describe('Container name within the workspace (e.g. "Chapters"). Requires workspace.'),
        url: z.string().optional().describe('Tweet URL — REQUIRED for content_type "reply" or "quote".'),
        path: z.string().optional().describe('Absolute file path to create the document at. If omitted, creates in ~/.openwriter/.'),
        afterId: z.string().optional().describe('Place the new doc immediately after this docId or containerId inside its parent. Omit to append to the bottom (default, ascending-order convention). Requires workspace.'),
      })).min(1).describe('List of documents to declare (minimum 1).'),
    },
    handler: async ({ writes }: { writes: Array<{ title: string; content_type: string; workspace?: string; container?: string; url?: string; path?: string; afterId?: string }> }) => {
      const results: Array<{ docId: string; filename: string; title: string; error?: string }> = [];
      let workspacesChanged = false;
      const broadcastedKeys: string[] = [];

      for (const w of writes) {
        try {
          if ((w.content_type === 'reply' || w.content_type === 'quote') && !w.url) {
            results.push({ docId: '', filename: '', title: w.title, error: `content_type "${w.content_type}" requires a url parameter` });
            continue;
          }

          let wsTarget: { wsFilename: string; containerId: string | null } | undefined;
          if (w.workspace) {
            const ws = findOrCreateWorkspace(w.workspace);
            let containerId: string | null = null;
            if (w.container) {
              const c = findOrCreateContainer(ws.filename, w.container);
              containerId = c.containerId;
            }
            wsTarget = { wsFilename: ws.filename, containerId };
            workspacesChanged = true;
          }

          const typeMeta = resolveTypeMeta(w.content_type, w.url);
          const result = createDocumentFile(w.title, w.path, typeMeta);

          if (wsTarget) {
            const afterRef = w.afterId ? (filenameByDocId(w.afterId) ?? w.afterId) : null;
            addDoc(wsTarget.wsFilename, wsTarget.containerId, result.filename, result.title, afterRef);
          }

          broadcastWritingStarted(w.title, wsTarget, result.filename, result.filename, result.docId);
          broadcastedKeys.push(result.filename);

          results.push({ docId: result.docId, filename: result.filename, title: result.title });
        } catch (err: any) {
          results.push({ docId: '', filename: '', title: w.title, error: err.message });
        }
      }

      broadcastDocumentsChanged();
      if (workspacesChanged) broadcastWorkspacesChanged();

      const successes = results.filter((r) => !r.error);
      const failures = results.filter((r) => r.error);

      const lines = [
        `Declared ${successes.length} write${successes.length === 1 ? '' : 's'}${failures.length ? ` (${failures.length} failed)` : ''}:`,
        ...successes.map((r) => `  "${r.title}" [${r.docId}] → ${r.filename}`),
      ];
      if (failures.length) {
        lines.push('', 'Errors:');
        for (const r of failures) lines.push(`  "${r.title}" — ${r.error}`);
      }
      if (successes.length) {
        lines.push('', 'Next: call populate_document once per docId to fill in content.');
      }

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  },
  {
    name: 'open_file',
    description: 'Open an existing .md file from any location on disk. Saves the current document first, then loads the file and sets it as active. The file appears in the sidebar and edits save back to the original path.',
    schema: {
      path: z.string().describe('Absolute path to the .md file to open (e.g. "C:/projects/blog/post.md")'),
    },
    handler: async ({ path }: { path: string }) => {
      const result = openFile(path);
      broadcastDocumentSwitched(result.document, result.title, result.filename);
      const openedDocId = getDocId();
      const compact = toCompactFormat(result.document, result.title, getWordCount(), getPendingChangeCount(), openedDocId);
      return { content: [{ type: 'text', text: `Opened "${result.title}" [${openedDocId}] from ${path}\n\n${compact}` }] };
    },
  },
  {
    name: 'delete_document',
    description: 'Delete a document file. Moves to OS trash (Recycle Bin / macOS Trash). If deleting the active document, automatically switches to the most recent remaining doc. Cannot delete the last document. IMPORTANT: Always confirm with the user before calling this tool. Target document by docId (8-char hex from list_documents or read_pad).',
    schema: {
      docId: z.string().describe('Target document by docId (8-char hex from list_documents or read_pad).'),
    },
    handler: async ({ docId }: { docId: string }) => {
      const filename = resolveDocId(docId);
      // Capture title before the file is moved to trash — resolveDocTarget reads
      // from disk and won't work post-delete.
      let deletedTitle = filename.replace(/\.md$/, '');
      try { deletedTitle = resolveDocTarget(docId).title || deletedTitle; } catch { /* fallback to filename */ }
      const result = await deleteDocument(filename);
      removeDocFromAllWorkspaces(filename);
      if (result.switched && result.newDoc) {
        broadcastDocumentSwitched(result.newDoc.document, result.newDoc.title, result.newDoc.filename);
      }
      broadcastDocumentsChanged();
      broadcastWorkspacesChanged();
      // Right-rail Activity: one entry per agent-deleted doc. docId is recorded
      // but the client treats doc-deleted entries as non-clickable. adr: adr/right-rail.md
      broadcastActivityEvent({
        kind: 'doc-deleted',
        headline: `Deleted ${deletedTitle}`,
        docId,
        filename,
      });
      let text = `Deleted "${filename}" (moved to trash)`;
      if (result.switched && result.newDoc) {
        text += `. Switched to "${result.newDoc.title}"`;
      }
      return { content: [{ type: 'text', text }] };
    },
  },
  {
    name: 'archive_document',
    description: 'Archive a document. Removes it from the active document list without deleting the file. Archived docs can be restored later with unarchive_document. If archiving the active document, automatically switches to the most recent remaining doc. Target document by docId (8-char hex from list_documents).',
    schema: {
      docId: z.string().describe('Target document by docId (8-char hex from list_documents).'),
    },
    handler: async ({ docId }: { docId: string }) => {
      const filename = resolveDocId(docId);
      const result = archiveDocument(filename);
      removeDocFromAllWorkspaces(filename);
      if (result.switched && result.newDoc) {
        broadcastDocumentSwitched(result.newDoc.document, result.newDoc.title, result.newDoc.filename);
      }
      broadcastDocumentsChanged();
      broadcastWorkspacesChanged();
      let text = `Archived "${filename}"`;
      if (result.switched && result.newDoc) {
        text += `. Switched to "${result.newDoc.title}"`;
      }
      return { content: [{ type: 'text', text }] };
    },
  },
  {
    name: 'unarchive_document',
    description: 'Restore an archived document back to the active document list. Target document by docId (8-char hex from list_documents with includeArchived).',
    schema: {
      docId: z.string().describe('Target document by docId (8-char hex).'),
    },
    handler: async ({ docId }: { docId: string }) => {
      const filename = resolveDocId(docId);
      const result = unarchiveDocument(filename);
      broadcastDocumentsChanged();
      return { content: [{ type: 'text', text: `Restored "${result.title}" [${docId}] from archive` }] };
    },
  },
  ...manuscriptTools,
  {
    name: 'get_metadata',
    description: 'Get the JSON frontmatter metadata for a document. Returns all key-value pairs stored in frontmatter (title, summary, characters, tags, etc.). Useful for understanding document context without reading full content.',
    schema: {
      docId: z.string().describe('Target document by docId (8-char hex from list_documents).'),
    },
    handler: async ({ docId }: { docId: string }) => {
      const target = resolveDocTarget(docId);
      return { content: [{ type: 'text', text: Object.keys(target.metadata).length > 0 ? JSON.stringify(target.metadata) : '{}' }] };
    },
  },
  {
    name: 'get_attribution',
    description: 'Get human-vs-agent author attribution for a document. Returns the char-weighted composition (% human / % agent / % unknown) plus per-node coarse origin (human | agent | mixed | unknown). Attribution is captured automatically at save time and anchored to sentence content, so it survives edits, splits, and paste-back. "unknown" = content authored before attribution tracking began. Use to report how much of a doc is genuinely author-written vs agent-scaffolded.',
    schema: {
      docId: z.string().describe('Target document by docId (8-char hex from list_documents).'),
    },
    handler: async ({ docId }: { docId: string }) => {
      const target = resolveDocTarget(docId);
      const blocks = tiptapToBlocks(target.document);
      const blame = readBlame(docId);
      const summary = summarizeBlame(blame, blocks);
      const nodeCounts = { human: 0, agent: 0, mixed: 0, unknown: 0 } as Record<string, number>;
      for (const origin of Object.values(summary.nodes)) nodeCounts[origin] = (nodeCounts[origin] ?? 0) + 1;
      return { content: [{ type: 'text', text: JSON.stringify({
        docId,
        percent: summary.percent,
        chars: summary.chars,
        nodeOrigins: summary.nodes,
        nodeCounts,
        tracked: blame !== null,
        attributionSince: blame?.attributionSince ?? null,
      }) }] };
    },
  },
  {
    name: 'set_metadata',
    description: 'Update frontmatter metadata on a document. Merges with existing metadata — only provided keys are changed. Use for summaries, character lists, tags, arc notes, or any organizational data. Saves to disk immediately. Lifecycle convention (v0.19.0): use `set_metadata({ status: "canonical" })` when a doc commits to the workspace spine (Beats locks, Research Note becomes load-bearing); use `set_metadata({ status: "draft" })` when a doc is superseded or demoted. Status is the agent\'s field — the enrichment minion never writes it.',
    schema: {
      docId: z.string().describe('Target document by docId (8-char hex from list_documents).'),
      metadata: z.record(z.any()).describe('Key-value pairs to merge into frontmatter. Set a key to null to remove it.'),
    },
    handler: async ({ docId, metadata: rawUpdates }: { docId: string; metadata: Record<string, any> }) => {
      const target = resolveDocTarget(docId);

      // MCP-9: strip control keys. `autoAccept` governs the human accept/reject
      // gate — an agent that could set it via set_metadata would self-grant
      // auto-accept and bypass human review entirely. The approval-mode flag is
      // operator-only (UI toggle → setDocAutoAccept / setWorkspaceAutoAccept).
      // Stripping covers both set AND remove: deleting an explicit
      // `autoAccept: false` would re-enable workspace-inherited auto-accept.
      const updates: Record<string, any> = {};
      const blockedKeys: string[] = [];
      for (const [key, value] of Object.entries(rawUpdates)) {
        if (AGENT_FORBIDDEN_METADATA_KEYS.has(key)) { blockedKeys.push(key); continue; }
        updates[key] = value;
      }

      const setKeys: string[] = [];
      const removed: string[] = [];

      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === undefined) {
          removed.push(key);
        } else {
          setKeys.push(key);
        }
      }

      const cleaned: Record<string, any> = {};
      for (const key of setKeys) cleaned[key] = updates[key];

      // Title is gated through pending-overlay unless this is a temp file
      // being titled for the first time (creation path — promoteTempFile
      // must run synchronously so the file gets a real filename on disk).
      // adr: adr/pending-overlay-model.md
      let stagedTitle: { from: string; to: string } | null = null;
      const isCreationTitleSet = cleaned.title && target.isActive && getIsTemp();
      const wantsTitlePending = cleaned.title && !isCreationTitleSet;
      if (wantsTitlePending) {
        const staged = stagePendingTitle(docId, cleaned.title);
        if (staged.from !== staged.to) {
          stagedTitle = { from: staged.from, to: staged.to };
        }
        delete cleaned.title; // remove from the hot-write path
      }

      if (target.isActive) {
        // Active doc: use in-memory path
        if (Object.keys(cleaned).length > 0) setMetadata(cleaned);
        const meta = getMetadata();
        for (const key of removed) delete meta[key];
        save('agent');
        broadcastMetadataChanged(getMetadata());

        if (cleaned.title) {
          // Reached only on temp-file creation titling — hot promote.
          const promoted = promoteTempFile(cleaned.title);
          broadcastTitleChanged(cleaned.title);
          broadcastDocumentsChanged();
          if (promoted) {
            broadcastDocumentSwitched(getDocument(), getTitle(), promoted, getMetadata());
          }
        }
      } else {
        // Non-active doc: read → merge → write file
        let meta = { ...target.metadata };
        if (Object.keys(cleaned).length > 0) {
          const merged = mergeMetadataUpdates(meta, cleaned);
          if (merged) meta = merged;
        }
        for (const key of removed) delete meta[key];
        // Title may have been stripped out for pending-staging; preserve the
        // canonical (on-disk) title in the rewrite.
        const newTitle = meta.title || target.title;
        const markdown = tiptapToMarkdown(target.document, newTitle, meta);
        atomicWriteFileSync(target.filePath, markdown);
        invalidateDocCache(target.filePath);
      }

      if (stagedTitle) {
        broadcastPendingMetadataChanged(docId, { title: stagedTitle });
        broadcastPendingDocsChanged();
      }

      const keys = Object.keys(cleaned);
      const parts: string[] = [];
      if (keys.length > 0) parts.push(`set: ${keys.join(', ')}`);
      if (removed.length > 0) parts.push(`removed: ${removed.join(', ')}`);
      if (blockedKeys.length > 0) parts.push(`ignored (operator-only): ${blockedKeys.join(', ')}`);
      return { content: [{ type: 'text', text: `Metadata updated (${parts.join('; ')})` }] };
    },
  },
  ...createEnrichmentTools(resolveDocTarget),
  {
    name: 'list_pending_sorts',
    description: 'List documents the user marked for sorting via the sidebar. Each entry includes the doc identity, where it currently lives, the requestedAt timestamp, and (when present) a proposal from an earlier pass. The sort minion (openwriter-sort-minion) calls this first to know what to file. For each entry: read the body, consider workspace/container purpose hints, then move_item + mark_sorted to auto-file it. Docs in opted-out workspaces (autoSortDisabled: true) are excluded. propose_sort remains for the manual sidebar accept/reject flow.',
    schema: {
      workspaceFile: z.string().optional().describe('Scope to one workspace. Omit to scan all workspaces.'),
    },
    handler: async ({ workspaceFile }: { workspaceFile?: string }) => {
      const docs = listPendingSorts(workspaceFile);
      return { content: [{ type: 'text', text: JSON.stringify({ total: docs.length, docs }) }] };
    },
  },
  {
    name: 'propose_sort',
    description: 'Write a sort proposal back to a doc. Used in confirm-mode: the minion picks a destination (workspace + container) and a one-line reasoning, stamps it onto the doc\'s sortRequest, and the sidebar flips the doc\'s badge to "proposal ready" so the user can accept or reject in-browser. Does NOT move the doc — that happens on user accept (via the UI) or in auto-mode via mark_sorted+move_item. Accepts an array so a batch lands in one call.',
    schema: {
      proposals: z.array(z.object({
        docId: z.string().describe('Target document by docId (8-char hex from list_pending_sorts).'),
        wsFilename: z.string().describe('Destination workspace manifest filename.'),
        containerId: z.string().nullable().describe('Destination container ID, or null for workspace root.'),
        reasoning: z.string().max(200).describe('One-line rationale shown to the user beside the proposal. Under 200 chars.'),
      }).strict()).describe('One or more proposals. Single-doc calls are a length-1 array.'),
    },
    handler: async ({ proposals }: { proposals: Array<{ docId: string; wsFilename: string; containerId: string | null; reasoning: string }> }) => {
      const results: Array<{ docId: string; ok: boolean; error?: string }> = [];
      for (const p of proposals) {
        try {
          const filename = resolveDocId(p.docId);
          setSortProposalOnFile(filename, { wsFilename: p.wsFilename, containerId: p.containerId, reasoning: p.reasoning });
          results.push({ docId: p.docId, ok: true });
        } catch (err: any) {
          results.push({ docId: p.docId, ok: false, error: String(err?.message ?? err) });
        }
      }
      broadcastDocumentsChanged();
      const okCount = results.filter((r) => r.ok).length;
      const failCount = results.length - okCount;
      const summary = failCount === 0
        ? `Wrote ${okCount} proposal${okCount === 1 ? '' : 's'}`
        : `Wrote ${okCount} proposal${okCount === 1 ? '' : 's'}, ${failCount} failed`;
      return { content: [{ type: 'text', text: `${summary}\n${JSON.stringify({ proposals: results })}` }] };
    },
  },
  {
    name: 'mark_sorted',
    description: 'Clear a doc\'s sortRequest and stamp lastSortedAt. Used in auto-mode after the minion has actually called move_item (or decided the doc is already in the right place), and in confirm-mode after the user has accepted/rejected via the UI. Accepts an array for batch fulfillment. Does NOT perform the move — call move_item first. The retire-on-fulfillment pattern mirrors mark_enriched / enrichmentStale.',
    schema: {
      docs: z.array(z.object({
        docId: z.string().describe('Target document by docId.'),
      }).strict()).describe('One or more docs to mark sorted.'),
    },
    handler: async ({ docs }: { docs: Array<{ docId: string }> }) => {
      const results: Array<{ docId: string; ok: boolean; error?: string }> = [];
      for (const item of docs) {
        try {
          const filename = resolveDocId(item.docId);
          clearSortRequestOnFile(filename);
          results.push({ docId: item.docId, ok: true });
        } catch (err: any) {
          results.push({ docId: item.docId, ok: false, error: String(err?.message ?? err) });
        }
      }
      broadcastDocumentsChanged();
      const okCount = results.filter((r) => r.ok).length;
      const failCount = results.length - okCount;
      const summary = failCount === 0
        ? `Marked ${okCount} sorted`
        : `Marked ${okCount} sorted, ${failCount} failed`;
      return { content: [{ type: 'text', text: `${summary}\n${JSON.stringify({ docs: results })}` }] };
    },
  },
  {
    name: 'browse_docs',
    description: 'Browse the workspace shelf at concept level — bulk-read enriched frontmatter per doc, filtered by criteria. Returns identity + logline + status + tags + stale flag (~60 tokens/doc). No bodies, no nodes, no pending overlay, no container nesting. Filters compose with AND semantics; empty filter returns every non-archived doc. Use this between get_workspace_structure (tree shape) and read_pad (full body) — see which docs look relevant before paying to read one.',
    schema: {
      workspaceFile: z.string().optional().describe('Scope to one workspace.'),
      tags: z.array(z.string()).optional().describe('Docs must have ALL listed tags.'),
      status: z.enum(['canonical', 'draft']).optional().describe('Agent-owned lifecycle filter. "canonical" returns the trusted-shelf docs (load-bearing for the workspace); "draft" returns working / superseded / scratch docs. The common browse is `status: canonical`.'),
      hasLogline: z.boolean().optional().describe('True = only docs with a logline; false = only docs without one.'),
    },
    handler: async (filter: { workspaceFile?: string; tags?: string[]; status?: 'canonical' | 'draft'; hasLogline?: boolean }) => {
      const docs = crawlDocs(filter);
      return { content: [{ type: 'text', text: JSON.stringify({ total: docs.length, docs }) }] };
    },
  },
  {
    name: 'crawl',
    description: 'DEPRECATED — renamed to browse_docs. Use browse_docs instead. This alias may be removed in a future release.',
    schema: {
      workspaceFile: z.string().optional(),
      tags: z.array(z.string()).optional(),
      status: z.enum(['canonical', 'draft']).optional(),
      hasLogline: z.boolean().optional(),
    },
    handler: async (filter: { workspaceFile?: string; tags?: string[]; status?: 'canonical' | 'draft'; hasLogline?: boolean }) => {
      const docs = crawlDocs(filter);
      return { content: [{ type: 'text', text: JSON.stringify({ total: docs.length, docs }) }] };
    },
  },
  {
    name: 'list_workspaces',
    description: 'List all workspaces. Returns filename, title, and doc count.',
    schema: {},
    handler: async () => {
      const workspaces = listWorkspaces();
      const lines = workspaces.map((w) => `  ${w.filename} — "${w.title}" — ${w.docCount} docs`);
      const footer = `${enrichmentFooter()}${sortFooter()}`;
      return { content: [{ type: 'text', text: `workspaces:\n${lines.join('\n') || '  (none)'}${footer}` }] };
    },
  },
  {
    name: 'create_workspace',
    description: 'Create a new workspace. Workspaces are flexible containers for documents — add containers and tags after creation.',
    schema: {
      title: z.string().describe('Workspace title'),
      voiceProfileId: z.string().optional().describe('Author\'s Voice profile ID (future use)'),
    },
    handler: async ({ title, voiceProfileId }: { title: string; voiceProfileId?: string }) => {
      const info = createWorkspace({ title, voiceProfileId });
      broadcastWorkspacesChanged();
      return { content: [{ type: 'text', text: `Created workspace "${info.title}" (${info.filename})` }] };
    },
  },
  {
    name: 'delete_workspace',
    description: 'Delete a workspace and all its document files. Files go to OS trash (Recycle Bin / macOS Trash). IMPORTANT: Always confirm with the user before calling this tool.',
    schema: {
      filename: z.string().describe('Workspace manifest filename (e.g. "my-novel-a1b2c3d4.json")'),
    },
    handler: async ({ filename }: { filename: string }) => {
      // Capture workspace title before delete so the activity entry can name it.
      let wsTitle = filename.replace(/\.json$/, '');
      try { wsTitle = getWorkspace(filename).title || wsTitle; } catch { /* fallback to filename */ }
      const result = await deleteWorkspace(filename);
      broadcastWorkspacesChanged();
      broadcastDocumentsChanged();
      // Right-rail Activity: single summary entry for the cascade. Per-doc
      // entries would flood the log for large workspaces; one entry naming
      // the workspace + doc count is the better default. adr: adr/right-rail.md
      const n = result.deletedFiles.length;
      broadcastActivityEvent({
        kind: 'doc-deleted',
        headline: `Deleted workspace ${wsTitle}`,
        detail: `${n} doc${n === 1 ? '' : 's'}`,
      });
      let text = `Deleted workspace "${filename}" and ${result.deletedFiles.length} files: ${result.deletedFiles.join(', ')}`;
      if (result.skippedExternal.length > 0) {
        text += `\nSkipped ${result.skippedExternal.length} external files (not owned by OpenWriter): ${result.skippedExternal.join(', ')}`;
      }
      return { content: [{ type: 'text', text }] };
    },
  },
  {
    name: 'get_workspace_structure',
    description: 'Get the tree shape of a workspace: containers and docs with their IDs/filenames, plus workspace-level structural fields (schema, vocab, enrichment flag). NO per-doc loglines, status, tags, or stale flags — those are concept-level and live in `browse`. Use this when you need to find a destination container (sort, move) or understand nesting. For "what is each doc about" call `browse` instead.',
    schema: {
      filename: z.string().describe('Workspace manifest filename (e.g. "my-novel-a1b2c3d4.json")'),
    },
    handler: async ({ filename }: { filename: string }) => {
      const ws = getWorkspace(filename);

      function renderTree(nodes: WorkspaceNode[], indent: string): string[] {
        const lines: string[] = [];
        for (const node of nodes) {
          if (node.type === 'doc') {
            lines.push(`${indent}${getDocTitle(node.file)}  (${node.file})`);
          } else {
            lines.push(`${indent}[container] ${node.name}  (id:${node.id})`);
            lines.push(...renderTree(node.items, indent + '  '));
          }
        }
        return lines;
      }

      const treeLines = renderTree(ws.root, '  ');
      const headerBits: string[] = [`workspace: "${ws.title}"`];
      if (ws.schema) headerBits.push(`schema: ${ws.schema}`);
      if (Array.isArray(ws.vocab) && ws.vocab.length > 0) {
        headerBits.push(`vocab: ${ws.vocab.join(', ')}`);
      }
      if (ws.enrichmentDisabled === true) headerBits.push('enrichment: disabled');
      if (ws.autoSortDisabled === true) headerBits.push('auto-sort: disabled');

      let text = `${headerBits.join('\n')}\nstructure:\n${treeLines.join('\n') || '  (empty)'}`;

      if (ws.context && Object.keys(ws.context).length > 0) {
        text += `\ncontext:\n${JSON.stringify(ws.context, null, 2)}`;
      }
      const footer = `${enrichmentFooter()}${sortFooter()}`;
      return { content: [{ type: 'text', text: `${text}${footer}` }] };
    },
  },
  {
    name: 'get_item_context',
    description: 'Get progressive-disclosure context for a document: workspace-level context (characters, settings, rules, vocab), the doc\'s own enrichment (logline, status), tags, and the enrichmentStale flag. Use before writing to understand context, or before reading to decide whether a body read is necessary. v0.19.0: returns the three-field enrichment schema — logline (LLM), status (agent), enrichmentStale (system).',
    schema: {
      workspaceFile: z.string().describe('Workspace manifest filename'),
      docId: z.string().describe('Document docId (8-char hex from list_documents)'),
    },
    handler: async ({ workspaceFile, docId }: { workspaceFile: string; docId: string }) => {
      const filename = resolveDocId(docId);
      const base = getItemContext(workspaceFile, filename) as Record<string, any>;

      // Layer doc-level enrichment + workspace-level vocab/schema into the response.
      // The agent's crawl pattern: get_item_context for one doc → see logline +
      // domain + concepts. Decide whether the doc warrants a body read.
      try {
        const ws = getWorkspace(workspaceFile);
        const enriched = crawlDocs({ workspaceFile });
        const docEnrich = enriched.find((e) => e.filename === filename);
        if (docEnrich) {
          // v0.19.0 three-field schema: logline (LLM), status (agent),
          // enrichmentStale (system). domain / concepts / docRole dropped.
          if (docEnrich.logline) base.logline = docEnrich.logline;
          if (docEnrich.status) base.status = docEnrich.status;
          if (docEnrich.enrichmentStale === true) base.enrichmentStale = true;
        }
        if (ws.schema) base.workspaceSchema = ws.schema;
        if (Array.isArray(ws.vocab) && ws.vocab.length > 0) base.workspaceVocab = ws.vocab;
        if (ws.logline) base.workspaceLogline = ws.logline;
        if (ws.domain) base.workspaceDomain = ws.domain;
      } catch { /* best-effort enrichment overlay */ }

      return { content: [{ type: 'text', text: JSON.stringify(base, null, 2) }] };
    },
  },
  {
    name: 'update_workspace_context',
    description: 'Update workspace configuration. Accepts writing context (characters, settings, rules — merged into existing) plus config fields (logline, domain, schema, vocab, relatedWorkspaces, enrichmentVolumeThreshold, enrichmentDriftThreshold, enrichmentDisabled, autoSortDisabled — set on workspace top-level). Pass `null` to clear a field. Use this to opt a workspace out of enrichment (enrichmentDisabled: true) or auto-sort (autoSortDisabled: true), declare a closed vocab for domain classification, or set workspace-level loglines/schemas. One tool covers writing context + enrichment + sort config.',
    schema: {
      workspaceFile: z.string().describe('Workspace manifest filename'),
      context: z.object({
        characters: z.record(z.string()).optional().describe('Character name → description (merged)'),
        settings: z.record(z.string()).optional().describe('Setting name → description (merged)'),
        rules: z.array(z.string()).optional().describe('Writing rules for this workspace (replaces)'),
        logline: z.string().nullable().optional().describe('One-sentence "what this workspace is for". Set null to clear.'),
        domain: z.string().nullable().optional().describe('Subject area (e.g. "Marine biology"). Set null to clear.'),
        schema: z.string().nullable().optional().describe('Workspace kind: book / concept-library / inbox / social / reference. Set null to clear.'),
        vocab: z.array(z.string()).nullable().optional().describe('Closed list of valid domain names — Haiku classifies docs INTO these. Set null to clear (opens vocab to free-form).'),
        relatedWorkspaces: z.array(z.string()).nullable().optional().describe('Sibling workspace filenames. Set null to clear.'),
        enrichmentVolumeThreshold: z.number().nullable().optional().describe('Volume-ratio threshold (default 1.5). Set null to revert.'),
        enrichmentDriftThreshold: z.number().nullable().optional().describe('Jaccard-drift threshold (default 0.3). Set null to revert.'),
        enrichmentDisabled: z.boolean().nullable().optional().describe('True = opt this workspace out of enrichment surfacing. Set null or false to re-enable.'),
        autoSortDisabled: z.boolean().nullable().optional().describe('True = opt this workspace out of auto-sort; its sort-marked docs drop from list_pending_sorts so the sort minion never auto-files them (user handles them manually via the sidebar). Set null or false to re-enable.'),
      }).describe('Writing context + enrichment + sort config to apply'),
    },
    handler: async ({ workspaceFile, context }: any) => {
      updateWorkspaceContext(workspaceFile, context);
      const keys = Object.keys(context).filter((k: string) => context[k] !== undefined);
      return { content: [{ type: 'text', text: `Workspace context updated (${keys.join(', ')})` }] };
    },
  },
  {
    name: 'create_container',
    description: 'Create a container (folder) inside a workspace. Max nesting depth: 3.',
    schema: {
      workspaceFile: z.string().describe('Workspace manifest filename'),
      name: z.string().describe('Container name (e.g. "Chapters", "Research")'),
      parentContainerId: z.string().optional().describe('Parent container ID for nesting (null = root level)'),
      afterId: z.string().optional().describe('Place the new container immediately after this docId (8-char hex) or containerId inside its parent. Omit to append to the bottom of the parent (the default — matches ascending-order convention).'),
    },
    handler: async ({ workspaceFile, name, parentContainerId, afterId }: any) => {
      // Resolve afterId: may be docId (8-char hex) or containerId. filenameByDocId
      // resolves docId→filename; if null, treat as containerId.
      const afterRef = afterId ? (filenameByDocId(afterId) ?? afterId) : null;
      const result = addContainerToWorkspace(workspaceFile, parentContainerId ?? null, name, afterRef);
      broadcastWorkspacesChanged();
      return { content: [{ type: 'text', text: `Created container "${name}" (id:${result.containerId})` }] };
    },
  },
  {
    name: 'delete_container',
    description: 'Delete a container from a workspace. Any docs inside are removed from the workspace (files are NOT deleted from disk).',
    schema: {
      workspaceFile: z.string().describe('Workspace manifest filename'),
      containerId: z.string().describe('Container ID to delete'),
    },
    handler: async ({ workspaceFile, containerId }: { workspaceFile: string; containerId: string }) => {
      removeContainer(workspaceFile, containerId);
      broadcastWorkspacesChanged();
      return { content: [{ type: 'text', text: `Deleted container ${containerId}` }] };
    },
  },
  {
    name: 'tag_doc',
    description: 'Add a tag to a document. Tags are stored in the document\'s frontmatter — they travel with the file. A doc can have multiple tags.',
    schema: {
      docId: z.string().describe('Document docId (8-char hex from list_documents)'),
      tag: z.string().describe('Tag name to add'),
    },
    handler: async ({ docId, tag }: any) => {
      const filename = resolveDocId(docId);
      addDocTag(filename, tag);
      broadcastDocumentsChanged();
      return { content: [{ type: 'text', text: `Tagged "${filename}" with [${tag}]` }] };
    },
  },
  {
    name: 'untag_doc',
    description: 'Remove a tag from a document.',
    schema: {
      docId: z.string().describe('Document docId (8-char hex from list_documents)'),
      tag: z.string().describe('Tag name to remove'),
    },
    handler: async ({ docId, tag }: any) => {
      const filename = resolveDocId(docId);
      removeDocTag(filename, tag);
      broadcastDocumentsChanged();
      return { content: [{ type: 'text', text: `Removed tag [${tag}] from "${filename}"` }] };
    },
  },
  {
    name: 'move_item',
    description: 'Move or reorder a doc, container, or workspace. For docs: add to workspace or move within it. For containers: move to different parent or reorder within current parent. For workspaces: reorder in sidebar.',
    schema: {
      type: z.enum(['doc', 'container', 'workspace']).describe('What to move'),
      workspaceFile: z.string().optional().describe('Workspace manifest filename (required for doc/container)'),
      itemId: z.string().describe('docId (8-char hex), containerId, or workspace filename'),
      targetContainerId: z.string().optional().describe('Destination container (omit for root or same-parent reorder). Doc/container only.'),
      afterId: z.string().optional().describe('Place after this item (omit for beginning)'),
    },
    handler: async ({ type, workspaceFile, itemId, targetContainerId, afterId }: any) => {
      if (type === 'doc') {
        if (!workspaceFile) return { content: [{ type: 'text', text: 'Error: workspaceFile is required for doc moves' }] };
        const filename = resolveDocId(itemId);
        const ws = getWorkspace(workspaceFile);
        const inTarget = findDocNode(ws.root, filename);
        if (inTarget) {
          // Within same workspace — reorder/move to container
          moveDoc(workspaceFile, filename, targetContainerId ?? null, afterId ?? null);
        } else {
          // Cross-workspace move: remove from old, add to new
          removeDocFromAllWorkspaces(filename);
          addDoc(workspaceFile, targetContainerId ?? null, filename, getDocTitle(filename), afterId ?? null);
        }
        broadcastWorkspacesChanged();
        return { content: [{ type: 'text', text: `Moved "${filename}"${targetContainerId ? ` to container ${targetContainerId}` : ' to root'}` }] };
      }
      if (type === 'container') {
        if (!workspaceFile) return { content: [{ type: 'text', text: 'Error: workspaceFile is required for container moves' }] };
        if (targetContainerId !== undefined) {
          moveContainer(workspaceFile, itemId, targetContainerId, afterId ?? null);
        } else {
          moveContainer(workspaceFile, itemId, null, afterId ?? null);
        }
        broadcastWorkspacesChanged();
        return { content: [{ type: 'text', text: `Moved container "${itemId}"${targetContainerId ? ` to container ${targetContainerId}` : ''}${afterId ? ` after ${afterId}` : ' to beginning'}` }] };
      }
      if (type === 'workspace') {
        reorderWorkspaceAfter(itemId, afterId ?? null);
        broadcastWorkspacesChanged();
        return { content: [{ type: 'text', text: `Reordered workspace "${itemId}"${afterId ? ` after ${afterId}` : ' to beginning'}` }] };
      }
      return { content: [{ type: 'text', text: `Error: unknown type "${type}"` }] };
    },
  },
  {
    name: 'rename_item',
    description: 'Rename a workspace, container, or document. For workspaces: updates the manifest title. For containers: updates the container name in the workspace tree. For documents: updates the title in frontmatter — use docId to identify the document.',
    schema: {
      type: z.enum(['workspace', 'container', 'document']).describe('What to rename'),
      filename: z.string().optional().describe('Workspace manifest filename (required for workspace/container renames). Not used for document renames.'),
      docId: z.string().optional().describe('Document docId (required for document renames, 8-char hex from list_documents).'),
      newName: z.string().describe('The new name/title'),
      containerId: z.string().optional().describe('Container ID (required for container renames)'),
      workspaceFile: z.string().optional().describe('Parent workspace filename (required for container renames)'),
    },
    handler: async ({ type, filename, docId, newName, containerId, workspaceFile }: { type: string; filename?: string; docId?: string; newName: string; containerId?: string; workspaceFile?: string }) => {
      if (type === 'workspace') {
        if (!filename) return { content: [{ type: 'text', text: 'Error: filename is required for workspace renames' }] };
        renameWorkspace(filename, newName);
        broadcastWorkspacesChanged();
        return { content: [{ type: 'text', text: `Renamed workspace to "${newName}"` }] };
      }
      if (type === 'container') {
        const wsFile = workspaceFile || filename;
        if (!wsFile) return { content: [{ type: 'text', text: 'Error: workspaceFile or filename is required for container renames' }] };
        if (!containerId) return { content: [{ type: 'text', text: 'Error: containerId is required for container renames' }] };
        renameContainer(wsFile, containerId, newName);
        broadcastWorkspacesChanged();
        return { content: [{ type: 'text', text: `Renamed container ${containerId} to "${newName}"` }] };
      }
      if (type === 'document') {
        if (!docId) return { content: [{ type: 'text', text: 'Error: docId is required for document renames' }] };
        // Agent-initiated rename: stage as pending. The user accepts/rejects
        // via the title-bar inline diff in the browser. The .md file on disk
        // is NOT modified until accept. adr: adr/pending-overlay-model.md
        const staged = stagePendingTitle(docId, newName);
        broadcastPendingMetadataChanged(docId, { title: { from: staged.from, to: staged.to } });
        // Sidebar / docs list shows a pending indicator for this doc.
        broadcastPendingDocsChanged();
        if (staged.from === newName) {
          return { content: [{ type: 'text', text: `Document [${docId}] already titled "${newName}" — no change staged.` }] };
        }
        return { content: [{ type: 'text', text: `Staged title rename for [${docId}]: "${staged.from}" → "${newName}". User will accept or reject in the editor.` }] };
      }
      return { content: [{ type: 'text', text: `Error: unknown type "${type}"` }] };
    },
  },
  {
    name: 'edit_text',
    description: 'Apply fine-grained text edits within a node. Find text by exact match and replace it, or add/remove marks on matched text. More precise than rewriting the whole node. Target document by docId (8-char hex from list_documents or read_pad).',
    schema: {
      nodeId: z.string().describe('ID of the node to edit'),
      edits: z.array(z.object({
        find: z.string().describe('Exact text to find within the node'),
        replace: z.string().optional().describe('Replacement text (omit to keep text, just change marks)'),
        addMark: z.object({
          type: z.string(),
          attrs: z.record(z.any()).optional(),
        }).optional().describe('Mark to add to the matched text (e.g. link, bold)'),
        removeMark: z.string().optional().describe('Mark type to remove from matched text'),
      })).describe('Array of text edits to apply'),
      docId: z.string().describe('Target document by docId (8-char hex from list_documents or read_pad).'),
    },
    handler: async ({ nodeId, edits, docId }: { nodeId: string; edits: any[]; docId: string }) => {
      const filename = resolveDocId(docId);
      const targetIsNonActive = filename && filename !== getActiveFilename();
      if (targetIsNonActive) {
        const result = applyTextEditsToFile(filename, nodeId, edits);
        if (result.success) broadcastPendingDocsChanged();
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify(applyTextEdits(nodeId, edits)) }] };
    },
  },
  {
    name: 'import_gdoc',
    description: 'Import a structured Google Doc into OpenWriter. Pass the raw JSON from the Google Docs API (the object with body.content). Converts headings, bold/italic, links, lists, and tables to markdown. Docs with 2+ HEADING_1 sections auto-split into chapter files with a workspace and "Chapters" container. Single-section docs become one file.',
    schema: {
      document: z.any().describe('Raw Google Doc JSON object from the Docs API (must have body.content)'),
      title: z.string().optional().describe('Book/document title. Defaults to the Google Doc title.'),
    },
    handler: async ({ document, title }: { document: any; title?: string }) => {
      const result = importGoogleDoc(document, title);
      broadcastDocumentsChanged();
      broadcastWorkspacesChanged();
      const lines = result.files.map((f: any, i: number) =>
        `  ${i + 1}. ${f.filename} (${f.wordCount.toLocaleString()} words)`
      );
      let text = `Imported "${result.title}" — ${result.files.length} file(s), mode: ${result.mode}`;
      if (result.workspaceFilename) text += `\nWorkspace manifest: ${result.workspaceFilename}`;
      text += `\n\n${lines.join('\n')}`;
      return { content: [{ type: 'text', text }] };
    },
  },
  {
    name: 'insert_image',
    description: 'Generate an image via Gemini and optionally insert it inline or set it as article cover. Three modes: (1) docId + afterNodeId → generate + insert inline with pending decoration. (2) set_cover: true → generate + set as article cover. (3) Neither → generate to disk only, returns path. Uses local GEMINI_API_KEY if set, otherwise falls back to publish platform API.',
    schema: {
      prompt: z.string().max(1000).describe('Gemini image generation prompt (max 1000 chars).'),
      docId: z.string().optional().describe('Target document by docId (8-char hex). Required for inline insert.'),
      afterNodeId: z.string().optional().describe('Insert after this node ID, or "end" to append. Required for inline insert.'),
      aspect_ratio: z.string().optional().describe('Aspect ratio (default "16:9"). Supported: 1:1, 9:16, 16:9, 4:3, 3:4.'),
      alt: z.string().optional().describe('Alt text for the image (defaults to prompt).'),
      set_cover: z.boolean().optional().describe('If true, set the generated image as the article cover (articleContext.coverImage in metadata).'),
    },
    handler: async ({ prompt, docId, afterNodeId, aspect_ratio, alt, set_cover }: { prompt: string; docId?: string; afterNodeId?: string; aspect_ratio?: string; alt?: string; set_cover?: boolean }) => {
      const inlineMode = docId && afterNodeId;
      const filename = inlineMode ? resolveDocId(docId) : undefined;
      const targetIsNonActive = filename && filename !== getActiveFilename();

      // Capture context before async work (for set_cover)
      const preAwaitFilePath = getFilePath();

      // Phase 1: Insert imageLoading placeholder immediately (inline + active doc only)
      const loadingNodeId = generateNodeId();
      if (inlineMode && !targetIsNonActive) {
        const loadingChange: NodeChange = {
          operation: 'insert' as const,
          afterNodeId,
          content: [{ type: 'imageLoading', attrs: { id: loadingNodeId } }],
        };
        applyChanges([loadingChange]);
      }

      try {
        let imgFilename: string;
        const apiKey = process.env.GEMINI_API_KEY;

        if (apiKey) {
          // Generate image via local Gemini
          const { GoogleGenAI } = await import('@google/genai');
          const ai = new GoogleGenAI({ apiKey });

          const response = await ai.models.generateContent({
            model: 'gemini-3.1-flash-image-preview',
            contents: `Generate a ${aspect_ratio || '16:9'} aspect ratio image: ${prompt}`,
            config: {
              responseModalities: ['IMAGE'],
            },
          });

          const parts = response.candidates?.[0]?.content?.parts;
          const imagePart = parts?.find((p: any) => p.inlineData);
          if (!imagePart?.inlineData?.data) {
            if (inlineMode && !targetIsNonActive) {
              applyChanges([{ operation: 'delete' as const, nodeId: loadingNodeId }]);
            }
            return { content: [{ type: 'text', text: 'Error: Gemini returned no image data.' }] };
          }

          ensureDataDir();
          const imagesDir = join(getDataDir(), '_images');
          if (!existsSync(imagesDir)) mkdirSync(imagesDir, { recursive: true });

          imgFilename = `${randomUUID().slice(0, 8)}.png`;
          writeFileSync(join(imagesDir, imgFilename), Buffer.from(imagePart.inlineData.data, 'base64'));
        } else {
          // Fallback: generate via publish platform API
          const { platformFetch, isAuthenticated } = await import('./connections.js');
          if (!isAuthenticated()) {
            if (inlineMode && !targetIsNonActive) {
              try { applyChanges([{ operation: 'delete' as const, nodeId: loadingNodeId }]); } catch {}
            }
            return { content: [{ type: 'text', text: 'Error: No GEMINI_API_KEY and publish platform not configured. Set GEMINI_API_KEY or log in to the publish plugin.' }] };
          }

          // BYO image key (image-gen plugin config) → worker uses the user's own key, uncapped.
          // Blank → shared-key allotment applies. Key is never logged or echoed.
          const userImageKey = readConfig().plugins?.['@openwriter/plugin-image-gen']?.config?.['imageApiKey'] || '';
          const res = await platformFetch('/images/generate', {
            method: 'POST',
            body: JSON.stringify({ prompt, aspect_ratio: aspect_ratio || '16:9' }),
            ...(userImageKey ? { headers: { 'X-Image-Key': userImageKey } } : {}),
          });

          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
            if (inlineMode && !targetIsNonActive) {
              try { applyChanges([{ operation: 'delete' as const, nodeId: loadingNodeId }]); } catch {}
            }
            return { content: [{ type: 'text', text: `Error: ${(err as any).error || 'Platform generation failed'}` }] };
          }

          const data = await res.json() as { url: string };
          const imageRes = await fetch(data.url);
          const imageBuffer = Buffer.from(await imageRes.arrayBuffer());

          ensureDataDir();
          const imagesDir = join(getDataDir(), '_images');
          if (!existsSync(imagesDir)) mkdirSync(imagesDir, { recursive: true });

          imgFilename = `${randomUUID().slice(0, 8)}.png`;
          writeFileSync(join(imagesDir, imgFilename), imageBuffer);
        }

        const src = `/_images/${imgFilename}`;

        // Mode 1: Inline insert
        if (inlineMode) {
          const imageNode = { type: 'image', attrs: { src, alt: alt || prompt } };
          if (targetIsNonActive) {
            const change: NodeChange = { operation: 'insert' as const, afterNodeId, content: [imageNode] };
            const { lastNodeId } = applyChangesToFile(filename!, [change]);
            broadcastPendingDocsChanged();
            return { content: [{ type: 'text', text: JSON.stringify({ success: true, src, ...(lastNodeId ? { lastNodeId } : {}) }) }] };
          }
          // Hard-replace: mutate server doc directly, bypass applyChanges.
          // During async generation (5-10s) the agent lock expires and browser doc-updates
          // can change the imageLoading node's ID. Find it by type, not stale ID.
          // Then broadcast document-switched so the browser rebuilds from server truth.
          const doc = getDocument();
          const imgId = generateNodeId();
          const pendingImage = { ...imageNode, attrs: { ...imageNode.attrs, id: imgId, pendingStatus: 'insert' } };
          const idx = doc.content?.findIndex((n: any) => n.type === 'imageLoading') ?? -1;
          if (idx >= 0) {
            doc.content.splice(idx, 1, pendingImage);
          } else {
            doc.content.push(pendingImage);
          }
          updateDocument(doc);
          save('agent');
          setAgentLockActive();
          broadcastDocumentSwitched(doc, getTitle(), getActiveFilename(), getMetadata());
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, src, lastNodeId: imgId }) }] };
        }

        // Mode 2: Set as article cover
        if (set_cover) {
          const docChanged = getFilePath() !== preAwaitFilePath;
          if (docChanged) {
            return { content: [{ type: 'text', text: JSON.stringify({ success: true, src, coverSet: false, warning: 'Active document changed during generation — cover not set.' }) }] };
          }
          const liveMeta = getMetadata();
          const articleContext = (liveMeta.articleContext as Record<string, any>) || {};
          let existing: string[] = Array.isArray(articleContext.coverImages) ? [...articleContext.coverImages] : [];
          if (existing.length === 0 && articleContext.coverImage) {
            existing = [articleContext.coverImage];
          }
          existing.push(src);
          articleContext.coverImage = src;
          articleContext.coverImages = existing;
          setMetadata({ articleContext });
          save('agent');
          broadcastMetadataChanged(getMetadata());
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, src, coverSet: true }) }] };
        }

        // Mode 3: Generate to disk only
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, src }) }] };
      } catch (err: any) {
        if (inlineMode && !targetIsNonActive) {
          try { applyChanges([{ operation: 'delete' as const, nodeId: loadingNodeId }]); } catch {}
        }
        const msg = err.message || 'Image generation failed.';
        const friendly = /Unexpected token.*<!DOCTYPE/i.test(msg)
          ? 'Image generation failed — your Gemini API key may be invalid or expired. Check your GEMINI_API_KEY.'
          : msg;
        return { content: [{ type: 'text', text: `Error: ${friendly}` }] };
      }
    },
  },
  {
    name: 'list_versions',
    description: 'List version history for a document. Returns timestamps, word counts, and sizes. Use to find a timestamp for restore_version.',
    schema: {
      docId: z.string().describe('Target document by docId (8-char hex from list_documents).'),
    },
    handler: async ({ docId }: { docId: string }) => {
      const target = resolveDocTarget(docId);
      const versions = listVersions(target.docId);
      if (versions.length === 0) return { content: [{ type: 'text', text: 'No versions found for this document.' }] };
      const lines = versions.map((v, i) =>
        `  ${i + 1}. ${v.date}  ts:${v.timestamp}  ${v.wordCount.toLocaleString()} words  ${(v.size / 1024).toFixed(1)}KB`
      );
      return { content: [{ type: 'text', text: `versions (${versions.length}):\n${lines.join('\n')}` }] };
    },
  },
  {
    name: 'create_checkpoint',
    description: 'Force a version snapshot of a document right now. Use before risky operations as a safety net.',
    schema: {
      docId: z.string().describe('Target document by docId (8-char hex from list_documents).'),
    },
    handler: async ({ docId }: { docId: string }) => {
      const target = resolveDocTarget(docId);
      forceSnapshot(target.docId, target.filePath);
      return { content: [{ type: 'text', text: `Checkpoint created at ${new Date().toISOString()}` }] };
    },
  },
  {
    name: 'restore_version',
    description: 'Restore a document to a previous version by timestamp. Automatically creates a safety checkpoint of the current state first. Get timestamps from list_versions.',
    schema: {
      docId: z.string().describe('Target document by docId (8-char hex from list_documents).'),
      timestamp: z.number().describe('Version timestamp to restore (from list_versions)'),
    },
    handler: async ({ docId, timestamp }: { docId: string; timestamp: number }) => {
      const target = resolveDocTarget(docId);

      // Safety checkpoint = the current canonical state. Under the layered
      // model, disk is already canonical (pending lives in the sidecar
      // overlay, not in the .md), so forceSnapshot of the current file is
      // a clean recovery point. The canonical-only-clone special case is
      // no longer needed.
      // adr: adr/pending-overlay-model.md
      try { forceSnapshot(target.docId, target.filePath); } catch { /* best effort */ }

      // Read the target snapshot's content
      const rawSnapshot = getVersionContent(target.docId, timestamp);
      if (!rawSnapshot) return { content: [{ type: 'text', text: `Error: Version ${timestamp} not found.` }] };

      // Restore prose without rolling back current identity, variant placement,
      // or the user's review preference. Older snapshots may predate nesting.
      // adr: adr/pending-overlay-model.md
      const snapshotMarkdown = applyCurrentDocumentMetadata(rawSnapshot, { ...target.metadata, docId: target.docId });

      // Write the snapshot directly to disk — this becomes the new canonical.
      // The pending overlay sidecar is unchanged; on reload, the matcher
      // re-pairs nodeIds and pending decorations re-attach where possible.
      // Pending entries whose anchors disappeared become orphan-inserts.
      atomicWriteFileSync(target.filePath, snapshotMarkdown);

      if (target.isActive) {
        // Unified reload pathway — same code path as external-write reload
        // and explicit reload_from_disk. Re-reads canonical + applies
        // sidecar overlay + classifies orphans/stale-baseline.
        const reloaded = reloadActiveDocFromDisk();
        if (!reloaded) return { content: [{ type: 'text', text: `Error: Failed to reload after restore.` }] };
        broadcastDocumentSwitched(reloaded.document, reloaded.title, reloaded.filename);
        broadcastPendingDocsChanged();
        const summary = reloaded.orphans.length > 0 || reloaded.staleBaseline.length > 0
          ? ` (${reloaded.orphans.length} orphan, ${reloaded.staleBaseline.length} stale-baseline pending)` : '';
        return { content: [{ type: 'text', text: `Restored version from ${new Date(timestamp).toISOString()}${summary}` }] };
      } else {
        invalidateDocCache(target.filePath);
        removePendingCacheEntry(target.filename);
        broadcastDocumentsChanged();
        broadcastPendingDocsChanged();
        return { content: [{ type: 'text', text: `Restored version from ${new Date(timestamp).toISOString()}` }] };
      }
    },
  },
  {
    name: 'reload_from_disk',
    description: 'Re-read a document from its file on disk. Use when the file was modified externally and the editor needs to pick up changes. Does NOT rescan the full document list.',
    schema: {
      docId: z.string().describe('Target document by docId (8-char hex from list_documents).'),
    },
    handler: async ({ docId }: { docId: string }) => {
      const target = resolveDocTarget(docId);
      if (!existsSync(target.filePath)) return { content: [{ type: 'text', text: `Error: File not found: ${target.filePath}` }] };

      if (target.isActive) {
        // Unified reload pathway — same as the fs.watch handler and
        // restore_version. Re-parses canonical + re-applies the sidecar
        // overlay (preserves pending changes by nodeId) + classifies any
        // orphans / stale-baseline entries + restamps loadedMtime.
        // adr: adr/pending-overlay-model.md · adr: adr/active-doc-watcher.md
        const reloaded = reloadActiveDocFromDisk();
        if (!reloaded) return { content: [{ type: 'text', text: `Error: Failed to reload from disk.` }] };
        broadcastDocumentSwitched(reloaded.document, reloaded.title, reloaded.filename);
        broadcastPendingDocsChanged();
        const summary = reloaded.orphans.length > 0 || reloaded.staleBaseline.length > 0
          ? ` (${reloaded.orphans.length} orphan, ${reloaded.staleBaseline.length} stale-baseline pending)` : '';
        return { content: [{ type: 'text', text: `Reloaded "${reloaded.title}" from disk${summary}` }] };
      } else {
        // Non-active: just invalidate cache so next access re-reads from disk
        invalidateDocCache(target.filePath);
        return { content: [{ type: 'text', text: `Cache invalidated for "${target.title}" — next access will re-read from disk` }] };
      }
    },
  },
  {
    name: 'get_comments',
    description: 'Get inline reader comments left by the user. Users select text in the editor, right-click → Comment, and leave a note for the agent. Returns comments grouped by document with text, note, nodeId, and a relative age. Default scope is "workspace" when docId is provided — comments for every doc in the same project. Pass scope:"document" to narrow to one doc, or scope:"all" to span every document on disk. Call resolve_comments after addressing each comment.',
    schema: {
      docId: z.string().optional().describe('Target document by docId (8-char hex). When provided, default scope is "workspace".'),
      scope: z.enum(['workspace', 'document', 'all']).optional().describe('Filter scope. Default: "workspace" when docId is given, otherwise "all".'),
    },
    handler: async ({ docId, scope }: { docId?: string; scope?: CommentScope }) => {
      const filename = docId ? resolveDocId(docId) : undefined;
      const resolved = gatherComments(filename, scope);
      return { content: [{ type: 'text', text: formatCommentsOutput(resolved) }] };
    },
  },
  {
    name: 'resolve_comments',
    description: 'Remove comments after addressing the user\'s feedback. Pass the comment IDs from get_comments. Decorations clear in the browser immediately.',
    schema: {
      comment_ids: z.array(z.string()).describe('Array of comment IDs to resolve'),
    },
    handler: async ({ comment_ids }: { comment_ids: string[] }) => {
      const resolved = resolveComments(comment_ids);
      const activeFile = getActiveFilename();
      broadcastCommentsChanged(activeFile);
      return {
        content: [{
          type: 'text',
          text: resolved.length > 0
            ? `Resolved ${resolved.length} comment${resolved.length !== 1 ? 's' : ''}: ${resolved.join(', ')}`
            : 'No matching comments found.',
        }],
      };
    },
  },
  {
    name: 'get_agent_marks',
    description: 'DEPRECATED — renamed to get_comments. Use get_comments instead. This alias may be removed in a future release.',
    schema: {
      docId: z.string().optional().describe('Target document by docId (8-char hex). Omit to get comments across all documents.'),
    },
    handler: async ({ docId }: { docId?: string }) => {
      const filename = docId ? resolveDocId(docId) : undefined;
      const resolved = gatherComments(filename, undefined);
      return { content: [{ type: 'text', text: formatCommentsOutput(resolved) }] };
    },
  },
  {
    name: 'resolve_agent_marks',
    description: 'DEPRECATED — renamed to resolve_comments. Use resolve_comments instead. This alias may be removed in a future release.',
    schema: {
      mark_ids: z.array(z.string()).describe('Array of comment IDs to resolve'),
    },
    handler: async ({ mark_ids }: { mark_ids: string[] }) => {
      const resolved = resolveComments(mark_ids);
      const activeFile = getActiveFilename();
      broadcastCommentsChanged(activeFile);
      return {
        content: [{
          type: 'text',
          text: resolved.length > 0
            ? `Resolved ${resolved.length} comment${resolved.length !== 1 ? 's' : ''}: ${resolved.join(', ')}`
            : 'No matching comments found.',
        }],
      };
    },
  },

  // ---- Task management ----
  {
    name: 'list_tasks',
    description: 'List all tasks for the current profile.',
    schema: {},
    handler: async () => {
      const tasks = readTasks();
      if (tasks.length === 0) return { content: [{ type: 'text', text: 'No tasks.' }] };
      const lines = tasks.map((t) => `[${t.completed ? 'x' : ' '}] ${t.text} (id:${t.id})`);
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  },
  {
    name: 'add_task',
    description: 'Add a new task to the checklist.',
    schema: {
      text: z.string().describe('The task description.'),
    },
    handler: async ({ text }: { text: string }) => {
      const task = addTask(text);
      return { content: [{ type: 'text', text: `Added task: ${task.text} (id:${task.id})` }] };
    },
  },
  {
    name: 'update_task',
    description: 'Update a task (text or completion status).',
    schema: {
      id: z.string().describe('Task ID to update.'),
      text: z.string().optional().describe('New task text.'),
      completed: z.boolean().optional().describe('Mark completed (true) or incomplete (false).'),
    },
    handler: async ({ id, text, completed }: { id: string; text?: string; completed?: boolean }) => {
      const task = updateTask(id, { text, completed });
      if (!task) return { content: [{ type: 'text', text: `Task ${id} not found.` }] };
      return { content: [{ type: 'text', text: `Updated: [${task.completed ? 'x' : ' '}] ${task.text}` }] };
    },
  },
  {
    name: 'remove_task',
    description: 'Remove a task from the checklist.',
    schema: {
      id: z.string().describe('Task ID to remove.'),
    },
    handler: async ({ id }: { id: string }) => {
      const ok = removeTask(id);
      return { content: [{ type: 'text', text: ok ? `Removed task ${id}.` : `Task ${id} not found.` }] };
    },
  },
  {
    name: 'link_to',
    description: 'Declare a structural doc-to-doc connection. Writes target_doc_id into the source doc\'s `references:` frontmatter array. Body markdown is NEVER mutated — this is metadata, not prose. Idempotent: calling twice with the same source/target is a no-op. The inbound list on the target is computed live from the inverse of every doc\'s references — no stored derived field. v0.20.0 breaking change: dropped `text`, `target_node_id`, and `quote` parameters; connections are structural, not anchored to prose. Legacy prose `doc:` links continue to render and auto-populate `references` on save (backward compat).',
    schema: {
      source_doc_id: z.string().describe('Source document docId (8-char hex from list_documents). The doc declaring the connection.'),
      target_doc_id: z.string().describe('Target document docId (8-char hex from list_documents or search_docs). The doc the connection points AT.'),
    },
    handler: async ({ source_doc_id, target_doc_id }: { source_doc_id: string; target_doc_id: string }) => {
      const sourceFilename = resolveDocId(source_doc_id);
      if (!sourceFilename) {
        return { content: [{ type: 'text', text: `source_doc_id "${source_doc_id}" not found. Use list_documents to find the right docId.` }] };
      }
      const targetFilename = resolveDocId(target_doc_id);
      if (!targetFilename) {
        return { content: [{ type: 'text', text: `target_doc_id "${target_doc_id}" not found. Use list_documents or search_docs to find the right docId.` }] };
      }
      if (source_doc_id === target_doc_id) {
        return { content: [{ type: 'text', text: `Cannot link a document to itself (source_doc_id and target_doc_id are both "${source_doc_id}").` }] };
      }

      // Load source's current references (active doc → in-memory; otherwise → disk).
      const sourceIsActive = sourceFilename === getActiveFilename();
      let currentReferences: string[];
      if (sourceIsActive) {
        const meta = getMetadata();
        currentReferences = Array.isArray(meta?.references) ? [...meta.references] : [];
      } else {
        const fm = readFrontmatter(sourceFilename);
        currentReferences = Array.isArray(fm?.data?.references) ? [...fm!.data.references] : [];
      }

      // Idempotent: target already declared → no-op.
      if (currentReferences.includes(target_doc_id)) {
        return { content: [{ type: 'text', text: JSON.stringify({
          success: true,
          sourceDocId: source_doc_id,
          targetDocId: target_doc_id,
          alreadyReferenced: true,
          references: currentReferences,
        })}] };
      }

      // Append + dedup via Set round-trip.
      const newReferences = Array.from(new Set([...currentReferences, target_doc_id]));

      if (sourceIsActive) {
        // Active doc: mutate state.metadata and let save() persist the frontmatter.
        // save()'s writeToDisk path invalidates the backlinks cache.
        setMetadata({ references: newReferences });
        save('agent');
        broadcastMetadataChanged(getMetadata());
      } else {
        // Non-active doc: write frontmatter directly, preserving body verbatim.
        const fm = readFrontmatter(sourceFilename);
        if (!fm) {
          return { content: [{ type: 'text', text: `Failed to read source doc "${source_doc_id}" frontmatter.` }] };
        }
        const merged = { ...fm.data, references: newReferences };
        writeFrontmatter(sourceFilename, merged);
        invalidateDocCache(resolveDocPath(sourceFilename));
        invalidateBacklinksCache();
      }

      // Right-rail Activity: one entry per new link. Wrapped in try/catch
      // because resolveDocTarget can throw on the rare race where one of
      // the docs was deleted between resolveDocId and now — the link itself
      // landed successfully, the activity entry is the only thing skipped.
      // adr: adr/right-rail.md
      try {
        const sourceTitle = resolveDocTarget(source_doc_id).title || sourceFilename;
        const targetTitle = resolveDocTarget(target_doc_id).title || targetFilename;
        broadcastActivityEvent({
          kind: 'backlinks-added',
          headline: `Linked ${sourceTitle} → ${targetTitle}`,
          docId: source_doc_id,
          filename: sourceFilename,
        });
      } catch { /* activity is best-effort */ }

      return { content: [{ type: 'text', text: JSON.stringify({
        success: true,
        sourceDocId: source_doc_id,
        targetDocId: target_doc_id,
        references: newReferences,
      })}] };
    },
  },
  {
    name: 'get_doc_link',
    description: 'Return a clickable deep-link URL for a doc (and optionally a specific paragraph). Use this whenever you cite a docId in a response — emit the link as `[open](url)` so the user can click straight to the doc instead of manually navigating. URL pattern: `http://localhost:<port>/d/{docId}` for doc-level, plus `#node={nodeId}` for paragraph-level. The server stitches the URL with the live port, so the agent never has to guess the hostname or port.',
    schema: {
      docId: z.string().describe('Target document docId (8-char hex from list_documents / read_pad).'),
      nodeId: z.string().optional().describe('Optional 8-char hex nodeId for paragraph-level anchor (visible in `read_pad`\'s tagged-line output). When set, opening the link scrolls the editor to that block and briefly highlights it.'),
    },
    handler: async ({ docId, nodeId }: { docId: string; nodeId?: string }) => {
      if (!/^[a-f0-9]{8}$/.test(docId)) {
        return { content: [{ type: 'text', text: `docId "${docId}" is not a valid 8-char hex. Use list_documents to find the right docId.` }] };
      }
      const filename = resolveDocId(docId);
      if (!filename) {
        return { content: [{ type: 'text', text: `docId "${docId}" not found. Use list_documents to find the right docId.` }] };
      }
      if (nodeId !== undefined && !/^[a-f0-9]{8}$/.test(nodeId)) {
        return { content: [{ type: 'text', text: `nodeId "${nodeId}" is not a valid 8-char hex. Use read_pad to see paragraph nodeIds.` }] };
      }
      const { getBaseUrl } = await import('./index.js');
      const base = getBaseUrl();
      const url = nodeId ? `${base}/d/${docId}#node=${nodeId}` : `${base}/d/${docId}`;
      return { content: [{ type: 'text', text: JSON.stringify({ url, docId, nodeId: nodeId ?? null }) }] };
    },
  },
  {
    name: 'search_docs',
    description: 'Full-text search. Default (no docId): ranked candidates across every workspace doc, returning docId + title + match type + snippet. Scoped (docId set): search inside one doc and return matching NODES with nodeId + type + snippet — the content-to-node bridge that lets the agent jump from "I want the beat about X" to a known nodeId without ever reading the full doc. Pairs with peek_doc for the actual node read. Use the workspace search before link_to. Use the doc-scoped search before peek_doc when researching inside a long doc.',
    schema: {
      query: z.string().describe('Search query (case-insensitive substring match).'),
      docId: z.string().optional().describe('When set, scope the search to one doc and return matching nodes (with nodeId) instead of doc snippets. The content-orientation entry point for in-doc research.'),
      limit: z.number().optional().describe('Max results to return (default 10, max 50).'),
    },
    handler: async ({ query, docId, limit = 10 }: { query: string; docId?: string; limit?: number }) => {
      const cap = Math.min(Math.max(limit, 1), 50);

      // Doc-scoped path: walk the doc's blocks and return matching nodes.
      if (docId) {
        const target = resolveDocTarget(docId);
        const matches = searchInDoc(target.document, query, cap);
        return { content: [{ type: 'text', text: JSON.stringify({ docId, total: matches.length, matches }) }] };
      }

      // Workspace-wide path: existing behavior.
      const raw = searchDocuments(query);
      // Enrich with docId + enrichment fields from frontmatter so the agent
      // can rank/pick candidates without a follow-up body read.
      const enriched = raw.slice(0, cap).map((r) => {
        let resolvedDocId: string | null = null;
        let logline: string | undefined;
        let status: string | undefined;
        let tags: string[] | undefined;
        try {
          const filePath = resolveDocPath(r.filename);
          const fileRaw = readFileSync(filePath, 'utf-8');
          const fm = matter(fileRaw);
          resolvedDocId = (fm.data?.docId as string) || null;
          // v0.19.0 three-field schema: logline (LLM), status (agent), tags.
          if (typeof fm.data?.logline === 'string') logline = fm.data.logline;
          if (typeof fm.data?.status === 'string') status = fm.data.status;
          if (Array.isArray(fm.data?.tags) && fm.data.tags.length > 0) tags = fm.data.tags;
        } catch { /* fields stay undefined */ }
        return {
          docId: resolvedDocId,
          title: r.title,
          filename: r.filename,
          matchType: r.matchType,
          snippet: r.snippet,
          matchedTag: r.matchedTag,
          ...(logline ? { logline } : {}),
          ...(status ? { status } : {}),
          ...(tags ? { tags } : {}),
        };
      });
      return { content: [{ type: 'text', text: JSON.stringify(enriched) }] };
    },
  },
  {
    name: 'get_graph',
    description: 'Return forward + inbound connections for a doc — the crawl primitive for cross-doc context retrieval. Forward connections read from the doc\'s `references:` frontmatter (structural data, v0.20). Inbound computed live by scanning every doc\'s references for entries pointing at this one (no stored derived field). Optional depth walks neighbors recursively (cap 3). v0.20.0 breaking change: edges are doc-to-doc; per-paragraph granularity (from_node/to_node/anchor text) was dropped — that was an artifact of the prose-link model.',
    schema: {
      docId: z.string().describe('Center docId for the graph walk (8-char hex).'),
      depth: z.number().optional().describe('Hops to walk outward (default 1, max 3). depth=1 returns just the center\'s links; depth=2 also includes neighbors\' links.'),
    },
    handler: async ({ docId, depth = 1 }: { docId: string; depth?: number }) => {
      const maxDepth = Math.min(Math.max(depth, 1), 3);
      const seen = new Set<string>();
      const nodes: any[] = [];

      function visit(id: string, hopsLeft: number): void {
        if (seen.has(id) || hopsLeft < 0) return;
        seen.add(id);
        let target;
        try { target = resolveDocTarget(id); } catch { return; }
        const forward: string[] = Array.isArray(target.metadata.references) ? target.metadata.references : [];
        const backlinks = computeBacklinksFor(id);
        nodes.push({
          docId: id,
          title: target.title,
          forward: forward.map((to_doc) => ({ to_doc })),
          backlinks: backlinks.map((b) => ({ from_doc: b.from_doc })),
        });
        if (hopsLeft > 0) {
          const neighbors = new Set<string>();
          for (const to_doc of forward) neighbors.add(to_doc);
          for (const b of backlinks) neighbors.add(b.from_doc);
          for (const n of neighbors) {
            if (!seen.has(n)) visit(n, hopsLeft - 1);
          }
        }
      }

      visit(docId, maxDepth - 1);
      return { content: [{ type: 'text', text: JSON.stringify(nodes) }] };
    },
  },
];

/** Live MCP server instance — used to register plugin tools dynamically. */
let mcpServerInstance: McpServer | null = null;

/** Convert a JSON Schema properties object to a Zod shape for MCP tool registration. */
/**
 * Some MCP clients (notably Claude Code's tool-call serialization for
 * nested object/array parameters) send JSON-encoded strings instead of
 * the actual structured value. Wrap object/array schemas with a
 * preprocess step that opportunistically parses string input as JSON
 * before validation.
 */
function jsonCoerce<T extends z.ZodTypeAny>(inner: T): z.ZodEffects<z.ZodTypeAny, z.input<T>, unknown> {
  return z.preprocess((val) => {
    if (typeof val !== 'string') return val;
    const trimmed = val.trim();
    if (!trimmed) return val;
    if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return val;
    try { return JSON.parse(trimmed); } catch { return val; }
  }, inner);
}

function jsonSchemaToZodShape(inputSchema: Record<string, unknown>): Record<string, z.ZodTypeAny> {
  const properties = (inputSchema.properties || {}) as Record<string, {
    type?: string;
    description?: string;
    items?: { type?: string };
  }>;
  const required = new Set((inputSchema.required || []) as string[]);
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [key, prop] of Object.entries(properties)) {
    let field: z.ZodTypeAny;
    switch (prop.type) {
      case 'number': field = z.number(); break;
      case 'boolean': field = z.boolean(); break;
      case 'object':
        // Pass-through any record-like object. Inner key validation is
        // the handler's job — keep this loose so plugins can ship typed
        // shapes through MCP without per-key zod schemas.
        // Wrap in jsonCoerce so JSON-string-encoded objects are auto-parsed.
        field = jsonCoerce(z.record(z.string(), z.any()));
        break;
      case 'array':
        // Use items.type for inner validation when provided
        switch (prop.items?.type) {
          case 'string': field = jsonCoerce(z.array(z.string())); break;
          case 'number': field = jsonCoerce(z.array(z.number())); break;
          case 'boolean': field = jsonCoerce(z.array(z.boolean())); break;
          default: field = jsonCoerce(z.array(z.any())); break;
        }
        break;
      default: field = z.string(); break;
    }
    if (prop.description) field = field.describe(prop.description);
    if (!required.has(key)) field = field.optional();
    shape[key] = field;
  }
  return shape;
}

/** Register MCP tools from plugins. Dynamically adds to the live MCP session. */
export function registerPluginTools(tools: import('./plugin-types.js').PluginMcpTool[]): void {
  for (const tool of tools) {
    // Skip if already in TOOL_REGISTRY (e.g. called twice due to a bug)
    if (TOOL_REGISTRY.some((t) => t.name === tool.name)) {
      console.warn(`[PluginManager] registerPluginTools: skipping duplicate tool "${tool.name}"`);
      continue;
    }
    const zodShape = jsonSchemaToZodShape(tool.inputSchema);
    const toolDef: ToolDef = {
      name: tool.name,
      description: tool.description,
      schema: zodShape,
      handler: async (args: any) => {
        const result = await tool.handler(args);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      },
    };
    TOOL_REGISTRY.push(toolDef);

    // Register on live MCP server so existing sessions see it immediately.
    // Guard against "already registered" throws — can happen when two plugins
    // ship a tool with the same name (e.g. an old stale dist vs a new dist).
    if (mcpServerInstance) {
      const registered = (mcpServerInstance as any)._registeredTools;
      if (registered && registered[tool.name]) {
        console.warn(`[PluginManager] registerPluginTools: skipping MCP-duplicate tool "${tool.name}"`);
      } else {
        mcpServerInstance.tool(tool.name, tool.description, zodShape, toolDef.handler);
      }
    }
  }

  // Notify connected clients that the tool list changed
  if (mcpServerInstance) {
    mcpServerInstance.server.sendToolListChanged().catch(() => {});
  }
}

/** Remove MCP tools by name. Notifies connected clients of the change. */
export function removePluginTools(names: string[]): void {
  const nameSet = new Set(names);
  for (let i = TOOL_REGISTRY.length - 1; i >= 0; i--) {
    if (nameSet.has(TOOL_REGISTRY[i].name)) {
      TOOL_REGISTRY.splice(i, 1);
    }
  }

  // Also remove from the live MCP server's internal registry so re-enable
  // doesn't hit "Tool already registered". The SDK doesn't expose a public
  // unregister API — use the registered tool handle's .remove() if available,
  // otherwise fall back to deleting from _registeredTools directly.
  if (mcpServerInstance) {
    const registered = (mcpServerInstance as any)._registeredTools as Record<string, { remove?: () => void }> | undefined;
    if (registered) {
      for (const name of nameSet) {
        const handle = registered[name];
        if (handle) {
          if (typeof handle.remove === 'function') {
            handle.remove();
          } else {
            delete registered[name];
          }
        }
      }
    }
    mcpServerInstance.server.sendToolListChanged().catch(() => {});
  }
}

export async function startMcpServer(): Promise<void> {
  // Build session-start enrichment notice. Read once at boot — MCP's instructions
  // field is delivered as part of the InitializeResult and becomes part of the
  // agent's system context. Empty string when no enrichment work is pending.
  // See brief 2026-05-18-frontmatter-enrichment-system.
  const enrichmentNotice = buildEnrichmentInstructions();
  const sortNotice = buildSortInstructions();
  // Stack notices in the MCP instructions field. Both notices stand on their
  // own — agents can read and dispatch them independently. Empty when neither
  // system has pending work.
  const combinedNotice = [enrichmentNotice, sortNotice].filter(Boolean).join('\n');

  const server = new McpServer({
    name: 'openwriter',
    version: '0.2.0',
  }, combinedNotice ? { instructions: combinedNotice } : undefined);

  // Wrap each tool handler in withRequestId so every event logged during
  // the tool's execution inherits the same request ID. Trace one MCP call
  // through the system with: jq 'select(.requestId=="mcp-toolname-xxxxxx")'.
  // adr: adr/logging-system.md
  for (const tool of TOOL_REGISTRY) {
    const wrappedHandler = async (args: any) => {
      const reqId = generateRequestId(`mcp-${tool.name}`);
      return await withRequestId(reqId, async () => {
        logger.debug('mcp', 'tool-call', tool.name, { tool: tool.name });
        try {
          const result = await tool.handler(args);
          return result;
        } catch (err: any) {
          logger.error('mcp', 'tool-error', `${tool.name}: ${err.message}`, { tool: tool.name }, err);
          throw err;
        }
      });
    };
    server.tool(tool.name, tool.description, tool.schema, wrappedHandler);
  }

  mcpServerInstance = server;

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
