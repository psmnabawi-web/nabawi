import { FileText, Lightbulb, Search, Sparkles, Star } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { IdeaCard } from '../components/content/IdeaCard'
import { IdeaEditModal } from '../components/content/IdeaEditModal'
import { ScriptRequestModal } from '../components/content/ScriptRequestModal'
import { ScriptViewerModal } from '../components/content/ScriptViewerModal'
import { RoleGate } from '../components/layout/Guards'
import { ScopeSelect } from '../components/ScopeSelect'
import { Alert, Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, EmptyState, PageHeader, Segmented, SelectInput, Skeleton, Tabs, TextArea } from '../components/ui'
import { useAuth } from '../hooks/useAuth'
import { useCollection, useDocument } from '../hooks/useFirestore'
import { useStoreScope } from '../hooks/useStoreScope'
import { useToast } from '../hooks/useToast'
import { deleteIdea, isContentManager, recentScoped, updateIdea } from '../services/firestore'
import { generateContent } from '../services/functions'
import type { Audience, ContentFormat, ContentIdea, Objective, Platform, Product, TrendAnalysis, VideoScript } from '../types'
import { AUDIENCES, CONTENT_FORMATS, OBJECTIVES, PLATFORMS, PRODUCTS } from '../utils/constants'
import { errorMessage } from '../utils/errors'
import { formatDate, timeAgo } from '../utils/format'
import { contentRequestSchema, fieldErrors } from '../utils/validation'

type Tab = 'generate' | 'ideas' | 'scripts'

