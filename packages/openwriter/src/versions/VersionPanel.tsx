import { useCallback, useEffect, useRef, useState } from 'react';
import './versions.css';

interface VersionInfo {
  timestamp: number;
  date: string;
  size: number;
  wordCount: number;
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export default function VersionPanel() {
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<VersionInfo[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const fetchVersions = useCallback(() => {
    fetch('/api/versions')
      .then((res) => res.json())
      .then((data) => {
        setVersions(Array.isArray(data) ? data : []);
        setSelected(null);
      })
      .catch(() => setVersions([]));
  }, []);

  // Fetch when opened
  useEffect(() => {
    if (open) fetchVersions();
  }, [open, fetchVersions]);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleRestore = useCallback(async (mode: 'review' | 'full') => {
    if (selected === null) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/versions/${selected}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      if (res.ok) {
        fetchVersions();
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [selected, fetchVersions]);

  return (
    <div className="version-wrapper" ref={ref}>
      <button
        className={`titlebar-nav-btn${open ? ' titlebar-nav-btn--active' : ''}`}
        onClick={() => setOpen(!open)}
        title="Version history"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
          <path d="M12 7v5l3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="version-dropdown">
          <div className="version-dropdown__header">Version History</div>
          <div className="version-dropdown__list">
            {versions.length === 0 ? (
              <div className="version-dropdown__empty">
                No versions yet. Versions are created automatically when you save.
              </div>
            ) : (
              versions.map((v) => (
                <div
                  key={v.timestamp}
                  className={`version-dropdown__item${selected === v.timestamp ? ' version-dropdown__item--selected' : ''}`}
                  onClick={() => setSelected(v.timestamp === selected ? null : v.timestamp)}
                >
                  <span className="version-dropdown__item-time">{relativeTime(v.timestamp)}</span>
                  <span className="version-dropdown__item-meta">
                    {v.wordCount.toLocaleString()} words &middot; {formatSize(v.size)}
                  </span>
                </div>
              ))
            )}
          </div>
          {versions.length > 0 && (
            <div className="version-dropdown__footer">
              <button
                className="version-dropdown__review-btn"
                disabled={selected === null || loading}
                onClick={() => handleRestore('review')}
              >
                Review
              </button>
              <button
                className="version-dropdown__restore-btn"
                disabled={selected === null || loading}
                onClick={() => handleRestore('full')}
              >
                Restore
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
