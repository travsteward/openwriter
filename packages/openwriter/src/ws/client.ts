import { useCallback, useEffect, useRef, useState } from 'react';
import { showToast } from '../utils/toast';

export interface NodeChange {
  operation: 'rewrite' | 'insert' | 'delete';
  nodeId?: string;
  afterNodeId?: string;
  content?: any;
  /** Server signal: this change committed directly (no pending decoration).
   *  Bridge applies it as a normal edit, not a review item. */
  autoAccept?: boolean;
}

interface WebSocketMessage {
  type: string;
  changes?: NodeChange[];
  agentConnected?: boolean;
  [key: string]: any;
}

export interface DocumentSwitchedPayload {
  navigation?: 'open' | 'fallback' | 'create';
  document: any;
  title: string;
  filename: string;
  docId?: string;
  metadata?: Record<string, any>;
  /** Pending metadata staged for this doc (currently just title). When the
   *  client receives this on a switch, it should render the title-bar inline
   *  diff immediately so the review state is visible without waiting for a
   *  separate pending-metadata-changed broadcast.
   *  adr: adr/pending-overlay-model.md */
  pendingMetadata?: { title?: { from: string; to: string } } | null;
}

/**
 * Sent when the server's fs.watch detected an external write to the
 * active doc (Edit tool, VSCode, a script). The browser should swap
 * its TipTap state to match, then surface a transient notification so
 * the user knows the content under their cursor was just reloaded.
 *
 * Carries orphan + stale-baseline counts from the pending-overlay merge
 * so the toast can warn when pending decorations look unusual.
 *
 * adr: adr/active-doc-watcher.md
 */
