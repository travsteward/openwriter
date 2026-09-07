import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import matter from 'gray-matter';
import { getDataDir, ensureDataDir, resolveDocPath, atomicWriteFileSync, TEMP_PREFIX } from './helpers.js';
import { getFilePath, getDocument, getTitle, invalidateDocCache, setActiveDocument, type PadDocument } from './state.js';
import { markdownToTiptap } from './markdown.js';
import { removeDocFromAllWorkspaces, captureArchivePlacements, restoreArchivePlacements } from './workspaces.js';

export function archiveDocument(filename: string): { switched: boolean; newDoc?: { document: PadDocument; title: string; filename: string } } {
  ensureDataDir();
  const targetPath = resolveDocPath(filename);
  if (!existsSync(targetPath)) {
    throw new Error(`Document not found: ${filename}`);
  }

  const placements = captureArchivePlacements(filename);
  const raw = readFileSync(targetPath, 'utf-8');
  const { data, content } = matter(raw);
  // Repeated archive requests must retain the original filing information.
  // adr: adr/archive-placement.md
  if (!data.archivedAt) data.archivePlacements = placements;
  data.archivedAt = new Date().toISOString();
  atomicWriteFileSync(targetPath, matter.stringify(content, data));

  // Remove from workspaces
  removeDocFromAllWorkspaces(filename);

  // Invalidate cache
  invalidateDocCache(targetPath);

  const isArchivingActive = targetPath === getFilePath();
  if (isArchivingActive) {
    // Switch to most recent remaining doc
    const remaining = readdirSync(getDataDir())
      .filter((f) => f.endsWith('.md') && f !== filename)
      .map((f) => {
        const fullPath = join(getDataDir(), f);
        try {
          const stat = statSync(fullPath);
          const raw = readFileSync(fullPath, 'utf-8');
          const { data } = matter(raw);
          if (data.archivedAt) return null;
          return { name: f, path: fullPath, mtime: stat.mtimeMs };
        } catch { return null; }
      })
      .filter((f): f is { name: string; path: string; mtime: number } => f !== null)
      .sort((a, b) => b.mtime - a.mtime);

    if (remaining.length > 0) {
      const next = remaining[0];
      const raw = readFileSync(next.path, 'utf-8');
      const parsed = markdownToTiptap(raw);
      setActiveDocument(parsed.document, parsed.title, next.path, next.name.startsWith(TEMP_PREFIX), new Date(next.mtime), parsed.metadata, undefined);
      return { switched: true, newDoc: { document: getDocument(), title: getTitle(), filename: next.name } };
    }
  }

  return { switched: false };
}

export function unarchiveDocument(filename: string): { filename: string; title: string; locationWarning?: string } {
  ensureDataDir();
  const targetPath = resolveDocPath(filename);
  if (!existsSync(targetPath)) {
    throw new Error(`Document not found: ${filename}`);
  }

  const raw = readFileSync(targetPath, 'utf-8');
  const { data, content } = matter(raw);
  const title = (data.title as string) || 'Untitled';
  const originalLocation = restoreArchivePlacements(filename, title, Array.isArray(data.archivePlacements) ? data.archivePlacements : []);
  delete data.archivedAt;
  delete data.archivePlacements;
  atomicWriteFileSync(targetPath, matter.stringify(content, data));
  invalidateDocCache(targetPath);

  return { filename, title, ...(!originalLocation ? { locationWarning: 'Restored outside its original folder because that folder or workspace no longer exists.' } : {}) };
}

// ============================================================================
// SEARCH
// ============================================================================
