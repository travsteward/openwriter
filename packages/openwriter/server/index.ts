import { createVariant } from './document-variants.js';
/**
 * Express HTTP server: serves built React app, WebSocket, plugins.
 * MCP stdio transport is started separately in bin/pad.ts for fast startup.
 */

import express from 'express';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, readFileSync } from 'fs';
import { setupWebSocket, broadcastAgentStatus, broadcastDocumentSwitched, broadcastDocumentsChanged, broadcastWorkspacesChanged, broadcastMetadataChanged, broadcastPendingDocsChanged, broadcastSyncStatus, broadcastWritingStarted, broadcastWritingFinished, broadcastCommentsChanged, broadcastActivityLogSeed } from './ws.js';
import { TOOL_REGISTRY } from './mcp.js';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { save, cancelDebouncedSave, load, getDocument, getTitle, getFilePath, getDocId, getMetadata, getStatus, updateDocument, setMetadata, applyTextEdits, isAgentLocked, getPendingDocInfo, getDocTagsByFilename, addDocTag, removeDocTag, markAllNodesAsPending, updatePendingCacheForActiveDoc, removePendingCacheEntry, clearAllCaches, stripPendingAttrs, stripPendingAttrsFromFile, setAutoAcceptOnFile, setSortRequestOnFile, clearSortRequestOnFile, bumpDocVersion, markAsAgentStub, extractText } from './state.js';
import { syncPostHistory } from './post-sync.js';
import { enrollManualPostForAutoplug } from './autoplug-enroll.js';
import { listDocuments, switchDocument, createDocument, deleteDocument, duplicateDocument, reloadDocument, updateDocumentTitle, openFile, reorderDocs, searchDocuments, listArchivedDocuments, archiveDocument, unarchiveDocument, getActiveFilename, batchResolve, listPendingSorts } from './documents.js';
import { writePromptDebug, isPromptDebugEnabled } from './prompt-debug.js';
import { createWorkspaceRouter } from './workspace-routes.js';
import { createLinkRouter } from './link-routes.js';
import { createTweetRouter } from './tweet-routes.js';
import { markdownToTiptap } from './markdown.js';
import { importGoogleDoc } from './gdoc-import.js';
import { createVersionRouter } from './version-routes.js';
import { clearVersionsCache } from './versions.js';
import { removeDocFromAllWorkspaces } from './workspaces.js';
import { resolveDocPath, getActiveProfile, setActiveProfile, listProfiles, createProfile, deleteProfile, listTrashedProfiles, restoreProfile, saveConfig, readConfig } from './helpers.js';
import { createImageRouter } from './image-upload.js';
import { createExportRouter } from './export-routes.js';
import { createReadingRouter } from './reading-routes.js';
import { buildInfo } from './build-info.js';
import { createManuscriptRouter } from './manuscript-routes.js';
import { createConnectionRouter } from './connection-routes.js';
import { createSchedulerRouter } from './scheduler-routes.js';
import { createBillingRouter } from './billing-routes.js';
import { createTaskRouter } from './task-routes.js';
import { platformFetch, isAuthenticated } from './connections.js';
import { PluginManager } from './plugin-manager.js';
import type { PluginActionPayload } from './plugin-types.js';
import { checkForUpdate, getUpdateInfo, getCurrentVersion, getInstallType, getUpdateCommand } from './update-check.js';
import { addComment, getComments, resolveComments, unresolveComments, deleteComments, editComment } from './comments.js';
import { initLogger, logger, generateRequestId, withRequestId } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Runtime port the HTTP server is actually listening on. Set inside
// startHttpServer once the port is resolved; read by tools that need to
// construct absolute URLs (e.g. get_doc_link). Defaults to 5050 if read
// before the server has booted — matches the default option.
let runtimePort = 5050;
export function getRuntimePort(): number { return runtimePort; }
export function getBaseUrl(): string { return `http://localhost:${runtimePort}`; }

// ---- Trust boundary (anti-DNS-rebinding + CSRF) — MCP-5 ----
// The HTTP API binds to loopback and historically trusted "localhost = the
// user." That is false: with no Host/Origin validation a remote website can
// reach this API via DNS rebinding (its page rebinds a hostname to 127.0.0.1,
// the browser keeps sending the attacker's Host/Origin) and drive every
// mutating route — switch profiles, enable plugins, rewrite plugin config.
// The middleware below is the single gate for ALL routes. adr: see MCP-5.
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/** Split a Host header into hostname + optional port, handling [::1]:port. */
function splitHostHeader(hostHeader: string): { host: string; port?: string } {
  if (hostHeader.startsWith('[')) {
    const close = hostHeader.indexOf(']');
    if (close === -1) return { host: hostHeader };
    const host = hostHeader.slice(1, close);
    const rest = hostHeader.slice(close + 1);
    return { host, port: rest.startsWith(':') ? rest.slice(1) : undefined };
  }
  const colon = hostHeader.lastIndexOf(':');
  if (colon === -1) return { host: hostHeader };
  return { host: hostHeader.slice(0, colon), port: hostHeader.slice(colon + 1) };
}

/** True when the Host header names loopback on the port we are serving. */
function isAllowedHost(hostHeader: string | undefined, port: number): boolean {
  if (!hostHeader) return false;
  const { host, port: p } = splitHostHeader(hostHeader.trim());
  if (!LOOPBACK_HOSTS.has(host.toLowerCase())) return false;
  if (p !== undefined && p !== String(port)) return false;
  return true;
}

