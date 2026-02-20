import { useEffect, useRef } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';

import { padExtensions, buildExtensions } from './extensions';
import FloatingToolbar from './FloatingToolbar';
import { createPendingDecorationPlugin } from '../decorations/plugin';

async function uploadAndInsertImage(file: File, view: any) {
  const form = new FormData();
  form.append('image', file);
  try {
    const res = await fetch('/api/upload-image', { method: 'POST', body: form });
    if (!res.ok) return;
    const { src } = await res.json();
    const { state } = view;
    const node = state.schema.nodes.image.create({ src, alt: file.name });
    const tr = state.tr.replaceSelectionWith(node);
    view.dispatch(tr);
  } catch {
    // upload failed silently
  }
}

interface PadEditorProps {
  initialContent?: any;
  onUpdate?: (json: any) => void;
  onReady?: (editor: Editor) => void;
  onLinkClick?: (filename: string) => void;
  placeholder?: string;
}

export default function PadEditor({ initialContent, onUpdate, onReady, onLinkClick, placeholder }: PadEditorProps) {
  const onLinkClickRef = useRef(onLinkClick);
  onLinkClickRef.current = onLinkClick;

  const editor = useEditor({
    extensions: placeholder ? buildExtensions({ placeholder }) : padExtensions,
    content: initialContent || '<p></p>',
    onUpdate: ({ editor }) => {
      onUpdate?.(editor.getJSON());
    },
    editorProps: {
      attributes: {
        class: 'tiptap',
      },
      handlePaste: (view, event) => {
        const items = event.clipboardData?.items;
        if (!items) return false;
        for (const item of items) {
          if (item.type.startsWith('image/')) {
            event.preventDefault();
            const file = item.getAsFile();
            if (file) uploadAndInsertImage(file, view);
            return true;
          }
        }
        return false;
      },
      handleDrop: (view, event) => {
        const files = event.dataTransfer?.files;
        if (!files?.length) return false;
        for (const file of files) {
          if (file.type.startsWith('image/')) {
            event.preventDefault();
            uploadAndInsertImage(file, view);
            return true;
          }
        }
        return false;
      },
    },
  }, [initialContent]);

  // Intercept doc: link clicks directly on the DOM (bypasses ProseMirror event chain)
  useEffect(() => {
    if (!editor) return;
    const el = editor.view.dom;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const link = target.closest('span.doc-link[data-doc]');
      if (!link) return;
      const filename = link.getAttribute('data-doc')!;
      onLinkClickRef.current?.(filename);
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
