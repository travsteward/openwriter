import { useCallback, useEffect, useRef, useState } from 'react';

export interface NodeChange {
  operation: 'rewrite' | 'insert' | 'delete';
  nodeId?: string;
  afterNodeId?: string;
  content?: any;
}

interface WebSocketMessage {
  type: string;
  changes?: NodeChange[];
  agentConnected?: boolean;
  [key: string]: any;
}

export interface DocumentSwitchedPayload {
  document: any;
  title: string;
  filename: string;
  docId?: string;
}

export interface PendingDocsPayload {
  filenames: string[];
  counts: Record<string, number>;
}

export interface SyncStatus {
  state: 'unconfigured' | 'synced' | 'pending' | 'syncing' | 'error';
  lastSyncTime?: string;
  pendingFiles?: number;
  error?: string;
}

interface UseWebSocketOptions {
  onNodeChanges?: (changes: NodeChange[]) => void;
  onAgentStatus?: (connected: boolean) => void;
  onDocumentSwitched?: (payload: DocumentSwitchedPayload) => void;
  onDocumentsChanged?: () => void;
  onWorkspacesChanged?: () => void;
  onTitleChanged?: (title: string) => void;
  onPendingDocsChanged?: (data: PendingDocsPayload) => void;
  onSyncStatus?: (status: SyncStatus) => void;
  /** Called on reconnect so the app can re-sync editor state to server */
  getEditorState?: () => { document: any } | null;
}

export function useWebSocket({ onNodeChanges, onAgentStatus, onDocumentSwitched, onDocumentsChanged, onWorkspacesChanged, onTitleChanged, onPendingDocsChanged, onSyncStatus, getEditorState }: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);

  // Store callbacks in refs to avoid reconnection on every render
  const onNodeChangesRef = useRef(onNodeChanges);
  const onAgentStatusRef = useRef(onAgentStatus);
  const onDocumentSwitchedRef = useRef(onDocumentSwitched);
  const onDocumentsChangedRef = useRef(onDocumentsChanged);
  const onWorkspacesChangedRef = useRef(onWorkspacesChanged);
  const onTitleChangedRef = useRef(onTitleChanged);
  const onPendingDocsChangedRef = useRef(onPendingDocsChanged);
  const onSyncStatusRef = useRef(onSyncStatus);
  const getEditorStateRef = useRef(getEditorState);
  onNodeChangesRef.current = onNodeChanges;
  onAgentStatusRef.current = onAgentStatus;
  onDocumentSwitchedRef.current = onDocumentSwitched;
  onDocumentsChangedRef.current = onDocumentsChanged;
  onWorkspacesChangedRef.current = onWorkspacesChanged;
  onTitleChangedRef.current = onTitleChanged;
  onPendingDocsChangedRef.current = onPendingDocsChanged;
  onSyncStatusRef.current = onSyncStatus;
  getEditorStateRef.current = getEditorState;

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let hasConnectedBefore = false;

    function connect() {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);

        // On reconnect (not first connect), pull fresh state from server
        // (server is authoritative — never push stale browser state)
        if (hasConnectedBefore) {
          ws.send(JSON.stringify({ type: 'request-document' }));
        }
        hasConnectedBefore = true;
      };

      ws.onmessage = (event) => {
        try {
          const msg: WebSocketMessage = JSON.parse(event.data);

          if (msg.type === 'node-changes' && msg.changes) {
            onNodeChangesRef.current?.(msg.changes);
          }

          if (msg.type === 'agent-status') {
            onAgentStatusRef.current?.(!!msg.agentConnected);
          }

          if (msg.type === 'document-switched') {
            onDocumentSwitchedRef.current?.({
              document: msg.document,
              title: msg.title,
              filename: msg.filename,
              docId: msg.docId,
            });
          }

          if (msg.type === 'documents-changed') {
            onDocumentsChangedRef.current?.();
          }

          if (msg.type === 'workspaces-changed') {
            onWorkspacesChangedRef.current?.();
          }

          if (msg.type === 'title-changed' && msg.title) {
            onTitleChangedRef.current?.(msg.title);
          }

          if (msg.type === 'pending-docs-changed' && msg.pendingDocs) {
            onPendingDocsChangedRef.current?.(msg.pendingDocs);
          }

          if (msg.type === 'sync-status') {
            onSyncStatusRef.current?.({ state: msg.state, lastSyncTime: msg.lastSyncTime, pendingFiles: msg.pendingFiles, error: msg.error });
          }

          if (msg.type === 'plugins-changed') {
            window.dispatchEvent(new CustomEvent('ow-plugins-changed'));
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => {
        setConnected(false);
        reconnectTimer = setTimeout(connect, 2000);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, []); // Stable — no deps, callbacks via refs

  const sendMessage = useCallback((msg: Record<string, any>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  return { connected, sendMessage };
}
