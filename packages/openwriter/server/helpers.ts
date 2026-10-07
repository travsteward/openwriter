/**
 * Shared constants and utility functions for OpenWriter server.
 * Both state.ts and documents.ts import from here to avoid duplication.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, statSync, copyFileSync, rmSync, realpathSync } from 'fs';
import { join, isAbsolute, basename, dirname, resolve, sep } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';

export const ROOT_DIR = join(homedir(), '.openwriter');
export const TEMP_PREFIX = '_untitled-';

// ---- Profile state ----

let activeProfile = 'Default';

export function getActiveProfile(): string {
  return activeProfile;
}

export function setActiveProfile(name: string): void {
  activeProfile = name;
}

// adr: adr/pinned-profile.md
let profilePinned = false;

/**
 * `--profile <name>`: this process serves only `name`, creating it if needed. The choice is never
 * written to the shared config, so a second OpenWriter (a test profile on another port) can never
 * change which profile the main one opens with.
 */
export function pinProfile(name: string): void {
  if (!listProfiles().includes(name)) createProfile(name);
  activeProfile = name;
  profilePinned = true;
}

export function isProfilePinned(): boolean {
  return profilePinned;
}

// ---- Profile-aware path getters ----

export function getDataDir(): string {
  return join(ROOT_DIR, 'profiles', activeProfile);
}

export function getVersionsDir(): string {
  return join(getDataDir(), '.versions');
}

export function getWorkspacesDir(): string {
  return join(getDataDir(), '_workspaces');
}

export function getConfigFile(): string {
  return join(ROOT_DIR, 'config.json');
}

// ---- Directory bootstrapping ----

export function ensureDataDir(): void {
  // Ensure ROOT_DIR exists (with legacy migration)
  if (!existsSync(ROOT_DIR)) {
    const legacyDir = join(homedir(), '.superwriter');
    if (existsSync(legacyDir)) {
      renameSync(legacyDir, ROOT_DIR);
    } else {
      mkdirSync(ROOT_DIR, { recursive: true });
    }
  }

  // Migrate flat files into profiles/Default/ if needed
  migrateToProfiles();

  // Ensure active profile directory exists
  const dataDir = getDataDir();
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
}

export function ensureWorkspacesDir(): void {
  ensureDataDir();
  const wsDir = getWorkspacesDir();
  if (!existsSync(wsDir)) mkdirSync(wsDir, { recursive: true });
}

export function sanitizeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '-').trim() || 'Untitled';
}

export function filePathForTitle(title: string): string {
  return join(getDataDir(), `${sanitizeFilename(title)}.md`);
}

export function tempFilePath(): string {
  return join(getDataDir(), `${TEMP_PREFIX}${randomUUID()}.md`);
}

// ---- Path resolution for external documents ----

// ---- Path canonicalization (one identity per physical file) ----

/**
 * Branded string: a path that has been put through `canonicalizePath`.
 *
 * Used to type identity slots (`externalDocs` Set, `docCache` Map keys,
 * `state.filePath`, `activeWatcherPath`) so the compiler refuses raw
 * `string` assignment to those slots without going through the canon
 * function. The same physical file always produces the same CanonPath,
 * regardless of how the caller spelled the input.
 *
 * adr: adr/path-canonicalization.md
 */
export type CanonPath = string & { readonly __canon: unique symbol };

/**
 * Produce one canonical representation per physical file. Idempotent:
 * `canonicalizePath(canonicalizePath(p)) === canonicalizePath(p)`.
 *
 * On Windows: resolves separator direction (`/` vs `\`), drive-letter
 * case (`c:` vs `C:`), 8.3 short names, and symlinks — whenever the
 * file exists. `realpathSync.native` is the OS asking itself "what's
 * the real path of this thing?", which is the only authoritative
 * answer.
 *
 * On Unix: resolves symlinks and normalizes relative segments.
 *
 * Falls back to `path.resolve` (absolute path with platform separators)
 * when the file doesn't exist yet. That's a weaker form — it won't
 * catch drive-letter case mismatches on a path to a not-yet-created
 * file — but every openwriter identity boundary hits an existing file,
 * so the fallback is a safety net rather than a primary path.
 *
 * adr: adr/path-canonicalization.md
 */
