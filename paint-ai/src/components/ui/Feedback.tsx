import { AlertTriangle, Info, Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../../utils/cn'

export function Spinner({ className, label = 'Loading' }: { className?: string; label?: string }) {
  return <Loader2 className={cn('size-5 animate-spin text-brand-700', className)} role="status" aria-label={label} />
}

export function PageLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex min-h-[40vh] items-center justify-center gap-3 text-sm text-slate-500">
      <Spinner /> {label}
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-slate-200/70', className)} aria-hidden />
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      {icon && <div className="mb-3 rounded-full bg-brand-50 p-3 text-brand-700">{icon}</div>}
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {description && <p className="mt-1 max-w-md text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Alert({ kind = 'error', title, children, action }: { kind?: 'error' | 'info' | 'warning'; title?: string; children?: ReactNode; action?: ReactNode }) {
  const styles = {
    error: 'border-rose-200 bg-rose-50 text-rose-800',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
    info: 'border-brand-200 bg-brand-50 text-brand-900',
  }[kind]
  const Icon = kind === 'info' ? Info : AlertTriangle
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={cn('flex gap-3 rounded-lg border px-4 py-3 text-sm', styles)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(title && 'mt-0.5')}>{children}</div>}
      </div>
      {action}
    </div>
  )
}
