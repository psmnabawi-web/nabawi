import 'server-only';
import type { AiResult } from '../types';
import { analyzeWithAnthropic, ANTHROPIC_DEFAULT_MODEL } from './anthropic';
import { analyzeWithGoogle, GOOGLE_DEFAULT_MODEL } from './google';
import type { AnalyzeInput, RawAiOutput } from './prompt';

export type { AnalyzeInput } from './prompt';

/**
 * Pemilihan provider lewat env:
 *   AI_PROVIDER=google    (default) -> Gemini API (GEMINI_API_KEY, free tier) atau Vertex AI (GOOGLE_GENAI_USE_VERTEXAI=true)
 *   AI_PROVIDER=anthropic           -> Claude (ANTHROPIC_API_KEY)
 *   AI_MODEL=...                    -> override model (default gemini-3.6-flash / claude-opus-5)
 */
export function aiProvider(): 'google' | 'anthropic' {
  return (process.env.AI_PROVIDER ?? 'google').toLowerCase() === 'anthropic' ? 'anthropic' : 'google';
}

export function aiModel(): string {
  const env = process.env.AI_MODEL?.trim();
  if (env) return env;
  return aiProvider() === 'anthropic' ? ANTHROPIC_DEFAULT_MODEL : GOOGLE_DEFAULT_MODEL;
}

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

export async function analyzeCleanliness(input: AnalyzeInput): Promise<AiResult> {
  const model = aiModel();
  const raw = aiProvider() === 'anthropic' ? await analyzeWithAnthropic(input, model) : await analyzeWithGoogle(input, model);
  const strict = applyStrictness(raw);
  return { ...strict, photoCount: input.images.length, analyzedAt: Date.now() };
}
