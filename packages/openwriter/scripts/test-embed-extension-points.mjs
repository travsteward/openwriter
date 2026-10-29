/**
 * The extension points for programs embedding OpenWriter (openwriter/server): the data folder,
 * the request gate, the public origin, the tool and plugin filters, in-process plugins, the
 * plugin host, plugin client modules and first-run documents. adr: adr/open-source-boundary.md
 *
 * Throwaway data folder (OW_DATA_DIR in the temp dir), never ~/.openwriter. Listens on a free
 * loopback port.
 *
 * Run: `node scripts/test-embed-extension-points.mjs` (after `npm run build`)
 */

import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const dataDir = mkdtempSync(join(tmpdir(), 'ow-embed-test-'));
process.env.OW_DATA_DIR = dataDir;
process.on('exit', () => { try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* best-effort */ } });
const clientDir = join(dataDir, 'client-module');
mkdirSync(clientDir);
writeFileSync(join(clientDir, 'main.js'), 'export default function activate() {}');

const { startOpenWriter } = await import('../dist/server/embed.js');
const { ROOT_DIR } = await import('../dist/server/helpers.js');
const { seedFirstRunDocuments } = await import('../dist/server/first-run.js');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  PASS: ${msg}`); }
  else      { failed++; console.error(`  FAIL: ${msg}`); }
}

assert(ROOT_DIR === dataDir, 'OW_DATA_DIR moves the data folder');

let host = null;
const plugin = {
  name: 'demo-plugin',
  version: '1.0.0',
  displayName: 'Demo',
  clientModule: { dir: clientDir, entry: 'main.js' },
  registerRoutes(ctx) {
    host = ctx.host;
    ctx.app.get('/api/demo', (_req, res) => res.json({ ok: true }));
  },
  mcpTools: () => ['demo_tool', 'demo_hidden'].map((name) => ({
    name, description: name, inputSchema: { type: 'object', properties: {} }, handler: async () => ({}),
  })),
};
const ow = await startOpenWriter({
  port: 0,
  publicOrigin: 'https://writer.example',
  requestGate: (req) => (req.headers['x-demo'] === 'yes' ? null : { status: 401, body: { error: 'refused' } }),
  toolFilter: ({ name }) => name !== 'open_file' && name !== 'demo_hidden',
  pluginFilter: ({ name }) => name !== '@openwriter/plugin-x-api',
  plugins: [plugin],
  firstRunDocuments: [{ title: 'Welcome', markdown: 'Hello there.\n\n## Next\n\nA second paragraph.' }],
});
const base = `http://127.0.0.1:${ow.port}`;
const get = (path, headers = { 'x-demo': 'yes' }) => fetch(base + path, { headers });

console.log('\nRequest gate:');
const refused = await get('/api/status', {});
assert(refused.status === 401 && (await refused.json()).error === 'refused', 'a refusal answers with the gate\'s status and body');
assert((await get('/api/status')).status === 200, 'an allowed request reaches the route');

console.log('\nPublic origin:');
const post = (origin) => fetch(`${base}/api/plugins/config`, {
  method: 'POST', headers: { 'x-demo': 'yes', 'Content-Type': 'application/json', Origin: origin }, body: '{}',
});
assert((await post(`http://localhost:${ow.port}`)).status === 403, 'a loopback Origin is refused once a public origin is set');
assert((await post('https://writer.example')).status === 400, 'the public origin passes the Origin check');

console.log('\nFilters:');
const tools = (await (await get('/api/mcp-tools')).json()).tools.map((t) => t.name);
assert(!tools.includes('open_file') && tools.includes('read_pad'), 'the tool filter drops a built-in tool');
assert(tools.includes('demo_tool') && !tools.includes('demo_hidden'), 'the tool filter drops a plugin tool');
const available = (await (await get('/api/available-plugins')).json()).plugins.map((p) => p.name);
assert(!available.includes('@openwriter/plugin-x-api') && available.includes('@openwriter/plugin-publish'), 'the plugin filter hides a discovered plugin');

console.log('\nIn-process plugin:');
assert((await get('/api/demo')).status === 200, 'its routes are mounted');
assert(host && host.rootDir === dataDir && host.tools().some((t) => t.name === 'write_to_pad'), 'the host gives rootDir and the live tool list');
const { toolLabels } = await import('../dist/server/embed.js');
const read = toolLabels({ name: 'read_pad' });
assert(read.title === 'Read document' && read.annotations.readOnlyHint && !read.annotations.destructiveHint, 'a reading tool is labelled read-only');
assert(toolLabels({ name: 'delete_document' }).annotations.destructiveHint && !toolLabels({ name: 'write_to_pad' }).annotations.destructiveHint, 'deleting is destructive, writing a proposal is not');
assert(toolLabels({ name: 'set_site_plans', plugin: 'p' }).annotations.destructiveHint, 'a plugin tool that changes something is destructive');
const descriptor = (await (await get('/api/plugins')).json()).plugins.find((p) => p.name === 'demo-plugin');
assert(/^\/plugin-client\/demo-plugin\/main\.js\?v=\w+$/.test(descriptor?.clientModule ?? ''), 'its client module is listed for the browser, versioned by its build');
assert((await get(descriptor.clientModule)).status === 200, 'its client module is served');
const listed = (await (await get('/api/available-plugins')).json()).plugins.find((p) => p.name === 'demo-plugin');
assert(listed?.required === true && listed.displayName === 'Demo', 'the plugin list shows its own name and marks it required');
const disable = await fetch(`${base}/api/plugins/disable`, {
  method: 'POST', headers: { 'x-demo': 'yes', 'Content-Type': 'application/json', Origin: 'https://writer.example' }, body: JSON.stringify({ name: 'demo-plugin' }),
});
assert((await disable.json()).success === false && (await get('/api/demo')).status === 200, 'it cannot be disabled');

console.log('\nFirst-run documents:');
const opened = await (await get('/api/document')).json();
assert(opened.title === 'Welcome' && JSON.stringify(opened.document).includes('A second paragraph.'), 'a new data folder opens on the first-run document');
const welcome = join(dataDir, 'profiles', 'Default', 'Welcome.md');
rmSync(welcome);
seedFirstRunDocuments([{ title: 'Welcome', markdown: 'Hello again.' }]);
assert(!existsSync(welcome), 'a deleted first-run document is never written again');

await ow.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
