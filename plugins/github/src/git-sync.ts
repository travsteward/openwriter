/**
 * Git sync module: all git/gh CLI interactions for syncing the data folder
 * with a GitHub repo, both ways.
 * Lifted from packages/openwriter/server/git-sync.ts into the github plugin.
 *
 * Uses child_process.execFile with an argv array and NO shell (MCP-1): values
 * are passed to git/gh as literal arguments, never interpreted by a shell.
 * The GitHub token is supplied to authenticated fetches and pushes
 * out-of-band via an inline credential helper reading from an env var
 * (MCP-3) — it is never embedded in the remote URL, written to .git/config,
 * or placed in argv.
 * Server-internal modules (state, helpers, ws) accessed via getServerModules().
 *
 * Sync = commit this side, fetch, merge GitHub in, push. A merge never loses
 * writing: when both sides changed a file and git cannot merge it, this side's
 * file stays in place and GitHub's version is saved next to it as a conflict
 * copy. adr: adr/two-way-sync.md
 */

import { execFile } from 'child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmdirSync, statSync, unlinkSync, utimesSync, watch, writeFileSync } from 'fs';
import { randomBytes } from 'crypto';
import { dirname, extname, join } from 'path';
import { getServerModules } from './helpers.js';
import { deviceFlowClientId } from './device-flow.js';
import { joinDoc, MARKER_SIZE, mergeFront, mergePending, nodeText, plainLine, resolveHunks, splitDoc, type LineInfo, type Replacement, type Side } from './doc-merge.js';
import { addNotices, noticeId, readNotices, removeNotice, type SyncNotice } from './sync-notices.js';

const GITIGNORE_CONTENT = `config.json\n.versions/\n`;
const NETWORK_TIMEOUT = 30000;
// Staging and committing a large backlog (hundreds of files, big logs and
// images) can take well over the 10s default; killing git mid-commit left the
// commit made but the push never run. Sync pushes use it too.
const LOCAL_WRITE_TIMEOUT = 300000;
/** GitHub's side of a non-document conflict lands here, so the app never loads it as a doc or workspace. */
const CONFLICT_DIR = '.sync-conflicts';
/** The token from device flow or a pasted PAT, outside the synced folder, owner-only. */
const TOKEN_FILE = 'github-token.json';
/** This copy's device name and id, in the data folder but never synced. */
const DEVICE_FILE = '.openwriter-device.json';
/** Committed to every documents repo, so another device can recognise it. */
const MARKER_FILE = '.openwriter';
/** The app's first-run marker; its later lines name the first-run documents (server/first-run.ts). */
const FIRST_RUN_MARKER = '.first-run';
/**
 * Files that belong to this copy only: settings, this device, the running
 * server's lock, local versions, the first-run marker, and the voice index
 * with its open-database journals (an index each copy builds from the
 * documents; a binary database cannot merge, and its journals only mean
 * something to the process holding the file).
 * Listed in .git/info/exclude, which is never synced; the first-run documents join them.
 */
const LOCAL_ONLY = ['config.json', '.versions/', DEVICE_FILE, FIRST_RUN_MARKER, 'server.lock', 'voice/index.db', 'voice/index.db-shm', 'voice/index.db-wal'];
/** Per-document append-only logs: merged by keeping both sides' lines (.gitattributes, synced). */
const UNION_MERGED = ['_history/*.jsonl merge=union', '_commits/*.jsonl merge=union', '*.log merge=union'];
/** When this copy last synced. Inside .git, so it is never synced either. */
const SYNC_META_FILE = 'openwriter-sync.json';
/** A pull waits while the writer typed this recently, so nothing changes under their cursor. */
const TYPING_MS = 3000;
/** Saves are committed this long after the last one: commit time is edit time. */
const COMMIT_DELAY_MS = 1500;
/** Changes go to GitHub this long after the writer stops. */
const PUSH_DELAY_MS = 20000;
/**
 * A writing-only copy (a copy started with OW_GITHUB_IMAGES_ON_DEMAND=1, such as
 * an online one with a small disk) gets every file's name and all the writing;
 * images stay on GitHub until shown. Git does the work: files over the filter
 * size are left on GitHub (a partial clone), and _images/ stays out of the folder
 * (sparse checkout). Decided once, at connection; the repo's own config says so after.
 */
const WRITING_ONLY_FILTER = 'blob:limit=256k';
const WRITING_ONLY_PATTERNS = ['/*', '!/_images/'];
/** Images a writing-only copy fetched, inside .git so they never sync; the least recently shown go first. */
const IMAGE_CACHE_DIR = 'openwriter-images';
const IMAGE_CACHE_BYTES = 256 * 1024 * 1024;
/** Says the images other sources held went into this repo (handOverImages). Inside .git, never synced. */
const HANDOVER_FILE = 'openwriter-images-handed.json';
/** Images per handover commit: what one stop partway can cost, well under GitHub's per-minute limit. */
const HANDOVER_BATCH = 50;

export type SyncState = 'unconfigured' | 'synced' | 'pending' | 'syncing' | 'offline' | 'error';

export interface SyncStatus {
  state: SyncState;
  lastSyncTime?: string;
  pendingFiles?: number;
  /** What went wrong, in the writer's words. */
  error?: string;
  /** What fixes it: sign in again, connect again, or try again. */
  fix?: 'signin' | 'setup' | 'retry';
  /** A pull that waited because the writer is typing; ask again after the pause. */
  deferred?: boolean;
  /** Conflict copies the last sync saved: non-document files changed on both sides. */
  conflicts?: string[];
  /** What syncs changed under the writer: replaced paragraphs, a deleted open document. */
  notices?: SyncNotice[];
}

export interface SyncCapabilities {
  gitInstalled: boolean;
  ghInstalled: boolean;
  ghAuthenticated: boolean;
  existingRepo: boolean;
  remoteUrl?: string;
  /** A GitHub token is stored (device flow or PAT); setup can use it without asking again. */
  signedIn: boolean;
  /** "Sign in with GitHub" (device flow) is available. */
  deviceFlow: boolean;
  /** The name this copy signs its changes with, once chosen. */
  deviceName?: string;
  /** A name to offer before sign-in tells us the writer's name. */
  deviceSuggestion: string;
}

export interface Device { id: string; name: string }

/** A GitHub repo that already holds OpenWriter documents. */
export interface DocsRepo { fullName: string; name: string; documents: number; private: boolean }

let currentSyncState: SyncState = 'unconfigured';
let lastError: { error: string; fix?: SyncStatus['fix'] } | undefined;
let lastConflicts: string[] = [];
/** One sync at a time: a second caller waits for the running one, then runs. */
let queue: Promise<unknown> = Promise.resolve();

// SECURITY (MCP-1): no shell. Arguments are passed to git/gh as an argv array,
// so each element is a single literal argument with no shell interpretation.
// The optional `env` is merged over the parent process env for that one call.
// Every git call carries the sign-in (gitAuth): in a writing-only copy any
// command may need to fetch a file it does not have yet, a merge included.
async function exec(
  cmd: string,
  args: string[],
  cwd: string,
  timeout = 10000,
  env?: NodeJS.ProcessEnv,
): Promise<string> {
  if (cmd !== 'git') return run(cmd, args, cwd, timeout, env);
  const auth = await gitAuth();
  return run('git', [...auth.args, ...args], cwd, timeout, { ...auth.env, ...env });
}

function run(
  cmd: string,
  args: string[],
  cwd: string,
  timeout: number,
  env?: NodeJS.ProcessEnv,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { cwd, timeout, env: env ? { ...process.env, ...env } : process.env, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err && (err as any).killed) reject(new Error(`${cmd} ${args[0]} timed out after ${timeout / 1000}s`));
        else if (err) reject(new Error(stderr?.trim() || stdout?.trim() || err.message));
        else resolve(stdout.trim());
      },
    );
  });
}

/** A blob's exact bytes (exec trims, which would change files). */
async function gitBlob(sha: string, cwd: string): Promise<Buffer> {
  const auth = await gitAuth();
  return new Promise((resolve, reject) => {
    execFile('git', [...auth.args, 'cat-file', 'blob', sha], { cwd, env: { ...process.env, ...auth.env }, encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err); else resolve(stdout);
    });
  });
}

// ── Credential handling (MCP-3) ─────────────────────────────────────────────
// The token is supplied to authenticated git network calls WITHOUT ever
// touching the remote URL, .git/config, or argv. An inline credential helper
// (run by git through its own sh) reads the token from the OW_GIT_PAT env var
// at call time; only the variable *name* appears in arguments, never the
// secret itself.
const PAT_CRED_HELPER =
  '!f() { test "$1" = get && printf "username=x-access-token\\npassword=%s\\n" "$OW_GIT_PAT"; }; f';

/**
 * The arguments and env that let a git command reach GitHub. With a token, the
 * `-c credential.helper=` first resets any inherited helper so only ours
 * answers; the token is passed via env, not argv. Without one, git's own
 * auth (gh, SSH, a credential manager) answers. Never prompts: a missing
 * credential fails instead of hanging the server.
 */
async function gitAuth(): Promise<{ args: string[]; env: NodeJS.ProcessEnv }> {
  const token = await readToken();
  if (!token) return { args: [], env: { GIT_TERMINAL_PROMPT: '0' } };
  return {
    args: ['-c', 'credential.helper=', '-c', `credential.helper=${PAT_CRED_HELPER}`],
    env: { GIT_TERMINAL_PROMPT: '0', OW_GIT_PAT: token },
  };
}

