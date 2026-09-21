// Shared matching rules for every privacy gate in this repo.
// adr: adr/privacy-gate-timing.md
//
// ONE definition, imported by both gates. The 2026-06-10 leak recurred partly
// because a rule lived in one place and the thing that needed it lived in
// another; a second copy of this list would recreate that failure.
//
// Consumers:
//   scripts/check-skill-privacy.mjs — the whole tracked tree (release/publish)
//   scripts/check-push-privacy.mjs  — content entering the public record (pre-push)
//
// Two-tier denylist:
//   - GENERIC patterns are safe to name publicly (emails, home paths, API keys).
//     They reveal nothing by being listed.
//   - PERSONAL terms (venture names, book vocab, family) live in a GITIGNORED
//     local file — scripts/privacy-denylist.local.json — so this public file
//     never enumerates them. An earlier version of the scanner DID list them
//     inline, which put the operator's private vocabulary in public history.
//     Never move those terms back into a tracked file.
//
// Because the file is gitignored, a git WORKTREE does not have it: a worktree
// checks out tracked files only. The gates used to warn and pass in that case,
// which disabled personal-term checking for exactly the commits most likely to
// be machine-authored. They now look in the main checkout (worktrees share one
// .git, so its location is derivable) and REFUSE when no rules can be found.

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';

export const EXTENSIONS = [
  '.md', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.json', '.txt', '.html', '.css', '.ps1',
];

// The privacy machinery itself legitimately contains the terms we hunt for.
export const SKIP_FILES = new Set([
  join('scripts', 'check-skill-privacy.mjs'),
  join('scripts', 'check-push-privacy.mjs'),
  join('scripts', 'privacy-patterns.mjs'),
  join('scripts', 'privacy-denylist.local.json'),
]);

// LINE_ALLOW: the whole line is legitimate (intentional public authorship).
export const LINE_ALLOW = [
  /copyright \(c\) [0-9]{4}/, /"author":\s*"/, /\[mit\]\(license\)/, /^mit license/,
];

// SPAN_ALLOW: narrow legit tokens. STRIPPED from the line before the denylist
// runs, so they cannot shield a denylisted term that shares the line.
export const SPAN_ALLOW = [
  /travsteward/, /c:[\\/]users[\\/]me\b/, /av_api_key/, /user@example/, /name@example/,
  // Operational namespaces and actual CLI invocations are dependencies, not
  // personal worked examples. Only the tool token is stripped; arguments and
  // the rest of each line still pass every generic/personal check.
  /\.greprag\//i,
  /\bgreprag\b(?=\s+(?:delivery|merge-lock|deploy-gate|deploy-lock|deploy-record|deploy-verify)\b)/i,
  /\bgreprag\b(?=\s+-Arguments\b)/i,
];

