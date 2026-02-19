/**
 * Tweet Compose View — wraps PadEditor with Twitter-like compose experience.
 * Shows embedded tweet above (reply) or below (quote) the compose area.
 */

import { type ReactNode, useCallback } from 'react';
import type { Editor } from '@tiptap/react';
import { useTweetEmbed } from '../hooks/useTweetEmbed';
import TweetEmbed from './TweetEmbed';
import CharacterCounter from './CharacterCounter';

interface TweetContext {
  url: string;
  mode: 'reply' | 'quote';
}

interface TweetComposeViewProps {
  tweetContext: TweetContext;
  editor: Editor | null;
  children: ReactNode;
}

function TweetSkeleton() {
  return (
    <div className="tweet-embed-card tweet-skeleton">
      <div className="tweet-author-row">
        <div className="tweet-avatar tweet-avatar-placeholder tweet-pulse" />
        <div className="tweet-author-info">
          <span className="tweet-skeleton-line tweet-pulse" style={{ width: 120 }} />
          <span className="tweet-skeleton-line tweet-pulse" style={{ width: 80 }} />
        </div>
      </div>
      <div className="tweet-skeleton-line tweet-pulse" style={{ width: '100%', height: 16, marginTop: 12 }} />
      <div className="tweet-skeleton-line tweet-pulse" style={{ width: '75%', height: 16, marginTop: 8 }} />
    </div>
  );
}

export default function TweetComposeView({ tweetContext, editor, children }: TweetComposeViewProps) {
  const { tweet, loading, error } = useTweetEmbed(tweetContext?.url);

  const getCharCount = useCallback(() => {
    if (!editor) return 0;
    return editor.storage.characterCount?.characters?.() ?? editor.getText().length;
  }, [editor]);

  const charCount = editor ? getCharCount() : 0;
  const isReply = tweetContext?.mode === 'reply';

  return (
    <div className="tweet-compose-wrapper">
      {/* Reply mode: tweet above compose */}
      {isReply && (
        <div className="tweet-context-section">
          {loading && <TweetSkeleton />}
          {error && (
            <div className="tweet-embed-error">
              <span>Could not load tweet</span>
              <a href={tweetContext.url} target="_blank" rel="noopener noreferrer" className="tweet-fallback-link">
                {tweetContext.url}
              </a>
            </div>
          )}
          {tweet && <TweetEmbed tweet={tweet} />}
          {tweet && (
            <div className="tweet-replying-to">
              Replying to <span className="tweet-reply-handle">@{tweet.author.username}</span>
            </div>
          )}
        </div>
      )}

      {/* Compose area */}
      <div className="tweet-compose-box">
        {children}
      </div>

      {/* Quote mode: tweet below compose */}
      {!isReply && (
        <div className="tweet-context-section tweet-quote-section">
          {loading && <TweetSkeleton />}
          {error && (
            <div className="tweet-embed-error">
              <span>Could not load tweet</span>
              <a href={tweetContext.url} target="_blank" rel="noopener noreferrer" className="tweet-fallback-link">
                {tweetContext.url}
              </a>
            </div>
          )}
          {tweet && <TweetEmbed tweet={tweet} />}
        </div>
      )}

      {/* Bottom bar: counter + post button */}
      <div className="tweet-compose-footer">
        <CharacterCounter count={charCount} />
        <button className="tweet-post-btn" disabled title="Post (coming soon)">
          Post
        </button>
      </div>
    </div>
  );
}
