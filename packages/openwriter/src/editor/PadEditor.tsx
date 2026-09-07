import { useEffect, useRef } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { EditorState } from '@tiptap/pm/state';

import { padExtensions } from './extensions';
import type { Extensions } from '@tiptap/react';
import FloatingToolbar from './FloatingToolbar';
import { createPendingDecorationPlugin, isPreviewActive } from '../decorations/plugin';
import { createCommentDecorationPlugin } from '../decorations/comments-plugin';
import { createBacklinkDecorationPlugin } from '../decorations/backlinks-plugin';
import { createAttributionDecorationPlugin } from '../decorations/attribution-plugin';
import { handleImagePaste, handleImageDrop } from './uploadImage';
import { cleanPastedHTML } from './pasteCleanup';
import { parseLinkHref, type ParsedLinkHref } from './link-href';
import './footnotes.css';

interface PadEditorProps {
  documentId?: string;
  initialContent?: any;
  extensions?: Extensions;
  onUpdate?: (json: any) => void;
  onReady?: (editor: Editor) => void;
  onLinkClick?: (target: ParsedLinkHref) => void;
}

export default function PadEditor({ documentId, initialContent, extensions, onUpdate, onReady, onLinkClick }: PadEditorProps) {
  const onLinkClickRef = useRef(onLinkClick);
  onLinkClickRef.current = onLinkClick;

  // The editor instance is STABLE across doc-switches. Content updates land
  // via the setContent effect below, not by destroying and recreating the
  // editor. Empty deps means useEditor runs once on mount; the editor
  // persists for the component lifetime. This eliminates the per-switch
  // ProseMirror destroy + recreate + decoration-rebuild cycle that was
  // dominating doc-switch latency. Compose-view changes (article → blog
  // → newsletter) flip to a different parent component, which naturally
  // remounts PadEditor — no key prop needed.
  // adr: adr/pending-overlay-model.md
  const editor = useEditor({
    extensions: extensions || padExtensions,
    content: initialContent || '<p></p>',
    onUpdate: ({ editor }) => {
      if (isPreviewActive()) return; // Skip sync during original/modified preview
      onUpdate?.(editor.getJSON());
    },
    editorProps: {
      attributes: {
        class: 'tiptap',
      },
      handlePaste: handleImagePaste,
      handleDrop: handleImageDrop,
      transformPastedHTML: cleanPastedHTML,
    },
  }, []);

  // Content-prop watcher: when `initialContent` changes (doc-switch,
  // external-write reload, restore_version), swap content via setContent
  // instead of remounting. emitUpdate=false suppresses the onUpdate that
  // would otherwise round-trip back as a spurious doc-update — the client
  // diff-gate would catch it, but cheaper to skip the round-trip entirely.
  // Strict equality on the reference is enough: the WS layer hands us the
  // same object across re-renders unless the doc actually changed.
  const lastContentRef = useRef<any>(initialContent);
  const lastDocumentRef = useRef(documentId);
  useEffect(() => {
    if (!editor || !initialContent) return;
    const documentChanged = lastDocumentRef.current !== documentId;
    if (lastContentRef.current === initialContent && !documentChanged) return;
    lastDocumentRef.current = documentId;
    lastContentRef.current = initialContent;
    const tStart = performance.now();
    editor.commands.setContent(initialContent, { emitUpdate: false });
    if (documentChanged) {
      // The view is reusable; document history and plugin state are not.
      // A content replacement alone leaves the prior document in Undo.
      // adr: adr/document-editor-session.md
      editor.view.updateState(EditorState.create({
        schema: editor.state.schema,
        doc: editor.state.doc,
        plugins: editor.state.plugins,
      }));
      // Refresh selection/toolbar subscribers without a document write.
      editor.view.dispatch(editor.state.tr.setMeta('addToHistory', false));
    }
    const tEnd = performance.now();
    const ls = (window as any).__lastSwitch;
    if (ls && ls.tClick) {
      console.log(`[Editor] setContent t=${tEnd.toFixed(0)} duration=${(tEnd - tStart).toFixed(1)}ms fromClick=${(tEnd - ls.tClick).toFixed(1)}ms fromReceive=${ls.tReceive ? (tEnd - ls.tReceive).toFixed(1) : '?'}ms`);
    } else {
      console.log(`[Editor] setContent t=${tEnd.toFixed(0)} duration=${(tEnd - tStart).toFixed(1)}ms (no matching switch)`);
    }
  }, [editor, initialContent, documentId]);

  // First-mount log (for correlation with [Switch] CLICK on initial page load).
  useEffect(() => {
    if (!editor) return;
    console.log(`[Editor] first mount t=${performance.now().toFixed(0)}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // Intercept link clicks directly on the DOM (bypasses ProseMirror event chain).
  // Internal doc: links route to onLinkClick; external http/https/mailto open in
  // a new tab. PadLink is configured with openOnClick:false so TipTap won't do it.
  useEffect(() => {
    if (!editor) return;
    const el = editor.view.dom;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Internal doc: link
      const docLink = target.closest('span.doc-link[data-doc]');
      if (docLink) {
        const dataDoc = docLink.getAttribute('data-doc')!;
        // data-doc is everything after `doc:` — re-parse via the canonical helper.
        const parsed = parseLinkHref(`doc:${dataDoc}`);
        if (!parsed) return;
        onLinkClickRef.current?.(parsed);
        return;
      }
      // External link — open in new tab. Skip Cmd/Ctrl/middle clicks; the
      // browser handles those itself (and cmd-click already opens in new tab).
      const anchor = target.closest('a[href]') as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute('href') || '';
      // Only open links whose protocol the browser can navigate to
      if (!/^(https?:|mailto:|tel:)/i.test(href)) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      window.open(href, '_blank', 'noopener,noreferrer');
    };
    el.addEventListener('click', handleClick, true); // capture phase
    return () => el.removeEventListener('click', handleClick, true);
  }, [editor]);

  // Register the pending decoration plugin (guard against double-add in React strict mode)
  useEffect(() => {
    if (!editor) return;
    const { state } = editor.view;
    if (state.plugins.some((p: any) => p.key === 'pendingDecoration$')) return;
    const plugin = createPendingDecorationPlugin();
    const newState = state.reconfigure({ plugins: [...state.plugins, plugin] });
    editor.view.updateState(newState);
  }, [editor]);

  // Register the comment decoration plugin (dotted underlines)
  useEffect(() => {
    if (!editor) return;
    const { state } = editor.view;
    if (state.plugins.some((p: any) => p.key === 'commentDecoration$')) return;
    const plugin = createCommentDecorationPlugin();
    const newState = state.reconfigure({ plugins: [...state.plugins, plugin] });
    editor.view.updateState(newState);
  }, [editor]);

  // Register the backlink decoration plugin (dotted underline on linked paragraphs)
  useEffect(() => {
    if (!editor) return;
    const { state } = editor.view;
    if (state.plugins.some((p: any) => p.key === 'backlinkDecoration$')) return;
    const plugin = createBacklinkDecorationPlugin();
    const newState = state.reconfigure({ plugins: [...state.plugins, plugin] });
    editor.view.updateState(newState);
  }, [editor]);

  // Register the attribution heatmap plugin (colours blocks by author origin
  // when the heatmap toggle is on). adr: adr/document-history-attribution.md
  useEffect(() => {
    if (!editor) return;
    const { state } = editor.view;
    if (state.plugins.some((p: any) => p.key === 'attributionDecoration$')) return;
    const plugin = createAttributionDecorationPlugin();
    const newState = state.reconfigure({ plugins: [...state.plugins, plugin] });
    editor.view.updateState(newState);
  }, [editor]);

  // Notify parent when editor is ready
  useEffect(() => {
    if (editor) onReady?.(editor);
  }, [editor, onReady]);

  if (!editor) return null;

  return (
    <>
      <EditorContent editor={editor} />
      <FloatingToolbar editor={editor} />
    </>
  );
}
