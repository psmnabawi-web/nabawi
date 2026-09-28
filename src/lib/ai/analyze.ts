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

/** Kata kunci temuan berat: jika muncul di daftar temuan, skor tidak boleh di atas 2. */
const HEAVY_PATTERNS = [/grease/i, /lemak/i, /kerak/i, /jamur/i, /sisa makanan/i, /remah/i, /sampah/i, /genangan/i, /tikus/i, /kecoa/i, /hama/i, /lendir/i, /darah/i, /debu tebal/i, /menumpuk/i, /berkarat/i, /karat/i];
/** Kata kunci residu/noda: skor tidak boleh di atas 3. */
const MEDIUM_PATTERNS = [/noda/i, /residu/i, /minyak/i, /berminyak/i, /lengket/i, /cipratan/i, /bercak/i, /kotor/i, /bekas lem/i, /selotip/i, /jelaga/i, /kusam/i];

/**
 * Pengaman ketat di sisi server, terlepas dari model:
 * - coverage bukan "full" -> maks 3
 * - ada temuan berat -> maks 2; ada temuan residu/noda -> maks 3
 * - skor 5 dengan temuan apa pun -> turun ke 4
 * Setiap penyesuaian dicatat di `adjustments` agar transparan untuk manager.
 */
export function applyStrictness(raw: RawAiOutput): RawAiOutput & { adjustments: string[] } {
  const adjustments: string[] = [];
  if (!raw.photoValid || raw.score === null) return { ...raw, adjustments };
  let score = raw.score;
  const issuesText = raw.issues.join(' | ');
  const cap = (max: number, reason: string) => {
    if (score > max) {
      adjustments.push(`${reason}: skor ${score} → ${max}`);
      score = max;
    }
  };
  if (raw.coverage !== 'full') cap(3, raw.coverage === 'partial' ? 'Foto tidak memperlihatkan seluruh area' : 'Cakupan foto tidak dapat dipastikan');
  if (raw.issues.length > 0) {
    if (HEAVY_PATTERNS.some((re) => re.test(issuesText))) cap(2, 'Ada temuan berat (grease/kerak/sisa makanan/sampah/genangan/hama)');
    else if (MEDIUM_PATTERNS.some((re) => re.test(issuesText))) cap(3, 'Ada temuan noda/residu');
    else cap(4, 'Masih ada temuan minor');
  }
  return { ...raw, score, adjustments };
}

export async function analyzeCleanliness(input: AnalyzeInput): Promise<AiResult> {
  const model = aiModel();
  const raw = aiProvider() === 'anthropic' ? await analyzeWithAnthropic(input, model) : await analyzeWithGoogle(input, model);
  const strict = applyStrictness(raw);
  return { ...strict, photoCount: input.images.length, analyzedAt: Date.now() };
}
