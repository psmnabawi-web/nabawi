import type { AppSettings, BrandKit } from '../types'

export const DEFAULT_BRAND_KIT: BrandKit = { enabled: true, captions: true, endCard: true, instagram: '', whatsapp: '', website: '', hours: '', ctaText: '' }

/** Stored brand kit merged over the defaults (every field is optional in Firestore). */
export const brandKitOf = (settings: AppSettings | null | undefined): BrandKit => ({ ...DEFAULT_BRAND_KIT, ...(settings?.brandKit ?? {}) })
