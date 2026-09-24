import { randomBytes } from 'node:crypto';
import { logger } from 'firebase-functions';
import { ALL_STORES, ROLES, config, secretValue } from '../config.js';
import { logAudit } from '../lib/audit.js';
import { assertStoreExists } from '../lib/auth.js';
import { HttpsError, ProviderError } from '../lib/errors.js';
import { Timestamp, db, serverTimestamp, toDate } from '../lib/firebase.js';
import { openToken, sealToken } from './crypto.js';
import * as instagram from './instagram.js';

/**
 * Connected social accounts.
 *   social_accounts/{platform_externalId}  public info (content managers can read): username, store mapping, status
 *   social_tokens/{same id}                encrypted access token (server only)
 *   oauth_states/{state}                   one-time OAuth state, 10 minutes (server only)
 */
const STATE_TTL_MS = 10 * 60 * 1000;
const REFRESH_WITHIN_MS = 10 * 24 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;

export const instagramConfigured = () => !!config.social.instagramAppId && !!secretValue('INSTAGRAM_APP_SECRET');

export function socialStatus() {
  return { instagram: { configured: instagramConfigured(), redirectUri: instagram.redirectUri(), appIdSet: !!config.social.instagramAppId } };
}

/** Step 1 (super admin): returns the Instagram authorization URL with a one-time state. */
export async function startConnect(user, { platform }) {
  if (platform !== 'instagram') throw new HttpsError('invalid-argument', 'Only Instagram can be connected for now.');
  if (!instagramConfigured()) {
    throw new HttpsError('failed-precondition', 'Instagram is not set up yet: add INSTAGRAM_APP_ID to functions/.env and the INSTAGRAM_APP_SECRET secret, then deploy functions.');
  }
  const state = randomBytes(24).toString('hex');
  await db.doc(`oauth_states/${state}`).set({ platform, uid: user.uid, createdAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + STATE_TTL_MS) });
  return { url: instagram.authorizeUrl({ appId: config.social.instagramAppId, state }), redirectUri: instagram.redirectUri() };
}

