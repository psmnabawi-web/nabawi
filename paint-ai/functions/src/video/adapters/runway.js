import { config, secretValue } from '../../config.js';
import { ProviderError } from '../../lib/errors.js';
import { requestJson } from '../http.js';

/**
 * Runway API adapter (text-to-video).
 * Docs: https://docs.dev.runwayml.com — POST /v1/text_to_video, GET /v1/tasks/{id}, X-Runway-Version 2024-11-06.
 * gen4.5: duration 2-10 s, ratio 720:1280 / 1280:720. veo3.1*: duration 4/6/8 s.
 * Output URLs expire (24-48 h) → the pipeline copies the file to Firebase Storage.
 */
const BASE = 'https://api.dev.runwayml.com/v1';
const RATIOS = { '9:16': '720:1280', '16:9': '1280:720' };

const headers = () => ({
  authorization: `Bearer ${secretValue('RUNWAY_API_KEY')}`,
  'X-Runway-Version': '2024-11-06',
});

export const runway = {
  id: 'runway',
  label: 'Runway',
  mode: 'clips',
  isConfigured: () => !!secretValue('RUNWAY_API_KEY'),
  model: () => config.video.runwayModel,
  clipDurations: () => (config.video.runwayModel.startsWith('veo') ? [8, 6, 4] : [10, 5]),
  maxPromptLength: 1000,

  async createJob({ prompt, duration, ratio }) {
    const runwayRatio = RATIOS[ratio];
    if (!runwayRatio) throw new ProviderError('invalid-argument', `Runway text-to-video does not support ratio ${ratio}.`);
    const task = await requestJson(`${BASE}/text_to_video`, {
      method: 'POST',
      headers: headers(),
      provider: 'Runway',
      body: { model: config.video.runwayModel, promptText: prompt.slice(0, 1000), ratio: runwayRatio, duration },
    });
    if (!task.id) throw new ProviderError('unavailable', 'Runway did not return a task id.');
    return { jobId: task.id };
  },

  async getJob(jobId) {
    const task = await requestJson(`${BASE}/tasks/${encodeURIComponent(jobId)}`, { headers: headers(), provider: 'Runway' });
    switch (task.status) {
      case 'SUCCEEDED':
        return { status: 'succeeded', videoUrl: Array.isArray(task.output) ? task.output[0] : undefined };
      case 'FAILED':
      case 'CANCELLED':
        return { status: 'failed', error: task.failure || task.failureCode || `Runway task ${task.status.toLowerCase()}` };
      case 'RUNNING':
        return { status: 'running', progress: typeof task.progress === 'number' ? task.progress : undefined };
      default:
        return { status: 'pending' };
    }
  },
};
