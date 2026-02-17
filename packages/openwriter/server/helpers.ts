/**
 * Shared constants and utility functions for OpenWriter server.
 * Both state.ts and documents.ts import from here to avoid duplication.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'fs';
import { join, isAbsolute, basename, dirname } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';

export const DATA_DIR = join(homedir(), '.openwriter');
export const VERSIONS_DIR = join(DATA_DIR, '.versions');
export const WORKSPACES_DIR = join(DATA_DIR, '_workspaces');
export const CONFIG_FILE = join(DATA_DIR, 'config.json');
export const TEMP_PREFIX = '_untitled-';

export function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    // One-time migration: rename ~/.superwriter/ → ~/.openwriter/
    const legacyDir = join(homedir(), '.superwriter');
    if (existsSync(legacyDir)) {
      renameSync(legacyDir, DATA_DIR);
    } else {
      mkdirSync(DATA_DIR, { recursive: true });
    }
  }
}

export function ensureWorkspacesDir(): void {
  ensureDataDir();
  if (!existsSync(WORKSPACES_DIR)) mkdirSync(WORKSPACES_DIR, { recursive: true });
}

export function sanitizeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '-').trim() || 'Untitled';
}

export function filePathForTitle(title: string): string {
  return join(DATA_DIR, `${sanitizeFilename(title)}.md`);
}

export function tempFilePath(): string {
  return join(DATA_DIR, `${TEMP_PREFIX}${randomUUID()}.md`);
}

// ---- Path resolution for external documents ----

/** Resolve a filename to a full path. Basenames resolve to DATA_DIR; absolute paths pass through. */
export function resolveDocPath(filename: string): string {
  if (isAbsolute(filename) || /[/\\]/.test(filename)) return filename;
  return join(DATA_DIR, filename);
}

/** Returns true if filename is a full path (not a simple basename in DATA_DIR). */
export function isExternalDoc(filename: string): boolean {
  if (isAbsolute(filename) || /[/\\]/.test(filename)) {
    const resolved = isAbsolute(filename) ? filename : filename;
    return !resolved.startsWith(DATA_DIR);
  }
  return false;
}

/** Extract basename from a path, or return as-is if already a basename. */
export function getDocBasename(filename: string): string {
  return basename(filename);
}

/** Extract parent directory name from a path. Returns empty string for basenames. */
export function getParentDirName(filename: string): string {
  if (!isAbsolute(filename) && !/[/\\]/.test(filename)) return '';
  return basename(dirname(filename));
}

/** Generate an 8-char hex node ID for TipTap block nodes. */
export function generateNodeId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 8);
}

/** Leaf block types: text-containing blocks that get pending decorations. */
export const LEAF_BLOCK_TYPES = new Set(['paragraph', 'heading', 'codeBlock', 'horizontalRule', 'table', 'image']);

// ---- Config persistence (API key, preferences) ----

export interface PluginConfig {
  enabled: boolean;
  config: Record<string, string>;
}

interface OpenWriterConfig {
  avApiKey?: string;
  avBackendUrl?: string;
  gitRemote?: string;
  gitConfigured?: boolean;
  lastSyncTime?: string;
  gitPat?: string;
  repoName?: string;
  plugins?: Record<string, PluginConfig>;
}

export function readConfig(): OpenWriterConfig {
  ensureDataDir();
  if (!existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

export function saveConfig(updates: Partial<OpenWriterConfig>): void {
  ensureDataDir();
  const current = readConfig();
  const merged = { ...current, ...updates };
  writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), 'utf-8');
}
