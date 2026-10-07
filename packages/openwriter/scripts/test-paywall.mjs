/**
 * Paywall marker: `<!-- paywall -->` on disk ↔ horizontalRule { paywall: true },
 * and the publish plugin's wall_at count (plugins/publish/src/site-wall.ts).
 *
 * Run from packages/openwriter after building the server and the publish plugin:
 *   `node scripts/test-paywall.mjs`
 *
 * adr: adr/paywall-marker.md
 */

import { markdownToTiptap } from '../dist/server/markdown-parse.js';
import { tiptapToMarkdown } from '../dist/server/markdown-serialize.js';
import { compactNodes } from '../dist/server/compact.js';
import { md, stripFrontmatter } from '../../../plugins/publish/dist/helpers.js';
import { placeWall } from '../../../plugins/publish/dist/site-wall.js';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed++;
    console.log(`  PASS: ${msg}`);
  } else {
    failed++;
    console.error(`  FAIL: ${msg}`);
  }
}

function test(name, fn) {
  console.log(`\n${name}`);
  fn();
}

const body = (markdown) => stripFrontmatter(markdown).trim();
const publishHtml = (markdown) => md.render(body(tiptapToMarkdown(markdownToTiptap(markdown).document, 'T')));

test('Test 1: the marker parses to a paywall rule; --- stays a plain rule', () => {
  const doc = markdownToTiptap('Free part.\n\n<!-- paywall -->\n\nPaid part.\n\n---\n\nMore.\n').document.content;
  const rules = doc.filter((n) => n.type === 'horizontalRule');
  assert(rules.length === 2, `two rules (got ${rules.length})`);
  assert(rules[0].attrs.paywall === true, 'first rule is the paywall');
  assert(!rules[1].attrs.paywall, '--- is not a paywall');
  assert(doc.map((n) => n.type).join(',') === 'paragraph,horizontalRule,paragraph,horizontalRule,paragraph', 'block order kept');
});

test('Test 2: serialize writes the canonical marker and the round trip is stable', () => {
  const source = 'Free part.\n\n<!--   PAYWALL -->\n\nPaid part.\n\n---\n\nMore.\n';
  const once = body(tiptapToMarkdown(markdownToTiptap(source).document, 'T'));
  assert(once === 'Free part.\n\n<!-- paywall -->\n\nPaid part.\n\n---\n\nMore.', `canonical form written:\n${once}`);
  const twice = body(tiptapToMarkdown(markdownToTiptap(once).document, 'T'));
  assert(twice === once, 'second round trip is byte-stable');
});

test('Test 3: a marker inside a quote round-trips', () => {
  const doc = markdownToTiptap('> Quoted.\n>\n> <!-- paywall -->\n').document.content;
  const inner = doc[0]?.content?.find((n) => n.type === 'horizontalRule');
  assert(doc[0]?.type === 'blockquote' && inner?.attrs?.paywall === true, 'paywall rule inside the blockquote');
  assert(body(tiptapToMarkdown({ type: 'doc', content: doc }, 'T')).includes('> <!-- paywall -->'), 'serialized inside the quote');
});

test('Test 4: agents see the marker in compact output', () => {
  const doc = markdownToTiptap('<!-- paywall -->\n').document.content;
  assert(/^\[hr:[^\]]+\] <!-- paywall -->$/.test(compactNodes(doc)), `compact line: ${compactNodes(doc)}`);
});

test('Test 5: wall_at counts top-level blocks above the marker', () => {
  const source = [
    '# Heading', '', 'One.', '', '- a', '- b', '', '| x | y |', '| - | - |', '| 1 | 2 |', '', '![alt](https://e.x/i.png)', '',
    '---', '', '<!-- paywall -->', '', 'Paid.', '',
  ].join('\n');
  const html = publishHtml(source);
  const r = placeWall(html);
  // h1, p, ul, table, p(img), hr
  assert(r.ok && r.wall_at === 6, `wall_at 6 (got ${JSON.stringify(r.ok ? r.wall_at : r.error)})`);
  assert(r.ok && !/paywall/.test(r.html), 'marker stripped from the html');
  assert(r.ok && r.html.includes('<p>Paid.</p>'), 'content below the wall kept');
});

test('Test 6: no marker, marker at top, two markers, marker inside a quote', () => {
  const none = placeWall(publishHtml('Just text.\n'));
  assert(none.ok && none.wall_at === null, 'no marker → wall_at null');
  const top = placeWall(publishHtml('<!-- paywall -->\n\nAll paid.\n'));
  assert(top.ok && top.wall_at === 0, 'marker first → wall_at 0');
  const two = placeWall(publishHtml('A\n\n<!-- paywall -->\n\nB\n\n<!-- paywall -->\n\nC\n'));
  assert(!two.ok && /2 paywall markers/.test(two.error), 'two markers → error');
  const nested = placeWall(publishHtml('> Quoted.\n>\n> <!-- paywall -->\n\nAfter.\n'));
  assert(!nested.ok && /inside/.test(nested.error), 'marker inside a quote → error');
  const code = placeWall(publishHtml('```\n<!-- paywall -->\n```\n'));
  assert(code.ok && code.wall_at === null, 'marker text in a code block is not a marker');
});

test('Test 7: footnotes publish as footnote html; the notes come last, after the wall', () => {
  const html = publishHtml('Free[^a] part.\n\n<!-- paywall -->\n\nPaid[^b] part, again[^a].\n\n[^a]: Note *one*.\n[^b]: Note two.\n');
  assert(html.includes('<sup class="footnote-ref"><a href="#fn1" id="fnref1">1</a></sup>'), `reference reads as its number:\n${html}`);
  assert(html.includes('<a href="#fn1" id="fnref1:1">1</a>'), 'a repeated reference keeps its number');
  assert(/<section class="footnotes">\n<ol class="footnotes-list">\n<li id="fn1" class="footnote-item"><p>Note <em>one<\/em>\./.test(html), 'notes in a footnotes section');
  assert(!/\[\^|<hr/.test(html), 'no raw [^ text and no rule above the notes');
  const r = placeWall(html);
  assert(r.ok && r.wall_at === 1, `wall_at counts the blocks above the marker only (got ${JSON.stringify(r.ok ? r.wall_at : r.error)})`);
  assert(r.ok && /<\/section>\s*$/.test(r.html), 'the notes section stays at the end');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
