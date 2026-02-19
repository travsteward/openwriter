import type { WorkspaceNode } from './sidebar-types';

export function nodeId(node: WorkspaceNode): string {
  return node.type === 'doc' ? node.file : node.id;
}

export function collectFiles(nodes: WorkspaceNode[], out: Set<string>): void {
  for (const node of nodes) {
    if (node.type === 'doc') out.add(node.file);
    else if (node.type === 'container') collectFiles(node.items, out);
  }
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return d.toLocaleDateString();
}

export function isExternal(filename: string): boolean {
  return /^[A-Z]:[/\\]|^\//.test(filename);
}

export function parentDir(filename: string): string {
  const parts = filename.replace(/\\/g, '/').split('/');
  return parts.length >= 2 ? parts[parts.length - 2] : '';
}

/** Get the date group label for a given ISO date string. */
export function dateGroup(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const docDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  if (docDay.getTime() === today.getTime()) return 'Today';
  if (docDay.getTime() === yesterday.getTime()) return 'Yesterday';
  if (now.getTime() - docDay.getTime() < 604800000) {
    return d.toLocaleDateString(undefined, { weekday: 'long' });
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