export interface DocumentReloadedPayload {
  document: any;
  title: string;
  filename: string;
  docId?: string;
  metadata?: Record<string, any>;
  orphanCount: number;
  staleBaselineCount: number;
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

export interface IdRewrite { oldId: string; newId: string }

interface UseWebSocketOptions {
  onNodeChanges?: (changes: NodeChange[]) => void;
  onAgentStatus?: (connected: boolean) => void;
  onDocumentSwitched?: (payload: DocumentSwitchedPayload) => void;
  /** External write detected — server reloaded the active doc from disk
   *  and broadcast the new state. Handler should swap TipTap content and
   *  surface a notification so the user knows their view just changed.
   *  adr: adr/active-doc-watcher.md */
  onDocumentReloaded?: (payload: DocumentReloadedPayload) => void;
  onDocumentsChanged?: () => void;
  onWorkspacesChanged?: () => void;
  onTitleChanged?: (title: string) => void;
  onPendingDocsChanged?: (data: PendingDocsPayload) => void;
  onSyncStatus?: (status: SyncStatus) => void;
  onWritingStarted?: (title: string, target: { wsFilename: string; containerId: string | null; parentDocId?: string } | null) => void;
  onMetadataChanged?: (metadata: Record<string, any>) => void;
  onWritingFinished?: () => void;
  /** Called when the save-time matcher reassigned block IDs. Browser must
   *  rewrite its in-memory TipTap doc to match — otherwise subsequent
   *  server→browser updates targeting the new IDs silently fail.
   *  adr: adr/node-identity-matcher.md */
  onIdRewrites?: (rewrites: IdRewrite[]) => void;
  /** Called with the full set of pending write filenames after any change.
   *  Sidebar uses this to hide real doc entries that are still behind spinners. */
  onPendingFilenamesChanged?: (filenames: Set<string>) => void;
  /** Called on reconnect so the app can re-sync editor state to server */
  getEditorState?: () => { document: any } | null;
}

export function useWebSocket({ onNodeChanges, onAgentStatus, onDocumentSwitched, onDocumentReloaded, onDocumentsChanged, onWorkspacesChanged, onTitleChanged, onPendingDocsChanged, onMetadataChanged, onSyncStatus, onWritingStarted, onWritingFinished, onIdRewrites, onPendingFilenamesChanged, getEditorState }: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  // Document version counter — tracks last version seen from agent writes
  const docVersionRef = useRef<number>(0);
  // Live set of keys (filenames) for all pending writes the server knows about.
  // Sidebar reads this to hide real entries that are still behind spinners.
  const pendingKeysRef = useRef<Set<string>>(new Set());
  const emitPending = () => onPendingFilenamesChangedRef.current?.(new Set(pendingKeysRef.current));

  // Store callbacks in refs to avoid reconnection on every render
  const onNodeChangesRef = useRef(onNodeChanges);
  const onAgentStatusRef = useRef(onAgentStatus);
  const onDocumentSwitchedRef = useRef(onDocumentSwitched);
  const onDocumentsChangedRef = useRef(onDocumentsChanged);
  const onWorkspacesChangedRef = useRef(onWorkspacesChanged);
  const onTitleChangedRef = useRef(onTitleChanged);
  const onPendingDocsChangedRef = useRef(onPendingDocsChanged);
  const onSyncStatusRef = useRef(onSyncStatus);
  const onMetadataChangedRef = useRef(onMetadataChanged);
  const onWritingStartedRef = useRef(onWritingStarted);
  const onWritingFinishedRef = useRef(onWritingFinished);
  const onIdRewritesRef = useRef(onIdRewrites);
  const onPendingFilenamesChangedRef = useRef(onPendingFilenamesChanged);
  const onDocumentReloadedRef = useRef(onDocumentReloaded);
  const getEditorStateRef = useRef(getEditorState);
  onNodeChangesRef.current = onNodeChanges;
  onAgentStatusRef.current = onAgentStatus;
  onDocumentSwitchedRef.current = onDocumentSwitched;
  onDocumentsChangedRef.current = onDocumentsChanged;
  onWorkspacesChangedRef.current = onWorkspacesChanged;
  onTitleChangedRef.current = onTitleChanged;
  onPendingDocsChangedRef.current = onPendingDocsChanged;
  onMetadataChangedRef.current = onMetadataChanged;
  onSyncStatusRef.current = onSyncStatus;
  onWritingStartedRef.current = onWritingStarted;
  onWritingFinishedRef.current = onWritingFinished;
  onIdRewritesRef.current = onIdRewrites;
  onPendingFilenamesChangedRef.current = onPendingFilenamesChanged;
  onDocumentReloadedRef.current = onDocumentReloaded;
  getEditorStateRef.current = getEditorState;

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let hasConnectedBefore = false;
    let backoff = 1000; // Start at 1s, cap at 8s

    function connect() {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        backoff = 1000; // Reset backoff on successful connect

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
            // Apply changes FIRST, then bump version. If the callback throws
            // (malformed changes, ProseMirror schema mismatch, etc.) the
            // version stays at the previous value so the next browser
            // autosave is rejected as stale instead of overwriting fresh
            // server state with a stale snapshot.
            // adr: adr/node-identity-matcher.md
            onNodeChangesRef.current?.(msg.changes);
            if (typeof msg.version === 'number') {
              docVersionRef.current = msg.version;
            }
          }

          if (msg.type === 'id-rewrites' && Array.isArray(msg.rewrites)) {
            // Server's save-time matcher reassigned block IDs. Apply the
            // rewrites to the editor's in-memory TipTap doc so subsequent
            // server→browser updates can resolve their anchors. Without this,
            // the browser holds stale IDs, anchor lookups fail silently, and
            // the browser's debounced autosave eventually clobbers fresh
            // server state with the stale snapshot.
            // adr: adr/node-identity-matcher.md
            onIdRewritesRef.current?.(msg.rewrites);
          }

          if (msg.type === 'agent-status') {
            onAgentStatusRef.current?.(!!msg.agentConnected);
          }

          if (msg.type === 'document-switched') {
            // Deliver navigation intent before React adopts the new active doc.
            // adr: adr/sidebar-navigation-intent.md
            window.dispatchEvent(new CustomEvent('ow-document-navigation', {
              detail: { filename: msg.filename, navigation: msg.navigation ?? 'open' },
            }));
            // Adopt the server's docVersion as our autosave baseline. For a
            // normal switch the server reset it to 0 (fresh lineage), so this
            // is 0 as before. For an auto-title rename — which reaches us via
            // this same message without a server-side reset — the server is at
            // N+1, and adopting it keeps subsequent edits from being BLOCKED as
            // stale (which would drop text typed during the rename).
            docVersionRef.current = typeof msg.version === 'number' ? msg.version : 0;
            onDocumentSwitchedRef.current?.({
              navigation: msg.navigation ?? 'open',
              document: msg.document,
              title: msg.title,
              filename: msg.filename,
              docId: msg.docId,
              metadata: msg.metadata,
              pendingMetadata: msg.pendingMetadata ?? null,
            });
            // Surface the initial pending-metadata state as a DOM event so
            // the title bar + sidebar can hook in without prop-drilling.
            window.dispatchEvent(new CustomEvent('ow-pending-metadata-changed', {
              detail: { docId: msg.docId, pendingMetadata: msg.pendingMetadata ?? null },
            }));
          }

          if (msg.type === 'pending-metadata-changed') {
            // Agent staged / accepted / rejected a metadata proposal for a
            // specific doc. Components listen via window event.
            // adr: adr/pending-overlay-model.md
            window.dispatchEvent(new CustomEvent('ow-pending-metadata-changed', {
              detail: { docId: msg.docId, pendingMetadata: msg.pendingMetadata ?? null },
            }));
          }

          if (msg.type === 'document-reloaded') {
            // Server's fs.watch detected an external write. The doc on
            // disk is now authoritative; we adopt it wholesale.
            //
            // Adopt the server's post-bump docVersion as our new baseline.
            // The watcher incremented it (so any in-flight stale autosave
            // from before the external write is now < server's version and
            // gets BLOCKED). Setting our ref to the new value means
            // subsequent autosaves from edits the user types on top of the
            // reloaded content match the server and pass the check —
            // without this, every post-reload edit silently fails to save.
            // adr: adr/active-doc-watcher.md
            if (typeof msg.version === 'number') {
              docVersionRef.current = msg.version;
            }
            onDocumentReloadedRef.current?.({
              document: msg.document,
              title: msg.title,
              filename: msg.filename,
              docId: msg.docId,
              metadata: msg.metadata,
              orphanCount: typeof msg.orphanCount === 'number' ? msg.orphanCount : 0,
              staleBaselineCount: typeof msg.staleBaselineCount === 'number' ? msg.staleBaselineCount : 0,
            });
          }

          if (msg.type === 'metadata-changed' && msg.metadata) {
            onMetadataChangedRef.current?.(msg.metadata);
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

          if (msg.type === 'writing-started' && msg.title) {
            if (typeof msg.key === 'string') {
              pendingKeysRef.current.add(msg.key);
              emitPending();
            }
            onWritingStartedRef.current?.(msg.title, msg.target || null);
          }

          if (msg.type === 'writing-finished') {
            if (typeof msg.key === 'string' && msg.key) {
              pendingKeysRef.current.delete(msg.key);
            } else {
              pendingKeysRef.current.clear();
            }
            emitPending();
            onWritingFinishedRef.current?.();
          }

          // Rehydrate in-flight writing spinners across app refreshes.
          // Replace the full pending set; display picks the most recent title.
          if (msg.type === 'pending-writes-sync' && Array.isArray(msg.writes)) {
            pendingKeysRef.current = new Set(msg.writes.map((w: any) => w.key).filter(Boolean));
            emitPending();
            if (msg.writes.length > 0) {
              const latest = msg.writes.reduce((a: any, b: any) => (a.startedAt > b.startedAt ? a : b));
              if (latest?.title) {
                onWritingStartedRef.current?.(latest.title, latest.target || null);
              }
            }
          }

          if (msg.type === 'plugins-changed') {
            window.dispatchEvent(new CustomEvent('ow-plugins-changed'));
          }

          if (msg.type === 'comments-changed' && msg.filename) {
            window.dispatchEvent(new CustomEvent('ow-comments-changed', { detail: { filename: msg.filename } }));
          }

          if (msg.type === 'documents-changed') {
            window.dispatchEvent(new CustomEvent('ow-documents-changed'));
          }

          if (msg.type === 'metadata-changed') {
            window.dispatchEvent(new CustomEvent('ow-metadata-changed', { detail: { metadata: msg.metadata } }));
          }

          // Right-rail Activity feed. The seed message replaces the tab's
          // entire list on connect; the event message is a single live
          // arrival that animates and (if the rail isn't on Activity) pulses
          // the titlebar bell. adr: adr/right-rail.md
          if (msg.type === 'activity-log' && Array.isArray(msg.entries)) {
            window.dispatchEvent(new CustomEvent('ow-activity-seed', { detail: { entries: msg.entries } }));
          }

          if (msg.type === 'activity-event' && msg.event) {
            window.dispatchEvent(new CustomEvent('ow-activity-event', { detail: { event: msg.event } }));
          }

          // Server-originated transient toast (e.g. post_to_blog schema-gate
          // rejection). Route straight to the canonical showToast() primitive
          // so it's indistinguishable from any in-app toast. Errors linger
          // longer than the default so a rejected publish isn't missed.
          if (msg.type === 'toast' && typeof msg.message === 'string') {
            const kind = msg.kind === 'error' ? 'error' : 'info';
            showToast(msg.message, kind, typeof msg.durationMs === 'number' ? msg.durationMs : (kind === 'error' ? 9000 : 3500));
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => {
        setConnected(false);
        reconnectTimer = setTimeout(connect, backoff);
        backoff = Math.min(backoff * 1.5, 8000); // Exponential backoff, cap at 8s
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    // Immediately reconnect when tab becomes visible (user switched back)
    function handleVisibility() {
      if (document.visibilityState === 'visible' && wsRef.current?.readyState !== WebSocket.OPEN) {
        clearTimeout(reconnectTimer);
        backoff = 1000;
        connect();
      }
    }
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearTimeout(reconnectTimer);
      document.removeEventListener('visibilitychange', handleVisibility);
      // Detach onclose before closing to prevent the handler from setting
      // a new reconnect timer that the cleanup can't clear (StrictMode fix).
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, []); // Stable — no deps, callbacks via refs

  const sendMessage = useCallback((msg: Record<string, any>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  return { connected, sendMessage, docVersionRef };
}
