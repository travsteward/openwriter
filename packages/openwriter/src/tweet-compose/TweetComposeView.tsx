/**
 * Tweet Compose View — X/Twitter compose experience.
 *
 * Reply mode: single two-column layout where left column has parent avatar →
 * thread line → compose avatar, right column has tweet content → "Replying to" →
 * compose area. This matches X's actual reply thread structure.
 *
 * Quote mode: compose area with avatar → quoted tweet card below.
 */

import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { useTweetEmbed } from '../hooks/useTweetEmbed';
import TweetEmbed from './TweetEmbed';
import CharacterCounter from './CharacterCounter';
import XConnectPrompt from './XConnectPrompt';

const LS_KEY = 'ow-x-handle';

function ComposeAvatar() {
  const [handle, setHandle] = useState(() => localStorage.getItem(LS_KEY) || '');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const save = () => {
    const clean = draft.replace(/^@/, '').trim();
    if (clean) {
      localStorage.setItem(LS_KEY, clean);
      setHandle(clean);
    }
    setEditing(false);
  };

  const open = () => {
    setDraft(handle);
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  // Close on click outside
  useEffect(() => {
    if (!editing) return;
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) save();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [editing, draft]);

  const avatarUrl = handle ? `https://unavatar.io/twitter/${handle}` : '';

  return (
    <div className="tweet-compose-avatar-wrapper" ref={wrapperRef}>
      {handle ? (
        <img
          className="tweet-compose-avatar tweet-compose-avatar-img"
          src={avatarUrl}
          alt={`@${handle}`}
          onClick={open}
          title={`@${handle} — click to change`}
        />
      ) : (
        <div className="tweet-compose-avatar" onClick={open} title="Set your @handle" />
      )}
      {editing && (
        <div className="tweet-handle-popover">
          <input
            ref={inputRef}
            className="tweet-handle-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
            placeholder="your_handle"
            spellCheck={false}
          />
        </div>
      )}
    </div>
  );
}

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

/** Extract tweet ID from an x.com or twitter.com status URL */
function extractTweetId(url?: string): string | undefined {
  if (!url) return undefined;
  const match = url.match(/\/status\/(\d+)/);
  return match?.[1];
}

type PostState = 'idle' | 'posting' | 'success' | 'error';

export default function TweetComposeView({ tweetContext, editor, children }: TweetComposeViewProps) {
  const { tweet, loading, error } = useTweetEmbed(tweetContext?.url);

  // X connection state
  const [xConnected, setXConnected] = useState<boolean | null>(null); // null = loading
  const [xUsername, setXUsername] = useState<string | undefined>();
  const [showConnect, setShowConnect] = useState(false);
  const [postState, setPostState] = useState<PostState>('idle');
  const [postError, setPostError] = useState('');
  const successTimer = useRef<ReturnType<typeof setTimeout>>();

  // Check X connection on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/x/status');
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          setXConnected(data.connected);
          setXUsername(data.username);
        } else {
          // Plugin not enabled — routes not registered yet
          setXConnected(false);
        }
      } catch {
        if (!cancelled) setXConnected(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const getCharCount = useCallback(() => {
    if (!editor) return 0;
    return editor.storage.characterCount?.characters?.() ?? editor.getText().length;
  }, [editor]);

  const [charCount, setCharCount] = useState(0);

  // Update character count live on every editor change
  useEffect(() => {
    if (!editor) return;
    const update = () => setCharCount(getCharCount());
    update();
    editor.on('update', update);
    return () => { editor.off('update', update); };
  }, [editor, getCharCount]);
  const hasContext = tweetContext?.url;
  const isReply = tweetContext?.mode === 'reply';

  // X supports longform posts — 280 is a soft limit (visual indicator only), not a gate
  const canPost = xConnected && charCount > 0 && postState === 'idle';

  const handlePost = async () => {
    if (!xConnected) {
      setShowConnect(true);
      return;
    }
    if (!canPost || !editor) return;

    setPostState('posting');
    setPostError('');

    try {
      const text = editor.getText();
      const tweetId = extractTweetId(tweetContext?.url);

      const body: Record<string, string> = { text };
      if (tweetContext?.mode === 'reply' && tweetId) {
        body.replyTo = tweetId;
      } else if (tweetContext?.mode === 'quote' && tweetId) {
        body.quoteTweetId = tweetId;
      }

      const res = await fetch('/api/x/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (data.success) {
        setPostState('success');
        // Mark doc as ephemeral — auto-cleaned on next startup
        fetch('/api/metadata', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ephemeral: true }),
        }).catch(() => {});
        // Clear editor after successful post
        editor.commands.clearContent();
        successTimer.current = setTimeout(() => setPostState('idle'), 2500);
      } else {
        setPostError(data.error || 'Post failed');
        setPostState('error');
        setTimeout(() => setPostState('idle'), 3000);
      }
    } catch (err: any) {
      setPostError(err.message || 'Network error');
      setPostState('error');
      setTimeout(() => setPostState('idle'), 3000);
    }
  };

  // Cleanup success timer
  useEffect(() => () => { if (successTimer.current) clearTimeout(successTimer.current); }, []);

  const handleConnected = () => {
    setXConnected(true);
    setShowConnect(false);
    // Re-fetch username
    fetch('/api/x/status').then((r) => r.json()).then((d) => {
      if (d.username) setXUsername(d.username);
    }).catch(() => {});
  };

  const postBtnLabel = postState === 'posting' ? 'Posting...'
    : postState === 'success' ? 'Posted!'
    : postState === 'error' ? 'Failed'
    : 'Post';

  return (
    <div className="tweet-compose-wrapper">
      {/* === Reply mode: unified two-column thread layout === */}
      {hasContext && isReply && (
        <>
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
              {/* Left column: parent avatar → thread line → compose avatar */}
              <div className="tweet-reply-thread-left">
                {tweet.author.avatarUrl ? (
                  <img className="tweet-avatar" src={tweet.author.avatarUrl} alt="" />
                ) : (
                  <div className="tweet-avatar tweet-avatar-placeholder" />
                )}
                <div className="tweet-reply-thread-line" />
                <ComposeAvatar />
              </div>

              {/* Right column: tweet content → replying to → compose area */}
              <div className="tweet-reply-thread-right">
                {/* Parent tweet content */}
                <div className="tweet-reply-parent">
                  <div className="tweet-author-info">
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

                {/* Replying to indicator */}
                <div className="tweet-replying-to-inline">
                  Replying to <span className="tweet-reply-handle">@{tweet.author.username}</span>
                </div>

                {/* Compose area */}
                <div className="tweet-compose-box">
                  {children}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* === Quote mode: compose above, quoted tweet below === */}
      {hasContext && !isReply && (
        <div className="tweet-compose-area">
          <ComposeAvatar />
          <div className="tweet-compose-content">
            <div className="tweet-compose-box">
              {children}
            </div>
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
      )}

      {/* === No context: plain compose (tweet view without reply/quote) === */}
      {!hasContext && (
        <div className="tweet-compose-area">
          <ComposeAvatar />
          <div className="tweet-compose-content">
            <div className="tweet-compose-box tweet-compose-box--standalone">
              {children}
            </div>
          </div>
        </div>
      )}

      {/* === Footer: character counter + post button === */}
      <div className="tweet-compose-footer">
        {postState === 'error' && postError && (
          <span className="tweet-post-error">{postError}</span>
        )}
        <CharacterCounter count={charCount} />
        <button
          className={`tweet-post-btn${canPost || (!xConnected && xConnected !== null) ? ' tweet-post-btn--active' : ''}${postState === 'success' ? ' tweet-post-btn--success' : ''}${postState === 'error' ? ' tweet-post-btn--error' : ''}`}
          disabled={xConnected ? !canPost : false}
          onClick={handlePost}
          title={xConnected ? (xUsername ? `Post as @${xUsername}` : 'Post to X') : 'Connect X to post'}
        >
          {postBtnLabel}
        </button>
      </div>

      {/* === XConnectPrompt: shown when Post clicked without connection === */}
      {showConnect && (
        <XConnectPrompt
          onConnected={handleConnected}
          onCancel={() => setShowConnect(false)}
        />
      )}
    </div>
  );
}
