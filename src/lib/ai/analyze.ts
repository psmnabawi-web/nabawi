import 'server-only';
import type { AiResult } from '../types';
import { analyzeWithAnthropic, ANTHROPIC_DEFAULT_MODEL } from './anthropic';
import { analyzeWithGoogle, GOOGLE_DEFAULT_MODEL } from './google';
import type { AnalyzeInput } from './prompt';

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

export async function analyzeCleanliness(input: AnalyzeInput): Promise<AiResult> {
  const model = aiModel();
  const raw = aiProvider() === 'anthropic' ? await analyzeWithAnthropic(input, model) : await analyzeWithGoogle(input, model);
  return { ...raw, analyzedAt: Date.now() };
}
