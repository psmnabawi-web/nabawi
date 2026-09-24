import {
  collection,
  deleteDoc,
  doc,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Query,
  type QueryConstraint,
} from 'firebase/firestore'
import { auth, db } from '../firebase/config'
import { ALL_STORES, type AppSettings, type BrandKit, type Platform, type SocialCaptions, type UserProfile } from '../types'
import type { CalendarInput, PerformanceInput, SourceInput, StoreInput } from '../utils/validation'
import { engagementRate } from '../utils/engagement'

/**
 * Modular Firestore service layer. Every list query for a store manager is constrained to
 * storeId in [myStore, 'ALL'] — required by the security rules.
 */

const uid = () => {
  const u = auth.currentUser?.uid
  if (!u) throw new Error('Not signed in')
  return u
}

export const isContentManager = (p: UserProfile | null) => p?.role === 'super_admin' || p?.role === 'marketing_manager'
export const isAdmin = (p: UserProfile | null) => p?.role === 'super_admin'

/** Store scope constraint. selectedStoreId '' = all stores (content managers only). */
export function scopeConstraints(profile: UserProfile | null, selectedStoreId: string): QueryConstraint[] {
  if (!profile) return [where('storeId', '==', '__none__')]
  if (profile.role === 'store_manager') return [where('storeId', 'in', [profile.storeId ?? '__none__', ALL_STORES])]
  if (selectedStoreId) return [where('storeId', 'in', selectedStoreId === ALL_STORES ? [ALL_STORES] : [selectedStoreId, ALL_STORES])]
  return []
}

export const scopedQuery = (name: string, profile: UserProfile | null, selectedStoreId: string, ...extra: QueryConstraint[]): Query =>
  query(collection(db, name), ...scopeConstraints(profile, selectedStoreId), ...extra)

export const recentScoped = (name: string, profile: UserProfile | null, selectedStoreId: string, max = 100) =>
  scopedQuery(name, profile, selectedStoreId, orderBy('createdAt', 'desc'), limit(max))

// ------------------------------------------------------------------ users
export const updateOwnName = (name: string) => updateDoc(doc(db, 'users', uid()), { name: name.trim(), updatedAt: serverTimestamp() })
export const usersQuery = () => query(collection(db, 'users'), orderBy('createdAt', 'desc'))

// ------------------------------------------------------------------ stores
export const storesQuery = () => query(collection(db, 'stores'), orderBy('storeName'))

