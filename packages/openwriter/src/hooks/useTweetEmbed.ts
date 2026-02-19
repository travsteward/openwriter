import { useEffect, useRef, useState } from 'react';

export interface TweetEmbedData {
  author: { name: string; username: string; avatarUrl: string };
  text: string;
  createdAt: string;
  metrics: { likes: number; retweets: number; replies: number; views: number };
  media?: { type: string; url: string }[];
  quoteTweet?: TweetEmbedData;
}

export function useTweetEmbed(url: string | undefined): { tweet: TweetEmbedData | null; loading: boolean; error: string | null } {
  const [tweet, setTweet] = useState<TweetEmbedData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastUrl = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!url) {
      setTweet(null);
      setLoading(false);
      setError(null);
      lastUrl.current = undefined;
      return;
    }

    if (url === lastUrl.current) return;
    lastUrl.current = url;

    setLoading(true);
    setError(null);

    fetch(`/api/tweet-embed?url=${encodeURIComponent(url)}`)
      .then((res) => {
        if (!res.ok) return res.json().then((e) => Promise.reject(new Error(e.error || `HTTP ${res.status}`)));
        return res.json();
      })
      .then((data) => {
        setTweet(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [url]);

  return { tweet, loading, error };
}
