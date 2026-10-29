#!/usr/bin/env node
// Builds claude-plugin/, the folder Anthropic's plugin directory installs.
//
// The directory installs only the plugin folder, so the agents have to be real
// copies inside it, not links. There is no skill: the tools and the guidance
// that arrives with each document carry it (adr/in-system-guidance.md).
// Copies drift, so every copy is generated here from its one source and `--check` (run by npm test) fails when the
// committed folder no longer matches. README.md is the only hand-written file.
//
// The MCP server runs a pinned npm release, because the directory blocks
// unpinned launchers, and package.json + package-lock.json beside .mcp.json
// record that release's exact dependencies and hashes, which the directory
// asks for. The lockfile can only be made once the release is on npm, so the
// plugin pins the newest *published* release: write mode pins this repo's
// version and is run after each publish (.greprag/release.md); --check
// verifies the folder against the pin it already has.
//
// Run:   node scripts/build-claude-plugin.mjs           (write; needs the version on npm)
//        node scripts/build-claude-plugin.mjs --check   (exit 1 on drift)

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'claude-plugin');
const AGENTS = join(ROOT, 'packages', 'openwriter', 'agents');
const HAND_WRITTEN = new Set(['README.md']);
// Written by npm, not compared byte for byte: --check verifies the release it pins.
const LOCK = 'package-lock.json';
const CHECK = process.argv.includes('--check');

const pkg = JSON.parse(readFileSync(join(ROOT, 'packages', 'openwriter', 'package.json'), 'utf8'));
const read = (path) => readFileSync(path, 'utf8');
const json = (value) => JSON.stringify(value, null, 2) + '\n';
const readJson = (path) => { try { return JSON.parse(read(path)); } catch { return null; } };

// The release the plugin runs: this repo's version when writing, the committed pin when checking.
const pin = CHECK ? (readJson(join(OUT, 'package.json'))?.dependencies?.openwriter ?? pkg.version) : pkg.version;

const files = new Map();

// The directory listing's logo: the editor's own app icon.
files.set('logo.png', readFileSync(join(ROOT, 'packages', 'openwriter', 'public', 'icon-512.png')));

files.set('.claude-plugin/plugin.json', json({
  name: 'openwriter',
  displayName: 'OpenWriter',
  version: pin,
  description:
    'A local markdown editor your agent writes in. Claude drafts and edits documents through MCP tools, ' +
    'and you accept or reject each change in your browser. Plain .md files on your disk.',
  // The publisher is the project: the privacy gate keeps personal names out of published files.
  author: { name: 'OpenWriter', url: pkg.homepage },
  homepage: pkg.homepage,
  repository: pkg.homepage,
  license: pkg.license,
  icon: './logo.png',
  keywords: ['writing', 'editor', 'markdown', 'documents', 'review'],
}));

files.set('.mcp.json', json({
  mcpServers: {
    openwriter: { command: 'npx', args: ['-y', `openwriter@${pin}`, '--no-open'] },
  },
}));

files.set('package.json', json({
  name: 'openwriter-claude-plugin',
  private: true,
  description: 'The OpenWriter release this plugin runs; package-lock.json records its exact dependencies.',
  dependencies: { openwriter: pin },
}));

files.set('LICENSE', read(join(ROOT, 'LICENSE')));

// A plugin's MCP tools are namespaced by plugin, so an agent's tool allowlist
// written for a user-scope server would grant nothing here.
for (const agent of readdirSync(AGENTS).filter((f) => f.endsWith('.md'))) {
  files.set(`agents/${agent}`, read(join(AGENTS, agent)).replaceAll('mcp__openwriter__', 'mcp__plugin_openwriter_openwriter__'));
}

function listOnDisk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? listOnDisk(path) : [relative(OUT, path).replaceAll('\\', '/')];
  });
}

const onDisk = listOnDisk(OUT).filter((path) => !HAND_WRITTEN.has(path) && path !== LOCK);
const stale = onDisk.filter((path) => !files.has(path));
const changed = [...files]
  .filter(([path, body]) => !existsSync(join(OUT, path)) || !readFileSync(join(OUT, path)).equals(Buffer.from(body)))
  .map(([path]) => path);

/** The release the committed lockfile pins, or null when there is none or it disagrees with itself. */
function lockedRelease() {
  const lock = readJson(join(OUT, LOCK));
  const root = lock?.packages?.['']?.dependencies?.openwriter;
  const installed = lock?.packages?.['node_modules/openwriter']?.version;
  return root && root === installed ? installed : null;
}

if (CHECK) {
  const locked = lockedRelease();
  if (stale.length || changed.length || locked !== pin) {
    console.error('claude-plugin/ is out of date with its sources.');
    for (const path of changed) console.error(`  - differs: ${path}`);
    for (const path of stale) console.error(`  - no source: ${path}`);
    if (locked !== pin) console.error(`  - ${LOCK} pins ${locked ?? 'nothing'}, not openwriter@${pin}`);
    console.error('\nTo fix: run  node scripts/build-claude-plugin.mjs  (after the release is on npm) and commit the result.');
    process.exit(1);
  }
  console.log(`claude-plugin/ is in sync (openwriter@${pin}, ${files.size} generated files and its lockfile).`);
} else {
  for (const path of stale) rmSync(join(OUT, path));
  for (const path of changed) {
    mkdirSync(dirname(join(OUT, path)), { recursive: true });
    writeFileSync(join(OUT, path), files.get(path));
  }
  // npm resolves the pinned release from the registry, in a scratch folder so nothing is installed here.
  if (lockedRelease() !== pin) {
    const scratch = mkdtempSync(join(tmpdir(), 'openwriter-plugin-lock-'));
    try {
      writeFileSync(join(scratch, 'package.json'), files.get('package.json'));
      execSync('npm install --package-lock-only --ignore-scripts --no-audit --no-fund', { cwd: scratch, stdio: 'inherit' });
      writeFileSync(join(OUT, LOCK), read(join(scratch, LOCK)));
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
  console.log(`claude-plugin/ built for openwriter@${pin}: ${changed.length} written, ${stale.length} removed, ${LOCK} pins ${lockedRelease()}.`);
}
