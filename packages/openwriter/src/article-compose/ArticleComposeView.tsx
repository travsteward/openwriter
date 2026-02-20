/**
 * Article Compose View — X/Twitter article compose experience.
 *
 * Layout (top to bottom): cover image → title → byline → body → footer.
 * Mirrors X's actual article editor UI. No API endpoint — compose here,
 * copy as HTML, paste into X's article editor.
 */

import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useArticleCopy } from './useArticleCopy';
import './ArticleComposeView.css';

const LS_HANDLE_KEY = 'ow-x-handle';
const LS_NAME_KEY = 'ow-x-name';

// ─── Cover Image ────────────────────────────────────────────────

type CoverState = 'empty' | 'prompt' | 'loading' | 'display';

function CoverImage({ src }: { src?: string }) {
  const [state, setState] = useState<CoverState>(src ? 'display' : 'empty');
  const [imageSrc, setImageSrc] = useState(src || '');
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync from prop if parent changes it
  useEffect(() => {
    if (src) {
      setImageSrc(src);
      setState('display');
    }
  }, [src]);

  const generate = useCallback(async () => {
    if (!prompt.trim()) return;
    setState('loading');
    setError('');
    try {
      const res = await fetch('/api/image-gen/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim() }),
      });
      const data = await res.json();
      if (data.success && data.src) {
        setImageSrc(data.src);
        setState('display');
        setPrompt('');
        // Save to metadata
        fetch('/api/metadata', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ articleContext: { coverImage: data.src } }),
        }).catch(() => {});
      } else {
        setError(data.error || 'Generation failed');
        setState('prompt');
      }
    } catch (err: any) {
      setError(err.message || 'Network error');
      setState('prompt');
    }
  }, [prompt]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') generate();
    if (e.key === 'Escape') { setState('empty'); setPrompt(''); setError(''); }
  };

  const openPrompt = () => {
    setState('prompt');
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const remove = () => {
    setImageSrc('');
    setState('empty');
    // Clear from metadata
    fetch('/api/metadata', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ articleContext: { coverImage: null } }),
    }).catch(() => {});
  };

  const regenerate = () => {
    setState('prompt');
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  if (state === 'display' && imageSrc) {
    return (
      <div className="article-cover article-cover--display">
        <img className="article-cover-img" src={imageSrc} alt="Cover" />
        <div className="article-cover-overlay">
          <button className="article-cover-overlay-btn" onClick={regenerate}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" /></svg>
            Regenerate
          </button>
          <button className="article-cover-overlay-btn article-cover-overlay-btn--danger" onClick={remove}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            Remove
          </button>
        </div>
      </div>
    );
  }

  if (state === 'loading') {
    return (
      <div className="article-cover article-cover--loading">
        <div className="article-cover-spinner" />
        <span className="article-cover-loading-text">Generating cover image...</span>
      </div>
    );
  }

  if (state === 'prompt') {
    return (
      <div className="article-cover article-cover--prompt">
        <div className="article-cover-prompt-row">
          <input
            ref={inputRef}
            className="article-cover-prompt-input"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe your cover image..."
            spellCheck={false}
          />
          <button
            className="article-cover-prompt-btn"
            onClick={generate}
            disabled={!prompt.trim()}
          >
            Generate
          </button>
          <button
            className="article-cover-prompt-cancel"
            onClick={() => { setState(imageSrc ? 'display' : 'empty'); setPrompt(''); setError(''); }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        {error && <div className="article-cover-error">{error}</div>}
      </div>
    );
  }

  // Empty state — placeholder
  return (
    <div className="article-cover article-cover--empty" onClick={openPrompt}>
      <svg className="article-cover-icon" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <polyline points="21 15 16 10 5 21" />
      </svg>
      <span className="article-cover-hint">We recommend an image with a 5:2 aspect ratio for best results.</span>
    </div>
  );
}

// ─── Article Byline ─────────────────────────────────────────────

function ArticleByline() {
  const [handle, setHandle] = useState(() => localStorage.getItem(LS_HANDLE_KEY) || '');
  const [name, setName] = useState(() => localStorage.getItem(LS_NAME_KEY) || '');
  const [editing, setEditing] = useState(false);
  const [draftHandle, setDraftHandle] = useState('');
  const [draftName, setDraftName] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const save = () => {
    const cleanHandle = draftHandle.replace(/^@/, '').trim();
    const cleanName = draftName.trim();
    if (cleanHandle) {
      localStorage.setItem(LS_HANDLE_KEY, cleanHandle);
      setHandle(cleanHandle);
    }
    if (cleanName) {
      localStorage.setItem(LS_NAME_KEY, cleanName);
      setName(cleanName);
    }
    setEditing(false);
  };

  const open = () => {
    setDraftHandle(handle);
    setDraftName(name);
    setEditing(true);
    setTimeout(() => nameInputRef.current?.focus(), 0);
  };

  // Close on click outside
  useEffect(() => {
    if (!editing) return;
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) save();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [editing, draftHandle, draftName]);

  const avatarUrl = handle ? `https://unavatar.io/twitter/${handle}` : '';
  const displayName = name || (handle ? `@${handle}` : 'Set your name');

  return (
    <div className="article-byline" ref={wrapperRef}>
      <div className="article-byline-row" onClick={open} title="Click to edit">
        {handle ? (
          <img className="article-byline-avatar" src={avatarUrl} alt={`@${handle}`} />
        ) : (
          <div className="article-byline-avatar article-byline-avatar--empty" />
        )}
        <span className="article-byline-name">{displayName}</span>
        {handle && <span className="article-byline-handle">@{handle}</span>}
      </div>
      {editing && (
        <div className="article-byline-popover">
          <label className="article-byline-label">Display name</label>
          <input
            ref={nameInputRef}
            className="article-byline-input"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
            placeholder="Your Name"
            spellCheck={false}
          />
          <label className="article-byline-label">Handle</label>
          <input
            className="article-byline-input"
            value={draftHandle}
            onChange={(e) => setDraftHandle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
            placeholder="your_handle"
            spellCheck={false}
          />
        </div>
      )}
    </div>
  );
}

// ─── Main View ──────────────────────────────────────────────────

interface ArticleComposeViewProps {
  children: ReactNode;
  title?: string;
  onTitleChange?: (title: string) => void;
  coverImage?: string;
}

export default function ArticleComposeView({ children, title, onTitleChange, coverImage }: ArticleComposeViewProps) {
  const { copyAsHtml, copyState } = useArticleCopy();

  return (
    <div className="article-compose-wrapper">
      <CoverImage src={coverImage} />

      <input
        className="article-title-input"
        type="text"
        value={title === 'Untitled' ? '' : title || ''}
        onChange={(e) => onTitleChange?.(e.target.value || 'Untitled')}
        placeholder="Add a title"
        spellCheck={false}
      />

      <ArticleByline />

      <div className="article-compose-body">
        {children}
      </div>

      <div className="article-compose-footer">
        <button
          className={`article-copy-btn${copyState === 'copied' ? ' article-copy-btn--copied' : ''}`}
          onClick={copyAsHtml}
        >
          {copyState === 'copied' ? (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              Copied!
            </>
          ) : (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
              Copy as HTML
            </>
          )}
        </button>
      </div>
    </div>
  );
}
