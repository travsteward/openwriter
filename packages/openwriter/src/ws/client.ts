import { useCallback, useEffect, useRef, useState } from 'react';
import { showToast } from '../utils/toast';

/** Identifies this browser tab to the server so a navigation it asks for moves
 *  only this tab. Sent on the WebSocket URL, and as the X-OW-Tab header on
 *  HTTP requests that create or open a document. adr: adr/per-tab-view.md */
export const TAB_ID = Math.random().toString(36).slice(2, 10);
export const TAB_HEADER = { 'X-OW-Tab': TAB_ID };

// Messages that change the doc this tab shows. Each carries the revision the
// tab's copy was built on, so the server can refuse one made from an old copy.
// adr: adr/per-tab-view.md
const DOC_WRITES = new Set(['doc-update', 'pending-resolved', 'title-update']);
const NAVIGATIONS = new Set(['switch-document', 'create-document']);

export interface NodeChange {
  operation: 'rewrite' | 'insert' | 'delete';
  nodeId?: string;
  afterNodeId?: string;
  content?: any;
  feedback?: string;
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
  /** 'refresh': a newer copy of the doc this tab already shows. */
  navigation?: 'open' | 'fallback' | 'create' | 'refresh';
  /** First document after a reconnect: edits this tab could not send may
   *  still be sent if the server's copy is unchanged. */
  onReconnect?: boolean;
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
  /** The filename this tab is showing — sent on reconnect so the server keeps
   *  the tab on it instead of moving it to the live doc. */
  getViewFilename?: () => string;
}

export function useWebSocket({ onNodeChanges, onAgentStatus, onDocumentSwitched, onDocumentReloaded, onDocumentsChanged, onWorkspacesChanged, onTitleChanged, onPendingDocsChanged, onMetadataChanged, onSyncStatus, onWritingStarted, onWritingFinished, onIdRewrites, onPendingFilenamesChanged, getEditorState, getViewFilename }: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  // Messages sent while the socket was closed, replayed once the server has
  // told this tab what it shows. Edits are not queued: the app re-sends its
  // unsent doc on reconnect, where it can check nobody else changed it.
  const outboxRef = useRef<Record<string, any>[]>([]);
  // True from a reconnect until the server's first document reaches this tab.
  const reconnectingRef = useRef(false);
  // The server's revision of the doc this tab shows, as of its last copy.
  const revRef = useRef(0);
  const getViewFilenameRef = useRef(getViewFilename);
  getViewFilenameRef.current = getViewFilename;
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
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let hasConnectedBefore = false;
    let backoff = 1000; // Start at 1s, cap at 8s

    function connect() {
      // On reconnect, say which doc this tab shows: the server sends fresh
      // state if it is the live doc, or marks the tab detached — it never
      // moves the tab. adr: adr/per-tab-view.md
      const view = hasConnectedBefore ? getViewFilenameRef.current?.() : '';
      // A page opened on a doc link names that doc in its first handshake, so
      // the server's first document is the linked one.
      const open = !hasConnectedBefore ? window.location.pathname.match(/^\/d\/([a-f0-9]{8})\/?$/)?.[1] : undefined;
      const wsUrl = `${protocol}//${window.location.host}/ws?tab=${TAB_ID}${view ? `&view=${encodeURIComponent(view)}` : ''}${open ? `&open=${open}` : ''}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        backoff = 1000; // Reset backoff on successful connect
        reconnectingRef.current = hasConnectedBefore;
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
            revRef.current = typeof msg.rev === 'number' ? msg.rev : 0;
            // Deliver navigation intent before React adopts the new active doc.
            // A refresh is not navigation. adr: adr/sidebar-navigation-intent.md
            if (msg.navigation !== 'refresh') {
              window.dispatchEvent(new CustomEvent('ow-document-navigation', {
                detail: { filename: msg.filename, navigation: msg.navigation ?? 'open' },
              }));
            }
            // Adopt the server's docVersion as our autosave baseline. For a
            // normal switch the server reset it to 0 (fresh lineage), so this
            // is 0 as before. For an auto-title rename — which reaches us via
            // this same message without a server-side reset — the server is at
            // N+1, and adopting it keeps subsequent edits from being BLOCKED as
            // stale (which would drop text typed during the rename).
            const onReconnect = reconnectingRef.current;
            reconnectingRef.current = false;
            docVersionRef.current = typeof msg.version === 'number' ? msg.version : 0;
            onDocumentSwitchedRef.current?.({
              onReconnect,
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
            flushOutbox();
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

          if (msg.type === 'bookmarks-changed' && msg.filename) {
            window.dispatchEvent(new CustomEvent('ow-bookmarks-changed', { detail: { filename: msg.filename } }));
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

  /** Returns true only when the message went out. A message sent while the
   *  socket is closed waits in the outbox, except edits (see outboxRef). */
  const sendMessage = useCallback((msg: Record<string, any>): boolean => {
    // Stamped once, when first sent: a queued write keeps the revision it was built on.
    if (DOC_WRITES.has(msg.type) && msg.rev === undefined) msg = { ...msg, rev: revRef.current };
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
      return true;
    }
    if (msg.type !== 'doc-update') {
      // Only the latest navigation matters.
      if (NAVIGATIONS.has(msg.type)) outboxRef.current = outboxRef.current.filter((m) => !NAVIGATIONS.has(m.type));
      outboxRef.current.push(msg);
    }
    return false;
  }, []);

  function flushOutbox() {
    const queued = outboxRef.current;
    outboxRef.current = [];
    for (const msg of queued) sendMessage(msg);
  }

  return { connected, sendMessage, docVersionRef };
}
