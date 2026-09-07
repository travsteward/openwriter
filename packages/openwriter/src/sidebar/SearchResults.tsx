import { useState } from 'react';
import type { SearchResult, SidebarActions } from './sidebar-types';
import { formatDate } from './sidebar-utils';

interface SearchResultsProps {
  results: SearchResult[];
  query: string;
  onSwitchDocument: (filename: string) => void;
  actions: SidebarActions;
  loading?: boolean;
  error?: string | null;
}

/** Highlight matching text with <mark> tags. */
function highlightText(text: string, query: string): (string | JSX.Element)[] {
  if (!query) return [text];
  const parts: (string | JSX.Element)[] = [];
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  let cursor = 0;

  while (cursor < text.length) {
    const idx = lower.indexOf(q, cursor);
    if (idx === -1) {
      parts.push(text.slice(cursor));
      break;
    }
    if (idx > cursor) parts.push(text.slice(cursor, idx));
    parts.push(<mark key={idx}>{text.slice(idx, idx + query.length)}</mark>);
    cursor = idx + query.length;
  }

  return parts;
}


function ResultContent({ result: r, query }: { result: SearchResult; query: string }) {
  return <>
    <span className="sidebar-item-title"><span className="sidebar-item-title-text">{r.matchType === 'title' ? highlightText(r.title, query) : r.title}</span>
      {r.isArchived && <span className="search-archived-badge">archived</span>}
    </span>
    {r.matchType === 'tag' && r.matchedTag && <span className="search-result-tag">Tag: {highlightText(r.matchedTag, query)}</span>}
    {r.matchType === 'content' && r.snippet && <span className="search-result-snippet">{highlightText(r.snippet, query)}</span>}
    <span className="sidebar-item-meta">{r.wordCount.toLocaleString()} words &middot; {formatDate(r.lastModified)}</span>
  </>;
}

export default function SearchResults({ results, query, onSwitchDocument, actions, loading, error }: SearchResultsProps) {
  const [restoring, setRestoring] = useState<string | null>(null);
  const open = (result: SearchResult) => {
    if (result.matchType === 'content') {
      window.dispatchEvent(new CustomEvent('ow-navigate-to-link', {
        detail: { docId: null, filename: result.filename, nodeId: null, quote: query.trim() },
      }));
    } else onSwitchDocument(result.filename);
  };
  const restore = async (file: string) => {
    setRestoring(file);
    await actions.handleUnarchive(file);
    setRestoring(null);
  };
  const ordered = [...results.filter(r => !r.isArchived), ...results.filter(r => r.isArchived)];
  return <div className="sidebar-scroll" aria-label="Search results" aria-busy={!!loading}>
    {loading ? <div className="search-empty" role="status">Searching…</div>
      : error ? <div className="search-empty" role="status">Search unavailable: {error}</div>
      : results.length === 0 ? <div className="search-empty" role="status">No results for "{query}"</div>
      : <div className="search-results">{ordered.map(r => (
        <div key={r.filename} className={`sidebar-item search-result-item ${r.isActive ? 'active' : ''} ${r.isArchived ? 'search-result-archived' : ''}`}>
          {r.isArchived ? <>
            <ResultContent result={r} query={query} />
            <button type="button" className="search-result-restore" data-search-action aria-label={`Restore ${r.title}`}
              disabled={restoring !== null} onClick={() => void restore(r.filename)}>{restoring === r.filename ? 'Restoring…' : 'Restore'}</button>
          </> : <button type="button" className="search-result-open" data-search-action aria-label={`Open ${r.title}`} onClick={() => open(r)}>
            <ResultContent result={r} query={query} />
          </button>}
        </div>
      ))}</div>}
  </div>;
}
