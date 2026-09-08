/**
 * Persistent row of tab icons inside the rail's column. Sits at search-row
 * height (36px) directly under the rail topbar. Click an icon to switch
 * tabs. Clicking the already-active icon navigates back to Activity (the
 * default tab) — it does NOT close the rail (use HideRail in the topbar
 * to close). This mirrors the left sidebar: clicking the active tree icon
 * returns to the file tree default rather than collapsing the sidebar.
 *
 * The Activity icon owns the bell behavior from the original titlebar
 * bell: pulse on live `ow-activity-event`, one-time onboarding tooltip
 * on first agent action.
 *
 * Auto-open of Review on pending-writes arrival lives here too — even
 * when the rail is "closed", the parent <RightRail> still mounts this
 * component (display: none) so the 0 → >0 pending transition is observed.
 *
 * adr: adr/right-rail.md
 */
import { useCallback, useEffect, useState } from 'react';
import { useRightRail } from './RightRailContext';
import { TAB_REGISTRY } from './tabs';
import type { PendingDocsPayload } from '../ws/client';

interface RailIconStripProps {
  pendingDocs: PendingDocsPayload;
  autoReveal: boolean;
}

// Last observed pending count, kept at MODULE scope so it survives this
// component unmount/remount. <RightRail> renders RailIconStrip at two
// positions — a hidden keepalive when the rail is closed and inside the
// column when open — so every visibility toggle remounts the strip. An
// instance-level ref would reset to 0 on each mount, making the 0→>0
// guard re-fire and re-open the rail on every close (the rail then can't
// be hidden, and focus mode can't keep it shut). Module scope makes the
// "already auto-opened for this batch" memory outlive the remount.
let lastPendingCount = 0;

export default function RailIconStrip({ pendingDocs, autoReveal }: RailIconStripProps) {
  const { visible, activeTab, openTab } = useRightRail();
  const [pulsingActivity, setPulsingActivity] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  // Focus has its own visible review controls; arrivals must not open a panel.
  const revealReview = useCallback(() => {
    if (autoReveal) openTab('review');
  }, [autoReveal, openTab]);

  useEffect(() => {
    const cur = pendingDocs.filenames.length;
    const prev = lastPendingCount;
    lastPendingCount = cur;
    if (prev === 0 && cur > 0) revealReview();
  }, [pendingDocs.filenames.length, revealReview]);

  // Right-click actions (enhance, author's voice) apply pending changes directly
  // into the editor — the server's pending-docs-changed WebSocket event only arrives
  // after the auto-save debounce, and the 0→>0 guard above misses it entirely if any
  // other doc is already pending. Switch to Review immediately on the client event.
  useEffect(() => {
    const handler = () => revealReview();
    window.addEventListener('ow-pending-write-applied', handler);
    return () => window.removeEventListener('ow-pending-write-applied', handler);
  }, [revealReview]);

  useEffect(() => {
    const handler = () => {
      const lookingAtActivity = visible && activeTab === 'activity';
      if (lookingAtActivity) return;
      setPulsingActivity(true);
      window.setTimeout(() => setPulsingActivity(false), 500);

      try {
        if (!localStorage.getItem('ow-bell-hint-seen')) {
          setShowOnboarding(true);
          localStorage.setItem('ow-bell-hint-seen', '1');
          window.setTimeout(() => setShowOnboarding(false), 6000);
        }
      } catch { /* private-mode storage denied */ }
    };
    window.addEventListener('ow-activity-event', handler);
    return () => window.removeEventListener('ow-activity-event', handler);
  }, [visible, activeTab]);

  return (
    <div
      className="rail-icon-strip"
      role="tablist"
      aria-label="Right rail tabs"
    >
      {TAB_REGISTRY.map((tab) => {
        const selected = visible && activeTab === tab.id;
        const isActivity = tab.id === 'activity';
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            className={[
              'rail-icon-btn',
              selected ? 'rail-icon-btn--active' : '',
              `rail-icon-btn--scope-${tab.scope}`,
              isActivity && pulsingActivity ? 'rail-icon-btn--pulsing' : '',
            ].filter(Boolean).join(' ')}
            onClick={() => openTab(tab.id)}
            title={tab.label}
            aria-label={tab.label}
          >
            {tab.icon}
            {isActivity && showOnboarding && (
              <div className="rail-icon-hint" role="tooltip">
                <span>Agent activity lives here.</span>
                <button
                  type="button"
                  className="rail-icon-hint-close"
                  onClick={(e) => { e.stopPropagation(); setShowOnboarding(false); }}
                  aria-label="Dismiss"
                >×</button>
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
