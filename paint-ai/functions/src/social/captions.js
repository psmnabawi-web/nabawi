import { baseSystemPrompt, socialCaptionsPrompt } from '../ai/prompts.js';
import { generateStructured } from '../ai/providers/index.js';
import { socialCaptionsNormalizer, socialCaptionsSchema } from '../ai/schemas.js';
import { VIDEO_TEMPLATES } from '../lib/constants.js';
import { HttpsError } from '../lib/errors.js';
import { db, serverTimestamp } from '../lib/firebase.js';
import { getAppSettings } from '../lib/settings.js';
import { templateContent } from '../video/template/content.js';

/**
 * Writes one caption set per platform (Instagram, TikTok, Facebook, YouTube Shorts) for a finished video,
 * from its script, AI plan texts and the brand template contact details. Stored on the video as
 * `socialCaptions` (editable by content managers).
 */
export async function generateVideoCaptions(videoId, { provider } = {}) {
  const ref = db.doc(`generated_videos/${videoId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Video not found.');
  const video = { id: snap.id, ...snap.data() };
  const settings = await getAppSettings();
  const { script, contact, cta } = await templateContent(video, settings, video.plan?.segmentDurations?.length ?? 1);
  const templateLabel = VIDEO_TEMPLATES[video.template]?.label ?? video.templateLabel ?? '';

  const result = await generateStructured({
    schemaName: 'social_captions',
    schema: socialCaptionsSchema,
    system: baseSystemPrompt({ language: settings.contentLanguage, brandContext: settings.brandContext }),
    prompt: socialCaptionsPrompt({ video, script, contact, cta, templateLabel }),
    maxOutputTokens: 6144,
    provider,
    mockContext: { video, cta },
  });
  const captions = socialCaptionsNormalizer.parse(result.data);
  if (!captions.instagram) throw new HttpsError('unavailable', 'The AI returned an empty caption. Please try again.');
  await ref.update({ socialCaptions: { ...captions, provider: result.provider, generatedAt: serverTimestamp() }, updatedAt: serverTimestamp() });
  return { ...captions, provider: result.provider };
}
