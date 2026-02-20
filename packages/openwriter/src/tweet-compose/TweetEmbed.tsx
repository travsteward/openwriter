/**
 * Embedded tweet card — X/Twitter design system.
 * Renders tweet with author header (name · @handle · time),
 * body text, media, quote tweet, and action bar.
 * SVG paths from X's actual icon set.
 */

import type { TweetEmbedData } from '../hooks/useTweetEmbed';

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(0)}K`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function timeAgo(dateStr: string): string {
  try {
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    const diffSec = Math.floor((now - then) / 1000);
    if (diffSec < 60) return `${diffSec}s`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour}h`;
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

/* X's actual SVG icon paths (24x24 viewBox) */
const ReplyIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path fill="currentColor" d="M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.25-.893 4.306-2.394 5.82l-5.72 5.77c-.18.18-.43.29-.69.29-.56 0-1.01-.46-1.01-1.02v-4.14H8.882c-3.94 0-7.131-3.2-7.131-7.14v.29z" />
  </svg>
);

const RetweetIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path fill="currentColor" d="M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.432 9.48.068 8.02 4.5 3.88zM16.5 6H11V4h5.5c2.209 0 4 1.79 4 4v8.45l2.068-1.93 1.364 1.46-4.432 4.14-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2z" />
  </svg>
);

const LikeIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path fill="currentColor" d="M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.97 3.257 4.27 7.129 6.61 3.87-2.34 6.052-4.64 7.126-6.61 1.111-2.04 1.03-3.7.477-4.82-.56-1.13-1.666-1.84-2.908-1.91z" />
  </svg>
);

const ViewsIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path fill="currentColor" d="M8.75 21V3h2v18h-2zM18.75 21V8.5h2V21h-2zM13.75 21v-9h2v9h-2zM3.75 21v-4h2v4h-2z" />
  </svg>
);

const ShareIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path fill="currentColor" d="M12 2.59l5.7 5.7-1.41 1.42L13 6.41V16h-2V6.41l-3.3 3.3-1.41-1.42L12 2.59zM21 15l-.02 3.51c0 1.38-1.12 2.49-2.5 2.49H5.5C4.11 21 3 19.88 3 18.5V15h2v3.5c0 .28.22.5.5.5h12.98c.28 0 .5-.22.5-.5L19 15h2z" />
  </svg>
);

function TweetCard({ tweet, nested }: { tweet: TweetEmbedData; nested?: boolean }) {
  const ts = timeAgo(tweet.createdAt);

  return (
    <div className={`tweet-embed-card${nested ? ' tweet-embed-nested' : ''}`}>
      {/* Author header: avatar | name · @handle · time */}
      <div className="tweet-author-row">
        {tweet.author.avatarUrl ? (
          <img className="tweet-avatar" src={tweet.author.avatarUrl} alt="" />
        ) : (
          <div className="tweet-avatar tweet-avatar-placeholder" />
        )}
        <div className="tweet-author-info">
          <span className="tweet-author-name">{tweet.author.name}</span>
          <span className="tweet-author-handle">@{tweet.author.username}</span>
          {ts && (
            <>
              <span className="tweet-author-separator">·</span>
              <span className="tweet-author-timestamp">{ts}</span>
            </>
          )}
        </div>
      </div>

      {/* Tweet body */}
      <div className="tweet-text">{tweet.text}</div>

      {/* Media attachments */}
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

      {/* Quoted tweet */}
      {tweet.quoteTweet && (
        <TweetCard tweet={tweet.quoteTweet} nested />
      )}

      {/* Action bar — only on top-level tweets */}
      {!nested && (
        <div className="tweet-actions-row">
          <span className="tweet-action tweet-action-reply">
            <ReplyIcon />
            {tweet.metrics.replies > 0 && formatCount(tweet.metrics.replies)}
          </span>
          <span className="tweet-action tweet-action-retweet">
            <RetweetIcon />
            {tweet.metrics.retweets > 0 && formatCount(tweet.metrics.retweets)}
          </span>
          <span className="tweet-action tweet-action-like">
            <LikeIcon />
            {tweet.metrics.likes > 0 && formatCount(tweet.metrics.likes)}
          </span>
          <span className="tweet-action tweet-action-views">
            <ViewsIcon />
            {tweet.metrics.views > 0 && formatCount(tweet.metrics.views)}
          </span>
          <span className="tweet-action tweet-action-share">
            <ShareIcon />
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
