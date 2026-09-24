import { heygen } from './heygen.js';
import { kling } from './kling.js';
import { mockVideo } from './mock.js';
import { pika } from './pika.js';
import { runway } from './runway.js';
import { veo } from './veo.js';

/**
 * Video provider adapters. Each adapter implements:
 *   id, label, mode ('clips' = N short clips stitched with ffmpeg | 'full' = one job for the whole video),
 *   isConfigured(), model(), clipDurations(), maxPromptLength,
 *   createJob({ prompt, duration, ratio, style, voiceText, title, videoId, index, settings }) → { jobId, meta? }
 *   getJob(jobId, meta) → { status: 'pending'|'running'|'succeeded'|'failed', videoUrl?, storagePath?, thumbnailUrl?, error?, progress? }
 */
export const VIDEO_ADAPTERS = { veo, runway, kling, pika, heygen, mock: mockVideo };

export function videoProviderStatus() {
  return Object.values(VIDEO_ADAPTERS).map((a) => ({ id: a.id, label: a.label, configured: a.isConfigured(), model: a.model(), mode: a.mode }));
}
