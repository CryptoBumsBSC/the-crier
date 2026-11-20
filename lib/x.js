// Everything The Crier knows about X (Twitter) links.
// The Crier never signs in to X and never uses paid X access.

const TWEET_RE =
  /https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/(i\/web|[A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d{5,25})[^\s]*/gi;

// Find every tweet link in a piece of text.
export function findTweets(text) {
  const out = [];
  if (!text) return out;
  for (const m of text.matchAll(TWEET_RE)) {
    const rawHandle = m[1].toLowerCase();
    const handle = rawHandle === 'i/web' || rawHandle === 'i' ? null : m[1];
    out.push({ raw: m[0], handle, id: m[2] });
  }
  return out;
}

export function canonicalUrl(handle, id) {
  return `https://x.com/${handle}/status/${id}`;
}

// The links behind the two-tap buttons.
export function intentLinks(tweetUrl, id) {
  return {
    like: `https://x.com/intent/like?tweet_id=${id}`,
    repost: `https://x.com/intent/retweet?tweet_id=${id}`,
    quote: `https://x.com/intent/tweet?url=${encodeURIComponent(tweetUrl)}`,
    comment: `https://x.com/intent/tweet?in_reply_to=${id}`,
  };
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", mdash: '-', nbsp: ' ' };

// Pull the tweet's words out of the embed code X sends back.
export function textFromEmbed(html) {
  const m = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(html || '');
  if (!m) return '';
  return m[1]
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#?\w+);/g, (all, name) => ENTITIES[name] ?? all)
    .replace(/[ \t]+/g, ' ')
    .trim();
}

// Ask X's public embed service about a tweet: who really wrote it, and its words.
// Returns { author, text }, or null when the service cannot be reached.
export async function lookupTweet(id, fetchImpl = fetch) {
  const target = `https://twitter.com/i/status/${id}`;
  const url = `https://publish.twitter.com/oembed?omit_script=1&url=${encodeURIComponent(target)}`;
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const data = await res.json();
    const m = /(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/?$/i.exec(data.author_url || '');
    if (!m) return null;
    return { author: m[1], text: textFromEmbed(data.html) };
  } catch {
    return null;
  }
}
