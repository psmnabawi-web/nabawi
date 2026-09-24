import { defineSecret } from 'firebase-functions/params';

/**
 * Central runtime configuration.
 * - Non-secret values come from functions/.env (process.env) with safe defaults.
 * - API keys come from Secret Manager (defineSecret). A secret set to "disabled" / "none" / empty
 *   is treated as "provider not configured".
 */

const env = (name, fallback = '') => {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
};

const boolEnv = (name, fallback) => {
  const v = (process.env[name] ?? '').trim().toLowerCase();
  if (['true', '1', 'yes'].includes(v)) return true;
  if (['false', '0', 'no'].includes(v)) return false;
  return fallback;
};

/** Project id of the running Firebase project (Cloud Functions sets GCLOUD_PROJECT / FIREBASE_CONFIG). */
function firebaseProjectId() {
  try {
    return JSON.parse(process.env.FIREBASE_CONFIG ?? '{}').projectId ?? '';
  } catch {
    return '';
  }
}

const intEnv = (name, fallback) => {
  const n = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const REGION = env('FUNCTIONS_REGION', 'asia-southeast2');

export const ROLES = Object.freeze({
  SUPER_ADMIN: 'super_admin',
  MARKETING: 'marketing_manager',
  STORE: 'store_manager',
});
export const ALL_ROLES = Object.values(ROLES);
export const CONTENT_ROLES = [ROLES.SUPER_ADMIN, ROLES.MARKETING];

/** Brand-wide content is stored with storeId = ALL_STORES so every store manager can read it. */
export const ALL_STORES = 'ALL';

export const SECRETS = Object.freeze({
  GEMINI_API_KEY: defineSecret('GEMINI_API_KEY'),
  OPENAI_API_KEY: defineSecret('OPENAI_API_KEY'),
  ANTHROPIC_API_KEY: defineSecret('ANTHROPIC_API_KEY'),
  RUNWAY_API_KEY: defineSecret('RUNWAY_API_KEY'),
  KLING_ACCESS_KEY: defineSecret('KLING_ACCESS_KEY'),
  KLING_SECRET_KEY: defineSecret('KLING_SECRET_KEY'),
  FAL_KEY: defineSecret('FAL_KEY'),
  HEYGEN_API_KEY: defineSecret('HEYGEN_API_KEY'),
  // Instagram app secret (Meta app > Instagram > API setup with Instagram login). Also derives the key
  // that encrypts stored social access tokens.
  INSTAGRAM_APP_SECRET: defineSecret('INSTAGRAM_APP_SECRET'),
});

export const TEXT_AI_SECRETS = [SECRETS.GEMINI_API_KEY, SECRETS.OPENAI_API_KEY, SECRETS.ANTHROPIC_API_KEY];
export const VIDEO_AI_SECRETS = [
  SECRETS.RUNWAY_API_KEY,
  SECRETS.KLING_ACCESS_KEY,
  SECRETS.KLING_SECRET_KEY,
  SECRETS.FAL_KEY,
  SECRETS.HEYGEN_API_KEY,
];
export const SOCIAL_SECRETS = [SECRETS.INSTAGRAM_APP_SECRET];
export const ALL_SECRETS = [...TEXT_AI_SECRETS, ...VIDEO_AI_SECRETS, ...SOCIAL_SECRETS];

const DISABLED_VALUES = new Set(['', 'disabled', 'none', 'null', 'changeme']);

/** Returns the secret value or '' when the secret is missing/disabled/not bound to this function. */
export function secretValue(name) {
  let value = '';
  try {
    value = SECRETS[name]?.value() ?? '';
  } catch {
    value = '';
  }
  if (!value) value = process.env[name] ?? '';
  value = String(value).trim();
  return DISABLED_VALUES.has(value.toLowerCase()) ? '' : value;
}

export const hasSecret = (name) => secretValue(name) !== '';

export const config = Object.freeze({
  superAdminEmails: env('SUPER_ADMIN_EMAILS')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
  ai: {
    provider: env('AI_PROVIDER', 'gemini'),
    geminiModel: env('GEMINI_MODEL', 'gemini-3.8-flash'),
    // Used when GEMINI_MODEL is overloaded (503) / rate limited after retries, or not found. Empty = no fallback.
    geminiFallbackModel: env('GEMINI_FALLBACK_MODEL', 'gemini-3.6-flash'),
    openaiModel: env('OPENAI_MODEL', 'gpt-6-sol'),
    claudeModel: env('CLAUDE_MODEL', 'claude-opus-5'),
    geminiUseVertex: env('GOOGLE_GENAI_USE_VERTEXAI', 'false').toLowerCase() === 'true',
    googleCloudProject: env('GOOGLE_CLOUD_PROJECT', env('GCLOUD_PROJECT', firebaseProjectId())),
    googleCloudLocation: env('GOOGLE_CLOUD_LOCATION', 'global'),
  },
  video: {
    provider: env('VIDEO_PROVIDER', 'veo'),
    runwayModel: env('RUNWAY_MODEL', 'gen4.5'),
    klingModel: env('KLING_MODEL', 'kling-v2-5-turbo'),
    klingMode: env('KLING_MODE', 'pro'),
    klingApiBase: env('KLING_API_BASE', 'https://api-singapore.klingai.com'),
    pikaFalEndpoint: env('PIKA_FAL_ENDPOINT', 'fal-ai/pika/v2.2/text-to-video'),
    // Google Veo on Vertex AI (no API key; uses the Functions service account + project billing).
    veoEnabled: boolEnv('VEO_ENABLED', true),
    veoModel: env('VEO_MODEL', 'veo-3.1-lite-generate-001'),
    veoLocation: env('VEO_LOCATION', 'us-central1'),
    veoResolution: env('VEO_RESOLUTION', '720p') === '1080p' ? '1080p' : '720p',
    veoGenerateAudio: boolEnv('VEO_GENERATE_AUDIO', false),
    heygenAvatarId: env('HEYGEN_AVATAR_ID'),
    heygenVoiceId: env('HEYGEN_VOICE_ID'),
    timeoutMinutes: intEnv('VIDEO_TIMEOUT_MINUTES', 60),
  },
  social: {
    instagramAppId: env('INSTAGRAM_APP_ID'),
    graphVersion: env('INSTAGRAM_GRAPH_VERSION', 'v24.0'),
    // Public site that hosts the OAuth callback rewrite (/api/oauth/instagram).
    publicBaseUrl: env('PUBLIC_BASE_URL', `https://${env('GOOGLE_CLOUD_PROJECT', env('GCLOUD_PROJECT', firebaseProjectId()))}.web.app`).replace(/\/+$/, ''),
  },
  limits: {
    aiDaily: intEnv('AI_DAILY_LIMIT', 200),
    videoDaily: intEnv('VIDEO_DAILY_LIMIT', 20),
  },
});

export const isEmulator = () => process.env.FUNCTIONS_EMULATOR === 'true';
