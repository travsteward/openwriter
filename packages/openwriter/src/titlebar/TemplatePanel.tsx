import { useEffect, useRef, useState } from 'react';
import './TemplatePanel.css';

interface TemplateItem {
  key: string;
  label: string;
  desc: string;
  icon: JSX.Element;
  needsUrl?: boolean;
}

const TEMPLATES: TemplateItem[] = [
  {
    key: 'tweet',
    label: 'Tweet',
    desc: 'Compose a tweet',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    key: 'reply',
    label: 'Reply',
    desc: 'Reply to a tweet',
    needsUrl: true,
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="9 17 4 12 9 7" />
        <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
      </svg>
    ),
  },
  {
    key: 'quote',
    label: 'Quote Tweet',
    desc: 'Quote a tweet',
    needsUrl: true,
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21z" />
        <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z" />
      </svg>
    ),
  },
  {
    key: 'article',
    label: 'Article',
    desc: 'Long-form article',
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
];

interface TemplatePanelProps {
  onCreateTemplate: (type: string, url?: string) => void;
}

export default function TemplatePanel({ onCreateTemplate }: TemplatePanelProps) {
  const [open, setOpen] = useState(false);
  const [urlMode, setUrlMode] = useState<string | null>(null);
  const [urlValue, setUrlValue] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setUrlMode(null);
        setUrlValue('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Focus URL input when entering URL mode
  useEffect(() => {
    if (urlMode) setTimeout(() => urlInputRef.current?.focus(), 0);
  }, [urlMode]);

  const handleItemClick = (item: TemplateItem) => {
    if (item.needsUrl) {
      setUrlMode(item.key);
      setUrlValue('');
      return;
    }
    setOpen(false);
    onCreateTemplate(item.key);
  };

  const handleUrlSubmit = () => {
    if (!urlMode || !urlValue.trim()) return;
    const url = urlValue.trim();
    if (!url.includes('x.com') && !url.includes('twitter.com')) return;
    setOpen(false);
    setUrlMode(null);
    setUrlValue('');
    onCreateTemplate(urlMode, url);
  };

  const handleUrlKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleUrlSubmit();
    }
    if (e.key === 'Escape') {
      setUrlMode(null);
      setUrlValue('');
    }
  };

  const isValidUrl = urlValue.trim().includes('x.com') || urlValue.trim().includes('twitter.com');

  return (
    <div className="template-wrapper" ref={ref}>
      <button
        className={`titlebar-nav-btn${open ? ' titlebar-nav-btn--active' : ''}`}
        onClick={() => { setOpen(!open); setUrlMode(null); setUrlValue(''); }}
        title="Create from template"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M3 9h18" />
          <path d="M9 3v18" />
        </svg>
      </button>
      {open && (
        <div className="template-dropdown">
          <div className="template-dropdown__header">Templates</div>
          <div className="template-dropdown__list">
            {TEMPLATES.map((t) => (
              <div key={t.key}>
                <div
                  className={`template-dropdown__item${urlMode === t.key ? ' template-dropdown__item--active' : ''}`}
                  onClick={() => handleItemClick(t)}
                >
                  <span className="template-dropdown__item-icon">{t.icon}</span>
                  <span className="template-dropdown__item-text">
                    <span className="template-dropdown__item-label">{t.label}</span>
                    <span className="template-dropdown__item-desc">{t.desc}</span>
                  </span>
                </div>
                {urlMode === t.key && (
                  <div className="template-url-row">
                    <input
                      ref={urlInputRef}
                      className="template-url-input"
                      type="text"
                      placeholder="Paste tweet URL..."
                      value={urlValue}
                      onChange={(e) => setUrlValue(e.target.value)}
                      onKeyDown={handleUrlKeyDown}
                    />
                    <button
                      className="template-url-submit"
                      onClick={handleUrlSubmit}
                      disabled={!isValidUrl}
                      title="Create template"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