/** True when an Origin/Referer URL is same-origin (loopback on our port). */
function isAllowedOrigin(value: string | undefined, port: number): boolean {
  if (!value) return false;
  try {
    const u = new URL(value);
    if (!LOOPBACK_HOSTS.has(u.hostname.toLowerCase())) return false;
    if (u.port && u.port !== String(port)) return false;
    return true;
  } catch {
    return false;
  }
}

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Global security gate, applied before any route or body parsing.
 *  (a) Host allowlist — the anti-DNS-rebinding control.
 *  (b) Origin/Referer same-origin check on state-changing methods (CSRF).
 *      Browsers always send Origin on cross-origin POST, so a rebound page is
 *      rejected here too. A *missing* Origin is allowed only for state-changing
 *      requests from non-browser local clients (the client-mode MCP-over-HTTP
 *      proxy uses curl-style requests with no Origin); the Host gate still
 *      bounds those to loopback.
 *  (c) Restrictive security headers on every response.
 */
function securityGate(port: number) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https:",
        "font-src 'self' data:",
        "connect-src 'self' ws: wss:",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "object-src 'none'",
      ].join('; '),
    );

    if (!isAllowedHost(req.headers.host, port)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    if (STATE_CHANGING.has(req.method)) {
      const origin = req.headers.origin;
      const referer = req.headers.referer;
      if (origin) {
        if (!isAllowedOrigin(origin, port)) { res.status(403).json({ error: 'Forbidden' }); return; }
      } else if (referer) {
        if (!isAllowedOrigin(referer, port)) { res.status(403).json({ error: 'Forbidden' }); return; }
      }
      // No Origin and no Referer: non-browser local client; Host gate above
      // already constrained it to loopback. Allow.
    }

    next();
  };
}

