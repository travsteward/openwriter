/**
 * Manuscript sections inside the Review tab. The manuscript is unified here —
 * everything you do with it lives in this one place, no separate rail icon:
 *
 *   - "This Manuscript" (active doc is a manuscript) — the Manifest/Preview view
 *     toggle (drives the main canvas via window events) + Download in every
 *     format (EPUB / HTML / DOCX / MD) straight off /api/manuscript/export.
 *   - "Manuscripts" — ALWAYS shown: a clickable launcher listing every
 *     manuscript in the profile, so you can open one for a quick read/review at
 *     any time, independent of workspace, pending state, or what's open.
 *
 * Styling reuses the review-tab design tokens + classes (toggle, section,
 * section-label) so it matches the pending UI in both light and dark mode.
 *
 * adr: adr/manuscript-engine.md
 */
import { useEffect, useState } from 'react';
import './ManuscriptRailSections.css';

interface ManuscriptItem {
  docId: string;
  title: string;
  filename: string;
}

interface Props {
  contentType?: string;
  docId: string | null;
  /** Active manuscript's paragraph style from manuscriptContext ('spaced' | 'indented'). */
  manuscriptStyle?: string;
  onSwitchDocument: (filename: string) => void;
}

type ParagraphStyle = 'spaced' | 'indented';

const DOWNLOADS: { fmt: string; label: string }[] = [
  { fmt: 'epub', label: 'EPUB' },
  { fmt: 'html', label: 'HTML' },
  { fmt: 'docx', label: 'DOCX' },
  { fmt: 'md', label: 'MD' },
];

export default function ManuscriptRailSections({ contentType, docId, manuscriptStyle, onSwitchDocument }: Props) {
  const [list, setList] = useState<ManuscriptItem[]>([]);
  const [mode, setMode] = useState<'manifest' | 'preview'>('manifest');
  const isManuscript = contentType === 'manuscript';

  // Paragraph style is a manuscript OPTION (not always-on indent). Optimistic
  // local mirror of manuscriptContext.paragraphStyle so the toggle feels instant;
  // the authoritative value flows back via the metadata broadcast → prop.
  const style: ParagraphStyle = manuscriptStyle === 'indented' ? 'indented' : 'spaced';
  const [pendingStyle, setPendingStyle] = useState<ParagraphStyle | null>(null);
  const effectiveStyle = pendingStyle ?? style;
  useEffect(() => { setPendingStyle(null); }, [manuscriptStyle, docId]);

  const setStyle = (next: ParagraphStyle) => {
    if (next === effectiveStyle) return;
    setPendingStyle(next);
    fetch('/api/metadata', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manuscriptContext: { paragraphStyle: next } }),
    })
      .then(() => {
        // Re-render the preview iframe so the new style shows immediately. The
        // compose view reloads only if it's actually showing the preview, so we
        // dispatch unconditionally and let it decide (no rail/canvas desync).
        window.dispatchEvent(new CustomEvent('ow-manuscript-restyle'));
      })
      .catch(() => setPendingStyle(null));
  };

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch('/api/manuscripts')
        .then((r) => r.json())
        .then((d) => { if (!cancelled) setList(d.manuscripts || []); })
        .catch(() => {});
    };
    load();
    window.addEventListener('ow-documents-changed', load);
    return () => { cancelled = true; window.removeEventListener('ow-documents-changed', load); };
  }, []);

  // Canvas resets to the manifest on doc switch — mirror that so the toggle stays in sync.
  useEffect(() => { setMode('manifest'); }, [docId]);

  const view = (m: 'manifest' | 'preview') => {
    setMode(m);
    window.dispatchEvent(new CustomEvent(m === 'preview' ? 'ow-manuscript-preview' : 'ow-manuscript-manifest'));
  };
  const exportHref = (fmt: string) => `/api/manuscript/export?docId=${encodeURIComponent(docId || '')}&format=${fmt}`;
  const toggleBtn = (active: boolean) => `review-panel__toggle-btn${active ? ' review-panel__toggle-btn--active' : ''}`;

  return (
    <>
      {isManuscript && docId && (
        <div className="review-tab__section">
          <div className="review-tab__section-label">This Manuscript</div>
          <div className="review-tab__toggle" role="tablist" aria-label="Manuscript view">
            <button type="button" className={toggleBtn(mode === 'manifest')} onClick={() => view('manifest')}>Manifest</button>
            <button
              type="button"
              className={toggleBtn(mode === 'preview')}
              onClick={() => view('preview')}
              title={mode === 'preview' ? 'Re-render' : 'Preview the compiled book'}
            >
              Preview
            </button>
          </div>
          <div className="ms-style-label">Paragraph style</div>
          <div className="review-tab__toggle" role="tablist" aria-label="Paragraph style">
            <button
              type="button"
              className={toggleBtn(effectiveStyle === 'spaced')}
              onClick={() => setStyle('spaced')}
              title="Blank line between paragraphs, no indent"
            >
              Spaced
            </button>
            <button
              type="button"
              className={toggleBtn(effectiveStyle === 'indented')}
              onClick={() => setStyle('indented')}
              title="First-line indent, no gap — traditional print"
            >
              Indented
            </button>
          </div>
          <div className="ms-dl-row">
            {DOWNLOADS.map((d) => (
              <a key={d.fmt} className="ms-dl-btn" href={exportHref(d.fmt)} download>{d.label}</a>
            ))}
          </div>
        </div>
      )}

      <div className="review-tab__section">
        <div className="review-tab__section-label">Manuscripts</div>
        {list.length === 0 ? (
          <div className="ms-empty">None yet — create one from the “+” menu.</div>
        ) : (
          <ul className="ms-list">
            {list.map((m) => (
              <li key={m.docId}>
                <button
                  type="button"
                  className={m.docId === docId ? 'ms-item ms-item--active' : 'ms-item'}
                  onClick={() => onSwitchDocument(m.filename)}
                  title={m.title}
                >
                  {m.title}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
