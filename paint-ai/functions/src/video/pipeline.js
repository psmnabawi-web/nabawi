import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline as streamPipeline } from 'node:stream/promises';
import { logger } from 'firebase-functions';
import { videoPlanPrompt, baseSystemPrompt } from '../ai/prompts.js';
import { generateStructured } from '../ai/providers/index.js';
import { videoPlanNormalizer, videoPlanSchema } from '../ai/schemas.js';
import { config } from '../config.js';
import { RATIO_RESOLUTION, VIDEO_TEMPLATES } from '../lib/constants.js';
import { HttpsError, ProviderError } from '../lib/errors.js';
import { bucket, db, serverTimestamp, toDate } from '../lib/firebase.js';
import { getAppSettings } from '../lib/settings.js';
import { VIDEO_ADAPTERS } from './adapters/index.js';
import { composeVideo, extractThumbnail, faststart, probe } from './ffmpeg.js';
import { buildTemplateAssets } from './template/brandTemplate.js';
import { captionsFromScript, templateContent } from './template/content.js';
import { generateVideoCaptions } from '../social/captions.js';
import { autoPostVideo } from '../social/posts.js';

export { captionsFromScript };

const LEASE_MS = 8 * 60 * 1000;
const MAX_DOWNLOAD_BYTES = 500 * 1024 * 1024;

/**
 * Splits a target duration into clip durations supported by the provider.
 * Picks the combination whose total is closest to the target (ties → not shorter than target, then fewer clips).
 */
export function planSegments(total, allowed) {
  const options = [...new Set(allowed)].filter((d) => d > 0).sort((a, b) => b - a);
  if (!options.length) return [total];
  const maxSum = total + options[0];
  const best = new Map([[0, []]]);
  for (let sum = 0; sum <= maxSum; sum += 1) {
    const combo = best.get(sum);
    if (!combo) continue;
    for (const d of options) {
      const next = sum + d;
      if (next > maxSum) continue;
      const candidate = [...combo, d];
      const existing = best.get(next);
      if (!existing || candidate.length < existing.length) best.set(next, candidate);
    }
  }
  let chosen = null;
  let chosenSum = 0;
  for (const [sum, combo] of best) {
    if (sum === 0) continue;
    if (!chosen) {
      chosen = combo;
      chosenSum = sum;
      continue;
    }
    const diff = Math.abs(sum - total);
    const bestDiff = Math.abs(chosenSum - total);
    const better =
      diff < bestDiff ||
      (diff === bestDiff && sum >= total && chosenSum < total) ||
      (diff === bestDiff && (sum >= total) === (chosenSum >= total) && combo.length < chosen.length);
    if (better) {
      chosen = combo;
      chosenSum = sum;
    }
  }
  return [...chosen].sort((a, b) => b - a);
}

const STYLE_SUFFIX = {
  Realistic: 'Photorealistic, natural daylight, authentic Indonesian setting, handheld smartphone look, true-to-life paint colors.',
  Cinematic: 'Cinematic, dramatic soft lighting, shallow depth of field, smooth gimbal movement, film color grade, true-to-life paint colors.',
};

export function composeClipPrompt(basePrompt, { style, ratio, maxLength = 1000 }) {
  // No aspect-ratio numbers in the prompt: video models tend to draw them as on-screen text ("9.16").
  const orientation = ratio === '9:16' ? 'Tall vertical portrait composition.' : ratio === '1:1' ? 'Square composition.' : 'Wide landscape composition.';
  const suffix = ` ${STYLE_SUFFIX[style] ?? STYLE_SUFFIX.Realistic} ${orientation} Clean frame: no on-screen text, numbers, letters, logos or watermark.`;
  return `${basePrompt.trim().slice(0, Math.max(100, maxLength - suffix.length))}${suffix}`.slice(0, maxLength);
}

