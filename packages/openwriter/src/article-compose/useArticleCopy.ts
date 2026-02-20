import { useCallback, useRef, useState } from 'react';

type CopyState = 'idle' | 'copied';

/**
 * Hook for copying article content as dual-format HTML + plain text.
 * Ported from BreeWriter's copyDocumentContentAsHtml pattern.
 * When pasted into X's article editor, X reads text/html and preserves formatting.
 */
export function useArticleCopy() {
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const copyAsHtml = useCallback(async () => {
    const editorEl = document.querySelector('.ProseMirror') as HTMLElement | null;
    if (!editorEl) return;

    // Clone and strip OpenWriter decorations
    const clone = editorEl.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.ProseMirror-widget, [data-widget], .ProseMirror-gapcursor').forEach(el => el.remove());

    // Prepend cover image + title from the article compose view
    let prefix = '';
    const coverImg = document.querySelector('.article-cover-img') as HTMLImageElement | null;
    if (coverImg?.src) {
      prefix += `<img src="${coverImg.src}" alt="Cover" style="width:100%;border-radius:8px;margin-bottom:16px" />\n`;
    }
    const titleInput = document.querySelector('.article-title-input') as HTMLInputElement | null;
    if (titleInput?.value && titleInput.value !== 'Untitled') {
      prefix += `<h1>${titleInput.value}</h1>\n`;
    }

    const cleanedHtml = prefix + clone.innerHTML;
    const plainText = extractPlainText(clone);

    try {
      // Modern Clipboard API — dual-format write
      const item = new ClipboardItem({
        'text/html': new Blob([cleanedHtml], { type: 'text/html' }),
        'text/plain': new Blob([plainText], { type: 'text/plain' }),
      });
      await navigator.clipboard.write([item]);
    } catch {
      try {
        // Fallback: plain text only
        await navigator.clipboard.writeText(plainText);
      } catch {
        // Legacy fallback
        const textarea = document.createElement('textarea');
        textarea.value = plainText;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
    }

    setCopyState('copied');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopyState('idle'), 2000);
  }, []);

  return { copyAsHtml, copyState };
}

/** Extract plain text from an HTML element, joining paragraphs with double newlines. */
function extractPlainText(el: HTMLElement): string {
  const blocks: string[] = [];
  for (const child of el.children) {
    const text = (child as HTMLElement).innerText?.trim();
    if (text) blocks.push(text);
  }
  return blocks.join('\n\n');
}
