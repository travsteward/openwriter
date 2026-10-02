// Books: an outline plus the manuscript built from it. Isolated home; never
// loads the operator's books. adr: adr/manuscript-engine.md
import assert from 'node:assert/strict';
import os from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, unlinkSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

const temporaryRoot = mkdtempSync(join(os.tmpdir(), 'ow-book-test-'));
os.homedir = () => temporaryRoot;
syncBuiltinESMExports();
const helpers = await import('../dist/server/helpers.js');
assert.equal(helpers.ROOT_DIR, join(temporaryRoot, '.openwriter'));
const { parseMarkdownContent } = await import('../dist/server/compact.js');
const { tiptapToMarkdown, markdownToTiptap } = await import('../dist/server/markdown.js');
const { createRevision } = await import('../dist/server/document-revisions.js');
const { getDocument, save, applyChangesToFile, invalidateDocCache } = await import('../dist/server/state.js');
const { switchDocument, batchResolve } = await import('../dist/server/documents.js');
const { readFrontmatter, writeFrontmatter } = await import('../dist/server/backlinks.js');
const { loadDocFromDisk, deleteOverlay } = await import('../dist/server/pending-overlay.js');
const { listCommits } = await import('../dist/server/commits.js');
const { getVersionContent, pruneVersions } = await import('../dist/server/versions.js');
const { compileManuscript } = await import('../dist/server/manuscript/index.js');
const { loadManifest } = await import('../dist/server/manuscript/load.js');
const book = await import('../dist/server/manuscript/book.js');
const { TOOL_REGISTRY } = await import('../dist/server/mcp.js');
helpers.ensureDataDir();
helpers.ensureWorkspacesDir();
const dataDir = helpers.getDataDir();
const call = async (name, args) => (await TOOL_REGISTRY.find(t => t.name === name).handler(args)).content[0].text;
const writeDoc = (file, id, title, body, metadata = {}) => {
  const doc = { type: 'doc', content: parseMarkdownContent(body) };
  writeFileSync(join(dataDir, file), tiptapToMarkdown(doc, title, { title, docId: id, ...metadata }));
};
const read = (file) => markdownToTiptap(readFileSync(join(dataDir, file), 'utf8'));
const body = (file) => readFileSync(join(dataDir, file), 'utf8').replace(/^---[\s\S]*?\n---\n/, '');
const pendingNodes = (file) => loadDocFromDisk(file).document.content.filter(n => n.attrs?.pendingStatus);
const states = (docId) => Object.fromEntries(book.bookStatus(docId).chapters.map(c => [c.heading, c.state]));

