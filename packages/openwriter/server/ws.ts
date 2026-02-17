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
  setMetadata,
  save,
  onChanges,
  isAgentLocked,
  getPendingDocFilenames,
  getPendingDocCounts,
  stripPendingAttrs,
  type NodeChange,
} from './state.js';
import { switchDocument, createDocument, deleteDocument } from './documents.js';

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
    }));

    // Send pending docs info on connect
    ws.send(JSON.stringify({
      type: 'pending-docs-changed',
      pendingDocs: {
        filenames: getPendingDocFilenames(),
        counts: getPendingDocCounts(),
      },
    }));

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());

        if (msg.type === 'doc-update' && msg.document) {
          if (isAgentLocked()) {
            // Agent write in progress — ignore browser doc-updates
          } else {
            updateDocument(msg.document);
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
          }));
        }

        if (msg.type === 'title-update' && msg.title) {
          setMetadata({ title: msg.title });
          debouncedSave();
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

        if (msg.type === 'pending-resolved' && msg.filename) {
          const action = msg.action as string; // 'accept' or 'reject'
          const resolvedFilename = msg.filename as string;

          if (action === 'reject' && msg.wasAgentCreated) {
            // Agent-created doc with all content rejected → delete the file
            try {
              deleteDocument(resolvedFilename);
            } catch (err: any) {
              console.error('[WS] Failed to delete rejected agent doc:', err.message);
            }
          }

          // Strip pending attrs that transferPendingAttrs() re-added from stale server state,
          // then save clean markdown to disk.
          stripPendingAttrs();
          save();
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

export function broadcastDocumentSwitched(document: any, title: string, filename: string): void {
  const msg = JSON.stringify({ type: 'document-switched', document, title, filename, docId: getDocId() });
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
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

// Debounced: getPendingDocCounts() scans all files on disk + parses YAML.
// Rapid agent writes would trigger this scan on every change batch.
let pendingDocsTimer: ReturnType<typeof setTimeout> | null = null;
const PENDING_DOCS_DEBOUNCE_MS = 500;

export function broadcastPendingDocsChanged(): void {
  if (pendingDocsTimer) clearTimeout(pendingDocsTimer);
  pendingDocsTimer = setTimeout(() => {
    pendingDocsTimer = null;
    const msg = JSON.stringify({
      type: 'pending-docs-changed',
      pendingDocs: {
        filenames: getPendingDocFilenames(),
        counts: getPendingDocCounts(),
      },
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

export function broadcastSyncStatus(status: any): void {
  lastSyncStatus = status;
  const msg = JSON.stringify({ type: 'sync-status', ...status });
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
}

export function getLastSyncStatus(): any {
  return lastSyncStatus;
}
