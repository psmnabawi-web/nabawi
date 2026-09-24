import type { TS } from '../types'

const nf = new Intl.NumberFormat('id-ID')
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
const idr = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 })

export const formatNumber = (n: number | null | undefined) => nf.format(Number(n ?? 0))
export const formatCompact = (n: number | null | undefined) => compact.format(Number(n ?? 0))
export const formatCurrency = (n: number | null | undefined) => idr.format(Number(n ?? 0))
export const formatPercent = (n: number | null | undefined, digits = 2) => `${Number(n ?? 0).toFixed(digits)}%`

export function toDate(ts: TS | Date | string | null | undefined): Date | null {
  if (!ts) return null
  if (ts instanceof Date) return ts
  if (typeof ts === 'string') {
    const d = new Date(ts)
    return Number.isNaN(d.getTime()) ? null : d
  }
  if (typeof ts.toDate === 'function') return ts.toDate()
  return null
}

export function formatDate(ts: TS | Date | string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) {
  const d = toDate(ts)
  return d ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', ...opts }).format(d) : '—'
}

export const formatDateTime = (ts: TS | Date | string | null | undefined) =>
  formatDate(ts, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export function timeAgo(ts: TS | Date | string | null | undefined): string {
  const d = toDate(ts)
  if (!d) return 'just now'
  const sec = Math.round((Date.now() - d.getTime()) / 1000)
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  if (Math.abs(sec) < 60) return rtf.format(-sec, 'second')
  const min = Math.round(sec / 60)
  if (Math.abs(min) < 60) return rtf.format(-min, 'minute')
  const hr = Math.round(min / 60)
  if (Math.abs(hr) < 24) return rtf.format(-hr, 'hour')
  const day = Math.round(hr / 24)
  if (Math.abs(day) < 30) return rtf.format(-day, 'day')
  return formatDate(d)
}

/** 'YYYY-MM' → 'Sep 26' */
export function monthLabel(key: string) {
  const [y, m] = key.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 15)))
}

/** 'YYYY-MM-DD' → 'Sep 24' */
export function dayLabel(key: string) {
  const [y, m, d] = key.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)))
}

/** Local date key YYYY-MM-DD in Asia/Jakarta. */
export function dateKey(d: Date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

export function slugify(input: string) {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}
