import { ApiError, GenerateVideosOperation, GoogleGenAI } from '@google/genai';
import { config } from '../../config.js';
import { ProviderError } from '../../lib/errors.js';
import { bucket } from '../../lib/firebase.js';

/**
 * Google Veo adapter (Vertex AI) — default model veo-3.1-lite-generate-001.
 * No API key: authenticates with the Cloud Functions service account and bills the Firebase project
 * (Google Cloud free-trial credits apply). Needs the Vertex AI API enabled on the project.
 *
 * Submit: models.generateVideos → long-running operation (name stored as jobId).
 * Poll:   operations.getVideosOperation → done + response.generatedVideos[0].video
 *         (videoBytes base64 when no output bucket is set, or a gs:// uri).
 * Clips are 4/6/8 s (1080p: 8 s only), ratio 9:16 or 16:9.
 */
const RATIOS = new Set(['9:16', '16:9']);
const NEGATIVE_PROMPT = 'text, subtitles, captions, watermark, logo, distorted faces, extra fingers, blurry, low quality';

let client = null;
let clientKey = '';
let storageBucket = bucket;

/** Test seam: inject a fake client / Storage bucket. */
export function __setVeoTestHooks({ client: fakeClient, bucket: fakeBucket } = {}) {
  client = fakeClient ?? null;
  clientKey = fakeClient ? '__test__' : '';
  storageBucket = fakeBucket ?? bucket;
}

function getClient() {
  if (clientKey === '__test__') return client;
  const project = config.ai.googleCloudProject;
  const location = config.video.veoLocation;
  if (!project) throw new ProviderError('failed-precondition', 'Google Cloud project id is not available for Vertex AI (set GOOGLE_CLOUD_PROJECT).');
  const key = `${project}/${location}`;
  if (!client || clientKey !== key) {
    client = new GoogleGenAI({ vertexai: true, project, location });
    clientKey = key;
  }
  return client;
}

const enableApiUrl = () =>
  `https://console.cloud.google.com/flows/enableapi?apiid=aiplatform.googleapis.com${config.ai.googleCloudProject ? `&project=${config.ai.googleCloudProject}` : ''}`;

function toProviderError(err) {
  if (err instanceof ProviderError) return err;
  if (!(err instanceof ApiError)) return new ProviderError('unavailable', `Veo request failed: ${err?.message ?? 'unknown error'}`);
  const status = err.status ?? 0;
  const msg = err.message ?? '';
  if (status === 403 && /SERVICE_DISABLED|has not been used|is disabled/i.test(msg)) {
    return new ProviderError('failed-precondition', `Vertex AI API is not enabled. Enable it: ${enableApiUrl()} then retry.`);
  }
  if (status === 401 || status === 403) {
    return new ProviderError('failed-precondition', 'Permission denied on Vertex AI. Grant the "Vertex AI User" role to the Cloud Functions service account (IAM), then retry.');
  }
  if (status === 404) {
    return new ProviderError('failed-precondition', `Veo model "${config.video.veoModel}" is not available in ${config.video.veoLocation}. Check VEO_MODEL / VEO_LOCATION.`);
  }
  if (status === 429) return new ProviderError('resource-exhausted', 'Veo quota reached (requests per minute). Wait a minute and retry.');
  if (status === 400) return new ProviderError('invalid-argument', `Veo rejected the request: ${msg}`);
  return new ProviderError('unavailable', `Veo service error (${status}). Please retry.`);
}

export const veo = {
  id: 'veo',
  label: 'Google Veo (Vertex AI)',
  mode: 'clips',
  isConfigured: () => config.video.veoEnabled && !!config.ai.googleCloudProject,
  model: () => config.video.veoModel,
  clipDurations: () => (config.video.veoResolution === '1080p' ? [8] : [8, 6, 4]),
  maxPromptLength: 2000,

  async createJob({ prompt, duration, ratio, videoId, index }) {
    if (!RATIOS.has(ratio)) throw new ProviderError('invalid-argument', `Veo does not support ratio ${ratio}.`);
    let operation;
    try {
      operation = await getClient().models.generateVideos({
        model: config.video.veoModel,
        source: { prompt: prompt.slice(0, 2000) },
        config: {
          numberOfVideos: 1,
          durationSeconds: duration,
          aspectRatio: ratio,
          resolution: config.video.veoResolution,
          generateAudio: config.video.veoGenerateAudio,
          negativePrompt: NEGATIVE_PROMPT,
        },
      });
    } catch (err) {
      throw toProviderError(err);
    }
    if (!operation?.name) throw new ProviderError('unavailable', 'Veo did not return an operation id.');
    return { jobId: operation.name, meta: { storagePath: `videos/${videoId}/segments/${index}.mp4` } };
  },

  async getJob(jobId, meta = {}) {
    const pending = new GenerateVideosOperation();
    pending.name = jobId;
    let operation;
    try {
      operation = await getClient().operations.getVideosOperation({ operation: pending });
    } catch (err) {
      throw toProviderError(err);
    }
    if (!operation?.done) return { status: 'running' };
    if (operation.error) {
      return { status: 'failed', error: `Veo: ${operation.error.message ?? JSON.stringify(operation.error).slice(0, 300)}` };
    }
    const response = operation.response ?? {};
    const video = response.generatedVideos?.[0]?.video;
    if (!video?.videoBytes && !video?.uri) {
      const reasons = (response.raiMediaFilteredReasons ?? []).join('; ');
      return {
        status: 'failed',
        error: response.raiMediaFilteredCount ? `Veo safety filter blocked this clip${reasons ? `: ${reasons}` : ''}. Adjust the script/brief and retry.` : 'Veo finished without a video.',
      };
    }
    const storagePath = meta.storagePath;
    if (!storagePath) return { status: 'failed', error: 'Veo clip has no storage destination.' };

    if (video.videoBytes) {
      await storageBucket()
        .file(storagePath)
        .save(Buffer.from(video.videoBytes, 'base64'), { resumable: false, metadata: { contentType: video.mimeType || 'video/mp4' } });
      return { status: 'succeeded', storagePath };
    }
    const match = /^gs:\/\/([^/]+)\/(.+)$/.exec(video.uri);
    if (!match) return { status: 'failed', error: 'Veo returned an unsupported video location.' };
    const [, sourceBucket, sourcePath] = match;
    if (sourceBucket === storageBucket().name) return { status: 'succeeded', storagePath: sourcePath };
    await storageBucket(sourceBucket).file(sourcePath).copy(storageBucket().file(storagePath));
    return { status: 'succeeded', storagePath };
  },
};
