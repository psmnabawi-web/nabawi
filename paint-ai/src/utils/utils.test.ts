import { describe, expect, it } from 'vitest'
import { engagementRate, roi } from './engagement'
import { monthLabel, slugify } from './format'
import { calendarSchema, isPlatformUrl, performanceSchema, sourceSchema } from './validation'
import { buildExportRows } from './excel'
import type { GeneratedVideo, PerformanceRecord, Store } from '../types'

const baseSource = { platform: 'TikTok', sourceType: 'content', url: 'https://www.tiktok.com/@brand/video/1', keyword: '', category: 'paint', competitor: '', location: 'Jakarta', contentSample: '', storeId: 'ALL' }

describe('engagement', () => {
  it('matches the backend formula', () => {
    expect(engagementRate({ views: 1000, likes: 50, comments: 20, shares: 30 })).toBe(10)
    expect(engagementRate({ views: 0, likes: 50, comments: 0, shares: 0 })).toBe(0)
    expect(engagementRate({ views: 3, likes: 1, comments: 0, shares: 0 })).toBe(33.33)
  })
  it('roi is null without cost', () => {
    expect(roi(1000, 0)).toBeNull()
    expect(roi(1500, 1000)).toBe(50)
  })
})

describe('source validation', () => {
  it('accepts a valid TikTok link', () => {
    expect(sourceSchema.safeParse(baseSource).success).toBe(true)
  })
  it('rejects a URL from another platform or http', () => {
    expect(sourceSchema.safeParse({ ...baseSource, url: 'https://instagram.com/brand' }).success).toBe(false)
    expect(sourceSchema.safeParse({ ...baseSource, url: 'http://tiktok.com/@brand' }).success).toBe(false)
    expect(isPlatformUrl('https://tiktok.com.evil.io/x', 'TikTok')).toBe(false)
  })
  it('hashtag sources need a keyword and get a # prefix', () => {
    expect(sourceSchema.safeParse({ ...baseSource, sourceType: 'hashtag', url: '' }).success).toBe(false)
    const ok = sourceSchema.safeParse({ ...baseSource, sourceType: 'hashtag', url: '', keyword: 'catrumah' })
    expect(ok.success && ok.data.keyword).toBe('#catrumah')
  })
})

describe('performance & calendar validation', () => {
  it('coerces numbers and rejects negatives', () => {
    const ok = performanceSchema.safeParse({ platform: 'TikTok', views: '1000', likes: 10, comments: 1, shares: 1, leads: 0, salesImpact: '250000', publishedUrl: '' })
    expect(ok.success && ok.data.views).toBe(1000)
    expect(performanceSchema.safeParse({ platform: 'TikTok', views: -1, likes: 0, comments: 0, shares: 0, leads: 0, salesImpact: 0, publishedUrl: '' }).success).toBe(false)
    expect(performanceSchema.safeParse({ platform: 'TikTok', views: 10, likes: 0, comments: 0, shares: 0, leads: 0, salesImpact: 0, publishedUrl: 'ftp://x' }).success).toBe(false)
  })
  it('calendar requires ISO date', () => {
    const entry = { title: 'Post', date: '2026-10-01', platform: 'Instagram', status: 'Planned', contentId: null, videoId: null, notes: '', storeId: 'ALL' }
    expect(calendarSchema.safeParse(entry).success).toBe(true)
    expect(calendarSchema.safeParse({ ...entry, date: '1/10/2026' }).success).toBe(false)
  })
})

describe('format helpers', () => {
  it('slugify store ids', () => {
    expect(slugify('Cat XYZ Jakarta')).toBe('cat-xyz-jakarta')
    expect(slugify('  Toko Cat – Bekasi!! ')).toBe('toko-cat-bekasi')
  })
  it('month label', () => {
    expect(monthLabel('2026-09')).toBe('Sep 26')
  })
})

describe('excel export rows', () => {
  it('includes completed/published videos and merges metrics', () => {
    const videos = [
      { id: 'v1', title: 'A', status: 'Published', storeId: 's1', platform: 'TikTok' },
      { id: 'v2', title: 'B', status: 'Draft', storeId: 's1' },
      { id: 'v3', title: 'C', status: 'Completed', storeId: 'ALL' },
    ] as GeneratedVideo[]
    const perf = [{ videoId: 'v1', platform: 'TikTok', views: 100, likes: 5, comments: 1, shares: 1, leads: 2, salesImpact: 1000 }] as PerformanceRecord[]
    const stores = [{ id: 's1', storeName: 'Cat XYZ Jakarta' }] as Store[]
    const rows = buildExportRows(videos, perf, stores)
    expect(rows.map((r) => r.videoId)).toEqual(['v1', 'v3'])
    expect(rows[0]).toMatchObject({ store: 'Cat XYZ Jakarta', views: 100, leads: 2 })
    expect(rows[1].store).toBe('All stores')
  })
})
