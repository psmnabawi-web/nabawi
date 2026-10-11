import 'server-only';
import { adminDb } from '../firebase/admin';
import type { AiSettings } from '../types';

export const AI_DOC = 'settings/ai';

/** Default dari env (kompatibel dengan konfigurasi lama). */
export function defaultsFromEnv(): AiSettings {
  const providerEnv = (process.env.AI_PROVIDER ?? 'google').toLowerCase();
  const provider: AiSettings['provider'] = providerEnv === 'anthropic' ? 'anthropic' : providerEnv === 'openai' ? 'openai' : 'google';
  return {
    provider,
    model: process.env.AI_MODEL?.trim() || (provider === 'anthropic' ? 'claude-opus-5' : provider === 'openai' ? '' : 'gemini-3.6-flash'),
    apiKey: provider === 'anthropic' ? process.env.ANTHROPIC_API_KEY ?? '' : provider === 'openai' ? process.env.OPENAI_COMPAT_API_KEY ?? '' : process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '',
    baseUrl: process.env.OPENAI_COMPAT_BASE_URL ?? '',
    useVertex: (process.env.GOOGLE_GENAI_USE_VERTEXAI ?? '').toLowerCase() === 'true',
    thinkingLevel: (process.env.AI_THINKING_LEVEL ?? '').toLowerCase() as AiSettings['thinkingLevel'],
    mediaResolution: (process.env.AI_MEDIA_RESOLUTION ?? '').toLowerCase() as AiSettings['mediaResolution'],
    maxConcurrent: Number(process.env.AI_MAX_CONCURRENT || 2),
    jsonMode: 'auto',
    extraBody: {},
    updatedAt: 0,
    updatedByName: null,
  };
}

let cache: { at: number; value: AiSettings } | null = null;
const TTL_MS = 20_000;

/** Pengaturan AI efektif: dokumen Firestore settings/ai (diisi super admin) menimpa env. Cache 20 detik. */
export async function loadAiSettings(force = false): Promise<AiSettings> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const base = defaultsFromEnv();
  let value = base;
  try {
    const snap = await adminDb().doc(AI_DOC).get();
    if (snap.exists) {
      const d = snap.data() as Partial<AiSettings>;
      value = {
        ...base,
        ...Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined && v !== null && v !== '')),
      } as AiSettings;
      if (typeof d.apiKey === 'string' && d.apiKey) value.apiKey = d.apiKey;
    }
  } catch (e) {
    console.error('[aiSettings] gagal membaca settings/ai, pakai env', e);
  }
  cache = { at: Date.now(), value };
  return value;
}

export function invalidateAiSettings() {
  cache = null;
}

export function maskKey(k: string) {
  if (!k) return '';
  return k.length <= 8 ? '•'.repeat(k.length) : `${k.slice(0, 4)}${'•'.repeat(Math.max(4, k.length - 8))}${k.slice(-4)}`;
}
