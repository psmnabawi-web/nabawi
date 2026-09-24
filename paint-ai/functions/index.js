/**
 * Cloud Functions entry point — AI Content Intelligence & Video Generator (Retail Paint).
 *
 * Callable (HTTPS, Firebase Auth required):
 *   bootstrapProfile       create/refresh the caller's users/{uid} profile
 *   manageUser             super admin: create user, change role/store, activate/deactivate
 *   analyzeTrend           MODULE 2 — AI trend analysis of a social source
 *   generateContent        MODULE 3 — AI content ideas (generateContentIdeas)
 *   generateScript         MODULE 4 — AI video script (generateVideoScript)
 *   generateVideo          MODULE 5 — create a video (draft or start generation)
 *   videoAction            start a draft / retry a failed video / refresh status now
 *   calculatePerformance   recompute dashboard & analytics aggregates
 *   getIntegrationStatus   which AI / video providers are configured (never returns keys)
 *   seedDemoData           super admin: load or remove demo data
 * Background:
 *   pollVideoJobs          every minute: poll providers, stitch clips, store final video in Storage
 *   scheduledStats         hourly: recompute aggregates
 *   onPerformanceWritten   keep engagementRate consistent
 *   onVideoDeleted         delete Storage files + performance of a deleted video
 */
import { setGlobalOptions } from 'firebase-functions/v2';
import { onDocumentDeleted, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { analyzeTrend as runAnalyzeTrend } from './src/ai/trendAnalyzer.js';
import { generateContentIdeas } from './src/ai/contentGenerator.js';
import { generateVideoScript } from './src/ai/scriptGenerator.js';
import { createVideo, videoAction as runVideoAction } from './src/ai/videoGenerator.js';
import { textProviderStatus } from './src/ai/providers/index.js';
import { ALL_SECRETS, CONTENT_ROLES, REGION, ROLES, TEXT_AI_SECRETS, config } from './src/config.js';
import { logAudit } from './src/lib/audit.js';
import { requireUser } from './src/lib/auth.js';
import { withErrorHandling } from './src/lib/errors.js';
import { bucket, db } from './src/lib/firebase.js';
import { dayKey } from './src/lib/quota.js';
import { getAppSettings } from './src/lib/settings.js';
import { parseInput, schemas } from './src/lib/validation.js';
import { recomputeStats, syncPerformanceDoc } from './src/performance/calculatePerformance.js';
import { removeDemoData, seedDemoData as runSeedDemoData } from './src/seed/demoData.js';
import { bootstrapProfile as runBootstrapProfile, manageUser as runManageUser } from './src/users/users.js';
import { videoProviderStatus } from './src/video/adapters/index.js';
import { pollProcessingVideos } from './src/video/pipeline.js';

setGlobalOptions({ region: REGION, maxInstances: 10 });

const callable = (name, options, handler) => onCall({ enforceAppCheck: false, ...options }, withErrorHandling(name, handler));

const AI_OPTS = { timeoutSeconds: 540, memory: '512MiB', secrets: TEXT_AI_SECRETS };
const VIDEO_OPTS = { timeoutSeconds: 540, memory: '2GiB', secrets: ALL_SECRETS };

// ---------------------------------------------------------------- Users
export const bootstrapProfile = callable('bootstrapProfile', {}, async (request) => {
  const input = parseInput(schemas.bootstrapProfile, request.data);
  return runBootstrapProfile(request, input);
});

export const manageUser = callable('manageUser', {}, async (request) => {
  const actor = await requireUser(request, [ROLES.SUPER_ADMIN]);
  const input = parseInput(schemas.manageUser, request.data);
  return runManageUser(actor, input);
});

// ---------------------------------------------------------------- AI modules
export const analyzeTrend = callable('analyzeTrend', AI_OPTS, async (request) => {
  const user = await requireUser(request, CONTENT_ROLES);
  return runAnalyzeTrend(user, parseInput(schemas.analyzeTrend, request.data));
});

export const generateContent = callable('generateContent', AI_OPTS, async (request) => {
  const user = await requireUser(request, CONTENT_ROLES);
  return generateContentIdeas(user, parseInput(schemas.generateContent, request.data));
});

export const generateScript = callable('generateScript', AI_OPTS, async (request) => {
  const user = await requireUser(request, CONTENT_ROLES);
  return generateVideoScript(user, parseInput(schemas.generateScript, request.data));
});

export const generateVideo = callable('generateVideo', VIDEO_OPTS, async (request) => {
  const user = await requireUser(request, CONTENT_ROLES);
  return createVideo(user, parseInput(schemas.generateVideo, request.data));
});

export const videoAction = callable('videoAction', VIDEO_OPTS, async (request) => {
  const user = await requireUser(request, CONTENT_ROLES);
  return runVideoAction(user, parseInput(schemas.videoAction, request.data));
});

// ---------------------------------------------------------------- Performance
export const calculatePerformance = callable('calculatePerformance', { timeoutSeconds: 300, memory: '512MiB' }, async (request) => {
  await requireUser(request, CONTENT_ROLES);
  parseInput(schemas.calculatePerformance, request.data);
  return recomputeStats();
});

export const scheduledStats = onSchedule({ schedule: 'every 60 minutes', timeZone: 'Asia/Jakarta', timeoutSeconds: 300, memory: '512MiB' }, async () => {
  await recomputeStats();
});

export const onPerformanceWritten = onDocumentWritten({ document: 'performance/{videoId}' }, async (event) => {
  await syncPerformanceDoc(event.data);
});

// ---------------------------------------------------------------- Video background jobs
export const pollVideoJobs = onSchedule({ schedule: 'every 1 minutes', timeoutSeconds: 540, memory: '2GiB', secrets: ALL_SECRETS, maxInstances: 1 }, async () => {
  await pollProcessingVideos({ limit: 10 });
});

export const onVideoDeleted = onDocumentDeleted({ document: 'generated_videos/{videoId}' }, async (event) => {
  const { videoId } = event.params;
  await Promise.allSettled([bucket().deleteFiles({ prefix: `videos/${videoId}/` }), db.doc(`performance/${videoId}`).delete()]);
});

// ---------------------------------------------------------------- Settings & admin
export const getIntegrationStatus = callable('getIntegrationStatus', { secrets: ALL_SECRETS }, async (request) => {
  const user = await requireUser(request, CONTENT_ROLES);
  const settings = await getAppSettings({ fresh: true });
  const usage = await db.doc(`usage/${user.uid}_${dayKey()}`).get();
  return {
    text: textProviderStatus(),
    video: videoProviderStatus(),
    defaults: { textProvider: settings.textProvider, videoProvider: settings.videoProvider, contentLanguage: settings.contentLanguage },
    geminiMode: config.ai.geminiUseVertex ? 'vertex' : 'api-key',
    limits: config.limits,
    usageToday: { ai: usage.get('ai') ?? 0, video: usage.get('video') ?? 0 },
    region: REGION,
  };
});

export const seedDemoData = callable('seedDemoData', { timeoutSeconds: 120 }, async (request) => {
  const actor = await requireUser(request, [ROLES.SUPER_ADMIN]);
  const { action } = parseInput(schemas.seedDemoData, request.data);
  const result = action === 'remove' ? await removeDemoData() : await runSeedDemoData(actor.uid);
  await logAudit({ actor, action: `demo.${action}`, entity: 'demo', details: result });
  await recomputeStats();
  return result;
});
