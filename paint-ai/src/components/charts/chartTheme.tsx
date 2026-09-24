import { formatNumber } from '../../utils/format'

interface TooltipItem {
  name?: string
  value?: number | string
  color?: string
  dataKey?: string | number
}

export function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipItem[]; label?: string | number }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-semibold text-slate-900">{label}</p>
      {payload.map((p) => (
        <p key={String(p.dataKey)} className="flex items-center gap-2 text-slate-600">
          <span className="inline-block h-0.5 w-3 rounded" style={{ background: p.color }} aria-hidden />
          {p.name}: <span className="ml-auto font-medium text-slate-900 tabular-nums">{formatNumber(Number(p.value ?? 0))}</span>
        </p>
      ))}
    </div>
  )
}
