import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// adr: adr/lockfile-sync-gate.md
//
// The lockfile must describe exactly the tree the declared dependencies imply:
// nothing declared may be absent, and nothing present may be unreachable.
//
// Absent matters because every optional platform binary — @esbuild/*, @rollup/*,
// @img/* — is declared, never depended on directly. A lockfile that dropped the
// other platforms' entries still installs here and breaks every clean install on
// macOS and Linux, with no local symptom to notice it by.
//
// Unreachable matters because npm deletes those entries the next time anything
// regenerates the lockfile. That produces a large deletion diff during an
// unrelated version bump, which reads exactly like lost platform coverage. Twice
// the release was stopped to hand-revert a prune that was correct, and the stale
// entries came straight back. Keeping the lockfile reachable-clean is what makes
// a routine bump a one-line diff again.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const lockPath = join(repoRoot, 'package-lock.json');
const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
const entries = lock.packages ?? {};

if (lock.lockfileVersion !== 3) {
  throw new Error(`package-lock.json is lockfileVersion ${lock.lockfileVersion}; this check reads version 3.`);
}

// A dependency resolves from its own folder outwards, as node itself resolves it.
function resolveFrom(fromPath, name) {
  let base = fromPath;
  for (;;) {
    const candidate = base ? `${base}/node_modules/${name}` : `node_modules/${name}`;
    if (entries[candidate]) return candidate;
    if (!base) return null;
    const cut = base.lastIndexOf('/node_modules/');
    base = cut === -1 ? '' : base.slice(0, cut);
  }
}

// The root package plus every workspace that still exists on disk, including the
// link npm puts in node_modules for each one. Nothing has to depend on a
// workspace for it to belong here. A workspace folder that was deleted or renamed
// leaves an entry behind that reaches nothing.
const onDisk = (path) => existsSync(join(repoRoot, path, 'package.json'));
const roots = [''];
for (const [path, entry] of Object.entries(entries)) {
  if (!path) continue;
  if (entry.link && entry.resolved) {
    if (onDisk(entry.resolved)) roots.push(path);
  } else if (!path.startsWith('node_modules/') && onDisk(path)) {
    roots.push(path);
  }
}

const missing = [];
const reached = new Set();
const queue = [...roots];

while (queue.length) {
  const path = queue.pop();
  if (reached.has(path)) continue;
  reached.add(path);

  const entry = entries[path];
  if (!entry) continue;

  // A workspace is linked into node_modules; its dependencies live on the target.
  if (entry.link && entry.resolved) {
    queue.push(entry.resolved);
    continue;
  }

  const peerMeta = entry.peerDependenciesMeta ?? {};
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const name of Object.keys(entry[field] ?? {})) {
      // An optional peer is an offer, not a requirement. npm drops one that is
      // present but unasked-for, so following it here would hide exactly the
      // kind of stale entry this check exists to find.
      if (field === 'peerDependencies' && peerMeta[name]?.optional) continue;

      const target = resolveFrom(path, name);
      if (target) {
        queue.push(target);
      } else if (field !== 'peerDependencies') {
        // An unmet peer is npm's business; an unmet dependency is a broken tree.
        missing.push({ from: path || '(root)', name, field });
      }
    }
  }
}

const orphans = Object.keys(entries).filter(
  (path) => path && (!reached.has(path) || entries[path].extraneous),
);

const problems = [];

if (missing.length) {
  const optional = missing.filter((m) => m.field === 'optionalDependencies');
  problems.push(
    `${missing.length} declared package${missing.length === 1 ? ' is' : 's are'} absent from package-lock.json.`,
    optional.length
      ? `  ${optional.length} of them are optional platform builds. Installing on another operating system would fail.`
      : '',
    ...missing.slice(0, 20).map((m) => `  - ${m.name}  (declared by ${m.from})`),
    missing.length > 20 ? `  ...and ${missing.length - 20} more` : '',
  );
}

if (orphans.length) {
  problems.push(
    orphans.length === 1
      ? '1 entry in package-lock.json belongs to nothing that is still declared.'
      : `${orphans.length} entries in package-lock.json belong to nothing that is still declared.`,
    '  The next command that touches the lockfile will delete them, during whatever task you were doing.',
    ...orphans.slice(0, 20).map((path) => `  - ${path}`),
    orphans.length > 20 ? `  ...and ${orphans.length - 20} more` : '',
  );
}

if (problems.length) {
  console.error('package-lock.json does not match the declared dependencies.\n');
  console.error(problems.filter(Boolean).join('\n'));
  console.error('\nTo fix: run  npm install --package-lock-only  and commit the result.');
  console.error('Read the diff before committing: entries you still need must be declared in a package.json first.');
  process.exit(1);
}

const platformEntries = Object.keys(entries).filter((p) => entries[p].os || entries[p].cpu).length;
console.log(
  `package-lock.json is in sync: ${Object.keys(entries).length - 1} packages, ` +
    `${platformEntries} platform-specific builds, no orphans.`,
);
