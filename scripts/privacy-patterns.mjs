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

import { readFileSync, existsSync } from 'node:fs';
import { join, sep } from 'node:path';

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

// Personal terms from the gitignored local file (array of regex sources).
// Returns null when the file is absent so callers can warn loudly.
export function loadPersonalDeny(root) {
  const p = join(root, 'scripts', 'privacy-denylist.local.json');
  if (!existsSync(p)) return null;
  let list;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8'));
    list = Array.isArray(raw) ? raw : raw.patterns;
  } catch (e) {
    console.error(`privacy gate: could not parse scripts/privacy-denylist.local.json — ${e.message}`);
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
  return list.map((s) => new RegExp(s, 'i'));
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
