import type { Timestamp } from 'firebase/firestore'

/** Firestore timestamps may be null right after a local write (pending server timestamp). */
export type TS = Timestamp | null | undefined

export type Role = 'super_admin' | 'marketing_manager' | 'store_manager'
export type Platform = 'TikTok' | 'Instagram' | 'YouTube'
export type SourceType = 'content' | 'account' | 'hashtag'
export type Category =
  | 'paint'
  | 'interior'
  | 'exterior'
  | 'waterproofing'
  | 'renovation'
  | 'color-trend'
  | 'home-decor'
  | 'building-material'
export type GrowthLevel = 'Viral' | 'Rising' | 'Stable' | 'Declining'
export type Confidence = 'high' | 'medium' | 'low'
export type Product = 'Interior paint' | 'Exterior paint' | 'Waterproof' | 'Primer'
export type Audience = 'Home owner' | 'Contractor' | 'Architect'
export type Objective = 'Awareness' | 'Engagement' | 'Leads' | 'Sales' | 'Education'
export type ContentFormat = 'Short video' | 'Carousel' | 'Single image' | 'Story' | 'Live' | 'Long video'
export type ImpactLevel = 'High' | 'Medium' | 'Low'
export type IdeaStatus = 'idea' | 'scripted' | 'approved' | 'archived'
export type ScriptTone = 'Friendly' | 'Professional' | 'Inspirational' | 'Humorous' | 'Urgent'
export type VideoTemplate = 'before_after' | 'product_education' | 'store_promotion' | 'customer_testimonial' | 'color_inspiration'
export type VideoStatus = 'Draft' | 'Processing' | 'Completed' | 'Published' | 'Failed'
export type VideoStyle = 'Realistic' | 'Cinematic'
export type VideoRatio = '9:16'
export type VideoDuration = 15 | 30 | 60
export type TextProvider = 'gemini' | 'openai' | 'claude' | 'mock'
export type VideoProvider = 'veo' | 'runway' | 'kling' | 'pika' | 'heygen' | 'mock'
export type CalendarStatus = 'Planned' | 'Scheduled' | 'Published' | 'Cancelled'

/** Brand-wide scope value for storeId. */
export const ALL_STORES = 'ALL'

export interface UserProfile {
  uid: string
  name: string
  email: string
  role: Role
  storeId: string | null
  active: boolean
  photoURL?: string | null
  createdAt?: TS
  lastLoginAt?: TS
}

export interface Store {
  id: string
  storeId: string
  storeName: string
  address: string
  city: string
  status: 'active' | 'inactive'
  createdAt?: TS
  updatedAt?: TS
  demo?: boolean
}

export interface SocialSource {
  id: string
  platform: Platform
  sourceType: SourceType
  url: string
  keyword: string
  category: Category
  competitor: string
  location: string
  contentSample: string
  storeId: string
  createdBy: string
  createdAt?: TS
  updatedAt?: TS
  lastAnalyzedAt?: TS
  lastTrendId?: string
  lastTrendName?: string
  lastTrendScore?: number
  analysisCount?: number
  demo?: boolean
}

export interface TrendAnalysis {
  id: string
  sourceId: string
  storeId: string
  platform: Platform
  keyword: string
  category: Category
  sourceUrl: string
  sourceMeta?: { title: string; author: string; thumbnailUrl: string } | null
  trendName: string
  trendScore: number
  growthLevel: GrowthLevel
  viralPattern: string
  audienceEmotion: string
  contentPattern: string
  hookAnalysis: string
  visualStyle: string
  marketingOpportunity: string
  recommendation: string
  suggestedFormats: string[]
  keywords: string[]
  confidence: Confidence
  rationale: string
  provider: string
  model: string
  createdBy: string
  createdAt?: TS
  demo?: boolean
}

export interface ContentIdea {
  id: string
  batchId: string
  rank: number
  trendId: string | null
  trendName: string | null
  title: string
  hook: string
  storyline: string
  cta: string
  expectedImpact: string
  impactLevel: ImpactLevel
  targetAudience: string
  format: ContentFormat
  objective: string
  product: Product
  audience: Audience
  platform: Platform
  storeId: string
  status: IdeaStatus
  favorite: boolean
  scriptCount: number
  lastScriptId?: string
  provider: string
  model: string
  createdBy: string
  createdAt?: TS
  demo?: boolean
}

export interface ScriptBeat {
  timeRange: string
  visual: string
  voice: string
  onScreenText: string
}
export interface ScriptScene extends ScriptBeat {
  sceneNumber: number
}

export interface VideoScript {
  id: string
  contentId: string
  trendId: string | null
  title: string
  duration: VideoDuration
  tone: ScriptTone
  platform: Platform
  hook: ScriptBeat
  scenes: ScriptScene[]
  cta: ScriptBeat
  voiceOver: string
  caption: string
  hashtags: string[]
  musicSuggestion: string
  storeId: string
  provider: string
  model: string
  createdBy: string
  createdAt?: TS
  demo?: boolean
}

export interface VideoSegment {
  index: number
  duration: number
  prompt: string
  jobId: string
  status: 'pending' | 'running' | 'succeeded' | 'failed'
  error: string | null
  progress?: number
}

