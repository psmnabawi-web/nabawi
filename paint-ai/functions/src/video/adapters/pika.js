import { config, secretValue } from '../../config.js';
import { ProviderError } from '../../lib/errors.js';
import { requestJson } from '../http.js';

/**
 * Pika adapter — Pika's API is served through fal.ai (queue API).
 * Submit: POST https://queue.fal.run/{endpoint} → { request_id, status_url, response_url }
 * Status: GET status_url → IN_QUEUE | IN_PROGRESS | COMPLETED ; Result: GET response_url → { video: { url } }
 * The FAL key is only ever sent to https://queue.fal.run.
 */
const QUEUE_HOST = 'queue.fal.run';

const headers = () => ({ authorization: `Key ${secretValue('FAL_KEY')}` });

function assertQueueUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new ProviderError('internal', 'Invalid fal.ai queue URL.');
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== QUEUE_HOST) throw new ProviderError('internal', 'Unexpected fal.ai queue host.');
  return parsed.toString();
}

export const pika = {
  id: 'pika',
  label: 'Pika (via fal.ai)',
  mode: 'clips',
  isConfigured: () => !!secretValue('FAL_KEY'),
  model: () => config.video.pikaFalEndpoint,
  clipDurations: () => [10, 5],
  maxPromptLength: 2000,

  async createJob({ prompt, duration, ratio }) {
    const endpoint = config.video.pikaFalEndpoint.replace(/^\/+/, '');
    const res = await requestJson(`https://${QUEUE_HOST}/${endpoint}`, {
      method: 'POST',
      headers: headers(),
      provider: 'Pika',
      body: {
        prompt: prompt.slice(0, 2000),
        aspect_ratio: ratio,
        resolution: '720p',
        duration: String(duration),
        negative_prompt: 'text, subtitles, watermark, logo, distorted faces, blurry, low quality',
      },
    });
    if (!res.request_id || !res.status_url || !res.response_url) throw new ProviderError('unavailable', 'Pika/fal.ai did not return a request id.');
    return { jobId: res.request_id, meta: { statusUrl: assertQueueUrl(res.status_url), responseUrl: assertQueueUrl(res.response_url) } };
  },

  async getJob(_jobId, meta = {}) {
    const status = await requestJson(assertQueueUrl(meta.statusUrl), { headers: headers(), provider: 'Pika' });
    if (status.status === 'IN_QUEUE') return { status: 'pending' };
    if (status.status === 'IN_PROGRESS') return { status: 'running' };
    if (status.status !== 'COMPLETED') return { status: 'pending' };
    try {
      const result = await requestJson(assertQueueUrl(meta.responseUrl), { headers: headers(), provider: 'Pika' });
      const url = result.video?.url;
      return url ? { status: 'succeeded', videoUrl: url } : { status: 'failed', error: 'Pika finished without a video.' };
    } catch (err) {
      return { status: 'failed', error: err instanceof ProviderError ? err.message : 'Pika generation failed.' };
    }
  },
};
