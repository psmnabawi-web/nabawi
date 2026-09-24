import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';

/** Thin wrapper around the static ffmpeg binary bundled with the function. */
export function runFfmpeg(args, { timeoutMs = 480_000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      reject(new Error('ffmpeg binary not available'));
      return;
    }
    const child = spawn(ffmpegPath, ['-hide_banner', '-nostdin', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stderr });
    });
  });
}

async function mustRun(args, label) {
  const { code, stderr } = await runFfmpeg(args);
  if (code !== 0) throw new Error(`ffmpeg ${label} failed (${code}): ${stderr.split('\n').slice(-6).join(' | ')}`);
  return stderr;
}

/** Reads duration (seconds) and whether the file has an audio stream. */
export async function probe(file) {
  const { stderr } = await runFfmpeg(['-i', file]);
  const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const duration = m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
  const hasVideo = /Stream #\d+:\d+(?:\[[^\]]*\])?(?:\([^)]*\))?: Video:/.test(stderr);
  const hasAudio = /Stream #\d+:\d+(?:\[[^\]]*\])?(?:\([^)]*\))?: Audio:/.test(stderr);
  return { duration, hasVideo, hasAudio };
}

/**
 * Builds the ffmpeg arguments that normalise every clip to the target resolution/fps and concatenates
 * them (re-encode, robust to clips with different codecs/sizes). Clips without audio get silence when
 * at least one clip has audio.
 */
export function buildStitchArgs(inputs, output, { width, height, fps = 30 }) {
  const withAudio = inputs.some((i) => i.hasAudio);
  const args = ['-y'];
  for (const input of inputs) args.push('-i', input.path);
  const filters = [];
  const labels = [];
  inputs.forEach((input, i) => {
    const dur = Math.max(0.5, Number(input.duration) || 0).toFixed(3);
    filters.push(
      `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${fps},format=yuv420p,trim=0:${dur},setpts=PTS-STARTPTS[v${i}]`,
    );
    labels.push(`[v${i}]`);
    if (withAudio) {
      if (input.hasAudio) {
        filters.push(`[${i}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=0:${dur},asetpts=PTS-STARTPTS[a${i}]`);
      } else {
        filters.push(`anullsrc=channel_layout=stereo:sample_rate=44100,atrim=0:${dur},asetpts=PTS-STARTPTS[a${i}]`);
      }
      labels.push(`[a${i}]`);
    }
  });
  filters.push(`${labels.join('')}concat=n=${inputs.length}:v=1:a=${withAudio ? 1 : 0}[outv]${withAudio ? '[outa]' : ''}`);
  args.push('-filter_complex', filters.join(';'), '-map', '[outv]');
  if (withAudio) args.push('-map', '[outa]', '-c:a', 'aac', '-b:a', '128k');
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output);
  return args;
}

export async function stitchClips(inputs, output, dims) {
  await mustRun(buildStitchArgs(inputs, output, dims), 'stitch');
  return probe(output);
}

/** Re-muxes a single clip for progressive playback (moov atom first) without re-encoding. */
export async function faststart(input, output) {
  await mustRun(['-y', '-i', input, '-c', 'copy', '-movflags', '+faststart', output], 'faststart');
  return probe(output);
}

export async function extractThumbnail(input, output, atSeconds = 1) {
  await mustRun(['-y', '-ss', String(atSeconds), '-i', input, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '4', output], 'thumbnail');
}

const MOCK_PALETTES = [
  ['0x0f2a5c', '0xe8dcc8'],
  ['0x1e3a8a', '0xd6b98c'],
  ['0x334155', '0xf5f1e8'],
  ['0x14532d', '0xe7e5e4'],
  ['0x7c2d12', '0xfde68a'],
];

/** Generates a placeholder clip (animated paint-colour gradient) for the offline "mock" video provider. */
export async function generateMockClip(output, { duration, width, height, index = 0 }) {
  const [c0, c1] = MOCK_PALETTES[index % MOCK_PALETTES.length];
  await mustRun(
    [
      '-y',
      '-f', 'lavfi',
      '-i', `gradients=s=${width}x${height}:d=${duration}:r=30:c0=${c0}:c1=${c1}:n=2:speed=0.02`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p',
      output,
    ],
    'mock clip',
  );
}
