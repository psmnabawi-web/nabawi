import { ApiError, GoogleGenAI } from '@google/genai';
import { logger } from 'firebase-functions';
import { config, secretValue } from '../../config.js';
import { ProviderError } from '../../lib/errors.js';
import { parseJsonLoose, sleep, toGeminiSchema } from './json.js';

/**
 * Google Gemini provider.
 * - Gemini Developer API: secret GEMINI_API_KEY.
 * - Vertex AI: GOOGLE_GENAI_USE_VERTEXAI=true (uses the Functions service account; grant "Vertex AI User").
 */
let client = null;
let clientKey = '';

function getClient() {
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

export const gemini = {
  id: 'gemini',
  label: 'Google Gemini',
  isConfigured: () => config.ai.geminiUseVertex || !!secretValue('GEMINI_API_KEY'),
  model: () => config.ai.geminiModel,

  async generate({ system, prompt, schema, maxOutputTokens = 16384 }) {
    const ai = getClient();
    const model = config.ai.geminiModel;
    const request = {
      model,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        systemInstruction: system,
        responseMimeType: 'application/json',
        responseJsonSchema: toGeminiSchema(schema),
        maxOutputTokens, // includes thinking tokens on Gemini 3.x
      },
    };

    const retryDelays = [4_000, 12_000];
    for (let attempt = 0; ; attempt += 1) {
      try {
        const response = await ai.models.generateContent(request);
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
      } catch (err) {
        if (err instanceof ProviderError) throw err;
        if (err instanceof ApiError) {
          const status = err.status ?? 0;
          if ((status === 429 || status >= 500) && attempt < retryDelays.length) {
            logger.warn('gemini retry', { status, attempt });
            await sleep(retryDelays[attempt]);
            continue;
          }
          if (status === 429) throw new ProviderError('resource-exhausted', 'Gemini rate limit or quota reached. Wait a minute and try again.');
          if (status === 401 || status === 403) throw new ProviderError('failed-precondition', 'Gemini credentials are invalid or the API is not enabled.');
          if (status === 404) throw new ProviderError('failed-precondition', `Gemini model "${model}" was not found. Check GEMINI_MODEL.`);
          if (status === 400) throw new ProviderError('invalid-argument', `Gemini rejected the request: ${err.message}`);
          throw new ProviderError('unavailable', `Gemini service error (${status}). Please try again.`);
        }
        throw err;
      }
    }
  },
};
