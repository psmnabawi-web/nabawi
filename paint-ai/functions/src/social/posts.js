import { logger } from 'firebase-functions';
import { ALL_STORES } from '../config.js';
import { logAudit } from '../lib/audit.js';
import { assertStoreAccess } from '../lib/auth.js';
import { HttpsError, ProviderError } from '../lib/errors.js';
import { Timestamp, db, serverTimestamp, toDate } from '../lib/firebase.js';
import { getAppSettings } from '../lib/settings.js';
import { accountWithToken, instagramConfigured, markNeedsReconnect, refreshExpiringTokens } from './accounts.js';
import * as instagram from './instagram.js';

/**
 * Social posts (collection social_posts). Lifecycle:
 *   Scheduled ──(due)──► Publishing: container created ──(FINISHED)──► Published (permalink)
 *        │                                  └──(ERROR / EXPIRED / timeout)──► Failed
 *        └──(cancel)──► Cancelled
 * Worked by processSocialQueue() every minute (scheduled pollVideoJobs) and right away for "post now".
 */
const MAX_SCHEDULE_DAYS = 75;
const PUBLISH_TIMEOUT_MS = 45 * 60 * 1000;
const ACTIVE = ['Scheduled', 'Publishing'];

export const countHashtags = (text) => (String(text).match(/(^|\s)#[\p{L}\p{N}_]+/gu) ?? []).length;

/** Accounts allowed for a video: brand-wide accounts, or the account mapped to the video's store. */
export const accountFitsVideo = (account, video) => account.storeId === ALL_STORES || video.storeId === ALL_STORES || account.storeId === video.storeId;

async function createPost({ video, account, caption, scheduledAt, createdBy, auto = false }) {
  const active = await db.collection('social_posts').where('videoId', '==', video.id).where('accountId', '==', account.id).get();
  if (active.docs.some((d) => ACTIVE.includes(d.get('status')))) throw new HttpsError('already-exists', `This video is already scheduled for @${account.username}.`);
  const ref = db.collection('social_posts').doc();
  await ref.set({
    id: ref.id,
    videoId: video.id,
    videoTitle: video.title,
    storeId: video.storeId,
    platform: account.platform,
    accountId: account.id,
    accountName: account.username,
    caption,
    status: 'Scheduled',
    scheduledAt: Timestamp.fromDate(scheduledAt),
    auto,
    containerId: null,
    mediaId: null,
    permalink: null,
    error: null,
    attempts: 0,
    createdBy,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref;
}

/** Content managers: publish now (scheduledAt empty) or later to a connected account. */
export async function schedulePost(user, { videoId, accountId, caption, scheduledAt }) {
  const [videoSnap, accountSnap] = await Promise.all([db.doc(`generated_videos/${videoId}`).get(), db.doc(`social_accounts/${accountId}`).get()]);
  if (!videoSnap.exists) throw new HttpsError('not-found', 'Video not found.');
  if (!accountSnap.exists) throw new HttpsError('not-found', 'Social account not found. Connect it in Settings > Social accounts.');
  const video = { id: videoSnap.id, ...videoSnap.data() };
  const account = { id: accountSnap.id, ...accountSnap.data() };
  assertStoreAccess(user, video.storeId);
  if (!['Completed', 'Published'].includes(video.status) || !video.videoUrl) throw new HttpsError('failed-precondition', 'Only finished videos can be posted.');
  if (account.status !== 'connected') throw new HttpsError('failed-precondition', `@${account.username} needs to be reconnected in Settings > Social accounts.`);
  if (!accountFitsVideo(account, video)) throw new HttpsError('permission-denied', `@${account.username} is linked to another store.`);
  if (countHashtags(caption) > 30) throw new HttpsError('invalid-argument', 'Instagram allows at most 30 hashtags.');
  if (!instagramConfigured()) throw new HttpsError('failed-precondition', 'Instagram posting is not set up on the server.');

  const now = Date.now();
  const when = scheduledAt ? new Date(scheduledAt) : new Date(now);
  if (Number.isNaN(when.getTime())) throw new HttpsError('invalid-argument', 'Invalid schedule time.');
  if (when.getTime() > now + MAX_SCHEDULE_DAYS * 24 * 3600 * 1000) throw new HttpsError('invalid-argument', `Schedule at most ${MAX_SCHEDULE_DAYS} days ahead.`);
  const postNow = when.getTime() <= now + 60_000;

  const ref = await createPost({ video, account, caption, scheduledAt: postNow ? new Date(now) : when, createdBy: user.uid });
  await logAudit({ actor: user, action: postNow ? 'social.post_now' : 'social.schedule', entity: 'social_posts', entityId: ref.id, details: { videoId, account: account.username, scheduledAt: when.toISOString() } });
  if (postNow) await startPublishing(ref.id);
  const snap = await ref.get();
  return { postId: ref.id, status: snap.get('status'), error: snap.get('error') ?? null };
}

export async function cancelPost(user, { postId }) {
  const ref = db.doc(`social_posts/${postId}`);
  const cancelled = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('not-found', 'Post not found.');
    assertStoreAccess(user, snap.get('storeId'));
    if (snap.get('status') !== 'Scheduled') return false;
    tx.update(ref, { status: 'Cancelled', updatedAt: serverTimestamp(), cancelledBy: user.uid });
    return true;
  });
  if (!cancelled) throw new HttpsError('failed-precondition', 'Only scheduled posts can be cancelled.');
  await logAudit({ actor: user, action: 'social.cancel', entity: 'social_posts', entityId: postId });
  return { status: 'Cancelled' };
}

async function failPost(ref, message, extra = {}) {
  await ref.update({ status: 'Failed', error: String(message).slice(0, 500), failedAt: serverTimestamp(), updatedAt: serverTimestamp(), ...extra });
}

/** Scheduled → Publishing: claims the post, then asks Instagram to fetch the video (media container). */
export async function startPublishing(postId) {
  const ref = db.doc(`social_posts/${postId}`);
  const post = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.get('status') !== 'Scheduled') return null;
    tx.update(ref, { status: 'Publishing', publishingStartedAt: serverTimestamp(), attempts: (snap.get('attempts') ?? 0) + 1, updatedAt: serverTimestamp() });
    return { id: snap.id, ...snap.data() };
  });
  if (!post) return { skipped: true };
  try {
    const video = await db.doc(`generated_videos/${post.videoId}`).get();
    if (!video.exists || !video.get('videoUrl')) throw new ProviderError('failed-precondition', 'The video file no longer exists.');
    const { account, token } = await accountWithToken(post.accountId);
    const containerId = await instagram.createReelContainer({ userId: account.externalId, token, videoUrl: video.get('videoUrl'), caption: post.caption });
    await ref.update({ containerId, updatedAt: serverTimestamp() });
    return { containerId };
  } catch (err) {
    if (err?.details?.reconnect) await markNeedsReconnect(post.accountId, err.message);
    if (err instanceof ProviderError && err.code === 'resource-exhausted') {
      // Rate limited: back to the queue in 15 minutes.
      await ref.update({ status: 'Scheduled', scheduledAt: Timestamp.fromMillis(Date.now() + 15 * 60_000), error: err.message, updatedAt: serverTimestamp() });
      return { retry: true };
    }
    await failPost(ref, err instanceof ProviderError || err instanceof HttpsError ? err.message : 'Could not send the video to Instagram.');
    return { failed: true };
  }
}

