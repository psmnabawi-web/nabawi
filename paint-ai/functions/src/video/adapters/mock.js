import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RATIO_RESOLUTION } from '../../lib/constants.js';
import { bucket } from '../../lib/firebase.js';
import { generateMockClip } from '../ffmpeg.js';

/**
 * Offline demo provider: renders a placeholder gradient clip with ffmpeg and stores it in
 * Firebase Storage. Lets the whole video workflow run in the emulator / demo without paid APIs.
 */
export const mockVideo = {
  id: 'mock',
  label: 'Demo renderer (offline)',
  mode: 'clips',
  isConfigured: () => true,
  model: () => 'mock-gradient',
  clipDurations: () => [10, 5],
  maxPromptLength: 2000,

  async createJob({ duration, ratio, videoId, index }) {
    const { width, height } = RATIO_RESOLUTION[ratio] ?? RATIO_RESOLUTION['9:16'];
    const dir = await mkdtemp(path.join(tmpdir(), 'mock-clip-'));
    const file = path.join(dir, 'clip.mp4');
    try {
      await generateMockClip(file, { duration, width: width / 2, height: height / 2, index });
      const storagePath = `videos/${videoId}/segments/${index}.mp4`;
      await bucket().upload(file, { destination: storagePath, metadata: { contentType: 'video/mp4' } });
      return { jobId: `mock-${videoId}-${index}`, meta: { storagePath } };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },

  async getJob(_jobId, meta = {}) {
    return meta.storagePath ? { status: 'succeeded', storagePath: meta.storagePath } : { status: 'failed', error: 'Mock clip missing' };
  },
};
