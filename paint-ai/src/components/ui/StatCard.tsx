import { ArrowRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { cn } from '../../utils/cn'

export function StatCard({
  label,
  value,
  hint,
  icon,
  link,
  className,
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  icon?: ReactNode
  link?: { to: string; label: string }
  className?: string
}) {
  return (
    <div className={cn('card flex items-start gap-4 rounded-3xl p-6', className)}>
      {icon && <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-800 sm:size-14">{icon}</div>}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[28px] leading-tight font-semibold tracking-tight text-slate-900 tabular-nums">{value}</p>
        <p className="mt-1 text-[15px] font-medium text-slate-800">{label}</p>
        {hint && <p className="mt-0.5 truncate text-sm text-slate-500">{hint}</p>}
        {link && (
          <Link to={link.to} className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-brand-800 hover:underline">
            {link.label} <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        )}
      </div>
    </div>
  )
}
