import { config } from '../config.js';
import { logAudit } from '../lib/audit.js';
import { assertStoreAccess, assertStoreExists } from '../lib/auth.js';
import { VIDEO_TEMPLATES } from '../lib/constants.js';
import { HttpsError } from '../lib/errors.js';
import { db, serverTimestamp } from '../lib/firebase.js';
import { consumeQuota, refundQuota } from '../lib/quota.js';
import { getAppSettings } from '../lib/settings.js';
import { VIDEO_ADAPTERS } from '../video/adapters/index.js';
import { applyBrandTemplate, pollVideo, startVideo } from '../video/pipeline.js';

/**
 * MODULE 5 — AI Video Generator.
 * Workflow: select template + settings → Generate Prompt → Send API Request → (async) poll provider →
 * Save Result URL → Store in Firebase Storage. Status: Draft → Processing → Completed → Published (or Failed).
 */
export async function createVideo(user, input) {
  await assertStoreExists(input.storeId);
  assertStoreAccess(user, input.storeId);

  let script = null;
  if (input.scriptId) {
    const snap = await db.doc(`video_scripts/${input.scriptId}`).get();
    if (!snap.exists) throw new HttpsError('not-found', 'Video script not found.');
    script = { id: snap.id, ...snap.data() };
    assertStoreAccess(user, script.storeId);
  }

  const settings = await getAppSettings();
  const provider = input.provider ?? settings.videoProvider;
  const adapter = VIDEO_ADAPTERS[provider];
  if (!adapter) throw new HttpsError('invalid-argument', `Unknown video provider "${provider}".`);
  if (adapter.mode === 'full' && !script) throw new HttpsError('invalid-argument', `${adapter.label} builds the video from a script voice-over. Select a script first.`);
  if (!input.saveAsDraft && !adapter.isConfigured()) {
    throw new HttpsError('failed-precondition', `${adapter.label} is not configured. Save as draft, pick another provider, or ask the super admin to add the API key.`);
  }

  const ref = db.collection('generated_videos').doc();
  await ref.set({
    id: ref.id,
    scriptId: script?.id ?? null,
    contentId: script?.contentId ?? null,
    title: input.title,
    template: input.template,
    templateLabel: VIDEO_TEMPLATES[input.template].label,
    duration: input.duration,
    ratio: input.ratio,
    style: input.style,
    provider,
    brief: input.brief,
    brandTemplate: input.brandTemplate ?? settings.brandKit.enabled,
    storeId: input.storeId,
    status: 'Draft',
    videoUrl: null,
    thumbnail: null,
    segments: [],
    progress: { done: 0, total: 0 },
    attempts: 0,
    error: null,
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await logAudit({ actor: user, action: input.saveAsDraft ? 'video.draft' : 'video.create', entity: 'generated_videos', entityId: ref.id, details: { provider, template: input.template, duration: input.duration } });

  if (input.saveAsDraft) return { videoId: ref.id, status: 'Draft' };
  return { videoId: ref.id, ...(await startWithQuota(user, ref.id)) };
}

async function startWithQuota(user, videoId) {
  await consumeQuota(user.uid, 'video', config.limits.videoDaily);
  try {
    const result = await startVideo(videoId);
    if (result.skipped) throw new HttpsError('aborted', 'This video is already being processed. Refresh in a moment.');
    return result;
  } catch (err) {
    await refundQuota(user.uid, 'video');
    throw err;
  }
}

/** start (Draft → Processing), retry (Failed → Processing), refresh (poll provider now), brand (apply template). */
export async function videoAction(user, { videoId, action }) {
  const snap = await db.doc(`generated_videos/${videoId}`).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Video not found.');
  const video = snap.data();
  assertStoreAccess(user, video.storeId);

  if (action === 'refresh') {
    const result = await pollVideo(videoId);
    return result.skipped ? { status: video.status, busy: true } : result;
  }
  if (action === 'brand') {
    // Re-renders from the stored video: no AI provider call, so no video quota is used.
    const result = await applyBrandTemplate(videoId);
    if (result.skipped) return { status: video.status, busy: true };
    await logAudit({ actor: user, action: 'video.brand', entity: 'generated_videos', entityId: videoId, details: { template: video.template } });
    return result;
  }
  if (action === 'start' && video.status !== 'Draft') throw new HttpsError('failed-precondition', 'Only Draft videos can be started.');
  if (action === 'retry' && video.status !== 'Failed') throw new HttpsError('failed-precondition', 'Only Failed videos can be retried.');
  const result = await startWithQuota(user, videoId);
  await logAudit({ actor: user, action: `video.${action}`, entity: 'generated_videos', entityId: videoId, details: { provider: video.provider } });
  return result;
}
