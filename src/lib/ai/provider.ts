import 'server-only';
import { loadAiSettings } from '../server/aiSettings';
import type { AiSettings } from '../types';
import { HttpError } from '../utils';
import { generateJsonWithGoogle } from './google';
import { generateJsonWithOpenAI } from './openaiCompat';
import { setMaxConcurrent, type JsonRequest, type JsonResult } from './shared';

/** Dispatcher provider: google (Gemini/Gemma/Vertex) atau openai (OpenAI-compatible: Qwen, OpenRouter, Groq). Anthropic ditangani terpisah. */
export async function generateJson(req: JsonRequest, override?: AiSettings): Promise<JsonResult & { provider: AiSettings['provider'] }> {
  const s = override ?? (await loadAiSettings());
  setMaxConcurrent(s.maxConcurrent);
  if (s.provider === 'openai') return { ...(await generateJsonWithOpenAI(req, s)), provider: 'openai' };
  if (s.provider === 'google') return { ...(await generateJsonWithGoogle(req, s)), provider: 'google' };
  throw new HttpError(500, 'Provider anthropic tidak mendukung permintaan ini.');
}
