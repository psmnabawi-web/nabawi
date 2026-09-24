import { ArrowRight, Clapperboard, Eye, Flame, RefreshCw, Rocket, Send, Sparkles, Trophy, TrendingUp } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { ContentGrowthChart } from '../components/charts/ContentGrowthChart'
import { PlatformBarChart } from '../components/charts/PlatformBarChart'
import { RoleGate } from '../components/layout/Guards'
import { Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, PageHeader, ScoreRing, Skeleton, StatCard } from '../components/ui'
import { useAsyncAction } from '../hooks/useAsyncAction'
import { useAuth } from '../hooks/useAuth'
import { useCollection, useDocument } from '../hooks/useFirestore'
import { useStoreScope } from '../hooks/useStoreScope'
import { useToast } from '../hooks/useToast'
import { recentScoped, statsDocId } from '../services/firestore'
import { calculatePerformance } from '../services/functions'
import type { GeneratedVideo, StatsDoc } from '../types'
import { VIDEO_STATUS_STYLES } from '../utils/constants'
import { formatCompact, formatNumber, formatPercent, timeAgo } from '../utils/format'

function TableToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} className="text-xs font-medium text-brand-700 hover:underline" aria-pressed={on}>
      {on ? 'Show chart' : 'Show table'}
    </button>
  )
}