async function consumeState(state) {
  if (!/^[a-f0-9]{48}$/.test(String(state ?? ''))) return null;
  const ref = db.doc(`oauth_states/${state}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    tx.delete(ref);
    const data = snap.data();
    return toDate(data.expiresAt)?.getTime() > Date.now() ? data : null;
  });
}

const settingsUrl = (params) => `${config.social.publicBaseUrl}/settings?${new URLSearchParams({ tab: 'social', ...params })}`;

/** Step 2: OAuth redirect target (/api/oauth/instagram via Hosting rewrite). Always redirects back to Settings. */
export async function handleInstagramCallback(req, res) {
  const fail = (message) => res.redirect(302, settingsUrl({ social_error: String(message).slice(0, 200) }));
  try {
    if (req.method !== 'GET') return res.status(405).send('Method not allowed');
    const { code, state, error_description: denied } = req.query;
    const flow = await consumeState(state);
    if (!flow || flow.platform !== 'instagram') return fail('The connection link expired. Click "Connect Instagram" again.');
    if (denied || !code) return fail(denied ? `Instagram: ${denied}` : 'Instagram did not return an authorization code.');

    const admin = await db.doc(`users/${flow.uid}`).get();
    if (!admin.exists || admin.get('role') !== ROLES.SUPER_ADMIN || admin.get('active') === false) return fail('Only an active super admin can connect accounts.');

    const appSecret = secretValue('INSTAGRAM_APP_SECRET');
    const { shortToken } = await instagram.exchangeCode({ appId: config.social.instagramAppId, appSecret, code });
    const { token, expiresIn } = await instagram.longLivedToken({ appSecret, shortToken });
    const profile = await instagram.getProfile(token);
    if (!profile.userId) return fail('Instagram did not return the account id.');
    if (profile.accountType && !['BUSINESS', 'MEDIA_CREATOR'].includes(profile.accountType)) {
      return fail(`@${profile.username} is a personal account. Switch it to a Business or Creator account in the Instagram app, then connect again.`);
    }

    const id = `instagram_${profile.userId}`;
    const ref = db.doc(`social_accounts/${id}`);
    const existing = await ref.get();
    await ref.set({
      id,
      platform: 'instagram',
      externalId: profile.userId,
      username: profile.username,
      accountType: profile.accountType,
      pictureUrl: profile.pictureUrl,
      storeId: existing.exists ? (existing.get('storeId') ?? ALL_STORES) : ALL_STORES,
      status: 'connected',
      error: null,
      connectedBy: flow.uid,
      connectedAt: serverTimestamp(),
      tokenExpiresAt: Timestamp.fromMillis(Date.now() + expiresIn * 1000),
      tokenRefreshedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await db.doc(`social_tokens/${id}`).set({ sealed: sealToken(token), updatedAt: serverTimestamp() });
    await logAudit({ actor: { uid: flow.uid, email: admin.get('email'), role: admin.get('role') }, action: 'social.connect', entity: 'social_accounts', entityId: id, details: { username: profile.username } });
    return res.redirect(302, settingsUrl({ connected: `@${profile.username}` }));
  } catch (err) {
    logger.error('instagram oauth callback failed', { err: err?.message });
    return fail(err instanceof ProviderError || err instanceof HttpsError ? err.message : 'Connecting Instagram failed. Please try again.');
  }
}

/** Super admin: map an account to a store (or brand-wide) or disconnect it. */
export async function manageAccount(user, { accountId, storeId, disconnect }) {
  const ref = db.doc(`social_accounts/${accountId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Social account not found.');
  if (disconnect) {
    await Promise.all([ref.delete(), db.doc(`social_tokens/${accountId}`).delete()]);
    await logAudit({ actor: user, action: 'social.disconnect', entity: 'social_accounts', entityId: accountId, details: { username: snap.get('username') } });
    return { disconnected: true };
  }
  if (storeId !== undefined) {
    await assertStoreExists(storeId);
    await ref.update({ storeId, updatedAt: serverTimestamp() });
    await logAudit({ actor: user, action: 'social.map_store', entity: 'social_accounts', entityId: accountId, details: { storeId } });
  }
  return { ok: true };
}

/** Account + decrypted token for publishing. */
export async function accountWithToken(accountId) {
  const [account, token] = await Promise.all([db.doc(`social_accounts/${accountId}`).get(), db.doc(`social_tokens/${accountId}`).get()]);
  if (!account.exists || !token.exists) throw new ProviderError('failed-precondition', 'This social account is no longer connected.');
  if (account.get('status') !== 'connected') throw new ProviderError('failed-precondition', `@${account.get('username')} needs to be reconnected in Settings > Social accounts.`);
  return { account: { id: account.id, ...account.data() }, token: openToken(token.get('sealed')) };
}

export async function markNeedsReconnect(accountId, message) {
  await db.doc(`social_accounts/${accountId}`).update({ status: 'reconnect', error: String(message).slice(0, 300), updatedAt: serverTimestamp() }).catch(() => undefined);
}

/** Refreshes long-lived Instagram tokens that expire within 10 days (at most once a day each). */
export async function refreshExpiringTokens(now = Date.now()) {
  if (!instagramConfigured()) return { refreshed: 0 };
  const snap = await db.collection('social_accounts').where('status', '==', 'connected').get();
  let refreshed = 0;
  for (const doc of snap.docs) {
    const expires = toDate(doc.get('tokenExpiresAt'))?.getTime() ?? 0;
    const last = toDate(doc.get('tokenRefreshedAt'))?.getTime() ?? 0;
    if (expires - now > REFRESH_WITHIN_MS || now - last < DAY_MS) continue;
    try {
      const { token } = await accountWithToken(doc.id);
      const next = await instagram.refreshToken(token);
      await db.doc(`social_tokens/${doc.id}`).set({ sealed: sealToken(next.token), updatedAt: serverTimestamp() });
      await doc.ref.update({ tokenExpiresAt: Timestamp.fromMillis(now + next.expiresIn * 1000), tokenRefreshedAt: serverTimestamp(), error: null, updatedAt: serverTimestamp() });
      refreshed += 1;
    } catch (err) {
      logger.warn('social token refresh failed', { accountId: doc.id, err: err?.message });
      if (err?.details?.reconnect || expires < now) await markNeedsReconnect(doc.id, err?.message ?? 'Token expired');
    }
  }
  return { refreshed };
}