export interface GeneratedVideo {
  id: string
  scriptId: string | null
  contentId: string | null
  title: string
  template: VideoTemplate
  templateLabel: string
  duration: VideoDuration
  ratio: VideoRatio
  style: VideoStyle
  provider: VideoProvider
  model?: string
  brief: string
  storeId: string
  status: VideoStatus
  videoUrl: string | null
  thumbnail: string | null
  storagePath?: string
  /** Inti Warna template requested for this video (logo, hook, captions, end card). */
  brandTemplate?: boolean
  brandTemplateApplied?: boolean
  /** Same video without branding (for further editing). */
  cleanVideoUrl?: string | null
  /** AI-written captions per platform (editable). */
  socialCaptions?: SocialCaptions
  lastSocialPost?: { platform: string; account: string; permalink: string | null; at?: TS }
  actualDurationSec?: number
  segments: VideoSegment[]
  progress: { done: number; total: number }
  plan?: { segmentDurations: number[]; voiceOverText: string; hookText?: string; captions?: string[]; source: string }
  attempts: number
  error: string | null
  platform?: Platform | null
  publishedUrl?: string
  publishedAt?: TS
  startedAt?: TS
  completedAt?: TS
  createdBy: string
  createdAt?: TS
  updatedAt?: TS
  demo?: boolean
}

export interface PerformanceRecord {
  id: string
  videoId: string
  title: string
  platform: Platform
  storeId: string
  views: number
  likes: number
  comments: number
  shares: number
  leads: number
  salesImpact: number
  engagementRate: number
  publishedUrl?: string
  updatedBy: string
  updatedAt?: TS
  demo?: boolean
}

export interface CalendarEntry {
  id: string
  title: string
  date: string // YYYY-MM-DD
  platform: Platform
  status: CalendarStatus
  contentId: string | null
  videoId: string | null
  notes: string
  storeId: string
  createdBy: string
  createdAt?: TS
  updatedAt?: TS
  demo?: boolean
}

export interface AiActivityDay {
  date: string
  trends: number
  ideas: number
  scripts: number
  videos: number
  total: number
}

export interface AiActivity {
  days: AiActivityDay[]
  total: number
  videoResults: { succeeded: number; failed: number; processing: number }
}

export interface StatsDoc {
  scope: string
  totals: {
    videos: number
    completedVideos: number
    publishedVideos: number
    ideas: number
    scripts: number
    trends: number
    trackedContent: number
    views: number
    likes: number
    comments: number
    shares: number
    leads: number
    salesImpact: number
  }
  avgEngagementRate: number
  statusBreakdown: Record<VideoStatus, number>
  /** Added with the dashboard redesign; missing on stats docs computed before it. */
  aiActivity?: AiActivity
  contentGrowth: { month: string; ideas: number; scripts: number; videos: number }[]
  platformPerformance: { platform: string; posts: number; views: number; likes: number; comments: number; shares: number; leads: number; engagementRate: number }[]
  topContent: { videoId: string; title: string; platform: string; thumbnail: string | null; views: number; engagementRate: number; leads: number; salesImpact: number }[]
  topTrend: { id: string; trendName: string; trendScore: number; growthLevel: string; recommendation: string; platform: string } | null
  updatedAt?: TS
}

export interface BrandKit {
  enabled: boolean
  captions: boolean
  endCard: boolean
  instagram: string
  whatsapp: string
  website: string
  hours: string
  ctaText: string
}

export interface AppSettings {
  textProvider: TextProvider
  videoProvider: VideoProvider
  contentLanguage: 'id' | 'en'
  brandContext: string
  heygenAvatarId: string
  heygenVoiceId: string
  brandKit?: Partial<BrandKit>
  social?: { autoPost?: boolean }
  updatedAt?: TS
  updatedBy?: string
}

export interface AuditLog {
  id: string
  actorUid: string | null
  actorEmail: string | null
  actorRole: string | null
  action: string
  entity: string
  entityId: string | null
  details: Record<string, unknown>
  createdAt?: TS
}

export interface ProviderStatus {
  id: string
  label: string
  configured: boolean
  model: string
  mode?: 'clips' | 'full'
}

export interface SocialCaptions {
  instagram: string
  tiktok: string
  facebook: string
  youtubeTitle: string
  youtubeDescription: string
  hashtags: string[]
  provider?: string
  generatedAt?: TS
  editedAt?: TS
}

export type SocialAccountStatus = 'connected' | 'reconnect'
export interface SocialAccount {
  id: string
  platform: 'instagram'
  externalId: string
  username: string
  accountType: string
  pictureUrl: string
  /** 'ALL' = brand-wide account, otherwise the store it posts for. */
  storeId: string
  status: SocialAccountStatus
  error: string | null
  connectedBy: string
  connectedAt?: TS
  tokenExpiresAt?: TS
}

export type SocialPostStatus = 'Scheduled' | 'Publishing' | 'Published' | 'Failed' | 'Cancelled'
export interface SocialPost {
  id: string
  videoId: string
  videoTitle: string
  storeId: string
  platform: 'instagram'
  accountId: string
  accountName: string
  caption: string
  status: SocialPostStatus
  scheduledAt?: TS
  auto?: boolean
  permalink: string | null
  error: string | null
  createdBy: string
  createdAt?: TS
  publishedAt?: TS
}

export interface IntegrationStatus {
  text: ProviderStatus[]
  video: ProviderStatus[]
  defaults: { textProvider: TextProvider; videoProvider: VideoProvider; contentLanguage: 'id' | 'en' }
  geminiMode: 'vertex' | 'api-key'
  limits: { aiDaily: number; videoDaily: number }
  usageToday: { ai: number; video: number }
  region: string
  social?: { instagram: { configured: boolean; redirectUri: string; appIdSet: boolean } }
}