/** Publishing: once Instagram finished processing the container, publish it and record the permalink. */
export async function checkPublishing(postId) {
  const ref = db.doc(`social_posts/${postId}`);
  const snap = await ref.get();
  const post = snap.exists ? { id: snap.id, ...snap.data() } : null;
  if (!post || post.status !== 'Publishing' || !post.containerId || post.mediaId) return { skipped: true };
  const started = toDate(post.publishingStartedAt)?.getTime() ?? Date.now();
  try {
    const { account, token } = await accountWithToken(post.accountId);
    const { statusCode, status } = await instagram.getContainerStatus({ containerId: post.containerId, token });
    if (statusCode === 'IN_PROGRESS') {
      if (Date.now() - started > PUBLISH_TIMEOUT_MS) await failPost(ref, 'Instagram is still processing the video after 45 minutes. Try posting again.');
      return { status: 'Publishing' };
    }
    if (statusCode === 'ERROR' || statusCode === 'EXPIRED') {
      await failPost(ref, `Instagram could not process the video (${statusCode}${status ? `: ${status}` : ''}).`);
      return { status: 'Failed' };
    }
    // FINISHED (or already PUBLISHED): claim the publish step once.
    const claimed = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(ref);
      if (fresh.get('status') !== 'Publishing' || fresh.get('mediaId') || fresh.get('publishClaimedAt')) return false;
      tx.update(ref, { publishClaimedAt: serverTimestamp() });
      return true;
    });
    if (!claimed) return { skipped: true };
    const mediaId = await instagram.publishContainer({ userId: account.externalId, token, containerId: post.containerId });
    const permalink = await instagram.getPermalink({ mediaId, token });
    await ref.update({ status: 'Published', mediaId, permalink: permalink || null, error: null, publishedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    await markVideoPublished(post, permalink);
    return { status: 'Published', permalink };
  } catch (err) {
    if (err?.details?.reconnect) await markNeedsReconnect(post.accountId, err.message);
    if (err instanceof ProviderError && ['unavailable', 'resource-exhausted'].includes(err.code) && Date.now() - started < PUBLISH_TIMEOUT_MS) {
      // Transient: release the publish claim and try again on the next run.
      await ref.update({ publishClaimedAt: null, error: err.message, updatedAt: serverTimestamp() });
      return { retry: true };
    }
    await failPost(ref, err instanceof ProviderError || err instanceof HttpsError ? err.message : 'Publishing to Instagram failed.');
    return { status: 'Failed' };
  }
}

