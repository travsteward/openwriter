/**
 * Article Compose View — X/Twitter article compose experience.
 *
 * Completely separate from TweetComposeView. Articles support rich formatting
 * (bold, italic, headings, images, links, lists, blockquotes) with no character
 * limit. No X API endpoint — workflow is compose in OpenWriter, copy as HTML,
 * paste into X's article editor.
 */

import { type ReactNode } from 'react';
import { useArticleCopy } from './useArticleCopy';
import './ArticleComposeView.css';

interface ArticleComposeViewProps {
  children: ReactNode;
}

export default function ArticleComposeView({ children }: ArticleComposeViewProps) {
  const { copyAsHtml, copyState } = useArticleCopy();

  return (
    <div className="article-compose-wrapper">
      <div className="article-compose-body">
        {children}
      </div>
      <div className="article-compose-footer">
        <button
          className={`article-copy-btn${copyState === 'copied' ? ' article-copy-btn--copied' : ''}`}
          onClick={copyAsHtml}
        >
          {copyState === 'copied' ? (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              Copied!
            </>
          ) : (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
              Copy as HTML
            </>
          )}
        </button>
      </div>
    </div>
  );
}