export default function ContentGeneratorPage() {
  const { profile } = useAuth()
  const { selectedStoreId, defaultScope } = useStoreScope()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const canEdit = isContentManager(profile)
  const deps = [profile?.uid, profile?.role, profile?.storeId, selectedStoreId]

  const trends = useCollection<TrendAnalysis>(() => (canEdit ? recentScoped('trend_analysis', profile, selectedStoreId, 50) : null), deps)
  const ideas = useCollection<ContentIdea>(() => recentScoped('content_ideas', profile, selectedStoreId, 300), deps)
  const scripts = useCollection<VideoScript>(() => recentScoped('video_scripts', profile, selectedStoreId, 200), deps)

  const initialTrend = params.get('trendId')
  const [tab, setTab] = useState<Tab>(canEdit ? 'generate' : 'ideas')
  const [form, setForm] = useState({
    trendId: initialTrend,
    product: 'Interior paint' as Product,
    audience: 'Home owner' as Audience,
    objective: 'Engagement' as Objective,
    platform: 'TikTok' as Platform,
    format: '' as ContentFormat | '',
    count: 20,
    storeId: null as string | null, // null = follow the store selected in the top bar
    brief: '',
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)

  const [batch, setBatch] = useState<string>('')
  const [search, setSearch] = useState('')
  const [favOnly, setFavOnly] = useState(false)
  const [scriptFor, setScriptFor] = useState<ContentIdea | null>(null)
  const [editIdea, setEditIdea] = useState<ContentIdea | null>(null)
  const [viewScriptId, setViewScriptId] = useState<string | null>(null)
  const [confirmIdea, setConfirmIdea] = useState<ContentIdea | null>(null)
  const [deleting, setDeleting] = useState(false)


  const batches = useMemo(() => {
    const map = new Map<string, { id: string; label: string; count: number }>()
    for (const i of ideas.data) {
      const b = map.get(i.batchId) ?? { id: i.batchId, label: `${i.product} · ${i.audience} · ${formatDate(i.createdAt)}`, count: 0 }
      b.count += 1
      map.set(i.batchId, b)
    }
    return [...map.values()]
  }, [ideas.data])

  const q = search.trim().toLowerCase()
  const shownIdeas = useMemo(
    () =>
      ideas.data
        .filter((i) => !batch || i.batchId === batch)
        .filter((i) => !favOnly || i.favorite)
        .filter((i) => !q || `${i.title} ${i.hook} ${i.storyline}`.toLowerCase().includes(q))
        .sort((a, b) => (a.batchId === b.batchId ? a.rank - b.rank : 0)),
    [ideas.data, batch, favOnly, q],
  )
  const viewScriptDoc = useDocument<VideoScript>(viewScriptId ? `video_scripts/${viewScriptId}` : null)
  const viewScript = viewScriptDoc.data

  const submit = async () => {
    setGenError(null)
    const parsed = contentRequestSchema.safeParse({ ...form, storeId: form.storeId ?? defaultScope, format: form.format || undefined, brief: form.brief })
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error))
      return
    }
    setErrors({})
    setGenerating(true)
    try {
      const res = await generateContent(parsed.data)
      toast.success(`${res.count} content ideas generated.`)
      setBatch(res.batchId)
      setTab('ideas')
      if (params.get('trendId')) setParams({}, { replace: true })
    } catch (err) {
      setGenError(errorMessage(err))
    } finally {
      setGenerating(false)
    }
  }

  const selectedTrend = trends.data.find((t) => t.id === form.trendId)
  const error = ideas.error || scripts.error || trends.error

  return (
    <>
      <PageHeader title="Content Generator" description="Turn trends into 20 ready-to-produce content ideas, then into shootable video scripts." />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[...(canEdit ? [{ id: 'generate' as Tab, label: 'Generate' }] : []), { id: 'ideas', label: 'Content ideas', count: ideas.data.length }, { id: 'scripts', label: 'Video scripts', count: scripts.data.length }]}
      />
      <div className="mt-5">
        {error && (
          <div className="mb-4">
            <Alert>{error}</Alert>
          </div>
        )}

        {tab === 'generate' && canEdit && (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <Card>
              <CardHeader title="Content brief" subtitle="The AI generates distinct ideas with title, hook, storyline, CTA and expected impact." />
              <CardBody className="space-y-5">
                <SelectInput
                  label="Build on a trend (optional)"
                  value={form.trendId ?? ''}
                  onChange={(e) => setForm({ ...form, trendId: e.target.value || null })}
                  options={[{ value: '', label: 'No trend — general ideas' }, ...trends.data.map((t) => ({ value: t.id, label: `${t.trendName} (${t.trendScore})` }))]}
                  hint={selectedTrend ? `Recommendation: ${selectedTrend.recommendation}` : undefined}
                />
                <Segmented label="Product" value={form.product} onChange={(v) => setForm({ ...form, product: v })} options={PRODUCTS.map((p) => ({ value: p, label: p }))} disabled={generating} />
                <Segmented label="Audience" value={form.audience} onChange={(v) => setForm({ ...form, audience: v })} options={AUDIENCES.map((a) => ({ value: a, label: a }))} disabled={generating} />
                <div className="grid gap-4 sm:grid-cols-3">
                  <SelectInput label="Objective" value={form.objective} onChange={(e) => setForm({ ...form, objective: e.target.value as Objective })} options={OBJECTIVES.map((o) => ({ value: o, label: o }))} />
                  <SelectInput label="Platform" value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value as Platform })} options={PLATFORMS.map((p) => ({ value: p, label: p }))} />
                  <SelectInput
                    label="Format"
                    value={form.format}
                    onChange={(e) => setForm({ ...form, format: e.target.value as ContentFormat | '' })}
                    options={[{ value: '', label: 'Mixed (AI decides)' }, ...CONTENT_FORMATS.map((f) => ({ value: f, label: f }))]}
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <SelectInput
                    label="Number of ideas"
                    value={form.count}
                    onChange={(e) => setForm({ ...form, count: Number(e.target.value) })}
                    error={errors.count}
                    options={[5, 10, 15, 20].map((n) => ({ value: n, label: `${n} ideas` }))}
                  />
                  <ScopeSelect value={form.storeId ?? defaultScope} onChange={(v) => setForm({ ...form, storeId: v })} error={errors.storeId} />
                </div>
                <TextArea
                  label="Additional brief (optional)"
                  placeholder="Promo, seasonality (musim hujan, Lebaran), product names, tone, do/don't…"
                  value={form.brief}
                  maxLength={1000}
                  onChange={(e) => setForm({ ...form, brief: e.target.value })}
                  error={errors.brief}
                />
                {genError && <Alert>{genError}</Alert>}
                <div className="flex justify-end">
                  <Button size="lg" icon={<Sparkles className="size-4" />} loading={generating} onClick={submit}>
                    {generating ? `Generating ${form.count} ideas…` : `Generate ${form.count} ideas`}
                  </Button>
                </div>
              </CardBody>
            </Card>
            <aside className="space-y-4">
              <Card>
                <CardBody className="space-y-3 text-sm text-slate-600">
                  <p className="flex items-center gap-2 font-semibold text-slate-900">
                    <Lightbulb className="size-4 text-amber-500" /> Tips for better ideas
                  </p>
                  <ul className="list-disc space-y-1.5 pl-5">
                    <li>Pick a high-scoring trend so ideas reuse a proven hook and format.</li>
                    <li>One audience per batch — contractors care about coverage & speed, home owners about looks & durability.</li>
                    <li>Mention real promos or services in the brief; the AI never invents prices or claims.</li>
                  </ul>
                </CardBody>
              </Card>
              {generating && (
                <Card>
                  <CardBody className="space-y-2">
                    <p className="text-sm font-medium text-slate-900">AI is writing your ideas…</p>
                    <p className="text-xs text-slate-500">20 ideas usually take 20–60 seconds. You can keep this tab open.</p>
                    {[0, 1, 2].map((i) => (
                      <Skeleton key={i} className="h-10 w-full" />
                    ))}
                  </CardBody>
                </Card>
              )}
            </aside>
          </div>
        )}

        {tab === 'ideas' && (
          <>
            <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
                <input className="input pl-9" placeholder="Search ideas…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search ideas" />
              </div>
              <select className="input md:w-80" value={batch} onChange={(e) => setBatch(e.target.value)} aria-label="Filter by batch">
                <option value="">All batches</option>
                {batches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label} ({b.count})
                  </option>
                ))}
              </select>
              <Button variant={favOnly ? 'secondary' : 'outline'} icon={<Star className="size-4" />} onClick={() => setFavOnly((f) => !f)} aria-pressed={favOnly}>
                Favorites
              </Button>
            </div>
            {ideas.loading ? (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-72" />
                ))}
              </div>
            ) : shownIdeas.length ? (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {shownIdeas.map((idea) => (
                  <IdeaCard
                    key={idea.id}
                    idea={idea}
                    canEdit={canEdit}
                    onScript={() => setScriptFor(idea)}
                    onViewScript={() => setViewScriptId(idea.lastScriptId ?? null)}
                    onEdit={() => setEditIdea(idea)}
                    onDelete={() => setConfirmIdea(idea)}
                    onFavorite={() => updateIdea(idea.id, { favorite: !idea.favorite }).catch((err) => toast.error(errorMessage(err)))}
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<Lightbulb className="size-5" />}
                title="No content ideas"
                description={canEdit ? 'Fill in the brief and generate your first batch.' : 'No ideas have been created for your store yet.'}
                action={
                  <RoleGate roles={['super_admin', 'marketing_manager']}>
                    <Button onClick={() => setTab('generate')}>Generate ideas</Button>
                  </RoleGate>
                }
              />
            )}
          </>
        )}

        {tab === 'scripts' &&
          (scripts.loading ? (
            <Skeleton className="h-64" />
          ) : scripts.data.length ? (
            <div className="card overflow-hidden">
              <ul className="divide-y divide-slate-100">
                {scripts.data.map((s) => (
                  <li key={s.id}>
                    <button type="button" onClick={() => setViewScriptId(s.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50">
                      <FileText className="size-5 shrink-0 text-brand-700" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-900">{s.title}</p>
                        <p className="truncate text-xs text-slate-500">“{s.hook.voice}”</p>
                      </div>
                      <div className="hidden shrink-0 gap-1.5 sm:flex">
                        <Badge>{s.duration}s</Badge>
                        <Badge>{s.platform}</Badge>
                      </div>
                      <span className="hidden w-24 shrink-0 text-right text-xs text-slate-500 md:block">{timeAgo(s.createdAt)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <EmptyState icon={<FileText className="size-5" />} title="No scripts yet" description="Open a content idea and click “Generate script”." />
          ))}
      </div>

      <ScriptRequestModal
        key={`script-request-${scriptFor?.id ?? 'none'}`}
        idea={scriptFor}
        onClose={() => setScriptFor(null)}
        onCreated={(id) => {
          setScriptFor(null)
          toast.success('Script ready.')
          setViewScriptId(id)
        }}
      />
      <ScriptViewerModal key={`script-view-${viewScriptId ?? 'none'}`} script={viewScript} canEdit={canEdit} onClose={() => setViewScriptId(null)} />
      <IdeaEditModal
        key={`idea-edit-${editIdea?.id ?? 'none'}`}
        idea={editIdea}
        onClose={() => setEditIdea(null)}
        onSaved={() => {
          setEditIdea(null)
          toast.success('Idea updated.')
        }}
      />
      <ConfirmDialog
        open={!!confirmIdea}
        title="Delete idea?"
        message={<>“{confirmIdea?.title}” will be permanently deleted.</>}
        loading={deleting}
        onClose={() => setConfirmIdea(null)}
        onConfirm={async () => {
          if (!confirmIdea) return
          setDeleting(true)
          try {
            await deleteIdea(confirmIdea.id)
            toast.success('Idea deleted.')
            setConfirmIdea(null)
          } catch (err) {
            toast.error(errorMessage(err))
          } finally {
            setDeleting(false)
          }
        }}
      />
    </>
  )
}