/** Deterministic fallback plan when the text AI is unavailable. */
export function fallbackPlan({ template, script, count }) {
  const beats = [];
  if (script) {
    if (script.hook?.visual) beats.push(script.hook.visual);
    for (const s of script.scenes ?? []) if (s.visual) beats.push(s.visual);
    if (script.cta?.visual) beats.push(script.cta.visual);
  }
  if (!beats.length) beats.push(template.brief);
  const prompts = Array.from({ length: count }, (_, i) => {
    const beat = beats[Math.min(beats.length - 1, Math.floor((i * beats.length) / count))];
    return `${template.label}: ${beat} Setting: an Indonesian home and paint store context.`;
  });
  return { prompts, voiceOverText: script?.voiceOver ?? '', hookText: script?.hook?.onScreenText ?? '', captions: captionsFromScript(script, count) };
}

async function buildPlan(video, adapter, settings) {
  const template = VIDEO_TEMPLATES[video.template];
  const segmentDurations = adapter.mode === 'full' ? [video.duration] : planSegments(video.duration, adapter.clipDurations());
  let script = null;
  if (video.scriptId) {
    const snap = await db.doc(`video_scripts/${video.scriptId}`).get();
    if (snap.exists) script = snap.data();
  }
  if (adapter.mode === 'full') {
    // Avatar videos: no hook title or captions over the presenter's face (logo + end card only).
    return { segmentDurations, prompts: [template.brief], voiceOverText: script?.voiceOver || video.brief || '', hookText: '', captions: [], planSource: 'script' };
  }
  try {
    const result = await generateStructured({
      schemaName: 'video_plan',
      schema: videoPlanSchema,
      system: baseSystemPrompt({ language: settings.contentLanguage, brandContext: settings.brandContext }),
      prompt: videoPlanPrompt({ template, style: video.style, ratio: video.ratio, segmentDurations, script, title: video.title, brief: video.brief }),
      maxOutputTokens: 8192,
      mockContext: { segmentDurations, script },
    });
    const plan = videoPlanNormalizer.parse(result.data);
    const fallback = fallbackPlan({ template, script, count: segmentDurations.length });
    const prompts = segmentDurations.map((_, i) => plan.segments[i]?.prompt || fallback.prompts[i]);
    const captions = segmentDurations.map((_, i) => plan.segments[i]?.onScreenText || fallback.captions[i] || '');
    return { segmentDurations, prompts, voiceOverText: plan.voiceOverText || fallback.voiceOverText, hookText: plan.hookText || fallback.hookText, captions, planSource: result.provider };
  } catch (err) {
    logger.warn('video plan AI failed, using fallback', { videoId: video.id, err: err?.message });
    const fallback = fallbackPlan({ template, script, count: segmentDurations.length });
    return { segmentDurations, ...fallback, planSource: 'fallback' };
  }
}

/** Acquires an exclusive processing lease on a video (prevents scheduler + manual refresh racing). */
async function acquireLease(videoRef) {
  const token = randomUUID();
  const ok = await db.runTransaction(async (tx) => {
    const snap = await tx.get(videoRef);
    if (!snap.exists) return false;
    const lease = snap.get('lease');
    if (lease?.until && toDate(lease.until)?.getTime() > Date.now()) return false;
    tx.update(videoRef, { lease: { token, until: new Date(Date.now() + LEASE_MS) } });
    return true;
  });
  return ok ? token : null;
}

async function releaseLease(videoRef, token) {
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(videoRef);
      if (snap.exists && snap.get('lease.token') === token) tx.update(videoRef, { lease: null });
    });
  } catch {
    /* lease expires on its own */
  }
}

async function withLease(videoId, fn) {
  const ref = db.doc(`generated_videos/${videoId}`);
  const token = await acquireLease(ref);
  if (!token) return { skipped: true, reason: 'busy' };
  try {
    return await fn(ref);
  } finally {
    await releaseLease(ref, token);
  }
}

async function failVideo(ref, message, extra = {}) {
  await ref.update({ status: 'Failed', error: String(message).slice(0, 500), failedAt: serverTimestamp(), updatedAt: serverTimestamp(), ...extra });
}

/**
 * Generate Prompt → Send API Request. Creates the provider jobs for a Draft/Failed video and moves it to Processing.
 */
