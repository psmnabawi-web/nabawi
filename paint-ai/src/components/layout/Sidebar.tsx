import { BarChart3, CalendarDays, Clapperboard, LayoutDashboard, Settings, Sparkles, TrendingUp, X } from 'lucide-react'
import { NavLink } from 'react-router'
import { cn } from '../../utils/cn'

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/trends', label: 'Trend Intelligence', icon: TrendingUp },
  { to: '/content', label: 'Content Generator', icon: Sparkles },
  { to: '/video', label: 'Video Studio', icon: Clapperboard },
  { to: '/calendar', label: 'Campaign Calendar', icon: CalendarDays },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export function Brand({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <img src="/favicon.svg" alt="" className="size-8 rounded-lg ring-1 ring-white/20" />
      {!compact && (
        <div className="leading-tight">
          <p className="text-sm font-semibold text-white">Content Intelligence</p>
          <p className="text-[11px] text-brand-200">Retail Paint · AI Studio</p>
        </div>
      )}
    </div>
  )
}

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = (
    <nav className="flex flex-1 flex-col gap-1 px-3 py-4" aria-label="Main">
      {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onClose}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition',
              isActive ? 'bg-white/10 text-white shadow-inner ring-1 ring-white/10' : 'text-brand-100/80 hover:bg-white/5 hover:text-white',
            )
          }
        >
          <Icon className="size-[18px] shrink-0" aria-hidden />
          {label}
        </NavLink>
      ))}
    </nav>
  )
  return (
    <>
      {/* Desktop */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-brand-950 lg:flex">
        <div className="flex h-16 items-center border-b border-white/10 px-5">
          <Brand />
        </div>
        {nav}
        <p className="px-5 pb-4 text-[11px] text-brand-200/60">AI Marketing Assistant for paint & building material retail</p>
      </aside>
      {/* Mobile drawer */}
      <div className={cn('fixed inset-0 z-40 lg:hidden', open ? 'pointer-events-auto' : 'pointer-events-none')} aria-hidden={!open}>
        <div className={cn('absolute inset-0 bg-slate-900/50 transition-opacity', open ? 'opacity-100' : 'opacity-0')} onClick={onClose} />
        <aside className={cn('absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-brand-950 shadow-xl transition-transform', open ? 'translate-x-0' : '-translate-x-full')}>
          <div className="flex h-16 items-center justify-between border-b border-white/10 px-5">
            <Brand />
            <button type="button" onClick={onClose} className="rounded-md p-1 text-brand-100 hover:bg-white/10" aria-label="Close menu">
              <X className="size-5" />
            </button>
          </div>
          {nav}
        </aside>
      </div>
    </>
  )
}
