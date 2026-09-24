import { BarChart3, CalendarDays, ChevronDown, ChevronLeft, Clapperboard, LayoutDashboard, LogOut, Settings, Sparkles, Store as StoreIcon, TrendingUp, X } from 'lucide-react'
import type { ComponentType } from 'react'
import { NavLink } from 'react-router'
import { useAuth } from '../../hooks/useAuth'
import { useStoreScope } from '../../hooks/useStoreScope'
import { isContentManager } from '../../services/firestore'
import { BRAND } from '../../utils/constants'
import { cn } from '../../utils/cn'

interface NavItem {
  to: string
  label: string
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
  end?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/trends', label: 'Trend Intelligence', icon: TrendingUp },
  { to: '/content', label: 'Content Generator', icon: Sparkles },
  { to: '/video', label: 'Video Studio', icon: Clapperboard },
  { to: '/calendar', label: 'Campaign Calendar', icon: CalendarDays },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
]
const SETTINGS_ITEM: NavItem = { to: '/settings', label: 'Settings', icon: Settings }

/** App identity: brand mark + product name. */
export function Brand({ compact }: { compact?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <img src={BRAND.markUrl} alt={BRAND.name} className="h-9 w-auto shrink-0" />
      {!compact && (
        <div className="min-w-0 leading-tight">
          <p className="truncate text-[17px] font-bold text-slate-900">{BRAND.name}</p>
          <p className="truncate text-[13px] text-slate-500">Content Intelligence</p>
        </div>
      )}
    </div>
  )
}

/** Store scope switcher styled as a card (content managers) or a read-only card (store managers). */
function StoreSwitcher({ compact }: { compact?: boolean }) {
  const { profile } = useAuth()
  const { stores, selectedStoreId, setSelectedStoreId, storeName } = useStoreScope()
  const manager = isContentManager(profile)
  const current = manager ? (selectedStoreId === '' ? 'All stores' : selectedStoreId === 'ALL' ? 'Brand-wide content' : storeName(selectedStoreId)) : storeName(profile?.storeId)

  const tile = (
    <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-orange-400 to-rose-500 text-white shadow-sm">
      <StoreIcon className="size-5" aria-hidden />
    </span>
  )
  return (
    <div className={cn('relative flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-2.5 transition', manager && 'focus-within:ring-2 focus-within:ring-brand-500/30 hover:border-slate-300', compact && 'justify-center border-transparent p-1')} title={compact ? current : undefined}>
      {tile}
      {!compact && (
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block text-xs text-slate-500">{manager ? 'Store scope' : 'My store'}</span>
          <span className="block truncate text-[15px] font-semibold text-slate-900 uppercase">{current || '—'}</span>
        </span>
      )}
      {manager && !compact && <ChevronDown className="size-4 shrink-0 text-slate-500" aria-hidden />}
      {manager && (
        <select
          aria-label="Store scope"
          value={selectedStoreId}
          onChange={(e) => setSelectedStoreId(e.target.value)}
          className="absolute inset-0 size-full cursor-pointer appearance-none opacity-0"
        >
          <option value="">All stores</option>
          <option value="ALL">Brand-wide content only</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.storeName}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}

function NavEntry({ item, compact, onNavigate }: { item: NavItem; compact?: boolean; onNavigate: () => void }) {
  const { to, label, icon: Icon, end } = item
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onNavigate}
      title={compact ? label : undefined}
      className={({ isActive }) =>
        cn(
          'flex h-12 items-center gap-3 rounded-xl px-4 text-[15px] font-medium transition',
          compact && 'justify-center px-0',
          isActive ? 'bg-brand-50 text-brand-800 ring-2 ring-brand-600/60 ring-inset' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
        )
      }
    >
      <Icon className="size-5 shrink-0" aria-hidden />
      <span className={cn('truncate', compact && 'sr-only')}>{label}</span>
    </NavLink>
  )
}

function SidebarBody({ compact, onNavigate }: { compact?: boolean; onNavigate: () => void }) {
  const { signOut } = useAuth()
  return (
    <>
      <div className={cn('px-4 pt-4', compact && 'px-3')}>
        <StoreSwitcher compact={compact} />
      </div>
      <nav className={cn('flex flex-1 flex-col gap-1 overflow-y-auto px-4 py-5', compact && 'px-3')} aria-label="Main">
        {!compact && <p className="px-1 pb-2 text-xs font-semibold tracking-wider text-slate-500 uppercase">Main menu</p>}
        {NAV_ITEMS.map((item) => (
          <NavEntry key={item.to} item={item} compact={compact} onNavigate={onNavigate} />
        ))}
      </nav>
      <div className={cn('flex flex-col gap-1 border-t border-slate-200 px-4 py-4', compact && 'px-3')}>
        <NavEntry item={SETTINGS_ITEM} compact={compact} onNavigate={onNavigate} />
        <button
          type="button"
          onClick={() => signOut()}
          title={compact ? 'Logout' : undefined}
          className={cn('flex h-12 items-center gap-3 rounded-xl px-4 text-[15px] font-medium text-rose-600 transition hover:bg-rose-50', compact && 'justify-center px-0')}
        >
          <LogOut className="size-5 shrink-0" aria-hidden />
          <span className={cn(compact && 'sr-only')}>Logout</span>
        </button>
      </div>
    </>
  )
}

export function Sidebar({ open, onClose, collapsed, onToggleCollapsed }: { open: boolean; onClose: () => void; collapsed: boolean; onToggleCollapsed: () => void }) {
  return (
    <>
      {/* Desktop */}
      <aside className={cn('fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-slate-200 bg-white transition-[width] duration-200 lg:flex', collapsed ? 'w-20' : 'w-72')}>
        <div className={cn('flex h-20 items-center gap-2 border-b border-slate-200 px-5', collapsed && 'justify-center px-2')}>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <Brand />
            </div>
          )}
          <button
            type="button"
            onClick={onToggleCollapsed}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
          >
            {collapsed ? <img src={BRAND.markUrl} alt="" className="h-8 w-auto" /> : <ChevronLeft className="size-5" />}
          </button>
        </div>
        <SidebarBody compact={collapsed} onNavigate={() => undefined} />
      </aside>

      {/* Mobile drawer */}
      <div className={cn('fixed inset-0 z-40 lg:hidden', open ? 'pointer-events-auto' : 'pointer-events-none')} aria-hidden={!open}>
        <div className={cn('absolute inset-0 bg-slate-900/40 transition-opacity', open ? 'opacity-100' : 'opacity-0')} onClick={onClose} />
        <aside className={cn('absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-white shadow-xl transition-transform', open ? 'translate-x-0' : '-translate-x-full')}>
          <div className="flex h-16 items-center justify-between gap-2 border-b border-slate-200 px-4">
            <Brand />
            <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Close menu">
              <X className="size-5" />
            </button>
          </div>
          <SidebarBody onNavigate={onClose} />
        </aside>
      </div>
    </>
  )
}