export async function createStore(storeId: string, input: StoreInput) {
  await setDoc(doc(db, 'stores', storeId), { storeId, ...input, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
}
export const updateStore = (storeId: string, input: StoreInput) =>
  updateDoc(doc(db, 'stores', storeId), { ...input, updatedAt: serverTimestamp(), updatedBy: uid() })
export const deleteStore = (storeId: string) => deleteDoc(doc(db, 'stores', storeId))

// ------------------------------------------------------------------ social sources
export async function createSource(input: SourceInput) {
  const ref = doc(collection(db, 'social_sources'))
  await setDoc(ref, { ...input, createdBy: uid(), createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
  return ref.id
}
export const updateSource = (id: string, input: SourceInput) => updateDoc(doc(db, 'social_sources', id), { ...input, updatedAt: serverTimestamp(), updatedBy: uid() })
export const deleteSource = (id: string) => deleteDoc(doc(db, 'social_sources', id))

// ------------------------------------------------------------------ trends / ideas / scripts
export const deleteTrend = (id: string) => deleteDoc(doc(db, 'trend_analysis', id))

export const updateIdea = (id: string, patch: Partial<{ title: string; hook: string; storyline: string; cta: string; favorite: boolean; status: string }>) =>
  updateDoc(doc(db, 'content_ideas', id), { ...patch, updatedAt: serverTimestamp(), updatedBy: uid() })
export const deleteIdea = (id: string) => deleteDoc(doc(db, 'content_ideas', id))

export const updateScript = (id: string, patch: Record<string, unknown>) => updateDoc(doc(db, 'video_scripts', id), { ...patch, updatedAt: serverTimestamp(), updatedBy: uid() })
export const deleteScript = (id: string) => deleteDoc(doc(db, 'video_scripts', id))

// ------------------------------------------------------------------ videos
export const renameVideo = (id: string, title: string) => updateDoc(doc(db, 'generated_videos', id), { title: title.trim(), updatedAt: serverTimestamp(), updatedBy: uid() })
export const publishVideo = (id: string, platform: Platform, publishedUrl: string) =>
  updateDoc(doc(db, 'generated_videos', id), { status: 'Published', platform, publishedUrl, publishedAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: uid() })
export const unpublishVideo = (id: string) => updateDoc(doc(db, 'generated_videos', id), { status: 'Completed', updatedAt: serverTimestamp(), updatedBy: uid() })
export const deleteVideo = (id: string) => deleteDoc(doc(db, 'generated_videos', id))
export const saveSocialCaptions = (id: string, captions: SocialCaptions) =>
  updateDoc(doc(db, 'generated_videos', id), { socialCaptions: { ...captions, editedAt: serverTimestamp() }, updatedAt: serverTimestamp(), updatedBy: uid() })

// ------------------------------------------------------------------ social accounts & posts
export const socialAccountsQuery = () => query(collection(db, 'social_accounts'), orderBy('username'))
export const saveSocialSettings = (social: { autoPost: boolean }) => setDoc(doc(db, 'settings', 'app'), { social, updatedAt: serverTimestamp(), updatedBy: uid() }, { merge: true })

// ------------------------------------------------------------------ performance (doc id = videoId)
export async function savePerformance(video: { id: string; title: string; storeId: string }, input: PerformanceInput) {
  await setDoc(doc(db, 'performance', video.id), {
    videoId: video.id,
    title: video.title.slice(0, 160),
    storeId: video.storeId,
    ...input,
    engagementRate: engagementRate(input),
    updatedBy: uid(),
    updatedAt: serverTimestamp(),
  })
}

/** Bulk upsert (Excel import). Chunks of 400 writes per batch. */
export async function savePerformanceBulk(items: { video: { id: string; title: string; storeId: string }; input: PerformanceInput }[]) {
  for (let i = 0; i < items.length; i += 400) {
    const batch = writeBatch(db)
    for (const { video, input } of items.slice(i, i + 400)) {
      batch.set(doc(db, 'performance', video.id), {
        videoId: video.id,
        title: video.title.slice(0, 160),
        storeId: video.storeId,
        ...input,
        engagementRate: engagementRate(input),
        updatedBy: uid(),
        updatedAt: serverTimestamp(),
      })
    }
    await batch.commit()
  }
}

// ------------------------------------------------------------------ campaign calendar
export const calendarQuery = (profile: UserProfile | null, selectedStoreId: string, from: string, to: string) =>
  scopedQuery('campaign_calendar', profile, selectedStoreId, where('date', '>=', from), where('date', '<=', to), orderBy('date'))

export async function createCalendarEntry(input: CalendarInput) {
  const ref = doc(collection(db, 'campaign_calendar'))
  await setDoc(ref, { ...input, createdBy: uid(), createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
  return ref.id
}
export const updateCalendarEntry = (id: string, input: CalendarInput) =>
  updateDoc(doc(db, 'campaign_calendar', id), { ...input, updatedAt: serverTimestamp(), updatedBy: uid() })
export const deleteCalendarEntry = (id: string) => deleteDoc(doc(db, 'campaign_calendar', id))

// ------------------------------------------------------------------ settings & logs
// merge: the AI and brand template tabs each save their own fields of settings/app.
export const saveSettings = (s: Omit<AppSettings, 'updatedAt' | 'updatedBy' | 'brandKit'>) => setDoc(doc(db, 'settings', 'app'), { ...s, updatedAt: serverTimestamp(), updatedBy: uid() }, { merge: true })
export const saveBrandKit = (brandKit: BrandKit) => setDoc(doc(db, 'settings', 'app'), { brandKit, updatedAt: serverTimestamp(), updatedBy: uid() }, { merge: true })
export const auditLogQuery = (max = 200) => query(collection(db, 'audit_logs'), orderBy('createdAt', 'desc'), limit(max))

export const statsDocId = (profile: UserProfile | null, selectedStoreId: string) => {
  if (profile?.role === 'store_manager') return profile.storeId ? `store_${profile.storeId}` : null
  return selectedStoreId && selectedStoreId !== ALL_STORES ? `store_${selectedStoreId}` : 'global'
}
