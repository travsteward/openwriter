#!/usr/bin/env node
// Privacy gate for the WHOLE public repo. Blocks publish/release when personal
// content from the operator's local work leaks into any tracked file — not just
// bundled skills, but test fixtures, corpora, changelog, code comments, etc.
// Run: node scripts/check-skill-privacy.mjs   (exit 0 = clean, 1 = hits)
//
// Convention (CLAUDE.md § Bundled-skill hygiene): worked examples are ALWAYS
// fictional (the sleep book, RecipeBox). The operator's live work — book prose,
// chapter/beat names, venture names, identity — never ships, even as a sample.
//
// Two-tier denylist:
//   - GENERIC patterns (below) are safe to list publicly (emails, home paths,
//     API keys). They reveal nothing by being named.
//   - PERSONAL terms (venture names, book vocab, family) live in a GITIGNORED
//     local file — scripts/privacy-denylist.local.json — so this public scanner
//     never enumerates them. Without that file, personal-term checks are skipped
//     with a loud warning (the operator's publish machine must have it).

import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, sep } from 'node:path';

const ROOT = process.cwd();
const EXTENSIONS = ['.md', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.json', '.txt', '.html', '.css', '.ps1'];

// The privacy machinery itself legitimately contains the terms we hunt for.
const SKIP_FILES = new Set([
  join('scripts', 'check-skill-privacy.mjs'),
  join('scripts', 'privacy-denylist.local.json'),
]);

// Scan only TRACKED files — that is exactly the public/shippable surface.
// git ls-files excludes everything gitignored (.claude/, dist/, node_modules/,
// the local denylist, the operator's notes) for free.
function trackedFiles() {
  const out = execSync('git ls-files -z', { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
  return out.toString('utf8').split('\0').filter(Boolean);
}

// Generic personal-info patterns — safe to list publicly.
// LINE_ALLOW: whole line is legitimate (the operator's intentional public
// authorship) — skip it entirely.
const LINE_ALLOW = [
  /copyright \(c\) [0-9]{4}/, /"author":\s*"/, /\[mit\]\(license\)/, /^mit license/,
];
// SPAN_ALLOW: narrow legit tokens (public handle, generic example path/email).
// These are STRIPPED from the line before the denylist runs, so they can't
// shield a denylisted term that happens to share the line.
const SPAN_ALLOW = [
  /travsteward/, /c:[\\/]users[\\/]me\b/, /av_api_key/, /user@example/, /name@example/,
  // Operational namespaces and actual CLI invocations are dependencies, not
  // personal worked examples. Only the tool token is stripped; arguments and
  // the rest of each line still pass every generic/personal check.
  /\.greprag\//i,
  /\bgreprag\b(?=\s+(?:delivery|merge-lock|deploy-gate|deploy-lock|deploy-record|deploy-verify)\b)/i,
  /\bgreprag\b(?=\s+-Arguments\b)/i,
];
const GENERIC_DENY = [
  /@gmail\.com/, /@outlook\.com/, /@icloud\.com/, /@proton(mail)?\.(com|me)/,
  /c:\\users\\(?!me\b)[a-z0-9._-]+/i, /c:\/users\/(?!me\b)[a-z0-9._-]+/i,
  /\/home\/(?!user\b|me\b)[a-z0-9._-]+/i,
  /sk-[a-z0-9]{20,}/, /api[_-]?key\s*[:=]\s*['"][a-z0-9]/,
];

// Personal terms loaded from the gitignored local file (array of regex sources).
function loadPersonalDeny() {
  const p = join(ROOT, 'scripts', 'privacy-denylist.local.json');
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8'));
    const list = Array.isArray(raw) ? raw : raw.patterns;
    return list.map((s) => new RegExp(s, 'i'));
  } catch (e) {
    console.error(`privacy gate: could not parse scripts/privacy-denylist.local.json — ${e.message}`);
    process.exit(2);
  }
}

const personalDeny = loadPersonalDeny();
const DENYLIST = [...GENERIC_DENY, ...(personalDeny || [])];
const hits = [];

const SPAN_ALLOW_G = SPAN_ALLOW.map((re) => new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'));

function scan(relPath) {
  const norm = relPath.split('/').join(sep);
  if (SKIP_FILES.has(norm)) return;
  if (!EXTENSIONS.some((e) => relPath.endsWith(e))) return;
  let lines;
  try { lines = readFileSync(join(ROOT, norm), 'utf8').split('\n'); }
  catch { return; }
  lines.forEach((line, i) => {
    const raw = line.toLowerCase();
    if (LINE_ALLOW.some((re) => re.test(raw))) return; // legit byline — whole line ok
    // Strip narrow legit tokens so they can't shield a denylisted term sharing the line.
    let lower = raw;
    for (const re of SPAN_ALLOW_G) lower = lower.replace(re, ' ');
    for (const re of DENYLIST) {
      if (re.test(lower)) {
        hits.push(`${relPath}:${i + 1}  [${re}]  ${line.trim().slice(0, 100)}`);
        break;
      }
    }
  });
}

for (const f of trackedFiles()) scan(f);

if (!personalDeny) {
  console.error('privacy gate: WARNING — scripts/privacy-denylist.local.json not found.');
  console.error('  Personal-term checks (venture/book/family vocab) were SKIPPED.');
  console.error('  The operator\'s publish machine MUST have this file. Generic checks ran.\n');
}

if (hits.length) {
  console.error(`PRIVACY GATE FAILED — ${hits.length} hit(s):\n`);
  for (const h of hits) console.error('  ' + h);
  console.error('\nGenericize these before publishing (fictional examples only).');
  process.exit(1);
}
console.log(`privacy gate: clean${personalDeny ? '' : ' (generic only — local denylist missing)'}`);
