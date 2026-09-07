import { useLayoutEffect, type RefObject } from 'react';

/** Keep background listeners mounted without exposing hidden controls. */
export function usePanelVisibility(ref: RefObject<HTMLElement>, visible: boolean, opener: string) {
  useLayoutEffect(() => {
    const panel = ref.current;
    if (!panel) return;
    const restoreFocus = !visible && panel.contains(document.activeElement);
    panel.inert = !visible;
    if (restoreFocus) {
      const frame = requestAnimationFrame(() => document.querySelector<HTMLElement>(opener)?.focus());
      return () => cancelAnimationFrame(frame);
    }
  }, [ref, visible, opener]);
}
