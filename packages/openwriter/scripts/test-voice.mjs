/**
 * Writing in the writer's voice: right-click actions on the writer's own Claude key.
 *
 *  - Settings > Claude: the key is saved on the server and never sent back, only its last four.
 *  - Learn my voice from this: each paragraph enriched once with the search engine's GR5 prompt and the
 *    document with its document prompt, on Haiku; the index finds a paragraph by a word only its
 *    enrichment has and never stores the writing; a re-add sends only changed paragraphs.
 *  - The voice profile builds itself from the writer's own text: Author's Voice's analysis
 *    (Sonnet 4.6) and its blend matcher (Haiku 4.5), saved to profile.json.
 *  - Enhance (POST /api/voice/apply-editor): Author's Voice's prompt with the built blend and
 *    voice examples; the paragraph being rewritten is never its own example; nodes come back.
 *  - A transform (Vary) makes a new document beside the source, on Sonnet 4.5.
 *  - No key, a rejected key: plain answers.
 *
 * Anthropic is never called: a stand-in client answers. Throwaway home folder.
 * adr: adr/authors-voice.md
 *
 * Run: `node scripts/test-voice.mjs` (after `npm run build`)
 */

import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import express from 'express';
import Anthropic from '@anthropic-ai/sdk';

const home = mkdtempSync(join(tmpdir(), 'ow-voice-test-'));
process.env.HOME = home;
process.env.USERPROFILE = home;
delete process.env.OW_DATA_DIR;
process.on('exit', () => { try { rmSync(home, { recursive: true, force: true }); } catch { /* best-effort */ } });

const { ROOT_DIR, ensureDataDir, getDataDir, resolveDocPath } = await import('../dist/server/helpers.js');
if (!ROOT_DIR.startsWith(home)) { console.error(`Refusing to run: data root ${ROOT_DIR} is not in the temp folder`); process.exit(1); }
ensureDataDir();
const { createDocumentFromRequest } = await import('../dist/server/document-create.js');
const { getDocId, getDocument, updateDocument, save, cancelDebouncedSave } = await import('../dist/server/state.js');
const { filenameByDocId } = await import('../dist/server/documents.js');
const { setEmbedOptions } = await import('../dist/server/embed-options.js');
const { registerVoiceRoutes } = await import('../dist/server/voice/index.js');
const { voiceIndex } = await import('../dist/server/voice/voice/voice-index.js');
const { chunksFromCompact } = await import('../dist/server/voice/voice/voice-enrich.js');
const { STRUCTURAL_KEYS } = await import('../dist/server/voice/profile/AITellsCatalog.js');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  PASS: ${msg}`); }
  else      { failed++; console.error(`  FAIL: ${msg}`); }
}

const FAKE_KEY = 'sk-ant-api03-' + 'T3stKeyNotReal_'.repeat(4) + 'Zq9w';
let key = null;
let rejectKey = false;
const calls = [];
const text = (t) => ({ content: [{ type: 'text', text: t }], stop_reason: 'end_turn', usage: { input_tokens: 300, output_tokens: 60 } });

// Stand-in for Anthropic, answering each prompt the way its parser expects.
let balanceRefusal = null;
const fakeClient = (apiKey, balance) => ({
  messages: {
    create: async (params) => {
      calls.push({ apiKey, balance, params });
      if (balance && balanceRefusal) throw balanceRefusal;
      if (rejectKey) throw new Anthropic.AuthenticationError(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 'invalid x-api-key', new Headers());
      const prompt = String(params.messages[0].content);
      if (prompt.includes('vocabulary field')) return text(JSON.stringify({ synonyms: ['cookery'], concepts: ['weeknight cooking'], themes: ['kitchen confidence'] }));
      if (prompt.startsWith('This passage will be indexed for search.')) {
        const first = prompt.split('PASSAGE:\n')[1].trim().split(/\s+/)[0].toLowerCase().replace(/\W/g, '');
        return text(JSON.stringify({ synonyms: [`syn${first}`, 'broth'], phrase_variants: [`${first} label`], questions: [`how about ${first}?`] }));
      }
      if (prompt.includes('literary stylometry analyst')) {
        return text(JSON.stringify({
          blend: [{ author: 'Julia Child', weight: 60, features_matched: ['short imperative steps', 'direct address'] }, { author: 'Anthony Bourdain', weight: 40, features_matched: ['clipped fragments', 'wry asides'] }],
          self_check: { any_thematic_reasoning: false, confidence: 'medium', notes: '' },
        }));
      }
      if (prompt.startsWith('You are a linguistic analyst.')) {
        return text(JSON.stringify({
          structural_votes: Object.fromEntries(STRUCTURAL_KEYS.map((k) => [k, false])),
          confidence: 'Medium',
          user_friendly_summary: { summary: 'Plain and practical.', writing_style: 'Short steps.', voice_signature: 'Imperatives.', confidence_description: 'Enough text.' },
        }));
      }
      if (params.model === 'claude-sonnet-5-5') return text('<p>A varied take on the stock.</p>');
      return text('Rewritten in the voice.');
    },
  },
});

setEmbedOptions({ aiClient: fakeClient });
const app = express();
app.use(express.json({ limit: '5mb' }));
registerVoiceRoutes(app);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const api = async (method, path, body) => {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const t = await res.text();
  return { status: res.status, text: t, json: (() => { try { return JSON.parse(t); } catch { return null; } })() };
};
/** What OpenWriter's /api/plugins/sidebar-action forwards: the action, the file's content and title. */
const sidebar = (action, filename, title) => api('POST', '/api/voice/sidebar-action', {
  action, filename, title, content: readFileSync(resolveDocPath(filename), 'utf-8'),
});

console.log('\nParagraphs from read_pad:');
{
  const c = chunksFromCompact(['title: T', 'words: 9', '---', '[h1:aaaaaaaa] Soups', '[p:bbbbbbbb] Onions first, always.', '[ul:cccccccc]', '  [li:dddddddd] Salt early', '[h2:eeeeeeee] Stock', '[p:ffffffff] Ok', '[p:gggggggg] Simmer the skins', 'for colour.', '[FORCED FULL READ — 9 words returned of 9 total. Cap bypassed.]'].join('\n'));
  assert(c.map((x) => x.nodeId).join() === 'bbbbbbbb,dddddddd,gggggggg', 'paragraphs and list items, not headings, empty lists or one-word lines');
  assert(c[2].headingPath.join('/') === 'Soups/Stock', 'each paragraph knows its headings');
}

const title = 'Five-minute stock';
const long = 'Onions first, then carrots and rice, and never rush the pan. '.repeat(30).trim();
createDocumentFromRequest({ title, content: `# Stock\n\n${long}\n\nSimmer the onion skins too, they colour it gold.\n\nTaste before you panic.` });
const docId = getDocId();
save();
const filename = filenameByDocId(docId);

