import { config } from '../config.js';
import { db } from './firebase.js';

export const TEXT_PROVIDERS = ['gemini', 'openai', 'claude', 'mock'];
export const VIDEO_PROVIDERS = ['runway', 'kling', 'pika', 'heygen', 'mock'];

const CACHE_MS = 30_000;
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
  };
  cache = { at: Date.now(), value };
  return value;
}
