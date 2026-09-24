import { logger } from 'firebase-functions';
import { ProviderError } from '../../lib/errors.js';
import { getAppSettings } from '../../lib/settings.js';
import { claude } from './claude.js';
import { gemini } from './gemini.js';
import { mock } from './mock.js';
import { openai } from './openai.js';

export const TEXT_PROVIDER_REGISTRY = { gemini, openai, claude, mock };

/** Status for Settings > AI & Integrations (never exposes key values). */
export function textProviderStatus() {
  return Object.values(TEXT_PROVIDER_REGISTRY).map((p) => ({ id: p.id, label: p.label, configured: p.isConfigured(), model: p.model() }));
}

/**
 * Generates structured JSON with the selected provider.
 * Provider precedence: explicit request → Settings (settings/app.textProvider) → AI_PROVIDER env.
 * @returns {Promise<{data: any, provider: string, model: string, usage: {inputTokens: number, outputTokens: number}, latencyMs: number}>}
 */
export async function generateStructured(request) {
  const settings = await getAppSettings();
  const providerId = request.provider ?? settings.textProvider;
  const provider = TEXT_PROVIDER_REGISTRY[providerId];
  if (!provider) throw new ProviderError('invalid-argument', `Unknown AI provider "${providerId}".`);
  if (!provider.isConfigured()) {
    throw new ProviderError('failed-precondition', `${provider.label} is not configured yet. Ask the super admin to add its API key, or choose another provider.`);
  }
  const started = Date.now();
  const result = await provider.generate(request);
  const latencyMs = Date.now() - started;
  logger.info('ai.generate', { task: request.schemaName, provider: provider.id, model: result.model, latencyMs, ...result.usage });
  return { ...result, provider: provider.id, latencyMs };
}
