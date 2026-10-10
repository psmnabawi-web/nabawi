import 'server-only';
import { loadAiSettings } from '../server/aiSettings';
import type { AiResult, AiSettings } from '../types';
import { analyzeWithAnthropic } from './anthropic';
import { RESPONSE_SCHEMA } from './google';
import { buildUserText, imageLabel, SYSTEM_PROMPT, type AnalyzeInput, type RawAiOutput } from './prompt';
import { generateJson } from './provider';
import { normalizeCleanliness } from './shared';

export type { AnalyzeInput } from './prompt';

/** Temuan berat yang tidak boleh lolos apa pun skor modelnya: hama, dan kotoran yang secara eksplisit menumpuk/tebal/meluas. */
const HEAVY_PATTERNS = [/tikus/i, /kecoa/i, /hama/i, /belatung/i, /lalat banyak/i, /(grease|lemak|kerak|jamur|sisa makanan|sampah|genangan|debu)[^.|]*(menumpuk|tebal|meluas|banyak|menggenang|tercecer)/i, /(menumpuk|tebal|meluas)[^.|]*(grease|lemak|kerak|jamur|sisa makanan|sampah|debu)/i];

/**
 * Pengaman di sisi server (versi longgar, setelah kalibrasi lapangan):
 * - coverage "unclear" (mayoritas area tidak terlihat / zoom sempit) -> maks 3
 * - temuan berat eksplisit (hama, kotoran menumpuk) -> maks 2
 * - skor 5 dengan temuan non-minor -> 4
 * Temuan kosmetik "(minor)" tidak menurunkan skor. Setiap penyesuaian dicatat di `adjustments`.
 */
export function applyStrictness(raw: RawAiOutput): RawAiOutput & { adjustments: string[] } {
  const adjustments: string[] = [];
  if (!raw.photoValid || raw.score === null) return { ...raw, adjustments };
  let score = raw.score;
  const nonMinor = raw.issues.filter((i) => !/^\s*\(?minor\)?/i.test(i) && !/kondisi aus/i.test(i) && !/perlu dicek manual/i.test(i));
  const issuesText = nonMinor.join(' | ');
  const cap = (max: number, reason: string) => {
    if (score > max) {
      adjustments.push(`${reason}: skor ${score} → ${max}`);
      score = max;
    }
  };
  if (raw.coverage === 'unclear') cap(3, 'Mayoritas area tidak terlihat di foto');
  if (nonMinor.length > 0) {
    if (HEAVY_PATTERNS.some((re) => re.test(issuesText))) cap(2, 'Ada temuan berat (hama / kotoran menumpuk)');
    else cap(4, 'Masih ada temuan yang perlu dibersihkan');
  }
  return { ...raw, score, adjustments };
}

/** Analisa kebersihan satu area dengan provider aktif (settings/ai, fallback env). `override` dipakai oleh uji mandiri. */
export async function analyzeCleanliness(input: AnalyzeInput, override?: AiSettings): Promise<AiResult> {
  const s = override ?? (await loadAiSettings());
  let raw: RawAiOutput;
  if (s.provider === 'anthropic') {
    raw = await analyzeWithAnthropic(input, s.model || 'claude-opus-5');
  } else {
    const { data, model, usage } = await generateJson(
      {
        systemInstruction: SYSTEM_PROMPT,
        images: input.images.map((img, i) => ({ base64: img.base64, mediaType: img.mediaType, label: imageLabel(i, input.images.length) })),
        text: buildUserText(input),
        schema: RESPONSE_SCHEMA as unknown as Record<string, unknown>,
      },
      s,
    );
    raw = { ...normalizeCleanliness(data, model), usage };
  }
  const strict = applyStrictness(raw);
  return { ...strict, photoCount: input.images.length, analyzedAt: Date.now() };
}
