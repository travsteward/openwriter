/**
 * Where a doc stands in a book (GET /api/book): an outline with its
 * manuscripts, a manuscript with its outline's chapters, or a beat that a
 * manuscript already holds. Refetches when the doc, the document list, or
 * `refreshKey` changes. adr: adr/manuscript-engine.md
 */
import { useCallback, useEffect, useState } from 'react';

export interface BookDoc { docId: string; title: string; filename: string }

export interface BookStatus {
  role: 'outline' | 'manuscript' | null;
  outline?: BookDoc;
  /** Outline: manuscripts built from it, newest first. */
  manuscripts?: BookDoc[];
  /** Outline: older copies under it that can become its manuscript. */
  revisions?: BookDoc[];
  /** Manuscript: where each outline chapter stands. */
  chapters?: { heading: string; state: 'present' | 'pending' | 'missing' }[];
  /** Any other doc: manuscripts that already hold it as a beat. */
  inManuscripts?: BookDoc[];
}

export function useBookStatus(docId: string | null, refreshKey?: unknown): [BookStatus | null, () => void] {
  const [result, setResult] = useState<{ docId: string; status: BookStatus } | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!docId) return;
    let cancelled = false;
    fetch(`/api/book?docId=${encodeURIComponent(docId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((status) => { if (!cancelled) setResult(status ? { docId, status } : null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [docId, refreshKey, tick]);

  useEffect(() => {
    window.addEventListener('ow-documents-changed', reload);
    return () => window.removeEventListener('ow-documents-changed', reload);
  }, [reload]);

  // Never show the previous doc's answer for this one.
  return [result && result.docId === docId ? result.status : null, reload];
}
