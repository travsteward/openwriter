import { useCallback, useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';

import PadEditor from './editor/PadEditor';
import FormatToolbar from './editor/FormatToolbar';
import Titlebar from './titlebar/Titlebar';
import ContextMenu from './context-menu/ContextMenu';
import ReviewPanel from './review/ReviewPanel';
import Sidebar from './sidebar/Sidebar';
import SyncSetupModal from './sync/SyncSetupModal';
import { useWebSocket, type PendingDocsPayload, type SyncStatus } from './ws/client';
import { applyNodeChangeToEditor } from './decorations/bridge';
import { getSidebarMode } from './themes/appearance-store';

import TweetComposeView from './tweet-compose/TweetComposeView';
import './decorations/styles.css';

export default function App() {
  const editorRef = useRef<Editor | null>(null);
  const [editorInstance, setEditorInstance] = useState<Editor | null>(null);
  const [title, setTitle] = useState('Untitled');
  const [initialContent, setInitialContent] = useState<any>(undefined);
  const [activeDocKey, setActiveDocKey] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarRefreshKey, setSidebarRefreshKey] = useState(0);
  const [workspacesRefreshKey, setWorkspacesRefreshKey] = useState(0);
  const [pendingDocs, setPendingDocs] = useState<PendingDocsPayload>({ filenames: [], counts: {} });
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ state: 'unconfigured' });
  const [showSyncSetup, setShowSyncSetup] = useState(false);
  const [metadata, setMetadata] = useState<Record<string, any>>({});
  const [showToolbar, setShowToolbar] = useState(() => localStorage.getItem('ow-toolbar') !== 'hidden');
  const [writingTitle, setWritingTitle] = useState<string | null>(null);
  const [writingTarget, setWritingTarget] = useState<{ wsFilename: string; containerId: string | null } | null>(null);
  const writingStartedAt = useRef<number>(0);
  const writingClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const MIN_WRITING_DISPLAY_MS = 1500;

  const showWritingTitle = useCallback((title: string, target: { wsFilename: string; containerId: string | null } | null) => {
    if (writingClearTimer.current) { clearTimeout(writingClearTimer.current); writingClearTimer.current = null; }
    writingStartedAt.current = Date.now();
    setWritingTitle(title);
    setWritingTarget(target);
  }, []);

  const clearWritingTitle = useCallback(() => {
    if (writingClearTimer.current) return; // already scheduled
    const elapsed = Date.now() - writingStartedAt.current;
    const remaining = MIN_WRITING_DISPLAY_MS - elapsed;
    if (remaining <= 0) {
      setWritingTitle(null);
      setWritingTarget(null);
    } else {
      writingClearTimer.current = setTimeout(() => {
        writingClearTimer.current = null;
        setWritingTitle(null);
        setWritingTarget(null);
      }, remaining);
    }
  }, []);

  const [, setSidebarModeKey] = useState(0);
  const docUpdateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Navigation history
  interface NavEntry { filename: string; scrollTop: number; }
  const navStack = useRef<NavEntry[]>([]);
  const navIndex = useRef(-1);
  const isNavAction = useRef(false);
  const currentFilename = useRef<string>('');
  const [activeFilename, setActiveFilename] = useState('');
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);

  // Fetch saved document from server on mount
  // Set/remove data-view attribute on <html> for CSS targeting
  useEffect(() => {
    if (metadata?.tweetContext) {
      document.documentElement.setAttribute('data-view', 'tweet');
    } else {
      document.documentElement.removeAttribute('data-view');
    }
    return () => document.documentElement.removeAttribute('data-view');
  }, [metadata?.tweetContext]);

  // Re-render when sidebar mode changes (board mode needs different layout)
  useEffect(() => {
    const handler = () => setSidebarModeKey(k => k + 1);
    window.addEventListener('ow-sidebar-mode-change', handler);
    return () => window.removeEventListener('ow-sidebar-mode-change', handler);
  }, []);

  useEffect(() => {
    fetch('/api/document')
      .then((res) => res.json())
      .then((data) => {
        if (data.document) setInitialContent(data.document);
        if (data.title) setTitle(data.title);
        if (data.metadata) setMetadata(data.metadata);
      })
      .catch(() => {
        setInitialContent(undefined);
      });

    // Fetch pending docs state
    fetch('/api/pending-docs')
      .then((res) => res.json())
      .then((data) => setPendingDocs(data))
      .catch(() => {});

    // Fetch initial sync status
    fetch('/api/sync/status')
      .then((res) => res.json())
      .then((data) => setSyncStatus(data))
      .catch(() => {});
  }, []);

  const handleEditorReady = useCallback((editor: Editor) => {
    editorRef.current = editor;
    setEditorInstance(editor);
  }, []);

  const handleDocumentSwitched = useCallback((payload: { document: any; title: string; filename: string; docId?: string; metadata?: Record<string, any> }) => {
    currentFilename.current = payload.filename;
    setActiveFilename(payload.filename);
    setInitialContent(payload.document);
    setTitle(payload.title);
    setMetadata(payload.metadata || {});
    // Don't clear writingTitle here — only writing-finished clears the spinner.
    // This lets the two-step create flow (create_document → populate_document) keep the spinner alive.
    setActiveDocKey((k) => k + 1);
    setSidebarRefreshKey((k) => k + 1);

    // Restore scroll position if this was a back/forward navigation
    if (isNavAction.current) {
      const entry = navStack.current[navIndex.current];
      if (entry) {
        setTimeout(() => {
          const editorContainer = document.querySelector('.editor-container');
          if (editorContainer) editorContainer.scrollTop = entry.scrollTop;
        }, 50);
      }
      isNavAction.current = false;
    }

    // Update nav button states
    setCanGoBack(navIndex.current > 0);
    setCanGoForward(navIndex.current < navStack.current.length - 1);
  }, []);

  const handleDocumentsChanged = useCallback(() => {
    setSidebarRefreshKey((k) => k + 1);
  }, []);

  const handleWorkspacesChanged = useCallback(() => {
    setWorkspacesRefreshKey((k) => k + 1);
  }, []);

  const handlePendingDocsChanged = useCallback((data: PendingDocsPayload) => {
    setPendingDocs(data);
  }, []);

  const { sendMessage } = useWebSocket({
    onNodeChanges: (changes) => {
      const editor = editorRef.current;
      if (!editor) return;
      for (const change of changes) {
        applyNodeChangeToEditor(editor, change);
      }
    },
    onDocumentSwitched: handleDocumentSwitched,
    onDocumentsChanged: handleDocumentsChanged,
    onWorkspacesChanged: handleWorkspacesChanged,
    onPendingDocsChanged: handlePendingDocsChanged,
    onMetadataChanged: (m) => setMetadata(m),
    onWritingStarted: (title, target) => showWritingTitle(title, target),
    onWritingFinished: () => clearWritingTitle(),
    onSyncStatus: (status) => setSyncStatus(status),
    onTitleChanged: (newTitle) => setTitle(newTitle),
    getEditorState: () => {
      const editor = editorRef.current;
      if (!editor) return null;
      return { document: editor.getJSON() };
    },
  });

  // Flush current editor content to server synchronously before switching/creating docs
  const flushCurrentDoc = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (docUpdateTimer.current) {
      clearTimeout(docUpdateTimer.current);
      docUpdateTimer.current = null;
    }
    sendMessage({ type: 'doc-update', document: editor.getJSON(), filename: currentFilename.current });
    sendMessage({ type: 'save' });
  }, [sendMessage]);

  // Flush on browser close / tab switch to prevent data loss
  useEffect(() => {
    const flush = () => {
      const editor = editorRef.current;
      if (!editor) return;
      if (docUpdateTimer.current) {
        clearTimeout(docUpdateTimer.current);
        docUpdateTimer.current = null;
      }
      // Use sendBeacon for reliable delivery during page unload
      const payload = JSON.stringify({ type: 'flush', document: editor.getJSON() });
      navigator.sendBeacon('/api/flush', payload);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flush();
    };

    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // Use WS (not HTTP) for switch/create so messages are ordered after the flush
  const handleCreateDocument = useCallback(() => {
    flushCurrentDoc();
    sendMessage({ type: 'create-document' });
  }, [flushCurrentDoc, sendMessage]);

  const handleSwitchDocument = useCallback((filename: string) => {
    // Save current scroll position and push to nav stack
    const editorContainer = document.querySelector('.editor-container');
    const scrollTop = editorContainer?.scrollTop || 0;

    if (!isNavAction.current && currentFilename.current) {
      // Truncate forward history
      navStack.current = navStack.current.slice(0, navIndex.current + 1);
      navStack.current.push({ filename: currentFilename.current, scrollTop });
      navIndex.current = navStack.current.length - 1;
    }

    flushCurrentDoc();
    sendMessage({ type: 'switch-document', filename });
  }, [flushCurrentDoc, sendMessage]);

  const goBack = useCallback(() => {
    if (navIndex.current <= 0) return;
    // Save current position before going back
    const editorContainer = document.querySelector('.editor-container');
    const scrollTop = editorContainer?.scrollTop || 0;

    // If we're at the end of the stack going back for the first time,
    // push the current doc so we can go forward to it
    if (navIndex.current === navStack.current.length - 1 && currentFilename.current) {
      navStack.current = navStack.current.slice(0, navIndex.current + 1);
      navStack.current.push({ filename: currentFilename.current, scrollTop });
    } else if (currentFilename.current) {
      // Update current entry's scroll position
      navStack.current[navIndex.current + 1] = { filename: currentFilename.current, scrollTop };
    }

    const entry = navStack.current[navIndex.current];
    navIndex.current--;
    isNavAction.current = true;
    setCanGoBack(navIndex.current > 0);
    setCanGoForward(true);
    flushCurrentDoc();
    sendMessage({ type: 'switch-document', filename: entry.filename });
  }, [flushCurrentDoc, sendMessage]);

  const goForward = useCallback(() => {
    if (navIndex.current >= navStack.current.length - 2) return;
    // Save current scroll
    const editorContainer = document.querySelector('.editor-container');
    const scrollTop = editorContainer?.scrollTop || 0;
    if (currentFilename.current) {
      navStack.current[navIndex.current + 1] = { filename: currentFilename.current, scrollTop };
    }

    navIndex.current++;
    const entry = navStack.current[navIndex.current + 1];
    isNavAction.current = true;
    setCanGoBack(true);
    setCanGoForward(navIndex.current < navStack.current.length - 2);
    flushCurrentDoc();
    sendMessage({ type: 'switch-document', filename: entry.filename });
  }, [flushCurrentDoc, sendMessage]);

  // Keyboard shortcuts for navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); goBack(); }
      if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); goForward(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goBack, goForward]);

  // Debounce doc updates — send at most every 1s instead of every keystroke
  const handleDocUpdate = useCallback((json: any) => {
    if (docUpdateTimer.current) clearTimeout(docUpdateTimer.current);
    docUpdateTimer.current = setTimeout(() => {
      sendMessage({ type: 'doc-update', document: json, filename: currentFilename.current });
    }, 1000);
  }, [sendMessage]);

  // Send title changes to server explicitly (not bundled with doc-update)
  const handleTitleChange = useCallback((newTitle: string) => {
    setTitle(newTitle);
    sendMessage({ type: 'title-update', title: newTitle });
  }, [sendMessage]);

  const toggleToolbar = useCallback(() => {
    setShowToolbar(v => {
      localStorage.setItem('ow-toolbar', v ? 'hidden' : 'visible');
      return !v;
    });
  }, []);

  const handleSync = useCallback(() => {
    if (syncStatus.state === 'unconfigured') {
      setShowSyncSetup(true);
      return;
    }
    // Flush current doc, then push
    flushCurrentDoc();
    fetch('/api/sync/push', { method: 'POST' }).catch(() => {});
  }, [syncStatus.state, flushCurrentDoc]);

  const isBoardMode = getSidebarMode() === 'board';

  return (
    <div className="app">
      {!isBoardMode && (
        <Sidebar
          open={sidebarOpen}
          onSwitchDocument={handleSwitchDocument}
          onCreateDocument={handleCreateDocument}
          refreshKey={sidebarRefreshKey}
          workspacesRefreshKey={workspacesRefreshKey}
          pendingDocs={pendingDocs}
          writingTitle={writingTitle}
          writingTarget={writingTarget}
          onClose={() => setSidebarOpen(false)}
        />
      )}
      <div className="app-main">
        <Titlebar
          title={title}
          onTitleChange={handleTitleChange}
          syncStatus={syncStatus}
          onSync={handleSync}
          onToggleSidebar={!isBoardMode && !sidebarOpen ? () => setSidebarOpen(true) : undefined}
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          onGoBack={goBack}
          onGoForward={goForward}
          editor={editorInstance}
          onToggleToolbar={toggleToolbar}
          toolbarOpen={showToolbar}
        />
        {showToolbar && editorInstance && <FormatToolbar editor={editorInstance} />}
        {isBoardMode && (
          <Sidebar
            open={true}
            onSwitchDocument={handleSwitchDocument}
            onCreateDocument={handleCreateDocument}
            refreshKey={sidebarRefreshKey}
            workspacesRefreshKey={workspacesRefreshKey}
            pendingDocs={pendingDocs}
            writingTitle={writingTitle}
          writingTarget={writingTarget}
          />
        )}
        <div className="editor-container">
          {metadata?.tweetContext ? (
            <TweetComposeView tweetContext={metadata.tweetContext} editor={editorInstance}>
              <PadEditor
                key={activeDocKey}
                initialContent={initialContent}
                onUpdate={handleDocUpdate}
                onReady={handleEditorReady}
                onLinkClick={handleSwitchDocument}
                placeholder={metadata.tweetContext.mode === 'reply' ? 'Post your reply' : "What's happening?"}
              />
            </TweetComposeView>
          ) : (
            <PadEditor
              key={activeDocKey}
              initialContent={initialContent}
              onUpdate={handleDocUpdate}
              onReady={handleEditorReady}
              onLinkClick={handleSwitchDocument}
            />
          )}
        </div>
        <ReviewPanel
          editor={editorInstance}
          pendingDocs={pendingDocs}
          currentFilename={activeFilename}
          onSwitchDocument={handleSwitchDocument}
          sendMessage={sendMessage}
        />
      </div>
      <ContextMenu editorRef={editorRef} />
      {showSyncSetup && (
        <SyncSetupModal
          onClose={() => setShowSyncSetup(false)}
          onSetupComplete={() => {
            fetch('/api/sync/status').then((r) => r.json()).then(setSyncStatus).catch(() => {});
          }}
        />
      )}
    </div>
  );
}
