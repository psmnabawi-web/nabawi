import { config } from '../config.js';
import { ProviderError } from '../lib/errors.js';

/**
 * Instagram API with Instagram Login (professional accounts: Business or Creator).
 * Scopes: instagram_business_basic, instagram_business_content_publish.
 * Reels: POST /{ig-user-id}/media (media_type=REELS, video_url, caption) → poll container status_code →
 * POST /{ig-user-id}/media_publish (creation_id) → GET /{media-id}?fields=permalink.
 * Tokens are only ever sent to api.instagram.com / graph.instagram.com and never logged.
 */
export const SCOPES = ['instagram_business_basic', 'instagram_business_content_publish'];

/** Emulator only: INSTAGRAM_API_ORIGIN points both API hosts at a local fake for end-to-end tests. */
const origin = (host) => (process.env.FUNCTIONS_EMULATOR === 'true' && process.env.INSTAGRAM_API_ORIGIN ? process.env.INSTAGRAM_API_ORIGIN : host);
const graphHost = () => origin('https://graph.instagram.com');

export const redirectUri = () => `${config.social.publicBaseUrl}/api/oauth/instagram`;

export function authorizeUrl({ appId, state }) {
  const q = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPES.join(','),
    state,
    enable_fb_login: '0',
    force_authentication: '1',
  });
  return `https://www.instagram.com/oauth/authorize?${q}`;
}

/** Maps Graph API errors to clear messages; code 190 = token expired/revoked (reconnect needed). */
export function graphError(json, status) {
  const e = json?.error ?? {};
  const msg = String(e.error_user_msg || e.message || `HTTP ${status}`).slice(0, 300);
  if (e.code === 190 || status === 401) return new ProviderError('failed-precondition', `Instagram session expired or was revoked. Reconnect the account in Settings > Social accounts. (${msg})`, { reconnect: true });
  if ([4, 17, 32, 613].includes(e.code) || status === 429) return new ProviderError('resource-exhausted', `Instagram rate limit reached. It will be retried later. (${msg})`);
  if (e.code === 10 || e.code === 200 || status === 403) return new ProviderError('failed-precondition', `Instagram permission missing: ${msg}`);
  if (status >= 500) return new ProviderError('unavailable', `Instagram is unavailable right now. (${msg})`);
  return new ProviderError('invalid-argument', `Instagram rejected the request: ${msg}`);
}

async function call(url, { method = 'GET', form } = {}) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: form ? { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' } : { accept: 'application/json' },
      body: form ? new URLSearchParams(form).toString() : undefined,
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    throw new ProviderError('unavailable', `Cannot reach Instagram (${err?.name === 'TimeoutError' ? 'timeout' : 'network error'}).`);
  }
  const raw = await res.text();
  let json = null;
  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    json = null;
  }
  if (!res.ok || !json || json.error) throw graphError(json, res.status);
  return json;
}

const graphUrl = (path, params = {}) => {
  const query = new URLSearchParams(params).toString();
  return `${graphHost()}/${config.social.graphVersion}/${path}${query ? `?${query}` : ''}`;
};

/** Authorization code → short-lived token (1 h) + Instagram user id. */
export async function exchangeCode({ appId, appSecret, code }) {
  const json = await call(`${origin('https://api.instagram.com')}/oauth/access_token`, {
    method: 'POST',
    form: { client_id: appId, client_secret: appSecret, grant_type: 'authorization_code', redirect_uri: redirectUri(), code: String(code).replace(/#_$/, '') },
  });
  const data = Array.isArray(json.data) ? json.data[0] : json;
  if (!data?.access_token) throw new ProviderError('unavailable', 'Instagram did not return an access token.');
  return { shortToken: data.access_token, userId: String(data.user_id ?? '') };
}

/** Short-lived → long-lived token (~60 days). */
export async function longLivedToken({ appSecret, shortToken }) {
  const json = await call(`${graphHost()}/access_token?${new URLSearchParams({ grant_type: 'ig_exchange_token', client_secret: appSecret, access_token: shortToken })}`);
  if (!json.access_token) throw new ProviderError('unavailable', 'Instagram did not return a long-lived token.');
  return { token: json.access_token, expiresIn: Number(json.expires_in) || 60 * 24 * 3600 };
}

/** Extends a long-lived token (must be at least 24 h old and not expired). */
export async function refreshToken(token) {
  const json = await call(`${graphHost()}/refresh_access_token?${new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: token })}`);
  if (!json.access_token) throw new ProviderError('unavailable', 'Instagram did not return a refreshed token.');
  return { token: json.access_token, expiresIn: Number(json.expires_in) || 60 * 24 * 3600 };
}

export async function getProfile(token) {
  const json = await call(graphUrl('me', { fields: 'user_id,username,account_type,profile_picture_url', access_token: token }));
  return { userId: String(json.user_id ?? json.id ?? ''), username: json.username ?? '', accountType: json.account_type ?? '', pictureUrl: json.profile_picture_url ?? '' };
}

export async function createReelContainer({ userId, token, videoUrl, caption }) {
  const json = await call(graphUrl(`${userId}/media`), {
    method: 'POST',
    form: { media_type: 'REELS', video_url: videoUrl, caption, share_to_feed: 'true', access_token: token },
  });
  if (!json.id) throw new ProviderError('unavailable', 'Instagram did not return a media container id.');
  return String(json.id);
}

/** status_code: IN_PROGRESS | FINISHED | ERROR | EXPIRED | PUBLISHED */
export async function getContainerStatus({ containerId, token }) {
  const json = await call(graphUrl(containerId, { fields: 'status_code,status', access_token: token }));
  return { statusCode: json.status_code ?? 'IN_PROGRESS', status: json.status ?? '' };
}

export async function publishContainer({ userId, token, containerId }) {
  const json = await call(graphUrl(`${userId}/media_publish`), { method: 'POST', form: { creation_id: containerId, access_token: token } });
  if (!json.id) throw new ProviderError('unavailable', 'Instagram did not return the published media id.');
  return String(json.id);
}

export async function getPermalink({ mediaId, token }) {
  try {
    const json = await call(graphUrl(mediaId, { fields: 'permalink', access_token: token }));
    return json.permalink ?? '';
  } catch {
    return '';
  }
}
