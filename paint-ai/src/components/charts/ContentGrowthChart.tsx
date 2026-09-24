import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { StatsDoc } from '../../types'
import { formatNumber, monthLabel } from '../../utils/format'
import { ChartTooltip } from './chartTheme'
import { SERIES } from './palette'

const LINES = [
  { key: 'ideas', label: 'Content ideas', color: SERIES[0] },
  { key: 'scripts', label: 'Scripts', color: SERIES[1] },
  { key: 'videos', label: 'Videos', color: SERIES[2] },
] as const

export function ContentGrowthChart({ data, showTable }: { data: StatsDoc['contentGrowth']; showTable?: boolean }) {
  const rows = data.map((d) => ({ ...d, label: monthLabel(d.month) }))
  if (showTable) {
    return (
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-slate-500">
          <tr>
            <th className="py-2 font-medium">Month</th>
            {LINES.map((l) => (
              <th key={l.key} className="py-2 text-right font-medium">
                {l.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 tabular-nums">
          {rows.map((r) => (
            <tr key={r.month}>
              <td className="py-2 text-slate-700">{r.label}</td>
              {LINES.map((l) => (
                <td key={l.key} className="py-2 text-right text-slate-900">
                  {formatNumber(r[l.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    )
  }
  return (
    <div className="h-72" role="img" aria-label="Line chart of content ideas, scripts and videos created per month">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
          <CartesianGrid vertical={false} stroke="#e2e8f0" />
          <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: '#cbd5e1' }} tick={{ fill: '#64748b', fontSize: 12 }} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: '#64748b', fontSize: 12 }} width={44} />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: '#94a3b8', strokeDasharray: '3 3' }} />
          <Legend verticalAlign="top" align="right" iconType="plainline" height={28} wrapperStyle={{ fontSize: 12, color: '#475569' }} />
          {LINES.map((l) => (
            <Line key={l.key} type="monotone" dataKey={l.key} name={l.label} stroke={l.color} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, stroke: '#fff', fill: l.color }} activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2 }} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
