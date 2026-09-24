import { config } from '../config.js';
import { logAudit } from '../lib/audit.js';
import { assertStoreAccess } from '../lib/auth.js';
import { HttpsError } from '../lib/errors.js';
import { db, FieldValue, serverTimestamp } from '../lib/firebase.js';
import { consumeQuota, refundQuota } from '../lib/quota.js';
import { getAppSettings } from '../lib/settings.js';
import { baseSystemPrompt, videoScriptPrompt } from './prompts.js';
import { generateStructured } from './providers/index.js';
import { videoScriptNormalizer, videoScriptSchema } from './schemas.js';

/**
 * MODULE 4 — AI Script Generator (generateVideoScript).
 * Output structure: TITLE → HOOK 0-3s → SCENE 1..n (Visual / Voice) → CTA, plus voice-over, caption, hashtags.
 */
export async function generateVideoScript(user, input) {
  const ideaRef = db.doc(`content_ideas/${input.contentId}`);
  const ideaSnap = await ideaRef.get();
  if (!ideaSnap.exists) throw new HttpsError('not-found', 'Content idea not found.');
  const idea = { id: ideaSnap.id, ...ideaSnap.data() };
  assertStoreAccess(user, idea.storeId);

  const params = { ...input, platform: input.platform ?? idea.platform ?? 'TikTok' };
  await consumeQuota(user.uid, 'ai', config.limits.aiDaily);
  try {
    const settings = await getAppSettings();
    const result = await generateStructured({
      provider: input.provider,
      schemaName: 'video_script',
      schema: videoScriptSchema,
      system: baseSystemPrompt({ language: settings.contentLanguage, brandContext: settings.brandContext }),
      prompt: videoScriptPrompt({ idea, input: params }),
      maxOutputTokens: 16384,
      mockContext: { idea, input: params },
    });
    const script = videoScriptNormalizer.parse(result.data);
    if (!script.scenes.length) throw new HttpsError('internal', 'AI did not return any scenes. Please try again.');
    script.scenes = script.scenes.map((s, i) => ({ ...s, sceneNumber: i + 1 }));

    const scriptRef = db.collection('video_scripts').doc();
    const batch = db.batch();
    batch.set(scriptRef, {
      id: scriptRef.id,
      contentId: idea.id,
      trendId: idea.trendId ?? null,
      title: script.title || idea.title,
      duration: params.duration,
      tone: params.tone,
      platform: params.platform,
      hook: script.hook,
      scenes: script.scenes,
      cta: script.cta,
      voiceOver: script.voiceOver,
      caption: script.caption,
      hashtags: script.hashtags,
      musicSuggestion: script.musicSuggestion,
      storeId: idea.storeId,
      provider: result.provider,
      model: result.model,
      createdBy: user.uid,
      createdAt: serverTimestamp(),
    });
    batch.update(ideaRef, { status: 'scripted', lastScriptId: scriptRef.id, scriptCount: FieldValue.increment(1) });
    await batch.commit();

    await logAudit({ actor: user, action: 'script.generate', entity: 'video_scripts', entityId: scriptRef.id, details: { contentId: idea.id, duration: params.duration, provider: result.provider } });
    return { scriptId: scriptRef.id, provider: result.provider, model: result.model };
  } catch (err) {
    await refundQuota(user.uid, 'ai');
    throw err;
  }
}
