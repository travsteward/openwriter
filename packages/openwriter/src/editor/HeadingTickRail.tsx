/**
 * Heading tick-rail — the editor's version of the manuscript preview's
 * chapter tick-rail (manuscript-compose/ChapterTickRail). One tick per H1-H3,
 * smaller headings shorter and indented, the current section highlighted as
 * you scroll, hover shows the heading, click jumps to it.
 *
 * Same look (it reuses ChapterTickRail.css), different source: the preview
 * rail reaches into an embedded book page, this one reads headings straight
 * from the editor and re-reads them on every edit. Pinned like BackToTop: a
 * zero-height sticky anchor at the top of the doc scroll area.
 */

import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import '../manuscript-compose/ChapterTickRail.css';
import './HeadingTickRail.css';

interface Heading { level: number; text: string; pos: number }

/** Top offset (px) a heading must scroll past to become the current one. */
const ACTIVE_LINE = 80;

function readHeadings(editor: Editor): Heading[] {
  const out: Heading[] = [];
  editor.state.doc.forEach((node, pos) => {
    if (node.type.name === 'heading' && node.attrs.level <= 3 && node.textContent.trim()) {
      out.push({ level: node.attrs.level, text: node.textContent.trim(), pos });
    }
  });
  return out;
}

export default function HeadingTickRail({ editor }: { editor: Editor | null }) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [active, setActive] = useState(0);
  const headingsRef = useRef<Heading[]>([]);

  const headingTop = (h: Heading): number | null => {
    if (!editor || editor.isDestroyed) return null;
    const dom = editor.view.nodeDOM(h.pos) as HTMLElement | null;
    return dom?.getBoundingClientRect ? dom.getBoundingClientRect().top : null;
  };

  useEffect(() => {
    const scroller = anchorRef.current?.parentElement;
    if (!editor || editor.isDestroyed || !scroller) return;

    const onScroll = () => {
      const top = scroller.getBoundingClientRect().top + ACTIVE_LINE;
      let idx = 0;
      headingsRef.current.forEach((h, i) => {
        const t = headingTop(h);
        if (t !== null && t <= top) idx = i;
      });
      setActive(idx);
    };
    // 'transaction', not 'update': a document switch replaces the content
    // without an update event. Cursor moves keep the same doc and are skipped.
    let lastDoc: unknown = null;
    const onUpdate = () => {
      if (editor.state.doc === lastDoc) return;
      lastDoc = editor.state.doc;
      // Hidden editor (e.g. the manuscript preview is showing): no rail.
      const list = editor.view.dom.getClientRects().length > 0 ? readHeadings(editor) : [];
      headingsRef.current = list;
      setHeadings(list);
      onScroll();
    };

    onUpdate();
    editor.on('transaction', onUpdate);
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      editor.off('transaction', onUpdate);
      scroller.removeEventListener('scroll', onScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  const jump = (i: number) => {
    const scroller = anchorRef.current?.parentElement;
    const h = headingsRef.current[i];
    const t = h ? headingTop(h) : null;
    if (!scroller || t === null) return;
    scroller.scrollTo({ top: scroller.scrollTop + t - scroller.getBoundingClientRect().top - 8, behavior: 'smooth' });
    setActive(i);
  };

  return (
    <div ref={anchorRef} className="heading-tickrail-anchor">
      {headings.length >= 2 && (
        <nav className="ch-tickrail heading-tickrail" aria-label="Headings">
          {headings.map((h, i) => (
            <button
              key={`${h.pos}-${i}`}
              type="button"
              className={`ch-tick heading-tick--h${h.level}${i === active ? ' ch-tick--active' : ''}`}
              onClick={() => jump(i)}
              title={h.text}
              aria-current={i === active ? 'true' : undefined}
            >
              <span className="ch-tick__line" />
              <span className="ch-tick__label">{h.text}</span>
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
