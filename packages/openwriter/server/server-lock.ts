/**
 * One server per profile folder. Holding the port decides which process serves
 * a port, but two servers on different ports could still serve the same
 * profile: each keeps its own in-memory copy of the live doc, autosaves it, and
 * takes the other's saves for external writes. A lock file in the profile folder
 * names the one process that may load and write it; any other process starting
 * on that profile becomes a client of it, and a running server cannot switch
 * into it. A pinned test instance (`--profile`) on its own profile is unaffected.
 * adr: adr/single-server-ownership.md
 */

import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getDataDir } from './helpers.js';

interface LockOwner { pid: number; port: number }

/** The profile folder whose lock this process holds. */
let heldDir: string | null = null;

const lockPath = (dir: string) => join(dir, 'server.lock');

function readOwner(dir: string): LockOwner | null {
  try {
    const owner = JSON.parse(readFileSync(lockPath(dir), 'utf-8'));
    return typeof owner?.pid === 'number' && typeof owner?.port === 'number' ? owner : null;
  } catch {
    return null;
  }
}

/** A live owner's process exists and its port answers (it binds the port before
 *  taking the lock, so even a server still loading answers, with 503). The port
 *  check catches a crashed owner whose pid was reused by another program. */
async function isLive(owner: LockOwner): Promise<boolean> {
  if (owner.pid === process.pid) return false;
  try { process.kill(owner.pid, 0); } catch (err: any) { if (err?.code !== 'EPERM') return false; }
  try {
    await fetch(`http://127.0.0.1:${owner.port}/api/status`, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

function tryCreate(dir: string, port: number): boolean {
  try {
    writeFileSync(lockPath(dir), JSON.stringify({ pid: process.pid, port }), { flag: 'wx' });
    return true;
  } catch (err: any) {
    if (err?.code === 'EEXIST') return false;
    throw err;
  }
}

/** Take the lock on a profile folder (default: the active one) for this process
 *  serving `port`. Returns null when taken, or the live owner to defer to. A lock
 *  whose process is gone is stale and taken over. Taking a new folder's lock does
 *  not release the old one; call releaseDataLock for that once the switch is done. */
export async function claimDataLock(port: number, dir = getDataDir()): Promise<LockOwner | null> {
  if (dir === heldDir) return null;
  mkdirSync(dir, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    if (tryCreate(dir, port)) {
      if (heldDir === null) process.on('exit', () => { if (heldDir) releaseDataLock(heldDir); });
      heldDir = dir;
      return null;
    }
    const owner = readOwner(dir);
    if (owner && await isLive(owner)) return owner;
    // Stale (its process is gone) or unreadable: remove it and try once more.
    try { unlinkSync(lockPath(dir)); } catch { /* another process removed it first */ }
  }
  // Lost a takeover race: whoever won holds it now.
  return readOwner(dir) ?? { pid: -1, port };
}

/** Remove a profile folder's lock if this process holds it. */
export function releaseDataLock(dir: string): void {
  if (heldDir === dir) heldDir = null;
  if (readOwner(dir)?.pid !== process.pid) return;
  try { unlinkSync(lockPath(dir)); } catch { /* already gone */ }
}
