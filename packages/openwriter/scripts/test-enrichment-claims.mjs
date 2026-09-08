// Exercises real registry handlers and persisted documents, with isolated data.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, utimesSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { z } from 'zod';
import { setActiveProfile, getDataDir } from '../dist/server/helpers.js';
import { TOOL_REGISTRY } from '../dist/server/mcp.js';
import { createEnrichmentTools } from '../dist/server/enrichment-tools.js';
import { markdownToTiptap } from '../dist/server/markdown.js';
import { getMetadata, getCanonical, setActiveDocument, save, updateDocument, populateDocumentFile } from '../dist/server/state.js';

setActiveProfile(`test-enrichment-claims-${process.pid}`);
const root = getDataDir();
mkdirSync(root, { recursive: true });
const tool = name => TOOL_REGISTRY.find(t => t.name === name);
async function call(name, args) {
  const t = tool(name);
  const result = await t.handler(z.object(t.schema).parse(args));
  return JSON.parse(result.content[0].text.split('\n').at(-1));
}
function seed(id, text = 'A guide to growing tomatoes.', extra = {}) {
  const path = join(root, `${id}.md`);
  writeFileSync(path, matter.stringify(text, { docId: id, title: `Fixture ${id}`, status: 'canonical', ...extra }));
  const old = new Date(Date.now() - 10_000);
  utimesSync(path, old, old);
  return path;
}
const meta = id => matter(readFileSync(join(root, `${id}.md`), 'utf8')).data;
const claim = async id => (await call('claim_enrichment', { docIds: [id] })).docs[0];
const finish = (c, logline = 'Growing tomatoes.') => call('mark_enriched', { docs: [{ docId: c.docId, claimToken: c.claimToken, logline }] });
try {
  seed('aaaa0001', 'Growing tomatoes. '.repeat(4000));
  const [a, b] = await Promise.all([claim('aaaa0001'), claim('aaaa0001')]);
  assert(a && !b, 'concurrent callers receive disjoint work');
  assert(a.content.length > 50_000, 'claim returns full content beyond normal read cap');
  assert.equal((await finish(a)).docs[0].ok, true);
  assert.equal(meta(a.docId).enrichmentStale, false);
  assert.equal(meta(a.docId).status, 'canonical');
  assert.equal((await finish(a)).docs[0].ok, false, 'completed token cannot replay');

  const changedPath = seed('aaaa0002');
  const changed = await claim('aaaa0002');
  writeFileSync(changedPath, readFileSync(changedPath, 'utf8').replace('tomatoes', 'potatoes'));
  assert.equal((await finish(changed)).docs[0].ok, false, 'same-length edit invalidates summary');
  assert.equal(meta(changed.docId).lastEnrichedAt, undefined);
  const deferred = await call('claim_enrichment', { docIds: [changed.docId] });
  assert.equal(deferred.docs.length, 0, 'new edits settle before claim');
  assert(deferred.retryAfterMs > 0);
  utimesSync(changedPath, new Date(Date.now() - 10_000), new Date(Date.now() - 10_000));
  const fresh = await claim(changed.docId);
  assert(fresh.content.includes('potatoes'));
  assert.equal((await finish(fresh, 'Growing potatoes.')).docs[0].ok, true);

  seed('aaaa0003');
  const owned = await claim('aaaa0003');
  assert.equal((await finish({ ...owned, claimToken: 'wrong' })).docs[0].ok, false);
  assert.equal(await claim('aaaa0003'), undefined, 'wrong token does not release another worker');
  assert.equal((await finish(owned)).docs[0].ok, true);
  assert.throws(() => z.object(tool('mark_enriched').schema).parse({ docs: [{ docId: 'aaaa0003', logline: 'Unclaimed.' }] }));

  seed('aaaa0004');
  const archived = await claim('aaaa0004');
  seed('aaaa0004', 'A guide to growing tomatoes.', { archivedAt: new Date().toISOString() });
  assert.equal((await finish(archived)).docs[0].ok, false);

  const activePath = seed('aaaa0005');
  const active = markdownToTiptap(readFileSync(activePath, 'utf8'));
  setActiveDocument(active.document, active.title, activePath, false, new Date(Date.now() - 10_000), active.metadata);
  const before = await claim('aaaa0005');
  assert(before);
  const edited = structuredClone(getCanonical());
  edited.content[0].content[0].text = 'A guide to building greenhouses.';
  updateDocument(edited);
  assert.equal((await finish(before)).docs[0].ok, false, 'unsaved active edit invalidates snapshot');
  assert.equal(getMetadata().lastEnrichedAt, undefined);
  save();
  await new Promise(resolve => setTimeout(resolve, 5_100));
  const activeFresh = await claim('aaaa0005');
  assert(activeFresh.content.includes('greenhouses'));
  assert.equal((await finish(activeFresh, 'Building greenhouses.')).docs[0].ok, true);
  assert.equal(getMetadata().enrichmentStale, false, 'active memory and disk agree on completion');
  assert.equal(meta('aaaa0005').logline, 'Building greenhouses.');

  seed('aaaa0007');
  const optingOut = await claim('aaaa0007');
  mkdirSync(join(root, '_workspaces'), { recursive: true });
  writeFileSync(join(root, '_workspaces', 'opt-out.json'), JSON.stringify({ version: 2, title: 'Excluded', enrichmentDisabled: true, root: [{ type: 'doc', file: 'aaaa0007.md', title: 'Excluded' }] }));
  assert.equal((await finish(optingOut)).docs[0].ok, false, 'opt-out after claim prevents completion');
  assert.equal(await claim('aaaa0007'), undefined);

  const pendingPath = seed('aaaa0008');
  populateDocumentFile('aaaa0008.md', { type: 'doc', content: [{ type: 'paragraph', attrs: { nodeId: 'pending1' }, content: [{ type: 'text', text: 'UNACCEPTED PROPOSAL' }] }] });
  utimesSync(pendingPath, new Date(Date.now() - 10_000), new Date(Date.now() - 10_000));
  const pending = await claim('aaaa0008');
  assert(pending.content.includes('tomatoes'));
  assert(!pending.content.includes('UNACCEPTED'), 'claim excludes pending proposals');

  // A fresh registry models process restart; a controlled clock exercises
  // lease expiry without sleeping five minutes. Real disk supplies snapshots.
  seed('aaaa0006');
  let now = Date.now() + 10_000;
  const resolve = id => {
    const filePath = join(root, `${id}.md`);
    const parsed = markdownToTiptap(readFileSync(filePath, 'utf8'));
    return { isActive: false, document: parsed.document, metadata: parsed.metadata, title: parsed.title, filePath, lastModified: new Date(0) };
  };
  const make = () => createEnrichmentTools(resolve, () => now);
  const run = async (registry, name, args) => {
    const result = await registry.find(t => t.name === name).handler(args);
    return JSON.parse(result.content[0].text.split('\n').at(-1));
  };
  const registry = make();
  const first = (await run(registry, 'claim_enrichment', { docIds: ['aaaa0006'] })).docs[0];
  now += 300_001;
  const second = (await run(registry, 'claim_enrichment', { docIds: ['aaaa0006'] })).docs[0];
  assert.notEqual(first.claimToken, second.claimToken);
  assert.equal((await run(registry, 'mark_enriched', { docs: [{ ...first, logline: 'Old result.' }] })).docs[0].ok, false);
  const restarted = make();
  const recovered = (await run(restarted, 'claim_enrichment', { docIds: ['aaaa0006'] })).docs[0];
  assert(recovered, 'restart recovers durable unfinished work');
  assert.equal((await run(restarted, 'mark_enriched', { docs: [{ ...second, logline: 'Old process.' }] })).docs[0].ok, false);
  assert.equal((await run(restarted, 'mark_enriched', { docs: [{ ...recovered, logline: 'Growing tomatoes.' }] })).docs[0].ok, true);
  console.log('PASS: exclusive claims, full snapshots, changed/active content, idle delay, token checks, archive, lease expiry and restart recovery.');
} finally {
  // The profile name and resolved directory are fixed above, never user data.
  rmSync(root, { recursive: true, force: true });
}
process.exit(0);
