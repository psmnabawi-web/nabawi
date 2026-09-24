import OpenAI from 'openai';
import { config, secretValue } from '../../config.js';
import { ProviderError } from '../../lib/errors.js';
import { parseJsonLoose } from './json.js';

/** OpenAI provider (Responses API + Structured Outputs). Secret: OPENAI_API_KEY. */
let client = null;
let clientKey = '';

function getClient() {
  const apiKey = secretValue('OPENAI_API_KEY');
  if (!apiKey) throw new ProviderError('failed-precondition', 'OpenAI is not configured. Set the OPENAI_API_KEY secret.');
  if (!client || clientKey !== apiKey) {
    client = new OpenAI({ apiKey, maxRetries: 2, timeout: 240_000 });
    clientKey = apiKey;
  }
  return client;
}

export const openai = {
  id: 'openai',
  label: 'OpenAI',
  isConfigured: () => !!secretValue('OPENAI_API_KEY'),
  model: () => config.ai.openaiModel,

  async generate({ system, prompt, schema, schemaName, maxOutputTokens = 16384 }) {
    const api = getClient();
    const model = config.ai.openaiModel;
    let response;
    try {
      response = await api.responses.create({
        model,
        instructions: system,
        input: prompt,
        max_output_tokens: maxOutputTokens, // includes reasoning tokens
        text: { format: { type: 'json_schema', name: schemaName, schema, strict: true } },
      });
    } catch (err) {
      if (err instanceof OpenAI.RateLimitError) throw new ProviderError('resource-exhausted', 'OpenAI rate limit or quota reached. Try again shortly.');
      if (err instanceof OpenAI.AuthenticationError || err instanceof OpenAI.PermissionDeniedError) {
        throw new ProviderError('failed-precondition', 'OpenAI credentials are invalid.');
      }
      if (err instanceof OpenAI.NotFoundError) throw new ProviderError('failed-precondition', `OpenAI model "${model}" was not found. Check OPENAI_MODEL.`);
      if (err instanceof OpenAI.BadRequestError) throw new ProviderError('invalid-argument', `OpenAI rejected the request: ${err.message}`);
      if (err instanceof OpenAI.APIConnectionError) throw new ProviderError('unavailable', 'Cannot reach OpenAI. Please try again.');
      if (err instanceof OpenAI.APIError) throw new ProviderError('unavailable', `OpenAI service error (${err.status ?? 'unknown'}). Please try again.`);
      throw err;
    }

    if (response.status === 'incomplete') {
      const reason = response.incomplete_details?.reason ?? 'unknown';
      if (reason === 'max_output_tokens') throw new ProviderError('resource-exhausted', 'AI output was cut off (token limit). Reduce the number of ideas or try again.');
      throw new ProviderError('failed-precondition', `OpenAI did not complete the response (${reason}).`);
    }
    const refusal = response.output
      ?.flatMap((item) => (item.type === 'message' ? item.content : []))
      .find((c) => c.type === 'refusal');
    if (refusal) throw new ProviderError('failed-precondition', `OpenAI declined the request: ${refusal.refusal}`);

    return {
      data: parseJsonLoose(response.output_text),
      model: response.model ?? model,
      usage: { inputTokens: response.usage?.input_tokens ?? 0, outputTokens: response.usage?.output_tokens ?? 0 },
    };
  },
};
