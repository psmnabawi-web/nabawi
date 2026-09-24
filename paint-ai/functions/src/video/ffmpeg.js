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

const round3 = (n) => Math.round(n * 1000) / 1000;

/**
 * Builds a single-pass ffmpeg command that:
 *   1. normalises every clip (fill-crop to the target size, fps, yuv420p) and joins them with short
 *      cross-fade transitions (xfade / acrossfade),
 *   2. optionally writes that joined video as a "clean" output (no branding),
 *   3. composites transparent PNG overlays (logo, hook, captions…) in their time windows,
 *   4. optionally cross-fades into an end card image.
 * Clips without audio get silence when at least one clip has audio; when none has audio the outputs get a
 * silent AAC track (Instagram Reels publishing expects an audio stream).
 *
 * @param {{
 *   clips: {path:string, duration:number, hasAudio?:boolean}[],
 *   dims: {width:number, height:number}, fps?: number,
 *   transition?: number, transitions?: string[],
 *   overlays?: {path:string, x?:number, y?:number, start:number, end:number, fade?:boolean}[],
 *   endCard?: {path:string, duration:number} | null,
 *   output: string, cleanOutput?: string | null,
 * }} opts
 */
export function buildComposeArgs({ clips, dims, fps = 30, transition = 0.35, transitions = [], overlays = [], endCard = null, output, cleanOutput = null }) {
  const { width, height } = dims;
  const n = clips.length;
  const durations = clips.map((c) => Math.max(0.5, Number(c.duration) || 0));
  const T = n > 1 || endCard ? round3(Math.min(transition, Math.min(...durations) / 3)) : 0;
  const withAudio = clips.some((c) => c.hasAudio);
  const args = ['-y'];
  const filters = [];

  clips.forEach((c) => args.push('-i', c.path));
  clips.forEach((c, i) => {
    const d = durations[i].toFixed(3);
    // trim/setpts before fps: xfade needs a constant frame rate and setpts would reset it.
    filters.push(`[${i}:v]trim=0:${d},setpts=PTS-STARTPTS,scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,fps=${fps},format=yuv420p[v${i}]`);
    if (withAudio) {
      filters.push(
        c.hasAudio
          ? `[${i}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=0:${d},asetpts=PTS-STARTPTS[a${i}]`
          : `anullsrc=channel_layout=stereo:sample_rate=44100,atrim=0:${d},asetpts=PTS-STARTPTS[a${i}]`,
      );
    }
  });

  // 1. join clips with transitions
  let video = '[v0]';
  let audio = withAudio ? '[a0]' : null;
  let offset = durations[0];
  for (let i = 1; i < n; i += 1) {
    const name = transitions[i - 1] || 'fade';
    filters.push(`${video}[v${i}]xfade=transition=${name}:duration=${T}:offset=${round3(offset - T)}[x${i}]`);
    video = `[x${i}]`;
    if (withAudio) {
      filters.push(`${audio}[a${i}]acrossfade=d=${T}[y${i}]`);
      audio = `[y${i}]`;
    }
    offset = offset - T + durations[i];
  }
  const mainTotal = round3(offset);

  // 2. clean copy
  let clean = null;
  let cleanAudio = null;
  if (cleanOutput) {
    filters.push(`${video}split=2[main][clean]`);
    video = '[main]';
    clean = '[clean]';
    if (withAudio) {
      filters.push(`${audio}asplit=2[amain][aclean]`);
      audio = '[amain]';
      cleanAudio = '[aclean]';
    }
  }

  // 3. overlays
  let input = n;
  overlays.forEach((o, k) => {
    const start = round3(Math.max(0, o.start));
    const end = round3(Math.min(mainTotal, o.end));
    if (end - start < 0.2) return;
    // The still only exists inside its time window (-itsoffset), so ffmpeg does no work outside it.
    args.push('-loop', '1', '-framerate', String(fps), '-t', String(round3(end - start + 0.1)), '-itsoffset', String(start), '-i', o.path);
    const fade = o.fade && end - start > 0.9 ? `,fade=t=in:st=${start}:d=0.3:alpha=1,fade=t=out:st=${round3(end - 0.3)}:d=0.3:alpha=1` : '';
    filters.push(`[${input}:v]format=rgba${fade}[ov${k}]`);
    filters.push(`${video}[ov${k}]overlay=${Math.round(o.x ?? 0)}:${Math.round(o.y ?? 0)}:enable='between(t,${start},${end})':eof_action=pass[c${k}]`);
    video = `[c${k}]`;
    input += 1;
  });
  if (overlays.length) {
    // overlay loses the constant frame rate xfade needs; restore it
    filters.push(`${video}fps=${fps},format=yuv420p[branded]`);
    video = '[branded]';
  }

  // 4. end card
  let total = mainTotal;
  if (endCard) {
    const len = round3(endCard.duration + T);
    args.push('-loop', '1', '-framerate', String(fps), '-t', String(len), '-i', endCard.path);
    filters.push(`[${input}:v]trim=0:${len},setpts=PTS-STARTPTS,scale=${width}:${height},setsar=1,fps=${fps},format=yuv420p[endv]`);
    filters.push(`${video}[endv]xfade=transition=fade:duration=${T}:offset=${round3(mainTotal - T)}[final]`);
    video = '[final]';
    if (withAudio) {
      filters.push(`anullsrc=channel_layout=stereo:sample_rate=44100,atrim=0:${len},asetpts=PTS-STARTPTS[aend]`);
      filters.push(`${audio}[aend]acrossfade=d=${T}[afinal]`);
      audio = '[afinal]';
    }
    total = round3(mainTotal + endCard.duration);
  }

  if (!withAudio) {
    filters.push(`anullsrc=channel_layout=stereo:sample_rate=44100,atrim=0:${total},asetpts=PTS-STARTPTS[asilent]`);
    audio = '[asilent]';
    if (clean) {
      filters.push(`anullsrc=channel_layout=stereo:sample_rate=44100,atrim=0:${mainTotal},asetpts=PTS-STARTPTS[asilentclean]`);
      cleanAudio = '[asilentclean]';
    }
  }

  args.push('-filter_complex', filters.join(';'));
  const encode = (crf) => ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];
  args.push('-map', video);
  if (audio) args.push('-map', audio, '-c:a', 'aac', '-b:a', '128k');
  args.push(...encode(21), output);
  if (clean) {
    args.push('-map', clean);
    if (cleanAudio) args.push('-map', cleanAudio, '-c:a', 'aac', '-b:a', '128k');
    args.push(...encode(23), cleanOutput);
  }
  return { args, total, mainTotal, transition: T };
}

export async function composeVideo(opts) {
  const { args } = buildComposeArgs(opts);
  await mustRun(args, 'compose');
  return probe(opts.output);
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
