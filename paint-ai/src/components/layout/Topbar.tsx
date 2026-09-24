import { Bell, CheckCircle2, Clapperboard, Loader2, LogOut, Menu, UserRound, XCircle } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../../hooks/useAuth'
import { useCollection } from '../../hooks/useFirestore'
import { useStoreScope } from '../../hooks/useStoreScope'
import { isContentManager, recentScoped } from '../../services/firestore'
import type { GeneratedVideo } from '../../types'
import { BRAND, ROLE_LABELS } from '../../utils/constants'
import { toDate, timeAgo } from '../../utils/format'

/** Closes a popover on outside click / Escape. */
function useDismiss(open: boolean, ref: RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, ref, close])
}

const seenKey = (uid: string) => `notifications-seen:${uid}`
function readSeen(uid: string): number {
  try {
    return Number(localStorage.getItem(seenKey(uid)) ?? 0) || 0
  } catch {
    return 0
  }
}
function writeSeen(uid: string, at: number) {
  try {
    localStorage.setItem(seenKey(uid), String(at))
  } catch {
    /* storage unavailable: unread dot just resets */
  }
}

const EVENT: Record<string, { icon: ReactNode; text: string }> = {
  Completed: { icon: <CheckCircle2 className="size-4 text-emerald-600" aria-hidden />, text: 'is ready' },
  Published: { icon: <CheckCircle2 className="size-4 text-brand-700" aria-hidden />, text: 'was published' },
  Failed: { icon: <XCircle className="size-4 text-rose-600" aria-hidden />, text: 'failed' },
  Processing: { icon: <Loader2 className="size-4 text-blue-600" aria-hidden />, text: 'is being generated' },
  Draft: { icon: <Clapperboard className="size-4 text-slate-500" aria-hidden />, text: 'was saved as draft' },
}

/** Video activity feed (latest videos in the current scope) with an unread dot. */
function NotificationsMenu() {
  const { profile } = useAuth()
  const { selectedStoreId } = useStoreScope()
  const videos = useCollection<GeneratedVideo>(() => recentScoped('generated_videos', profile, selectedStoreId, 8), [profile?.uid, profile?.role, profile?.storeId, selectedStoreId])
  const [open, setOpen] = useState(false)
  const [seenOverride, setSeenOverride] = useState<number | null>(null)
  const seenAt = seenOverride ?? (profile ? readSeen(profile.uid) : 0)
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(open, ref, () => setOpen(false))

  const changedAt = (v: GeneratedVideo) => toDate(v.updatedAt)?.getTime() ?? toDate(v.createdAt)?.getTime() ?? 0
  const items = [...videos.data].sort((a, b) => changedAt(b) - changedAt(a))
  const unread = items.filter((v) => changedAt(v) > seenAt).length

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next && profile) {
      const now = Date.now()
      writeSeen(profile.uid, now)
      setSeenOverride(now)
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={toggle} className="relative rounded-full p-2.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900" aria-haspopup="menu" aria-expanded={open} aria-label={unread ? `Notifications, ${unread} new` : 'Notifications'}>
        <Bell className="size-5" />
        {unread > 0 && <span className="absolute top-1.5 right-1.5 size-2.5 rounded-full bg-rose-500 ring-2 ring-white" aria-hidden />}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl bg-white shadow-soft ring-1 ring-slate-900/5">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-semibold text-slate-900">Notifications</p>
            <span className="text-xs text-slate-500">Video activity</span>
          </div>
          <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
            {items.map((v) => {
              const e = EVENT[v.status] ?? EVENT.Draft
              return (
                <li key={v.id}>
                  <Link role="menuitem" to="/video" onClick={() => setOpen(false)} className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50">
                    <span className="mt-0.5">{e.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-slate-800">
                        <span className="font-medium">{v.title}</span> {e.text}
                      </span>
                      <span className="block text-xs text-slate-500">{timeAgo(v.updatedAt ?? v.createdAt)}</span>
                    </span>
                  </Link>
                </li>
              )
            })}
            {!videos.loading && !items.length && <li className="px-4 py-6 text-center text-sm text-slate-500">No activity yet.</li>}
            {videos.error && <li className="px-4 py-3 text-sm text-rose-600">{videos.error}</li>}
          </ul>
        </div>
      )}
    </div>
  )
}

function UserMenu() {
  const { profile, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(open, ref, () => setOpen(false))
  const initials = (profile?.name ?? '?')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center rounded-full p-1 hover:bg-slate-100" aria-haspopup="menu" aria-expanded={open} aria-label="Account menu">
        {profile?.photoURL ? (
          <img src={profile.photoURL} alt="" className="size-9 rounded-full object-cover ring-2 ring-white" referrerPolicy="no-referrer" />
        ) : (
          <span className="flex size-9 items-center justify-center rounded-full bg-brand-800 text-xs font-semibold text-white">{initials}</span>
        )}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 mt-2 w-64 overflow-hidden rounded-2xl bg-white py-1 shadow-soft ring-1 ring-slate-900/5">
          <div className="border-b border-slate-100 px-4 py-3">
            <p className="truncate text-sm font-semibold text-slate-900">{profile?.name}</p>
            <p className="truncate text-xs text-slate-500">{profile?.email}</p>
            {profile && <p className="mt-1 text-xs font-medium text-brand-800">{ROLE_LABELS[profile.role]}</p>}
          </div>
          <Link role="menuitem" to="/settings" onClick={() => setOpen(false)} className="flex items-center gap-2 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50">
            <UserRound className="size-4" /> Profile & settings
          </Link>
          <button role="menuitem" type="button" onClick={() => signOut()} className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-rose-600 hover:bg-rose-50">
            <LogOut className="size-4" /> Sign out
          </button>
        </div>
      )}
    </div>
  )
}

/** Compact store scope for small screens (the sidebar card is hidden there). */
function MobileScope() {
  const { profile } = useAuth()
  const { stores, selectedStoreId, setSelectedStoreId } = useStoreScope()
  if (!isContentManager(profile)) return null
  return (
    <label className="min-w-0 lg:hidden">
      <span className="sr-only">Store scope</span>
      <select
        value={selectedStoreId}
        onChange={(e) => setSelectedStoreId(e.target.value)}
        className="max-w-[42vw] truncate rounded-full border border-slate-200 bg-white py-1.5 pr-8 pl-3 text-sm font-medium text-slate-800"
      >
        <option value="">All stores</option>
        <option value="ALL">Brand-wide only</option>
        {stores.map((s) => (
          <option key={s.id} value={s.id}>
            {s.storeName}
          </option>
        ))}
      </select>
    </label>
  )
}

export function Topbar({ onMenu }: { onMenu: () => void }) {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-2 border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6 lg:h-20">
      <button type="button" onClick={onMenu} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Open menu">
        <Menu className="size-5" />
      </button>
      <img src={BRAND.markUrl} alt={BRAND.name} className="h-7 w-auto lg:hidden" />
      <div className="flex min-w-0 flex-1 items-center justify-end gap-1 sm:gap-2">
        <MobileScope />
        <NotificationsMenu />
        <UserMenu />
      </div>
    </header>
  )
}
