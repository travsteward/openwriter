/**
 * Embedded tweet card — displays tweet author, text, media, metrics.
 * Pure display component, no data fetching.
 */

import type { TweetEmbedData } from '../hooks/useTweetEmbed';

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

function TweetCard({ tweet, nested }: { tweet: TweetEmbedData; nested?: boolean }) {
  return (
    <div className={`tweet-embed-card${nested ? ' tweet-embed-nested' : ''}`}>
      <div className="tweet-author-row">
        {tweet.author.avatarUrl ? (
          <img className="tweet-avatar" src={tweet.author.avatarUrl} alt="" />
        ) : (
          <div className="tweet-avatar tweet-avatar-placeholder" />
        )}
        <div className="tweet-author-info">
          <span className="tweet-author-name">{tweet.author.name}</span>
          <span className="tweet-author-handle">@{tweet.author.username}</span>
        </div>
      </div>

      <div className="tweet-text">{tweet.text}</div>

      {tweet.media && tweet.media.length > 0 && (
        <div className="tweet-media">
          {tweet.media.map((m, i) => (
            m.type === 'photo' ? (
              <img key={i} className="tweet-media-img" src={m.url} alt="" loading="lazy" />
            ) : m.type === 'video' || m.type === 'gif' ? (
              <div key={i} className="tweet-media-video-placeholder">
                <span>Video</span>
              </div>
            ) : null
          ))}
        </div>
      )}

      {tweet.quoteTweet && (
        <TweetCard tweet={tweet.quoteTweet} nested />
      )}

      <div className="tweet-footer">
        <span className="tweet-date">{formatDate(tweet.createdAt)}</span>
      </div>

      {!nested && (
        <div className="tweet-metrics-row">
          <span className="tweet-metric" title="Replies">
            <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.25-.893 4.306-2.394 5.82l-5.72 5.77c-.18.18-.43.29-.69.29-.56 0-1.01-.46-1.01-1.02v-4.14H8.882c-3.94 0-7.131-3.2-7.131-7.14v.29z"/></svg>
            {formatNumber(tweet.metrics.replies)}
          </span>
          <span className="tweet-metric" title="Retweets">
            <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.432 9.48.068 8.02 4.5 3.88zM16.5 6H11V4h5.5c2.209 0 4 1.79 4 4v8.45l2.068-1.93 1.364 1.46-4.432 4.14-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2z"/></svg>
            {formatNumber(tweet.metrics.retweets)}
          </span>
          <span className="tweet-metric" title="Likes">
            <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.97 3.257 4.27 7.129 6.61 3.87-2.34 6.052-4.64 7.126-6.61 1.111-2.04 1.03-3.7.477-4.82-.56-1.13-1.666-1.84-2.908-1.91z"/></svg>
            {formatNumber(tweet.metrics.likes)}
          </span>
          <span className="tweet-metric" title="Views">
            <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M8.75 21V3h2v18h-2zM18.75 21V8.5h2V21h-2zM13.75 21v-9h2v9h-2zM3.75 21v-4h2v4h-2z"/></svg>
            {formatNumber(tweet.metrics.views)}
          </span>
        </div>
      )}
    </div>
  );
}

interface TweetEmbedProps {
  tweet: TweetEmbedData;
}

export default function TweetEmbed({ tweet }: TweetEmbedProps) {
  return <TweetCard tweet={tweet} />;
}
