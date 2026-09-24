import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { StatsDoc } from '../../types'
import { formatCompact, formatNumber, formatPercent } from '../../utils/format'
import { SERIES } from './palette'

type Row = StatsDoc['platformPerformance'][number]
type Metric = 'views' | 'leads'

function BarTooltip({ active, payload }: { active?: boolean; payload?: { payload: Row }[] }) {
  if (!active || !payload?.length) return null
  const r = payload[0].payload
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-semibold text-slate-900">{r.platform}</p>
      <p className="text-slate-600">
        Views: <span className="font-medium text-slate-900 tabular-nums">{formatNumber(r.views)}</span>
      </p>
      <p className="text-slate-600">
        Engagement: <span className="font-medium text-slate-900 tabular-nums">{formatPercent(r.engagementRate)}</span>
      </p>
      <p className="text-slate-600">
        Leads: <span className="font-medium text-slate-900 tabular-nums">{formatNumber(r.leads)}</span> · Posts: <span className="tabular-nums">{r.posts}</span>
      </p>
    </div>
  )
}

/** Single-measure bar chart per platform (no dual axis: engagement is shown in the tooltip and table). */
export function PlatformBarChart({ data, metric = 'views', showTable }: { data: Row[]; metric?: Metric; showTable?: boolean }) {
  if (showTable) {
    return (
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-slate-500">
          <tr>
            <th className="py-2 font-medium">Platform</th>
            <th className="py-2 text-right font-medium">Posts</th>
            <th className="py-2 text-right font-medium">Views</th>
            <th className="py-2 text-right font-medium">Engagement</th>
            <th className="py-2 text-right font-medium">Leads</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 tabular-nums">
          {data.map((r) => (
            <tr key={r.platform}>
              <td className="py-2 text-slate-700">{r.platform}</td>
              <td className="py-2 text-right">{r.posts}</td>
              <td className="py-2 text-right">{formatNumber(r.views)}</td>
              <td className="py-2 text-right">{formatPercent(r.engagementRate)}</td>
              <td className="py-2 text-right">{formatNumber(r.leads)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }
  return (
    <div className="h-72" role="img" aria-label={`Bar chart of ${metric} per platform`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -8 }} barCategoryGap="30%">
          <CartesianGrid vertical={false} stroke="#e2e8f0" />
          <XAxis dataKey="platform" tickLine={false} axisLine={{ stroke: '#cbd5e1' }} tick={{ fill: '#64748b', fontSize: 12 }} />
          <YAxis tickFormatter={(v: number) => formatCompact(v)} tickLine={false} axisLine={false} tick={{ fill: '#64748b', fontSize: 12 }} width={48} allowDecimals={false} />
          <Tooltip content={<BarTooltip />} cursor={{ fill: 'rgba(148,163,184,0.12)' }} />
          <Bar dataKey={metric} name={metric === 'views' ? 'Views' : 'Leads'} fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={56} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
