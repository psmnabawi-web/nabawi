import { z } from 'zod'
import { ALL_STORES } from '../types'
import { AUDIENCES, CALENDAR_STATUSES, CATEGORIES, CONTENT_FORMATS, DURATIONS, OBJECTIVES, PLATFORM_HOSTS, PLATFORMS, PRODUCTS, SCRIPT_TONES, VIDEO_STYLES, VIDEO_TEMPLATES } from './constants'

export function isPlatformUrl(url: string, platform: keyof typeof PLATFORM_HOSTS) {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:') return false
    const host = u.hostname.toLowerCase()
    return PLATFORM_HOSTS[platform].some((h) => host === h || host.endsWith(`.${h}`))
  } catch {
    return false
  }
}

const storeScope = z.string().min(1, 'Choose a store scope')

export const sourceSchema = z
  .object({
    platform: z.enum(PLATFORMS),
    sourceType: z.enum(['content', 'account', 'hashtag']),
    url: z.string().trim().max(500),
    keyword: z.string().trim().max(100),
    category: z.enum(CATEGORIES.map((c) => c.value) as [string, ...string[]]),
    competitor: z.string().trim().max(100),
    location: z.string().trim().max(100),
    contentSample: z.string().trim().max(3000),
    storeId: storeScope,
  })
  .superRefine((v, ctx) => {
    if (v.sourceType === 'hashtag') {
      if (!v.keyword) ctx.addIssue({ code: 'custom', path: ['keyword'], message: 'Enter a hashtag or keyword' })
      if (v.url && !isPlatformUrl(v.url, v.platform)) ctx.addIssue({ code: 'custom', path: ['url'], message: `Must be an https ${v.platform} URL` })
    } else {
      if (!v.url) ctx.addIssue({ code: 'custom', path: ['url'], message: 'URL is required' })
      else if (!isPlatformUrl(v.url, v.platform)) ctx.addIssue({ code: 'custom', path: ['url'], message: `Must be an https ${v.platform} URL (e.g. https://${PLATFORM_HOSTS[v.platform][0]}/...)` })
    }
  })
  .transform((v) => ({
    ...v,
    keyword: v.keyword && v.sourceType === 'hashtag' && !v.keyword.startsWith('#') && !v.keyword.includes(' ') ? `#${v.keyword}` : v.keyword,
  }))
export type SourceInput = z.infer<typeof sourceSchema>

export const contentRequestSchema = z.object({
  trendId: z.string().nullable(),
  product: z.enum(PRODUCTS),
  audience: z.enum(AUDIENCES),
  objective: z.enum(OBJECTIVES),
  platform: z.enum(PLATFORMS),
  format: z.enum(CONTENT_FORMATS).optional(),
  count: z.number().int().min(1).max(20),
  storeId: storeScope,
  brief: z.string().trim().max(1000),
})
export type ContentRequest = z.infer<typeof contentRequestSchema>

export const scriptRequestSchema = z.object({
  contentId: z.string().min(1),
  duration: z.union([z.literal(15), z.literal(30), z.literal(60)]),
  tone: z.enum(SCRIPT_TONES),
  platform: z.enum(PLATFORMS),
  notes: z.string().trim().max(1000),
})
export type ScriptRequest = z.infer<typeof scriptRequestSchema>

export const videoRequestSchema = z.object({
  scriptId: z.string().nullable(),
  title: z.string().trim().min(3, 'Title must be at least 3 characters').max(140),
  template: z.enum(VIDEO_TEMPLATES.map((t) => t.id) as [string, ...string[]]),
  duration: z.union(DURATIONS.map((d) => z.literal(d)) as [z.ZodLiteral<15>, z.ZodLiteral<30>, z.ZodLiteral<60>]),
  ratio: z.literal('9:16'),
  style: z.enum(VIDEO_STYLES),
  provider: z.enum(['veo', 'runway', 'kling', 'pika', 'heygen', 'mock']),
  storeId: storeScope,
  brief: z.string().trim().max(1000),
  saveAsDraft: z.boolean(),
})
export type VideoRequest = z.infer<typeof videoRequestSchema>

export const storeSchema = z.object({
  storeName: z.string().trim().min(2, 'Store name is required').max(100),
  address: z.string().trim().max(300),
  city: z.string().trim().min(2, 'City is required').max(80),
  status: z.enum(['active', 'inactive']),
})
export type StoreInput = z.infer<typeof storeSchema>

export const calendarSchema = z.object({
  title: z.string().trim().min(3, 'Title is required').max(140),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date'),
  platform: z.enum(PLATFORMS),
  status: z.enum(CALENDAR_STATUSES),
  contentId: z.string().nullable(),
  videoId: z.string().nullable(),
  notes: z.string().trim().max(1000),
  storeId: storeScope,
})
export type CalendarInput = z.infer<typeof calendarSchema>

const count = z.coerce.number({ message: 'Must be a number' }).int('Whole numbers only').min(0, 'Cannot be negative').max(100_000_000_000)
export const performanceSchema = z
  .object({
    platform: z.enum(PLATFORMS),
    views: count,
    likes: count,
    comments: count,
    shares: count,
    leads: count,
    salesImpact: z.coerce.number({ message: 'Must be a number' }).min(0, 'Cannot be negative').max(1e15),
    publishedUrl: z.string().trim().max(500).refine((v) => !v || v.startsWith('https://'), 'Must start with https://'),
  })
  .refine((v) => v.likes + v.comments + v.shares <= v.views * 10 || v.views === 0, { message: 'Interactions look too high compared to views — please double check', path: ['views'] })
export type PerformanceInput = z.infer<typeof performanceSchema>

export const newUserSchema = z
  .object({
    name: z.string().trim().min(2, 'Name is required').max(80),
    email: z.string().trim().toLowerCase().email('Enter a valid email'),
    password: z.string().min(8, 'At least 8 characters').max(128),
    role: z.enum(['super_admin', 'marketing_manager', 'store_manager']),
    storeId: z.string().nullable(),
  })
  .refine((v) => v.role !== 'store_manager' || !!v.storeId, { message: 'Assign a store to a store manager', path: ['storeId'] })
export type NewUserInput = z.infer<typeof newUserSchema>

export const signUpSchema = z
  .object({
    name: z.string().trim().min(2, 'Name is required').max(80),
    email: z.string().trim().email('Enter a valid email'),
    password: z.string().min(8, 'At least 8 characters'),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: 'Passwords do not match', path: ['confirm'] })

export const signInSchema = z.object({
  email: z.string().trim().email('Enter a valid email'),
  password: z.string().min(1, 'Enter your password'),
})

/** Flattens zod issues into { field: message } for forms. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_form'
    if (!out[key]) out[key] = issue.message
  }
  return out
}

export { ALL_STORES }
