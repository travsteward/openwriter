import { useEffect, useRef, useState } from 'react';
import { TAB_HEADER } from '../ws/client';
import './ManuscriptCreateModal.css';

export interface ManuscriptCreateItem {
  docId: string;
  title: string;
}

interface Props {
  items: ManuscriptCreateItem[];
  onClose: () => void;
  onCreated: () => void;
}

function documentCount(count: number): string {
  return `${count} document${count === 1 ? '' : 's'}`;
}

/** Creates an ordinary manuscript document containing only ordered doc: links. */
export default function ManuscriptCreateModal({ items, onClose, onCreated }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !creating) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [creating, onClose]);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || creating) return;

    setCreating(true);
    setError('');
    try {
      // Link text is a label; the stable docId is the actual reference. The
      // manifest parser uses square brackets as delimiters, so normalize them.
      const content = items.map(({ docId, title: sourceTitle }) => {
        const label = sourceTitle.replace(/[\[\]]/g, '').replace(/\s+/g, ' ').trim() || 'Document';
        return `[${label}](<doc:${docId}>)`;
      }).join('\n\n');
      const response = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...TAB_HEADER },
        body: JSON.stringify({
          title: /\s*[—–-]\s*manuscript\s*$/i.test(trimmed) ? trimmed : `${trimmed} — Manuscript`,
          content,
          metadata: { content_type: 'manuscript', manuscriptContext: { active: true } },
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.filename) throw new Error(result.error || 'Could not create manuscript.');
      onCreated();
    } catch (err: any) {
      setError(err?.message || 'Could not create manuscript.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="manuscript-create-overlay" role="presentation" onMouseDown={() => !creating && onClose()}>
      <form
        className="manuscript-create-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="manuscript-create-title"
        aria-describedby="manuscript-create-detail"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={create}
      >
        <div className="manuscript-create-modal__header">
          <h2 id="manuscript-create-title">Create manuscript</h2>
          <p id="manuscript-create-detail" className="manuscript-create-modal__detail">
            {documentCount(items.length)} will remain separate and appear in the current sidebar order.
          </p>
        </div>
        <div className="manuscript-create-modal__body">
          <label htmlFor="manuscript-title">Title</label>
          <input
            ref={inputRef}
            id="manuscript-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={creating}
          />
          {error && <p className="manuscript-create-modal__error" role="alert">{error}</p>}
        </div>
        <div className="manuscript-create-modal__actions">
          <button type="button" onClick={onClose} disabled={creating}>Cancel</button>
          <button type="submit" className="primary" disabled={!title.trim() || creating}>
            {creating ? 'Creating…' : 'Create manuscript'}
          </button>
        </div>
      </form>
    </div>
  );
}
