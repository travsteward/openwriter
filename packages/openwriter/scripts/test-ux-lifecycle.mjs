// Regression coverage for archive placement and independent reading.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { once } from 'node:events';
import express from 'express';
import { setActiveProfile, getDataDir, getWorkspacesDir, ensureDataDir } from '../dist/server/helpers.js';
import { setActiveDocument, clearAllCaches } from '../dist/server/state.js';
import { markdownToTiptap } from '../dist/server/markdown.js';
import { archiveDocument, unarchiveDocument, getActiveFilename } from '../dist/server/documents.js';
import { getWorkspace } from '../dist/server/workspaces.js';
import { findContainer, findDocNode } from '../dist/server/workspace-tree.js';
import { createReadingRouter } from '../dist/server/reading-routes.js';

const profile = `test-ux-lifecycle-${Date.now()}`;
setActiveProfile(profile);
ensureDataDir();
mkdirSync(getWorkspacesDir(), { recursive: true });
const dir = getDataDir();
assert.equal(resolve(dir), resolve(join(homedir(), '.openwriter', 'profiles', profile)));
let server;
try {
  const seed = (name, id, body) => writeFileSync(join(dir, `${name}.md`), `---\ntitle: ${name}\ndocId: "${id}"\n---\n\n${body}\n`);
  seed('Alpha', 'cc000001', '# Alpha\n\nFirst document.\n\n[Beta](doc:cc000002)');
  seed('Beta', 'cc000002', '# Beta\n\nSecond document.');
  seed('Gamma', 'cc000003', '# Gamma\n\nThird document.');
  const doc = name => ({ type: 'doc', file: `${name}.md`, title: name });
  const original = { version: 2, title: 'Garden', root: [
    { ...doc('Alpha'), children: [{ type: 'container', id: 'research', name: 'Research', items: [doc('Gamma'), doc('Beta')] }] },
  ] };
  const manifest = join(getWorkspacesDir(), 'Garden.json');
  writeFileSync(manifest, JSON.stringify(original));
  const alpha = markdownToTiptap(readFileSync(join(dir, 'Alpha.md'), 'utf8'));
  setActiveDocument(alpha.document, alpha.title, join(dir, 'Alpha.md'), false, new Date(), alpha.metadata);

  archiveDocument('Beta.md');
  assert.equal(findDocNode(getWorkspace('Garden.json').root, 'Beta.md'), null);
  archiveDocument('Beta.md');
  unarchiveDocument('Beta.md');
  assert.deepEqual(getWorkspace('Garden.json').root, original.root, 'nested position and document child containers survive repeated archive');
  unarchiveDocument('Beta.md');
  assert.deepEqual(getWorkspace('Garden.json').root, original.root, 'repeated restore is idempotent');

  archiveDocument('Beta.md');
  const renamed = getWorkspace('Garden.json');
  findContainer(renamed.root, 'research').node.name = 'Renamed research';
  writeFileSync(manifest, JSON.stringify(renamed));
  unarchiveDocument('Beta.md');
  assert.equal(findDocNode(getWorkspace('Garden.json').root, 'Beta.md').parent.id, 'research', 'stable container identity survives rename');

  archiveDocument('Beta.md');
  const removed = getWorkspace('Garden.json');
  removed.root[0].children = [];
  writeFileSync(manifest, JSON.stringify(removed));
  assert.ok(unarchiveDocument('Beta.md').locationWarning, 'missing container is reported');
  assert.ok(getWorkspace('Garden.json').root.some(n => n.type === 'doc' && n.file === 'Beta.md'), 'missing container falls back to workspace root');

  const app = express();
  app.use(createReadingRouter());
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const before = ['Alpha', 'Beta', 'Gamma'].map(n => readFileSync(join(dir, `${n}.md`), 'utf8'));
  const active = getActiveFilename();
  const beta = await fetch(`${base}/read/cc000002`);
  assert.equal(beta.status, 200);
  assert.match(await beta.text(), /Second document/);
  assert.match(await (await fetch(`${base}/read/cc000001`)).text(), /href="\/read\/cc000002"/, 'document links stay in reading view');
  assert.equal((await fetch(`${base}/read/ffffffff`)).status, 404);
  assert.equal(getActiveFilename(), active, 'independent reads do not navigate the shared editor');
  assert.deepEqual(['Alpha', 'Beta', 'Gamma'].map(n => readFileSync(join(dir, `${n}.md`), 'utf8')), before, 'independent reads do not write files');
  console.log('PASS: archive restoration, nesting, idempotence, missing destinations, independent reading, and file integrity');
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  clearAllCaches();
  rmSync(dir, { recursive: true, force: true });
}
