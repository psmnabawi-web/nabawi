import { ProviderError } from '../../lib/errors.js';

/** Parses model output as JSON, tolerating code fences or leading prose. */
export function parseJsonLoose(text) {
  if (typeof text !== 'string' || !text.trim()) throw new ProviderError('internal', 'AI returned an empty response. Please try again.');
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through */
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      /* fall through */
    }
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      /* fall through */
    }
  }
  throw new ProviderError('internal', 'AI output was not valid JSON. Please try again.');
}

/** Removes keywords some providers reject (Gemini is strict about unknown keys). */
export function toGeminiSchema(schema) {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'additionalProperties') continue;
    out[key] = toGeminiSchema(value);
  }
  return out;
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
