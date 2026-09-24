import { BarChart3, Download, Eye, FileSpreadsheet, HandCoins, MousePointerClick, Search, Upload, Users } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { PerformanceModal } from '../components/analytics/PerformanceModal'
import { PlatformBarChart } from '../components/charts/PlatformBarChart'
import { Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, Modal, PageHeader, Skeleton, StatCard } from '../components/ui'
import { useAuth } from '../hooks/useAuth'
import { useCollection } from '../hooks/useFirestore'
import { useStoreScope } from '../hooks/useStoreScope'
import { useToast } from '../hooks/useToast'
import { isContentManager, recentScoped, savePerformanceBulk, scopedQuery } from '../services/firestore'
import type { GeneratedVideo, PerformanceRecord, Platform } from '../types'
import { cn } from '../utils/cn'
import { PLATFORMS, VIDEO_STATUS_STYLES } from '../utils/constants'
import { engagementRate } from '../utils/engagement'
import { errorMessage } from '../utils/errors'
import { buildExportRows, exportPerformanceWorkbook, importPerformanceWorkbook, type ImportResult } from '../utils/excel'
import { formatCompact, formatCurrency, formatNumber, formatPercent } from '../utils/format'

type SortKey = 'views' | 'engagementRate' | 'leads' | 'salesImpact'

