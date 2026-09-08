/**
 * Sync-merge test: when browser sends a stale-version doc-update, server
 * preserves agent overlay entries the browser hasn't seen, while accepting
 * browser's canonical edits. Replaces the old reject-and-discard behavior.
 *
 * adr: adr/pending-overlay-model.md
 *
 * Run: `node scripts/test-sync-merge.mjs`
 */

import { mkdirSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import {
  setActiveDocument,
  syncBrowserDocUpdate,
  getDocument,
  getCanonical,
  getOverlayEntries,
  bumpDocVersion,
  getDocVersion,
  cancelDebouncedSave,
  save,
} from '../dist/server/state.js';
import { setActiveProfile, ensureDataDir } from '../dist/server/helpers.js';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; console.log(`  PASS: ${msg}`); }
  else      { failed++; console.error(`  FAIL: ${msg}`); }
}

const TEST_PROFILE = `test-sync-merge-${Date.now()}`;
const TEST_PROFILE_DIR = join(homedir(), '.openwriter', 'profiles', TEST_PROFILE);

function cleanup() {
  cancelDebouncedSave();
  try { rmSync(TEST_PROFILE_DIR, { recursive: true, force: true }); } catch { /* best-effort */ }
}

function makeNode(id, text, pendingStatus) {
  const node = { type: 'paragraph', attrs: { id }, content: [{ type: 'text', text }] };
  if (pendingStatus) node.attrs.pendingStatus = pendingStatus;
  return node;
}

try {
  setActiveProfile(TEST_PROFILE);
  ensureDataDir();
  mkdirSync(TEST_PROFILE_DIR, { recursive: true });

  // --- Scenario 1: disjoint touches preserve both sides ---
  console.log('\nScenario 1: agent edits N1, browser edits N3 (disjoint) → both survive');

  // Seed: doc with 3 paragraphs, no pending.
  const seed = {
    type: 'doc',
    content: [
      makeNode('p1', 'paragraph one'),
      makeNode('p2', 'paragraph two'),
      makeNode('p3', 'paragraph three'),
    ],
  };
  setActiveDocument(seed, 'sync-test-1', join(TEST_PROFILE_DIR, 'doc1.md'), false, new Date(), { docId: 'sync001', title: 'sync-test-1' }, null);

  // Agent adds a pending rewrite on p1 (bumps version to 1).
  const v1 = bumpDocVersion();
  const agentMerged = {
    type: 'doc',
    content: [
      { ...makeNode('p1', 'agent rewrite of paragraph one', 'rewrite'), attrs: { ...makeNode('p1', '').attrs, pendingStatus: 'rewrite', pendingOriginalContent: { type: 'paragraph', content: [{ type: 'text', text: 'paragraph one' }] } } },
      makeNode('p2', 'paragraph two'),
      makeNode('p3', 'paragraph three'),
    ],
  };
  // Use setActiveDocument to wire this in (which sets primary state including overlay).
  setActiveDocument(agentMerged, 'sync-test-1', join(TEST_PROFILE_DIR, 'doc1.md'), false, new Date(), { docId: 'sync001', title: 'sync-test-1' }, null);

  // Verify: server now has overlay entry for p1.
  const afterAgent = getOverlayEntries();
  assert(afterAgent.some((e) => e.nodeId === 'p1' && e.status === 'rewrite'), 'agent rewrite entry stored');

  // Bump version representing "agent wrote at this version."
  bumpDocVersion();
  const serverVersionNow = getDocVersion();

  // Browser sends a stale-version doc-update with NO pending on p1 (it didn't see the agent's edit)
  // but the user edited p3.
  const browserView = {
    type: 'doc',
    content: [
      makeNode('p1', 'paragraph one'),  // browser's view: no agent edit
      makeNode('p2', 'paragraph two'),
      makeNode('p3', 'user typed an addendum here'),  // user edit
    ],
  };
  // Browser was at version v1 (before the agent's write). Server is at serverVersionNow > v1.
  syncBrowserDocUpdate(browserView, v1 - 1);  // simulate browser came from an older version

  // After merge:
  // - p3 should reflect the user's edit (browser's canonical wins).
  // - p1's agent overlay entry should still exist (it was added after browser's baseline).
  const overlayAfter = getOverlayEntries();
  const canonicalAfter = getCanonical();
  const p3Canonical = canonicalAfter.content.find((n) => n.attrs?.id === 'p3');
  const p3Text = p3Canonical?.content?.[0]?.text || '';
  assert(p3Text === 'user typed an addendum here', `p3 reflects browser's user edit (got "${p3Text}")`);
  assert(overlayAfter.some((e) => e.nodeId === 'p1' && e.status === 'rewrite'), 'agent rewrite on p1 survived the stale merge');

  // --- Scenario 2: in-sync browser overwrites (no merge needed) ---
  console.log('\nScenario 2: browser submits with current version → straight apply');

  cleanup();
  setActiveProfile(TEST_PROFILE);
  ensureDataDir();
  mkdirSync(TEST_PROFILE_DIR, { recursive: true });

  setActiveDocument(seed, 'sync-test-2', join(TEST_PROFILE_DIR, 'doc2.md'), false, new Date(), { docId: 'sync002', title: 'sync-test-2' }, null);

  // No agent activity. Browser at version 0, server at version 0.
  // syncBrowserDocUpdate gets called with browserVersion = serverVersion (in-sync).
  // The merge logic still runs but preserves nothing extra.
  const browserDirectEdit = {
    type: 'doc',
    content: [
      makeNode('p1', 'browser changed p1'),
      makeNode('p2', 'paragraph two'),
      makeNode('p3', 'paragraph three'),
    ],
  };
  syncBrowserDocUpdate(browserDirectEdit, getDocVersion());

  const overlayAfterScenario2 = getOverlayEntries();
  const canonicalAfterScenario2 = getCanonical();
  const p1Text = canonicalAfterScenario2.content.find((n) => n.attrs?.id === 'p1')?.content?.[0]?.text || '';
  assert(p1Text === 'browser changed p1', `p1 reflects browser edit (got "${p1Text}")`);
  assert(overlayAfterScenario2.length === 0, `no overlay entries (got ${overlayAfterScenario2.length})`);

  // Regression: enrichment saves metadata at a newer version than the browser.
  // The next stale-version browser merge must advance the persistence version.
  save();
  const savedVersion = getDocVersion();
  const followOn = structuredClone(getDocument());
  followOn.content[0].content[0].text = 'Browser edit after enrichment must persist.';
  syncBrowserDocUpdate(followOn, savedVersion - 1);
  assert(getDocVersion() > savedVersion, 'stale browser merge advances save version');
  save();
  const persisted = readFileSync(join(TEST_PROFILE_DIR, 'doc2.md'), 'utf8');
  assert(persisted.includes('Browser edit after enrichment must persist.'), 'follow-on browser edit reaches disk');

  console.log('\n============================================================');
  console.log(`Sync-merge: ${passed} passed, ${failed} failed`);
  console.log('============================================================');
} finally {
  cleanup();
}

if (failed > 0) process.exit(1);
