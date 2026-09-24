import type { ScriptBeat, VideoScript } from '../types'

/** Plain-text export of a script (copy / .txt download). */
export function scriptToText(s: VideoScript) {
  const beat = (label: string, b: ScriptBeat) => [`${label} (${b.timeRange})`, `Visual: ${b.visual}`, `Voice: ${b.voice}`, b.onScreenText ? `Text: ${b.onScreenText}` : ''].filter(Boolean).join('\n')
  return [
    `TITLE: ${s.title}`,
    `Duration: ${s.duration}s · ${s.platform} · ${s.tone}`,
    '',
    beat('HOOK', s.hook),
    '',
    ...s.scenes.map((sc) => beat(`SCENE ${sc.sceneNumber}`, sc) + '\n'),
    beat('CTA', s.cta),
    '',
    'VOICE OVER',
    s.voiceOver,
    '',
    'CAPTION',
    s.caption,
    '',
    s.hashtags.join(' '),
    s.musicSuggestion ? `\nMusic: ${s.musicSuggestion}` : '',
  ].join('\n')
}
