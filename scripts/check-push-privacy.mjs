#!/usr/bin/env node
// Privacy gate at the PUBLISH boundary. Wired to the pre-push hook.
// adr: adr/privacy-gate-timing.md
//
// Why this exists, and why the release-time gate is not enough: this repo is
// public, so a push IS the publication. Content committed and pushed is on
// GitHub immediately and permanently — removing it later leaves it in history
// and in every fork. A gate that runs at release can only ever confirm damage.
// This one runs before anything reaches the public record.
//
// It scans the ADDED LINES of every commit being pushed, not the final tree,
// because content added in one commit and removed in a later one still lands
// in permanent public history. That is exactly how the 2026-06-10 material
// survived its own scrub.
//
// Commits already on the remote are excluded, so existing history never
// re-triggers it. Only genuinely new content is judged.
//
// stdin (from git): <local ref> <local sha> <remote ref> <remote sha>
// argv:             <remote name> <remote url>
// exit 0 = clean, 1 = blocked.

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  GENERIC_DENY, loadPersonalDeny, isScannable, matchLine, spanAllowGlobal,
} from './privacy-patterns.mjs';

const ROOT = process.cwd();
const remoteName = process.argv[2] || 'origin';
const ZERO = /^0+$/;

function sh(cmd) {
  return execSync(cmd, { cwd: ROOT, maxBuffer: 256 * 1024 * 1024 }).toString('utf8');
}

// git feeds the ref list on stdin; fd 0 read is fine for a hook's small input.
let stdin = '';
try { stdin = readFileSync(0, 'utf8'); } catch { stdin = ''; }

const refs = stdin.split('\n').map((l) => l.trim()).filter(Boolean)
  .map((l) => l.split(/\s+/))
  .filter((p) => p.length >= 4)
  .map(([localRef, localSha, remoteRef, remoteSha]) => ({ localRef, localSha, remoteRef, remoteSha }))
  // A deletion pushes an all-zero local sha: nothing new is published.
  .filter((r) => !ZERO.test(r.localSha));

if (!refs.length) {
  console.log('push privacy gate: nothing to scan');
  process.exit(0);
}

const personalDeny = loadPersonalDeny(ROOT);
const DENYLIST = [...GENERIC_DENY, ...(personalDeny || [])];
const SPAN_G = spanAllowGlobal();

const hits = [];
let commitCount = 0;

for (const r of refs) {
  // Everything reachable from what we are pushing that the remote does not
  // already have. Covers both a new branch and an update to an existing one.
  let commits;
  try {
    commits = sh(`git rev-list ${r.localSha} --not --remotes=${remoteName}`)
      .split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    continue;
  }
  commitCount += commits.length;

  for (const sha of commits) {
    let patch;
    try {
      // First-parent diff per commit; -m expands merges so nothing hides in one.
      patch = sh(`git show ${sha} --no-color --format=%H -m --first-parent --unified=0`);
    } catch {
      continue;
    }
    let file = null;
    let scannable = false;
    for (const line of patch.split('\n')) {
      if (line.startsWith('+++ b/')) {
        file = line.slice(6).trim();
        scannable = file !== '/dev/null' && isScannable(file);
        continue;
      }
      if (!scannable) continue;
      if (!line.startsWith('+') || line.startsWith('+++')) continue;
      const added = line.slice(1);
      const re = matchLine(added, DENYLIST, SPAN_G);
      if (re) {
        hits.push(`${sha.slice(0, 9)}  ${file}  [${re}]  ${added.trim().slice(0, 90)}`);
      }
    }
  }
}

if (!personalDeny) {
  console.error('push privacy gate: WARNING — scripts/privacy-denylist.local.json not found.');
  console.error('  Personal-term checks were SKIPPED. Generic checks ran.\n');
}

if (hits.length) {
  const shown = hits.slice(0, 40);
  console.error(`\nPUSH BLOCKED — ${hits.length} privacy hit(s) in content you are about to publish:\n`);
  for (const h of shown) console.error('  ' + h);
  if (hits.length > shown.length) console.error(`  ... and ${hits.length - shown.length} more`);
  console.error('\nThis repo is public: pushing publishes permanently, and a later');
  console.error('removal still leaves the content in history and in every fork.');
  console.error('Rewrite the offending commits, then push again.');
  console.error('Genuinely a false positive? git push --no-verify\n');
  process.exit(1);
}

console.log(`push privacy gate: clean (${commitCount} new commit(s) scanned)`);
