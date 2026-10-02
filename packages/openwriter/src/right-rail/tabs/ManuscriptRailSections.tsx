/**
 * Book sections inside the Review tab. A book is an Outline plus the
 * Manuscript built from it; the manuscript is the book.
 *
 *   - "Book" (the open doc is an outline or a manuscript): an outline shows its
 *     manuscript, or Build manuscript; a manuscript shows its outline and every
 *     outline chapter it doesn't have yet, each with Add.
 *   - "Books" — always shown: every book, opening its manuscript (or its
 *     outline before one is built).
 *
 * Styling reuses the review-tab design tokens + classes so it matches the
 * pending UI in both light and dark mode.
 *
 * adr: adr/manuscript-engine.md
 */
import { useEffect, useState } from 'react';
import { showToast } from '../../utils/toast';
import { useBookStatus, type BookDoc } from '../../hooks/useBookStatus';
import './ManuscriptRailSections.css';

interface BookItem { title: string; outline: BookDoc; manuscript: BookDoc | null }

interface Props {
  docId: string | null;
  /** Changes whenever pending changes do, so chapter states stay current. */
  refreshKey?: unknown;
  onSwitchDocument: (filename: string) => void;
}

async function post(url: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'That did not work.');
  return data;
}

export default function ManuscriptRailSections({ docId, refreshKey, onSwitchDocument }: Props) {
  const [books, setBooks] = useState<BookItem[]>([]);
  const [book, reload] = useBookStatus(docId, refreshKey);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmAnother, setConfirmAnother] = useState(false);
  useEffect(() => { setConfirmAnother(false); }, [docId]);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch('/api/books')
        .then((r) => r.json())
        .then((d) => { if (!cancelled) setBooks(d.books || []); })
        .catch(() => {});
    };
    load();
    window.addEventListener('ow-documents-changed', load);
    return () => { cancelled = true; window.removeEventListener('ow-documents-changed', load); };
  }, []);

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    try { await action(); } catch (err: any) { showToast(err.message, 'error', 6000); }
    finally { setBusy(null); reload(); }
  };
  const build = (confirm: boolean) => run('build', async () => {
    const made = await post('/api/book/build', { docId, confirm });
    setConfirmAnother(false);
    onSwitchDocument(made.filename);
  });
  const adopt = (copy: BookDoc) => run(`adopt:${copy.docId}`, async () => {
    const result = await post('/api/book/build', { docId, useExisting: copy.docId });
    showToast(result.restoredOriginal
      ? `"${copy.title}" is now the manuscript. Its original version is back in Versions.`
      : `"${copy.title}" is now the manuscript.`, 'info', 6000);
  });
  const addChapter = (heading: string) => run(`add:${heading}`, async () => {
    const result = await post('/api/book/add-chapter', { docId, heading });
    showToast(`Added "${result.heading}" ${result.position}, waiting for your review.`, 'info', 6000);
  });

  const missing = book?.chapters?.filter((c) => c.state === 'missing') ?? [];
  const pending = book?.chapters?.filter((c) => c.state === 'pending') ?? [];

  return (
    <>
      {book?.role === 'outline' && (
        <div className="review-tab__section">
          <div className="review-tab__section-label">Book</div>
          {book.manuscripts?.length ? (
            <>
              {book.manuscripts.map((m) => (
                <div key={m.docId} className="ms-row">
                  <span className="ms-row__title" title={m.title}>{m.title}</span>
                  <button type="button" className="ms-btn" onClick={() => onSwitchDocument(m.filename)}>Open</button>
                </div>
              ))}
              <div className="ms-note">Edit, review and download the book in its manuscript. This outline is the chapter plan.</div>
              {confirmAnother ? (
                <div className="ms-confirm">
                  <span>Build a second manuscript from this outline?</span>
                  <button type="button" className="ms-btn" disabled={busy === 'build'} onClick={() => build(true)}>Build</button>
                  <button type="button" className="ms-btn ms-btn--quiet" onClick={() => setConfirmAnother(false)}>Cancel</button>
                </div>
              ) : (
                <button type="button" className="ms-link" onClick={() => setConfirmAnother(true)}>Build another manuscript</button>
              )}
            </>
          ) : (
            <>
              <button type="button" className="ms-btn ms-btn--wide" disabled={busy === 'build'} onClick={() => build(false)}>
                {busy === 'build' ? 'Building…' : 'Build manuscript'}
              </button>
              <div className="ms-note">Copies the chapters into one document. That document becomes the book you edit, review and download.</div>
              {book.revisions?.map((r) => (
                <div key={r.docId} className="ms-row">
                  <span className="ms-row__title" title={r.title}>{r.title}</span>
                  <button type="button" className="ms-btn" disabled={busy === `adopt:${r.docId}`} onClick={() => adopt(r)}>Use as manuscript</button>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {book?.role === 'manuscript' && (
        <div className="review-tab__section">
          <div className="review-tab__section-label">Book</div>
          {book.outline && (
            <div className="ms-row">
              <span className="ms-row__title" title={book.outline.title}>Built from {book.outline.title}</span>
              <button type="button" className="ms-btn ms-btn--quiet" onClick={() => onSwitchDocument(book.outline!.filename)}>Outline</button>
            </div>
          )}
          {missing.map((c) => (
            <button
              key={c.heading}
              type="button"
              className="ms-btn ms-btn--wide ms-add"
              disabled={busy === `add:${c.heading}`}
              onClick={() => addChapter(c.heading)}
              title="Copies this chapter from its beats into the manuscript as one change for you to review"
            >
              Add {c.heading} to manuscript
            </button>
          ))}
          {pending.map((c) => (
            <div key={c.heading} className="ms-note">{c.heading} is waiting for your review.</div>
          ))}
          {book.chapters && missing.length === 0 && pending.length === 0 && (
            <div className="ms-note">Every outline chapter is in the manuscript.</div>
          )}
        </div>
      )}

      <div className="review-tab__section">
        <div className="review-tab__section-label">Books</div>
        {books.length === 0 ? (
          <div className="ms-empty">None yet. Create a book outline from the “+” menu.</div>
        ) : (
          <ul className="ms-list">
            {books.map((b) => {
              const open = b.manuscript ?? b.outline;
              const here = docId === b.outline.docId || docId === b.manuscript?.docId;
              return (
                <li key={b.outline.docId}>
                  <button
                    type="button"
                    className={here ? 'ms-item ms-item--active' : 'ms-item'}
                    onClick={() => onSwitchDocument(open.filename)}
                    title={b.manuscript ? b.manuscript.title : `${b.outline.title} (no manuscript yet)`}
                  >
                    {b.title}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
