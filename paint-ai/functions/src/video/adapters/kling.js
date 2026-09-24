import { createHmac } from 'node:crypto';
import { config, secretValue } from '../../config.js';
import { ProviderError } from '../../lib/errors.js';
import { requestJson } from '../http.js';

/**
 * Kling AI adapter (official API, text-to-video).
 * POST {base}/v1/videos/text2video → data.task_id ; GET {base}/v1/videos/text2video/{id}
 * task_status: submitted | processing | succeed | failed ; output data.task_result.videos[0].url
 * Auth: API key as bearer token, or access key + secret key → HS256 JWT (iss=AK, exp=+30m, nbf=-5s).
 */
const b64url = (input) => Buffer.from(input).toString('base64url');

export function klingJwt(accessKey, secretKey, now = Math.floor(Date.now() / 1000)) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iss: accessKey, exp: now + 1800, nbf: now - 5 }));
  const signature = createHmac('sha256', secretKey).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

function authHeader() {
  const accessKey = secretValue('KLING_ACCESS_KEY');
  const secretKey = secretValue('KLING_SECRET_KEY');
  if (!accessKey) throw new ProviderError('failed-precondition', 'Kling is not configured.');
  return { authorization: `Bearer ${secretKey ? klingJwt(accessKey, secretKey) : accessKey}` };
}

function unwrap(json) {
  if (json.code !== undefined && json.code !== 0) {
    throw new ProviderError(json.code === 1102 ? 'failed-precondition' : 'invalid-argument', `Kling error ${json.code}: ${json.message ?? 'unknown error'}`);
  }
  return json.data ?? {};
}

export const kling = {
  id: 'kling',
  label: 'Kling AI',
  mode: 'clips',
  isConfigured: () => !!secretValue('KLING_ACCESS_KEY'),
  model: () => config.video.klingModel,
  clipDurations: () => [10, 5],
  maxPromptLength: 2500,

  async createJob({ prompt, duration, ratio }) {
    const data = unwrap(
      await requestJson(`${config.video.klingApiBase}/v1/videos/text2video`, {
        method: 'POST',
        headers: authHeader(),
        provider: 'Kling',
        body: {
          model_name: config.video.klingModel,
          prompt: prompt.slice(0, 2500),
          negative_prompt: 'text, subtitles, watermark, logo, distorted faces, extra fingers, blurry, low quality',
          mode: config.video.klingMode,
          aspect_ratio: ratio,
          duration: String(duration),
        },
      }),
    );
    if (!data.task_id) throw new ProviderError('unavailable', 'Kling did not return a task id.');
    return { jobId: data.task_id };
  },

  async getJob(jobId) {
    const data = unwrap(
      await requestJson(`${config.video.klingApiBase}/v1/videos/text2video/${encodeURIComponent(jobId)}`, { headers: authHeader(), provider: 'Kling' }),
    );
    switch (data.task_status) {
      case 'succeed':
        return { status: 'succeeded', videoUrl: data.task_result?.videos?.[0]?.url };
      case 'failed':
        return { status: 'failed', error: data.task_status_msg || 'Kling task failed' };
      case 'processing':
        return { status: 'running' };
      default:
        return { status: 'pending' };
    }
  },
};
