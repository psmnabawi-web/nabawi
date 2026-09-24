import { config } from '../config.js';
import { logAudit } from '../lib/audit.js';
import { assertStoreAccess } from '../lib/auth.js';
import { HttpsError } from '../lib/errors.js';
import { db, FieldValue, serverTimestamp } from '../lib/firebase.js';
import { consumeQuota, refundQuota } from '../lib/quota.js';
import { getAppSettings } from '../lib/settings.js';
import { baseSystemPrompt, trendAnalysisPrompt } from './prompts.js';
import { generateStructured } from './providers/index.js';
import { trendAnalysisNormalizer, trendAnalysisSchema } from './schemas.js';
import { fetchSourceContext } from './socialContext.js';

/**
 * MODULE 2 — AI Trend Analyzer.
 * Input: a social_sources document. Output: a trend_analysis document
 * (trend name, score 0-100, growth, content pattern, hook, visual style, recommendation).
 */
export async function analyzeTrend(user, input) {
  const sourceRef = db.doc(`social_sources/${input.sourceId}`);
  const sourceSnap = await sourceRef.get();
  if (!sourceSnap.exists) throw new HttpsError('not-found', 'Social source not found.');
  const source = { id: sourceSnap.id, ...sourceSnap.data() };
  assertStoreAccess(user, source.storeId);

  await consumeQuota(user.uid, 'ai', config.limits.aiDaily);
  try {
    const settings = await getAppSettings();
    const fetched = await fetchSourceContext(source);
    const result = await generateStructured({
      provider: input.provider,
      schemaName: 'trend_analysis',
      schema: trendAnalysisSchema,
      system: baseSystemPrompt({ language: settings.contentLanguage, brandContext: settings.brandContext }),
      prompt: trendAnalysisPrompt({ source, fetched }),
      maxOutputTokens: 8192,
      mockContext: { source },
    });
    const trend = trendAnalysisNormalizer.parse(result.data);
    if (!trend.trendName) throw new HttpsError('internal', 'AI did not return a trend name. Please try again.');

    const trendRef = db.collection('trend_analysis').doc();
    const doc = {
      id: trendRef.id,
      sourceId: source.id,
      storeId: source.storeId,
      platform: source.platform,
      keyword: source.keyword ?? '',
      category: source.category,
      sourceUrl: source.url ?? '',
      sourceMeta: fetched ?? null,
      ...trend,
      provider: result.provider,
      model: result.model,
      createdBy: user.uid,
      createdAt: serverTimestamp(),
    };
    const batch = db.batch();
    batch.set(trendRef, doc);
    batch.update(sourceRef, {
      lastAnalyzedAt: serverTimestamp(),
      lastTrendId: trendRef.id,
      lastTrendName: trend.trendName,
      lastTrendScore: trend.trendScore,
      analysisCount: FieldValue.increment(1),
    });
    await batch.commit();

    await logAudit({ actor: user, action: 'trend.analyze', entity: 'trend_analysis', entityId: trendRef.id, details: { sourceId: source.id, provider: result.provider, model: result.model, score: trend.trendScore } });
    return { trendId: trendRef.id, trendName: trend.trendName, trendScore: trend.trendScore, provider: result.provider, model: result.model };
  } catch (err) {
    await refundQuota(user.uid, 'ai');
    throw err;
  }
}
