import { ArrowRight, CheckCircle2, Clapperboard, Cloud, FileText, Film, Save, Send, Sparkles, Wand2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { PerformanceModal } from '../components/analytics/PerformanceModal'
import { ScopeSelect } from '../components/ScopeSelect'
import { Alert, Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, EmptyState, PageHeader, Segmented, SelectInput, Skeleton, Tabs, TextArea, TextInput } from '../components/ui'
import { PublishModal, RenameModal } from '../components/video/PublishModal'
import { VideoCard, type VideoCardAction } from '../components/video/VideoCard'
import { useAuth } from '../hooks/useAuth'
import { useCollection, useDocument } from '../hooks/useFirestore'
import { useIntegrationStatus } from '../hooks/useIntegrationStatus'
import { useStoreScope } from '../hooks/useStoreScope'
import { useToast } from '../hooks/useToast'
import { deleteVideo, isContentManager, recentScoped, unpublishVideo } from '../services/firestore'
import { generateVideo, videoAction } from '../services/functions'
import type { GeneratedVideo, PerformanceRecord, VideoDuration, VideoProvider, VideoScript, VideoStatus, VideoStyle, VideoTemplate } from '../types'
import { cn } from '../utils/cn'
import { DURATIONS, VIDEO_PROVIDERS, VIDEO_STATUSES, VIDEO_STYLES, VIDEO_TEMPLATES } from '../utils/constants'
import { errorMessage } from '../utils/errors'
import { fieldErrors, videoRequestSchema } from '../utils/validation'

type Tab = 'create' | 'library'

const PROCESS = [
  { icon: Wand2, label: 'Generate prompt' },
  { icon: Send, label: 'Send API request' },
  { icon: Film, label: 'Save result URL' },
  { icon: Cloud, label: 'Store in Firebase Storage' },
]

export default function VideoStudioPage() {
  const { profile } = useAuth()
  const { selectedStoreId, defaultScope, storeName } = useStoreScope()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const canEdit = isContentManager(profile)
  const deps = [profile?.uid, profile?.role, profile?.storeId, selectedStoreId]
  const videos = useCollection<GeneratedVideo>(() => recentScoped('generated_videos', profile, selectedStoreId, 120), deps)
  const scripts = useCollection<VideoScript>(() => (canEdit ? recentScoped('video_scripts', profile, selectedStoreId, 100) : null), deps)
  const integrations = useIntegrationStatus(canEdit)

  const presetScript = params.get('scriptId')
  const [tab, setTab] = useState<Tab>(canEdit ? 'create' : 'library')
  // null fields follow a default (selected script, backend default provider, top-bar store scope).
  const [form, setForm] = useState({
    template: 'before_after' as VideoTemplate,
    scriptId: presetScript as string | null,
    title: '',
    duration: null as VideoDuration | null,
    style: 'Realistic' as VideoStyle,
    provider: null as VideoProvider | null,
    storeId: null as string | null,
    brief: '',
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState<'draft' | 'generate' | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<VideoStatus | ''>('')
  const [busy, setBusy] = useState<Record<string, VideoCardAction>>({})
  const [publishFor, setPublishFor] = useState<GeneratedVideo | null>(null)
  const [renameFor, setRenameFor] = useState<GeneratedVideo | null>(null)
  const [perfFor, setPerfFor] = useState<GeneratedVideo | null>(null)
  const perfDoc = useDocument<PerformanceRecord>(perfFor ? `performance/${perfFor.id}` : null)
  const [confirmDelete, setConfirmDelete] = useState<GeneratedVideo | null>(null)
  const [deleting, setDeleting] = useState(false)

  const providerStatus = (id: string) => integrations.data?.video.find((v) => v.id === id)
  const selectedScript = scripts.data.find((s) => s.id === form.scriptId)
  const provider: VideoProvider = form.provider ?? integrations.data?.defaults.videoProvider ?? 'mock'
  const duration: VideoDuration = form.duration ?? selectedScript?.duration ?? 30
  const storeId = form.storeId ?? selectedScript?.storeId ?? defaultScope
  const title = form.title || selectedScript?.title || ''
  const shown = useMemo(() => videos.data.filter((v) => !statusFilter || v.status === statusFilter), [videos.data, statusFilter])
  const counts = useMemo(() => Object.fromEntries(VIDEO_STATUSES.map((s) => [s, videos.data.filter((v) => v.status === s).length])), [videos.data])

  const submit = async (saveAsDraft: boolean) => {
    setSubmitError(null)
    const parsed = videoRequestSchema.safeParse({ ...form, provider, duration, storeId, title, ratio: '9:16', saveAsDraft })
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error))
      return
    }
    if (provider === 'heygen' && !form.scriptId) {
      setErrors({ scriptId: 'HeyGen avatar videos need a script (the avatar reads the voice-over).' })
      return
    }
    setErrors({})
    setSubmitting(saveAsDraft ? 'draft' : 'generate')
    try {
      const res = await generateVideo({ ...parsed.data, provider })
      toast.success(saveAsDraft ? 'Draft saved.' : 'Video generation started. It will appear in the library when ready.')
      setTab('library')
      setStatusFilter('')
      setForm((f) => ({ ...f, title: '', brief: '', scriptId: null, duration: null, storeId: null }))
      if (presetScript) setParams({}, { replace: true })
      return res
    } catch (err) {
      setSubmitError(errorMessage(err))
    } finally {
      setSubmitting(null)
    }
  }

  const act = async (video: GeneratedVideo, action: VideoCardAction) => {
    if (action === 'publish') return setPublishFor(video)
    if (action === 'rename') return setRenameFor(video)
    if (action === 'delete') return setConfirmDelete(video)
    if (action === 'performance') return setPerfFor(video)
    setBusy((b) => ({ ...b, [video.id]: action }))
    try {
      if (action === 'unpublish') {
        await unpublishVideo(video.id)
        toast.success('Video moved back to Completed.')
      } else {
        const res = await videoAction({ videoId: video.id, action })
        if (action === 'refresh') toast.toast(res.busy ? 'The video is being processed right now — check again shortly.' : `Status: ${res.status}${res.total ? ` (${res.done}/${res.total} clips)` : ''}`)
        else toast.success('Generation started.')
      }
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy((b) => {
        const next = { ...b }
        delete next[video.id]
        return next
      })
    }
  }

  return (
    <>
      <PageHeader title="Video Studio" description="Generate vertical marketing videos with Runway, Kling, Pika or HeyGen — stored automatically in Firebase Storage." />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[...(canEdit ? [{ id: 'create' as Tab, label: 'Create video' }] : []), { id: 'library', label: 'Video library', count: videos.data.length }]} />

      <div className="mt-5">
        {tab === 'create' && canEdit && (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
            <div className="space-y-6">
              <Card>
                <CardHeader title="1. Choose a template" />
                <CardBody>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" role="radiogroup" aria-label="Video template">
                    {VIDEO_TEMPLATES.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        role="radio"
                        aria-checked={form.template === t.id}
                        onClick={() => setForm({ ...form, template: t.id })}
                        className={cn(
                          'rounded-xl border p-4 text-left transition',
                          form.template === t.id ? 'border-brand-700 bg-brand-50 ring-2 ring-brand-700/20' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50',
                        )}
                      >
                        <span className="text-2xl" aria-hidden>
                          {t.emoji}
                        </span>
                        <p className="mt-2 text-sm font-semibold text-slate-900">{t.label}</p>
                        <p className="mt-0.5 text-xs text-slate-500">{t.description}</p>
                      </button>
                    ))}
                  </div>
                </CardBody>
              </Card>

              <Card>
                <CardHeader title="2. Script & brief" subtitle="Using a script gives the AI scene-by-scene direction." />
                <CardBody className="grid gap-4 sm:grid-cols-2">
                  <SelectInput
                    wrapperClassName="sm:col-span-2"
                    label="Video script"
                    value={form.scriptId ?? ''}
                    error={errors.scriptId}
                    onChange={(e) => {
                      const s = scripts.data.find((x) => x.id === e.target.value)
                      setForm({ ...form, scriptId: s?.id ?? null, title: '', duration: null, storeId: null })
                    }}
                    options={[{ value: '', label: 'No script — use the template brief' }, ...scripts.data.map((s) => ({ value: s.id, label: `${s.title} (${s.duration}s)` }))]}
                    hint={selectedScript ? `Hook: “${selectedScript.hook.voice}”` : undefined}
                  />
                  <TextInput wrapperClassName="sm:col-span-2" label="Video title" value={title} maxLength={140} onChange={(e) => setForm({ ...form, title: e.target.value })} error={errors.title} placeholder="Before After Rumah Minimalis" required />
                  <TextArea wrapperClassName="sm:col-span-2" label="Extra visual brief (optional)" value={form.brief} maxLength={1000} onChange={(e) => setForm({ ...form, brief: e.target.value })} placeholder="e.g. warm beige facade, family of four, Jakarta suburb" />
                </CardBody>
              </Card>

              <Card>
                <CardHeader title="3. Settings" />
                <CardBody className="space-y-5">
                  <div className="flex flex-wrap gap-6">
                    <Segmented label="Duration" value={duration} onChange={(d) => setForm({ ...form, duration: d })} options={DURATIONS.map((d) => ({ value: d, label: `${d} sec` }))} />
                    <Segmented label="Ratio" value="9:16" onChange={() => undefined} options={[{ value: '9:16', label: '9:16 vertical' }]} />
                    <Segmented label="Style" value={form.style} onChange={(s) => setForm({ ...form, style: s })} options={VIDEO_STYLES.map((s) => ({ value: s, label: s }))} />
                  </div>
                  <fieldset>
                    <legend className="label">Video AI provider</legend>
                    {integrations.error && <Alert kind="warning">{integrations.error}</Alert>}
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {VIDEO_PROVIDERS.map((p) => {
                        const st = providerStatus(p.id)
                        const disabled = !!integrations.data && !st?.configured
                        return (
                          <label
                            key={p.id}
                            className={cn(
                              'flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition',
                              provider === p.id ? 'border-brand-700 bg-brand-50' : 'border-slate-200 hover:bg-slate-50',
                              disabled && 'cursor-not-allowed opacity-60',
                            )}
                          >
                            <input type="radio" name="provider" className="mt-1 accent-brand-800" checked={provider === p.id} disabled={disabled} onChange={() => setForm({ ...form, provider: p.id })} />
                            <span className="min-w-0">
                              <span className="flex items-center gap-2 font-medium text-slate-900">
                                {p.label}
                                {integrations.loading ? null : st?.configured ? <CheckCircle2 className="size-3.5 text-emerald-600" aria-label="configured" /> : <Badge className="bg-slate-100 text-slate-500 ring-slate-200">Not configured</Badge>}
                              </span>
                              <span className="mt-0.5 block text-xs text-slate-500">{p.note}</span>
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  </fieldset>
                  <div className="max-w-sm">
                    <ScopeSelect value={storeId} onChange={(v) => setForm({ ...form, storeId: v })} error={errors.storeId} />
                  </div>
                </CardBody>
              </Card>
            </div>

            <aside className="space-y-4 xl:sticky xl:top-24 xl:self-start">
              <Card>
                <CardHeader title="Summary" />
                <CardBody className="space-y-3 text-sm">
                  <dl className="grid grid-cols-[96px_1fr] gap-y-1.5">
                    <dt className="text-slate-500">Template</dt>
                    <dd className="font-medium text-slate-900">{VIDEO_TEMPLATES.find((t) => t.id === form.template)?.label}</dd>
                    <dt className="text-slate-500">Script</dt>
                    <dd className="text-slate-900">{selectedScript ? selectedScript.title : '—'}</dd>
                    <dt className="text-slate-500">Format</dt>
                    <dd className="text-slate-900">
                      {duration}s · 9:16 · {form.style}
                    </dd>
                    <dt className="text-slate-500">Provider</dt>
                    <dd className="text-slate-900">{VIDEO_PROVIDERS.find((p) => p.id === provider)?.label}</dd>
                    <dt className="text-slate-500">Scope</dt>
                    <dd className="text-slate-900">{storeName(storeId)}</dd>
                  </dl>
                  <ol className="space-y-2 rounded-lg bg-slate-50 p-3">
                    {PROCESS.map(({ icon: Icon, label }, i) => (
                      <li key={label} className="flex items-center gap-2 text-xs text-slate-600">
                        <span className="flex size-6 items-center justify-center rounded-full bg-white text-brand-800 ring-1 ring-slate-200">
                          <Icon className="size-3.5" aria-hidden />
                        </span>
                        {label}
                        {i < PROCESS.length - 1 && <ArrowRight className="ml-auto size-3 text-slate-300" aria-hidden />}
                      </li>
                    ))}
                  </ol>
                  {integrations.data && (
                    <p className="text-xs text-slate-500">
                      Today: {integrations.data.usageToday.video}/{integrations.data.limits.videoDaily} video jobs used.
                    </p>
                  )}
                  {submitError && <Alert>{submitError}</Alert>}
                  <div className="flex flex-col gap-2">
                    <Button size="lg" icon={<Sparkles className="size-4" />} loading={submitting === 'generate'} disabled={!!submitting} onClick={() => submit(false)}>
                      Generate video
                    </Button>
                    <Button variant="outline" icon={<Save className="size-4" />} loading={submitting === 'draft'} disabled={!!submitting} onClick={() => submit(true)}>
                      Save as draft
                    </Button>
                  </div>
                  <p className="text-xs text-slate-400">Clip-based providers generate 5–10s clips that are stitched automatically. Processing usually takes 2–10 minutes.</p>
                </CardBody>
              </Card>
            </aside>
          </div>
        )}

        {tab === 'library' && (
          <>
            <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filter by status">
              {(['', ...VIDEO_STATUSES] as (VideoStatus | '')[]).map((s) => (
                <button
                  key={s || 'all'}
                  type="button"
                  onClick={() => setStatusFilter(s)}
                  aria-pressed={statusFilter === s}
                  className={cn('rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition', statusFilter === s ? 'bg-brand-950 text-white ring-brand-950' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50')}
                >
                  {s || 'All'} <span className="tabular-nums opacity-70">{s ? counts[s] : videos.data.length}</span>
                </button>
              ))}
            </div>
            {videos.error && <Alert>{videos.error}</Alert>}
            {videos.loading ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="aspect-[9/16] max-h-[420px]" />
                ))}
              </div>
            ) : shown.length ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {shown.map((v) => (
                  <VideoCard key={v.id} video={v} canEdit={canEdit} busy={busy[v.id] ?? null} onAction={(a) => act(v, a)} storeLabel={storeName(v.storeId)} />
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<Clapperboard className="size-5" />}
                title="No videos"
                description={canEdit ? 'Create your first AI video from a template or a script.' : 'No videos have been produced for your store yet.'}
                action={
                  canEdit && (
                    <Button icon={<FileText className="size-4" />} onClick={() => setTab('create')}>
                      Create video
                    </Button>
                  )
                }
              />
            )}
          </>
        )}
      </div>

      <PublishModal
        key={`publish-${publishFor?.id ?? 'none'}`}
        video={publishFor}
        onClose={() => setPublishFor(null)}
        onDone={(msg) => {
          setPublishFor(null)
          toast.success(msg)
        }}
      />
      <RenameModal
        key={`rename-${renameFor?.id ?? 'none'}`}
        video={renameFor}
        onClose={() => setRenameFor(null)}
        onDone={() => {
          setRenameFor(null)
          toast.success('Video renamed.')
        }}
      />
      <PerformanceModal
        key={`perf-${perfFor && !perfDoc.loading ? perfFor.id : 'none'}`}
        video={perfFor && !perfDoc.loading ? perfFor : null}
        record={perfDoc.data}
        onClose={() => setPerfFor(null)}
        onSaved={() => {
          setPerfFor(null)
          toast.success('Performance saved.')
        }}
      />
      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete video?"
        message={<>“{confirmDelete?.title}” and its files in Firebase Storage will be permanently deleted, including recorded performance.</>}
        loading={deleting}
        onClose={() => setConfirmDelete(null)}
        onConfirm={async () => {
          if (!confirmDelete) return
          setDeleting(true)
          try {
            await deleteVideo(confirmDelete.id)
            toast.success('Video deleted.')
            setConfirmDelete(null)
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
