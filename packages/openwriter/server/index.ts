/**
 * Express server: serves built React app, WebSocket, orchestrates MCP.
 */

import express from 'express';
import { createServer } from 'http';
import { createConnection } from 'net';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import { setupWebSocket, broadcastAgentStatus, broadcastDocumentSwitched, broadcastDocumentsChanged, broadcastWorkspacesChanged, broadcastPendingDocsChanged, broadcastSyncStatus } from './ws.js';
import { startMcpServer, TOOL_REGISTRY } from './mcp.js';
import { startMcpClientServer } from './mcp-client.js';
import { load, save, getDocument, getTitle, getFilePath, getDocId, getStatus, updateDocument, setMetadata, applyTextEdits, isAgentLocked, getPendingDocFilenames, getPendingDocCounts, getDocTagsByFilename, addDocTag, removeDocTag } from './state.js';
import { listDocuments, switchDocument, createDocument, deleteDocument, reloadDocument, updateDocumentTitle, openFile } from './documents.js';
import { createWorkspaceRouter } from './workspace-routes.js';
import { createLinkRouter } from './link-routes.js';
import { markdownToTiptap } from './markdown.js';
import { importGoogleDoc } from './gdoc-import.js';
import { createVersionRouter } from './version-routes.js';
import { createSyncRouter } from './sync-routes.js';
import { createImageRouter } from './image-upload.js';
import { createExportRouter } from './export-routes.js';
import { PluginManager } from './plugin-manager.js';
import type { PluginActionPayload } from './plugin-types.js';
import { checkForUpdate } from './update-check.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function isPortTaken(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: '127.0.0.1' });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => { resolve(false); });
  });
}