/** A git command that talks to GitHub (fetch, push): the same sign-in, a network timeout. */
function execGitRemote(args: string[], cwd: string, timeout = NETWORK_TIMEOUT): Promise<string> {
  return exec('git', args, cwd, timeout);
}

// ── Token store ─────────────────────────────────────────────────────────────

async function tokenFile(): Promise<string> {
  return join((await getServerModules()).rootDir, TOKEN_FILE);
}

/** The stored GitHub token, if any. Older installs kept a PAT in config.json. */
export async function readToken(): Promise<string | undefined> {
  try {
    const token = JSON.parse(readFileSync(await tokenFile(), 'utf-8'))?.token;
    if (typeof token === 'string' && token) return token;
  } catch { /* no token file */ }
  const legacy = (await getServerModules()).readConfig()?.gitPat;
  return typeof legacy === 'string' && legacy ? legacy : undefined;
}

/** Store a token readable by this user only. Never logged, never in git config. */
export async function saveToken(token: string, source: 'device' | 'pat'): Promise<void> {
  const file = await tokenFile();
  writeFileSync(file, JSON.stringify({ token, source, savedAt: new Date().toISOString() }), { mode: 0o600 });
  try { chmodSync(file, 0o600); } catch { /* best-effort on filesystems without modes */ }
  const srv = await getServerModules();
  if (srv.readConfig()?.gitPat !== undefined) srv.saveConfig({ gitPat: undefined });
}

/**
 * Strip any embedded credentials (PAT / user:pass) from a git remote URL so a
 * credential-bearing URL is never returned to a client or logged. SSH scp-style
 * remotes (git@github.com:owner/repo.git) and local paths carry no secret and
 * are left as-is.
 */
export function sanitizeRemoteUrl(url: string): string {
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return url;
  try {
    const u = new URL(url);
    if (u.username || u.password) {
      u.username = '';
      u.password = '';
    }
    return u.toString();
  } catch {
    // Not parseable — defensively drop any userinfo that precedes an @ in a
    // scheme://… authority.
    return url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i, '$1');
  }
}

async function dataDir(): Promise<string> {
  return (await getServerModules()).getDataDir();
}

// ── Device ──────────────────────────────────────────────────────────────────
// Every change this copy sends is signed with its device name (the commit
// author), so history and notices can say "Maya's laptop" or "Web". The id
// (the author email) tells this copy's own changes from another's even when
// two devices share a name. Stored in the data folder, never synced.

function cleanDeviceName(name: string): string {
  return name.replace(/[\r\n\t<>"]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}

/** This copy's device, if a name was chosen. */
export async function readDevice(): Promise<Device | null> {
  try {
    const d = JSON.parse(readFileSync(join(await dataDir(), DEVICE_FILE), 'utf-8'));
    if (typeof d?.id === 'string' && typeof d?.name === 'string' && d.name) return { id: d.id, name: d.name };
  } catch { /* not chosen yet */ }
  return null;
}

export async function saveDeviceName(name: string): Promise<Device> {
  const clean = cleanDeviceName(name) || 'OpenWriter';
  const id = (await readDevice())?.id || randomBytes(6).toString('hex');
  writeFileSync(join(await dataDir(), DEVICE_FILE), JSON.stringify({ id, name: clean }));
  return { id, name: clean };
}

async function device(): Promise<Device> {
  return (await readDevice()) || saveDeviceName(process.env.OW_GITHUB_DEVICE_NAME || 'OpenWriter');
}

/** `git -c user.name=<device> -c user.email=<id>@device.openwriter <args>`: this device signs the commit. */
async function gitAs(args: string[], dir: string, timeout = LOCAL_WRITE_TIMEOUT): Promise<string> {
  const d = await device();
  return exec('git', ['-c', `user.name=${d.name}`, '-c', `user.email=${d.id}@device.openwriter`, ...args], dir, timeout);
}

/** The name the setup screen offers: the hosting program's choice, else "<first name>'s computer". */
export function suggestDeviceName(githubName?: string): string {
  if (process.env.OW_GITHUB_DEVICE_NAME?.trim()) return process.env.OW_GITHUB_DEVICE_NAME.trim();
  const first = githubName?.trim().split(/\s+/)[0];
  return first ? `${first}'s computer` : 'My computer';
}

// ── Finding the writer's documents on GitHub ────────────────────────────────

async function githubApi(path: string, token: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** True when a repo's top-level listing looks like an OpenWriter data folder. */
function isDocsListing(entries: any[]): boolean {
  const names = new Set(entries.map((e) => e?.name));
  return names.has(MARKER_FILE) || names.has('_doc-order.json') || names.has('_workspaces') || names.has('_pending') || names.has('_history');
}

/**
 * The writer's GitHub repos that already hold OpenWriter documents, most
 * recently changed first, plus their name for the device suggestion. A second
 * device connects to one of these instead of creating another repo.
 */
export async function findDocsRepos(): Promise<{ login: string; name?: string; repos: DocsRepo[] }> {
  const token = await readToken();
  // `signIn` marks the errors the setup window answers with its Sign in button.
  if (!token) throw Object.assign(new Error('Sign in with GitHub first'), { signIn: true });
  const user = await githubApi('/user', token);
  if (user.status === 401) throw Object.assign(new Error('GitHub sign-in expired. Sign in again.'), { signIn: true });
  if (user.status !== 200) throw new Error(`GitHub returned ${user.status}`);
  const list = await githubApi('/user/repos?per_page=100&sort=pushed&affiliation=owner', token);
  const all: any[] = Array.isArray(list.body) ? list.body : [];
  const repos: DocsRepo[] = [];
  // Look inside the 30 most recently changed repos, and always the default name.
  const candidates = all.filter((r, i) => i < 30 || r.name === 'openwriter-docs');
  await Promise.all(candidates.map(async (r) => {
    const root = await githubApi(`/repos/${r.full_name}/contents/`, token);
    const entries: any[] = Array.isArray(root.body) ? root.body : [];
    const empty = root.status === 404 && r.size === 0;
    if (!isDocsListing(entries) && !(empty && r.name === 'openwriter-docs')) return;
    const documents = entries.filter((e) => e?.type === 'file' && String(e.name).endsWith('.md')).length;
    repos.push({ fullName: r.full_name, name: r.name, documents, private: !!r.private });
  }));
  const order = new Map(all.map((r, i) => [r.full_name, i]));
  repos.sort((a, b) => (order.get(a.fullName) ?? 0) - (order.get(b.fullName) ?? 0));
  return { login: user.body?.login, name: user.body?.name || undefined, repos };
}

/** Connect a repo found by findDocsRepos (`owner/name`): the existing-repo path, no address to paste. */
export async function connectRepo(fullName: string): Promise<string[]> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(fullName)) throw new Error('Unknown repository');
  return connectExisting(`https://github.com/${fullName}.git`);
}

export async function isGitInstalled(): Promise<boolean> {
  try { await exec('git', ['--version'], await dataDir()); return true; } catch { return false; }
}

export async function isGhInstalled(): Promise<boolean> {
  try { await exec('gh', ['--version'], await dataDir()); return true; } catch { return false; }
}

export async function isGhAuthenticated(): Promise<boolean> {
  try { await exec('gh', ['auth', 'status'], await dataDir()); return true; } catch { return false; }
}

export async function isGitRepo(): Promise<boolean> {
  return existsSync(join(await dataDir(), '.git'));
}

async function ensureGitignore(): Promise<void> {
  const dir = await dataDir();
  const gitignorePath = join(dir, '.gitignore');
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, GITIGNORE_CONTENT, 'utf-8');
  }
  // Append-only logs never clash: both devices' new lines are kept. Synced, so every copy merges alike.
  const attributes = join(dir, '.gitattributes');
  const current = existsSync(attributes) ? readFileSync(attributes, 'utf-8') : '';
  const missing = UNION_MERGED.filter((l) => !current.split(/\r?\n/).includes(l));
  if (missing.length) writeFileSync(attributes, `${current}${current && !current.endsWith('\n') ? '\n' : ''}${missing.join('\n')}\n`);
}

async function countPendingFiles(): Promise<number> {
  if (!(await isGitRepo())) return 0;
  try {
    const status = await exec('git', ['status', '--porcelain'], await dataDir());
    if (!status) return 0;
    return status.split('\n').filter(Boolean).length;
  } catch { return 0; }
}

export interface PendingFile {
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  file: string;
}

