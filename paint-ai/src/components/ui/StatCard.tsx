import type { ReactNode } from 'react'
import { cn } from '../../utils/cn'

export function StatCard({ label, value, hint, icon, className }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; className?: string }) {
  return (
    <div className={cn('card flex items-start gap-4 p-5', className)}>
      {icon && <div className="rounded-lg bg-brand-50 p-2.5 text-brand-800">{icon}</div>}
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-500">{label}</p>
        <p className="mt-1 truncate text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">{value}</p>
        {hint && <p className="mt-1 truncate text-xs text-slate-500">{hint}</p>}
      </div>
    </div>
  )
}
