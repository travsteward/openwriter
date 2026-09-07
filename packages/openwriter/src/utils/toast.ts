/**
 * Toast — OpenWriter's canonical transient-notification primitive.
 * ════════════════════════════════════════════════════════════════════════════
 * THE house toast. New flows that need a momentary, fire-and-forget message
 * (copied!, scheduled, sync error, "selection too large") should call this —
 * do NOT reinvent inline error state or one-off banners for transient feedback.
 *
 * Usage:
 *   import { showToast } from '../utils/toast';
 *   showToast('Copied to clipboard');               // info (neutral)
 *   showToast('Selection too large', 'error');       // error (red left-accent)
 *   showToast('Saved', 'info', 2000);                // custom duration (ms)
 *   showToast('Out of balance', 'error', 8000, {     // optional inline action button
 *     label: 'Top up', onClick: () => openCheckout() });
 *
 * When to use what (OpenWriter has three feedback patterns — pick the right one):
 *   • showToast()  — TRANSIENT, global, fire-and-forget. Auto-dismisses. Use for
 *     momentary results, especially from imperative handlers (context-menu actions,
 *     keyboard shortcuts) that aren't rendering components with their own state.
 *   • Banner (App.tsx: connection-banner / editor-reload-banner) — PERSISTENT,
 *     sticky app-state indicator that stays until the condition clears.
 *   • Inline setError() (compose views) — error text rendered INSIDE a specific
 *     view that already holds component state.
 *
 * Implementation: pure DOM, zero deps, no React state — appendable from anywhere.
 * Styling mirrors the context-menu popout via global design tokens (--bg-surface,
 * --border, --font-body, --ink-dark, 8px radius, the standard shadow), so it
 * auto-adapts to light/dark mode. Error variant adds a --color-pending-delete
 * left accent. Keep this token-based — never hardcode colors (would break theming).
 * ════════════════════════════════════════════════════════════════════════════
 */

let container: HTMLDivElement | null = null;

function ensureContainer(): HTMLDivElement {
  if (container && document.body.contains(container)) return container;
  container = document.createElement('div');
  container.style.cssText = [
    'position:fixed', 'left:50%', 'bottom:32px', 'transform:translateX(-50%)',
    'z-index:99999', 'display:flex', 'flex-direction:column', 'gap:8px',
    'align-items:center', 'pointer-events:none',
  ].join(';');
  document.body.appendChild(container);
  return container;
}

export type ToastKind = 'info' | 'error';

/** Optional inline action rendered as a button on the right of the toast (e.g. "Top up"). */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

export function showToast(message: string, kind: ToastKind = 'info', durationMs = 3500, action?: ToastAction): void {
  const root = ensureContainer();
  const el = document.createElement('div');
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.setAttribute('aria-atomic', 'true');
  // Match the context-menu popout: --bg-surface, --border, 8px radius, the same shadow,
  // --font-body, --ink-dark. Global :root / [data-mode="dark"] tokens auto-adapt to theme.
  // Error variant adds a left accent in the standard pending-delete red, surface stays neutral.
  el.style.cssText = [
    'background:var(--bg-surface)',
    `border:1px solid var(--border)`,
    kind === 'error' ? 'border-left:3px solid var(--color-pending-delete)' : '',
    'color:var(--ink-dark)', 'font-family:var(--font-body)',
    'padding:10px 14px', 'border-radius:8px', 'font-size:13px', 'line-height:1.4',
    'max-width:420px', 'box-shadow:0 4px 20px rgba(0,0,0,0.15)', 'pointer-events:auto',
    'opacity:0', 'transition:opacity 160ms ease, transform 160ms ease',
    'transform:translateY(6px)',
    // Action button needs the message + button laid out in a row.
    action ? 'display:flex;align-items:center;gap:12px' : '',
  ].filter(Boolean).join(';');

  const text = document.createElement('span');
  text.textContent = message;
  el.appendChild(text);

  if (action) {
    const btn = document.createElement('button');
    btn.textContent = action.label;
    // Token-styled accent button — no hardcoded colors. Mirrors the right-rail upgrade button.
    btn.style.cssText = [
      'flex-shrink:0', 'padding:4px 12px', 'border-radius:6px',
      'border:1px solid var(--accent)', 'background:var(--accent)', 'color:var(--bg-surface)',
      'font-family:var(--font-body)', 'font-size:12px', 'font-weight:600', 'cursor:pointer',
    ].join(';');
    btn.addEventListener('click', () => {
      try { action.onClick(); } finally { removeToast(); }
    });
    el.appendChild(btn);
  }

  function removeToast() {
    el.style.opacity = '0';
    el.style.transform = 'translateY(6px)';
    setTimeout(() => { el.remove(); if (root.childElementCount === 0) { root.remove(); container = null; } }, 200);
  }

  root.appendChild(el);
  // fade in
  requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'translateY(0)'; });
  // fade out + remove (or sooner, if the action button is clicked)
  setTimeout(removeToast, durationMs);
}