/** Mirrors the post on the video (same fields as a manual "Mark published"). */
async function markVideoPublished(post, permalink) {
  const ref = db.doc(`generated_videos/${post.videoId}`);
  const video = await ref.get();
  if (!video.exists) return;
  const update = { lastSocialPost: { platform: post.platform, account: post.accountName, permalink: permalink || null, at: Timestamp.now() }, updatedAt: serverTimestamp() };
  if (video.get('status') === 'Completed') Object.assign(update, { status: 'Published', platform: 'Instagram', publishedUrl: permalink || '', publishedAt: serverTimestamp() });
  await ref.update(update);
}

/** Runs every minute: due posts, posts being processed by Instagram, and (hourly) token refresh. */
export async function processSocialQueue({ now = new Date() } = {}) {
  if (!instagramConfigured()) return { skipped: 'not-configured' };
  const [due, publishing] = await Promise.all([
    db.collection('social_posts').where('status', '==', 'Scheduled').where('scheduledAt', '<=', Timestamp.fromDate(now)).orderBy('scheduledAt').limit(10).get(),
    db.collection('social_posts').where('status', '==', 'Publishing').limit(20).get(),
  ]);
  for (const doc of due.docs) await startPublishing(doc.id).catch((err) => logger.error('startPublishing failed', { postId: doc.id, err: err?.message }));
  for (const doc of publishing.docs) await checkPublishing(doc.id).catch((err) => logger.error('checkPublishing failed', { postId: doc.id, err: err?.message }));

  const marker = db.doc('system/social');
  const last = toDate((await marker.get()).get('tokensCheckedAt'))?.getTime() ?? 0;
  if (now.getTime() - last > 3600_000) {
    await marker.set({ tokensCheckedAt: serverTimestamp() }, { merge: true });
    await refreshExpiringTokens(now.getTime());
  }
  return { due: due.size, publishing: publishing.size };
}

/** Optional full automation (Settings > Social accounts): post a finished video right away. */
export async function autoPostVideo(videoId) {
  const settings = await getAppSettings({ fresh: true });
  if (!settings.social.autoPost || !instagramConfigured()) return { skipped: true };
  const snap = await db.doc(`generated_videos/${videoId}`).get();
  if (!snap.exists) return { skipped: true };
  const video = { id: snap.id, ...snap.data() };
  const caption = video.socialCaptions?.instagram;
  if (!caption || video.status !== 'Completed') return { skipped: true };
  const accounts = (await db.collection('social_accounts').where('platform', '==', 'instagram').where('status', '==', 'connected').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  // Prefer the store's own account, then the brand-wide one.
  const account = accounts.find((a) => a.storeId === video.storeId && video.storeId !== ALL_STORES) ?? accounts.find((a) => a.storeId === ALL_STORES);
  if (!account) return { skipped: true };
  const ref = await createPost({ video, account, caption, scheduledAt: new Date(), createdBy: 'system', auto: true });
  await logAudit({ actor: { uid: 'system', email: null, role: 'system' }, action: 'social.auto_post', entity: 'social_posts', entityId: ref.id, details: { videoId, account: account.username } });
  return startPublishing(ref.id);
}