console.log('\nNo key:');
let r = await sidebar('add-to-corpus', filename, title);
assert(r.status === 409 && r.json.code === 'no_key' && /Claude API key/.test(r.json.error), 'without a key: a plain "add your key" answer');
assert(calls.length === 0, 'without a key Claude is not called');

console.log('\nSettings > Claude:');
r = await api('PUT', '/api/voice/settings', { key: 'not-a-key' });
assert(r.status === 400, 'a malformed key is refused');
r = await api('PUT', '/api/voice/settings', { key: FAKE_KEY, model: 'sonnet' });
assert(r.status === 200 && r.json.saved && r.json.last4 === FAKE_KEY.slice(-4) && r.json.model === 'sonnet' && !r.text.includes(FAKE_KEY.slice(0, 20)), 'key saved; the answer names only its last four characters');
r = await api('GET', '/api/voice/settings');
assert(!r.json.managed && r.json.saved && !r.text.includes(FAKE_KEY.slice(0, 20)), 'the settings never send the key back');
r = await api('PUT', '/api/voice/settings', { key: null, model: '' });
assert(r.json.saved === false && !existsSync(join(ROOT_DIR, 'ai', 'claude.json')), 'the key can be removed');

// From here the key is kept by an embedding program, as the web version does.
setEmbedOptions({ aiKey: () => key, aiClient: fakeClient });
key = FAKE_KEY;
r = await api('GET', '/api/voice/settings');
assert(r.json.managed && r.json.saved, 'a key kept by the embedding program: no key setting offered');

