/**
 * WebSocket handler: pushes NodeChanges to browser, receives doc updates + signals.
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import {
  updateDocument,
  getDocument,
  getTitle,
  getFilePath,
  getDocId,
  getMetadata,
  setMetadata,
  save,
  onChanges,
  isAgentLocked,
  getPendingDocInfo,
  updatePendingCacheForActiveDoc,
  stripPendingAttrs,
  saveDocToFile,
  stripPendingAttrsFromFile,
  type NodeChange,
} from './state.js';
import { switchDocument, createDocument, deleteDocument, getActiveFilename } from './documents.js';
import { removeDocFromAllWorkspaces } from './workspaces.js';

const clients = new Set<WebSocket>();
let currentAgentConnected = false;

// Debounced auto-save: persist to disk 2s after last doc-update
let saveTimer: ReturnType<typeof setTimeout> | null = null;
function debouncedSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    save();
    console.log('[WS] Auto-saved to disk');
  }, 2000);
}

// Debounced sidebar refresh: notify clients after title changes settle
let docsChangedTimer: ReturnType<typeof setTimeout> | null = null;
function debouncedBroadcastDocumentsChanged(): void {
  if (docsChangedTimer) clearTimeout(docsChangedTimer);
  docsChangedTimer = setTimeout(() => {
    broadcastDocumentsChanged();
  }, 2100);
}

export function setupWebSocket(server: Server): void {
  const wss = new WebSocketServer({ server });

  // Push agent changes to all browser clients
  onChanges((changes: NodeChange[]) => {
    const msg = JSON.stringify({ type: 'node-changes', changes });
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(msg);
      }
    }
    // Notify browser of updated pending docs list (debounced)
    broadcastPendingDocsChanged();
  });

  wss.on('connection', (ws) => {
    clients.add(ws);
    console.log(`[WS] Client connected (total: ${clients.size})`);

    // Send current agent status to newly connected client
    ws.send(JSON.stringify({ type: 'agent-status', agentConnected: currentAgentConnected }));

    // Send current sync status if available
    if (lastSyncStatus) {
      ws.send(JSON.stringify({ type: 'sync-status', ...lastSyncStatus }));
    }

    // Always send authoritative document state on connect — forces browser to adopt server state
    // (prevents stale browser tabs from displaying old content)
    const filePath = getFilePath();
    const filename = filePath ? filePath.split(/[/\\]/).pop() || '' : '';
    ws.send(JSON.stringify({
      type: 'document-switched',
      document: getDocument(),
      title: getTitle(),
      filename,
      docId: getDocId(),
      metadata: getMetadata(),
    }));

    // Send pending docs info on connect
    ws.send(JSON.stringify({
      type: 'pending-docs-changed',
      pendingDocs: getPendingDocInfo(),
    }));

    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString());

        if (msg.type === 'doc-update' && msg.document) {
          if (isAgentLocked()) {
            // Agent write in progress — ignore browser doc-updates
          } else if (msg.filename && msg.filename !== getActiveFilename()) {
            // Browser sent a doc-update for a different document (race: server switched away).
            // Save directly to that file on disk instead of corrupting the active doc.
            saveDocToFile(msg.filename, msg.document);
          } else {
            updateDocument(msg.document);
            updatePendingCacheForActiveDoc(); // Keep cache in sync after browser edits/reject-all
            debouncedSave();
          }
        }

        // Browser requests fresh state on reconnect (instead of pushing stale state)
        if (msg.type === 'request-document') {
          const filePath = getFilePath();
          const filename = filePath ? filePath.split(/[/\\]/).pop() || '' : '';
          ws.send(JSON.stringify({
            type: 'document-switched',
            document: getDocument(),
            title: getTitle(),
            filename,
            docId: getDocId(),
            metadata: getMetadata(),
          }));
        }

        if (msg.type === 'title-update' && msg.title) {
          setMetadata({ title: msg.title });
          debouncedSave();
          debouncedBroadcastDocumentsChanged();
        }

        if (msg.type === 'save') {
          save();
        }

        if (msg.type === 'switch-document' && msg.filename) {
          try {
            const result = switchDocument(msg.filename);
            broadcastDocumentSwitched(result.document, result.title, result.filename);
          } catch (err: any) {
            console.error('[WS] Switch document failed:', err.message);
          }
        }

        if (msg.type === 'create-document') {
          try {
            const result = createDocument(msg.title);
            broadcastDocumentSwitched(result.document, result.title, result.filename);
          } catch (err: any) {
            console.error('[WS] Create document failed:', err.message);
          }
        }

        if (msg.type === 'create-template' && msg.template) {
          try {
            const tmpl = msg.template as string;
            const url = msg.url as string | undefined;

            // Create with no title → temp file path (avoids naming conflicts)
            const result = createDocument();

            // Set template-appropriate metadata
            if (tmpl === 'tweet') {
              setMetadata({ tweetContext: { mode: 'tweet' }, title: 'Tweet' });
            } else if (tmpl === 'reply') {
              setMetadata({ tweetContext: { url, mode: 'reply' }, title: 'Reply' });
            } else if (tmpl === 'quote') {
              setMetadata({ tweetContext: { url, mode: 'quote' }, title: 'Quote Tweet' });
            } else if (tmpl === 'article') {
              setMetadata({ articleContext: { active: true }, title: 'Article' });
            }

            save();
            broadcastDocumentSwitched(result.document, getTitle(), result.filename, getMetadata());
            broadcastDocumentsChanged();
          } catch (err: any) {
            console.error('[WS] Create template failed:', err.message);
          }
        }

        if (msg.type === 'pending-resolved' && msg.filename) {
          const action = msg.action as string; // 'accept' or 'reject'
          const resolvedFilename = msg.filename as string;
          const isActiveDoc = resolvedFilename === getActiveFilename();

          // Get metadata from the correct source (active state or disk file)
          const metadata = isActiveDoc ? getMetadata() : null;

          if (action === 'reject' && metadata?.agentCreated) {
            // Agent-created doc with all content rejected → delete the file
            // Cancel debounced save (doc-update may have queued one for the now-empty doc)
            if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
            try {
              // Remove from any workspace manifests before deleting the file
              removeDocFromAllWorkspaces(resolvedFilename);
              const result = await deleteDocument(resolvedFilename);
              if (result.switched && result.newDoc) {
                broadcastDocumentSwitched(result.newDoc.document, result.newDoc.title, result.newDoc.filename);
              }
              broadcastDocumentsChanged();
              broadcastWorkspacesChanged();
              broadcastPendingDocsChanged();
              return; // File deleted — no strip/save needed
            } catch (err: any) {
              console.error('[WS] Failed to delete rejected agent doc:', err.message);
              // Fall through to normal strip+save (e.g. only doc remaining)
            }
          }

          if (isActiveDoc) {
            // Normal path: resolved doc is the active one
            if (action === 'accept' && metadata?.agentCreated) {
              delete metadata.agentCreated;
            }
            stripPendingAttrs();
            save();
          } else {
            // Race path: resolved doc is NOT the active one (server switched away).
            // Strip pending attrs directly from the file on disk.
            stripPendingAttrsFromFile(resolvedFilename, action === 'accept');
          }
          broadcastPendingDocsChanged();
        }
      } catch {
        // Ignore malformed messages
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      console.log(`[WS] Client disconnected (total: ${clients.size})`);
    });
  });
}

export function broadcastDocumentSwitched(document: any, title: string, filename: string, metadata?: Record<string, any>): void {
  const msg = JSON.stringify({ type: 'document-switched', document, title, filename, docId: getDocId(), metadata: metadata ?? getMetadata() });
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
}

export function broadcastMetadataChanged(metadata: Record<string, any>): void {
  const msg = JSON.stringify({ type: 'metadata-changed', metadata });
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

export function broadcastDocumentsChanged(): void {
  const msg = JSON.stringify({ type: 'documents-changed' });
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
}

export function broadcastWorkspacesChanged(): void {
  const msg = JSON.stringify({ type: 'workspaces-changed' });
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

export function broadcastTitleChanged(title: string): void {
  const msg = JSON.stringify({ type: 'title-changed', title });
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

// Debounced: coalesces rapid agent writes into a single broadcast.
let pendingDocsTimer: ReturnType<typeof setTimeout> | null = null;
const PENDING_DOCS_DEBOUNCE_MS = 500;

export function broadcastPendingDocsChanged(): void {
  if (pendingDocsTimer) clearTimeout(pendingDocsTimer);
  pendingDocsTimer = setTimeout(() => {
    pendingDocsTimer = null;
    const msg = JSON.stringify({
      type: 'pending-docs-changed',
      pendingDocs: getPendingDocInfo(),
    });
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    }
  }, PENDING_DOCS_DEBOUNCE_MS);
}

export function broadcastPluginsChanged(): void {
  const msg = JSON.stringify({ type: 'plugins-changed' });
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

export function broadcastAgentStatus(connected: boolean): void {
  currentAgentConnected = connected;
  const msg = JSON.stringify({ type: 'agent-status', agentConnected: connected });
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
}

let lastSyncStatus: any = null;

// Safety net: auto-clear spinner if writing-finished never arrives
let writingTimer: ReturnType<typeof setTimeout> | null = null;
const WRITING_TIMEOUT_MS = 60_000;

export function broadcastWritingStarted(title: string, target?: { wsFilename: string; containerId: string | null }): void {
  if (writingTimer) clearTimeout(writingTimer);
  writingTimer = setTimeout(() => {
    console.log('[WS] Writing spinner timed out — auto-clearing');
    broadcastWritingFinished();
  }, WRITING_TIMEOUT_MS);
  const msg = JSON.stringify({ type: 'writing-started', title, target: target || null });
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

export function broadcastWritingFinished(): void {
  if (writingTimer) { clearTimeout(writingTimer); writingTimer = null; }
  const msg = JSON.stringify({ type: 'writing-finished' });
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

export function broadcastSyncStatus(status: any): void {
  lastSyncStatus = status;
  const msg = JSON.stringify({ type: 'sync-status', ...status });
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
}
