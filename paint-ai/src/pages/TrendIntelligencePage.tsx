import { ExternalLink, Pencil, Plus, Search, Trash2, TrendingUp, Zap } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { PlatformIcon } from '../components/PlatformIcon'
import { SourceFormModal } from '../components/trend/SourceFormModal'
import { TrendCard } from '../components/trend/TrendCard'
import { Alert, Badge, Button, ConfirmDialog, EmptyState, PageHeader, Skeleton, Tabs } from '../components/ui'
import { useAuth } from '../hooks/useAuth'
import { useCollection } from '../hooks/useFirestore'
import { useStoreScope } from '../hooks/useStoreScope'
import { useToast } from '../hooks/useToast'
import { deleteSource, deleteTrend, isContentManager, recentScoped } from '../services/firestore'
import { analyzeTrend } from '../services/functions'
import type { Platform, SocialSource, TrendAnalysis } from '../types'
import { categoryLabel, PLATFORMS, SOURCE_TYPES } from '../utils/constants'
import { errorMessage } from '../utils/errors'
import { timeAgo } from '../utils/format'

type Tab = 'trends' | 'sources'

export default function TrendIntelligencePage() {
  const { profile } = useAuth()
  const { selectedStoreId, storeName } = useStoreScope()
  const toast = useToast()
  const navigate = useNavigate()
  const canEdit = isContentManager(profile)
  const deps = [profile?.uid, profile?.role, profile?.storeId, selectedStoreId]
  const trends = useCollection<TrendAnalysis>(() => recentScoped('trend_analysis', profile, selectedStoreId, 120), deps)
  const sources = useCollection<SocialSource>(() => recentScoped('social_sources', profile, selectedStoreId, 200), deps)

  const [tab, setTab] = useState<Tab>('trends')
  const [platform, setPlatform] = useState<Platform | ''>('')
  const [search, setSearch] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<SocialSource | null>(null)
  const [analyzing, setAnalyzing] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState<{ kind: 'trend' | 'source'; id: string; name: string } | null>(null)
  const [deleting, setDeleting] = useState(false)

  const q = search.trim().toLowerCase()
  const filteredTrends = useMemo(
    () =>
      trends.data
        .filter((t) => !platform || t.platform === platform)
        .filter((t) => !q || `${t.trendName} ${t.keyword} ${t.recommendation}`.toLowerCase().includes(q))
        .sort((a, b) => b.trendScore - a.trendScore),
    [trends.data, platform, q],
  )
  const filteredSources = useMemo(
    () => sources.data.filter((s) => !platform || s.platform === platform).filter((s) => !q || `${s.url} ${s.keyword} ${s.competitor} ${s.location}`.toLowerCase().includes(q)),
    [sources.data, platform, q],
  )

  const runAnalysis = async (sourceId: string) => {
    setAnalyzing((s) => new Set(s).add(sourceId))
    toast.toast('Analyzing trend with AI… this can take up to a minute.')
    try {
      const res = await analyzeTrend({ sourceId })
      toast.success(`Trend detected: ${res.trendName} (score ${res.trendScore})`)
      setTab('trends')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setAnalyzing((s) => {
        const next = new Set(s)
        next.delete(sourceId)
        return next
      })
    }
  }

  const doDelete = async () => {
    if (!confirm) return
    setDeleting(true)
    try {
      if (confirm.kind === 'trend') await deleteTrend(confirm.id)
      else await deleteSource(confirm.id)
      toast.success('Deleted.')
      setConfirm(null)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setDeleting(false)
    }
  }

  const error = trends.error || sources.error
  return (
    <>
      <PageHeader
        title="Trend Intelligence"
        description="Monitor TikTok, Instagram & YouTube content, competitors and hashtags — AI scores each trend for paint retail."
        actions={
          canEdit && (
            <Button
              icon={<Plus className="size-4" />}
              onClick={() => {
                setEditing(null)
                setFormOpen(true)
              }}
            >
              Add source
            </Button>
          )
        }
      />

      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'trends', label: 'Trend analysis', count: trends.data.length },
          { id: 'sources', label: 'Monitored sources', count: sources.data.length },
        ]}
      />

      <div className="my-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input className="input pl-9" placeholder="Search trends, keywords, URLs…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
        </div>
        <select className="input sm:w-44" value={platform} onChange={(e) => setPlatform(e.target.value as Platform | '')} aria-label="Filter by platform">
          <option value="">All platforms</option>
          {PLATFORMS.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </div>

      {error && (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      )}

      {tab === 'trends' ? (
        trends.loading ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-56" />
            ))}
          </div>
        ) : filteredTrends.length ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredTrends.map((t) => (
              <TrendCard key={t.id} trend={t} canEdit={canEdit} onGenerate={() => navigate(`/content?trendId=${t.id}`)} onDelete={() => setConfirm({ kind: 'trend', id: t.id, name: t.trendName })} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<TrendingUp className="size-5" />}
            title={trends.data.length ? 'No trends match your filters' : 'No trend analysis yet'}
            description={canEdit ? 'Add a source and click “Analyze Trend”.' : 'Your marketing team has not analyzed any trends for your store yet.'}
            action={
              canEdit && (
                <Button icon={<Plus className="size-4" />} onClick={() => setFormOpen(true)}>
                  Add source
                </Button>
              )
            }
          />
        )
      ) : sources.loading ? (
        <Skeleton className="h-64" />
      ) : filteredSources.length ? (
        <div className="card overflow-hidden">
          <ul className="divide-y divide-slate-100">
            {filteredSources.map((s) => (
              <li key={s.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <PlatformIcon platform={s.platform} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold text-slate-900">{s.keyword || s.url}</p>
                      <Badge>{SOURCE_TYPES.find((t) => t.value === s.sourceType)?.label}</Badge>
                      <Badge>{categoryLabel(s.category)}</Badge>
                      {s.competitor && <Badge className="bg-amber-50 text-amber-800 ring-amber-200">Competitor: {s.competitor}</Badge>}
                    </div>
                    {s.url && (
                      <a href={s.url} target="_blank" rel="noopener noreferrer" className="mt-0.5 flex max-w-full items-center gap-1 truncate text-xs text-brand-700 hover:underline">
                        <ExternalLink className="size-3 shrink-0" /> <span className="truncate">{s.url}</span>
                      </a>
                    )}
                    <p className="mt-0.5 text-xs text-slate-500">
                      {storeName(s.storeId)}
                      {s.location && <> · {s.location}</>}
                      {s.lastAnalyzedAt ? (
                        <>
                          {' '}
                          · last: <strong className="text-slate-700">{s.lastTrendName}</strong> ({s.lastTrendScore}) {timeAgo(s.lastAnalyzedAt)}
                        </>
                      ) : (
                        <> · not analyzed yet</>
                      )}
                    </p>
                  </div>
                </div>
                {canEdit && (
                  <div className="flex shrink-0 items-center gap-2">
                    <Button size="sm" icon={<Zap className="size-4" />} loading={analyzing.has(s.id)} onClick={() => runAnalysis(s.id)}>
                      Analyze Trend
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="Edit source"
                      icon={<Pencil className="size-4" />}
                      onClick={() => {
                        setEditing(s)
                        setFormOpen(true)
                      }}
                    />
                    <Button size="sm" variant="ghost" aria-label="Delete source" icon={<Trash2 className="size-4" />} onClick={() => setConfirm({ kind: 'source', id: s.id, name: s.keyword || s.url })} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <EmptyState icon={<Search className="size-5" />} title="No monitored sources" description="Add TikTok, Instagram or YouTube links, competitor accounts or hashtags to monitor." />
      )}

      <SourceFormModal
        key={formOpen ? (editing?.id ?? 'new') : 'closed'}
        open={formOpen}
        source={editing}
        onClose={() => setFormOpen(false)}
        onSaved={(id, analyze) => {
          setFormOpen(false)
          toast.success('Source saved.')
          if (analyze) runAnalysis(id)
          else setTab('sources')
        }}
      />
      <ConfirmDialog
        open={!!confirm}
        title={confirm?.kind === 'trend' ? 'Delete trend analysis?' : 'Delete source?'}
        message={
          <>
            <strong>{confirm?.name}</strong> will be permanently deleted.{confirm?.kind === 'source' && ' Existing trend analyses are kept.'}
          </>
        }
        loading={deleting}
        onConfirm={doDelete}
        onClose={() => setConfirm(null)}
      />
    </>
  )
}
