import { useEffect, useRef, useState } from 'react';
import './ExportPanel.css';

interface ExportFormat {
  key: string;
  label: string;
  desc: string;
  icon: JSX.Element;
}

const FORMATS: ExportFormat[] = [
  {
    key: 'md',
    label: 'Markdown',
    desc: 'Plain .md file',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
      </svg>
    ),
  },
  {
    key: 'html',
    label: 'HTML',
    desc: 'Styled web page',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="16 18 22 12 16 6" />
        <polyline points="8 6 2 12 8 18" />
      </svg>
    ),
  },
  {
    key: 'docx',
    label: 'Word',
    desc: 'Microsoft Word .docx',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
        <path d="M16 13H8" />
        <path d="M16 17H8" />
        <path d="M10 9H8" />
      </svg>
    ),
  },
  {
    key: 'txt',
    label: 'Plain Text',
    desc: 'Unformatted .txt file',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 6.1H3" />
        <path d="M21 12.1H3" />
        <path d="M15.1 18H3" />
      </svg>
    ),
  },
  {
    key: 'pdf',
    label: 'PDF',
    desc: 'Print preview for save as PDF',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="6 9 6 2 18 2 18 9" />
        <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
        <rect x="6" y="14" width="12" height="8" />
      </svg>
    ),
  },
];

export default function ExportPanel() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleExport = (format: string) => {
    setOpen(false);
    if (format === 'pdf') {
      window.open('/api/export?format=pdf', '_blank');
      return;
    }
    // Use a direct link — browser handles Content-Disposition: attachment natively
    const a = document.createElement('a');
    a.href = `/api/export?format=${format}`;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="export-wrapper" ref={ref}>
      <button
        className={`titlebar-nav-btn${open ? ' titlebar-nav-btn--active' : ''}`}
        onClick={() => setOpen(!open)}
        title="Export document"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      </button>
      {open && (
        <div className="export-dropdown">
          <div className="export-dropdown__header">Export</div>
          <div className="export-dropdown__list">
            {FORMATS.map((f) => (
              <div
                key={f.key}
                className="export-dropdown__item"
                onClick={() => handleExport(f.key)}
              >
                <span className="export-dropdown__item-icon">{f.icon}</span>
                <span className="export-dropdown__item-text">
                  <span className="export-dropdown__item-label">{f.label}</span>
                  <span className="export-dropdown__item-desc">{f.desc}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
