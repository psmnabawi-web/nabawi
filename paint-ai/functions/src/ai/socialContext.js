import { logger } from 'firebase-functions';
import { PLATFORM_HOSTS } from '../lib/constants.js';

/** True when `url` is an https URL on one of the platform's official hosts. */
export function isPlatformUrl(url, platform) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  return (PLATFORM_HOSTS[platform] ?? []).some((h) => host === h || host.endsWith(`.${h}`));
}

// Only fixed, official oEmbed endpoints are called (no request is ever made to the user-supplied URL itself → no SSRF).
const OEMBED = {
  TikTok: (url) => `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`,
  YouTube: (url) => `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`,
};

/**
 * Best-effort enrichment with public metadata (caption/title, author, thumbnail).
 * Instagram oEmbed requires a Meta app token, so Instagram relies on the notes typed by the user.
 * @returns {Promise<{title: string, author: string, thumbnailUrl: string} | null>}
 */
export async function fetchSourceContext(source) {
  if (!source?.url || source.sourceType === 'hashtag') return null;
  const build = OEMBED[source.platform];
  if (!build || !isPlatformUrl(source.url, source.platform)) return null;
  try {
    const res = await fetch(build(source.url), { signal: AbortSignal.timeout(6000), headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    const json = await res.json();
    return {
      title: String(json.title ?? '').slice(0, 1000),
      author: String(json.author_name ?? '').slice(0, 200),
      thumbnailUrl: typeof json.thumbnail_url === 'string' && json.thumbnail_url.startsWith('https://') ? json.thumbnail_url : '',
    };
  } catch (err) {
    logger.info('oEmbed lookup skipped', { platform: source.platform, reason: err?.name ?? 'error' });
    return null;
  }
}