console.log('\nLearn my voice from this:');
r = await sidebar('add-to-corpus', filename, title);
assert(r.status === 200 && r.json.paragraphs === 3 && r.json.enriched === 3 && r.json.docEnriched, 'three paragraphs enriched, and the document');
assert(r.json.message === `Added "${title}" to your voice: 3 paragraphs enriched.`, 'the answer says what happened, for the sidebar\'s toast');
const enrichCalls = calls.filter((c) => c.params.model === 'claude-haiku-4-5-20251001' && c.params.temperature === 0);
assert(enrichCalls.length === 4 && enrichCalls.every((c) => c.apiKey === FAKE_KEY), 'four Haiku calls (three paragraphs, one document) on the writer\'s key');
const idx = voiceIndex(getDataDir());
const paras = () => getDocument().content.filter((n) => n.type === 'paragraph');
assert(idx.search('synonions')[0]?.nodeId === paras()[0].attrs.id, 'a word only the enrichment has finds the paragraph');
assert(!readFileSync(join(getDataDir(), 'voice', 'index.db')).includes(Buffer.from('they colour it gold')), 'the index does not hold the writer\'s text');
assert(idx.chunk(docId, paras()[0].attrs.id)?.authenticity === 'Human', 'the writer\'s own paragraphs are tagged Human');

console.log('\nThe voice profile builds itself:');
const profileFile = join(getDataDir(), 'voice', 'profile.json');
for (let i = 0; i < 50 && !existsSync(profileFile); i++) await new Promise((ok) => setTimeout(ok, 100));
const profile = existsSync(profileFile) ? JSON.parse(readFileSync(profileFile, 'utf-8')) : null;
assert(profile?.anchorBlend?.[0]?.author === 'Julia Child' && profile.guidelines?.author_voice_guidelines?.confidence === 'Medium', 'the blend and the analysis are saved');
assert(profile?.guidelines?.author_voice_guidelines?.sentence_distribution?.average_length > 0, 'the sentence rhythm is counted from the writer\'s text');
assert(calls.some((c) => c.params.model === 'claude-sonnet-5-5' && String(c.params.messages[0].content).startsWith('You are a linguistic analyst.')), 'the analysis runs on the newest Sonnet');
assert(calls.some((c) => c.params.model === 'claude-haiku-4-5-20251001' && String(c.params.messages[0].content).includes('literary stylometry analyst')), 'the blend match runs on Haiku 4.5');
r = await api('GET', '/api/voice/status');
assert(r.json.documents.length === 1 && r.json.profile?.confidence === 'Medium', 'the status lists the document and the profile');

console.log('\nEnhance:');
const target = paras()[1];
calls.length = 0;
r = await api('POST', '/api/voice/apply-editor', {
  nodes: [target], action: 'rewrite', nodeIds: [target.attrs.id], contextBefore: [], contextAfter: ['Taste before you panic.'],
  fullDocument: getDocument().content.map((n) => (n.content ?? []).map((t) => t.text ?? '').join('')).join('\n\n'),
  documentId: filename, docId,
});
assert(r.status === 200 && r.json.success && r.json.nodes?.[0]?.type === 'paragraph' && r.json.nodes[0].content[0].text === 'Rewritten in the voice.', 'the rewrite comes back as editor nodes');
const rewrite = calls.find((c) => c.params.system);
const sys = rewrite.params.system[0].text;
assert(rewrite.params.model === 'claude-opus-5-5' && rewrite.apiKey === FAKE_KEY, 'the rewrite runs on Opus by default, on the writer\'s key');
assert(sys.includes('You write at this exact training-data blend:\n\n- 60% Julia Child\n- 40% Anthony Bourdain'), 'the built blend leads the prompt');
assert(sys.includes('SENTENCE VARIATION REQUIREMENTS'), 'the built sentence rhythm reaches the prompt');
assert(sys.includes("AUTHOR'S VOICE EXAMPLES FOR AGENT (RAG)") && /Tag: Human \| Use: Voice\+Content/.test(sys), 'voice examples from the writer\'s documents, tagged');
const topical = rewrite.params.messages[0].content.split('## Topical Voice Examples')[1] ?? '';
assert(!topical.includes('Simmer the onion skins too'), 'the paragraph being rewritten is not its own example');

