/**
 * Git sync module: all git/gh CLI interactions for GitHub sync.
 * Uses child_process.execFile with shell:true (required on Windows).
 */

import { execFile } from 'child_process';
import { existsSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { DATA_DIR, CONFIG_FILE, VERSIONS_DIR, readConfig, saveConfig } from './helpers.js';
import { save } from './state.js';

const GITIGNORE_CONTENT = `config.json\n.versions/\n`;
const NETWORK_TIMEOUT = 30000;

export type SyncState = 'unconfigured' | 'synced' | 'pending' | 'syncing' | 'error';

export interface SyncStatus {
  state: SyncState;
  lastSyncTime?: string;
  pendingFiles?: number;
  error?: string;
}

export interface SyncCapabilities {
  gitInstalled: boolean;
  ghInstalled: boolean;
  ghAuthenticated: boolean;
  existingRepo: boolean;
  remoteUrl?: string;
}

let currentSyncState: SyncState = 'unconfigured';
let lastError: string | undefined;

function exec(cmd: string, args: string[], cwd: string, timeout = 10000): Promise<string> {
  // Quote args with spaces so shell: true doesn't split them
  const safeArgs = args.map(a => a.includes(' ') ? `"${a}"` : a);
  return new Promise((resolve, reject) => {
    execFile(cmd, safeArgs, { cwd, shell: true, timeout }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr?.trim() || err.message));
      else resolve(stdout.trim());
    });
  });
}

export async function isGitInstalled(): Promise<boolean> {
  try {
    await exec('git', ['--version'], DATA_DIR);
    return true;
  } catch { return false; }
}

export async function isGhInstalled(): Promise<boolean> {
  try {
    await exec('gh', ['--version'], DATA_DIR);
    return true;
  } catch { return false; }
}

export async function isGhAuthenticated(): Promise<boolean> {
  try {
    await exec('gh', ['auth', 'status'], DATA_DIR);
    return true;
  } catch { return false; }
}

export function isGitRepo(): boolean {
  return existsSync(join(DATA_DIR, '.git'));
}

function ensureGitignore(): void {
  const gitignorePath = join(DATA_DIR, '.gitignore');
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, GITIGNORE_CONTENT, 'utf-8');
  }
}

/** Count files that have changed since last commit (or all files if no commits yet). */
async function countPendingFiles(): Promise<number> {
  if (!isGitRepo()) return 0;
  try {
    // Check for any changes (staged + unstaged + untracked)
    const status = await exec('git', ['status', '--porcelain'], DATA_DIR);
    if (!status) return 0;
    return status.split('\n').filter(Boolean).length;
  } catch { return 0; }
}

export interface PendingFile {
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  file: string;
}

/** Return the list of pending files with their status. */
export async function getPendingFiles(): Promise<PendingFile[]> {
  if (!isGitRepo()) return [];
  try {
    const output = await exec('git', ['status', '--porcelain'], DATA_DIR);
    if (!output) return [];
    return output.split('\n').filter(Boolean).map(line => {
      const code = line.substring(0, 2);
      const file = line.substring(3);
      let status: PendingFile['status'] = 'modified';
      if (code.includes('?') || code.includes('A')) status = 'added';
      else if (code.includes('D')) status = 'deleted';
      else if (code.includes('R')) status = 'renamed';
      return { status, file };
    });
  } catch { return []; }
}

export async function getSyncStatus(): Promise<SyncStatus> {
  const config = readConfig();

  if (!config.gitConfigured || !isGitRepo()) {
    return { state: 'unconfigured' };
  }

  if (currentSyncState === 'syncing') {
    return { state: 'syncing' };
  }

  if (currentSyncState === 'error' && lastError) {
    return { state: 'error', error: lastError, lastSyncTime: config.lastSyncTime };
  }

  const pending = await countPendingFiles();
  return {
    state: pending > 0 ? 'pending' : 'synced',
    pendingFiles: pending,
    lastSyncTime: config.lastSyncTime,
  };
}

export async function getCapabilities(): Promise<SyncCapabilities> {
  const [git, gh] = await Promise.all([isGitInstalled(), isGhInstalled()]);
  let ghAuth = false;
  if (gh) ghAuth = await isGhAuthenticated();

  let remoteUrl: string | undefined;
  if (isGitRepo()) {
    try {
      remoteUrl = await exec('git', ['remote', 'get-url', 'origin'], DATA_DIR);
    } catch { /* no remote */ }
  }

  return {
    gitInstalled: git,
    ghInstalled: gh,
    ghAuthenticated: ghAuth,
    existingRepo: isGitRepo(),
    remoteUrl,
  };
}

