/** Agent-boundary guidance. Internal tool callers do not consume delivery.
 * adr: adr/in-system-guidance.md */
import { resolveDocId, getActiveFilename } from './documents.js';
import { getMetadata, getCachedDocument } from './state.js';
import { resolveDocPath } from './helpers.js';
import { readFrontmatter } from './backlinks.js';
import { deriveContentType } from './content-type-meta.js';
import { guidanceFor } from './doc-guidance.js';
import type { ToolResult } from './mcp.js';
import { bookContexts, bookContextGuidance } from './book-workspaces.js';

/** A document named by the call, or announced by create/open. */
export function appendDocGuidance(session: string, args: unknown, result: ToolResult): ToolResult {
  const first = result?.content?.[0]?.text ?? '';
  if (/^Error/.test(first)) return result;
  const named = (args as { docId?: unknown } | null)?.docId;
  const docId = typeof named === 'string' ? named : /^(?:Created|Opened) .*? \[([0-9a-f]{8})\]/.exec(first)?.[1];
  const options = args as { workspaceFile?: string; filename?: string } | null;
  const workspaceFile = options?.workspaceFile ?? (options?.filename?.endsWith('.json') ? options.filename : undefined);
  if (!docId && !workspaceFile) return result;
  let metadata: Record<string, any> | undefined;
  try {
    if (docId) {
      const filename = resolveDocId(docId);
      metadata = filename === getActiveFilename()
        ? getMetadata()
        : getCachedDocument(resolveDocPath(filename))?.metadata ?? readFrontmatter(filename)?.data;
    }
  } catch { return result; }
  const contexts = bookContexts(docId, workspaceFile);
  const role = contexts.length === 1 ? contexts[0].role : contexts.length ? 'source' : undefined;
  const guidance = metadata || contexts.length
    ? guidanceFor(session, docId ?? workspaceFile!, metadata ? deriveContentType(metadata) : undefined, role, contexts.length === 1 && contexts[0].method === 'guided') : null;
  const book = bookContextGuidance(session, contexts, docId);
  const additions = [guidance, book].filter((text): text is string => !!text).map(text => ({ type: 'text' as const, text }));
  return additions.length ? { ...result, content: [...result.content, ...additions] } : result;
}
