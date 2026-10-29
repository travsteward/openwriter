/**
 * Each tool's title and its read-only / destructive marks, as MCP clients show them and as the
 * Claude and ChatGPT directories require. Worked out from the tool's name, so a new tool is
 * labelled without a second edit:
 *
 * - Read-only: names that only look (read_, get_, list_, search_ ...).
 * - Destructive: names that delete, send, publish or post, or cannot be taken back; and every
 *   plugin tool that is not read-only, since those change a live site, its readers or money.
 * - Everything else is additive: OpenWriter's edits arrive as changes the writer accepts or rejects.
 */

export interface ToolLabels {
  title: string;
  annotations: { title: string; readOnlyHint: boolean; destructiveHint: boolean };
}

const READ_PREFIXES = [
  'read_', 'get_', 'list_', 'peek_', 'outline_', 'browse_', 'search_', 'check_', 'preview_', 'find_', 'inspect_',
];
const READ_NAMES = new Set(['crawl']);
const DESTRUCTIVE_PREFIXES = [
  'delete_', 'remove_', 'restore_', 'reload_', 'resolve_', 'publish_', 'unpublish_', 'send_', 'resend_', 'email_',
  'post_to_', 'cross_post', 'ban_', 'end_', 'cancel_', 'refund_', 'revoke_', 'prune_', 'transfer_', 'disconnect_',
];

/** Words a title spells differently from the tool name. */
const WORDS: Record<string, string> = {
  pad: 'document', doc: 'document', docs: 'documents', x: 'X', qr: 'QR', gdoc: 'Google Doc', linkedin: 'LinkedIn',
};

export function toolLabels(tool: { name: string; plugin?: string }): ToolLabels {
  const { name } = tool;
  const readOnly = READ_NAMES.has(name) || READ_PREFIXES.some((p) => name.startsWith(p));
  const destructive = !readOnly && (!!tool.plugin || DESTRUCTIVE_PREFIXES.some((p) => name.startsWith(p)));
  const words = name.split('_').map((w) => WORDS[w] ?? w).join(' ');
  const title = words.charAt(0).toUpperCase() + words.slice(1);
  return { title, annotations: { title, readOnlyHint: readOnly, destructiveHint: destructive } };
}