export function canonicalizePath(p: string): CanonPath {
  if (!p) return p as CanonPath;
  try {
    return realpathSync.native(p) as CanonPath;
  } catch {
    return resolve(p) as CanonPath;
  }
}

/** Resolve a filename to a full path. Basenames resolve to DATA_DIR; absolute paths pass through. */
export function resolveDocPath(filename: string): string {
  const dataDir = getDataDir();
  // External docs use absolute paths as identifiers — pass through
  if (isAbsolute(filename)) return filename;
  // Internal docs must resolve within DATA_DIR — block path traversal
  const resolved = resolve(dataDir, filename);
  const dataDirResolved = resolve(dataDir);
  if (resolved !== dataDirResolved && !resolved.startsWith(dataDirResolved + sep)) {
    throw new Error(`Path traversal blocked: ${filename}`);
  }
  return resolved;
}

/**
 * Canonicalize a doc identifier that might be a bare basename (internal
 * doc) or an absolute path (external doc). Basenames pass through
 * untouched; absolute paths route through `canonicalizePath`. Use this
 * at WebSocket and HTTP boundaries where browser-sent identifiers can
 * be either form and must compare equal against server-side
 * `getActiveFilename()` regardless of how they were spelled.
 *
 * adr: adr/path-canonicalization.md
 */
export function canonicalizeIdentifier(id: string): string {
  if (!id) return id;
  return isAbsolute(id) ? canonicalizePath(id) : id;
}

/**
 * Returns true if filename is a full path pointing outside DATA_DIR.
 *
 * Canonicalizes both sides of the comparison so that mixed separators,
 * drive-letter case, and symlink-resolved variants of the same file all
 * classify consistently. The pre-canonicalization version compared raw
 * strings via `startsWith`, which let `C:/Users/me/data-dir/foo.md`
 * be classified as external on Windows because `getDataDir()` returns
 * `C:\Users\me\data-dir` (different separators).
 *
 * adr: adr/path-canonicalization.md
 */
