import { config } from '../config.js';
import { logAudit } from '../lib/audit.js';
import { assertStoreAccess, assertStoreExists } from '../lib/auth.js';
import { HttpsError } from '../lib/errors.js';
import { db, serverTimestamp } from '../lib/firebase.js';
import { consumeQuota, refundQuota } from '../lib/quota.js';
import { getAppSettings } from '../lib/settings.js';
import { baseSystemPrompt, contentIdeasPrompt } from './prompts.js';
import { generateStructured } from './providers/index.js';
import { contentIdeasNormalizer, contentIdeasSchema } from './schemas.js';

/**
 * MODULE 3 — AI Content Generator (generateContentIdeas).
 * Input: product, audience (+ optional trend). Output: up to 20 content_ideas documents sharing a batchId.
 */
export async function generateContentIdeas(user, input) {
  await assertStoreExists(input.storeId);
  assertStoreAccess(user, input.storeId);

  let trend = null;
  if (input.trendId) {
    const snap = await db.doc(`trend_analysis/${input.trendId}`).get();
    if (!snap.exists) throw new HttpsError('not-found', 'Trend analysis not found.');
    trend = { id: snap.id, ...snap.data() };
    assertStoreAccess(user, trend.storeId);
  }

  await consumeQuota(user.uid, 'ai', config.limits.aiDaily);
  try {
    const settings = await getAppSettings();
    const result = await generateStructured({
      provider: input.provider,
      schemaName: 'content_ideas',
      schema: contentIdeasSchema,
      system: baseSystemPrompt({ language: settings.contentLanguage, brandContext: settings.brandContext }),
      prompt: contentIdeasPrompt({ input, trend }),
      maxOutputTokens: 32768,
      mockContext: { input },
    });
    const ideas = contentIdeasNormalizer
      .parse(result.data)
      .ideas.filter((i) => i.title && i.hook)
      .slice(0, input.count);
    if (!ideas.length) throw new HttpsError('internal', 'AI did not return any usable ideas. Please try again.');

    const batchRef = db.collection('content_ideas').doc();
    const batchId = batchRef.id;
    const writer = db.batch();
    const ideaIds = [];
    ideas.forEach((idea, index) => {
      const ref = db.collection('content_ideas').doc();
      ideaIds.push(ref.id);
      writer.set(ref, {
        id: ref.id,
        batchId,
        rank: index + 1,
        trendId: trend?.id ?? null,
        trendName: trend?.trendName ?? null,
        ...idea,
        product: input.product,
        audience: input.audience,
        platform: input.platform,
        storeId: input.storeId,
        status: 'idea',
        favorite: false,
        scriptCount: 0,
        provider: result.provider,
        model: result.model,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
      });
    });
    await writer.commit();

    await logAudit({ actor: user, action: 'content.generate', entity: 'content_ideas', entityId: batchId, details: { count: ideas.length, product: input.product, audience: input.audience, trendId: trend?.id ?? null, provider: result.provider } });
    return { batchId, count: ideas.length, ideaIds, provider: result.provider, model: result.model };
  } catch (err) {
    await refundQuota(user.uid, 'ai');
    throw err;
  }
}