try {
  writeDoc('b1.md', '11111111', 'Beat one', 'Chapter one opens here.\n\nIt keeps going.');
  writeDoc('b2.md', '22222222', 'Beat two', 'Chapter two has a list:\n\n- first point\n- second point');
  writeDoc('b3.md', '33333333', 'Beat three', 'Chapter three closes the book.');
  writeDoc('b4.md', '44444444', 'Beat four', 'A middle chapter arrives late.\n\n- with a list\n- of two points\n\nAnd a closing line.');
  writeDoc('b5.md', '55555555', 'Beat five', 'A cited claim.[^1]\n\n[^1]: A source.');
  const outlineBody = (extra = '') => `## Chapter One\n\n- [One](doc:11111111)\n\n${extra}## Chapter Two\n\n- [Two](doc:22222222)\n`;
  writeDoc('outline.md', 'aaaaaaaa', 'The Example — Outline', outlineBody(), {
    content_type: 'manuscript', manuscriptContext: { active: true, paragraphStyle: 'indented', author: 'A. Writer' },
  });

  // Build: the full text, nested under the outline, with a permanent original.
  const built = createRevision('aaaaaaaa');
  const ms = read(built.filename);
  assert.equal(built.title, 'The Example — Manuscript');
  assert.equal(ms.metadata.variantType, 'manuscript');
  assert.equal(ms.metadata.masterDocId, 'aaaaaaaa');
  assert.equal(ms.metadata.content_type, 'document');
  assert.deepEqual(ms.metadata.manuscriptContext, { paragraphStyle: 'indented', author: 'A. Writer' }, 'book settings travel, the type marker does not');
  assert.equal(ms.metadata.manuscriptChapters.length, 2);
  const commits = listCommits(built.docId);
  assert.match(commits[0].note, /^Built from outline, /);
  assert.ok(getVersionContent(built.docId, commits[0].snapshotTs));
  assert.deepEqual(states(built.docId), { 'Chapter One': 'present', 'Chapter Two': 'present' });

  // Asks first: a second manuscript needs confirm.
  assert.throws(() => createRevision('aaaaaaaa'), (err) => err.status === 409 && err.manuscript.docId === built.docId);
  assert.match(await call('create_editing_draft', { docId: 'aaaaaaaa' }), /^Error: This outline already has a manuscript/);
  const second = createRevision('aaaaaaaa', undefined, { confirm: true });
  assert.equal(second.title, 'The Example — Manuscript 2');
  unlinkSync(join(dataDir, second.filename));

  // A renamed chapter heading still counts as present.
  const h2 = ms.document.content.find(n => n.type === 'heading' && n.content?.[0]?.text === 'Chapter Two');
  applyChangesToFile(built.filename, [{ operation: 'rewrite', nodeId: h2.attrs.id, content: parseMarkdownContent('# Chapter Two, Retitled') }]);
  batchResolve([built.filename], 'accept');
  assert.ok(body(built.filename).includes('# Chapter Two, Retitled'));
  assert.equal(states(built.docId)['Chapter Two'], 'present', 'recorded heading survives a rename');

  // The outline gains a middle chapter and a last one: both show as missing.
  writeDoc('outline.md', 'aaaaaaaa', 'The Example — Outline',
    outlineBody('## Chapter One and a Half\n\n- [Four](doc:44444444)\n\n') + '\n## Chapter Three\n\n- [Three](doc:33333333)\n\n## Chapter Four\n\n- [Five](doc:55555555)\n',
    { content_type: 'manuscript', manuscriptContext: { active: true, paragraphStyle: 'indented' } });
  assert.deepEqual(states(built.docId), {
    'Chapter One': 'present', 'Chapter One and a Half': 'missing', 'Chapter Two': 'present', 'Chapter Three': 'missing', 'Chapter Four': 'missing',
  });

  // Add chapter (not the open doc): one pending change, in its place.
  const textBefore = body(built.filename);
  const middle = book.addChapter(built.docId, 'Chapter One and a Half');
  assert.equal(middle.position, 'before "Chapter Two"');
  assert.equal(body(built.filename), textBefore, 'accepted text is untouched until the author accepts');
  let pending = pendingNodes(built.filename);
  assert.ok(pending.length >= 2 && new Set(pending.map(n => n.attrs.pendingGroupId)).size === 1, 'the chapter is one change');
  invalidateDocCache(join(dataDir, built.filename));
  const reloaded = loadDocFromDisk(built.filename).document.content;
  assert.deepEqual(reloaded.filter(n => n.type === 'heading').map(n => n.content[0].text), ['Chapter One', 'Chapter One and a Half', 'Chapter Two, Retitled']);
  assert.ok(!reloaded.some(n => n.attrs?.pendingOrphan), 'nothing lands at the end of the book on reload');
  const list = reloaded.findIndex(n => n.type === 'bulletList');
  const firstText = (n) => n.text ?? firstText(n.content[0]);
  assert.deepEqual(reloaded.slice(list - 1, list + 2).map(firstText),
    ['A middle chapter arrives late.', 'with a list', 'And a closing line.'], 'its list reloads whole and in place');
  assert.equal(states(built.docId)['Chapter One and a Half'], 'pending');
  assert.throws(() => book.addChapter(built.docId, 'Chapter One and a Half'), /already in the manuscript/);

  // Rejecting it shows the chapter as missing again; accepting keeps it present.
  batchResolve([built.filename], 'reject');
  assert.equal(body(built.filename), textBefore, 'reject leaves the accepted text as it was');
  assert.equal(states(built.docId)['Chapter One and a Half'], 'missing');
  book.addChapter(built.docId, 'Chapter One and a Half');
  batchResolve([built.filename], 'accept');
  assert.ok(body(built.filename).includes('A middle chapter arrives late.'));
  assert.equal(states(built.docId)['Chapter One and a Half'], 'present', 'the recorded heading id survives accepting');
  const afterAccept = body(built.filename);

  // Add chapter on the open doc, by agent tool, at the end; list included.
  switchDocument(built.filename);
  const report = await call('add_chapter_to_manuscript', { docId: 'aaaaaaaa', chapter: 'Chapter Three' });
  assert.match(report, /Inserted "Chapter Three" .* at the end, as one change waiting/);
  assert.ok(getDocument().content.some(n => n.attrs?.pendingGroupId), 'live doc shows the pending chapter');
  save();
  assert.equal(states(built.docId)['Chapter Three'], 'pending');
  assert.match(await call('add_chapter_to_manuscript', { docId: built.docId, chapter: 'Chapter Four' }), /^Error: .*footnotes/);
  const compiled = JSON.parse(await call('compile_manuscript', { docId: 'aaaaaaaa' }));
  assert.deepEqual(compiled.missingFromManuscript, ['Chapter Four']);
  assert.deepEqual(compiled.waitingForReview, ['Chapter Three']);
  assert.equal(body(built.filename), afterAccept, 'a pending chapter never reaches the accepted text');

  // A beat whose chapter is in the manuscript says so; a beat still to add doesn't.
  assert.deepEqual(book.bookStatus('11111111').inManuscripts.map(m => m.docId), [built.docId]);
  assert.deepEqual(book.bookStatus('55555555').inManuscripts, []);

  // Downloads export the manuscript's accepted text, from it or its outline.
  const fromManuscript = book.bookSource(built.docId);
  assert.ok(fromManuscript.markdown.includes('Chapter Two, Retitled'));
  assert.ok(!fromManuscript.markdown.includes('Chapter three closes'), 'pending chapters are not in the download');
  assert.equal(fromManuscript.meta.title, 'The Example');
  assert.equal(fromManuscript.meta.paragraphStyle, 'indented');
  assert.equal(book.bookSource('aaaaaaaa').from.docId, built.docId);
  book.setBookStyle(built.docId, 'spaced');
  assert.equal(book.bookSource(built.docId).meta.paragraphStyle, 'spaced');
  assert.match(await call('export_manuscript', { docId: 'aaaaaaaa', format: 'md' }), /from "The Example — Manuscript"/);

  // Adopting an older Revision: metadata only, and its pruned original returns.
  writeDoc('b6.md', '66666666', 'Beat six', 'Another book begins.');
  writeDoc('outline2.md', 'bbbbbbbb', 'Second Book — Manuscript', '## Opening\n\n- [Six](doc:66666666)\n', { content_type: 'manuscript' });
  const legacy = createRevision('bbbbbbbb');
  const legacyFile = legacy.filename;
  const outline2 = loadManifest('bbbbbbbb');
  const sourceHash = createHash('sha256').update(compileManuscript(outline2.body, outline2.meta).markdown).digest('hex');
  // Shape it like a copy made before books: a Revision with the old record.
  const legacyData = readFrontmatter(legacyFile).data;
  delete legacyData.manuscriptChapters; delete legacyData.manuscriptContext; delete legacyData.revisionSourceHash;
  writeFrontmatter(legacyFile, { ...legacyData, variantType: 'revision', editingDraft: { sourceHash } });
  const legacyMeta = read(legacyFile).metadata;
  assert.equal(legacyMeta.variantType, 'revision');
  const snapshotTs = listCommits(legacy.docId)[0].snapshotTs;
  unlinkSync(join(helpers.getVersionsDir(), legacy.docId, `${snapshotTs}.md`));
  applyChangesToFile(legacyFile, [{ operation: 'rewrite', nodeId: loadDocFromDisk(legacyFile).document.content[1].attrs.id, content: parseMarkdownContent('A PENDING PROPOSAL') }]);
  mkdirSync(join(dataDir, '_marks'), { recursive: true });
  writeFileSync(join(dataDir, '_marks', `${legacyFile}.json`), '{"comments":[]}');
  const sidecar = readFileSync(join(dataDir, '_pending', `${legacy.docId}.json`), 'utf8');
  const legacyBody = body(legacyFile);
  assert.deepEqual(book.bookStatus('bbbbbbbb').revisions.map(r => r.docId), [legacy.docId]);
  const adopted = book.adoptManuscript('bbbbbbbb', legacy.docId);
  assert.deepEqual({ chapters: adopted.chapters, restoredOriginal: adopted.restoredOriginal }, { chapters: 1, restoredOriginal: true });
  assert.equal(read(legacyFile).metadata.variantType, 'manuscript');
  assert.equal(read(legacyFile).metadata.docId, legacyMeta.docId);
  assert.equal(body(legacyFile), legacyBody, 'body untouched');
  assert.equal(readFileSync(join(dataDir, '_pending', `${legacy.docId}.json`), 'utf8'), sidecar, 'pending untouched');
  assert.equal(readFileSync(join(dataDir, '_marks', `${legacyFile}.json`), 'utf8'), '{"comments":[]}', 'comments untouched');
  assert.ok(getVersionContent(legacy.docId, snapshotTs).includes('Another book begins.'), 'original restorable again');
  assert.throws(() => book.adoptManuscript('bbbbbbbb', legacy.docId), /already this book's manuscript/);

  // Named versions never age out; unnamed old ones still do.
  const dir = join(helpers.getVersionsDir(), built.docId);
  const old = Date.now() - 30 * 24 * 3600 * 1000;
  for (let i = 0; i < 60; i++) writeFileSync(join(dir, `${old + i}.md`), `old ${i}`);
  writeFileSync(join(dir, `${commits[0].snapshotTs}.md`), getVersionContent(built.docId, commits[0].snapshotTs));
  pruneVersions(built.docId);
  assert.ok(existsSync(join(dir, `${commits[0].snapshotTs}.md`)), 'the original survives pruning');
  assert.ok(readdirSync(dir).length <= 51, 'other old versions are still pruned');

  console.log('PASS: build + guard, chapter records, Add chapter (placement, one change, reject, live doc, footnotes), beat status, downloads, adoption, permanent original');
} finally {
  await new Promise(r => setTimeout(r, 1800));
  assert.equal(dirname(resolve(temporaryRoot)), resolve(os.tmpdir()));
  rmSync(temporaryRoot, { recursive: true, force: true });
}
