import { z } from 'zod';
import { CONFIDENCE_LEVELS, CONTENT_FORMATS, GROWTH_LEVELS, IMPACT_LEVELS } from '../lib/constants.js';

/**
 * JSON Schemas sent to the model (compatible with OpenAI strict mode, Claude json_schema and Gemini
 * responseJsonSchema: every property required, additionalProperties=false, no numeric range keywords)
 * + zod normalizers that clamp/clean the output before it is stored.
 */

const str = (description) => ({ type: 'string', description });
const strArray = (description) => ({ type: 'array', items: { type: 'string' }, description });
const obj = (properties) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

const cleanStr = (max = 2000) => z.preprocess((v) => (typeof v === 'string' ? v.trim().slice(0, max) : ''), z.string());
const cleanArr = (maxItems = 15, maxLen = 120) =>
  z.preprocess(
    (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim().slice(0, maxLen)).slice(0, maxItems) : []),
    z.array(z.string()),
  );
const enumOr = (values, fallback) => z.preprocess((v) => (values.includes(v) ? v : fallback), z.enum(values));
const clampInt = (min, max, fallback) =>
  z.preprocess((v) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  }, z.number().int());

// ---------------------------------------------------------------- Trend analysis
export const trendAnalysisSchema = obj({
  trendName: str('Short catchy name of the trend (max 8 words).'),
  trendScore: { type: 'integer', description: 'Opportunity score 0-100 for a retail paint brand (see rubric).' },
  growthLevel: { type: 'string', enum: GROWTH_LEVELS, description: 'Trend momentum.' },
  viralPattern: str('Why this content spreads: format, structure, repeatable pattern.'),
  audienceEmotion: str('Dominant emotions triggered in the audience.'),
  contentPattern: str('Content structure pattern that can be replicated (sequence of beats).'),
  hookAnalysis: str('Analysis of the first 0-3 seconds hook and why it stops the scroll.'),
  visualStyle: str('Visual strategy: shots, color grading, pacing, text overlays, sound.'),
  marketingOpportunity: str('Concrete opportunity for a paint retail store / brand.'),
  recommendation: str('One-sentence action recommendation (e.g. "Create a before-after transformation video").'),
  suggestedFormats: strArray('2-4 content formats to execute this trend.'),
  keywords: strArray('3-8 relevant hashtags or keywords.'),
  confidence: { type: 'string', enum: CONFIDENCE_LEVELS, description: 'Confidence given how much real content data was available.' },
  rationale: str('Short explanation of the score, including what data was or was not observable.'),
});

export const trendAnalysisNormalizer = z.object({
  trendName: cleanStr(120),
  trendScore: clampInt(0, 100, 50),
  growthLevel: enumOr(GROWTH_LEVELS, 'Stable'),
  viralPattern: cleanStr(),
  audienceEmotion: cleanStr(),
  contentPattern: cleanStr(),
  hookAnalysis: cleanStr(),
  visualStyle: cleanStr(),
  marketingOpportunity: cleanStr(),
  recommendation: cleanStr(500),
  suggestedFormats: cleanArr(6),
  keywords: cleanArr(10, 60),
  confidence: enumOr(CONFIDENCE_LEVELS, 'medium'),
  rationale: cleanStr(),
});

// ---------------------------------------------------------------- Content ideas
const ideaSchema = obj({
  title: str('Content title (max 12 words).'),
  hook: str('Opening line / visual hook for the first 3 seconds.'),
  storyline: str('Storyline in 2-4 sentences: beats from hook to payoff.'),
  cta: str('Call to action.'),
  expectedImpact: str('Expected business impact and why (reach, saves, leads, store visits).'),
  impactLevel: { type: 'string', enum: IMPACT_LEVELS },
  targetAudience: str('Specific audience segment.'),
  format: { type: 'string', enum: CONTENT_FORMATS },
  objective: str('Primary objective.'),
});
export const contentIdeasSchema = obj({ ideas: { type: 'array', items: ideaSchema, description: 'List of content ideas.' } });

export const contentIdeaNormalizer = z.object({
  title: cleanStr(160),
  hook: cleanStr(400),
  storyline: cleanStr(1500),
  cta: cleanStr(300),
  expectedImpact: cleanStr(600),
  impactLevel: enumOr(IMPACT_LEVELS, 'Medium'),
  targetAudience: cleanStr(200),
  format: enumOr(CONTENT_FORMATS, 'Short video'),
  objective: cleanStr(120),
});
export const contentIdeasNormalizer = z.object({
  ideas: z.preprocess((v) => (Array.isArray(v) ? v : []), z.array(contentIdeaNormalizer)),
});

// ---------------------------------------------------------------- Video script
const beat = (desc) =>
  obj({
    timeRange: str(`Time range, e.g. "${desc}".`),
    visual: str('What is shown on screen (shot, action, setting).'),
    voice: str('Voice-over / spoken line.'),
    onScreenText: str('Short text overlay (can be empty).'),
  });
export const videoScriptSchema = obj({
  title: str('Script title.'),
  hook: beat('0-3s'),
  scenes: {
    type: 'array',
    description: 'Main scenes in chronological order (usually 3-6).',
    items: obj({
      sceneNumber: { type: 'integer' },
      timeRange: str('Time range, e.g. "3-10s".'),
      visual: str('What is shown on screen.'),
      voice: str('Voice-over / spoken line.'),
      onScreenText: str('Short text overlay (can be empty).'),
    }),
  },
  cta: beat('25-30s'),
  voiceOver: str('Full voice-over text, ready to record.'),
  caption: str('Social media caption (with line breaks and emojis if appropriate).'),
  hashtags: strArray('5-12 hashtags including the # sign.'),
  musicSuggestion: str('Suggested music mood / sound.'),
});

const beatNormalizer = z.preprocess(
  (v) => (v && typeof v === 'object' ? v : {}),
  z.object({ timeRange: cleanStr(20), visual: cleanStr(800), voice: cleanStr(800), onScreenText: cleanStr(150) }),
);
export const videoScriptNormalizer = z.object({
  title: cleanStr(160),
  hook: beatNormalizer,
  scenes: z.preprocess(
    (v) => (Array.isArray(v) ? v.slice(0, 12) : []),
    z.array(
      z.object({
        sceneNumber: clampInt(1, 20, 1),
        timeRange: cleanStr(20),
        visual: cleanStr(800),
        voice: cleanStr(800),
        onScreenText: cleanStr(150),
      }),
    ),
  ),
  cta: beatNormalizer,
  voiceOver: cleanStr(5000),
  caption: cleanStr(2200),
  hashtags: z.preprocess(
    (v) => (Array.isArray(v) ? v : []),
    z.array(z.string()).transform((tags) =>
      [...new Set(tags.map((t) => String(t).trim().replace(/\s+/g, '')).filter(Boolean).map((t) => (t.startsWith('#') ? t : `#${t}`)))].slice(0, 15),
    ),
  ),
  musicSuggestion: cleanStr(300),
});

// ---------------------------------------------------------------- Video generation plan
export const videoPlanSchema = obj({
  segments: {
    type: 'array',
    description: 'One entry per clip, in order. Exactly the number of clips requested.',
    items: obj({
      prompt: str('English text-to-video prompt for this clip (subject, action, setting, camera, lighting, style). No text/logos.'),
    }),
  },
  voiceOverText: str('Voice-over text for the whole video in the content language.'),
});

export const videoPlanNormalizer = z.object({
  segments: z.preprocess(
    (v) => (Array.isArray(v) ? v : []),
    z.array(z.object({ prompt: cleanStr(1500) })),
  ),
  voiceOverText: cleanStr(5000),
});