export const GENERIC_DENY = [
  /@gmail\.com/, /@outlook\.com/, /@icloud\.com/, /@proton(mail)?\.(com|me)/,
  /c:\\users\\(?!me\b)[a-z0-9._-]+/i, /c:\/users\/(?!me\b)[a-z0-9._-]+/i,
  /\/home\/(?!user\b|me\b)[a-z0-9._-]+/i,
  /sk-[a-z0-9]{20,}/, /api[_-]?key\s*[:=]\s*['"][a-z0-9]/,
];

const DENYLIST_REL = join('scripts', 'privacy-denylist.local.json');

// A worktree shares one .git with the checkout that created it, so the main
// checkout's working directory is derivable from inside any worktree. Sourcing
// the one file beats copying it: a copy drifts, and a stale denylist is the
// same silent failure in slower motion.
function mainCheckoutDenylist(root) {
  let common;
  try {
    common = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
  if (!common) return null;
  const gitDir = isAbsolute(common) ? common : resolve(root, common);
  const candidate = join(dirname(gitDir), DENYLIST_REL);
  return existsSync(candidate) ? candidate : null;
}

// Where the personal denylist may come from, in order. Returns the resolved
// path and everything that was tried, so a refusal can say what it looked for.
export function resolveDenylistPath(root) {
  const tried = [];
  const env = process.env.OPENWRITER_PRIVACY_DENYLIST;
  if (env) {
    tried.push(`${env}  (OPENWRITER_PRIVACY_DENYLIST)`);
    if (existsSync(env)) return { path: env, origin: 'env', tried };
  }
  const local = join(root, DENYLIST_REL);
  tried.push(`${local}  (this checkout)`);
  if (existsSync(local)) return { path: local, origin: 'checkout', tried };

  const main = mainCheckoutDenylist(root);
  tried.push(main
    ? `${main}  (main checkout, shared via .git)`
    : '<main checkout>/scripts/privacy-denylist.local.json  (not found)');
  if (main) return { path: main, origin: 'main-checkout', tried };

  return { path: null, origin: null, tried };
}

// Personal terms from the gitignored local file (array of regex sources).
// REFUSES when no rules can be obtained: a check that cannot read its rules has
// not checked anything, and reporting that as clean is how a worktree push
// published personal vocabulary with the gate reporting success.
export function loadPersonalDeny(root) {
  const { path: p, origin, tried } = resolveDenylistPath(root);
  if (!p) {
    if (process.env.OPENWRITER_PRIVACY_NO_DENYLIST === '1') {
      console.error('privacy gate: running GENERIC CHECKS ONLY — no personal denylist, acknowledged');
      console.error('  via OPENWRITER_PRIVACY_NO_DENYLIST=1. Personal-term checking is OFF.\n');
      return { patterns: [], source: null };
    }
    console.error('privacy gate: REFUSING — no personal denylist could be read, so');
    console.error('  personal-term checking cannot run. Looked in:');
    for (const t of tried) console.error(`    ${t}`);
    console.error('');
    console.error('  In a worktree this normally resolves from the main checkout. If the');
    console.error('  main checkout has no denylist either, restore it, or point');
    console.error('  OPENWRITER_PRIVACY_DENYLIST at it.');
    console.error('  Working on a clone that legitimately has no personal terms to hide?');
    console.error('  Set OPENWRITER_PRIVACY_NO_DENYLIST=1 to run generic checks only.\n');
    process.exit(2);
  }
  let list;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8'));
    list = Array.isArray(raw) ? raw : raw.patterns;
  } catch (e) {
    console.error(`privacy gate: could not parse ${p} — ${e.message}`);
    process.exit(2);
  }
  if (!Array.isArray(list)) {
    console.error(`privacy gate: ${p} holds no pattern array, so no rules could be read.`);
    process.exit(2);
  }
  // A JSON "\b" decodes to a literal backspace rather than a word boundary, so
  // such an entry silently never matches. Fail loudly instead of running blind.
  const broken = list.filter((s) => {
    for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) < 32) return true;
    return false;
  });
  if (broken.length) {
    console.error(`privacy gate: ${broken.length} denylist pattern(s) contain a control character and can never match.`);
    console.error('  A JSON "\\b" must be written "\\\\b" to mean a word boundary. Fix the local denylist.');
    process.exit(2);
  }
  // The path is reported; the terms never are.
  return { patterns: list.map((s) => new RegExp(s, 'i')), source: p, origin };
}

export function isScannable(relPath) {
  if (SKIP_FILES.has(relPath.split('/').join(sep))) return false;
  return EXTENSIONS.some((e) => relPath.endsWith(e));
}

// Returns the matching pattern for a line, or null. `denylist` is the combined
// generic + personal list.
export function matchLine(line, denylist, spanAllowGlobal) {
  const raw = line.toLowerCase();
  if (LINE_ALLOW.some((re) => re.test(raw))) return null;
  let lower = raw;
  for (const re of spanAllowGlobal) lower = lower.replace(re, ' ');
  for (const re of denylist) if (re.test(lower)) return re;
  return null;
}

export function spanAllowGlobal() {
  return SPAN_ALLOW.map((re) => new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'));
}
