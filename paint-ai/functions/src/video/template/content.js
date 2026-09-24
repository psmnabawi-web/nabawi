import { db } from '../../lib/firebase.js';
import { VIDEO_ADAPTERS } from '../adapters/index.js';
import { templateLabels } from './brandTemplate.js';

/** Spreads the script's scene/CTA on-screen texts over `count` clips (the hook text is shown as the title). */
export function captionsFromScript(script, count) {
  const texts = [...(script?.scenes ?? []).map((s) => s?.onScreenText), script?.cta?.onScreenText].map((t) => String(t ?? '').trim()).filter(Boolean);
  if (!texts.length || count < 1) return [];
  return Array.from({ length: count }, (_, i) => texts[count === 1 ? 0 : Math.round((i * (texts.length - 1)) / (count - 1))]);
}

/** Texts and contact details for the brand template of one video. */
export async function templateContent(video, settings, count = video.segments?.length ?? 1) {
  const kit = settings.brandKit;
  const [script, store] = await Promise.all([
    video.scriptId ? db.doc(`video_scripts/${video.scriptId}`).get().then((s) => (s.exists ? s.data() : null)) : null,
    video.storeId && video.storeId !== 'ALL' ? db.doc(`stores/${video.storeId}`).get().then((s) => (s.exists ? s.data() : null)) : null,
  ]);
  const planCaptions = Array.isArray(video.plan?.captions) ? video.plan.captions : [];
  const scriptCaptions = captionsFromScript(script, count);
  const fullMode = VIDEO_ADAPTERS[video.provider]?.mode === 'full';
  return {
    script,
    store,
    hookText: fullMode ? '' : video.plan?.hookText || script?.hook?.onScreenText || video.title,
    captions: fullMode ? [] : Array.from({ length: count }, (_, i) => planCaptions[i] || scriptCaptions[i] || ''),
    cta: script?.cta?.onScreenText || kit.ctaText || templateLabels(settings.contentLanguage).cta,
    contact: {
      storeName: store?.storeName ?? '',
      address: store?.address ?? '',
      city: store?.city ?? '',
      whatsapp: kit.whatsapp,
      instagram: kit.instagram,
      website: kit.website,
      hours: kit.hours,
    },
  };
}
