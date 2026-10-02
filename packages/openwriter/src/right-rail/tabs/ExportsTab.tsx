/**
 * Exports tab — download the active document in various formats. A book's
 * manuscript downloads as the book instead (EPUB, Word, HTML, Markdown of its
 * accepted text, with its paragraph style); its outline has no downloads.
 * Migrated from src/export/ExportPanel.tsx (titlebar dropdown).
 * adr: adr/right-rail.md
 * adr: adr/manuscript-engine.md
 */
import { useEffect, useState, type JSX } from 'react';
import type { RightRailTabProps } from '../types';
import { useBookStatus } from '../../hooks/useBookStatus';
import { showToast } from '../../utils/toast';

interface ExportFormat {
  key: string;
  label: string;
  desc: string;
  icon: JSX.Element;
}

const FILE_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
  </svg>
);
const CODE_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="16 18 22 12 16 6" />
    <polyline points="8 6 2 12 8 18" />
  </svg>
);
const WORD_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
    <path d="M16 13H8" />
    <path d="M16 17H8" />
    <path d="M10 9H8" />
  </svg>
);
const BOOK_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </svg>
);

const FORMATS: ExportFormat[] = [
  { key: 'md', label: 'Markdown', desc: 'Plain .md file', icon: FILE_ICON },
  { key: 'html', label: 'HTML', desc: 'Styled web page', icon: CODE_ICON },
  { key: 'docx', label: 'Word', desc: 'Microsoft Word .docx', icon: WORD_ICON },
  {
    key: 'txt', label: 'Plain Text', desc: 'Unformatted .txt file',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 6.1H3" />
        <path d="M21 12.1H3" />
        <path d="M15.1 18H3" />
      </svg>
    ),
  },
  {
    key: 'pdf', label: 'PDF', desc: 'Print preview for save as PDF',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="6 9 6 2 18 2 18 9" />
        <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
        <rect x="6" y="14" width="12" height="8" />
      </svg>
    ),
  },
];

const BOOK_FORMATS: ExportFormat[] = [
  { key: 'epub', label: 'EPUB', desc: 'Ebook, ready for Kindle (KDP)', icon: BOOK_ICON },
  { key: 'docx', label: 'Word', desc: 'Microsoft Word .docx', icon: WORD_ICON },
  { key: 'html', label: 'HTML', desc: 'The book as one web page', icon: CODE_ICON },
  { key: 'md', label: 'Markdown', desc: 'The book as one .md file', icon: FILE_ICON },
];

function download(href: string): void {
  const a = document.createElement('a');
  a.href = href;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function FormatList({ formats, onPick }: { formats: ExportFormat[]; onPick: (key: string) => void }) {
  return (
    <div className="exports-tab__list">
      {formats.map((f) => (
        <button key={f.key} type="button" className="exports-tab__item" onClick={() => onPick(f.key)}>
          <span className="exports-tab__item-icon">{f.icon}</span>
          <span className="exports-tab__item-text">
            <span className="exports-tab__item-label">{f.label}</span>
            <span className="exports-tab__item-desc">{f.desc}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

type ParagraphStyle = 'spaced' | 'indented';

function BookExports({ docId, manuscriptStyle }: { docId: string; manuscriptStyle?: string }) {
  // Optimistic mirror of the saved style so the toggle feels instant.
  const saved: ParagraphStyle = manuscriptStyle === 'indented' ? 'indented' : 'spaced';
  const [picked, setPicked] = useState<ParagraphStyle | null>(null);
  useEffect(() => { setPicked(null); }, [manuscriptStyle, docId]);
  const style = picked ?? saved;

  const setStyle = (next: ParagraphStyle) => {
    if (next === style) return;
    setPicked(next);
    fetch('/api/book/style', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ docId, paragraphStyle: next }),
    }).then((r) => { if (!r.ok) throw new Error(); }).catch(() => {
      setPicked(null);
      showToast('Could not save the paragraph style.', 'error');
    });
  };
  const toggleBtn = (active: boolean) => `review-panel__toggle-btn${active ? ' review-panel__toggle-btn--active' : ''}`;

  return (
    <div className="exports-tab">
      <div className="exports-tab__book-label">Paragraph style</div>
      <div className="review-tab__toggle" role="tablist" aria-label="Paragraph style">
        <button type="button" className={toggleBtn(style === 'spaced')} onClick={() => setStyle('spaced')} title="Blank line between paragraphs, no indent">Spaced</button>
        <button type="button" className={toggleBtn(style === 'indented')} onClick={() => setStyle('indented')} title="First-line indent, no gap, like print">Indented</button>
      </div>
      <div className="exports-tab__book-label">Download the book</div>
      <FormatList formats={BOOK_FORMATS} onPick={(fmt) => download(`/api/book/export?docId=${encodeURIComponent(docId)}&format=${fmt}`)} />
      <div className="exports-tab__book-note">Accepted text only. Changes still waiting for review are left out.</div>
    </div>
  );
}

export default function ExportsTab({ docId, manuscriptStyle, onSwitchDocument }: RightRailTabProps) {
  const [book] = useBookStatus(docId);

  if (docId && book?.role === 'manuscript') return <BookExports docId={docId} manuscriptStyle={manuscriptStyle} />;
  if (book?.role === 'outline') {
    const manuscript = book.manuscripts?.[0];
    return (
      <div className="exports-tab">
        <div className="exports-tab__book-note">
          This is the book's outline. {manuscript ? 'Downloads are on its manuscript.' : 'Build its manuscript in the Review panel, then download from there.'}
        </div>
        {manuscript && (
          <FormatList
            formats={[{ key: 'open', label: 'Open manuscript', desc: manuscript.title, icon: BOOK_ICON }]}
            onPick={() => onSwitchDocument(manuscript.filename)}
          />
        )}
      </div>
    );
  }

  const handleExport = (format: string) => {
    if (format === 'pdf') {
      window.open('/api/export?format=pdf', '_blank');
      return;
    }
    download(`/api/export?format=${format}`);
  };

  return (
    <div className="exports-tab">
      <FormatList formats={FORMATS} onPick={handleExport} />
    </div>
  );
}
