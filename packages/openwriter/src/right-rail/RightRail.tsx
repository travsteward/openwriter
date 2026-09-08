/**
 * Right rail — full-height column on the right side of the app, mirroring
 * the left sidebar's structural rhythm:
 *
 *   topbar (48px, matches sidebar-topbar)
 *   icon strip (36px, matches search row)
 *   body (rest)
 *
 * border-left extends from top to bottom of the viewport. Resizable from
 * the left edge. Closing the rail collapses it to width 0; a toggle in
 * the titlebar brings it back.
 *
 * The rail topbar holds chrome that USED to live in the global titlebar:
 * HideRail close button (far-left, inward edge — mirror of sidebar's
 * collapse button on its right edge), format-toolbar toggle, and the
 * sync button cluster. When the rail is closed they all hide (mirror of
 * left sidebar — close it and its topbar contents go away too).
 *
 * adr: adr/right-rail.md
 */
import { useCallback, useEffect, useRef } from 'react';
import { usePanelVisibility } from '../hooks/usePanelVisibility';
import './RightRail.css';
import { useRightRail } from './RightRailContext';
import RailIconStrip from './RailIconStrip';
import RailBody from './RailBody';
import { HideRailIcon, FocusModeIcon, VoiceIcon } from './icons';
import SyncButton from '../sync/SyncButton';
import type { RightRailTabProps, TabId } from './types';
import type { SyncStatus } from '../ws/client';

interface RightRailProps extends RightRailTabProps {
  syncStatus: SyncStatus;
  onSync: () => void;
  onToggleToolbar: () => void;
  toolbarOpen: boolean;
  focusMode: boolean;
  onToggleFocusMode: () => void;
  // Author-attribution heatmap toggle. adr: adr/document-history-attribution.md
  heatmapOn: boolean;
  onToggleHeatmap: () => void;
  heatmapAvailable: boolean;
  heatmapTitle: string;
}

export default function RightRail(props: RightRailProps) {
  const { syncStatus, onSync, onToggleToolbar, toolbarOpen, focusMode, onToggleFocusMode, heatmapOn, onToggleHeatmap, heatmapAvailable, heatmapTitle, ...tabProps } = props;
  const { open, visible, overlay, activeTab, width, setWidth, closeRail, openTab } = useRightRail();
  const ref = useRef<HTMLElement>(null);
  usePanelVisibility(ref, visible, '[aria-label="Show right rail"]');

  // Snapshot of the rail's pre-focus-mode state so we can restore it on
  // exit. Lives here (not in App.tsx) because App is outside the rail
  // context and can't read open/activeTab directly.
  const railFocusSnapshot = useRef<{ open: boolean; activeTab: TabId | null } | null>(null);
  const prevFocusMode = useRef(focusMode);

  useEffect(() => {
    if (focusMode === prevFocusMode.current) return;
    prevFocusMode.current = focusMode;
    if (focusMode) {
      // Entering focus mode — snapshot rail state, force-close.
      railFocusSnapshot.current = { open, activeTab };
      if (open) closeRail();
    } else {
      // Exiting — restore rail to its prior state. In overlay mode skip the
      // restore: openTab there opens the floating drawer over the doc, and
      // "exit focus" on a narrow window should land on a clean doc.
      const snap = railFocusSnapshot.current;
      railFocusSnapshot.current = null;
      if (!overlay && snap?.open && snap.activeTab) openTab(snap.activeTab);
    }
    // open/activeTab/closeRail/openTab intentionally NOT in deps — we only
    // act on the focusMode transition itself, and we want fresh values of
    // open/activeTab at transition time without re-firing on every change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusMode]);

  // Drag-to-resize on the left (inner) edge — single handle spans the full
  // column height so the user can grab it anywhere along the rail's left
  // border. Pulling LEFT (negative dx) grows the rail.
  const startResize = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    const onMove = (ev: PointerEvent) => {
      const dx = startX - ev.clientX;
      setWidth(startWidth + dx);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [width, setWidth]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (!ref.current) return;
      if (ref.current.contains(document.activeElement)) {
        e.preventDefault();
        closeRail();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, closeRail]);

  // The column stays mounted whether open or closed and collapses its width
  // to 0 on close — mirroring the left sidebar exactly, so the hide/show
  // animation matches (instant open via the inline-width `transition: none`
  // rule, animated close via the base width transition). Keeping it mounted
  // also keeps the ow-activity-event listener pulsing + the auto-open-Review
  // hook watching pendingDocs (the job the old display:none keepalive did).
  // `visible` (not `open`) is the effective showing state — in overlay mode
  // it tracks the transient drawer.
  const collapsed = !visible;

  return (
    <aside
      ref={ref}
      className={`right-rail-column${collapsed ? '' : ' open'}`}
      style={collapsed ? undefined : { width, minWidth: width }}
      aria-label="Right rail"
      aria-hidden={!visible}
    >
      {/* Drag-to-resize is docked-only; in overlay the drawer uses its saved width. */}
      {!overlay && !collapsed && <div className="right-rail-resize-handle" onPointerDown={startResize} aria-hidden="true" />}
      <div className="right-rail-topbar">
        <div className="right-rail-topbar-actions right-rail-topbar-actions--start">
          <button
            type="button"
            className="right-rail-topbar-btn"
            onClick={closeRail}
            title="Hide rail"
            aria-label="Hide rail"
          >
            <HideRailIcon />
          </button>
          <button
            type="button"
            className={`right-rail-topbar-btn${focusMode ? ' right-rail-topbar-btn--active' : ''}`}
            onClick={onToggleFocusMode}
            title="Focus mode"
            aria-label="Focus mode"
            aria-pressed={focusMode}
          >
            <FocusModeIcon />
          </button>
          <button
            type="button"
            className={`right-rail-topbar-btn${toolbarOpen ? ' right-rail-topbar-btn--active' : ''}`}
            onClick={onToggleToolbar}
            title="Toggle format toolbar"
            aria-label="Toggle format toolbar"
            aria-pressed={toolbarOpen}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 20h16" />
              <path d="m6 16 6-12 6 12" />
              <path d="M8 12h8" />
            </svg>
          </button>
          {heatmapAvailable && (
            <button
              type="button"
              className={`right-rail-topbar-btn${heatmapOn ? ' right-rail-topbar-btn--active' : ''}`}
              onClick={onToggleHeatmap}
              title={heatmapTitle}
              aria-label="Voice heatmap (human vs agent)"
              aria-pressed={heatmapOn}
            >
              <VoiceIcon />
            </button>
          )}
        </div>
        <div className="right-rail-topbar-actions right-rail-topbar-actions--end">
          <SyncButton syncStatus={syncStatus} onSync={onSync} />
        </div>
      </div>
      <RailIconStrip pendingDocs={tabProps.pendingDocs} />
      <RailBody {...tabProps} focusMode={focusMode} />
    </aside>
  );
}
