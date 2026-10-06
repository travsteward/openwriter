#!/usr/bin/env node
// Builds claude-plugin/, the folder Anthropic's plugin directory installs.
//
// The directory installs only the plugin folder, so the skill and agents have to
// be real copies inside it, not links. Copies drift, so every copy is generated
// here from its one source and `--check` (run by npm test) fails when the
// committed folder no longer matches. README.md is the only hand-written file.
//
// The MCP server runs the npm release pinned to this repo's version, because the
// directory blocks unpinned launchers. A version bump therefore needs a rebuild.
//
// Run:   node scripts/build-claude-plugin.mjs           (write)
//        node scripts/build-claude-plugin.mjs --check   (exit 1 on drift)

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'claude-plugin');
const SKILL = join(ROOT, 'skills', 'openwriter');
const HAND_WRITTEN = new Set(['README.md']);

// Same public-safe allowlist the npm package ships (packages/openwriter/scripts/prepublish.cjs).
const SKILL_DOCS = ['welcome.md', 'setup.md', 'enrichment.md', 'footnotes.md', 'harness-claude.md', 'harness-codex.md'];

const pkg = JSON.parse(readFileSync(join(ROOT, 'packages', 'openwriter', 'package.json'), 'utf8'));
const read = (path) => readFileSync(path, 'utf8');
const json = (value) => JSON.stringify(value, null, 2) + '\n';

const files = new Map();

// The directory listing's logo: the editor's own app icon.
files.set('logo.png', readFileSync(join(ROOT, 'packages', 'openwriter', 'public', 'icon-512.png')));

files.set('.claude-plugin/plugin.json', json({
  name: 'openwriter',
  displayName: 'OpenWriter',
  version: pkg.version,
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
    openwriter: { command: 'npx', args: ['-y', `openwriter@${pkg.version}`, '--no-open'] },
  },
}));

files.set('LICENSE', read(join(ROOT, 'LICENSE')));
files.set('skills/openwriter/SKILL.md', read(join(SKILL, 'SKILL.md')));
for (const doc of SKILL_DOCS) {
  files.set(`skills/openwriter/docs/${doc}`, read(join(SKILL, 'docs', doc)));
}

// A plugin's MCP tools are namespaced by plugin, so an agent's tool allowlist
// written for a user-scope server would grant nothing here.
for (const agent of readdirSync(join(SKILL, 'agents')).filter((f) => f.endsWith('.md'))) {
  files.set(`agents/${agent}`, read(join(SKILL, 'agents', agent)).replaceAll('mcp__openwriter__', 'mcp__plugin_openwriter_openwriter__'));
}

function listOnDisk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? listOnDisk(path) : [relative(OUT, path).replaceAll('\\', '/')];
  });
}

const onDisk = listOnDisk(OUT).filter((path) => !HAND_WRITTEN.has(path));
const stale = onDisk.filter((path) => !files.has(path));
const changed = [...files]
  .filter(([path, body]) => !existsSync(join(OUT, path)) || !readFileSync(join(OUT, path)).equals(Buffer.from(body)))
  .map(([path]) => path);

if (process.argv.includes('--check')) {
  if (stale.length || changed.length) {
    console.error('claude-plugin/ is out of date with its sources.');
    for (const path of changed) console.error(`  - differs: ${path}`);
    for (const path of stale) console.error(`  - no source: ${path}`);
    console.error('\nTo fix: run  node scripts/build-claude-plugin.mjs  and commit the result.');
    process.exit(1);
  }
  console.log(`claude-plugin/ is in sync (openwriter@${pkg.version}, ${files.size} generated files).`);
} else {
  for (const path of stale) rmSync(join(OUT, path));
  for (const path of changed) {
    mkdirSync(dirname(join(OUT, path)), { recursive: true });
    writeFileSync(join(OUT, path), files.get(path));
  }
  console.log(`claude-plugin/ built for openwriter@${pkg.version}: ${changed.length} written, ${stale.length} removed.`);
}