export async function startVideo(videoId) {
  return withLease(videoId, async (ref) => {
    const snap = await ref.get();
    const video = { id: snap.id, ...snap.data() };
    if (!['Draft', 'Failed'].includes(video.status)) throw new HttpsError('failed-precondition', `Video is ${video.status}; only Draft or Failed videos can be started.`);
    const adapter = VIDEO_ADAPTERS[video.provider];
    if (!adapter) throw new HttpsError('invalid-argument', `Unknown video provider "${video.provider}".`);
    if (!adapter.isConfigured()) throw new HttpsError('failed-precondition', `${adapter.label} is not configured. Ask the super admin to add its API key or pick another provider.`);

    const settings = await getAppSettings();
    const plan = await buildPlan(video, adapter, settings);
    await ref.update({
      status: 'Processing',
      error: null,
      plan: { segmentDurations: plan.segmentDurations, voiceOverText: plan.voiceOverText, hookText: plan.hookText, captions: plan.captions, source: plan.planSource },
      segments: [],
      progress: { done: 0, total: plan.segmentDurations.length },
      model: adapter.model(),
      startedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      attempts: (video.attempts ?? 0) + 1,
    });

    const segments = [];
    try {
      for (let index = 0; index < plan.segmentDurations.length; index += 1) {
        const duration = plan.segmentDurations[index];
        const prompt = adapter.mode === 'full' ? plan.prompts[0] : composeClipPrompt(plan.prompts[index], { style: video.style, ratio: video.ratio, maxLength: adapter.maxPromptLength });
        const job = await adapter.createJob({
          prompt,
          duration,
          ratio: video.ratio,
          style: video.style,
          voiceText: plan.voiceOverText,
          title: video.title,
          videoId: video.id,
          index,
          settings,
        });
        segments.push({ index, duration, prompt, jobId: job.jobId, meta: job.meta ?? null, status: 'pending', error: null });
      }
    } catch (err) {
      const message = err instanceof ProviderError || err instanceof HttpsError ? err.message : 'Could not submit the video job to the provider.';
      logger.error('video job submission failed', { videoId, err: err?.message });
      await failVideo(ref, message, { segments });
      throw err instanceof ProviderError ? new HttpsError(err.code, err.message) : err;
    }
    await ref.update({ segments, updatedAt: serverTimestamp() });
    return { status: 'Processing', segments: segments.length };
  });
}

async function downloadToFile(segment, destination) {
  if (segment.storagePath) {
    await bucket().file(segment.storagePath).download({ destination });
    return;
  }
  const url = new URL(segment.videoUrl);
  if (url.protocol !== 'https:') throw new Error('Provider video URL must be https');
  const res = await fetch(url, { signal: AbortSignal.timeout(240_000) });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
  const length = Number(res.headers.get('content-length') ?? 0);
  if (length > MAX_DOWNLOAD_BYTES) throw new Error('Video file is too large');
  await streamPipeline(Readable.fromWeb(res.body), createWriteStream(destination));
  const { size } = await stat(destination);
  if (size > MAX_DOWNLOAD_BYTES) throw new Error('Video file is too large');
}

/**
 * Firebase Storage download URL for an object carrying a download token. Built locally instead of
 * calling getDownloadURL(), which needs an extra metadata request (and fails in the emulator).
 */
export function tokenDownloadUrl(bucketName, objectPath, token, emulatorHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST) {
  const origin = emulatorHost ? `http://${emulatorHost}` : 'https://firebasestorage.googleapis.com';
  return `${origin}/v0/b/${bucketName}/o/${encodeURIComponent(objectPath)}?alt=media&token=${token}`;
}

async function uploadWithToken(localPath, destination, contentType) {
  const token = randomUUID();
  await bucket().upload(localPath, {
    destination,
    metadata: { contentType, cacheControl: 'public, max-age=31536000', metadata: { firebaseStorageDownloadTokens: token } },
  });
  return { path: destination, url: tokenDownloadUrl(bucket().name, destination, token) };
}

const TRANSITION_SECONDS = 0.35;

