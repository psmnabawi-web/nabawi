import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { AiActivityDay } from '../../types'
import { dayLabel, formatNumber } from '../../utils/format'

/** Single series → one hue (brand indigo); identity comes from the card title, so no legend. */
const BAR = '#45398d'
const PARTS = [
  { key: 'trends', label: 'Trend analyses' },
  { key: 'ideas', label: 'Idea generations' },
  { key: 'scripts', label: 'Scripts' },
  { key: 'videos', label: 'Video jobs' },
] as const

function ActivityTooltip({ active, payload }: { active?: boolean; payload?: { payload: AiActivityDay }[] }) {
  const d = active ? payload?.[0]?.payload : undefined
  if (!d) return null
  return (
    <div className="min-w-44 rounded-xl bg-white px-3 py-2 text-xs shadow-soft ring-1 ring-slate-900/5">
      <p className="mb-1 font-semibold text-slate-900">{dayLabel(d.date)}</p>
      {PARTS.map((p) => (
        <p key={p.key} className="flex justify-between gap-4 text-slate-600">
          {p.label} <span className="font-medium text-slate-900 tabular-nums">{formatNumber(d[p.key])}</span>
        </p>
      ))}
      <p className="mt-1 flex justify-between gap-4 border-t border-slate-100 pt-1 font-medium text-slate-900">
        Total <span className="tabular-nums">{formatNumber(d.total)}</span>
      </p>
    </div>
  )
}

export function AiActivityChart({ days, showTable }: { days: AiActivityDay[]; showTable?: boolean }) {
  if (showTable) {
    const rows = days.filter((d) => d.total > 0).reverse()
    return (
      <div className="max-h-72 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white text-left text-xs text-slate-500">
            <tr>
              <th className="py-2 font-medium">Date</th>
              {PARTS.map((p) => (
                <th key={p.key} className="py-2 text-right font-medium">
                  {p.label}
                </th>
              ))}
              <th className="py-2 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 tabular-nums">
            {rows.map((d) => (
              <tr key={d.date}>
                <td className="py-2 text-slate-700">{dayLabel(d.date)}</td>
                {PARTS.map((p) => (
                  <td key={p.key} className="py-2 text-right text-slate-900">
                    {formatNumber(d[p.key])}
                  </td>
                ))}
                <td className="py-2 text-right font-medium text-slate-900">{formatNumber(d.total)}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={PARTS.length + 2} className="py-6 text-center text-slate-500">
                  No AI activity in the last 30 days.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    )
  }
  // Weekly ticks counted back from today, so the last two labels never collide.
  const last = days.length - 1
  const ticks = days.filter((_, i) => (last - i) % 7 === 0).map((d) => d.date)
  return (
    <div className="h-64" role="img" aria-label="Bar chart of AI activity per day over the last 30 days">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={days} margin={{ top: 8, right: 20, bottom: 0, left: -20 }} barCategoryGap={2}>
          <CartesianGrid vertical={false} stroke="#eef0f4" />
          <XAxis dataKey="date" ticks={ticks} tickFormatter={dayLabel} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} tick={{ fill: '#64748b', fontSize: 12 }} interval={0} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: '#94a3b8', fontSize: 11 }} width={44} />
          <Tooltip content={<ActivityTooltip />} cursor={{ fill: 'rgb(69 57 141 / 0.06)' }} />
          <Bar dataKey="total" name="AI activity" fill={BAR} radius={[4, 4, 0, 0]} maxBarSize={14} minPointSize={0} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
