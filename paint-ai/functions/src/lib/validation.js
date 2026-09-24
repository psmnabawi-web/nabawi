import { z } from 'zod';
import { ALL_ROLES, ALL_STORES } from '../config.js';
import {
  AUDIENCES,
  CONTENT_FORMATS,
  OBJECTIVES,
  PLATFORMS,
  PRODUCTS,
  SCRIPT_DURATIONS,
  SCRIPT_TONES,
  TEMPLATE_IDS,
  VIDEO_DURATIONS,
  VIDEO_RATIOS,
  VIDEO_STYLES,
} from './constants.js';
import { HttpsError } from './errors.js';
import { TEXT_PROVIDERS, VIDEO_PROVIDERS } from './settings.js';

const docId = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, 'Invalid document id');

const storeScope = z.union([z.literal(ALL_STORES), docId]);
const text = (max) => z.string().trim().max(max);
/** Optional field that also accepts null (the Firebase callable SDK encodes undefined as null). */
const opt = (schema) => schema.nullish().transform((v) => v ?? undefined);

export const schemas = {
  bootstrapProfile: z.object({ name: opt(text(80)) }).strict(),

  manageUser: z.discriminatedUnion('action', [
    z
      .object({
        action: z.literal('create'),
        email: z.string().trim().toLowerCase().email().max(254),
        password: z.string().min(8, 'Password must be at least 8 characters').max(128),
        name: text(80).min(2),
        role: z.enum(ALL_ROLES),
        storeId: docId.nullable().optional(),
      })
      .strict(),
    z
      .object({
        action: z.literal('update'),
        uid: z.string().min(1).max(128),
        name: opt(text(80).min(2)),
        role: opt(z.enum(ALL_ROLES)),
        storeId: docId.nullable().optional(),
        active: opt(z.boolean()),
      })
      .strict(),
  ]),

  analyzeTrend: z
    .object({
      sourceId: docId,
      provider: opt(z.enum(TEXT_PROVIDERS)),
    })
    .strict(),

  generateContent: z
    .object({
      trendId: docId.nullable().optional(),
      product: z.enum(PRODUCTS),
      audience: z.enum(AUDIENCES),
      objective: z.enum(OBJECTIVES).default('Engagement'),
      platform: z.enum(PLATFORMS).default('TikTok'),
      format: opt(z.enum(CONTENT_FORMATS)),
      count: z.number().int().min(1).max(20).default(20),
      storeId: storeScope.default(ALL_STORES),
      brief: opt(text(1000)).default(''),
      provider: opt(z.enum(TEXT_PROVIDERS)),
    })
    .strict(),

  generateScript: z
    .object({
      contentId: docId,
      duration: z.union(SCRIPT_DURATIONS.map((d) => z.literal(d))).default(30),
      tone: z.enum(SCRIPT_TONES).default('Friendly'),
      platform: opt(z.enum(PLATFORMS)),
      notes: opt(text(1000)).default(''),
      provider: opt(z.enum(TEXT_PROVIDERS)),
    })
    .strict(),

  generateVideo: z
    .object({
      scriptId: docId.nullable().optional(),
      title: text(140).min(3),
      template: z.enum(TEMPLATE_IDS),
      duration: z.union(VIDEO_DURATIONS.map((d) => z.literal(d))),
      ratio: z.enum(VIDEO_RATIOS).default('9:16'),
      style: z.enum(VIDEO_STYLES).default('Realistic'),
      provider: opt(z.enum(VIDEO_PROVIDERS)),
      storeId: storeScope.default(ALL_STORES),
      brief: opt(text(1000)).default(''),
      brandTemplate: opt(z.boolean()),
      saveAsDraft: z.boolean().default(false),
    })
    .strict(),

  videoAction: z
    .object({
      videoId: docId,
      action: z.enum(['start', 'refresh', 'retry', 'brand', 'captions']),
    })
    .strict(),

  calculatePerformance: z.object({}).strict(),

  socialConnect: z.object({ platform: z.enum(['instagram']) }).strict(),

  manageSocialAccount: z
    .object({
      accountId: docId,
      storeId: opt(storeScope),
      disconnect: opt(z.boolean()),
    })
    .strict(),

  schedulePost: z
    .object({
      videoId: docId,
      accountId: docId,
      caption: z.string().trim().min(1, 'Caption is required').max(2200, 'Instagram captions are limited to 2,200 characters'),
      scheduledAt: opt(z.string().datetime({ offset: true })),
    })
    .strict(),

  cancelPost: z.object({ postId: docId }).strict(),

  seedDemoData: z.object({ action: z.enum(['seed', 'remove']).default('seed') }).strict(),
};

/** Parses callable input or throws invalid-argument with a readable message. */
export function parseInput(schema, data) {
  const result = schema.safeParse(data ?? {});
  if (!result.success) {
    const message = result.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join('.') || 'input'}: ${i.message}`)
      .join('; ');
    throw new HttpsError('invalid-argument', `Invalid input — ${message}`);
  }
  return result.data;
}