console.log('\nThe voice for drafting agents (get_voice):');
const getVoice = (await import('../dist/server/mcp.js')).TOOL_REGISTRY.find((t) => t.name === 'get_voice');
calls.length = 0;
const voiced = (await getVoice.handler({ about: 'Simmer the onion skins for a golden stock', docId: 'ffffffff' })).content[0].text;
assert(voiced.startsWith('Voice: learned from 1 document') && voiced.includes('medium confidence'), 'the status line says the voice is learned');
assert(voiced.includes('You write at this exact training-data blend:\n\n- 60% Julia Child') && voiced.includes('TASK:\n\n{TASK}'), 'the built blend leads the writing prompt, which ends in a TASK slot');
assert(voiced.includes("REFERENCE EXAMPLES OF AUTHOR'S WRITING") && voiced.includes('Simmer the onion skins too'), 'the writer\'s own paragraphs come with it');
assert(!(await getVoice.handler({ about: 'Simmer the onion skins for a golden stock', docId })).content[0].text.includes('Simmer the onion skins too'), 'the target document\'s own paragraphs are never its examples');
assert(calls.length === 0, 'reading the voice calls no model');

console.log('\nAdding it again after an edit:');
calls.length = 0;
const doc = getDocument();
paras()[1].content = [{ type: 'text', text: 'Simmer the onion skins for twenty minutes, they colour it gold.' }];
updateDocument({ ...doc });
save();
r = await sidebar('add-to-corpus', filename, title);
assert(r.status === 200 && r.json.enriched === 1 && r.json.unchanged === 2, 'only the changed paragraph is enriched again');

console.log('\nVary:');
calls.length = 0;
r = await sidebar('vary', filename, title);
const varied = calls.find((c) => c.params.model === 'claude-sonnet-5-5');
assert(r.status === 200 && r.json.success && r.json.title === `${title} (Variation)` && varied?.apiKey === FAKE_KEY, 'Vary makes a new document, on the newest Sonnet with the writer\'s key');
assert(readFileSync(resolveDocPath(r.json.filename), 'utf-8').includes('A varied take on the stock.'), 'the new document holds the transform');

console.log('\nA rejected key:');
rejectKey = true;
r = await sidebar('vary', filename, title);
assert(r.status === 401 && r.json.code === 'key_rejected' && !r.text.includes(FAKE_KEY), 'a rejected key is reported plainly, without the key');
rejectKey = false;

const usage = readFileSync(join(ROOT_DIR, 'ai', 'usage.jsonl'), 'utf-8');
assert(['"voice-enrich"', '"voice-profile"', '"inline-edit"', '"transform"'].every((k) => usage.includes(k)) && !usage.includes(FAKE_KEY), 'every call is logged, without the key');

