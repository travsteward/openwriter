import type { KeyboardEvent } from 'react';

export function sidebarRowProps(expanded?: boolean) {
  return {
    role: 'button' as const,
    tabIndex: 0,
    'data-sidebar-row': true,
    'aria-expanded': expanded,
    onKeyDown(e: KeyboardEvent<HTMLElement>) {
      if (e.target !== e.currentTarget) return;
      if (e.key === 'Enter' || e.key === ' ' ||
        (e.key === 'ArrowRight' && expanded === false) || (e.key === 'ArrowLeft' && expanded === true)) {
        e.preventDefault();
        e.currentTarget.click();
      }
      if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        e.currentTarget.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: rect.left + 12, clientY: rect.top + 12 }));
      }
    },
  };
}

export function moveSidebarFocus(e: KeyboardEvent<HTMLElement>) {
  if (e.defaultPrevented || (e.target as HTMLElement).closest('input,textarea,[contenteditable="true"]')) return;
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
  const rows = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-sidebar-row],[data-search-action]')]
    .filter(el => el.offsetParent !== null && !el.closest('[inert]') && !el.hasAttribute('disabled'));
  const index = rows.indexOf(document.activeElement as HTMLElement);
  if (index < 0 || !rows.length) return;
  e.preventDefault();
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1)));
  rows[next].focus();
}

export function searchInputKeyDown(e: KeyboardEvent<HTMLInputElement>, clear: () => void) {
  if (e.key === 'Escape') { e.preventDefault(); clear(); return; }
  if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) return;
  const rows = [...(e.currentTarget.closest('.sidebar')?.querySelectorAll<HTMLButtonElement>('[data-search-action]') ?? [])].filter(el => !el.disabled);
  const row = e.key === 'ArrowUp' ? rows.at(-1) : rows[0];
  if (row) { e.preventDefault(); if (e.key === 'Enter') row.click(); else row.focus(); }
}