export async function getPendingFiles(): Promise<PendingFile[]> {
  if (!(await isGitRepo())) return [];
  try {
    const output = await exec('git', ['status', '--porcelain'], await dataDir());
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

/** This folder syncs when it is a git repo with a GitHub remote. Per folder, so each profile has its own. */
export async function isConfigured(): Promise<boolean> {
  if (!(await isGitRepo())) return false;
  try { await exec('git', ['remote', 'get-url', 'origin'], await dataDir()); return true; } catch { return false; }
}

async function readLastSync(dir: string): Promise<string | undefined> {
  try { return JSON.parse(readFileSync(join(dir, '.git', SYNC_META_FILE), 'utf-8')).lastSyncTime; } catch { return undefined; }
}

function writeLastSync(dir: string, time: string): void {
  try { writeFileSync(join(dir, '.git', SYNC_META_FILE), JSON.stringify({ lastSyncTime: time })); } catch { /* best-effort */ }
}

/**
 * A failed sync in the writer's words, with the fix. Never git output, never
 * a bare "Retry": no network is "offline" (work is saved here and goes up
 * later), a refused credential is an expired sign-in.
 */
export function describeSyncError(message: string): { state: 'offline' | 'error'; error: string; fix?: SyncStatus['fix'] } {
  if (/could not resolve host|unable to access|failed to connect|connection (refused|reset|timed out)|network is unreachable|timed out|getaddrinfo|ENOTFOUND|ECONNRESET/i.test(message)
    && !/(401|403)\b|authentication/i.test(message)) {
    return { state: 'offline', error: 'Offline, saved here, will sync' };
  }
  if (/authentication failed|could not read username|invalid username or password|bad credentials|terminal prompts disabled|\b(401|403)\b|permission to .* denied/i.test(message)) {
    return { state: 'error', error: 'GitHub sign-in expired', fix: 'signin' };
  }
  if (/repository not found|does not appear to be a git repository/i.test(message)) {
    return { state: 'error', error: 'Your documents are no longer on GitHub where they were', fix: 'setup' };
  }
  return { state: 'error', error: 'Could not sync with GitHub', fix: 'retry' };
}

export async function getSyncStatus(): Promise<SyncStatus> {
  if (!(await isConfigured())) {
    return { state: 'unconfigured' };
  }

  const dir = await dataDir();
  const notices = readNotices(dir);
  // Notices stay on screen while a sync runs.
  if (currentSyncState === 'syncing') {
    return { state: 'syncing', ...(notices.length ? { notices } : {}) };
  }

  const lastSyncTime = await readLastSync(dir);
  const conflicts = { ...(lastConflicts.length ? { conflicts: lastConflicts } : {}), ...(notices.length ? { notices } : {}) };
  if ((currentSyncState === 'error' || currentSyncState === 'offline') && lastError) {
    return { state: currentSyncState, ...lastError, lastSyncTime, ...conflicts };
  }

  const pending = await countPendingFiles();
  return {
    state: pending > 0 ? 'pending' : 'synced',
    pendingFiles: pending,
    lastSyncTime,
    ...conflicts,
  };
}

export async function getCapabilities(): Promise<SyncCapabilities> {
  const [git, gh] = await Promise.all([isGitInstalled(), isGhInstalled()]);
  let ghAuth = false;
  if (gh) ghAuth = await isGhAuthenticated();

  let remoteUrl: string | undefined;
  if (await isGitRepo()) {
    try {
      // MCP-3: never expose embedded credentials. Even though the remote is
      // now stored credential-free, strip defensively so a legacy URL written
      // by an older build (PAT-in-URL) can't leak through this route.
      remoteUrl = sanitizeRemoteUrl(await exec('git', ['remote', 'get-url', 'origin'], await dataDir()));
    } catch { /* no remote */ }
  }

  return {
    gitInstalled: git,
    ghInstalled: gh,
    ghAuthenticated: ghAuth,
    existingRepo: await isGitRepo(),
    remoteUrl,
    signedIn: !!(await readToken()),
    deviceFlow: !!deviceFlowClientId(),
    deviceName: (await readDevice())?.name,
    deviceSuggestion: suggestDeviceName(),
  };
}

/** The documents the app wrote on its first run ("Start here"), named in the marker's later lines. */
function firstRunDocuments(dir: string): string[] {
  try {
    return readFileSync(join(dir, FIRST_RUN_MARKER), 'utf-8').split(/\r?\n/).slice(1)
      .map((l) => l.trim()).filter((l) => l.endsWith('.md') && !/[\\/]/.test(l));
  } catch { return []; }
}

/** Every path that stays on this copy: the fixed list plus the first-run documents. */
function localOnlyPaths(dir: string): string[] {
  return [...LOCAL_ONLY, ...firstRunDocuments(dir).map((f) => `/${f}`)];
}

/**
 * This copy's own files stay out of every commit: .git/info/exclude is local
 * to this folder. One an older version committed is dropped from the repo
 * (the file itself stays here).
 */
async function ensureLocalExcludes(dir: string): Promise<void> {
  const file = join(dir, '.git', 'info', 'exclude');
  let current = '';
  try { current = readFileSync(file, 'utf-8'); } catch { mkdirSync(dirname(file), { recursive: true }); }
  const have = new Set(current.split(/\r?\n/));
  const paths = localOnlyPaths(dir);
  const missing = paths.filter((p) => !have.has(p));
  if (missing.length) writeFileSync(file, `${current}${current && !current.endsWith('\n') ? '\n' : ''}${missing.join('\n')}\n`);
  const files = paths.filter((p) => !p.endsWith('/')).map((p) => p.replace(/^\//, ''));
  await exec('git', ['rm', '-q', '--cached', '--ignore-unmatch', '--', ...files], dir);
}

/** This copy's own files as they are now, so a pull that drops them from the repo cannot remove them here. */
function snapshotLocalOnly(dir: string): Map<string, Buffer> {
  const saved = new Map<string, Buffer>();
  for (const p of localOnlyPaths(dir)) {
    if (p.endsWith('/')) continue;
    const path = join(dir, p.replace(/^\//, ''));
    try { saved.set(path, readFileSync(path)); } catch { /* not here */ }
  }
  return saved;
}

function restoreLocalOnly(saved: Map<string, Buffer>): void {
  for (const [path, bytes] of saved) if (!existsSync(path)) writeFileSync(path, bytes);
}

async function initRepo(): Promise<void> {
  const dir = await dataDir();
  if (!(await isGitRepo())) {
    await exec('git', ['init'], dir);
  }
  await ensureGitignore();
  await ensureLocalExcludes(dir);
  if (!existsSync(join(dir, MARKER_FILE))) {
    writeFileSync(join(dir, MARKER_FILE), 'This repository holds OpenWriter documents. OpenWriter keeps it in sync.\n');
  }
}

/** True when this folder was connected writing-only: its GitHub remote may hold files it does not. */
async function isWritingOnly(dir: string): Promise<boolean> {
  try { return (await exec('git', ['config', '--get', 'remote.origin.promisor'], dir)) === 'true'; } catch { return false; }
}

/**
 * Stage everything and commit it as this device. False when there was nothing to commit.
 * In a writing-only copy `--sparse` lets a new image from this copy in; images left on
 * GitHub are marked as not here (skip-worktree), so they are never staged as deleted.
 */
async function commitAll(dir: string, message: string): Promise<boolean> {
  await exec('git', ['add', '-A', ...(await isWritingOnly(dir) ? ['--sparse'] : [])], dir, LOCAL_WRITE_TIMEOUT);
  const status = await exec('git', ['status', '--porcelain'], dir, LOCAL_WRITE_TIMEOUT);
  if (!status) return false;
  await gitAs(['commit', '-m', message], dir);
  return true;
}

async function initialCommit(): Promise<void> {
  const dir = await dataDir();
  await commitAll(dir, 'Initial sync from OpenWriter');
  try { await exec('git', ['branch', '-M', 'main'], dir); } catch { /* no commit yet */ }
}

async function headSha(dir: string): Promise<string | null> {
  try { return await exec('git', ['rev-parse', '--verify', '-q', 'HEAD'], dir); } catch { return null; }
}

async function currentBranch(dir: string): Promise<string> {
  try { return await exec('git', ['symbolic-ref', '--short', 'HEAD'], dir); } catch { return 'main'; }
}

/** The fetched GitHub branch to merge: same name as ours, else main/master, else the only one. Null when GitHub is empty. */
async function remoteBranch(dir: string): Promise<string | null> {
  const out = await exec('git', ['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin'], dir);
  const branches = out.split('\n').map((b) => b.trim().replace(/^origin\//, '')).filter((b) => b && b !== 'HEAD' && b !== 'origin');
  if (branches.length === 0) return null;
  const ours = await currentBranch(dir);
  for (const b of [ours, 'main', 'master']) if (branches.includes(b)) return b;
  return branches[0];
}

/** True when any document in the folder has words in it (an empty starter draft does not count). */
function hasWriting(dir: string): boolean {
  const firstRun = new Set(firstRunDocuments(dir));
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.md') || firstRun.has(name)) continue;
    const raw = readFileSync(join(dir, name), 'utf-8');
    const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
    if (body.trim()) return true;
  }
  return false;
}

function conflictStamp(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}${p(now.getMinutes())}`;
}

function freePath(path: string): string {
  if (!existsSync(path)) return path;
  const ext = extname(path);
  const stem = path.slice(0, path.length - ext.length);
  for (let i = 2; ; i++) if (!existsSync(`${stem} ${i}${ext}`)) return `${stem} ${i}${ext}`;
}

/** A document the writer sees: a `.md` file outside the app's `_` and `.` folders. */
function isDocPath(path: string): boolean {
  return path.endsWith('.md') && !path.split('/').some((p) => p.startsWith('_') || p.startsWith('.'));
}

/** A document's pending (suggested) changes file. */
function isPendingPath(path: string): boolean {
  return /^_pending\/[^/]+\.json$/.test(path);
}

/** A file's bytes at a commit, or null when it is not there. */
async function readAt(dir: string, rev: string, path: string): Promise<string | null> {
  try { return (await gitBlob(`${rev}:${path}`, dir)).toString('utf-8'); } catch { return null; }
}

function deviceOf(email: string): string {
  return email.replace(/^<|>$/g, '').replace(/@device\.openwriter$/, '');
}

/** When one side last changed a file (unix seconds), and on which device. */
async function lastChange(dir: string, rev: string, path: string, since?: string | null): Promise<LineInfo> {
  const range = since ? `${since}..${rev}` : rev;
  try {
    const out = await exec('git', ['log', '-1', '--format=%at%x1f%an%x1f%ae', range, '--', path], dir);
    const [t, name, email] = (out || await exec('git', ['log', '-1', '--format=%at%x1f%an%x1f%ae', rev], dir)).split('\x1f');
    return { time: Number(t) || 0, device: name || 'another device', deviceId: deviceOf(email || '') };
  } catch { return { time: 0, device: 'another device', deviceId: '' }; }
}

/** Each line's last edit on one side (git blame), keyed by the line's text. */
async function sideOf(dir: string, rev: string, path: string, base: string | null): Promise<Side> {
  const fallback = await lastChange(dir, rev, path, base);
  const byText = new Map<string, LineInfo>();
  try {
    const out = await exec('git', ['blame', '--line-porcelain', rev, '--', path], dir, LOCAL_WRITE_TIMEOUT);
    let cur: LineInfo = { ...fallback };
    for (const l of out.split('\n')) {
      if (l.startsWith('\t')) {
        const text = l.slice(1);
        const had = byText.get(text);
        if (!had || cur.time > had.time) byText.set(text, cur);
      } else if (/^[0-9a-f]{40} /.test(l)) cur = { ...fallback };
      else if (l.startsWith('author-time ')) cur.time = Number(l.slice(12));
      else if (l.startsWith('author ')) cur.device = l.slice(7);
      else if (l.startsWith('author-mail ')) cur.deviceId = deviceOf(l.slice(12));
    }
  } catch { /* new on this side: every line takes the fallback */ }
  return { line: (text) => byText.get(text), fallback };
}

/** `git merge-file --diff3` of three texts: the merge, with marked hunks where both sides changed. */
async function mergeFileText(dir: string, ours: string, base: string, theirs: string): Promise<string> {
  const tmp = join(dir, '.git', 'ow-merge');
  mkdirSync(tmp, { recursive: true });
  const [o, b, t] = ['ours', 'base', 'theirs'].map((n) => join(tmp, n));
  writeFileSync(o, ours); writeFileSync(b, base); writeFileSync(t, theirs);
  return new Promise((resolve, reject) => {
    execFile('git', ['merge-file', '-p', '--diff3', `--marker-size=${MARKER_SIZE}`, '-L', 'ours', '-L', 'base', '-L', 'theirs', o, b, t],
      { cwd: dir, maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
        // A positive exit code is the number of conflicts, not a failure.
        const code = (err as any)?.code;
        if (err && !(typeof code === 'number' && code > 0 && code < 128)) reject(err);
        else resolve(stdout);
      });
  });
}

interface MergeContext {
  dir: string;
  /** The last commit both sides share; null for unrelated histories (a first connection). */
  base: string | null;
  replacements: (Replacement & { file: string; docId?: string; title?: string })[];
}

/** A document both sides changed: paragraph by paragraph, newest edit wins, replacements reported. */
async function mergeDocument(ctx: MergeContext, path: string, s: Map<number, string>): Promise<void> {
  const text = async (sha?: string) => (sha ? (await gitBlob(sha, ctx.dir)).toString('utf-8') : '');
  const [b, o, t] = await Promise.all([text(s.get(1)), text(s.get(2)), text(s.get(3))]);
  const [ours, theirs] = await Promise.all([sideOf(ctx.dir, 'HEAD', path, ctx.base), sideOf(ctx.dir, 'MERGE_HEAD', path, ctx.base)]);
  const B = splitDoc(b); const O = splitDoc(o); const T = splitDoc(t);
  const front = mergeFront(B.front, O.front, T.front, ours.fallback.time >= theirs.fallback.time);
  const body = resolveHunks(await mergeFileText(ctx.dir, O.body, B.body, T.body), ours, theirs);
  writeFileSync(join(ctx.dir, path), joinDoc(front, body.text));
  await exec('git', ['add', '--', path], ctx.dir);
  for (const r of body.replacements) ctx.replacements.push({ ...r, file: path, docId: front?.docId, title: front?.title });
}

/** A pending-changes file changed on both sides: entry by entry; a decided change never comes back. */
async function mergePendingFile(ctx: MergeContext, path: string, base: string | null, ours: string | null, theirs: string | null): Promise<void> {
  const [o, t] = await Promise.all([lastChange(ctx.dir, 'HEAD', path, ctx.base), lastChange(ctx.dir, 'MERGE_HEAD', path, ctx.base)]);
  const merged = mergePending(base, ours, theirs, o.time >= t.time);
  const file = join(ctx.dir, path);
  if (merged === null) {
    if (existsSync(file)) unlinkSync(file);
    await exec('git', ['rm', '-q', '--cached', '--ignore-unmatch', '--', path], ctx.dir);
  } else {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, merged);
    await exec('git', ['add', '--', path], ctx.dir);
  }
}

async function unmergedStages(dir: string): Promise<Map<string, Map<number, string>>> {
  const out = await exec('git', ['ls-files', '-u', '-z'], dir);
  const stages = new Map<string, Map<number, string>>();
  for (const entry of out.split('\0').filter(Boolean)) {
    const tab = entry.indexOf('\t');
    const [, sha, stage] = entry.slice(0, tab).split(' ');
    const path = entry.slice(tab + 1);
    if (!stages.has(path)) stages.set(path, new Map());
    stages.get(path)!.set(Number(stage), sha);
  }
  return stages;
}

/**
 * Settle every file git could not merge, keeping all writing:
 *   a document both changed   → paragraph merge, the newest edit of each paragraph wins
 *   pending changes           → entry merge, decided changes stay decided
 *   attribution cache (_blame) → ours stays; it is rebuilt from _history
 *   any other file both changed → ours stays, GitHub's saved under .sync-conflicts/
 *   one side deleted          → the side that still has the file wins (an edit since beats a delete)
 *   both deleted              → gone
 * Returns the non-document conflict copies, relative to the data folder.
 */
async function settleConflicts(ctx: MergeContext, stages: Map<string, Map<number, string>>): Promise<string[]> {
  const { dir } = ctx;
  const label = `from GitHub ${conflictStamp()}`;
  const copies: string[] = [];
  for (const [path, s] of stages) {
    const ours = s.get(2);
    const theirs = s.get(3);
    if (isPendingPath(path)) {
      const text = async (sha?: string) => (sha ? (await gitBlob(sha, dir)).toString('utf-8') : null);
      await mergePendingFile(ctx, path, await text(s.get(1)), await text(ours), await text(theirs));
    } else if (ours && theirs && isDocPath(path)) {
      await mergeDocument(ctx, path, s);
    } else if (ours && theirs && path.startsWith('_blame/')) {
      // The attribution cache is rebuilt from _history; a copy of GitHub's would only pile up.
      await exec('git', ['checkout', '--ours', '--', path], dir);
      await exec('git', ['add', '--', path], dir);
    } else if (ours && theirs) {
      await exec('git', ['checkout', '--ours', '--', path], dir);
      const blob = await gitBlob(theirs, dir);
      const copy = freePath(join(dir, CONFLICT_DIR, label.replace(/ /g, '_'), path));
      mkdirSync(dirname(copy), { recursive: true });
      writeFileSync(copy, blob);
      const rel = copy.slice(dir.length + 1).replace(/\\/g, '/');
      await exec('git', ['add', '--', path, rel], dir);
      copies.push(rel);
    } else if (ours || theirs) {
      await exec('git', ['checkout', ours ? '--ours' : '--theirs', '--', path], dir);
      await exec('git', ['add', '--', path], dir);
    } else {
      await exec('git', ['rm', '-q', '--cached', '--ignore-unmatch', '--', path], dir);
    }
  }
  return copies;
}

async function changedSince(dir: string, base: string, rev: string): Promise<Set<string>> {
  const out = await exec('git', ['diff', '--name-only', '-z', base, rev, '--', '_pending'], dir);
  return new Set(out.split('\0').filter(Boolean));
}

/**
 * Pending-changes files both sides changed that git merged line by line: merge
 * them entry by entry too, so a decided change is never brought back and the
 * file stays valid JSON. Then settle changes the two devices decided
 * differently (one accepted, the other rejected): the later decision wins.
 */
async function settlePending(ctx: MergeContext, conflicted: Set<string>): Promise<void> {
  if (!ctx.base) return;
  const { dir, base } = ctx;
  const ours = await changedSince(dir, base, 'HEAD');
  const theirs = await changedSince(dir, base, 'MERGE_HEAD');
  for (const path of ours) {
    if (!theirs.has(path) || !isPendingPath(path)) continue;
    const [b, o, t] = await Promise.all([readAt(dir, base, path), readAt(dir, 'HEAD', path), readAt(dir, 'MERGE_HEAD', path)]);
    if (!conflicted.has(path)) await mergePendingFile(ctx, path, b, o, t);
    await settleDecisions(ctx, path, b, o, t);
  }
}

/** The data-folder path of the document with this docId, in the merged folder. */
function docPathById(dir: string, docId: string): string | null {
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.md')) continue;
    try {
      if (splitDoc(readFileSync(join(dir, name), 'utf-8')).front?.docId === docId) return name;
    } catch { /* unreadable */ }
  }
  return null;
}

async function settleDecisions(ctx: MergeContext, path: string, base: string | null, ours: string | null, theirs: string | null): Promise<void> {
  const entries = (raw: string | null): any[] => { try { return JSON.parse(raw || '{}').entries || []; } catch { return []; } };
  const ids = (raw: string | null) => new Set(entries(raw).map((e) => e?.nodeId));
  const oIds = ids(ours); const tIds = ids(theirs);
  const decided = entries(base).filter((e) => e?.nodeId && !oIds.has(e.nodeId) && !tIds.has(e.nodeId));
  if (decided.length === 0) return;
  const docFile = docPathById(ctx.dir, path.slice('_pending/'.length, -'.json'.length));
  if (!docFile) return;
  const [baseDoc, oursDoc, theirsDoc] = await Promise.all([ctx.base!, 'HEAD', 'MERGE_HEAD'].map((rev) => readAt(ctx.dir, rev, docFile)));
  const [oTime, tTime] = await Promise.all([lastChange(ctx.dir, 'HEAD', path, ctx.base), lastChange(ctx.dir, 'MERGE_HEAD', path, ctx.base)]);
  const linesOf = (raw: string | null) => (raw ? splitDoc(raw).body.split('\n') : []);
  const file = join(ctx.dir, docFile);
  const merged = splitDoc(readFileSync(file, 'utf-8'));
  const lines = merged.body.split('\n');
  let changed = false;
  for (const e of decided) {
    const orig = plainLine(nodeText(e.originalBaseline));
    const next = plainLine(nodeText(e.newContent));
    if (!next || orig === next) continue;
    const accepted = (raw: string | null) => linesOf(raw).some((l) => plainLine(l) === next);
    const oAccepted = accepted(oursDoc);
    if (oAccepted === accepted(theirsDoc)) continue;
    const laterAccepted = oTime.time >= tTime.time ? oAccepted : !oAccepted;
    const at = lines.findIndex((l) => plainLine(l) === (laterAccepted ? orig : next));
    if (at < 0 || (laterAccepted && lines.some((l) => plainLine(l) === next))) continue;
    if (laterAccepted) {
      lines[at] = linesOf(oAccepted ? oursDoc : theirsDoc).find((l) => plainLine(l) === next) || next;
    } else if (orig) {
      lines[at] = linesOf(baseDoc).find((l) => plainLine(l) === orig) || orig;
    } else {
      // A rejected insert: take the inserted paragraph out again.
      lines.splice(at, lines[at + 1] === '' ? 2 : 1);
    }
    changed = true;
  }
  if (!changed) return;
  writeFileSync(file, joinDoc(merged.front, lines.join('\n')));
  await exec('git', ['add', '--', docFile], ctx.dir);
}

/** Commit-message lines that carry each replaced paragraph to the device whose words were replaced. */
const REPLACED_TRAILER = 'OpenWriter-Replaced: ';

/** Notices for this device from the commits a sync brought in: paragraphs another device's newer edit replaced. */
async function replacedNotices(dir: string, before: string, after: string): Promise<SyncNotice[]> {
  const me = (await readDevice())?.id;
  if (!me) return [];
  const log = await exec('git', ['log', '--format=%B', `${before}..${after}`], dir);
  const notices: SyncNotice[] = [];
  for (const line of log.split('\n')) {
    if (!line.startsWith(REPLACED_TRAILER)) continue;
    try {
      const r = JSON.parse(line.slice(REPLACED_TRAILER.length));
      if (r.loser !== me) continue;
      notices.push({
        id: noticeId(r), kind: 'replaced', file: r.file, docId: r.docId, title: r.title,
        device: r.device, time: new Date(r.time * 1000).toISOString(), kept: r.kept, earlier: r.earlier, anchor: r.anchor,
      });
    } catch { /* not ours to read */ }
  }
  return notices;
}

interface PullResult {
  /** Files the merge changed here, absolute paths. */
  changed: string[];
  conflicts: string[];
  /** HEAD before the merge, for notices and Undo of a deletion. */
  before: string | null;
}

/**
 * Merge the fetched GitHub branch into this side's committed work.
 *   'sync'    — the normal case, shared history.
 *   'connect' — first link of a folder with writing to a repo: histories may be unrelated.
 *   'fresh'   — first link of a folder with no writing yet: GitHub's files win outright,
 *               so the app's own starter files never shadow the writer's.
 * The merge stops before committing so every rule above runs on it; the
 * commit carries the replaced paragraphs for the device that lost them.
 */
async function mergeRemote(dir: string, mode: 'sync' | 'connect' | 'fresh'): Promise<PullResult> {
  const branch = await remoteBranch(dir);
  const before = await headSha(dir);
  if (!branch) return { changed: [], conflicts: [], before };
  const ref = `origin/${branch}`;

  let conflicts: string[] = [];
  const args = ['merge', '--no-commit', '-m', 'Sync: merge from GitHub'];
  if (mode !== 'sync') args.push('--allow-unrelated-histories');
  if (mode === 'fresh') args.push('-X', 'theirs');
  let failure: unknown = null;
  try { await gitAs([...args, ref], dir); } catch (err) { failure = err; }
  const merging = existsSync(join(dir, '.git', 'MERGE_HEAD'));
  const stages = merging ? await unmergedStages(dir) : new Map();
  // A failure with nothing to settle is a real failure: undo it and surface it.
  if (failure && stages.size === 0) {
    if (merging) { try { await exec('git', ['merge', '--abort'], dir); } catch { /* no merge in progress */ } }
    throw failure;
  }
  if (merging) {
    let base: string | null = null;
    try { base = await exec('git', ['merge-base', 'HEAD', 'MERGE_HEAD'], dir); } catch { /* unrelated histories */ }
    const ctx: MergeContext = { dir, base, replacements: [] };
    conflicts = await settleConflicts(ctx, stages);
    await settlePending(ctx, new Set(stages.keys()));
    const trailers = ctx.replacements.map((r) => REPLACED_TRAILER + JSON.stringify({
      docId: r.docId, title: r.title, file: r.file, kept: r.kept, earlier: r.earlier, anchor: r.anchor,
      device: r.device, time: r.time, loser: r.loserId,
    }));
    await gitAs(['commit', '--no-edit', '-m', ['Sync: merge from GitHub', trailers.join('\n')].filter(Boolean).join('\n\n')], dir);
  }

  const after = await headSha(dir);
  if (!after || before === after) return { changed: [], conflicts, before };
  const diff = before
    ? await exec('git', ['diff', '--name-only', '-z', before, after], dir)
    : await exec('git', ['ls-tree', '-r', '--name-only', '-z', after], dir);
  const changed = diff.split('\0').filter(Boolean).map((p) => join(dir, p));
  if (before) addNotices(dir, await replacedNotices(dir, before, after));
  return { changed, conflicts, before };
}

/**
 * Make the running server show what the merge changed. The open document,
 * deleted on another device that had not seen an edit since, closes with a
 * notice ("Deleted on Web · Undo").
 */
async function applyToServer(dir: string, changed: string[], before: string | null): Promise<void> {
  if (changed.length === 0) return;
  // An image changed elsewhere: a writing-only copy fetches the new one when next shown.
  for (const path of changed) {
    const image = /[\\/]_images[\\/]([^\\/]+)$/.exec(path)?.[1];
    if (image) { try { unlinkSync(join(dir, '.git', IMAGE_CACHE_DIR, image)); } catch { /* not cached */ } }
  }
  const srv = await getServerModules();
  const title = srv.getTitle();
  const { deletedActive } = srv.reloadChangedFiles(changed);
  if (deletedActive) {
    // Documents live at the top of the data folder: the file name is the path.
    const rel = deletedActive.split(/[/\\]/).pop() || deletedActive;
    const by = await lastDeletion(dir, before, rel);
    try {
      const result = await srv.deleteDocument(rel);
      if (result.switched && result.newDoc) srv.broadcastDocumentSwitched(result.newDoc.document, result.newDoc.title, result.newDoc.filename, undefined, 'fallback');
      if (before) addNotices(dir, [{ id: noticeId([rel, before]), kind: 'deleted', file: rel, title, device: by.device, time: new Date(by.time * 1000).toISOString(), restoreFrom: before }]);
    } catch {
      // The only document there is: keep it, written back from memory.
      srv.bumpDocVersion();
      srv.save();
      await commitAll(dir, 'Keep the only document');
    }
  }
  srv.broadcastDocumentsChanged();
  srv.broadcastWorkspacesChanged();
  srv.broadcastPendingDocsChanged();
}

/** Who deleted a file among the commits a sync brought in. */
async function lastDeletion(dir: string, before: string | null, path: string): Promise<LineInfo> {
  try {
    const out = await exec('git', ['log', '-1', '--diff-filter=D', '--format=%at%x1f%an%x1f%ae', before ? `${before}..HEAD` : 'HEAD', '--', path], dir);
    const [t, name, email] = out.split('\x1f');
    if (t) return { time: Number(t), device: name, deviceId: deviceOf(email || '') };
  } catch { /* fall through */ }
  return { time: Math.floor(Date.now() / 1000), device: 'another device', deviceId: '' };
}

/**
 * Undo what a notice reports: put the other device's paragraph back, or bring
 * back the deleted document. Saved and synced like any edit; the version Undo
 * replaces stays in history. Returns the document to open.
 */
export function undoNotice(id: string, onStatus: (status: SyncStatus) => void): Promise<{ ok: boolean; filename?: string; error?: string }> {
  return enqueue(async () => {
    const dir = await dataDir();
    const notice = readNotices(dir).find((n) => n.id === id);
    if (!notice) return { ok: false, error: 'Already undone' };
    const srv = await getServerModules();
    let file = notice.file;
    if (notice.kind === 'deleted') {
      const raw = await readAt(dir, notice.restoreFrom || 'HEAD', notice.file);
      if (raw === null) return { ok: false, error: 'That version is no longer available' };
      writeFileSync(join(dir, file), raw);
    } else {
      if (notice.docId && !existsSync(join(dir, file))) file = docPathById(dir, notice.docId) || file;
      const path = join(dir, file);
      if (!existsSync(path)) return { ok: false, error: 'The document is gone' };
      srv.cancelDebouncedSave();
      srv.save();
      const doc = splitDoc(readFileSync(path, 'utf-8'));
      const lines = doc.body.split('\n');
      const kept = notice.kept || [];
      const earlier = (notice.earlier || []).flatMap((l, i) => (i ? ['', l] : [l]));
      const start = kept.length ? lines.indexOf(kept[0]) : (notice.anchor ? lines.indexOf(notice.anchor) + 1 : 0);
      if (kept.length && start < 0) return { ok: false, error: 'That paragraph has changed since' };
      let end = start;
      for (const k of kept.slice(1)) { const at = lines.indexOf(k, end); if (at >= 0) end = at; }
      if (kept.length) lines.splice(start, end - start + 1, ...earlier);
      else lines.splice(start, 0, '', ...earlier);
      writeFileSync(path, joinDoc(doc.front, lines.join('\n')));
    }
    removeNotice(dir, id);
    srv.reloadChangedFiles([join(dir, file)]);
    await commitAll(dir, 'Undo a sync change');
    srv.broadcastDocumentsChanged();
    onStatus(await getSyncStatus());
    schedulePush(onStatus, 2000);
    return { ok: true, filename: file.split('/').pop() };
  });
}

export async function dismissNotice(id: string): Promise<void> {
  removeNotice(await dataDir(), id);
}

// ── History and rollback ────────────────────────────────────────────────────
// Every restore is a new change on top, so it can itself be undone.

export interface DocVersion { sha: string; device: string; time: string }

/** A document's saved versions on GitHub, newest first, labelled by device and time. */
export async function docHistory(docId: string): Promise<DocVersion[]> {
  if (!(await isConfigured())) return [];
  const dir = await dataDir();
  const file = docPathById(dir, docId);
  if (!file) return [];
  const out = await exec('git', ['log', '--follow', '-n', '100', '--format=%H%x1f%an%x1f%at', '--', file], dir, LOCAL_WRITE_TIMEOUT);
  return out.split('\n').filter(Boolean).map((l) => {
    const [sha, device, t] = l.split('\x1f');
    return { sha, device, time: new Date(Number(t) * 1000).toISOString() };
  });
}

/** Restore one document to a saved version: its words then, its current name and id. */
export function restoreDocVersion(docId: string, sha: string, onStatus: (status: SyncStatus) => void): Promise<{ ok: boolean; error?: string }> {
  return enqueue(async () => {
    const dir = await dataDir();
    const file = docPathById(dir, docId);
    if (!file || !/^[0-9a-f]{40}$/.test(sha)) return { ok: false, error: 'That version is not available' };
    const pathThen = (await exec('git', ['log', '--follow', '-n', '1', '--format=', '--name-only', sha, '--', file], dir)).split('\n').find(Boolean) || file;
    const raw = await readAt(dir, sha, pathThen);
    if (raw === null) return { ok: false, error: 'That version is not available' };
    const srv = await getServerModules();
    srv.cancelDebouncedSave();
    srv.save();
    const now = splitDoc(readFileSync(join(dir, file), 'utf-8'));
    const then = splitDoc(raw);
    const front = then.front ? { ...then.front, docId: now.front?.docId ?? docId, title: now.front?.title ?? then.front.title } : now.front;
    writeFileSync(join(dir, file), joinDoc(front, then.body));
    srv.reloadChangedFiles([join(dir, file)]);
    await commitAll(dir, `Restore ${now.front?.title || file}`);
    srv.broadcastDocumentsChanged();
    onStatus(await getSyncStatus());
    schedulePush(onStatus, 2000);
    return { ok: true };
  });
}

/** The last change at or before `at`, or null when there is none that old. */
async function commitAt(dir: string, at: string): Promise<string | null> {
  const time = new Date(at);
  if (Number.isNaN(time.getTime())) return null;
  const sha = await exec('git', ['rev-list', '-1', `--before=${Math.floor(time.getTime() / 1000)}`, 'HEAD'], dir);
  return sha || null;
}

/** The titles of documents that differ between `from` and now. */
async function documentsChangedSince(dir: string, from: string): Promise<string[]> {
  const out = await exec('git', ['diff', '--name-only', '-z', from, 'HEAD', '--', '*.md'], dir);
  const titles: string[] = [];
  for (const path of out.split('\0').filter(Boolean)) {
    if (!isDocPath(path)) continue;
    const raw = existsSync(join(dir, path)) ? readFileSync(join(dir, path), 'utf-8') : await readAt(dir, from, path);
    titles.push(String((raw && splitDoc(raw).front?.title) || path.replace(/\.md$/, '')));
  }
  return titles;
}

/** What "Roll back everything to <at>" would change: the documents, by title. */
export function rollbackPreview(at: string): Promise<{ ok: boolean; documents?: string[]; error?: string }> {
  return enqueue(async () => {
    if (!(await isConfigured())) return { ok: false, error: 'Sync is not set up' };
    const dir = await dataDir();
    await commitAll(dir, 'Edit');
    const from = await commitAt(dir, at);
    if (!from) return { ok: false, error: 'Nothing was saved that long ago' };
    return { ok: true, documents: await documentsChangedSince(dir, from) };
  });
}

/** Put every document back as it was at `at`, as one new change that can itself be rolled back. */
export function rollbackTo(at: string, onStatus: (status: SyncStatus) => void): Promise<{ ok: boolean; documents?: string[]; error?: string }> {
  return enqueue(async () => {
    if (!(await isConfigured())) return { ok: false, error: 'Sync is not set up' };
    const dir = await dataDir();
    const srv = await getServerModules();
    srv.cancelDebouncedSave();
    srv.save();
    await commitAll(dir, 'Edit');
    const from = await commitAt(dir, at);
    if (!from) return { ok: false, error: 'Nothing was saved that long ago' };
    const before = await headSha(dir);
    const documents = await documentsChangedSince(dir, from);
    await exec('git', ['restore', `--source=${from}`, '--staged', '--worktree', '--', ':/'], dir, LOCAL_WRITE_TIMEOUT);
    await commitAll(dir, `Roll back to ${new Date(at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`);
    const after = await headSha(dir);
    if (before && after && before !== after) {
      const changed = (await exec('git', ['diff', '--name-only', '-z', before, after], dir)).split('\0').filter(Boolean).map((p) => join(dir, p));
      await applyToServer(dir, changed, before);
    }
    onStatus(await getSyncStatus());
    schedulePush(onStatus, 2000);
    return { ok: true, documents };
  });
}

async function pushBranch(dir: string, timeout = NETWORK_TIMEOUT): Promise<void> {
  await execGitRemote(['push', '-u', 'origin', await currentBranch(dir)], dir, timeout);
}

/** Point origin at `remoteUrl`, fetch, merge GitHub in, push. Shared by every setup path. */
/** Connecting waits for any running sync, like every other git job. */
function connectRemote(remoteUrl: string): Promise<string[]> {
  return enqueue(() => connectRemoteNow(remoteUrl));
}

async function connectRemoteNow(remoteUrl: string): Promise<string[]> {
  const dir = await dataDir();
  const mode = hasWriting(dir) ? 'connect' : 'fresh';
  await initRepo();
  await initialCommit();

  try { await exec('git', ['remote', 'remove', 'origin'], dir); } catch { /* no remote */ }
  await exec('git', ['remote', 'add', 'origin', remoteUrl], dir);
  try { unlinkSync(join(dir, '.git', HANDOVER_FILE)); } catch { /* a new repo gets its own handover */ }
  const start = await headSha(dir);
  const saved = snapshotLocalOnly(dir);
  let pulled: PullResult;
  try {
    const writingOnly = process.env.OW_GITHUB_IMAGES_ON_DEMAND === '1';
    if (writingOnly) {
      await exec('git', ['config', 'remote.origin.promisor', 'true'], dir);
      await exec('git', ['config', 'remote.origin.partialclonefilter', WRITING_ONLY_FILTER], dir);
      await exec('git', ['sparse-checkout', 'set', '--no-cone', ...WRITING_ONLY_PATTERNS], dir, LOCAL_WRITE_TIMEOUT);
    }
    await execGitRemote(['fetch', ...(writingOnly ? [`--filter=${WRITING_ONLY_FILTER}`] : []), 'origin'], dir, LOCAL_WRITE_TIMEOUT);

    // Take GitHub's branch name so the push lands on the branch we merged.
    const branch = await remoteBranch(dir);
    if (branch && branch !== (await currentBranch(dir))) await exec('git', ['branch', '-M', branch], dir);

    pulled = await mergeRemote(dir, mode);
  } catch (err) {
    await undoConnect(dir, start, saved);
    throw err;
  }
  restoreLocalOnly(saved);
  const { changed, conflicts, before } = pulled;
  await applyToServer(dir, changed, before);
  await pushBranch(dir, LOCAL_WRITE_TIMEOUT);
  await handOverImages(dir).catch((err) => console.error('[GitHub Plugin] image handover paused:', err?.message || err));
  writeLastSync(dir, new Date().toISOString());
  lastConflicts = conflicts;
  lastError = undefined;
  return conflicts;
}

/**
 * A connection that stopped partway (no network, a full disk) leaves the folder as it
 * was before and unlinked from GitHub, so nothing half-brought-in can ever be pushed
 * back as deletions. The writer's own files were all committed in `start`.
 */
async function undoConnect(dir: string, start: string | null, saved: Map<string, Buffer>): Promise<void> {
  const quietly = async (args: string[]) => { try { await exec('git', args, dir, LOCAL_WRITE_TIMEOUT); } catch { /* best-effort */ } };
  let theirs: string[] = [];
  try {
    const branch = await remoteBranch(dir);
    if (branch) theirs = (await exec('git', ['ls-tree', '-r', '--name-only', '-z', `origin/${branch}`], dir, LOCAL_WRITE_TIMEOUT)).split('\0').filter(Boolean);
  } catch { /* nothing was fetched */ }
  await quietly(['merge', '--abort']);
  if (start) await quietly(['reset', '-q', '--hard', start]);
  // GitHub's files a stopped checkout left behind (never this copy's: those are tracked).
  let tracked = new Set<string>();
  try { tracked = new Set((await exec('git', ['ls-files', '-z'], dir, LOCAL_WRITE_TIMEOUT)).split('\0')); } catch { /* keep everything */ }
  for (const path of theirs) if (!tracked.has(path)) { try { unlinkSync(join(dir, path)); } catch { /* not written */ } }
  for (const folder of new Set(theirs.map((p) => dirname(p)).filter((d) => d !== '.'))) {
    try { rmdirSync(join(dir, folder)); } catch { /* holds this copy's files */ }
  }
  restoreLocalOnly(saved);
  await quietly(['remote', 'remove', 'origin']);
  await quietly(['sparse-checkout', 'disable']);
  // Free the space the download took. A writing-only download is marked as GitHub's
  // (.promisor), which gc keeps; unmarked, it goes with everything nothing points to.
  const packs = join(dir, '.git', 'objects', 'pack');
  try { for (const f of readdirSync(packs)) if (f.endsWith('.promisor')) unlinkSync(join(packs, f)); } catch { /* no packs */ }
  await quietly(['reflog', 'expire', '--expire=now', '--all']);
  await quietly(['gc', '-q', '--prune=now']);
}

/**
 * The file of an image a writing-only copy left on GitHub, fetched when it is
 * shown or published and kept in a cache of recently used ones. Null when this
 * copy is not writing-only or has no such image. Registered as core's image source.
 */
export async function writingOnlyImage(filename: string): Promise<string | null> {
  const dir = await dataDir();
  if (!(await isWritingOnly(dir))) return null;
  const cacheDir = join(dir, '.git', IMAGE_CACHE_DIR);
  const cached = join(cacheDir, filename);
  if (existsSync(cached)) {
    const now = new Date();
    try { utimesSync(cached, now, now); } catch { /* order is best-effort */ }
    return cached;
  }
  const sha = await imageBlob(dir, `_images/${filename}`);
  if (!sha) return null;
  // GitHub's copy first (it never grows .git); a file this copy made and has not pushed is in .git already.
  const bytes = (await githubBlob(dir, sha)) ?? (await gitBlob(sha, dir).catch(() => null));
  if (!bytes) return null;
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(cached, bytes);
  trimImageCache(cacheDir);
  return cached;
}

/** The blob of an image path: as it is now, else as it was before a later change deleted it. */
async function imageBlob(dir: string, path: string): Promise<string | null> {
  const blobAt = async (rev: string) => {
    try { return (await exec('git', ['--literal-pathspecs', 'ls-tree', rev, '--', path], dir)).split(/\s+/)[2] || null; } catch { return null; }
  };
  const now = await blobAt('HEAD');
  if (now) return now;
  try {
    const last = await exec('git', ['--literal-pathspecs', 'rev-list', '-1', 'HEAD', '--', path], dir);
    if (last) return await blobAt(`${last}^`);
  } catch { /* never in history */ }
  return null;
}

/** `owner/name` of origin as configured, when it is on GitHub. */
async function githubRepo(dir: string): Promise<string | null> {
  let url = '';
  try { url = await exec('git', ['config', '--get', 'remote.origin.url'], dir); } catch { return null; }
  return /github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(url)?.[1] || null;
}

/** A blob's bytes from GitHub's API, without fetching it into .git. Null when the remote is not GitHub or it fails. */
async function githubBlob(dir: string, sha: string): Promise<Buffer | null> {
  const repo = await githubRepo(dir);
  if (!repo) return null;
  const token = await readToken();
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/git/blobs/${sha}`, {
      headers: { Accept: 'application/vnd.github.raw', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
  } catch { return null; }
}

/**
 * Images another image source keeps (an online copy that moved them off its disk)
 * go into the repo once, through GitHub's Git Data API: each blob read from the
 * source and sent on its own, then a tree on top of what this copy just pushed, a
 * commit and a ref update, so nothing is written to the folder or to .git. In
 * commits of HANDOVER_BATCH, so a stop partway keeps what went up; the next sync
 * goes on until the marker in .git says done. Runs only when this copy and GitHub
 * agree (just pushed), and the copy picks the commits up on its next pull.
 */
async function handOverImages(dir: string): Promise<void> {
  const marker = join(dir, '.git', HANDOVER_FILE);
  if (existsSync(marker)) return;
  const repo = await githubRepo(dir);
  const token = await readToken();
  if (!repo || !token) return;
  const branch = await currentBranch(dir);
  const head = await headSha(dir);
  let tracking = '';
  try { tracking = await exec('git', ['rev-parse', '--verify', '-q', `refs/remotes/origin/${branch}`], dir); } catch { return; }
  if (!head || head !== tracking) return;

  const inRepo = new Set((await exec('git', ['ls-tree', '-z', '--name-only', 'HEAD', '_images/'], dir)).split('\0').filter(Boolean));
  const missing = (await (await getServerModules()).imagesHeldElsewhere()).filter((img) => !inRepo.has(`_images/${img.name}`));
  const api = async (method: string, path: string, body: unknown) => {
    const res = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`GitHub refused ${method} ${path.split('/').slice(0, 2).join('/')} (${res.status})`);
    return (await res.json()) as any;
  };
  const d = await device();
  let parent = head;
  let tree = await exec('git', ['rev-parse', 'HEAD^{tree}'], dir);
  for (let i = 0; i < missing.length; i += HANDOVER_BATCH) {
    const entries: Array<{ path: string; mode: string; type: string; sha: string }> = [];
    for (const img of missing.slice(i, i + HANDOVER_BATCH)) {
      const bytes = await img.read();
      if (!bytes) continue; // The source no longer has it.
      const blob = await api('POST', 'git/blobs', { content: bytes.toString('base64'), encoding: 'base64' });
      entries.push({ path: `_images/${img.name}`, mode: '100644', type: 'blob', sha: blob.sha });
    }
    if (!entries.length) continue;
    tree = (await api('POST', 'git/trees', { base_tree: tree, tree: entries })).sha;
    const author = { name: d.name, email: `${d.id}@device.openwriter`, date: new Date().toISOString() };
    parent = (await api('POST', 'git/commits', { message: `Add ${entries.length} image${entries.length === 1 ? '' : 's'} kept online`, tree, parents: [parent], author })).sha;
    await api('PATCH', `git/refs/heads/${branch}`, { sha: parent, force: false });
  }
  writeFileSync(marker, JSON.stringify({ at: new Date().toISOString(), images: missing.length }));
}

/** Drop the least recently shown images until the cache fits its budget. */
function trimImageCache(cacheDir: string): void {
  const files = readdirSync(cacheDir).map((name) => {
    const path = join(cacheDir, name);
    try { const s = statSync(path); return { path, size: s.size, used: s.mtimeMs }; } catch { return null; }
  }).filter((f): f is { path: string; size: number; used: number } => !!f);
  let total = files.reduce((n, f) => n + f.size, 0);
  for (const f of files.sort((a, b) => a.used - b.used)) {
    if (total <= IMAGE_CACHE_BYTES) break;
    try { unlinkSync(f.path); total -= f.size; } catch { /* in use */ }
  }
}

export async function setupWithGh(repoName: string, isPrivate: boolean): Promise<string[]> {
  const srv = await getServerModules();
  const dir = await dataDir();
  await initRepo();
  await initialCommit();

  const visibility = isPrivate ? '--private' : '--public';
  await exec('gh', ['repo', 'create', repoName, visibility, '--source=.', '--remote=origin'], dir, NETWORK_TIMEOUT);
  await exec('git', ['push', '-u', 'origin', 'main'], dir, NETWORK_TIMEOUT);
  writeLastSync(dir, new Date().toISOString());

  srv.saveConfig({
    gitConfigured: true,
    repoName,
    lastSyncTime: new Date().toISOString(),
  });
  currentSyncState = 'synced';
  lastConflicts = [];
  return [];
}

/**
 * Create a new GitHub repo with a token and sync into it. `pastedPat` is a PAT the
 * writer just typed, stored once the repo exists; otherwise the stored token is used.
 */
export async function setupWithToken(pastedPat: string | undefined, repoName: string, isPrivate: boolean): Promise<string[]> {
  const token = pastedPat || (await readToken());
  if (!token) throw new Error('Sign in with GitHub or paste a token first');
  const srv = await getServerModules();

  const res = await fetch('https://api.github.com/user/repos', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github+json',
    },
    body: JSON.stringify({ name: repoName, private: isPrivate, auto_init: false }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).message || `GitHub API error: ${res.status}`);
  }

  const repo: any = await res.json();
  if (pastedPat) await saveToken(pastedPat, 'pat');
  // MCP-3: store a credential-free remote. The token is supplied per call via
  // the credential helper (execGitRemote), never embedded in the URL.
  const conflicts = await connectRemote(`https://github.com/${repo.full_name}.git`);

  srv.saveConfig({
    gitConfigured: true,
    repoName,
    gitRemote: repo.html_url,
    lastSyncTime: new Date().toISOString(),
  });
  currentSyncState = 'synced';
  return conflicts;
}

/**
 * Connect a repo that already exists and pull everything down. A folder with
 * no writing yet takes GitHub's files as they are (the online copy's first
 * connection); a folder with writing merges, and both-sides conflicts become
 * conflict copies. Nothing here is ever overwritten.
 */
export async function connectExisting(remoteUrl: string, pat?: string): Promise<string[]> {
  const srv = await getServerModules();
  if (pat) await saveToken(pat, 'pat');

  // MCP-3: keep the remote credential-free; never splice the PAT into the URL.
  // Strip any credentials the caller may have included before storing/using it.
  const finalUrl = sanitizeRemoteUrl(remoteUrl);
  const conflicts = await connectRemote(finalUrl);

  srv.saveConfig({
    gitConfigured: true,
    gitRemote: finalUrl,
    lastSyncTime: new Date().toISOString(),
  });
  currentSyncState = 'synced';
  return conflicts;
}

/** Run one git job after the one before it: syncs and local commits never overlap. */
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job);
  queue = run.catch(() => undefined);
  return run;
}

/**
 * Two-way sync: save and commit this side, fetch, merge GitHub in, push.
 * `push: false` is a pull (the start-up catch-up); the merged result is
 * committed here and goes up with the next push.
 */
export function syncNow(onStatus: (status: SyncStatus) => void, opts: { push?: boolean } = {}): Promise<SyncStatus> {
  return enqueue(() => runSync(onStatus, opts.push !== false));
}

/** True while the writer typed in the last few seconds: no pull may change the folder under them. */
async function writerIsTyping(): Promise<boolean> {
  return (await getServerModules()).msSinceHumanEdit() < TYPING_MS;
}

/**
 * Catch up with GitHub (on open, on focus, before a document opens, every
 * minute while a browser is connected). While the writer is typing it waits
 * and says so (`deferred`), and the browser asks again after the pause.
 */
export async function pullNow(onStatus: (status: SyncStatus) => void): Promise<SyncStatus> {
  if (!(await isConfigured())) return { state: 'unconfigured' };
  if (await writerIsTyping()) return { ...(await getSyncStatus()), deferred: true };
  return syncNow(onStatus);
}

/** Commits ahead of GitHub's branch (everything, when GitHub has none yet). */
async function aheadOfGitHub(dir: string): Promise<boolean> {
  const branch = await remoteBranch(dir);
  if (!branch) return true;
  try { return Number(await exec('git', ['rev-list', '--count', `origin/${branch}..HEAD`], dir)) > 0; } catch { return true; }
}

async function runSync(onStatus: (status: SyncStatus) => void, push: boolean): Promise<SyncStatus> {
  const srv = await getServerModules();
  const dir = await dataDir();
  // A timer armed before a profile switch, or a folder that was never connected.
  if (!(await isConfigured())) return { state: 'unconfigured' };

  currentSyncState = 'syncing';
  onStatus(await getSyncStatus());

  try {
    srv.cancelDebouncedSave();
    srv.save();
    // The open doc as committed: typing that lands while the sync runs is kept on reload.
    srv.setPullBase({ docId: srv.getDocId(), document: structuredClone(srv.getDocument()) });

    await ensureGitignore();
    await ensureLocalExcludes(dir);
    await commitAll(dir, 'Edit');

    // A backlog fetch or push can carry many megabytes of images and history.
    await execGitRemote(['fetch', 'origin'], dir, LOCAL_WRITE_TIMEOUT);
    const saved = snapshotLocalOnly(dir);
    const { changed, conflicts, before } = await mergeRemote(dir, 'sync');
    restoreLocalOnly(saved);
    await applyToServer(dir, changed, before);
    srv.setPullBase(null);
    if (push && (await aheadOfGitHub(dir))) await pushBranch(dir, LOCAL_WRITE_TIMEOUT);
    await handOverImages(dir).catch((err) => console.error('[GitHub Plugin] image handover paused:', err?.message || err));

    const now = new Date().toISOString();
    writeLastSync(dir, now);
    currentSyncState = 'synced';
    lastError = undefined;
    lastConflicts = conflicts;

    const result: SyncStatus = { ...(await getSyncStatus()), lastSyncTime: now };
    onStatus(result);
    return result;
  } catch (err: any) {
    srv.setPullBase(null);
    console.error('[GitHub Plugin] sync failed:', err?.message || err);
    const { state, ...described } = describeSyncError(String(err?.message || err));
    currentSyncState = state;
    lastError = described;
    // Offline: what was saved here goes up as soon as GitHub can be reached.
    if (state === 'offline') schedulePush(onStatus, 60000);
    const result: SyncStatus = { state, ...described, lastSyncTime: await readLastSync(dir) };
    onStatus(result);
    return result;
  }
}

// ── Automatic sync ──────────────────────────────────────────────────────────
// Every save is committed here a moment later (offline too), so commit time is
// edit time. The writer's changes go to GitHub about 20 s after they stop.
// Nothing here repeats on its own: each timer is armed by a save, so a copy
// with no browser and no writing runs no timers and its machine can sleep.

let commitTimer: ReturnType<typeof setTimeout> | null = null;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let watching: { dir: string; close: () => void } | null = null;

function schedulePush(onStatus: (status: SyncStatus) => void, delay = PUSH_DELAY_MS): void {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    pushTimer = null;
    if (await writerIsTyping()) { schedulePush(onStatus, 5000); return; }
    void syncNow(onStatus);
  }, delay);
}

/** Commit what was saved, as this device. No network: works offline. */
export function commitSaved(): Promise<boolean> {
  return enqueue(async () => {
    if (!(await isConfigured())) return false;
    return commitAll(await dataDir(), 'Edit');
  });
}

/** Path parts the folder watcher ignores: git's own files and this copy's local ones. */
function ignoredChange(rel: string): boolean {
  const path = rel.replace(/\\/g, '/');
  const first = path.split('/')[0];
  return first === '.git' || first === '.versions' || first === DEVICE_FILE || first === 'server.lock' || first === CONFLICT_DIR || LOCAL_ONLY.includes(path);
}

/** A save landed in the data folder: commit it shortly, push after the pause. */
export function noteSaved(onStatus: (status: SyncStatus) => void): void {
  if (commitTimer) clearTimeout(commitTimer);
  commitTimer = setTimeout(async () => {
    commitTimer = null;
    try {
      if (await commitSaved()) {
        onStatus(await getSyncStatus());
        schedulePush(onStatus);
      }
    } catch (err: any) {
      console.error('[GitHub Plugin] commit failed:', err?.message || err);
    }
  }, COMMIT_DELAY_MS);
}

/**
 * Watch the data folder of a synced copy and commit every save. One watcher;
 * started at boot and after setup. A platform without recursive watching
 * still syncs on open, focus, every minute and on close.
 */
export async function startAutoSync(onStatus: (status: SyncStatus) => void): Promise<void> {
  if (!(await isConfigured())) return;
  const dir = await dataDir();
  if (watching?.dir === dir) return;
  watching?.close();
  try {
    const w = watch(dir, { recursive: true, persistent: false }, (_event, name) => {
      if (name && !ignoredChange(String(name))) noteSaved(onStatus);
    });
    w.on('error', (err) => console.error('[GitHub Plugin] folder watch error:', err.message));
    watching = { dir, close: () => w.close() };
  } catch (err: any) {
    console.error('[GitHub Plugin] cannot watch the data folder; syncing on open and focus only:', err?.message || err);
  }
  // Anything saved while OpenWriter was closed goes up now.
  noteSaved(onStatus);
}
