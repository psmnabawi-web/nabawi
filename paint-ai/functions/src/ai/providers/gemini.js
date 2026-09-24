import { ApiError, GoogleGenAI } from '@google/genai';
import { logger } from 'firebase-functions';
import { config, secretValue } from '../../config.js';
import { ProviderError } from '../../lib/errors.js';
import { parseJsonLoose, sleep, toGeminiSchema } from './json.js';

/**
 * Google Gemini provider.
 * - Gemini Developer API: secret GEMINI_API_KEY.
 * - Vertex AI: GOOGLE_GENAI_USE_VERTEXAI=true (uses the Functions service account; grant "Vertex AI User").
 *
 * Resilience: transient errors (429/500/503/504 — e.g. "model overloaded") are retried with backoff on
 * GEMINI_MODEL, then the request falls back to GEMINI_FALLBACK_MODEL (also used when the primary model
 * is not found).
 */
const PRIMARY_RETRY_DELAYS_MS = [3_000, 8_000, 20_000];
const FALLBACK_RETRY_DELAYS_MS = [5_000];
const TRANSIENT = new Set([429, 500, 503, 504]);

let client = null;
let clientKey = '';
let sleepFn = sleep;

/** Test seam: inject a fake client / instant sleep. */
export function __setGeminiTestHooks({ client: fakeClient, sleep: fakeSleep } = {}) {
  if (fakeClient) {
    client = fakeClient;
    clientKey = '__test__';
  } else {
    client = null;
    clientKey = '';
  }
  sleepFn = fakeSleep ?? sleep;
}

function getClient() {
  if (clientKey === '__test__') return client;
  if (config.ai.geminiUseVertex) {
    if (!client || clientKey !== 'vertex') {
      if (!config.ai.googleCloudProject) throw new ProviderError('failed-precondition', 'GOOGLE_CLOUD_PROJECT is not set for Vertex AI.');
      client = new GoogleGenAI({ vertexai: true, project: config.ai.googleCloudProject, location: config.ai.googleCloudLocation });
      clientKey = 'vertex';
    }
    return client;
  }
  const apiKey = secretValue('GEMINI_API_KEY');
  if (!apiKey) throw new ProviderError('failed-precondition', 'Gemini is not configured. Set the GEMINI_API_KEY secret or enable Vertex AI.');
  if (!client || clientKey !== apiKey) {
    client = new GoogleGenAI({ apiKey });
    clientKey = apiKey;
  }
  return client;
}

/** Calls one model, retrying transient API errors. Throws the last ApiError when retries run out. */
async function callWithRetry(ai, request, delays) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await ai.models.generateContent(request);
    } catch (err) {
      const status = err instanceof ApiError ? (err.status ?? 0) : 0;
      if (TRANSIENT.has(status) && attempt < delays.length) {
        logger.warn('gemini retry', { model: request.model, status, attempt: attempt + 1 });
        await sleepFn(delays[attempt]);
        continue;
      }
      throw err;
    }
  }
}

function toProviderError(err, model) {
  if (err instanceof ProviderError) return err;
  if (!(err instanceof ApiError)) return err;
  const status = err.status ?? 0;
  const msg = err.message ?? '';
  if (status === 429 && /credit|billing|prepayment|payment/i.test(msg)) {
    return new ProviderError('failed-precondition', 'Gemini API credit/billing is not active for this key. Check https://aistudio.google.com.');
  }
  if (status === 429) return new ProviderError('resource-exhausted', 'Gemini rate limit or daily quota reached. Wait a minute and try again.');
  if (status === 503 || status === 500 || status === 504) {
    return new ProviderError('unavailable', 'Gemini is overloaded right now. The request was retried automatically (also on the fallback model). Please try again in 1–2 minutes, or generate fewer ideas.');
  }
  if (status === 401 || status === 403) return new ProviderError('failed-precondition', 'Gemini credentials are invalid or the API is not enabled.');
  if (status === 404) return new ProviderError('failed-precondition', `Gemini model "${model}" was not found. Check GEMINI_MODEL / GEMINI_FALLBACK_MODEL.`);
  if (status === 400) return new ProviderError('invalid-argument', `Gemini rejected the request: ${msg}`);
  return new ProviderError('unavailable', `Gemini service error (${status}). Please try again.`);
}

function parseResponse(response, model) {
  const blockReason = response.promptFeedback?.blockReason;
  if (blockReason) throw new ProviderError('failed-precondition', `Gemini blocked the request (${blockReason}). Rephrase the input and try again.`);
  const finish = response.candidates?.[0]?.finishReason;
  if (finish === 'MAX_TOKENS') throw new ProviderError('resource-exhausted', 'AI output was cut off (token limit). Reduce the number of ideas or try again.');
  if (finish && finish !== 'STOP') throw new ProviderError('failed-precondition', `Gemini stopped generating (${finish}). Try again with a different input.`);
  const data = parseJsonLoose(response.text);
  const usage = response.usageMetadata ?? {};
  return {
    data,
    model: response.modelVersion ?? model,
    usage: { inputTokens: usage.promptTokenCount ?? 0, outputTokens: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0) },
  };
}

export const gemini = {
  id: 'gemini',
  label: 'Google Gemini',
  isConfigured: () => config.ai.geminiUseVertex || !!secretValue('GEMINI_API_KEY'),
  model: () => config.ai.geminiModel,

  async generate({ system, prompt, schema, maxOutputTokens = 16384 }) {
    const ai = getClient();
    const models = [...new Set([config.ai.geminiModel, config.ai.geminiFallbackModel].filter(Boolean))];
    const baseConfig = {
      systemInstruction: system,
      responseMimeType: 'application/json',
      responseJsonSchema: toGeminiSchema(schema),
      maxOutputTokens, // includes thinking tokens on Gemini 3.x
    };

    let lastError = null;
    for (let i = 0; i < models.length; i += 1) {
      const model = models[i];
      const hasNext = i < models.length - 1;
      try {
        const response = await callWithRetry(ai, { model, contents: [{ role: 'user', parts: [{ text: prompt }] }], config: baseConfig }, i === 0 ? PRIMARY_RETRY_DELAYS_MS : FALLBACK_RETRY_DELAYS_MS);
        return parseResponse(response, model);
      } catch (err) {
        const status = err instanceof ApiError ? (err.status ?? 0) : 0;
        if (hasNext && (TRANSIENT.has(status) || status === 404)) {
          logger.warn('gemini falling back to next model', { from: model, to: models[i + 1], status });
          lastError = err;
          continue;
        }
        throw toProviderError(err, model);
      }
    }
    throw toProviderError(lastError, models[models.length - 1]);
  },
};
