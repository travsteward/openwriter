/**
 * Back-to-top arrow pinned at the top right of the doc scroll area, beside the
 * scrollbar. Appears once the reader is more than a screen down; scrolls only
 * the view, never the cursor or the document.
 */

import { useEffect, useRef, useState } from 'react';
import './BackToTop.css';

const ArrowUp = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M3 10l5-5 5 5" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export default function BackToTop() {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const scroller = anchorRef.current?.parentElement;
    if (!scroller) return;
    const update = () => setVisible(scroller.scrollTop > scroller.clientHeight);
    update();
    scroller.addEventListener('scroll', update, { passive: true });
    return () => scroller.removeEventListener('scroll', update);
  }, []);

  const toTop = () => {
    anchorRef.current?.parentElement?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div ref={anchorRef} className="back-to-top-anchor">
      {visible && (
        <button type="button" className="review-panel__btn back-to-top" onClick={toTop} title="Back to top" aria-label="Back to top">
          <ArrowUp />
        </button>
      )}
    </div>
  );
}
