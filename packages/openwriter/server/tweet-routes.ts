/**
 * Tweet embed proxy: fetches tweet data from fxtwitter API.
 * GET /api/tweet-embed?url=... → normalized TweetEmbedData JSON.
 */

import { Router } from 'express';

export interface TweetEmbedData {
  author: { name: string; username: string; avatarUrl: string };
  text: string;
  createdAt: string;
  metrics: { likes: number; retweets: number; replies: number; views: number };
  media?: { type: string; url: string }[];
  quoteTweet?: TweetEmbedData;
}

// In-memory cache: URL → { data, expires }
const cache = new Map<string, { data: TweetEmbedData; expires: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function parseTweetUrl(url: string): { username: string; statusId: string } | null {
  try {
    const parsed = new URL(url);
    if (!['twitter.com', 'x.com', 'www.twitter.com', 'www.x.com'].includes(parsed.hostname)) {
      return null;
    }
    // Path: /{username}/status/{id}
    const match = parsed.pathname.match(/^\/([^/]+)\/status\/(\d+)/);
    if (!match) return null;
    return { username: match[1], statusId: match[2] };
  } catch {
    return null;
  }
}

function normalizeTweet(tweet: any): TweetEmbedData {
  const data: TweetEmbedData = {
    author: {
      name: tweet.author?.name || '',
      username: tweet.author?.screen_name || '',
      avatarUrl: tweet.author?.avatar_url || '',
    },
    text: tweet.text || '',
    createdAt: tweet.created_at || '',
    metrics: {
      likes: tweet.likes ?? 0,
      retweets: tweet.retweets ?? 0,
      replies: tweet.replies ?? 0,
      views: tweet.views ?? 0,
    },
  };

  if (tweet.media?.all?.length) {
    data.media = tweet.media.all.map((m: any) => ({
      type: m.type || 'photo',
      url: m.url || m.thumbnail_url || '',
    }));
  }

  if (tweet.quote) {
    data.quoteTweet = normalizeTweet(tweet.quote);
  }

  return data;
}

export function createTweetRouter(): Router {
  const router = Router();

  router.get('/api/tweet-embed', async (req, res) => {
    const url = req.query.url as string;
    if (!url) {
      res.status(400).json({ error: 'url query parameter is required' });
      return;
    }

    const parsed = parseTweetUrl(url);
    if (!parsed) {
      res.status(400).json({ error: 'Invalid tweet URL. Supports x.com and twitter.com URLs.' });
      return;
    }

    // Check cache
    const cacheKey = `${parsed.username}/${parsed.statusId}`;
    const cached = cache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
      res.json(cached.data);
      return;
    }

    try {
      const apiUrl = `https://api.fxtwitter.com/${parsed.username}/status/${parsed.statusId}`;
      const response = await fetch(apiUrl);

      if (!response.ok) {
        if (response.status === 404) {
          res.status(404).json({ error: 'Tweet not found' });
          return;
        }
        res.status(502).json({ error: `fxtwitter API returned ${response.status}` });
        return;
      }

      const json = await response.json();
      if (!json.tweet) {
        res.status(404).json({ error: 'Tweet not found in API response' });
        return;
      }

      const data = normalizeTweet(json.tweet);

      // Cache it
      cache.set(cacheKey, { data, expires: Date.now() + CACHE_TTL_MS });

      res.json(data);
    } catch (err: any) {
      res.status(502).json({ error: `Failed to fetch tweet: ${err.message}` });
    }
  });

  return router;
}