export default function AnalyticsPage() {
  const { profile } = useAuth()
  const { selectedStoreId, stores } = useStoreScope()
  const toast = useToast()
  const canEdit = isContentManager(profile)
  const deps = [profile?.uid, profile?.role, profile?.storeId, selectedStoreId]
  const videos = useCollection<GeneratedVideo>(() => recentScoped('generated_videos', profile, selectedStoreId, 500), deps)
  const perf = useCollection<PerformanceRecord>(() => scopedQuery('performance', profile, selectedStoreId), deps)

  const [platform, setPlatform] = useState<Platform | ''>('')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('views')
  const [recordFor, setRecordFor] = useState<GeneratedVideo | null>(null)
  const [chartTable, setChartTable] = useState(false)
  const [exporting, setExporting] = useState<'report' | 'template' | null>(null)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [applying, setApplying] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const perfById = useMemo(() => new Map(perf.data.map((p) => [p.videoId, p])), [perf.data])
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return videos.data
      .filter((v) => v.status === 'Completed' || v.status === 'Published' || perfById.has(v.id))
      .map((v) => ({ video: v, record: perfById.get(v.id) ?? null }))
      .filter((r) => !platform || (r.record?.platform ?? r.video.platform) === platform)
      .filter((r) => !q || r.video.title.toLowerCase().includes(q))
      .sort((a, b) => (b.record?.[sort] ?? -1) - (a.record?.[sort] ?? -1))
  }, [videos.data, perfById, platform, search, sort])

  const tracked = rows.filter((r) => r.record).map((r) => r.record!)
  const totals = tracked.reduce((t, p) => ({ views: t.views + p.views, likes: t.likes + p.likes, comments: t.comments + p.comments, shares: t.shares + p.shares, leads: t.leads + p.leads, sales: t.sales + p.salesImpact }), {
    views: 0,
    likes: 0,
    comments: 0,
    shares: 0,
    leads: 0,
    sales: 0,
  })
  const avgEr = engagementRate(totals)
  const platformData = PLATFORMS.map((p) => {
    const list = tracked.filter((r) => r.platform === p)
    const agg = list.reduce((t, r) => ({ views: t.views + r.views, likes: t.likes + r.likes, comments: t.comments + r.comments, shares: t.shares + r.shares, leads: t.leads + r.leads }), { views: 0, likes: 0, comments: 0, shares: 0, leads: 0 })
    return { platform: p, posts: list.length, ...agg, engagementRate: engagementRate(agg) }
  }).filter((p) => p.posts > 0)

  const exportReport = async (template: boolean) => {
    setExporting(template ? 'template' : 'report')
    try {
      await exportPerformanceWorkbook(buildExportRows(videos.data, perf.data, stores), { template })
    } catch (err) {
      toast.error(errorMessage(err, 'Export failed.'))
    } finally {
      setExporting(null)
    }
  }

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setImporting(true)
    try {
      const known = new Set(videos.data.map((v) => v.id))
      setImportResult(await importPerformanceWorkbook(file, known))
    } catch (err) {
      toast.error(errorMessage(err, 'Could not read the Excel file.'))
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const applyImport = async () => {
    if (!importResult) return
    setApplying(true)
    try {
      const byId = new Map(videos.data.map((v) => [v.id, v]))
      await savePerformanceBulk(importResult.rows.map(({ videoId, ...input }) => ({ video: byId.get(videoId)!, input })))
      toast.success(`${importResult.rows.length} performance records imported.`)
      setImportResult(null)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setApplying(false)
    }
  }

  const error = videos.error || perf.error
  const loading = videos.loading || perf.loading
  const sortHeader = (k: SortKey, label: string) => (
    <th key={k} className="px-3 py-2.5 text-right font-medium">
      <button type="button" onClick={() => setSort(k)} className={cn('hover:text-slate-900', sort === k && 'font-semibold text-brand-800')} aria-pressed={sort === k}>
        {label}
        {sort === k && ' ↓'}
      </button>
    </th>
  )

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Content performance, engagement, leads and sales impact per video."
        actions={
          <>
            <Button variant="outline" icon={<Download className="size-4" />} loading={exporting === 'report'} onClick={() => exportReport(false)} disabled={loading}>
              Export Excel
            </Button>
            {canEdit && (
              <>
                <Button variant="outline" icon={<FileSpreadsheet className="size-4" />} loading={exporting === 'template'} onClick={() => exportReport(true)} disabled={loading}>
                  Template
                </Button>
                <Button icon={<Upload className="size-4" />} loading={importing} onClick={() => fileRef.current?.click()} disabled={loading}>
                  Import Excel
                </Button>
                <input ref={fileRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
              </>
            )}
          </>
        }
      />
      {error && (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      )}

      <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total views" icon={<Eye className="size-5" />} value={loading ? '…' : formatNumber(totals.views)} hint={`${tracked.length} tracked videos`} />
        <StatCard label="Average engagement" icon={<MousePointerClick className="size-5" />} value={loading ? '…' : formatPercent(avgEr)} hint="(likes + comments + shares) / views" />
        <StatCard label="Leads" icon={<Users className="size-5" />} value={loading ? '…' : formatNumber(totals.leads)} hint={totals.views ? `${formatNumber(Math.round((totals.leads / totals.views) * 100000) / 100)} per 1.000 views` : undefined} />
        <StatCard label="Sales impact" icon={<HandCoins className="size-5" />} value={loading ? '…' : formatCurrency(totals.sales)} hint={totals.leads ? `${formatCurrency(totals.sales / totals.leads)} per lead` : undefined} />
      </section>

      {platformData.length > 0 && (
        <section className="mb-6 grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader
              title="Views by platform"
              action={
                <button type="button" className="text-xs font-medium text-brand-700 hover:underline" onClick={() => setChartTable((t) => !t)} aria-pressed={chartTable}>
                  {chartTable ? 'Show charts' : 'Show table'}
                </button>
              }
            />
            <CardBody>
              <PlatformBarChart data={platformData} metric="views" showTable={chartTable} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Leads by platform" />
            <CardBody>
              <PlatformBarChart data={platformData} metric="leads" showTable={chartTable} />
            </CardBody>
          </Card>
        </section>
      )}

      <Card>
        <CardHeader title="Content performance" subtitle="Completed & published videos in the current store scope" />
        <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input className="input pl-9" placeholder="Search videos…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search videos" />
          </div>
          <select className="input sm:w-44" value={platform} onChange={(e) => setPlatform(e.target.value as Platform | '')} aria-label="Filter by platform">
            <option value="">All platforms</option>
            {PLATFORMS.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </div>
        {loading ? (
          <CardBody>
            <Skeleton className="h-48 w-full" />
          </CardBody>
        ) : rows.length ? (
          <div className="scrollbar-thin overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-5 py-2.5 text-left font-medium">Video</th>
                  <th className="px-3 py-2.5 text-left font-medium">Platform</th>
                  {sortHeader('views', 'Views')}
                  <th className="px-3 py-2.5 text-right font-medium">Likes</th>
                  <th className="px-3 py-2.5 text-right font-medium">Comments</th>
                  <th className="px-3 py-2.5 text-right font-medium">Shares</th>
                  {sortHeader('engagementRate', 'Eng. rate')}
                  {sortHeader('leads', 'Leads')}
                  {sortHeader('salesImpact', 'Sales impact')}
                  {canEdit && <th className="px-5 py-2.5" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 tabular-nums">
                {rows.map(({ video, record }) => (
                  <tr key={video.id} className="hover:bg-slate-50/60">
                    <td className="max-w-[280px] px-5 py-3">
                      <p className="truncate font-medium text-slate-900">{video.title}</p>
                      <Badge className={VIDEO_STATUS_STYLES[video.status]}>{video.status}</Badge>
                    </td>
                    <td className="px-3 py-3 text-slate-700">{record?.platform ?? video.platform ?? '—'}</td>
                    <td className="px-3 py-3 text-right">{record ? formatCompact(record.views) : '—'}</td>
                    <td className="px-3 py-3 text-right">{record ? formatCompact(record.likes) : '—'}</td>
                    <td className="px-3 py-3 text-right">{record ? formatCompact(record.comments) : '—'}</td>
                    <td className="px-3 py-3 text-right">{record ? formatCompact(record.shares) : '—'}</td>
                    <td className="px-3 py-3 text-right font-medium text-slate-900">{record ? formatPercent(record.engagementRate) : '—'}</td>
                    <td className="px-3 py-3 text-right">{record ? formatNumber(record.leads) : '—'}</td>
                    <td className="px-3 py-3 text-right">{record ? formatCurrency(record.salesImpact) : '—'}</td>
                    {canEdit && (
                      <td className="px-5 py-3 text-right">
                        <Button size="sm" variant={record ? 'ghost' : 'secondary'} onClick={() => setRecordFor(video)}>
                          {record ? 'Update' : 'Record'}
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <CardBody>
            <EmptyState icon={<BarChart3 className="size-5" />} title="No completed videos yet" description="Generate and publish videos in Video Studio, then record their metrics here (or import them from Excel)." />
          </CardBody>
        )}
      </Card>

      <PerformanceModal
        key={`perf-${recordFor?.id ?? 'none'}`}
        video={recordFor}
        record={recordFor ? (perfById.get(recordFor.id) ?? null) : null}
        onClose={() => setRecordFor(null)}
        onSaved={() => {
          setRecordFor(null)
          toast.success('Performance saved.')
        }}
      />
      <Modal
        open={!!importResult}
        onClose={() => setImportResult(null)}
        busy={applying}
        title="Import performance from Excel"
        footer={
          <>
            <Button variant="outline" onClick={() => setImportResult(null)} disabled={applying}>
              Cancel
            </Button>
            <Button loading={applying} disabled={!importResult?.rows.length} onClick={applyImport}>
              Import {importResult?.rows.length ?? 0} rows
            </Button>
          </>
        }
      >
        {importResult && (
          <div className="space-y-3 text-sm">
            <p>
              <strong className="tabular-nums">{importResult.rows.length}</strong> valid rows will be saved (existing metrics for those videos are replaced).
            </p>
            {importResult.errors.length > 0 && (
              <Alert kind="warning" title={`${importResult.errors.length} rows skipped`}>
                <ul className="mt-1 max-h-48 list-disc space-y-0.5 overflow-y-auto pl-4 text-xs">
                  {importResult.errors.map((e) => (
                    <li key={`${e.row}-${e.message}`}>
                      Row {e.row}: {e.message}
                    </li>
                  ))}
                </ul>
              </Alert>
            )}
          </div>
        )}
      </Modal>
    </>
  )
}
