import { listDirtyDocs } from './documents.js';

/** One-line footer the high-frequency MCP discovery tools (list_documents,
 *  list_workspaces, get_workspace_structure) append when dirty docs exist.
 *  Constant pressure that doesn't require hook setup. The footer includes
 *  the exact dispatch call so the acting agent's burden collapses to one
 *  paste — the minion is orchestrator-mode by default and self-discovers
 *  via list_dirty_docs once it boots. */
export function enrichmentFooter(): string {
  const count = listDirtyDocs().length;
  if (count === 0) return '';
  return `\n\n⚠ ${count} doc${count === 1 ? '' : 's'} need enrichment. Dispatch:\nAgent(\n  subagent_type: "openwriter-enrichment-minion",\n  description: "Drain stale docs",\n  prompt: "Enrich stale docs.",\n  run_in_background: true\n)`;
}

/** Session-start enrichment notice injected into the MCP server's
 *  `instructions` field at boot. Every MCP client (Claude Code, Cursor, etc.)
 *  delivers this to the agent as part of its system context — no hook setup
 *  needed. Returns empty string when there's no enrichment work to do. */
export function buildEnrichmentInstructions(): string {
  const dirty = listDirtyDocs();
  if (dirty.length === 0) return '';

  // Group by workspace for the notice
  const byWorkspace = new Map<string, number>();
  let orphans = 0;
  for (const d of dirty) {
    if (d.workspaceFile) {
      byWorkspace.set(d.workspaceFile, (byWorkspace.get(d.workspaceFile) || 0) + 1);
    } else {
      orphans++;
    }
  }
  const parts: string[] = [];
  for (const [ws, n] of byWorkspace) parts.push(`${n} in ${ws}`);
  if (orphans > 0) parts.push(`${orphans} unfiled`);

  return [
    '',
    `ENRICHMENT_STATUS: ${dirty.length} doc${dirty.length === 1 ? '' : 's'} need enrichment (${parts.join(', ')}).`,
    'Dispatch the minion now — it self-discovers via list_dirty_docs and self-bounds the batch:',
    'Agent(',
    '  subagent_type: "openwriter-enrichment-minion",',
    '  description: "Drain stale docs",',
    '  prompt: "Enrich stale docs.",',
    '  run_in_background: true',
    ')',
  ].join('\n');
}