/** Cut styles: soft cross-fades; the before/after template reveals the result with a wipe. */
export function transitionsFor(template, clipCount) {
  return Array.from({ length: Math.max(0, clipCount - 1) }, (_, i) => (template === 'before_after' && i === clipCount - 2 ? 'wipeleft' : 'fade'));
}

/**
 * Save Result URL → Store in Firebase Storage: downloads the clips, joins them with transitions, applies
 * the brand template (logo, hook title, captions, end card) and uploads the final video, a clean copy
 * without branding, and a thumbnail.
 */
async function finalizeVideo(ref, video) {
  const dir = await mkdtemp(path.join(tmpdir(), `video-${video.id}-`));
  try {
    const inputs = [];
    for (const segment of video.segments) {
      const file = path.join(dir, `seg-${segment.index}.mp4`);
      await downloadToFile(segment, file);
      const info = await probe(file);
      if (!info.hasVideo) throw new Error(`Clip ${segment.index + 1} has no video stream`);
      inputs.push({ path: file, ...info });
    }
    const finalPath = path.join(dir, 'final.mp4');
    const cleanPath = path.join(dir, 'clean.mp4');
    const dims = RATIO_RESOLUTION[video.ratio] ?? RATIO_RESOLUTION['9:16'];
    const settings = await getAppSettings();
    const branded = video.brandTemplate ?? settings.brandKit.enabled;

    let info;
    if (!branded && inputs.length === 1) {
      info = await faststart(inputs[0].path, finalPath);
    } else {
      let template = null;
      if (branded) {
        const content = await templateContent(video, settings);
        template = await buildTemplateAssets({
          dir,
          dims,
          durations: inputs.map((i) => i.duration),
          transition: TRANSITION_SECONDS,
          template: video.template,
          ...content,
          lang: settings.contentLanguage,
          options: { captions: settings.brandKit.captions, endCard: settings.brandKit.endCard },
        });
      }
      info = await composeVideo({
        clips: inputs,
        dims,
        transition: TRANSITION_SECONDS,
        transitions: transitionsFor(video.template, inputs.length),
        overlays: template?.overlays ?? [],
        endCard: template?.endCard ?? null,
        output: finalPath,
        cleanOutput: branded ? cleanPath : null,
      });
    }

    const thumbPath = path.join(dir, 'thumbnail.jpg');
    // With the template, ~1.2 s shows the hook title: a better cover than the first frame.
    await extractThumbnail(finalPath, thumbPath, Math.min(branded ? 1.2 : 1, Math.max(0, info.duration / 3)));

    const uploadedVideo = await uploadWithToken(finalPath, `videos/${video.id}/final.mp4`, 'video/mp4');
    const uploadedThumb = await uploadWithToken(thumbPath, `videos/${video.id}/thumbnail.jpg`, 'image/jpeg');
    const uploadedClean = branded ? await uploadWithToken(cleanPath, `videos/${video.id}/clean.mp4`, 'video/mp4') : null;

    await ref.update({
      status: 'Completed',
      videoUrl: uploadedVideo.url,
      storagePath: uploadedVideo.path,
      cleanVideoUrl: uploadedClean?.url ?? null,
      cleanStoragePath: uploadedClean?.path ?? null,
      brandTemplateApplied: branded,
      // Clip boundaries inside clean.mp4, so the template can be re-applied later without the clips.
      render: { durations: inputs.map((i) => Math.round(i.duration * 1000) / 1000), transition: inputs.length > 1 ? TRANSITION_SECONDS : 0 },
      thumbnail: uploadedThumb.url,
      thumbnailPath: uploadedThumb.path,
      actualDurationSec: Math.round(info.duration * 10) / 10,
      completedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      error: null,
    });

    // Intermediate clips are no longer needed once the final video exists.
    await bucket()
      .deleteFiles({ prefix: `videos/${video.id}/segments/` })
      .catch(() => undefined);
    return { status: 'Completed' };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Clip boundaries inside an unbranded video: stored at render time, or (videos made before the template
 * existed: hard cuts, no transitions) the planned clip durations scaled to the real length.
 */
export function sourceTimeline(video, sourceDuration) {
  const stored = video.render?.durations;
  if (Array.isArray(stored) && stored.length) return { durations: stored, transition: Number(video.render.transition) || 0 };
  const planned = (video.plan?.segmentDurations ?? []).filter((d) => d > 0);
  if (!planned.length) return { durations: [sourceDuration], transition: 0 };
  const scale = sourceDuration / planned.reduce((a, b) => a + b, 0);
  return { durations: planned.map((d) => Math.round(d * scale * 1000) / 1000), transition: 0 };
}

/**
 * Applies (or re-applies, e.g. after the brand template settings changed) the brand template to a finished
 * video without generating new clips: renders from clean.mp4, or from the unbranded final.mp4 of videos
 * made before the template existed (that file is then kept as the clean copy).
 */
export async function applyBrandTemplate(videoId) {
  return withLease(videoId, async (ref) => {
    const snap = await ref.get();
    const video = { id: snap.id, ...snap.data() };
    if (!['Completed', 'Published'].includes(video.status)) throw new HttpsError('failed-precondition', 'Only finished videos can get the brand template.');
    const sourcePath = video.cleanStoragePath || (!video.brandTemplateApplied ? video.storagePath : null);
    if (!sourcePath) throw new HttpsError('failed-precondition', 'This video has no unbranded copy to render from.');

    const dir = await mkdtemp(path.join(tmpdir(), `brand-${video.id}-`));
    try {
      const sourceFile = path.join(dir, 'source.mp4');
      await bucket().file(sourcePath).download({ destination: sourceFile });
      const source = await probe(sourceFile);
      if (!source.hasVideo) throw new HttpsError('failed-precondition', 'The stored video file is not readable.');

      const settings = await getAppSettings({ fresh: true });
      const dims = RATIO_RESOLUTION[video.ratio] ?? RATIO_RESOLUTION['9:16'];
      const { durations, transition } = sourceTimeline(video, source.duration);
      const content = await templateContent(video, settings, durations.length);
      const template = await buildTemplateAssets({
        dir,
        dims,
        durations,
        transition,
        template: video.template,
        ...content,
        lang: settings.contentLanguage,
        options: { captions: settings.brandKit.captions, endCard: settings.brandKit.endCard },
      });
      const finalPath = path.join(dir, 'final.mp4');
      const info = await composeVideo({ clips: [{ path: sourceFile, ...source }], dims, transition: TRANSITION_SECONDS, overlays: template.overlays, endCard: template.endCard, output: finalPath });

      const thumbPath = path.join(dir, 'thumbnail.jpg');
      await extractThumbnail(finalPath, thumbPath, Math.min(1.2, Math.max(0, info.duration / 3)));
      // Keep the unbranded source first, then overwrite final.mp4.
      const clean = video.cleanStoragePath ? { url: video.cleanVideoUrl, path: video.cleanStoragePath } : await uploadWithToken(sourceFile, `videos/${video.id}/clean.mp4`, 'video/mp4');
      const uploadedVideo = await uploadWithToken(finalPath, `videos/${video.id}/final.mp4`, 'video/mp4');
      const uploadedThumb = await uploadWithToken(thumbPath, `videos/${video.id}/thumbnail.jpg`, 'image/jpeg');

      await ref.update({
        videoUrl: uploadedVideo.url,
        storagePath: uploadedVideo.path,
        cleanVideoUrl: clean.url,
        cleanStoragePath: clean.path,
        brandTemplate: true,
        brandTemplateApplied: true,
        render: { durations, transition },
        thumbnail: uploadedThumb.url,
        thumbnailPath: uploadedThumb.path,
        actualDurationSec: Math.round(info.duration * 10) / 10,
        updatedAt: serverTimestamp(),
      });
      return { status: video.status, branded: true };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}

/**
 * Post-processing once a video is Completed: AI captions for every platform, then optional auto-posting.
 * Failures are logged only; the video itself is already done.
 */
async function afterCompleted(videoId) {
  try {
    await generateVideoCaptions(videoId);
  } catch (err) {
    logger.warn('auto captions failed', { videoId, err: err?.message });
  }
  try {
    await autoPostVideo(videoId);
  } catch (err) {
    logger.warn('auto post failed', { videoId, err: err?.message });
  }
}

/** Polls provider jobs for one Processing video and finalizes it when all clips are ready. */
export async function pollVideo(videoId) {
  return withLease(videoId, async (ref) => {
    const snap = await ref.get();
    if (!snap.exists) return { status: 'missing' };
    const video = { id: snap.id, ...snap.data() };
    if (video.status !== 'Processing') return { status: video.status };

    const startedAt = toDate(video.startedAt) ?? toDate(video.createdAt) ?? new Date();
    if (Date.now() - startedAt.getTime() > config.video.timeoutMinutes * 60_000) {
      await failVideo(ref, `Timed out after ${config.video.timeoutMinutes} minutes. Retry to submit again.`);
      return { status: 'Failed' };
    }
    const adapter = VIDEO_ADAPTERS[video.provider];
    if (!adapter) {
      await failVideo(ref, `Unknown provider ${video.provider}`);
      return { status: 'Failed' };
    }
    const segments = [...(video.segments ?? [])];
    if (!segments.length) return { status: 'Processing' }; // jobs are still being submitted

    let changed = false;
    for (let i = 0; i < segments.length; i += 1) {
      const seg = segments[i];
      if (seg.status === 'succeeded' || seg.status === 'failed') continue;
      try {
        const result = await adapter.getJob(seg.jobId, seg.meta ?? {});
        const next = {
          ...seg,
          status: result.status,
          error: result.error ?? null,
          ...(result.videoUrl ? { videoUrl: result.videoUrl } : {}),
          ...(result.storagePath ? { storagePath: result.storagePath } : {}),
          ...(result.thumbnailUrl ? { thumbnailUrl: result.thumbnailUrl } : {}),
          ...(typeof result.progress === 'number' ? { progress: result.progress } : {}),
        };
        if (next.status === 'succeeded' && !next.videoUrl && !next.storagePath) {
          next.status = 'failed';
          next.error = 'Provider returned no video URL';
        }
        if (JSON.stringify(next) !== JSON.stringify(seg)) {
          segments[i] = next;
          changed = true;
        }
      } catch (err) {
        // Transient polling errors are retried on the next run; auth/validation errors fail the clip.
        if (err instanceof ProviderError && ['failed-precondition', 'invalid-argument', 'not-found'].includes(err.code)) {
          segments[i] = { ...seg, status: 'failed', error: err.message };
          changed = true;
        } else {
          logger.warn('video poll error (will retry)', { videoId, index: i, err: err?.message });
        }
      }
    }

    const done = segments.filter((s) => s.status === 'succeeded').length;
    const failed = segments.find((s) => s.status === 'failed');
    if (changed) await ref.update({ segments, progress: { done, total: segments.length }, updatedAt: serverTimestamp() });

    if (failed) {
      await failVideo(ref, `Clip ${failed.index + 1} failed: ${failed.error ?? 'unknown error'}`);
      return { status: 'Failed' };
    }
    if (done === segments.length) {
      try {
        const result = await finalizeVideo(ref, { ...video, segments });
        await afterCompleted(video.id);
        return result;
      } catch (err) {
        logger.error('video finalize failed', { videoId, err: err?.message });
        await failVideo(ref, `Could not assemble the final video: ${err?.message ?? 'unknown error'}`);
        return { status: 'Failed' };
      }
    }
    return { status: 'Processing', done, total: segments.length };
  });
}

/** Scheduled worker: advances every Processing video. */
export async function pollProcessingVideos({ limit = 10 } = {}) {
  const snap = await db.collection('generated_videos').where('status', '==', 'Processing').limit(limit).get();
  const results = [];
  for (const doc of snap.docs) {
    try {
      results.push({ id: doc.id, ...(await pollVideo(doc.id)) });
    } catch (err) {
      logger.error('pollVideo failed', { videoId: doc.id, err: err?.message });
    }
  }
  return results;
}
