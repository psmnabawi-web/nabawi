import type {
  Audience,
  CalendarStatus,
  Category,
  ContentFormat,
  GrowthLevel,
  Objective,
  Platform,
  Product,
  Role,
  ScriptTone,
  SourceType,
  TextProvider,
  VideoDuration,
  VideoProvider,
  VideoStatus,
  VideoStyle,
  VideoTemplate,
} from '../types'

/** Keep in sync with functions/src/lib/constants.js */

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'Super Admin',
  marketing_manager: 'Marketing Manager',
  store_manager: 'Store Manager',
}

export const PLATFORMS: Platform[] = ['TikTok', 'Instagram', 'YouTube']
export const PLATFORM_HOSTS: Record<Platform, string[]> = {
  TikTok: ['tiktok.com', 'vt.tiktok.com', 'vm.tiktok.com'],
  Instagram: ['instagram.com', 'instagr.am'],
  YouTube: ['youtube.com', 'youtu.be'],
}

export const SOURCE_TYPES: { value: SourceType; label: string; hint: string }[] = [
  { value: 'content', label: 'Content link', hint: 'A specific video or post URL' },
  { value: 'account', label: 'Account / competitor', hint: 'A brand or competitor profile URL' },
  { value: 'hashtag', label: 'Hashtag / keyword', hint: 'Monitor a hashtag such as #catrumah' },
]

export const CATEGORIES: { value: Category; label: string }[] = [
  { value: 'paint', label: 'Paint' },
  { value: 'interior', label: 'Interior design' },
  { value: 'exterior', label: 'Exterior' },
  { value: 'waterproofing', label: 'Waterproofing' },
  { value: 'renovation', label: 'Renovation' },
  { value: 'color-trend', label: 'Color trend' },
  { value: 'home-decor', label: 'Home decor' },
  { value: 'building-material', label: 'Building material' },
]
export const categoryLabel = (c: string) => CATEGORIES.find((x) => x.value === c)?.label ?? c

export const PRODUCTS: Product[] = ['Interior paint', 'Exterior paint', 'Waterproof', 'Primer']
export const AUDIENCES: Audience[] = ['Home owner', 'Contractor', 'Architect']
export const OBJECTIVES: Objective[] = ['Awareness', 'Engagement', 'Leads', 'Sales', 'Education']
export const CONTENT_FORMATS: ContentFormat[] = ['Short video', 'Carousel', 'Single image', 'Story', 'Live', 'Long video']
export const SCRIPT_TONES: ScriptTone[] = ['Friendly', 'Professional', 'Inspirational', 'Humorous', 'Urgent']
export const DURATIONS: VideoDuration[] = [15, 30, 60]
export const VIDEO_STYLES: VideoStyle[] = ['Realistic', 'Cinematic']

export const VIDEO_TEMPLATES: { id: VideoTemplate; label: string; description: string; emoji: string }[] = [
  { id: 'before_after', label: 'Before After House Transformation', description: 'Dull house → painting process → stunning reveal.', emoji: '🏠' },
  { id: 'product_education', label: 'Product Education', description: 'Benefits, application steps and common mistakes.', emoji: '🎓' },
  { id: 'store_promotion', label: 'Store Promotion', description: 'Product range, tinting service and promo CTA.', emoji: '🏪' },
  { id: 'customer_testimonial', label: 'Customer Testimonial', description: 'Real problem → choice → proud result.', emoji: '💬' },
  { id: 'color_inspiration', label: 'Color Inspiration', description: 'Curated palettes for rooms and facades.', emoji: '🎨' },
]
export const templateLabel = (id: string) => VIDEO_TEMPLATES.find((t) => t.id === id)?.label ?? id

export const VIDEO_STATUSES: VideoStatus[] = ['Draft', 'Processing', 'Completed', 'Published', 'Failed']
export const CALENDAR_STATUSES: CalendarStatus[] = ['Planned', 'Scheduled', 'Published', 'Cancelled']

export const TEXT_PROVIDERS: { id: TextProvider; label: string }[] = [
  { id: 'gemini', label: 'Google Gemini' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'claude', label: 'Anthropic Claude' },
  { id: 'mock', label: 'Demo (offline mock)' },
]
export const VIDEO_PROVIDERS: { id: VideoProvider; label: string; note: string }[] = [
  { id: 'veo', label: 'Google Veo (Vertex AI)', note: 'Veo 3.1 Lite clips (4/6/8s), stitched · no API key, billed to the Firebase project' },
  { id: 'runway', label: 'Runway', note: 'Text-to-video clips, stitched to 15/30/60s' },
  { id: 'kling', label: 'Kling AI', note: 'Text-to-video clips (5/10s), stitched' },
  { id: 'pika', label: 'Pika (fal.ai)', note: 'Text-to-video clips (5/10s), stitched' },
  { id: 'heygen', label: 'HeyGen', note: 'Talking avatar from the script voice-over' },
  { id: 'mock', label: 'Demo renderer', note: 'Offline placeholder video for testing' },
]
export const providerLabel = (id: string) => [...TEXT_PROVIDERS, ...VIDEO_PROVIDERS].find((p) => p.id === id)?.label ?? id
export const videoProviderLabel = (id: string) => VIDEO_PROVIDERS.find((p) => p.id === id)?.label ?? id

export const GROWTH_STYLES: Record<GrowthLevel, string> = {
  Viral: 'bg-rose-50 text-rose-700 ring-rose-200',
  Rising: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  Stable: 'bg-slate-100 text-slate-700 ring-slate-200',
  Declining: 'bg-amber-50 text-amber-800 ring-amber-200',
}

export const VIDEO_STATUS_STYLES: Record<VideoStatus, string> = {
  Draft: 'bg-slate-100 text-slate-700 ring-slate-200',
  Processing: 'bg-blue-50 text-blue-700 ring-blue-200',
  Completed: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  Published: 'bg-brand-50 text-brand-800 ring-brand-200',
  Failed: 'bg-rose-50 text-rose-700 ring-rose-200',
}

export const CALENDAR_STATUS_STYLES: Record<CalendarStatus, string> = {
  Planned: 'bg-slate-100 text-slate-700 ring-slate-200',
  Scheduled: 'bg-blue-50 text-blue-700 ring-blue-200',
  Published: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  Cancelled: 'bg-rose-50 text-rose-700 ring-rose-200 line-through',
}

export const AI_CALL_TIMEOUT_MS = 540_000
