import Anthropic from '@anthropic-ai/sdk';
import { config, secretValue } from '../../config.js';
import { ProviderError } from '../../lib/errors.js';
import { parseJsonLoose } from './json.js';

/**
 * Anthropic Claude provider (Messages API + structured outputs via output_config.format).
 * Secret: ANTHROPIC_API_KEY. Model: CLAUDE_MODEL (default claude-opus-5).
 * Server-side refusal fallbacks ("default" routing) are enabled for models that support them.
 */
const FALLBACK_MODELS = new Set(['claude-opus-5', 'claude-opus-5-5', 'claude-fable-5', 'claude-fable-5-1']);

let client = null;
let clientKey = '';

function getClient() {
  const apiKey = secretValue('ANTHROPIC_API_KEY');
  if (!apiKey) throw new ProviderError('failed-precondition', 'Claude is not configured. Set the ANTHROPIC_API_KEY secret.');
  if (!client || clientKey !== apiKey) {
    client = new Anthropic({ apiKey, maxRetries: 2, timeout: 300_000 });
    clientKey = apiKey;
  }
  return client;
}

export const claude = {
  id: 'claude',
  label: 'Anthropic Claude',
  isConfigured: () => !!secretValue('ANTHROPIC_API_KEY'),
  model: () => config.ai.claudeModel,

  async generate({ system, prompt, schema, maxOutputTokens = 16384 }) {
    const api = getClient();
    const model = config.ai.claudeModel;
    const params = {
      model,
      max_tokens: Math.max(maxOutputTokens, 16000),
      system,
      messages: [{ role: 'user', content: prompt }],
      output_config: { format: { type: 'json_schema', schema } },
    };
    if (FALLBACK_MODELS.has(model)) {
      params.betas = ['server-side-fallback-2026-07-01'];
      params.fallbacks = 'default';
    }

    let message;
    try {
      // Streaming avoids HTTP timeouts on long generations (e.g. 20 content ideas).
      message = await api.beta.messages.stream(params).finalMessage();
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) throw new ProviderError('resource-exhausted', 'Claude rate limit reached. Try again shortly.');
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
        throw new ProviderError('failed-precondition', 'Claude credentials are invalid.');
      }
      if (err instanceof Anthropic.NotFoundError) throw new ProviderError('failed-precondition', `Claude model "${model}" was not found. Check CLAUDE_MODEL.`);
      if (err instanceof Anthropic.BadRequestError) throw new ProviderError('invalid-argument', `Claude rejected the request: ${err.message}`);
      if (err instanceof Anthropic.APIConnectionError) throw new ProviderError('unavailable', 'Cannot reach Claude. Please try again.');
      if (err instanceof Anthropic.APIError) throw new ProviderError('unavailable', `Claude service error (${err.status ?? 'unknown'}). Please try again.`);
      throw err;
    }

    if (message.stop_reason === 'refusal') {
      throw new ProviderError('failed-precondition', 'Claude declined this request. Rephrase the input and try again.');
    }
    if (message.stop_reason === 'max_tokens') {
      throw new ProviderError('resource-exhausted', 'AI output was cut off (token limit). Reduce the number of ideas or try again.');
    }
    const text = message.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');

    return {
      data: parseJsonLoose(text),
      model: message.model ?? model,
      usage: { inputTokens: message.usage?.input_tokens ?? 0, outputTokens: message.usage?.output_tokens ?? 0 },
    };
  },
};