export async function startServer(options: { port?: number; noOpen?: boolean; plugins?: string[] } = {}): Promise<void> {
  const port = options.port || 5050;

  // Check if another instance already owns the port
  const portTaken = await isPortTaken(port);
  if (portTaken) {
    console.error(`[OpenWriter] Port ${port} in use — entering client mode (proxying to existing server)`);
    // Start client-mode MCP (proxies tool calls via HTTP)
    startMcpClientServer(port).catch((err) => {
      console.error('[MCP-Client] Failed to start:', err);
    });
    // Skip browser open — existing server already has it open
    return;
  }

  // Load saved document
  load();

  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // API routes for direct HTTP access (fallback if WS not available)
  app.get('/api/status', (_req, res) => {
    res.json(getStatus());
  });

  // MCP-over-HTTP: allows client-mode terminals to proxy tool calls
  app.post('/api/mcp-call', async (req, res) => {
    try {
      const { tool: toolName, arguments: args } = req.body;
      const tool = TOOL_REGISTRY.find((t) => t.name === toolName);
      if (!tool) {
        res.status(404).json({ error: `Unknown tool: ${toolName}` });
        return;
      }
      const result = await tool.handler(args || {});
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ content: [{ type: 'text', text: `Error: ${err.message}` }] });
    }
  });

  app.get('/api/document', (_req, res) => {
    res.json({ document: getDocument(), title: getTitle() });
  });

  app.get('/api/pending-docs', (_req, res) => {
    res.json({
      filenames: getPendingDocFilenames(),
      counts: getPendingDocCounts(),
    });
  });

  // Mount image upload + static serving
  app.use(createImageRouter());

  // Mount sync routes
  app.use(createSyncRouter(broadcastSyncStatus));

  // Mount export routes
  app.use(createExportRouter());

  // Mount version history routes
  app.use(createVersionRouter({
    getDocId,
    getFilePath,
    updateDocument,
    save,
    broadcastDocumentSwitched,
  }));

  app.post('/api/save', (_req, res) => {
    save();
    res.json({ success: true });
  });

  // Beacon-based flush: browser sends this on beforeunload/visibilitychange
  // sendBeacon sends as text/plain, so we parse the JSON manually
  app.post('/api/flush', express.text({ type: '*/*', limit: '10mb' }), (req, res) => {
    try {
      if (isAgentLocked()) {
        console.log('[Flush] Blocked (agent write lock active)');
        res.status(204).end();
        return;
      }
      const msg = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (msg.document) {
        updateDocument(msg.document);
        save();
      } else if (msg.markdown) {
        const parsed = markdownToTiptap(msg.markdown);
        updateDocument(parsed.document);
        if (parsed.title !== 'Untitled') setMetadata({ title: parsed.title });
        save();
      }
      res.status(204).end();
    } catch {
      res.status(400).end();
    }
  });

  // Document CRUD routes
  app.get('/api/documents', (_req, res) => {
    res.json(listDocuments());
  });

  app.post('/api/documents', (req, res) => {
    try {
      const result = createDocument(req.body.title, req.body.content, req.body.path);
      broadcastDocumentSwitched(result.document, result.title, result.filename);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/documents/open', (req, res) => {
    try {
      const { path } = req.body;
      if (!path) {
        res.status(400).json({ error: 'path is required' });
        return;
      }
      const result = openFile(path);
      broadcastDocumentSwitched(result.document, result.title, result.filename);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/documents/switch', (req, res) => {
    try {
      const result = switchDocument(req.body.filename);
      broadcastDocumentSwitched(result.document, result.title, result.filename);
      res.json(result);
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  app.post('/api/documents/reload', (_req, res) => {
    try {
      const result = reloadDocument();
      broadcastDocumentSwitched(result.document, result.title, result.filename);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/documents/:filename', async (req, res) => {
    try {
      const result = await deleteDocument(req.params.filename);
      if (result.switched && result.newDoc) {
        broadcastDocumentSwitched(result.newDoc.document, result.newDoc.title, result.newDoc.filename);
      } else {
        broadcastDocumentsChanged();
      }
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.put('/api/documents/:filename', (req, res) => {
    try {
      // Title change = metadata only. Filename stays stable.
      updateDocumentTitle(req.params.filename, req.body.title);
      broadcastDocumentsChanged();
      res.json({ filename: req.params.filename });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Document-level tag routes
  app.get('/api/doc-tags/:filename', (req, res) => {
    res.json({ tags: getDocTagsByFilename(req.params.filename) });
  });

  app.post('/api/doc-tags/:filename', (req, res) => {
    try {
      const { tag } = req.body;
      if (!tag?.trim()) { res.status(400).json({ error: 'tag is required' }); return; }
      addDocTag(req.params.filename, tag.trim());
      broadcastDocumentsChanged();
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete('/api/doc-tags/:filename/:tag', (req, res) => {
    try {
      removeDocTag(req.params.filename, req.params.tag);
      broadcastDocumentsChanged();
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Mount workspace CRUD + doc/container routes
  app.use(createWorkspaceRouter({ broadcastWorkspacesChanged }));

  // Mount link-doc routes (create-link-doc, auto-tag-link)
  app.use(createLinkRouter({ broadcastDocumentsChanged, broadcastWorkspacesChanged }));

  // Text edit (fine-grained find/replace + mark changes within a node)
  app.post('/api/edit-text', (req, res) => {
    try {
      const { nodeId, edits } = req.body;
      if (!nodeId || !edits) {
        res.status(400).json({ error: 'nodeId and edits are required' });
        return;
      }
      const result = applyTextEdits(nodeId, edits);
      if (!result.success) {
        res.status(400).json({ error: result.error });
        return;
      }
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Google Doc import
  app.post('/api/import/gdoc', (req, res) => {
    try {
      const result = importGoogleDoc(req.body.document, req.body.title);
      broadcastDocumentsChanged();
      broadcastWorkspacesChanged();
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Plugin Manager — discover, enable/disable, config persistence
  const pluginManager = new PluginManager(app);
  await pluginManager.discover();

  // Auto-enable from --plugins CLI flag
  for (const name of (options.plugins || [])) {
    const result = await pluginManager.enable(name);
    if (!result.success) console.error(`[Plugin] ${result.error}`);
  }

  // Auto-enable from saved config.json
  const savedConfig = (await import('./helpers.js')).readConfig();
  for (const [name, state] of Object.entries(savedConfig.plugins || {})) {
    if (state.enabled && !((options.plugins || []).includes(name))) {
      const result = await pluginManager.enable(name);
      if (!result.success) console.error(`[Plugin] ${result.error}`);
    }
  }

  // Enabled plugins' context menu items (backward-compatible)
  app.get('/api/plugins', (_req, res) => {
    res.json({ plugins: pluginManager.getEnabledPluginDescriptors() });
  });

  // All discovered plugins with enabled status, configSchema, current config
  app.get('/api/available-plugins', (_req, res) => {
    res.json({ plugins: pluginManager.getAvailablePlugins() });
  });

  // Enable a plugin
  app.post('/api/plugins/enable', async (req, res) => {
    const { name } = req.body;
    if (!name) { res.status(400).json({ error: 'name is required' }); return; }
    const result = await pluginManager.enable(name);
    res.json(result);
  });

  // Disable a plugin
  app.post('/api/plugins/disable', async (req, res) => {
    const { name } = req.body;
    if (!name) { res.status(400).json({ error: 'name is required' }); return; }
    const result = await pluginManager.disable(name);
    res.json(result);
  });

  // Update plugin config
  app.post('/api/plugins/config', (req, res) => {
    const { name, config } = req.body;
    if (!name || !config) { res.status(400).json({ error: 'name and config are required' }); return; }
    const result = pluginManager.updateConfig(name, config);
    res.json(result);
  });

  // Plugin action dispatch — client sends action payload, routed to correct plugin
  app.post('/api/plugin-action', async (req, res) => {
    try {
      const payload = req.body as PluginActionPayload;
      res.status(404).json({ error: 'Use plugin-registered routes directly' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Serve built React app
  const clientDir = join(__dirname, '..', 'client');
  if (existsSync(clientDir)) {
    app.use(express.static(clientDir));
    app.get('*', (_req, res) => {
      res.sendFile(join(clientDir, 'index.html'));
    });
  } else {
    // Dev mode: proxy to Vite
    app.get('/', (_req, res) => {
      res.send(`
        <html>
          <body style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif">
            <div style="text-align:center">
              <h2>OpenWriter Server Running</h2>
              <p>In development, run <code>npm run dev:client</code> and visit <a href="http://localhost:5173">localhost:5173</a></p>
            </div>
          </body>
        </html>
      `);
    });
  }

  const server = createServer(app);

  // Setup WebSocket on same server
  setupWebSocket(server);

  // Start MCP stdio server (for agent connections)
  startMcpServer().then(() => {
    broadcastAgentStatus(true);
  }).catch((err) => {
    console.error('[MCP] Failed to start:', err);
  });

  server.listen(port, () => {
    console.log(`OpenWriter running at http://localhost:${port}`);
  });

  // Open browser unless --no-open or running as MCP stdio pipe
  const isMcpStdio = !process.stdout.isTTY;
  if (!options.noOpen && !isMcpStdio) {
    const open = await import('open');
    const url = existsSync(clientDir)
      ? `http://localhost:${port}`
      : 'http://localhost:5173';
    open.default(url).catch(() => {});
  }

  // Fire-and-forget update check (primary server only — client mode returns early above)
  checkForUpdate().catch(() => {});
}