export default function DashboardPage() {
  const { profile } = useAuth()
  const { selectedStoreId, storeName } = useStoreScope()
  const toast = useToast()
  const navigate = useNavigate()
  const statsId = statsDocId(profile, selectedStoreId)
  const stats = useDocument<StatsDoc>(statsId ? `stats/${statsId}` : null)
  const recent = useCollection<GeneratedVideo>(() => recentScoped('generated_videos', profile, selectedStoreId, 5), [profile?.uid, profile?.role, profile?.storeId, selectedStoreId])
  const refresh = useAsyncAction(() => calculatePerformance({}))
  const [tables, setTables] = useState({ growth: false, platform: false })

  const s = stats.data
  const trend = s?.topTrend
  const top = s?.topContent?.[0]

  const onRefresh = async () => {
    const res = await refresh.run()
    if (res) toast.success('Dashboard numbers recalculated.')
    else if (refresh.error) toast.error(refresh.error)
  }

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={
          <>
            {selectedStoreId ? storeName(selectedStoreId) : 'All stores'}
            {s?.updatedAt && <> · updated {timeAgo(s.updatedAt)}</>}
          </>
        }
        actions={
          <RoleGate roles={['super_admin', 'marketing_manager']}>
            <Button variant="outline" icon={<RefreshCw className="size-4" />} loading={refresh.loading} onClick={onRefresh}>
              Recalculate
            </Button>
          </RoleGate>
        }
      />

      {stats.error && (
        <div className="mb-6">
          <Alert>{stats.error}</Alert>
        </div>
      )}

      {/* Today's trend */}
      <section className="relative mb-6 overflow-hidden rounded-2xl bg-gradient-to-br from-brand-950 via-brand-900 to-brand-800 p-6 text-white shadow-sm sm:p-8">
        <div className="absolute -top-16 -right-10 size-64 rounded-full bg-brand-500/20 blur-3xl" aria-hidden />
        {stats.loading ? (
          <div className="space-y-3">
            <Skeleton className="h-4 w-32 bg-white/20" />
            <Skeleton className="h-8 w-2/3 bg-white/20" />
            <Skeleton className="h-4 w-1/2 bg-white/20" />
          </div>
        ) : trend ? (
          <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center">
            <ScoreRing score={trend.trendScore} size={96} light />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-xs font-semibold tracking-wider text-brand-200 uppercase">
                <Flame className="size-4" aria-hidden /> Today&apos;s trend
              </p>
              <h2 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">{trend.trendName}</h2>
              <p className="mt-1 text-sm text-brand-100">
                Trend score <strong className="tabular-nums">{trend.trendScore}</strong> / 100
                {trend.growthLevel && <> · {trend.growthLevel}</>}
                {trend.platform && <> · {trend.platform}</>}
              </p>
              <div className="mt-4 rounded-lg bg-white/10 px-4 py-3 ring-1 ring-white/15">
                <p className="text-xs font-medium text-brand-200">AI recommendation</p>
                <p className="mt-0.5 text-sm font-medium">{trend.recommendation || '—'}</p>
              </div>
            </div>
            <RoleGate roles={['super_admin', 'marketing_manager']}>
              <div className="flex shrink-0 flex-row gap-2 sm:flex-col">
                <Button variant="secondary" icon={<Sparkles className="size-4" />} onClick={() => navigate(`/content?trendId=${trend.id}`)}>
                  Generate ideas
                </Button>
                <Button variant="inverse" icon={<Clapperboard className="size-4" />} onClick={() => navigate('/video')}>
                  Create video
                </Button>
              </div>
            </RoleGate>
          </div>
        ) : (
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold tracking-wider text-brand-200 uppercase">Today&apos;s trend</p>
              <h2 className="mt-1 text-xl font-semibold">No trend analyzed yet</h2>
              <p className="mt-1 text-sm text-brand-100">Add a TikTok, Instagram or YouTube source and let AI score it.</p>
            </div>
            <Link to="/trends">
              <Button variant="secondary" icon={<TrendingUp className="size-4" />}>
                Go to Trend Intelligence
              </Button>
            </Link>
          </div>
        )}
      </section>

      {/* KPIs */}
      <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Key statistics">
        <StatCard label="Total generated videos" icon={<Clapperboard className="size-5" />} value={stats.loading ? '…' : formatNumber(s?.totals.videos)} hint={s ? `${formatNumber(s.totals.completedVideos)} ready · ${formatNumber(s.statusBreakdown?.Processing ?? 0)} processing` : undefined} />
        <StatCard label="Published content" icon={<Send className="size-5" />} value={stats.loading ? '…' : formatNumber(s?.totals.publishedVideos)} hint={s ? `${formatNumber(s.totals.ideas)} ideas · ${formatNumber(s.totals.scripts)} scripts` : undefined} />
        <StatCard
          label="Average engagement"
          icon={<Rocket className="size-5" />}
          value={stats.loading ? '…' : formatPercent(s?.avgEngagementRate)}
          hint={s ? `${formatCompact(s.totals.views)} views · (likes+comments+shares) / views` : undefined}
        />
        <StatCard label="Top content" icon={<Trophy className="size-5" />} value={<span className="text-lg">{top ? top.title : '—'}</span>} hint={top ? `${formatCompact(top.views)} views · ${formatPercent(top.engagementRate)} ER · ${top.platform}` : 'Record performance in Analytics'} />
      </section>

      {!stats.loading && !s && (
        <div className="mb-6">
          <EmptyState
            icon={<RefreshCw className="size-5" />}
            title="No aggregated statistics yet"
            description="Statistics are recalculated every hour. Marketing managers can recalculate now."
            action={
              <RoleGate roles={['super_admin', 'marketing_manager']}>
                <Button loading={refresh.loading} onClick={onRefresh}>
                  Calculate now
                </Button>
              </RoleGate>
            }
          />
        </div>
      )}

      {/* Charts */}
      <section className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Content growth" subtitle="Items created per month (last 6 months)" action={<TableToggle on={tables.growth} onToggle={() => setTables((t) => ({ ...t, growth: !t.growth }))} />} />
          <CardBody>{s ? <ContentGrowthChart data={s.contentGrowth} showTable={tables.growth} /> : <Skeleton className="h-72 w-full" />}</CardBody>
        </Card>
        <Card>
          <CardHeader title="Platform performance" subtitle="Views per platform (hover for engagement & leads)" action={<TableToggle on={tables.platform} onToggle={() => setTables((t) => ({ ...t, platform: !t.platform }))} />} />
          <CardBody>
            {s && s.platformPerformance.length ? (
              <PlatformBarChart data={s.platformPerformance} showTable={tables.platform} />
            ) : s ? (
              <EmptyState icon={<Eye className="size-5" />} title="No performance data yet" description="Publish a video and record its views, likes and leads in Analytics." />
            ) : (
              <Skeleton className="h-72 w-full" />
            )}
          </CardBody>
        </Card>
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Top content"
            subtitle="Ranked by views"
            action={
              <Link to="/analytics" className="flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
                Analytics <ArrowRight className="size-3" />
              </Link>
            }
          />
          <ul className="divide-y divide-slate-100">
            {(s?.topContent ?? []).map((c, i) => (
              <li key={c.videoId} className="flex items-center gap-3 px-5 py-3">
                <span className="w-5 text-sm font-semibold text-slate-400 tabular-nums">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">{c.title}</p>
                  <p className="text-xs text-slate-500">
                    {c.platform} · {formatPercent(c.engagementRate)} engagement · {formatNumber(c.leads)} leads
                  </p>
                </div>
                <span className="text-sm font-semibold text-slate-900 tabular-nums">{formatCompact(c.views)}</span>
              </li>
            ))}
            {s && !s.topContent.length && <li className="px-5 py-6 text-sm text-slate-500">No tracked content yet.</li>}
          </ul>
        </Card>
        <Card>
          <CardHeader
            title="Recent videos"
            action={
              <Link to="/video" className="flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
                Video Studio <ArrowRight className="size-3" />
              </Link>
            }
          />
          <ul className="divide-y divide-slate-100">
            {recent.data.map((v) => (
              <li key={v.id} className="flex items-center gap-3 px-5 py-3">
                <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-slate-100">
                  {v.thumbnail ? <img src={v.thumbnail} alt="" className="size-full object-cover" /> : <Clapperboard className="size-4 text-slate-400" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">{v.title}</p>
                  <p className="text-xs text-slate-500">
                    {v.templateLabel} · {v.duration}s · {timeAgo(v.createdAt)}
                  </p>
                </div>
                <Badge className={VIDEO_STATUS_STYLES[v.status]}>{v.status}</Badge>
              </li>
            ))}
            {!recent.loading && !recent.data.length && <li className="px-5 py-6 text-sm text-slate-500">No videos yet.</li>}
            {recent.error && <li className="px-5 py-3 text-sm text-rose-600">{recent.error}</li>}
          </ul>
        </Card>
      </section>
    </>
  )
}
