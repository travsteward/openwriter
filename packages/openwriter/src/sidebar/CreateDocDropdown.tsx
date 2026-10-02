import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import './CreateDocDropdown.css';

export interface DocTypeOption {
  key: string;
  label: string;
  metadata?: Record<string, any>;
  needsUrl?: boolean;
  urlPlaceholder?: string;
}

const DOC_TYPES: DocTypeOption[] = [
  { key: 'document', label: 'Document' },
  { key: 'tweet', label: 'Tweet', metadata: { content_type: 'tweet', tweetContext: { mode: 'tweet' } } },
  { key: 'reply', label: 'Reply', needsUrl: true, urlPlaceholder: 'Paste tweet URL...', metadata: { content_type: 'reply', tweetContext: { mode: 'reply' } } },
  { key: 'quote', label: 'Quote Tweet', needsUrl: true, urlPlaceholder: 'Paste tweet URL...', metadata: { content_type: 'quote', tweetContext: { mode: 'quote' } } },
  { key: 'article', label: 'Article', metadata: { content_type: 'article', articleContext: { active: true } } },
  { key: 'linkedin', label: 'LinkedIn', metadata: { content_type: 'linkedin', linkedinContext: { active: true } } },
  { key: 'newsletter', label: 'Newsletter', metadata: { content_type: 'newsletter', newsletterContext: { active: true } } },
  { key: 'blog', label: 'Blog', metadata: { content_type: 'blog', blogContext: { active: true } } },
  { key: 'manuscript', label: 'Book outline', metadata: { content_type: 'manuscript', manuscriptContext: { active: true } } },
];

interface CreateDocDropdownProps {
  anchorRect: DOMRect;
  onSelect: (metadata?: Record<string, any>) => void;
  onClose: () => void;
}

export default function CreateDocDropdown({ anchorRect, onSelect, onClose }: CreateDocDropdownProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [urlMode, setUrlMode] = useState<string | null>(null);
  const [urlValue, setUrlValue] = useState('');
  const urlInputRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: anchorRect.left, top: anchorRect.bottom + 4 });

  // Position adjustment to keep within viewport
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    const pad = 8;
    let left = anchorRect.left;
    let top = anchorRect.bottom + 4;
    if (top + rect.height + pad > window.innerHeight) top = anchorRect.top - rect.height - 4;
    if (left + rect.width + pad > window.innerWidth) left = anchorRect.right - rect.width;
    if (top < pad) top = pad;
    if (left < pad) left = pad;
    setPos({ left, top });
  }, [anchorRect]);

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // Focus URL input when entering URL mode
  useEffect(() => {
    if (urlMode) setTimeout(() => urlInputRef.current?.focus(), 0);
  }, [urlMode]);

  const handleItemClick = (item: DocTypeOption) => {
    if (item.needsUrl) {
      setUrlMode(item.key);
      setUrlValue('');
      return;
    }
    onSelect(item.metadata);
  };

  const handleUrlSubmit = () => {
    if (!urlMode || !urlValue.trim()) return;
    const url = urlValue.trim();
    if (!url.includes('x.com') && !url.includes('twitter.com')) return;
    const item = DOC_TYPES.find(t => t.key === urlMode);
    if (!item?.metadata) return;
    // Merge URL into the tweetContext
    const meta = JSON.parse(JSON.stringify(item.metadata));
    if (meta.tweetContext) meta.tweetContext.url = url;
    onSelect(meta);
  };

  const isValidUrl = urlValue.trim().includes('x.com') || urlValue.trim().includes('twitter.com');

  return (
    <div ref={menuRef} className="create-doc-dropdown" style={{ left: pos.left, top: pos.top }}>
      {DOC_TYPES.map(item => (
        <div key={item.key}>
          <button
            className={`create-doc-dropdown-item${urlMode === item.key ? ' active' : ''}`}
            onClick={() => handleItemClick(item)}
          >
            {item.label}
          </button>
          {urlMode === item.key && (
            <div className="create-doc-dropdown-url">
              <input
                ref={urlInputRef}
                type="text"
                placeholder={item.urlPlaceholder}
                value={urlValue}
                onChange={e => setUrlValue(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); handleUrlSubmit(); }
                  if (e.key === 'Escape') { setUrlMode(null); setUrlValue(''); }
                }}
              />
              <button onClick={handleUrlSubmit} disabled={!isValidUrl}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
