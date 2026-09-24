import { config } from '../config.js';
import { db } from './firebase.js';

export const TEXT_PROVIDERS = ['gemini', 'openai', 'claude', 'mock'];
export const VIDEO_PROVIDERS = ['veo', 'runway', 'kling', 'pika', 'heygen', 'mock'];

const CACHE_MS = 30_000;

const kitStr = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Brand template settings (Settings > Brand template). Everything optional; branding is on by default. */
export function normalizeBrandKit(raw) {
  const kit = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: kit.enabled !== false,
    captions: kit.captions !== false,
    endCard: kit.endCard !== false,
    instagram: kitStr(kit.instagram, 60),
    whatsapp: kitStr(kit.whatsapp, 30),
    website: kitStr(kit.website, 80),
    hours: kitStr(kit.hours, 60),
    ctaText: kitStr(kit.ctaText, 80),
  };
}
let cache = { at: 0, value: null };

/**
 * App-level settings editable by super admin in Settings > AI & Integrations.
 * Document: settings/app. Falls back to environment defaults.
 */
export async function getAppSettings({ fresh = false } = {}) {
  if (!fresh && cache.value && Date.now() - cache.at < CACHE_MS) return cache.value;
  const snap = await db.doc('settings/app').get();
  const data = snap.exists ? snap.data() : {};
  const value = {
    textProvider: TEXT_PROVIDERS.includes(data.textProvider) ? data.textProvider : config.ai.provider,
    videoProvider: VIDEO_PROVIDERS.includes(data.videoProvider) ? data.videoProvider : config.video.provider,
    contentLanguage: data.contentLanguage === 'en' ? 'en' : 'id',
    brandContext: typeof data.brandContext === 'string' ? data.brandContext.slice(0, 2000) : '',
    heygenAvatarId: typeof data.heygenAvatarId === 'string' && data.heygenAvatarId ? data.heygenAvatarId : config.video.heygenAvatarId,
    heygenVoiceId: typeof data.heygenVoiceId === 'string' && data.heygenVoiceId ? data.heygenVoiceId : config.video.heygenVoiceId,
    brandKit: normalizeBrandKit(data.brandKit),
    // Auto-post finished videos to the connected Instagram account (off by default: human review first).
    social: { autoPost: data.social?.autoPost === true },
  };
  cache = { at: Date.now(), value };
  return value;
}
