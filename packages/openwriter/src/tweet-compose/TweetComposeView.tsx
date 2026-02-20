/**
 * Tweet Compose View — X/Twitter compose experience.
 * Reply mode: parent tweet with thread line → "Replying to @user" → compose area
 * Quote mode: compose area → quoted tweet card below
 * Matches X's actual layout with thread connecting line and avatar placement.
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
  tweetContext?: TweetContext;
  editor: Editor | null;
  children: ReactNode;
}

function TweetSkeleton() {
  return (
    <div className="tweet-skeleton">
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
  const hasContext = tweetContext?.url;
  const isReply = tweetContext?.mode === 'reply';

  return (
    <div className="tweet-compose-wrapper">
      {/* === Reply mode: threaded layout === */}
      {hasContext && isReply && (
        <>
          {/* Parent tweet with thread line */}
          {loading && (
            <div className="tweet-context-section">
              <TweetSkeleton />
            </div>
          )}
          {error && (
            <div className="tweet-context-section">
              <div className="tweet-embed-error">
                <span>Could not load tweet</span>
                <a href={tweetContext.url} target="_blank" rel="noopener noreferrer" className="tweet-fallback-link">
                  {tweetContext.url}
                </a>
              </div>
            </div>
          )}
          {tweet && (
            <div className="tweet-reply-thread">
              <div className="tweet-reply-thread-left">
                {tweet.author.avatarUrl ? (
                  <img className="tweet-avatar" src={tweet.author.avatarUrl} alt="" />
                ) : (
                  <div className="tweet-avatar tweet-avatar-placeholder" />
                )}
                <div className="tweet-reply-thread-line" />
              </div>
              <div className="tweet-reply-thread-right">
                <div className="tweet-author-info" style={{ marginBottom: 4 }}>
                  <span className="tweet-author-name">{tweet.author.name}</span>
                  <span className="tweet-author-handle">@{tweet.author.username}</span>
                </div>
                <div className="tweet-text">{tweet.text}</div>

                {tweet.media && tweet.media.length > 0 && (
                  <div className="tweet-media">
                    {tweet.media.map((m, i) => (
                      m.type === 'photo' ? (
                        <img key={i} className="tweet-media-img" src={m.url} alt="" loading="lazy" />
                      ) : (
                        <div key={i} className="tweet-media-video-placeholder">
                          <span>Video</span>
                        </div>
                      )
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Replying to indicator */}
          {tweet && (
            <div className="tweet-replying-to">
              Replying to <span className="tweet-reply-handle">@{tweet.author.username}</span>
            </div>
          )}

          {/* Compose area with avatar */}
          <div className="tweet-compose-area">
            <div className="tweet-compose-avatar" />
            <div className="tweet-compose-content">
              <div className="tweet-compose-box">
                {children}
              </div>
            </div>
          </div>
        </>
      )}

      {/* === Quote mode: compose above, quoted tweet below === */}
      {hasContext && !isReply && (
        <>
          <div className="tweet-compose-area">
            <div className="tweet-compose-avatar" />
            <div className="tweet-compose-content">
              <div className="tweet-compose-box">
                {children}
              </div>
              {/* Quoted tweet card */}
              <div className="tweet-quote-section">
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
            </div>
          </div>
        </>
      )}

      {/* === No context: plain compose (tweet view without reply/quote) === */}
      {!hasContext && (
        <div className="tweet-compose-area">
          <div className="tweet-compose-avatar" />
          <div className="tweet-compose-content">
            <div className="tweet-compose-box">
              {children}
            </div>
          </div>
        </div>
      )}

      {/* === Footer: character counter + post button === */}
      <div className="tweet-compose-footer">
        <CharacterCounter count={charCount} />
        <button className="tweet-post-btn" disabled title="Post (coming soon)">
          Post
        </button>
      </div>
    </div>
  );
}