export async function startHttpServer(options: { port?: number; noOpen?: boolean; plugins?: string[] } = {}): Promise<void> {
  const port = options.port || 5050;
  runtimePort = port;

  // Initialize structured logging first — every subsequent module call can
  // emit events from this point. Config file lives at ~/.openwriter/
  // log-config.json (missing = safe public defaults: error-only, no text).
  // adr: adr/logging-system.md
  initLogger();
  logger.info('state', 'server-boot', `OpenWriter starting on port ${port}`, { port });

  const app = express();
  // Trust boundary FIRST — reject cross-host / cross-origin before body
  // parsing or any route handler runs. Covers every route, including the
  // unauth state-changers /api/profiles/switch, /api/plugins/enable,
  // /api/plugins/config, and the universal /api/mcp-call dispatcher. MCP-5.
  app.use(securityGate(port));
  app.use(express.json({ limit: '10mb' }));
  app.get('/__build.json', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(buildInfo);
  });

  // API routes for direct HTTP access (fallback if WS not available)
  app.get('/api/status', (_req, res) => {
    res.json(getStatus());
  });

  // MCP tool metadata: lets client-mode proxies discover tools without importing mcp.js
  app.get('/api/mcp-tools', (_req, res) => {
    const tools = TOOL_REGISTRY.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: zodToJsonSchema(z.object(t.schema)),
    }));
    res.json({ tools });
  });

  // MCP-over-HTTP: allows client-mode terminals to proxy tool calls.
  // MCP-4: this dispatches ANY MCP tool with the user's platform credentials,
  // so it MUST never be reachable cross-origin. That guarantee is provided by
  // the global securityGate above (Host allowlist + Origin/Referer check on
  // POST) — a DNS-rebound page cannot satisfy either. No tool is intentionally
  // exposed beyond same-origin/local callers here; any future tool that must
  // never be driven over HTTP should be denylisted at this entry point.
  app.post('/api/mcp-call', async (req, res) => {
    const { tool: toolName, arguments: args } = req.body;
    // Wrap the call in a request ID scope so every event logged during
    // this tool invocation correlates. adr: adr/logging-system.md
    const reqId = generateRequestId(`mcp-http-${toolName || 'unknown'}`);
    await withRequestId(reqId, async () => {
      try {
        const tool = TOOL_REGISTRY.find((t) => t.name === toolName);
        if (!tool) {
          res.status(404).json({ error: `Unknown tool: ${toolName}` });
          return;
        }
        // Validate arguments against the tool's Zod schema (mirrors McpServer.validateToolInput)
        const schema = z.object(tool.schema);
        const parsed = schema.safeParse(args || {});
        if (!parsed.success) {
          res.status(400).json({ content: [{ type: 'text' as const, text: `Validation error: ${parsed.error.message}` }] });
          return;
        }
        logger.debug('mcp', 'tool-call-http', tool.name, { tool: tool.name });
        const result = await tool.handler(parsed.data);
        res.json(result);
      } catch (err: any) {
        logger.error('mcp', 'tool-error-http', `${toolName}: ${err.message}`, { tool: toolName }, err);
        res.status(500).json({ content: [{ type: 'text', text: `Error: ${err.message}` }] });
      }
    });
  });

  app.get('/api/update-info', (_req, res) => {
    const latestVersion = getUpdateInfo();
    res.json({
      updateAvailable: latestVersion,
      currentVersion: getCurrentVersion(),
      installType: getInstallType(),
      updateCommand: getUpdateCommand(),
    });
  });

  app.get('/api/document', (_req, res) => {
    res.json({ document: getDocument(), title: getTitle(), metadata: getMetadata() });
  });

  app.get('/api/pending-docs', (_req, res) => {
    res.json(getPendingDocInfo());
  });

  // Mount image upload + static serving
  app.use(createImageRouter());

  // Sync routes now provided by @openwriter/plugin-github (auto-enabled below
   // if installed). SyncButton + SyncSetupModal hit /api/sync/* unchanged.

  // Mount export routes
  app.use(createExportRouter());
  app.use(createReadingRouter());

  // Mount manuscript compile/render routes (book binding -> epub/docx/html/md)
  app.use(createManuscriptRouter());

  // Mount connection CRUD + profile binding routes
  app.use(createConnectionRouter());

  // Mount scheduler proxy routes
  app.use(createSchedulerRouter());

  // Mount billing proxy routes
  app.use(createBillingRouter());

  // Mount task CRUD routes
  app.use(createTaskRouter());

  // Newsletter analytics proxy routes
  app.get('/api/publications', async (req, res) => {
    try {
      if (!isAuthenticated()) { res.status(401).json({ error: 'Not authenticated' }); return; }
      const qs = req.query.documentId ? `?documentId=${encodeURIComponent(req.query.documentId as string)}` : '';
      const resp = await platformFetch(`/publications${qs}`);
      const data = await resp.json();
      res.status(resp.status).json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/publications/:id/stats', async (req, res) => {
    try {
      if (!isAuthenticated()) { res.status(401).json({ error: 'Not authenticated' }); return; }
      const resp = await platformFetch(`/publications/${req.params.id}/stats`);
      const data = await resp.json();
      res.status(resp.status).json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Mount version history routes
  app.use(createVersionRouter({
    getDocId,
    getFilePath,
    updateDocument,
    save,
    broadcastDocumentSwitched,
  }));

  // Update document metadata from browser (e.g. view toggle in Appearance panel)
  app.post('/api/metadata', (req, res) => {
    try {
      const body = req.body || {};
      setMetadata(body);
      save();
      broadcastMetadataChanged(getMetadata());
      broadcastDocumentsChanged();

      // Reconcile manual mark-sent with autoplug tracking. When this write
      // marks a tweet/article posted with a tweet URL, enroll the tweet so
      // engagement autoplugs fire on manual posts — including quote tweets,
      // which the X API can't post and so always reach here, never the API
      // path that already enrolls. Capture docId/text synchronously (this is
      // the active doc) then fire-and-forget; enrollment never blocks the save.
      // Honors the per-doc opt-out: `autoplug: false` skips enrollment entirely
      // (the manual lane just makes no platform call).
      const tweetUrl: string | undefined =
        body?.tweetContext?.lastPost?.tweetUrl || body?.articleContext?.lastPost?.tweetUrl;
      if (tweetUrl && getMetadata()?.autoplug !== false) {
        const docId = getDocId();
        if (docId) {
          const text = extractText(getDocument()?.content || []);
          void enrollManualPostForAutoplug(docId, tweetUrl, text);
        }
      }

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Toggle auto-accept on a document. Body: { filename, enabled }.
  // When enabling, any currently-pending changes are accepted in place so the
  // user enters a clean state — agent writes from this point commit directly.
  app.post('/api/auto-accept', (req, res) => {
    try {
      const filename = req.body?.filename as string | undefined;
      const enabled = req.body?.enabled === true;
      if (!filename) return res.status(400).json({ error: 'filename required' });

      const isActiveDoc = filename === getActiveFilename();
      if (isActiveDoc) {
        if (enabled) {
          stripPendingAttrs(); // accept any pending changes
        }
        // Explicit boolean (not delete) — false overrides workspace inheritance.
        setMetadata({ autoAccept: enabled });
        save();
        updatePendingCacheForActiveDoc();
        broadcastMetadataChanged(getMetadata());
        broadcastDocumentSwitched(getDocument(), getTitle(), getActiveFilename(), getMetadata());
      } else {
        if (enabled) stripPendingAttrsFromFile(filename, true);
        setAutoAcceptOnFile(filename, enabled);
      }
      broadcastDocumentsChanged();
      broadcastPendingDocsChanged();
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Prompt debug inspector: write the realized AV prompt to a timestamped .md doc
  // for hand review. Off by default — gated by OW_PROMPT_DEBUG (see docs/prompt-debug.md).
  // When off, no-ops so the client POST stays harmless.
  app.post('/api/prompt-debug', (req, res) => {
    try {
      if (!isPromptDebugEnabled()) { res.json({ success: false, skipped: true }); return; }
      const { action, debug, metadata } = req.body;
      if (!debug) { res.status(400).json({ error: 'debug payload is required' }); return; }
      const filename = writePromptDebug(action, debug, metadata);
      broadcastDocumentsChanged();
      res.json({ success: true, filename });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Toggle auto-accept on a workspace or container. Inherits to every doc inside.
  // Body: { wsFile, containerId?, enabled }. Omit containerId to target the
  // whole workspace; pass it to target a specific container.
  app.post('/api/auto-accept/inherit', async (req, res) => {
    try {
      const wsFile = req.body?.wsFile as string | undefined;
      const containerId = req.body?.containerId as string | undefined;
      const enabled = req.body?.enabled === true;
      if (!wsFile) return res.status(400).json({ error: 'wsFile required' });

      const { setWorkspaceAutoAccept, setContainerAutoAccept, collectFilesInWorkspace, collectFilesInContainer } = await import('./workspaces.js');

      if (containerId) {
        setContainerAutoAccept(wsFile, containerId, enabled);
      } else {
        setWorkspaceAutoAccept(wsFile, enabled);
      }

      // If enabling, sweep any in-flight pending changes on every affected doc.
      // (Pure inheritance leaves doc flags alone, but existing pending decorations
      //  should clear so the user enters a clean draft state.)
      const affected = containerId ? collectFilesInContainer(wsFile, containerId) : collectFilesInWorkspace(wsFile);
      if (enabled) {
        const activeFn = getActiveFilename();
        for (const file of affected) {
          if (file === activeFn) {
            stripPendingAttrs();
          } else {
            stripPendingAttrsFromFile(file, true);
          }
        }
        if (affected.includes(activeFn)) {
          save();
          updatePendingCacheForActiveDoc();
        }
      }

      broadcastWorkspacesChanged();
      broadcastDocumentsChanged();
      broadcastPendingDocsChanged();
      // Surface metadata change for the active doc so the editor banner updates.
      if (affected.includes(getActiveFilename())) {
        broadcastMetadataChanged(getMetadata());
      }
      res.json({ success: true, affected: affected.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Tag one or more docs as "needs sorting" — the main agent picks them up via
  // list_pending_sorts. Bulk and folder-wide sort requests are just this endpoint
  // with the appropriate filenames array; the frontend collects the file list.
  // Body: { filenames: string[] }.
  //
  // Active-doc branch: setMetadata + bumpDocVersion + save() so the in-memory
  // editor state stays in sync (writing to disk via setSortRequestOnFile would
  // trip the editor's external-write detector and reload from disk mid-edit).
  // Mirrors the /api/auto-accept pattern.
  app.post('/api/documents/sort-request', (req, res) => {
    try {
      const filenames = Array.isArray(req.body?.filenames) ? req.body.filenames as string[] : [];
      if (filenames.length === 0) return res.status(400).json({ error: 'filenames array is required' });
      const activeFn = getActiveFilename();
      const requestedAt = new Date().toISOString();
      for (const f of filenames) {
        if (f === activeFn) {
          setMetadata({ sortRequest: { requestedAt } });
          bumpDocVersion();
          save();
          broadcastMetadataChanged(getMetadata());
        } else {
          setSortRequestOnFile(f);
        }
      }
      broadcastDocumentsChanged();
      res.json({ success: true, count: filenames.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Accept a sort proposal: apply the agent's move, clear the request, stamp
  // lastSortedAt. The destination is read from the doc's stored proposal —
  // no client-supplied target so a stale UI can't move the doc somewhere wrong.
  // Body: { filename: string }.
  app.post('/api/documents/sort-accept', async (req, res) => {
    try {
      const filename = req.body?.filename as string | undefined;
      if (!filename) return res.status(400).json({ error: 'filename required' });
      const pending = listPendingSorts().find((p) => p.filename === filename);
      if (!pending) return res.status(404).json({ error: 'no pending sort for this file' });
      const proposal = pending.proposal;
      if (!proposal) return res.status(400).json({ error: 'no proposal to accept' });

      const { addDoc, moveDoc, getDocTitle, removeDocFromAllWorkspaces: removeDocFromAll, getWorkspace } = await import('./workspaces.js');
      const { findNode } = await import('./workspace-tree.js');
      const targetWs = getWorkspace(proposal.wsFilename);
      const inTarget = findNode(targetWs.root, (n: any) => n.type === 'doc' && n.file === filename);
      if (inTarget) {
        moveDoc(proposal.wsFilename, filename, proposal.containerId, null);
      } else {
        removeDocFromAll(filename);
        addDoc(proposal.wsFilename, proposal.containerId, filename, getDocTitle(filename), null);
      }
      // Clear sortRequest. Active-doc branch keeps the write in the editor's
      // in-memory pipeline (avoid external-write detection mid-edit).
      if (filename === getActiveFilename()) {
        const live = getMetadata();
        delete live.sortRequest;
        setMetadata({ lastSortedAt: new Date().toISOString() });
        bumpDocVersion();
        save();
        broadcastMetadataChanged(getMetadata());
      } else {
        clearSortRequestOnFile(filename);
      }
      broadcastWorkspacesChanged();
      broadcastDocumentsChanged();
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Reject a sort proposal (or cancel a request that hasn't been proposed yet):
  // clear the request without moving the doc. Stamps lastSortedAt either way
  // since the request is resolved. Body: { filename: string }.
  //
  // Active-doc branch matches /api/documents/sort-request — keep the write in
  // the editor's in-memory pipeline so the external-write detector doesn't fire.
  app.post('/api/documents/sort-reject', (req, res) => {
    try {
      const filename = req.body?.filename as string | undefined;
      if (!filename) return res.status(400).json({ error: 'filename required' });
      if (filename === getActiveFilename()) {
        const live = getMetadata();
        delete live.sortRequest;
        setMetadata({ lastSortedAt: new Date().toISOString() });
        bumpDocVersion();
        save();
        broadcastMetadataChanged(getMetadata());
      } else {
        clearSortRequestOnFile(filename);
      }
      broadcastDocumentsChanged();
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Set the user-authored `purpose:` hint on a workspace or container — gives
  // the sort agent a strong signal about what belongs there. Empty string clears.
  // Body: { wsFile, containerId?, purpose }.
  app.post('/api/sort-purpose', async (req, res) => {
    try {
      const wsFile = req.body?.wsFile as string | undefined;
      const containerId = req.body?.containerId as string | undefined;
      const purpose = typeof req.body?.purpose === 'string' ? req.body.purpose : '';
      if (!wsFile) return res.status(400).json({ error: 'wsFile required' });
      const { setWorkspacePurpose, setContainerPurpose } = await import('./workspaces.js');
      if (containerId) setContainerPurpose(wsFile, containerId, purpose);
      else setWorkspacePurpose(wsFile, purpose);
      broadcastWorkspacesChanged();
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/save', (_req, res) => {
    save();
    res.json({ success: true });
  });

  // Beacon-based flush: browser sends this on beforeunload/visibilitychange
  // Client sends as application/json Blob (non-CORS-safelisted, so cross-origin sendBeacon is blocked)
  app.post('/api/flush', (req, res) => {
    try {
      if (isAgentLocked(getActiveFilename())) {
        console.log('[Flush] Blocked (agent write lock active)');
        res.status(204).end();
        return;
      }
      const msg = req.body;
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

  // References: get the live computed inverse for a target docId. Returns
  // every source doc that lists this docId in its `references:` frontmatter.
  // Cached server-side; cache invalidated on any save that touches references.
  app.get('/api/backlinks/:docId', async (req, res) => {
    try {
      const { computeBacklinksFor } = await import('./backlinks.js');
      res.json(computeBacklinksFor(req.params.docId));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Author attribution (voice-shape heatmap data). Returns char-weighted
  // composition + per-node origin (human|agent|mixed|unknown) for a doc.
  // The heatmap colours the live editor by nodeOrigins; the header shows percent.
  // adr: adr/document-history-attribution.md
  app.get('/api/attribution/:docId', async (req, res) => {
    try {
      const { docId } = req.params;
      const { readBlame, summarizeBlame } = await import('./attribution.js');
      const { tiptapToBlocks } = await import('./node-blocks.js');
      let doc: any = null;
      if (getDocId() === docId) {
        doc = getDocument();
      } else {
        const { filenameByDocId } = await import('./documents.js');
        const { loadDocFromDisk } = await import('./pending-overlay.js');
        const fn = filenameByDocId(docId);
        if (fn) {
          try { doc = loadDocFromDisk(fn).document; } catch { doc = null; }
        }
      }
      const blame = readBlame(docId);
      if (!doc) {
        res.json({ tracked: blame !== null, percent: { human: 0, agent: 0, unknown: 0 }, chars: { human: 0, agent: 0, unknown: 0 }, nodeOrigins: {}, attributionSince: blame?.attributionSince ?? null });
        return;
      }
      const summary = summarizeBlame(blame, tiptapToBlocks(doc));
      res.json({ tracked: blame !== null, percent: summary.percent, chars: summary.chars, nodeOrigins: summary.nodes, attributionSince: blame?.attributionSince ?? null });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Version commits — the attributed git-history for a doc (newest first), each
  // with a one-line changeset label. adr: adr/document-history-attribution.md
  app.get('/api/commits/:docId', async (req, res) => {
    try {
      const { listCommits, summaryLine, commitSnapshotAvailable } = await import('./commits.js');
      const commits = listCommits(req.params.docId)
        .map((c) => ({ ...c, label: summaryLine(c.summary), restorable: commitSnapshotAvailable(req.params.docId, c.ts) }))
        .reverse(); // newest first for the panel
      res.json({ commits });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // One commit's attributed change detail (the per-event diff data the panel
  // renders when a commit row is expanded).
  app.get('/api/commit-detail/:docId/:ts', async (req, res) => {
    try {
      const { getCommitDetail } = await import('./commits.js');
      const detail = getCommitDetail(req.params.docId, Number(req.params.ts));
      if (!detail) { res.status(404).json({ error: 'commit not found' }); return; }
      res.json(detail);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Manual "Save version" — create a commit now with an optional note. The
  // changeset is whatever attributed edits have accrued since the last commit.
  app.post('/api/commit', async (req, res) => {
    try {
      const { docId, note } = req.body || {};
      if (!docId || typeof docId !== 'string') { res.status(400).json({ error: 'docId required' }); return; }
      // Flush the active doc so its latest edits are on disk before we snapshot.
      if (getDocId() === docId) { try { save(); } catch { /* best-effort */ } }
      const { commitFromFile } = await import('./commits.js');
      const { filenameByDocId } = await import('./documents.js');
      const { resolveDocPath } = await import('./helpers.js');
      const fn = filenameByDocId(docId);
      const commit = fn
        ? commitFromFile(docId, resolveDocPath(fn), { trigger: 'manual', actor: 'human', note: typeof note === 'string' ? note : undefined, nowTs: Date.now() })
        : null;
      res.json({ committed: commit !== null, commit });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // References: full rebuild across all docs (idempotent rescue path).
  // Walks every .md, extracts legacy prose `doc:` links from body, merges
  // their targets into `references:`, strips any legacy `backlinks:` field.
  // Idempotent — safe to re-run.
  app.post('/api/rebuild-references', async (_req, res) => {
    try {
      const { rebuildAllReferences } = await import('./backlinks.js');
      const result = rebuildAllReferences();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Legacy alias: kept for one release cycle so existing scripts/agents
  // pointing at the old path still work. Forwards to the new endpoint.
  app.post('/api/rebuild-backlinks', async (_req, res) => {
    try {
      const { rebuildAllReferences } = await import('./backlinks.js');
      const result = rebuildAllReferences();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // List a doc's block-level paragraphs/headings for the manual paragraph-target
  // picker in the right-click "Link to doc" UI. Returns nodeId + type + level +
  // a short text preview per block. Active doc reads from in-memory state; other
  // docs are parsed from disk.
  app.get('/api/documents/by-doc-id/:docId/paragraphs', async (req, res) => {
    try {
      const { resolveDocId } = await import('./documents.js');
      const filename = resolveDocId(req.params.docId);
      const activeFilename = getActiveFilename();
      let doc: any;
      if (filename === activeFilename) {
        doc = getDocument();
      } else {
        const filePath = resolveDocPath(filename);
        const raw = readFileSync(filePath, 'utf-8');
        const parsed = markdownToTiptap(raw);
        doc = parsed.document;
      }

      type ParaEntry = { nodeId: string; type: string; level?: number; preview: string };
      const out: ParaEntry[] = [];
      function walk(nodes: any[]): void {
        for (const node of nodes) {
          if (node.type === 'heading' || node.type === 'paragraph') {
            const text = (node.content || [])
              .map((c: any) => (c.type === 'text' ? (c.text || '') : ''))
              .join('')
              .trim();
            if (!text) continue; // skip empty paragraphs
            const preview = text.length > 80 ? text.slice(0, 79) + '…' : text;
            const entry: ParaEntry = { nodeId: node.attrs?.id || '', type: node.type, preview };
            if (node.type === 'heading') entry.level = node.attrs?.level || 1;
            if (entry.nodeId) out.push(entry);
          } else if (Array.isArray(node.content)) {
            walk(node.content);
          }
        }
      }
      walk(doc.content || []);
      res.json({ paragraphs: out });
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  app.get('/api/documents/:filename/text', (req, res) => {
    try {
      const filepath = resolveDocPath(req.params.filename);
      const raw = readFileSync(filepath, 'utf-8');
      // Parse YAML frontmatter
      const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
      const text = fmMatch ? fmMatch[2].trim() : raw.trim();
      let meta: Record<string, any> = {};
      if (fmMatch) {
        try { meta = JSON.parse(fmMatch[1]); } catch {}
      }
      res.json({ text, meta });
    } catch (err: any) {
      res.status(404).json({ error: 'Document not found' });
    }
  });

  app.put('/api/documents/reorder', (req, res) => {
    try {
      const { order } = req.body;
      if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be an array' });
      reorderDocs(order);
      broadcastDocumentsChanged();
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/documents', (req, res) => {
    try {
      const result = createDocument(req.body.title, req.body.content, req.body.path);

      // Apply metadata if provided (e.g. tweetContext for threadified docs)
      if (req.body.metadata) {
        setMetadata(req.body.metadata);
        save();
      }

      // Variant relationship — set masterDocId and variantType in frontmatter
      if (req.body.masterDocId || req.body.variantType) {
        const variantMeta: Record<string, any> = {};
        if (req.body.masterDocId) variantMeta.masterDocId = req.body.masterDocId;
        if (req.body.variantType) variantMeta.variantType = req.body.variantType;
        setMetadata(variantMeta);
        save();
      }

      // Plugin flags: mark all content as pending + tag as agent-created
      if (req.body.markPending) {
        markAllNodesAsPending(getDocument(), 'insert');
        updatePendingCacheForActiveDoc();
        save();
      }
      if (req.body.agentCreated) {
        // In-memory stub registry — not persisted to disk frontmatter.
        // adr: adr/agent-stub-model.md
        markAsAgentStub(result.filename);
      }

      broadcastDocumentSwitched(result.document, result.title, result.filename, undefined, req.body.agentCreated ? 'open' : 'create');
      broadcastDocumentsChanged();
      if (req.body.markPending || req.body.agentCreated) {
        broadcastPendingDocsChanged();
      }
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/documents/duplicate', (req, res) => {
    try {
      const { filename, masterDocId, variantType } = req.body;
      if (!filename) { res.status(400).json({ error: 'filename is required' }); return; }
      const result = duplicateDocument(
        filename,
        (masterDocId || variantType) ? { masterDocId, variantType } : undefined,
      );
      broadcastDocumentSwitched(result.document, result.title, result.filename);
      broadcastDocumentsChanged();
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Create variant: a retyped derivative nested under the master. Field-projection
  // (body always; title folds into body on downcast; target type scaffolded) —
  // NOT a verbatim clone (that's /duplicate). adr: docs/variants.md
  app.post('/api/documents/variant', (req, res) => {
    try {
      const { filename, masterDocId, variantType } = req.body;
      if (!filename || !masterDocId || !variantType) {
        res.status(400).json({ error: 'filename, masterDocId, and variantType are required' });
        return;
      }
      const result = createVariant(filename, { masterDocId, variantType });
      broadcastDocumentSwitched(result.document, result.title, result.filename);
      broadcastDocumentsChanged();
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/documents/batch-resolve', (req, res) => {
    try {
      const { filenames, action } = req.body;
      if (!Array.isArray(filenames) || !filenames.length) { res.status(400).json({ error: 'filenames array is required' }); return; }
      if (action !== 'accept' && action !== 'reject') { res.status(400).json({ error: 'action must be "accept" or "reject"' }); return; }
      const result = batchResolve(filenames, action);
      if (result.docsResolved > 0) {
        // Clear pending cache for resolved docs + broadcast
        for (const fn of filenames) removePendingCacheEntry(fn);
        updatePendingCacheForActiveDoc();
        broadcastPendingDocsChanged();
        broadcastDocumentsChanged();
      }
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

  // Sync browser editor content to server state — guarantees server has latest before MCP calls.
  // Used by compose modals that need to read server state via MCP tools.
  app.post('/api/documents/sync-content', (req, res) => {
    try {
      const { document: doc, filename } = req.body;
      if (!doc || !filename) {
        res.status(400).json({ error: 'document and filename required' });
        return;
      }
      if (filename === getActiveFilename()) {
        updateDocument(doc);
        save();
      }
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/documents/switch', (req, res) => {
    try {
      const alreadyActive = req.body.filename === getActiveFilename();
      const result = switchDocument(req.body.filename);
      if (!alreadyActive) {
        broadcastDocumentSwitched(result.document, result.title, result.filename);
      }
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

  app.get('/api/documents/archived', (_req, res) => {
    res.json(listArchivedDocuments());
  });

  app.get('/api/documents/search', (req, res) => {
    const q = (req.query.q as string) || '';
    const includeArchived = req.query.archived === 'true';
    res.json(searchDocuments(q, includeArchived));
  });

  app.post('/api/documents/:filename/archive', (req, res) => {
    try {
      const result = archiveDocument(req.params.filename);
      if (result.switched && result.newDoc) {
        broadcastDocumentSwitched(result.newDoc.document, result.newDoc.title, result.newDoc.filename);
      }
      broadcastDocumentsChanged();
      broadcastWorkspacesChanged();
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/documents/:filename/unarchive', (req, res) => {
    try {
      const result = unarchiveDocument(req.params.filename);
      broadcastDocumentsChanged();
      broadcastWorkspacesChanged();
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/documents/:filename/content', (req, res) => {
    try {
      const targetPath = resolveDocPath(req.params.filename);
      if (!existsSync(targetPath)) {
        res.status(404).json({ error: 'Document not found' });
        return;
      }
      const raw = readFileSync(targetPath, 'utf-8');
      const parsed = markdownToTiptap(raw);
      res.json({
        title: parsed.title,
        document: parsed.document,
        metadata: parsed.metadata,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/documents/:filename', async (req, res) => {
    try {
      const result = await deleteDocument(req.params.filename);
      removeDocFromAllWorkspaces(req.params.filename);
      if (result.switched && result.newDoc) {
        // Deletion changes editor focus, not the user's sidebar location.
        // adr: adr/sidebar-navigation-intent.md
        broadcastDocumentSwitched(result.newDoc.document, result.newDoc.title, result.newDoc.filename, undefined, 'fallback');
      }
      broadcastDocumentsChanged();
      broadcastWorkspacesChanged();
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

  // Comments (formerly "agent marks")
  app.post('/api/comments', (req, res) => {
    try {
      const { filename, text, note, nodeId, nodeIds } = req.body;
      if (!filename || !text || !nodeId) {
        res.status(400).json({ error: 'filename, text, and nodeId are required' });
        return;
      }
      const comment = addComment(filename, text, note || '', nodeId, nodeIds);
      broadcastCommentsChanged(filename);
      res.json({ success: true, comment });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/comments/:filename', (req, res) => {
    try {
      const byFile = getComments(req.params.filename);
      res.json({ comments: byFile[req.params.filename] || [] });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch('/api/comments', (req, res) => {
    try {
      const { filename, id, note } = req.body;
      if (!filename || !id || typeof note !== 'string') {
        res.status(400).json({ error: 'filename, id, and note are required' });
        return;
      }
      const comment = editComment(filename, id, note);
      if (!comment) {
        res.status(404).json({ error: 'comment not found' });
        return;
      }
      broadcastCommentsChanged(filename);
      res.json({ success: true, comment });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Permanently delete comments. Different from /resolve — this is the
  // "remove this record" path; resolve is the "addressed, archive it" path.
  app.delete('/api/comments', (req, res) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids)) {
        res.status(400).json({ error: 'ids must be an array' });
        return;
      }
      const deleted = deleteComments(ids);
      const activeFilename = getActiveFilename();
      broadcastCommentsChanged(activeFilename);
      res.json({ success: true, deleted });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Mark comments as resolved (state change, not deletion). The records
  // stay on disk; only the decoration disappears.
  app.post('/api/comments/resolve', (req, res) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids)) {
        res.status(400).json({ error: 'ids must be an array' });
        return;
      }
      const resolved = resolveComments(ids);
      const activeFilename = getActiveFilename();
      broadcastCommentsChanged(activeFilename);
      res.json({ success: true, resolved });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Clear the resolved flag — the comment surfaces again and re-decorates.
  app.post('/api/comments/unresolve', (req, res) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids)) {
        res.status(400).json({ error: 'ids must be an array' });
        return;
      }
      const cleared = unresolveComments(ids);
      const activeFilename = getActiveFilename();
      broadcastCommentsChanged(activeFilename);
      res.json({ success: true, cleared });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Mount workspace CRUD + doc/container routes
  app.use(createWorkspaceRouter({ broadcastWorkspacesChanged }));

  // Mount link-doc routes (create-link-doc, auto-tag-link)
  app.use(createLinkRouter({ broadcastDocumentsChanged, broadcastWorkspacesChanged }));

  // Mount tweet embed proxy
  app.use(createTweetRouter());

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


  // ---- Profile management ----
  app.get('/api/profiles', (_req, res) => {
    res.json({ profiles: listProfiles(), active: getActiveProfile() });
  });

  app.post('/api/profiles', (req, res) => {
    try {
      const { name } = req.body;
      if (!name?.trim()) { res.status(400).json({ error: 'name is required' }); return; }
      createProfile(name.trim());
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/profiles/switch', async (req, res) => {
    try {
      const { name } = req.body;
      if (!name?.trim()) { res.status(400).json({ error: 'name is required' }); return; }
      const profiles = listProfiles();
      if (!profiles.includes(name)) { res.status(404).json({ error: `Profile "${name}" not found` }); return; }

      // Flush current doc
      cancelDebouncedSave();
      save();

      // Switch profile
      setActiveProfile(name);
      saveConfig({ activeProfile: name });

      // Clear caches and reload
      clearAllCaches();
      clearVersionsCache();
      load();

      // Broadcast fresh state
      broadcastDocumentSwitched(getDocument(), getTitle(), getFilePath().split(/[/\\]/).pop() || '', getMetadata());
      broadcastDocumentsChanged();
      broadcastWorkspacesChanged();
      broadcastPendingDocsChanged();
      // Re-seed the Activity tab from the new profile's disk log. The buffer
      // was just cleared in clearAllCaches(); this push replaces whatever the
      // client had from the previous profile.
      broadcastActivityLogSeed();

      res.json({ success: true, active: name });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/profiles/:name', (req, res) => {
    try {
      deleteProfile(req.params.name);
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/profiles/trash', (_req, res) => {
    res.json({ profiles: listTrashedProfiles() });
  });

  app.post('/api/profiles/restore', (req, res) => {
    try {
      const { name } = req.body;
      if (!name?.trim()) { res.status(400).json({ error: 'name is required' }); return; }
      restoreProfile(name.trim());
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
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
  const savedConfig = readConfig();
  for (const [name, state] of Object.entries(savedConfig.plugins || {})) {
    if (state.enabled && !((options.plugins || []).includes(name))) {
      const result = await pluginManager.enable(name);
      if (!result.success) console.error(`[Plugin] ${result.error}`);
    }
  }

  // Migration: existing docs-sync users (config.gitConfigured === true from
  // before the github-plugin lift) get the plugin auto-enabled so /api/sync/*
  // routes keep responding. Runs once — the enable() call persists the flag
  // into config.plugins for next boot.
  const ghName = '@openwriter/plugin-github';
  if (savedConfig.gitConfigured && !savedConfig.plugins?.[ghName]?.enabled) {
    const result = await pluginManager.enable(ghName);
    if (!result.success) console.error(`[Plugin migration] ${result.error}`);
    else console.log('[Plugin migration] auto-enabled @openwriter/plugin-github for existing sync user');
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
    try {
      const result = await pluginManager.enable(name);
      res.json(result);
    } catch (err: any) {
      console.error(`[Plugin] enable(${name}) threw:`, err?.message ?? err);
      res.status(500).json({ success: false, error: err?.message ?? String(err) });
    }
  });

  // Disable a plugin
  app.post('/api/plugins/disable', async (req, res) => {
    const { name } = req.body;
    if (!name) { res.status(400).json({ error: 'name is required' }); return; }
    try {
      const result = await pluginManager.disable(name);
      res.json(result);
    } catch (err: any) {
      console.error(`[Plugin] disable(${name}) threw:`, err?.message ?? err);
      res.status(500).json({ success: false, error: err?.message ?? String(err) });
    }
  });

  // Update plugin config
  app.post('/api/plugins/config', (req, res) => {
    const { name, config } = req.body;
    if (!name || !config) { res.status(400).json({ error: 'name and config are required' }); return; }
    const result = pluginManager.updateConfig(name, config);
    res.json(result);
  });

  // Check if a specific plugin is enabled
  app.get('/api/plugins/:name/status', (req, res) => {
    const fullName = `@openwriter/plugin-${req.params.name}`;
    const all = pluginManager.getAvailablePlugins();
    const match = all.find((p) => p.name === fullName || p.name === req.params.name);
    res.json({ enabled: match?.enabled ?? false });
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

  // Sidebar context menu action dispatch — routes to plugin's registered HTTP routes
  app.post('/api/plugins/sidebar-action', async (req, res) => {
    try {
      const { action, filename, title, instructions, label } = req.body;
      if (!action || !filename) {
        res.status(400).json({ error: 'action and filename are required' });
        return;
      }
      // Action format: "pluginPrefix:actionName" — forward to plugin's route
      const colonIdx = action.indexOf(':');
      if (colonIdx === -1) {
        res.status(400).json({ error: 'action must be namespaced (e.g. "scheduler:schedule-post")' });
        return;
      }
      const prefix = action.slice(0, colonIdx);
      const actionName = action.slice(colonIdx + 1);

      // Read document content so plugins don't need to call back
      let docContent = '';
      try {
        const targetPath = resolveDocPath(filename);
        if (existsSync(targetPath)) {
          docContent = readFileSync(targetPath, 'utf-8');
        }
      } catch { /* content stays empty */ }

      // Extract source doc's docId for variant spinner positioning
      let sourceDocId: string | undefined;
      const docIdMatch = docContent.match(/"docId"\s*:\s*"([^"]+)"/);
      if (docIdMatch) sourceDocId = docIdMatch[1];

      // Show sidebar spinner while plugin processes. Unique key so concurrent
      // writes (e.g. declare_writes in flight) aren't cleared alongside this one.
      const spinnerTitle = label ? `${label}: ${title}` : title;
      const spinnerKey = `sidebar-action:${action}:${filename}:${Date.now()}`;
      broadcastWritingStarted(
        spinnerTitle,
        sourceDocId ? { wsFilename: '', containerId: null, parentDocId: sourceDocId } : undefined,
        spinnerKey,
        filename,
        sourceDocId,
      );

      // Intercept res.json to clear spinner when plugin handler responds
      const origJson = res.json.bind(res);
      res.json = (body: any) => {
        broadcastWritingFinished(spinnerKey);
        return origJson(body);
      };

      // Forward to plugin route: POST /api/{prefix}/sidebar-action
      // Re-route the request through Express's internal router
      req.url = `/api/${prefix}/sidebar-action`;
      req.body = { action: actionName, filename, title, instructions, content: docContent };
      (app as any).handle(req, res, () => {
        broadcastWritingFinished(spinnerKey);
        res.status(404).json({ error: `No handler registered for action "${action}"` });
      });
    } catch (err: any) {
      // spinnerKey is out of scope here (try body may have thrown before it
      // was declared). The 60s timeout on the server entry cleans it up.
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
  }

  const server = createServer(app);

  // Setup WebSocket on same server
  setupWebSocket(server);

  // Broadcast agent status now that WS is ready
  broadcastAgentStatus(true);

  await new Promise<void>((resolve, reject) => {
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`[HTTP] Port ${port} in use — retrying in 2s...`);
        setTimeout(() => {
          server.listen(port, '127.0.0.1', () => {
            console.log(`OpenWriter running at http://localhost:${port}`);
            resolve();
          });
        }, 2000);
      } else {
        console.error(`[HTTP] Server error:`, err);
        reject(err);
      }
    });
    server.listen(port, '127.0.0.1', () => {
      console.log(`OpenWriter running at http://localhost:${port}`);
      resolve();
    });
  });

  // Sync post history from platform (catch posts made while app was closed)
  syncPostHistory().catch(() => {});

  // Heal stale references frontmatter on every boot. Older docs that were
  // written before the prose-link sync pipeline existed (or imported from
  // legacy formats) may have prose `doc:` links in body but no matching
  // `references:` array in frontmatter — which makes the inverse-index scan
  // return zero inbounds for their targets. One-shot rescan + write is
  // idempotent and finishes in <1s for ~200-doc corpora; runs in background
  // so it never blocks the listen.
  (async () => {
    try {
      const { rebuildAllReferences } = await import('./backlinks.js');
      const result = rebuildAllReferences();
      if (result.updated > 0) {
        console.log(`[Boot] Healed references frontmatter on ${result.updated}/${result.scanned} docs`);
      }
    } catch (err) {
      console.error('[Boot] rebuildAllReferences failed:', err);
    }
  })();

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
