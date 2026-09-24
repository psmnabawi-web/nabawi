import { ProviderError } from '../lib/errors.js';

/**
 * JSON HTTP helper for video provider REST APIs. Maps HTTP failures to ProviderError codes and
 * never includes request headers (API keys) in error messages.
 */
export async function requestJson(url, { method = 'GET', headers = {}, body, timeoutMs = 60_000, provider = 'provider' } = {}) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { accept: 'application/json', ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new ProviderError('unavailable', `Cannot reach ${provider} (${err?.name === 'TimeoutError' ? 'timeout' : 'network error'}).`);
  }
  const raw = await res.text();
  let json = null;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const detail = extractMessage(json) ?? raw.slice(0, 300);
    throw new ProviderError(statusToCode(res.status), `${provider} error ${res.status}: ${detail || res.statusText}`, { status: res.status });
  }
  return json ?? {};
}

export function statusToCode(status) {
  if (status === 401 || status === 403) return 'failed-precondition';
  if (status === 402) return 'failed-precondition';
  if (status === 404) return 'not-found';
  if (status === 429) return 'resource-exhausted';
  if (status === 400 || status === 422) return 'invalid-argument';
  return 'unavailable';
}

function extractMessage(json) {
  if (!json || typeof json !== 'object') return null;
  const candidates = [json.error?.message, json.error, json.message, json.detail, json.failure, json.msg];
  for (const c of candidates) {
    if (typeof c === 'string' && c) return c.slice(0, 300);
    if (Array.isArray(c) && c.length) return JSON.stringify(c).slice(0, 300);
  }
  return null;
}
