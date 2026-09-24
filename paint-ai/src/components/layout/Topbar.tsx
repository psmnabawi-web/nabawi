import { ChevronDown, LogOut, Menu, Store as StoreIcon, UserRound } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../../hooks/useAuth'
import { useStoreScope } from '../../hooks/useStoreScope'
import { isContentManager } from '../../services/firestore'
import { ROLE_LABELS } from '../../utils/constants'

export function Topbar({ onMenu }: { onMenu: () => void }) {
  const { profile, signOut } = useAuth()
  const { stores, selectedStoreId, setSelectedStoreId, storeName } = useStoreScope()
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const initials = (profile?.name ?? '?')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6">
      <button type="button" onClick={onMenu} className="rounded-md p-2 text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Open menu">
        <Menu className="size-5" />
      </button>

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <StoreIcon className="hidden size-4 shrink-0 text-slate-400 sm:block" aria-hidden />
        {isContentManager(profile) ? (
          <label className="min-w-0">
            <span className="sr-only">Store scope</span>
            <select
              value={selectedStoreId}
              onChange={(e) => setSelectedStoreId(e.target.value)}
              className="max-w-[60vw] truncate rounded-lg border border-slate-200 bg-white py-1.5 pr-8 pl-2.5 text-sm font-medium text-slate-800 sm:max-w-xs"
            >
              <option value="">All stores</option>
              <option value="ALL">Brand-wide content only</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.storeName}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span className="truncate text-sm font-medium text-slate-800">{storeName(profile?.storeId)}</span>
        )}
      </div>

      <div className="relative" ref={menuRef}>
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-lg p-1.5 hover:bg-slate-100" aria-haspopup="menu" aria-expanded={open}>
          {profile?.photoURL ? (
            <img src={profile.photoURL} alt="" className="size-8 rounded-full object-cover" referrerPolicy="no-referrer" />
          ) : (
            <span className="flex size-8 items-center justify-center rounded-full bg-brand-900 text-xs font-semibold text-white">{initials}</span>
          )}
          <span className="hidden text-left leading-tight md:block">
            <span className="block max-w-[160px] truncate text-sm font-medium text-slate-900">{profile?.name}</span>
            <span className="block text-xs text-slate-500">{profile ? ROLE_LABELS[profile.role] : ''}</span>
          </span>
          <ChevronDown className="hidden size-4 text-slate-400 md:block" aria-hidden />
        </button>
        {open && (
          <div role="menu" className="absolute right-0 mt-2 w-56 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
            <div className="border-b border-slate-100 px-3 py-2">
              <p className="truncate text-sm font-medium text-slate-900">{profile?.name}</p>
              <p className="truncate text-xs text-slate-500">{profile?.email}</p>
            </div>
            <Link role="menuitem" to="/settings" onClick={() => setOpen(false)} className="flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
              <UserRound className="size-4" /> Profile & settings
            </Link>
            <button role="menuitem" type="button" onClick={() => signOut()} className="flex w-full items-center gap-2 px-3 py-2 text-sm text-rose-700 hover:bg-rose-50">
              <LogOut className="size-4" /> Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  )
}
