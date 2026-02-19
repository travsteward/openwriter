import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';

import './floating-toolbar.css';

function ToolbarButton({
  onClick,
  active,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      className={`floating-toolbar__btn${active ? ' active' : ''}${disabled ? ' disabled' : ''}`}
      onMouseDown={(e) => {
        e.preventDefault(); // prevent editor blur
        onClick();
      }}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="floating-toolbar__divider" />;
}

export default function FloatingToolbar({ editor }: { editor: Editor }) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [, setTick] = useState(0);
  const lastFrom = useRef(-1);
  const lastTo = useRef(-1);
  const dragging = useRef(false);

  // Track mouse-down on the editor so we don't show during drag-select
  useEffect(() => {
    const el = editor.view.dom;
    const onDown = () => { dragging.current = true; };
    const onUp = () => {
      if (!dragging.current) return; // ignore clicks outside editor (e.g. toolbar buttons)
      dragging.current = false;
      // Selection is final now — trigger a position update
      const { from, to } = editor.state.selection;
      if (from !== to) {
        const inCodeBlock = editor.isActive('codeBlock');
        const contextMenu = !!document.querySelector('.context-menu');
        if (!inCodeBlock && !contextMenu) {
          lastFrom.current = from;
          lastTo.current = to;
          const start = editor.view.coordsAtPos(from);
          const end = editor.view.coordsAtPos(to, 1);
          const cx = (start.left + end.right) / 2;
          setPos({ top: start.top, left: cx });
          setVisible(true);
        }
      }
    };
    el.addEventListener('mousedown', onDown);
    document.addEventListener('mouseup', onUp);
    return () => {
      el.removeEventListener('mousedown', onDown);
      document.removeEventListener('mouseup', onUp);
    };
  }, [editor]);

  // Hide toolbar when editor loses focus (e.g. clicking outside the editor)
  useEffect(() => {
    const onBlur = () => {
      dragging.current = false;
      setVisible(false);
      lastFrom.current = -1;
      lastTo.current = -1;
    };
    editor.on('blur', onBlur);
    return () => { editor.off('blur', onBlur); };
  }, [editor]);

  useEffect(() => {
    const onTransaction = () => {
      const { from, to } = editor.state.selection;
      const empty = from === to;
      const inCodeBlock = editor.isActive('codeBlock');
      const contextMenu = !!document.querySelector('.context-menu');

      if (empty || inCodeBlock || contextMenu) {
        setVisible(false);
        lastFrom.current = -1;
        lastTo.current = -1;
      } else if (!dragging.current) {
        setVisible(true);
        // Only reposition when the selection range itself changes —
        // NOT on format changes (which keep the same from/to)
        if (from !== lastFrom.current || to !== lastTo.current) {
          lastFrom.current = from;
          lastTo.current = to;
          const start = editor.view.coordsAtPos(from);
          const end = editor.view.coordsAtPos(to, 1);
          const cx = (start.left + end.right) / 2;
          setPos({ top: start.top, left: cx });
        }
      }
      // Re-render so button active states update
      setTick((n) => n + 1);
    };

    editor.on('transaction', onTransaction);
    return () => { editor.off('transaction', onTransaction); };
  }, [editor]);

  if (!visible) return null;

  return (
    <div
      className="floating-toolbar"
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        transform: 'translate(-50%, -100%) translateY(-8px)',
        zIndex: 1500,
      }}
    >
      {/* Inline formatting */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        active={editor.isActive('bold')}
        title="Bold (Ctrl+B)"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8" />
        </svg>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        active={editor.isActive('italic')}
        title="Italic (Ctrl+I)"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="19" x2="10" y1="4" y2="4" />
          <line x1="14" x2="5" y1="20" y2="20" />
          <line x1="15" x2="9" y1="4" y2="20" />
        </svg>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        active={editor.isActive('underline')}
        title="Underline (Ctrl+U)"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 4v6a6 6 0 0 0 12 0V4" />
          <line x1="4" x2="20" y1="20" y2="20" />
        </svg>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleStrike().run()}
        active={editor.isActive('strike')}
        title="Strikethrough"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 4H9a3 3 0 0 0-2.83 4" />
          <path d="M14 12a4 4 0 0 1 0 8H6" />
          <line x1="4" x2="20" y1="12" y2="12" />
        </svg>
      </ToolbarButton>

      <Divider />

      {/* Headings */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        active={editor.isActive('heading', { level: 1 })}
        title="Heading 1"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 12h8" />
          <path d="M4 18V6" />
          <path d="M12 18V6" />
          <path d="m17 12 3-2v8" />
        </svg>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        active={editor.isActive('heading', { level: 2 })}
        title="Heading 2"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 12h8" />
          <path d="M4 18V6" />
          <path d="M12 18V6" />
          <path d="M21 18h-4c0-4 4-3 4-6 0-1.5-2-2.5-4-1" />
        </svg>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        active={editor.isActive('heading', { level: 3 })}
        title="Heading 3"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 12h8" />
          <path d="M4 18V6" />
          <path d="M12 18V6" />
          <path d="M17.5 10.5c1.7-1 3.5 0 3.5 1.5a2 2 0 0 1-2 2" />
          <path d="M17 17.5c2 1.5 4 .3 4-1.5a2 2 0 0 0-2-2" />
        </svg>
      </ToolbarButton>

      <Divider />

      {/* Lists & blockquote */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        active={editor.isActive('bulletList')}
        title="Bullet List"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 12h.01" />
          <path d="M3 18h.01" />
          <path d="M3 6h.01" />
          <path d="M8 12h13" />
          <path d="M8 18h13" />
          <path d="M8 6h13" />
        </svg>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        active={editor.isActive('orderedList')}
        title="Ordered List"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M11 12h9" />
          <path d="M11 18h9" />
          <path d="M11 6h9" />
          <path d="M4 10V4h1" />
          <path d="M4 10h2" />
          <path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" />
        </svg>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        active={editor.isActive('blockquote')}
        title="Blockquote"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 6H3" />
          <path d="M21 12H8" />
          <path d="M21 18H8" />
          <path d="M3 12v6" />
        </svg>
      </ToolbarButton>
    </div>
  );
}
