import type { ReactNode } from 'react'
import { cn } from '../../utils/cn'

export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset', className ?? 'bg-slate-100 text-slate-700 ring-slate-200')}>{children}</span>
}
