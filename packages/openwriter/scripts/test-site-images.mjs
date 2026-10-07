/**
 * publish_to_site sends the pictures stored on this computer with the post
 * (plugins/publish/src/site-tools.ts postImages, through the newsletter's
 * extractLocalImages). Uses a temp data dir, never the real OpenWriter data.
 *
 * Run from packages/openwriter after building the publish plugin:
 *   `node scripts/test-site-images.mjs`
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { docCover, postImages } from '../../../plugins/publish/dist/site-tools.js';

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

async function test(name, fn) {
  console.log(`\n${name}`);
  await fn();
}

const dir = mkdtempSync(join(tmpdir(), 'ow-site-images-'));
mkdirSync(join(dir, '_images'));
writeFileSync(join(dir, '_images', 'a.png'), 'png bytes');
writeFileSync(join(dir, '_images', 'cover.jpg'), 'jpg bytes');

try {
  await test('Test 1: body pictures go with the post, once each; missing files and https images are left out', async () => {
    const html = '<p><img src="/_images/a.png"></p><p><img src="/_images/a.png"><img src="/_images/gone.png"><img src="https://e.x/i.png"></p>';
    const images = await postImages(html, undefined, dir);
    assert(images.length === 1, `one image (got ${images.length})`);
    assert(images[0]?.path === '/_images/a.png', 'path is the src as written in the doc');
    assert(images[0]?.content_type === 'image/png', 'content type from the extension');
    assert(Buffer.from(images[0]?.data ?? '', 'base64').toString() === 'png bytes', 'data is the file, base64');
  });

  await test('Test 2: a local cover goes too; an https cover does not', async () => {
    const withCover = await postImages('<p>x</p>', '/_images/cover.jpg', dir);
    assert(withCover.map((i) => i.path).join() === '/_images/cover.jpg', 'local cover uploaded');
    assert(withCover[0]?.content_type === 'image/jpeg', 'cover content type');
    assert((await postImages('<p>x</p>', 'https://e.x/c.png', dir)).length === 0, 'https cover not uploaded');
    assert((await postImages('<p>x</p>', '', dir)).length === 0, 'cleared cover not uploaded');
  });

  await test('Test 3: with no cover passed, the post takes the document cover', async () => {
    assert(docCover({ articleContext: { coverImage: '/_images/cover.jpg' } }) === '/_images/cover.jpg', 'article cover');
    assert(docCover({ blogContext: { coverImage: '/_images/b.png' }, articleContext: { coverImage: '/_images/a.png' } }) === '/_images/b.png', 'blog cover first');
    assert(docCover({}) === undefined, 'no cover');
  });
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
