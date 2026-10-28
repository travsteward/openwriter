/**
 * Sync status line in the right-rail topbar: always says where the writer's
 * documents stand ("Synced", with when on hover, "Syncing…", "Offline, will sync") and,
 * when something is wrong, the fix ("Sign in to GitHub"), with the reason on
 * hover. It shares a narrow bar, so it stays short and never runs past the
 * edge. Sync runs by itself; a click syncs now, or opens
 * setup when that is the fix. Never shows file paths.
 *
 * adr: adr/right-rail.md · adr: adr/two-way-sync.md
 */
import { useEffect, useState } from 'react';
import type { SyncStatus } from '../ws/client';

interface SyncButtonProps {
  syncStatus: SyncStatus;
  onSync: () => void;
}

const CloudIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
    <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const CloudCheckIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
    <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M9 14l2 2 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const CloudOffIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
    <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M4 4l16 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const CloudErrorIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
    <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M14 14l-4 4M10 14l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const FIX_LABEL: Record<NonNullable<SyncStatus['fix']>, string> = {
  signin: 'Sign in to GitHub',
  setup: 'Reconnect GitHub',
  retry: 'Sync failed, retry',
};

/** "just now", "4 min ago", "2 h ago", or the date. */
export function syncedAgo(iso: string | undefined, now = Date.now()): string {
  if (!iso) return '';
  const min = Math.floor((now - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  if (min < 24 * 60) return `${Math.floor(min / 60)} h ago`;
  return `on ${new Date(iso).toLocaleDateString()}`;
}

/** The status line's words for a sync status. */
export function syncLine(s: SyncStatus): string {
  switch (s.state) {
    case 'unconfigured': return 'Sync with GitHub';
    case 'syncing': return 'Syncing…';
    case 'offline': return 'Offline, will sync';
    case 'error': return FIX_LABEL[s.fix || 'retry'];
    default: return s.lastSyncTime ? 'Synced' : 'Syncing soon';
  }
}

export default function SyncButton({ syncStatus, onSync }: SyncButtonProps) {
  // The hover text's "Synced N min ago" moves on by itself.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const { state } = syncStatus;
  const title = state === 'unconfigured'
    ? 'Keep your documents the same on every device'
    : state === 'error' ? `${syncStatus.error || 'Could not sync'}. ${FIX_LABEL[syncStatus.fix || 'retry']}.`
    : state === 'offline' ? 'Offline. Your work is saved here and syncs when you are back online.'
    : syncStatus.lastSyncTime ? `Synced ${syncedAgo(syncStatus.lastSyncTime, now)}. Click to sync now.`
    : 'Saved here. It goes to GitHub on the next sync. Click to sync now.';

  return (
    <div className="sync-btn-group">
      <button
        className={`titlebar-btn sync-btn-state sync-${state}`}
        onClick={onSync}
        disabled={state === 'syncing'}
        title={title}
      >
        {state === 'unconfigured' && <CloudIcon />}
        {(state === 'synced' || state === 'pending') && <CloudCheckIcon />}
        {state === 'syncing' && <div className="sync-btn-spinner" />}
        {state === 'offline' && <CloudOffIcon />}
        {state === 'error' && <CloudErrorIcon />}
        <span className="sync-btn-label">{syncLine(syncStatus)}</span>
      </button>
    </div>
  );
}
