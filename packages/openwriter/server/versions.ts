/**
 * Document version history for OpenWriter.
 * Automatic file-level snapshots so any document state can be recovered.
 * Storage: ~/.openwriter/.versions/{docId}/{timestamp}.md
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync, statSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { VERSIONS_DIR } from './helpers.js';
import { markdownToTiptap } from './markdown.js';

export interface VersionInfo {
  timestamp: number;
  date: string;
  size: number;
  wordCount: number;
}

// ============================================================================
// DEDUP STATE
// ============================================================================

const lastSnapshot = new Map<string, { time: number; hash: string }>();
const MIN_INTERVAL_MS = 30_000; // 30 seconds between snapshots of same content

function contentHash(markdown: string): string {
  return createHash('sha256').update(markdown).digest('hex').slice(0, 16);
}

// ============================================================================
// DOC ID
// ============================================================================

/**
 * Ensure metadata has a docId. Assigns an 8-char hex ID if missing.
 * Returns the docId (existing or newly assigned).
 */
export function ensureDocId(metadata: Record<string, any>): string {
  if (metadata.docId && typeof metadata.docId === 'string') {
    return metadata.docId;
  }
  const id = createHash('sha256')
    .update(Date.now().toString() + Math.random().toString())
    .digest('hex')
    .slice(0, 8);
  metadata.docId = id;
  return id;
}

// ============================================================================
// SNAPSHOT
// ============================================================================

function docDir(docId: string): string {
  return join(VERSIONS_DIR, docId);
}

function ensureDocDir(docId: string): void {
  const dir = docDir(docId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/**
 * Seed the in-memory dedup map from the latest version on disk.
 * Prevents duplicate snapshot after server restart.
 */
function seedLastSnapshot(docId: string): void {
  if (lastSnapshot.has(docId)) return;
  const dir = docDir(docId);
  if (!existsSync(dir)) return;

  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => parseInt(f.replace('.md', ''), 10))
    .filter((ts) => !isNaN(ts))
    .sort((a, b) => b - a); // newest first

  if (files.length === 0) return;

  const latest = files[0];
  const content = readFileSync(join(dir, `${latest}.md`), 'utf-8');
  lastSnapshot.set(docId, { time: latest, hash: contentHash(content) });
}

/**
 * Snapshot after every writeToDisk() — skips if content unchanged or within throttle window.
 * Called in best-effort mode (caller wraps in try/catch).
 */
export function snapshotIfNeeded(docId: string, filePath: string): void {
  if (!docId || !filePath || !existsSync(filePath)) return;

  seedLastSnapshot(docId);

  const markdown = readFileSync(filePath, 'utf-8');
  const hash = contentHash(markdown);
  const now = Date.now();

  const last = lastSnapshot.get(docId);
  if (last) {
    // Skip if content hasn't changed (regardless of time)
    if (hash === last.hash) return;
    // Skip if within minimum interval even if content changed
    if ((now - last.time) < MIN_INTERVAL_MS) return;
  }

  ensureDocDir(docId);
  writeFileSync(join(docDir(docId), `${now}.md`), markdown, 'utf-8');
  lastSnapshot.set(docId, { time: now, hash });

  pruneVersions(docId);
}

/**
 * Force a snapshot regardless of dedup. Used before restores as a safety net.
 */
export function forceSnapshot(docId: string, filePath: string): void {
  if (!docId || !filePath || !existsSync(filePath)) return;

  const markdown = readFileSync(filePath, 'utf-8');
  const hash = contentHash(markdown);
  const now = Date.now();

  ensureDocDir(docId);
  writeFileSync(join(docDir(docId), `${now}.md`), markdown, 'utf-8');
  lastSnapshot.set(docId, { time: now, hash });
}

// ============================================================================
// LIST / GET
// ============================================================================

/**
 * List all versions for a docId, sorted newest-first.
 */
export function listVersions(docId: string): VersionInfo[] {
  if (!docId) return [];
  const dir = docDir(docId);
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const ts = parseInt(f.replace('.md', ''), 10);
      if (isNaN(ts)) return null;
      const fullPath = join(dir, f);
      try {
        const stat = statSync(fullPath);
        const content = readFileSync(fullPath, 'utf-8');
        const words = content.trim() ? content.trim().split(/\s+/).length : 0;
        return {
          timestamp: ts,
          date: new Date(ts).toISOString(),
          size: stat.size,
          wordCount: words,
        };
      } catch {
        return null;
      }
    })
    .filter((v): v is VersionInfo => v !== null)
    .sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Get raw markdown content of a specific version.
 */
export function getVersionContent(docId: string, ts: number): string | null {
  if (!docId) return null;
  const file = join(docDir(docId), `${ts}.md`);
  if (!existsSync(file)) return null;
  return readFileSync(file, 'utf-8');
}

/**
 * Restore a version. Parses the snapshot markdown into TipTap JSON.
 * Returns the parsed document for the caller to apply.
 */
export function restoreVersion(docId: string, ts: number): {
  document: { type: 'doc'; content: any[] };
  title: string;
  metadata: Record<string, any>;
} | null {
  const markdown = getVersionContent(docId, ts);
  if (!markdown) return null;
  return markdownToTiptap(markdown);
}

// ============================================================================
// PRUNE
// ============================================================================

const MAX_VERSIONS = 50;
const KEEP_ALL_WITHIN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Enforce retention: keep max(MAX_VERSIONS, all from last 7 days).
 */
export function pruneVersions(docId: string): void {
  if (!docId) return;
  const dir = docDir(docId);
  if (!existsSync(dir)) return;

  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => ({
      name: f,
      ts: parseInt(f.replace('.md', ''), 10),
    }))
    .filter((f) => !isNaN(f.ts))
    .sort((a, b) => b.ts - a.ts); // newest first

  if (files.length <= MAX_VERSIONS) return;

  const cutoff = Date.now() - KEEP_ALL_WITHIN_MS;

  // Keep all within 7 days + at most MAX_VERSIONS total
  const toDelete = files.slice(MAX_VERSIONS).filter((f) => f.ts < cutoff);
  for (const f of toDelete) {
    try {
      unlinkSync(join(dir, f.name));
    } catch { /* ignore */ }
  }
}