export function isExternalDoc(filename: string): boolean {
  if (!isAbsolute(filename) && !/[/\\]/.test(filename)) return false;
  const canonFile = canonicalizePath(filename);
  const canonDataDir = canonicalizePath(getDataDir());
  return canonFile !== canonDataDir && !canonFile.startsWith(canonDataDir + sep);
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

/** Atomic write: write to temp file + rename to prevent corruption on crash. */
export function atomicWriteFileSync(filePath: string, data: string): void {
  const tmpPath = filePath + '.tmp';
  writeFileSync(tmpPath, data, 'utf-8');
  renameSync(tmpPath, filePath);
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

export interface OpenWriterConfig {
  avApiKey?: string;
  avBackendUrl?: string;
  gitRemote?: string;
  gitConfigured?: boolean;
  lastSyncTime?: string;
  gitPat?: string;
  repoName?: string;
  plugins?: Record<string, PluginConfig>;
  lastUpdateCheck?: string;   // ISO timestamp
  latestVersion?: string;     // cached version from registry
  activeProfile?: string;
  profiles?: string[];
}

export function readConfig(): OpenWriterConfig {
  ensureDataDir();
  const configFile = getConfigFile();
  if (!existsSync(configFile)) return {};
  try {
    return JSON.parse(readFileSync(configFile, 'utf-8'));
  } catch {
    return {};
  }
}

export function saveConfig(updates: Partial<OpenWriterConfig>): void {
  ensureDataDir();
  const current = readConfig();
  const merged = { ...current, ...updates };
  atomicWriteFileSync(getConfigFile(), JSON.stringify(merged, null, 2));
}

// ---- Profile CRUD ----

export function listProfiles(): string[] {
  const config = readConfig();
  return config.profiles || ['Default'];
}

export function createProfile(name: string): void {
  if (!name.trim()) throw new Error('Profile name cannot be empty');
  const config = readConfig();
  const profiles = config.profiles || ['Default'];
  if (profiles.includes(name)) throw new Error(`Profile "${name}" already exists`);

  // Create profile directory
  const profileDir = join(ROOT_DIR, 'profiles', name);
  mkdirSync(profileDir, { recursive: true });

  // Update config
  profiles.push(name);
  saveConfig({ profiles });
}

export function deleteProfile(name: string): void {
  if (name === 'Default') throw new Error('Cannot delete the Default profile');
  if (name === activeProfile) throw new Error('Cannot delete the active profile');

  const config = readConfig();
  const profiles = config.profiles || ['Default'];
  const idx = profiles.indexOf(name);
  if (idx === -1) throw new Error(`Profile "${name}" not found`);

  // Move directory to .trash-{name}/ (soft delete)
  const profileDir = join(ROOT_DIR, 'profiles', name);
  const trashDir = join(ROOT_DIR, 'profiles', `.trash-${name}`);
  if (existsSync(profileDir)) {
    // If a trash dir already exists for this name, remove the old trash first
    if (existsSync(trashDir)) {
      rmSync(trashDir, { recursive: true, force: true });
    }
    renameSync(profileDir, trashDir);
  }

  profiles.splice(idx, 1);
  saveConfig({ profiles });
}

export function listTrashedProfiles(): string[] {
  const profilesDir = join(ROOT_DIR, 'profiles');
  if (!existsSync(profilesDir)) return [];
  try {
    return readdirSync(profilesDir)
      .filter(name => name.startsWith('.trash-') && statSync(join(profilesDir, name)).isDirectory())
      .map(name => name.slice('.trash-'.length));
  } catch { return []; }
}

export function restoreProfile(name: string): void {
  const trashDir = join(ROOT_DIR, 'profiles', `.trash-${name}`);
  if (!existsSync(trashDir)) throw new Error(`No trashed profile "${name}" found`);

  const profileDir = join(ROOT_DIR, 'profiles', name);
  if (existsSync(profileDir)) throw new Error(`A profile named "${name}" already exists`);

  renameSync(trashDir, profileDir);

  // Add back to config
  const config = readConfig();
  const profiles = config.profiles || ['Default'];
  if (!profiles.includes(name)) {
    profiles.push(name);
    saveConfig({ profiles });
  }
}

// ---- Migration: flat files → profiles/Default/ ----

function migrateToProfiles(): void {
  const profilesDir = join(ROOT_DIR, 'profiles');
  if (existsSync(profilesDir)) return; // Already migrated

  // Create profiles/Default/
  const defaultDir = join(profilesDir, 'Default');
  mkdirSync(defaultDir, { recursive: true });

  // Items to move from ROOT_DIR → profiles/Default/
  const dirsToMove = ['_workspaces', '_images', '.versions', '_marks'];
  const filesToMove = ['_doc-order.json', 'external-docs.json'];

  for (const dir of dirsToMove) {
    const src = join(ROOT_DIR, dir);
    if (existsSync(src)) {
      renameSync(src, join(defaultDir, dir));
    }
  }

  for (const file of filesToMove) {
    const src = join(ROOT_DIR, file);
    if (existsSync(src)) {
      renameSync(src, join(defaultDir, file));
    }
  }

  // Move .git and .gitignore
  for (const name of ['.git', '.gitignore']) {
    const src = join(ROOT_DIR, name);
    if (existsSync(src)) {
      renameSync(src, join(defaultDir, name));
    }
  }

  // Move all .md files
  try {
    const entries = readdirSync(ROOT_DIR);
    for (const entry of entries) {
      if (entry.endsWith('.md')) {
        const src = join(ROOT_DIR, entry);
        if (statSync(src).isFile()) {
          renameSync(src, join(defaultDir, entry));
        }
      }
    }
  } catch { /* best effort */ }

  // Update config
  const configFile = getConfigFile();
  let config: OpenWriterConfig = {};
  if (existsSync(configFile)) {
    try { config = JSON.parse(readFileSync(configFile, 'utf-8')); } catch { /* */ }
  }
  config.activeProfile = 'Default';
  config.profiles = ['Default'];
  atomicWriteFileSync(configFile, JSON.stringify(config, null, 2));
}
