/**
 * Backlinks tab — what links to this doc, and what this doc links to.
 *
 * Inbound: computed server-side as the inverse of every doc's `references:`
 * frontmatter array. The /api/backlinks/:docId endpoint already exists for
 * the in-prose decoration system; we reuse it here.
 *
 * Outbound: read from the active doc's `references:` frontmatter — pulled
 * directly from the live metadata broadcast via `metadata-changed`, so it
 * stays in sync as the agent (or a paste of a doc: link) updates it.
 *
 * adr: adr/right-rail.md
 */

import { useEffect, useMemo, useState } from 'react';
import type { RightRailTabProps } from '../types';

interface DocSummary {
  docId: string;
  filename: string;
  title: string;
}

interface InboundEntry {
  from_doc: string;
  text?: string;
  from_node?: string;
}

interface ResolvedEntry {
  docId: string;
  title: string;
  filename: string;
  snippet?: string;
}

export default function BacklinksTab({ docId, currentFilename, onSwitchDocument }: RightRailTabProps) {
  const [docsById, setDocsById] = useState<Map<string, DocSummary>>(new Map());
  const [inbound, setInbound] = useState<InboundEntry[]>([]);
  const [outboundIds, setOutboundIds] = useState<string[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [loadingLinks, setLoadingLinks] = useState(false);

  // Doc list: build a docId → summary index. Refetched on every workspace
  // structural change so renames/deletes don't leave stale titles in the rail.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch('/api/documents');
        const data = await r.json();
        if (cancelled) return;
        const map = new Map<string, DocSummary>();
        if (Array.isArray(data)) {
          for (const d of data) {
            if (d?.docId) {
              map.set(d.docId, { docId: d.docId, filename: d.filename, title: d.title || d.filename });
            }
          }
        }
        setDocsById(map);
      } catch { /* keep prior map */ } finally {
        if (!cancelled) setLoadingDocs(false);
      }
    };
    load();
    const onChange = () => load();
    window.addEventListener('ow-documents-changed', onChange);
    return () => {
      cancelled = true;
      window.removeEventListener('ow-documents-changed', onChange);
    };
  }, []);

  // Inbound: fetch when the active doc changes OR when metadata changes
  // for the current doc (a link landed; references changed somewhere).
  useEffect(() => {
    if (!docId) { setInbound([]); return; }
    let cancelled = false;
    const load = () => {
      setLoadingLinks(true);
      fetch(`/api/backlinks/${docId}`)
        .then((r) => r.ok ? r.json() : [])
        .then((entries) => { if (!cancelled) setInbound(Array.isArray(entries) ? entries : []); })
        .catch(() => { if (!cancelled) setInbound([]); })
        .finally(() => { if (!cancelled) setLoadingLinks(false); });
    };
    load();
    const onMeta = () => load();
    window.addEventListener('ow-metadata-changed', onMeta);
    return () => {
      cancelled = true;
      window.removeEventListener('ow-metadata-changed', onMeta);
    };
  }, [docId]);

  // Outbound: read the active doc's references array. Fetched from /api/document
  // which returns the live in-memory state with current metadata.
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch('/api/document')
        .then((r) => r.json())
        .then((data) => {
          if (cancelled) return;
          const refs = data?.metadata?.references;
          setOutboundIds(Array.isArray(refs) ? refs : []);
        })
        .catch(() => { if (!cancelled) setOutboundIds([]); });
    };
    load();
    const onMeta = () => load();
    window.addEventListener('ow-metadata-changed', onMeta);
    return () => {
      cancelled = true;
      window.removeEventListener('ow-metadata-changed', onMeta);
    };
  }, [currentFilename, docId]);

  const inboundResolved = useMemo<ResolvedEntry[]>(() => {
    return inbound
      .map((entry): ResolvedEntry | null => {
        const summary = docsById.get(entry.from_doc);
        if (!summary) return null;
        return {
          docId: entry.from_doc,
          title: summary.title,
          filename: summary.filename,
          snippet: entry.text,
        };
      })
      .filter((e): e is ResolvedEntry => e !== null);
  }, [inbound, docsById]);

  const outboundResolved = useMemo<ResolvedEntry[]>(() => {
    return outboundIds
      .map((id) => {
        const summary = docsById.get(id);
        if (!summary) return null;
        return { docId: id, title: summary.title, filename: summary.filename };
      })
      .filter((e): e is ResolvedEntry => e !== null);
  }, [outboundIds, docsById]);

  if (!docId) {
    return (
      <div className="backlinks-tab__empty">
        <div className="backlinks-tab__empty-title">No document open</div>
        <div className="backlinks-tab__empty-note">Open a doc to see what links to it and what it links out to.</div>
      </div>
    );
  }

  const showLoading = loadingDocs || loadingLinks;

  return (
    <div className="backlinks-tab">
      <div className="backlinks-tab__group">
        <div className="backlinks-tab__group-label">
          Inbound <span className="backlinks-tab__count">{inboundResolved.length}</span>
        </div>
        {showLoading && inboundResolved.length === 0 ? (
          <div className="backlinks-tab__empty-note backlinks-tab__inline-note">Loading…</div>
        ) : inboundResolved.length === 0 ? (
          <div className="backlinks-tab__empty-note backlinks-tab__inline-note">No docs link to this one yet.</div>
        ) : (
          inboundResolved.map((entry) => (
            <button
              key={entry.docId}
              type="button"
              className="backlinks-tab__entry"
              onClick={() => onSwitchDocument(entry.filename)}
            >
              <div className="backlinks-tab__entry-title">{entry.title}</div>
              {entry.snippet && <div className="backlinks-tab__entry-snippet">{entry.snippet}</div>}
            </button>
          ))
        )}
      </div>

      <div className="backlinks-tab__group">
        <div className="backlinks-tab__group-label">
          Outbound <span className="backlinks-tab__count">{outboundResolved.length}</span>
        </div>
        {outboundResolved.length === 0 ? (
          <div className="backlinks-tab__empty-note backlinks-tab__inline-note">This doc doesn&rsquo;t reference others yet.</div>
        ) : (
          outboundResolved.map((entry) => (
            <button
              key={entry.docId}
              type="button"
              className="backlinks-tab__entry"
              onClick={() => onSwitchDocument(entry.filename)}
            >
              <div className="backlinks-tab__entry-title">{entry.title}</div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
