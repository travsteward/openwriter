// Integration fixture owns an isolated home; never loads the operator's books.
import assert from 'node:assert/strict';
import os from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

const temporaryRoot = mkdtempSync(join(os.tmpdir(), 'ow-editing-draft-test-'));
os.homedir = () => temporaryRoot;
syncBuiltinESMExports();
const helpers = await import('../dist/server/helpers.js');
assert.equal(helpers.ROOT_DIR, join(temporaryRoot, '.openwriter'));
const { parseMarkdownContent } = await import('../dist/server/compact.js');
const { tiptapToMarkdown, markdownToTiptap } = await import('../dist/server/markdown.js');
const { createEditingDraft } = await import('../dist/server/manuscript/editing-draft.js');
const { applyChangesToFile, getDocId, isAgentStub } = await import('../dist/server/state.js');
const { loadDocFromDisk } = await import('../dist/server/pending-overlay.js');
const { listCommits } = await import('../dist/server/commits.js');
const { getVersionContent } = await import('../dist/server/versions.js');
const { TOOL_REGISTRY } = await import('../dist/server/mcp.js');
helpers.ensureDataDir();
helpers.ensureWorkspacesDir();
const dataDir = helpers.getDataDir();
const call = (name, args) => TOOL_REGISTRY.find(t => t.name === name).handler(args);
const writeDoc = (file, id, title, body, metadata = {}) => {
  const doc = { type: 'doc', content: parseMarkdownContent(body) };
  writeFileSync(join(dataDir, file), tiptapToMarkdown(doc, title, { title, docId: id, ...metadata }));
  return doc;
};

try {
  const first = writeDoc('one.md', '11111111', 'Source one',
    Array.from({ length: 220 }, (_, i) => `Paragraph ${i} describes a specific observation with enough detail to test bounded reading of long chapters.`).join('\n\n'));
  writeDoc('two.md', '22222222', 'Source two', 'A **final observation** closes the chapter.\n\nA footnote matters.[^1]\n\n[^1]: An independent reference.');
  const manifestBody = '## Chapter One\n\n- [First](doc:11111111)\n\n## Chapter Two\n\n- [Last](doc:22222222)';
  writeDoc('book.md', '33333333', 'The Example — Manuscript', manifestBody, { content_type: 'manuscript', autoAccept: true });
  writeFileSync(join(helpers.getWorkspacesDir(), 'fixture.json'), JSON.stringify({
    version: 2, title: 'Fixture', root: [{ type: 'container', id: '12345678', name: 'Spine', items: [{ type: 'doc', file: 'book.md', title: 'The Example — Manuscript' }] }],
  }));
  applyChangesToFile('one.md', [{ operation: 'rewrite', nodeId: first.content[0].attrs.id, content: 'UNACCEPTED REPLACEMENT' }]);
  assert.ok(loadDocFromDisk('one.md').document.content.some(n => n.attrs?.pendingStatus));
  const sourceBefore = ['one.md', 'two.md', 'book.md'].map(f => readFileSync(join(dataDir, f), 'utf8'));
  const activeBefore = getDocId();
  const draft = createEditingDraft('33333333');
  const draftPath = join(dataDir, draft.filename);
  let parsed = markdownToTiptap(readFileSync(draftPath, 'utf8'));
  assert.equal(getDocId(), activeBefore, 'copy does not steal the active document');
  assert.equal(parsed.metadata.content_type, 'document');
  assert.equal(parsed.metadata.autoAccept, false, 'original auto-accept is not inherited');
  assert.equal(parsed.metadata.editingDraft.sourceDocId, '33333333');
  assert.equal(parsed.metadata.manuscriptContext, undefined);
  assert.equal(isAgentStub(draft.filename), false);
  assert.equal(parsed.document.content.filter(n => n.attrs?.pendingStatus).length, 0, 'copied accepted prose is immediately readable');
  assert.equal(draft.chapters.length, 2);
  assert.equal(draft.chapters[0].title, 'Chapter One');
  assert.ok(!readFileSync(draftPath, 'utf8').includes('UNACCEPTED REPLACEMENT'));
  assert.ok(readFileSync(draftPath, 'utf8').includes('[^fn2-1]'), 'compiled footnotes survive');
  assert.ok(JSON.stringify(draft).length < 1500, 'creation returns identity and outline, not the book');
  assert.deepEqual(['one.md', 'two.md', 'book.md'].map(f => readFileSync(join(dataDir, f), 'utf8')), sourceBefore);
  const location = JSON.parse(readFileSync(join(helpers.getWorkspacesDir(), 'fixture.json')));
  assert.equal(location.root[0].items[1].file, draft.filename, 'copy is beside its original');
  const versions = listCommits(draft.docId);
  assert.equal(versions.length, 1, 'original copy appears in Versions');
  assert.equal(versions[0].note, 'Original manuscript copy');
  assert.ok(getVersionContent(draft.docId, versions[0].snapshotTs));
  const outline = (await call('outline_doc', { docId: draft.docId })).content[0].text;
  assert.ok(outline.includes('Chapter One') && outline.includes('Chapter Two'));
  const opening = (await call('read_pad', { docId: draft.docId })).content[0].text;
  assert.ok(!opening.includes('Paragraph 219'), 'default read does not ingest the whole chapter');
  assert.ok(opening.split(/\s+/).length < 2500, 'default read stays near the documented 2000-word cap');
  const tail = (await call('peek_doc', { docId: draft.docId, target: { around: draft.chapters[1].nodeId, after: 3 } })).content[0].text;
  assert.ok(tail.includes('final observation'));
  const paragraph = parsed.document.content.find(n => n.type === 'paragraph');
  applyChangesToFile(draft.filename, [{ operation: 'rewrite', nodeId: paragraph.attrs.id, content: 'PROPOSED EDIT TO COPY' }]);
  assert.ok(loadDocFromDisk(draft.filename).document.content.some(n => n.attrs?.pendingStatus), 'subsequent edits retain normal review');
  const restore = await call('restore_version', { docId: draft.docId, timestamp: versions[0].snapshotTs });
  assert.ok(!restore.content[0].text.startsWith('Error'), restore.content[0].text);
  assert.ok(!JSON.stringify(loadDocFromDisk(draft.filename).document).includes('PROPOSED EDIT TO COPY'));
  writeDoc('two.md', '22222222', 'Source two', 'THE SOURCE CHANGED AFTER COPYING');
  assert.ok(!readFileSync(draftPath, 'utf8').includes('THE SOURCE CHANGED AFTER COPYING'), 'edition is independent');
  const second = createEditingDraft('33333333');
  assert.notEqual(second.docId, draft.docId);
  assert.notEqual(second.title, draft.title);
  assert.throws(() => createEditingDraft('22222222'), /Choose a manuscript/);
  writeDoc('broken.md', '44444444', 'Broken', '## Missing\n\n- [Missing](doc:deadbeef)', { content_type: 'manuscript' });
  const beforeBroken = readdirSync(dataDir).filter(f => f.endsWith('.md')).length;
  assert.throws(() => createEditingDraft('44444444'), /could not be copied completely/);
  assert.equal(readdirSync(dataDir).filter(f => f.endsWith('.md')).length, beforeBroken);
  console.log('PASS: manuscript copy, source isolation, pending review, history restore, complete outline, bounded reads, independent editions, and invalid-source handling');
} finally {
  // Let scheduled fixture commits finish before removing their isolated home.
  await new Promise(resolve => setTimeout(resolve, 1800));
  assert.equal(dirname(resolve(temporaryRoot)), resolve(os.tmpdir()));
  rmSync(temporaryRoot, { recursive: true, force: true });
}
