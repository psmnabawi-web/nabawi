import { secretValue } from '../../config.js';
import { ProviderError } from '../../lib/errors.js';
import { requestJson } from '../http.js';

/**
 * HeyGen adapter — API v3 (v1/v2 endpoints are retired on 2026-10-31).
 * Avatar video from the script voice-over, generated as ONE job (mode "full", no stitching).
 * POST https://api.heygen.com/v3/videos ; GET https://api.heygen.com/v3/videos/{id}
 * status: pending | processing | completed | failed ; video_url, thumbnail_url, failure_message
 */
const BASE = 'https://api.heygen.com/v3';
const MAX_SCRIPT = 5000;

const headers = () => ({ 'X-Api-Key': secretValue('HEYGEN_API_KEY') });

export const heygen = {
  id: 'heygen',
  label: 'HeyGen (avatar)',
  mode: 'full',
  isConfigured: () => !!secretValue('HEYGEN_API_KEY'),
  model: () => 'heygen-v3-avatar',
  clipDurations: () => [60],
  maxPromptLength: MAX_SCRIPT,

  async createJob({ voiceText, ratio, title, settings }) {
    const avatarId = settings?.heygenAvatarId;
    const voiceId = settings?.heygenVoiceId;
    if (!avatarId || !voiceId) {
      throw new ProviderError('failed-precondition', 'HeyGen needs an avatar ID and voice ID. Set them in Settings > AI & Integrations.');
    }
    if (!voiceText?.trim()) throw new ProviderError('invalid-argument', 'HeyGen needs a voice-over script. Select a script first.');
    const res = await requestJson(`${BASE}/videos`, {
      method: 'POST',
      headers: headers(),
      provider: 'HeyGen',
      body: {
        type: 'avatar',
        avatar_id: avatarId,
        voice_id: voiceId,
        script: voiceText.slice(0, MAX_SCRIPT),
        aspect_ratio: ratio,
        resolution: '720p',
        background: { type: 'color', value: '#F5F1E8' },
        title: title?.slice(0, 120),
      },
    });
    const jobId = res.data?.video_id ?? res.data?.id ?? res.video_id ?? res.id;
    if (!jobId) throw new ProviderError('unavailable', 'HeyGen did not return a video id.');
    return { jobId: String(jobId) };
  },

  async getJob(jobId) {
    const res = await requestJson(`${BASE}/videos/${encodeURIComponent(jobId)}`, { headers: headers(), provider: 'HeyGen' });
    const data = res.data ?? res;
    switch (data.status) {
      case 'completed':
        return { status: 'succeeded', videoUrl: data.video_url, thumbnailUrl: data.thumbnail_url };
      case 'failed':
        return { status: 'failed', error: data.failure_message || data.failure_code || 'HeyGen video failed' };
      case 'processing':
        return { status: 'running' };
      default:
        return { status: 'pending' };
    }
  },
};
