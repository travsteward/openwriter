import { useCallback, useEffect, useRef, useState } from 'react';
import type { SearchResult } from './sidebar-types';
import { checkedFetch } from '../utils/request';

// A query owns its request and results; changing/clearing it retires both.
// adr: adr/sidebar-search-navigation.md
export function useDocumentSearch(refreshKey: number) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryRef = useRef('');
  const request = useRef(0);
  const controller = useRef<AbortController>();
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const search = useCallback((value: string) => {
    const id = ++request.current;
    controller.current?.abort();
    clearTimeout(timer.current);
    queryRef.current = value;
    setQuery(value);
    setError(null);
    setResults(value.trim() ? [] : null);
    setLoading(!!value.trim());
    if (!value.trim()) return;
    const abort = new AbortController();
    controller.current = abort;
    timer.current = setTimeout(async () => {
      try {
        const response = await checkedFetch(`/api/documents/search?q=${encodeURIComponent(value.trim())}&archived=true`, { signal: abort.signal });
        const data = await response.json();
        if (id === request.current) setResults(data);
      } catch (err) {
        if (id === request.current && !abort.signal.aborted) setError(err instanceof Error ? err.message : 'Search is unavailable. Try again.');
      } finally {
        if (id === request.current) setLoading(false);
      }
    }, 250);
  }, []);
  useEffect(() => { search(queryRef.current); }, [refreshKey, search]);
  useEffect(() => () => { ++request.current; controller.current?.abort(); clearTimeout(timer.current); }, []);
  return { query, results, loading, error, search };
}
