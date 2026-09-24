import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase/config'
import type { IntegrationStatus, Role, TextProvider, VideoProvider } from '../types'
import { AI_CALL_TIMEOUT_MS } from '../utils/constants'
import type { ContentRequest, ScriptRequest, VideoRequest } from '../utils/validation'

/** Typed wrappers around the Cloud Functions callables. */
function callable<I, O>(name: string, timeout = 70_000) {
  const fn = httpsCallable<I, O>(functions, name, { timeout })
  // Drop undefined keys: the SDK would send them as null.
  return async (data: I): Promise<O> => (await fn(JSON.parse(JSON.stringify(data ?? {})) as I)).data
}

export const bootstrapProfile = callable<{ name?: string }, { role: Role; created: boolean }>('bootstrapProfile')

export const manageUser = callable<
  | { action: 'create'; email: string; password: string; name: string; role: Role; storeId: string | null }
  | { action: 'update'; uid: string; name?: string; role?: Role; storeId?: string | null; active?: boolean },
  { uid: string }
>('manageUser')

export const analyzeTrend = callable<{ sourceId: string; provider?: TextProvider }, { trendId: string; trendName: string; trendScore: number; provider: string; model: string }>(
  'analyzeTrend',
  AI_CALL_TIMEOUT_MS,
)

export const generateContent = callable<ContentRequest & { provider?: TextProvider }, { batchId: string; count: number; ideaIds: string[]; provider: string; model: string }>(
  'generateContent',
  AI_CALL_TIMEOUT_MS,
)

export const generateScript = callable<ScriptRequest & { provider?: TextProvider }, { scriptId: string; provider: string; model: string }>('generateScript', AI_CALL_TIMEOUT_MS)

export const generateVideo = callable<VideoRequest & { provider: VideoProvider }, { videoId: string; status: string; segments?: number }>('generateVideo', AI_CALL_TIMEOUT_MS)

export const videoAction = callable<{ videoId: string; action: 'start' | 'refresh' | 'retry' | 'brand' }, { status: string; busy?: boolean; done?: number; total?: number; branded?: boolean }>(
  'videoAction',
  AI_CALL_TIMEOUT_MS,
)

export const calculatePerformance = callable<Record<string, never>, { scopes: number }>('calculatePerformance', 300_000)

export const getIntegrationStatus = callable<Record<string, never>, IntegrationStatus>('getIntegrationStatus')

export const seedDemoData = callable<{ action: 'seed' | 'remove' }, { written?: number; removed?: number }>('seedDemoData', 120_000)