async function initRepo(): Promise<void> {
  if (!isGitRepo()) {
    await exec('git', ['init'], DATA_DIR);
  }
  ensureGitignore();
  // Ensure git user is configured (required for commits)
  try { await exec('git', ['config', 'user.name'], DATA_DIR); } catch {
    await exec('git', ['config', 'user.name', 'OpenWriter'], DATA_DIR);
  }
  try { await exec('git', ['config', 'user.email'], DATA_DIR); } catch {
    await exec('git', ['config', 'user.email', 'openwriter@local'], DATA_DIR);
  }
}

async function initialCommit(): Promise<void> {
  await exec('git', ['add', '-A'], DATA_DIR);
  // Check if there's anything staged
  const status = await exec('git', ['status', '--porcelain'], DATA_DIR);
  if (!status) return; // Nothing to commit
  await exec('git', ['commit', '-m', 'Initial sync from OpenWriter'], DATA_DIR);
  // Ensure branch is named 'main'
  await exec('git', ['branch', '-M', 'main'], DATA_DIR);
}

export async function setupWithGh(repoName: string, isPrivate: boolean): Promise<void> {
  await initRepo();
  await initialCommit();

  const visibility = isPrivate ? '--private' : '--public';
  // Create repo without --push, then push separately for better error control
  await exec('gh', ['repo', 'create', repoName, visibility, '--source=.', '--remote=origin'], DATA_DIR, NETWORK_TIMEOUT);
  await exec('git', ['push', '-u', 'origin', 'main'], DATA_DIR, NETWORK_TIMEOUT);

  saveConfig({
    gitConfigured: true,
    repoName,
    lastSyncTime: new Date().toISOString(),
  });
  currentSyncState = 'synced';
}

export async function setupWithPat(pat: string, repoName: string, isPrivate: boolean): Promise<void> {
  // Create repo via GitHub REST API
  const res = await fetch('https://api.github.com/user/repos', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${pat}`,
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github+json',
    },
    body: JSON.stringify({ name: repoName, private: isPrivate, auto_init: false }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `GitHub API error: ${res.status}`);
  }

  const repo = await res.json();
  const remoteUrl = `https://${pat}@github.com/${repo.full_name}.git`;

  await initRepo();
  await initialCommit();

  // Set remote
  try { await exec('git', ['remote', 'remove', 'origin'], DATA_DIR); } catch { /* no remote */ }
  await exec('git', ['remote', 'add', 'origin', remoteUrl], DATA_DIR);
  await exec('git', ['push', '-u', 'origin', 'main'], DATA_DIR, NETWORK_TIMEOUT);

  saveConfig({
    gitConfigured: true,
    gitPat: pat,
    repoName,
    gitRemote: repo.html_url,
    lastSyncTime: new Date().toISOString(),
  });
  currentSyncState = 'synced';
}

export async function connectExisting(remoteUrl: string, pat?: string): Promise<void> {
  await initRepo();
  await initialCommit();

  // Embed PAT in URL if provided
  let finalUrl = remoteUrl;
  if (pat && remoteUrl.startsWith('https://')) {
    finalUrl = remoteUrl.replace('https://', `https://${pat}@`);
  }

  try { await exec('git', ['remote', 'remove', 'origin'], DATA_DIR); } catch { /* no remote */ }
  await exec('git', ['remote', 'add', 'origin', finalUrl], DATA_DIR);
  await exec('git', ['push', '-u', 'origin', 'main'], DATA_DIR, NETWORK_TIMEOUT);

  saveConfig({
    gitConfigured: true,
    gitPat: pat,
    gitRemote: remoteUrl,
    lastSyncTime: new Date().toISOString(),
  });
  currentSyncState = 'synced';
}

export async function pushSync(onStatus: (status: SyncStatus) => void): Promise<SyncStatus> {
  currentSyncState = 'syncing';
  lastError = undefined;
  onStatus({ state: 'syncing' });

  try {
    // Flush current document to disk first
    save();

    ensureGitignore();
    await exec('git', ['add', '-A'], DATA_DIR);

    // Check if there's anything to commit
    const status = await exec('git', ['status', '--porcelain'], DATA_DIR);
    if (status) {
      const timestamp = new Date().toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      });
      await exec('git', ['commit', '-m', `Sync: ${timestamp}`], DATA_DIR);
    }

    await exec('git', ['push'], DATA_DIR, NETWORK_TIMEOUT);

    const now = new Date().toISOString();
    saveConfig({ lastSyncTime: now });
    currentSyncState = 'synced';

    const result: SyncStatus = { state: 'synced', lastSyncTime: now, pendingFiles: 0 };
    onStatus(result);
    return result;
  } catch (err: any) {
    currentSyncState = 'error';
    lastError = err.message;
    const result: SyncStatus = { state: 'error', error: err.message };
    onStatus(result);
    return result;
  }
}
