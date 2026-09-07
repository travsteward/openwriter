// Run only against the disposable UX fixture server, never the normal profile.
import assert from 'node:assert/strict';
const origin = process.argv[2];
if (!origin) throw new Error('Pass the isolated fixture origin.');
async function request(path, method = 'GET', body) {
  const response = await fetch(origin + path, {
    method, headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json();
  assert.ok(response.ok, `${method} ${path}: ${JSON.stringify(result)}`);
  return result;
}
const profiles = await request('/api/profiles');
assert.match(profiles.active, /^qa-ux-fixes-/, 'Refusing to mutate a non-fixture profile');
const prefix = `UX HTTP ${Date.now()}`;
const files = [];
let workspace;
try {
  workspace = await request('/api/workspaces', 'POST', { title: prefix });
  const wsPath = `/api/workspaces/${encodeURIComponent(workspace.filename)}`;
  const folder = await request(`${wsPath}/containers`, 'POST', { name: 'Research' });
  for (const suffix of ['A', 'B']) {
    const doc = await request('/api/documents', 'POST', { title: `${prefix} ${suffix}`, content: `# ${suffix}\n\nDisposable verification text.` });
    files.push(doc.filename);
    await request(`${wsPath}/docs`, 'POST', { file: doc.filename, title: doc.title, containerId: folder.containerId });
  }
  const before = (await request(wsPath)).root;
  await request(`/api/documents/${encodeURIComponent(files[0])}/archive`, 'POST');
  assert.equal((await request(wsPath)).root[0].items.length, 1);
  await request(`/api/documents/${encodeURIComponent(files[0])}/unarchive`, 'POST');
  assert.deepEqual((await request(wsPath)).root, before, 'HTTP archive preserves original folder and order');
  const results = await request(`/api/documents/search?q=${encodeURIComponent(prefix)}&archived=true`);
  assert.equal(results.filter(r => r.isArchived).length, 0);
  assert.equal(results.length, 2);
  console.log('PASS: HTTP archive/restore preserves placement and exposes refreshed search state');
} finally {
  for (const file of files) await request(`/api/documents/${encodeURIComponent(file)}`, 'DELETE');
  if (workspace) await request(`/api/workspaces/${encodeURIComponent(workspace.filename)}`, 'DELETE');
}