console.log('\nThe newest model of each line, from Anthropic\'s list:');
{
  const { modelFor, createMessage, resetModels } = await import('../dist/server/voice/models.js');
  const caps = (effort) => ({ effort: { low: { supported: effort } }, thinking: { types: { disabled: { supported: true } } } });
  const listed = [
    { id: 'claude-sonnet-9', display_name: 'Claude Sonnet 9', line: 'sonnet', lifecycle: 'deprecated', capabilities: caps(true) },
    { id: 'claude-sonnet-6', display_name: 'Claude Sonnet 6', line: 'sonnet', lifecycle: 'active', capabilities: caps(true) },
    { id: 'claude-haiku-5', display_name: 'Claude Haiku 5', line: 'haiku', lifecycle: 'active', capabilities: caps(false) },
    { id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5', line: 'sonnet', lifecycle: 'active', capabilities: caps(true) },
  ];
  const sent = [];
  const listingClient = () => ({
    models: { list: async () => ({ data: listed }) },
    messages: {
      create: async (params) => {
        sent.push(params);
        if (params.temperature !== undefined && params.model === 'claude-haiku-5') {
          throw new Anthropic.BadRequestError(400, { type: 'error', error: { type: 'invalid_request_error', message: 'temperature is not supported' } }, 'temperature is not supported', new Headers());
        }
        return text('ok');
      },
    },
  });
  resetModels();
  setEmbedOptions({ aiKey: () => key, aiClient: listingClient });
  const sonnet = await modelFor('sonnet');
  assert(sonnet.id === 'claude-sonnet-6' && sonnet.effort, 'the newest active Sonnet is chosen, a deprecated one skipped');
  assert((await modelFor('opus')).id === 'claude-opus-5-5', 'a line missing from the list keeps the last known model');
  r = await api('GET', '/api/voice/settings');
  assert(r.json.models.find((m) => m.choice === 'sonnet')?.name === 'Claude Sonnet 6', 'Settings shows the model behind each choice');
  const haiku = await modelFor('haiku');
  await createMessage(listingClient(), haiku, { max_tokens: 10, temperature: 0, messages: [{ role: 'user', content: 'hi' }] });
  await createMessage(listingClient(), haiku, { max_tokens: 10, temperature: 0, messages: [{ role: 'user', content: 'hi' }] });
  assert(sent.length === 3 && sent[1].temperature === undefined && sent[2].temperature === undefined && sent[0].thinking?.type === 'disabled',
    'a model that refuses temperature is retried without it, and remembered');
  resetModels();
  assert(JSON.parse(readFileSync(join(ROOT_DIR, 'ai', 'models.json'), 'utf-8')).models.sonnet.id === 'claude-sonnet-6' && (await modelFor('sonnet')).id === 'claude-sonnet-6',
    'the choice survives a restart');
}

console.log('\nNo key, signed in to OpenWriter: Claude on the OpenWriter balance:');
{
  const { resetModels } = await import('../dist/server/voice/models.js');
  resetModels();
  const ACCOUNT = 'ow_live_' + '0123456789abcdef'.repeat(2);
  process.env.PUBLISH_API_KEY = ACCOUNT;
  key = null;
  setEmbedOptions({ aiKey: () => key, aiClient: fakeClient });
  r = await api('GET', '/api/voice/settings');
  assert(r.json.balance === true && r.json.signedIn === true && !r.json.saved, 'Settings says Claude runs on the balance');
  calls.length = 0;
  // Vary left its new document open; rewrite a paragraph of whichever document is open.
  const openPara = () => getDocument().content.find((n) => n.type === 'paragraph');
  const rewriteOpen = () => api('POST', '/api/voice/apply-editor', {
    nodes: [openPara()], action: 'rewrite', nodeIds: [openPara().attrs.id], contextBefore: [], contextAfter: [], documentId: filenameByDocId(getDocId()), docId: getDocId(),
  });
  r = await rewriteOpen();
  const onBalance = calls.find((c) => c.params.system);
  assert(r.status === 200 && onBalance?.apiKey === ACCOUNT && onBalance.balance?.baseURL === 'https://publish.openwriter.io/ai',
    'the rewrite goes to OpenWriter\'s server on the writer\'s account');
  assert(onBalance?.balance?.headers['x-openwriter-job'] === 'rewrite' && onBalance.params.model.startsWith('claude-haiku-'),
    'it is named a rewrite and runs on Haiku, the free tier, by default');

  // Two documents learned at once rebuild the voice profile once.
  createDocumentFromRequest({ title: 'Second', content: `# Second\n\n${long}\n\nA second paragraph about broth and bones.` });
  const second = getDocId();
  save();
  calls.length = 0;
  const both = await Promise.all([
    api('POST', '/api/voice/sidebar-action', { action: 'add-to-corpus', title: 'Second', content: readFileSync(resolveDocPath(filenameByDocId(second)), 'utf-8') }),
    sidebar('add-to-corpus', filename, title),
  ]);
  assert(both.every((x) => x.status === 200), 'both documents are learned');
  const enrich = calls.filter((c) => String(c.params.messages[0].content).startsWith('This passage will be indexed for search.'));
  assert(enrich.length > 0 && enrich.every((c) => c.balance.headers['x-openwriter-job'] === 'learn' && Number(c.balance.headers['x-openwriter-words']) > 0),
    'each paragraph is named Learn my voice, with its words');
  for (let i = 0; i < 60 && !calls.some((c) => String(c.params.messages[0].content).startsWith('You are a linguistic analyst.')); i++) await new Promise((ok) => setTimeout(ok, 100));
  await new Promise((ok) => setTimeout(ok, 500));
  assert(calls.filter((c) => String(c.params.messages[0].content).startsWith('You are a linguistic analyst.')).length === 1, 'the profile is rebuilt once for the batch');

  balanceRefusal = new Anthropic.APIError(402, { type: 'error', error: { type: 'openwriter_balance_empty', message: 'Your OpenWriter balance is too low for this.' } }, 'balance', new Headers());
  r = await sidebar('vary', filename, title);
  assert(r.status === 402 && r.json.code === 'balance_empty' && r.json.error === 'Your OpenWriter balance is too low for this.', 'an empty balance is reported in OpenWriter\'s own words');
  balanceRefusal = null;
  delete process.env.PUBLISH_API_KEY;
  r = await rewriteOpen();
  assert(r.status === 409 && /sign in to OpenWriter/.test(r.json.error), 'no key and not signed in: the answer offers both');
}

cancelDebouncedSave();
server.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
