import { useCallback, useEffect, useRef } from 'react';

interface RevealableDoc {
  filename: string;
  isActive?: boolean;
}

/**
 * Keeps the active doc located in the sidebar — and centers + pulses it when a
 * doc is opened via a *directed* navigation (deep link `/d/{docId}`, a backlink,
 * or an in-editor wikilink), which is the exact moment the user loses where the
 * doc sits in the tree.
 *
 * Design notes (each fixes a bug seen live):
 *  - **Single cancellable timer.** Calm reveals (active-doc change), directed
 *    reveals (the event), and tree-load retries all funnel through ONE pending
 *    timeout — the latest cancels the earlier — so a directed open produces a
 *    single clean scroll. The earlier split caused a bottom→top flicker (the
 *    calm "nearest" nudge landed the row at an edge, then the directed scroll
 *    jumped it again).
 *  - **Deterministic centering via scrollTop.** `scrollIntoView` scrolls the
 *    nearest scrollable ancestor — ambiguous here — and `block:'center'` landed
 *    the row near the top. We compute the offset within the known scroll root
 *    (`scrollRef`) and set scrollTop directly.
 *  - **Retry on tree load.** On a cold deep-link boot the doc goes active before
 *    the workspace tree finishes loading, so expandAncestors finds no path yet.
 *    We re-attempt whenever `treeSignal` changes; the pending directed pulse is
 *    held in a ref until the row can actually be found.
 *  - **setTimeout, not rAF.** rAF is paused in background tabs, so a deep link
 *    cmd-clicked into a background tab would never reveal until focus.
 *
 * Mode-agnostic: targets `[data-drag-id]` (falls back to `.active`).
 * `expandAncestors` is supplied only by modes with collapsible folders.
 */
export function useRevealActiveDoc(
  scrollRef: React.RefObject<HTMLElement>,
  docs: RevealableDoc[],
  treeSignal: number,
  expandAncestors?: (filename: string) => void,
) {
  const docsRef = useRef(docs);
  docsRef.current = docs;
  const expandRef = useRef(expandAncestors);
  expandRef.current = expandAncestors;
  // Filename awaiting a directed (center + pulse) reveal. Held until the row is
  // actually found, so a request made before the tree loaded still lands.
  const directedRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Editor focus and sidebar navigation are separate: a deletion fallback
  // keeps the user's tree location, including subsequent tree refreshes.
  // adr: adr/sidebar-navigation-intent.md
  const preservedFilenameRef = useRef<string | null>(null);

  const reveal = useCallback((filename: string | undefined) => {
    const target = filename || docsRef.current.find((d) => d.isActive)?.filename;
    if (!target || target === preservedFilenameRef.current) return;
    // Expand ancestors first so the row becomes renderable.
    expandRef.current?.(target);
    // One pending attempt at a time — the latest call wins, so calm + directed +
    // retries collapse to a single scroll. setTimeout (not rAF) fires in a
    // backgrounded tab too; 60ms clears React's commit of the expand.
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const root = scrollRef.current;
      if (!root) return;
      const el = (root.querySelector(`[data-drag-id="${CSS.escape(target)}"]`)
        || root.querySelector('.active')) as HTMLElement | null;
      // Not found / still collapsed — leave directedRef set; a later treeSignal
      // retry will catch it.
      if (!el || el.offsetParent === null) return;

      const directed = directedRef.current === target;
      const r = el.getBoundingClientRect();
      const rr = root.getBoundingClientRect();
      const offscreen = r.top < rr.top || r.bottom > rr.bottom;

      // Center deterministically within the scroll root. Clamped by the browser
      // to [0, maxScroll], so rows near the top/bottom land as close to center
      // as possible rather than being unreachable.
      if (directed || offscreen) {
        const delta = (r.top - rr.top) - (rr.height / 2 - r.height / 2);
        root.scrollTop += delta;
      }

      if (directed) {
        directedRef.current = null;
        el.classList.remove('reveal-pulse');
        void el.offsetWidth; // reflow → restart the animation if mid-flight
        el.classList.add('reveal-pulse');
        setTimeout(() => el.classList.remove('reveal-pulse'), 1200);
      }
    }, 60);
  }, [scrollRef]);

  // Re-attempt on active-doc change AND on tree load/change.
  const activeFilename = docs.find((d) => d.isActive)?.filename;
  useEffect(() => {
    reveal(activeFilename);
  }, [activeFilename, treeSignal, reveal]);

  useEffect(() => {
    const handler = (e: Event) => {
      const { filename, navigation } = (e as CustomEvent).detail;
      preservedFilenameRef.current = navigation === 'fallback' ? filename : null;
      // Cancel an unfinished reveal of the deleted doc as well as its pulse.
      if (navigation === 'fallback') {
        directedRef.current = null;
        if (timerRef.current) clearTimeout(timerRef.current);
      }
    };
    window.addEventListener('ow-document-navigation', handler);
    return () => window.removeEventListener('ow-document-navigation', handler);
  }, []);

  // Directed open: mark the pending pulse, then attempt. If the tree isn't
  // loaded yet, the effect above retries when treeSignal changes.
  useEffect(() => {
    const handler = (e: Event) => {
      const fn = (e as CustomEvent).detail?.filename || docsRef.current.find((d) => d.isActive)?.filename;
      if (!fn) return;
      preservedFilenameRef.current = null;
      directedRef.current = fn;
      reveal(fn);
    };
    window.addEventListener('ow-reveal-active-doc', handler);
    return () => window.removeEventListener('ow-reveal-active-doc', handler);
  }, [reveal]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
}
