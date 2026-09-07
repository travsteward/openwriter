import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/react';
import './EditingDraftNavigation.css';

interface Chapter { id: string; title: string; position: number; }

export default function EditingDraftNavigation({ editor, onOpenOriginal }: {
  editor: Editor | null;
  onOpenOriginal: () => void;
}) {
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [selected, setSelected] = useState('');

  useEffect(() => {
    if (!editor) return;
    const refresh = () => {
      const next: Chapter[] = [];
      editor.state.doc.descendants((node, position) => {
        if (node.type.name === 'heading' && node.attrs.level === 1) {
          next.push({ id: node.attrs.id || String(position), title: node.textContent, position });
        }
      });
      setChapters(next);
    };
    const onTransaction = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (transaction.docChanged) refresh();
    };
    refresh();
    setSelected('');
    editor.on('transaction', onTransaction);
    return () => { editor.off('transaction', onTransaction); };
  }, [editor]);

  const goTo = (chapter: Chapter) => {
    if (!editor) return;
    editor.chain().focus().setTextSelection(chapter.position + 1).run();
    const element = editor.view.nodeDOM(chapter.position);
    if (element instanceof HTMLElement) element.scrollIntoView({ block: 'start' });
    setSelected(chapter.id);
  };

  return (
    <div className="editing-draft-nav">
      <button type="button" className="editing-draft-original" onClick={onOpenOriginal}>Open original manuscript</button>
      <nav aria-label="Draft chapters">
        {chapters.map(chapter => (
          <button key={chapter.id} type="button" className="editing-draft-chapter"
            aria-current={selected === chapter.id ? 'location' : undefined}
            onClick={() => goTo(chapter)} title={chapter.title}>
            {chapter.title}
          </button>
        ))}
      </nav>
      {chapters.length === 0 && <p>Chapter headings will appear here as you write.</p>}
    </div>
  );
}
