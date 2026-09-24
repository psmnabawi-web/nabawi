import { Clapperboard, Copy, Download, Pencil, Save, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useToast } from '../../hooks/useToast'
import { deleteScript, updateScript } from '../../services/firestore'
import type { ScriptBeat, ScriptScene, VideoScript } from '../../types'
import { scriptToText } from '../../utils/script'
import { providerLabel } from '../../utils/constants'
import { errorMessage } from '../../utils/errors'
import { formatDateTime } from '../../utils/format'
import { Badge, Button, ConfirmDialog, Modal, TextArea, TextInput } from '../ui'

function BeatBlock({ label, beat, accent }: { label: string; beat: ScriptBeat; accent?: boolean }) {
  return (
    <div className={accent ? 'rounded-lg border border-brand-200 bg-brand-50/60 p-4' : 'rounded-lg border border-slate-200 p-4'}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-bold tracking-wide text-brand-900 uppercase">{label}</p>
        <span className="text-xs text-slate-500 tabular-nums">{beat.timeRange}</span>
      </div>
      <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-[72px_1fr]">
        <dt className="font-medium text-slate-500">Visual</dt>
        <dd className="text-slate-800">{beat.visual}</dd>
        <dt className="font-medium text-slate-500">Voice</dt>
        <dd className="text-slate-900">“{beat.voice}”</dd>
        {beat.onScreenText && (
          <>
            <dt className="font-medium text-slate-500">Text</dt>
            <dd className="text-slate-800">{beat.onScreenText}</dd>
          </>
        )}
      </dl>
    </div>
  )
}

export function ScriptViewerModal({ script, canEdit, onClose }: { script: VideoScript | null; canEdit: boolean; onClose: () => void }) {
  const toast = useToast()
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<VideoScript | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  if (!script) return null
  const s = editing && draft ? draft : script

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(scriptToText(script))
      toast.success('Script copied to clipboard.')
    } catch {
      toast.error('Clipboard is not available in this browser.')
    }
  }
  const download = () => {
    const blob = new Blob([scriptToText(script)], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${script.title.replace(/[^\w-]+/g, '-').slice(0, 60) || 'script'}.txt`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const save = async () => {
    if (!draft) return
    if (draft.title.trim().length < 3) {
      toast.error('Title must be at least 3 characters.')
      return
    }
    setSaving(true)
    try {
      await updateScript(script.id, {
        title: draft.title.trim(),
        hook: draft.hook,
        scenes: draft.scenes,
        cta: draft.cta,
        voiceOver: draft.voiceOver,
        caption: draft.caption,
        hashtags: draft.hashtags.map((h) => h.trim()).filter(Boolean).slice(0, 15),
        musicSuggestion: draft.musicSuggestion,
      })
      toast.success('Script saved.')
      setEditing(false)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }
  const setBeat = (key: 'hook' | 'cta', field: keyof ScriptBeat, value: string) => setDraft((d) => (d ? { ...d, [key]: { ...d[key], [field]: value } } : d))
  const setScene = (i: number, field: keyof ScriptScene, value: string) =>
    setDraft((d) => (d ? { ...d, scenes: d.scenes.map((sc, idx) => (idx === i ? { ...sc, [field]: value } : sc)) } : d))
  const startEdit = () => {
    setDraft(structuredClone(script))
    setEditing(true)
  }

  return (
    <>
      <Modal
        open
        onClose={onClose}
        size="xl"
        busy={saving}
        title={s.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge>{s.duration} sec</Badge>
            <Badge>{s.platform}</Badge>
            <Badge>{s.tone}</Badge>
            <span className="text-xs text-slate-400">
              {providerLabel(s.provider)} · {formatDateTime(s.createdAt)}
            </span>
          </span>
        }
        footer={
          editing ? (
            <>
              <Button variant="outline" onClick={() => setEditing(false)} disabled={saving}>
                Cancel
              </Button>
              <Button icon={<Save className="size-4" />} loading={saving} onClick={save}>
                Save changes
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" icon={<Copy className="size-4" />} onClick={copy}>
                Copy
              </Button>
              <Button variant="ghost" icon={<Download className="size-4" />} onClick={download}>
                .txt
              </Button>
              {canEdit && (
                <>
                  <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => setConfirmDelete(true)}>
                    Delete
                  </Button>
                  <Button variant="outline" icon={<Pencil className="size-4" />} onClick={startEdit}>
                    Edit
                  </Button>
                  <Button icon={<Clapperboard className="size-4" />} onClick={() => navigate(`/video?scriptId=${script.id}`)}>
                    Create video
                  </Button>
                </>
              )}
            </>
          )
        }
      >
        {editing && draft ? (
          <div className="space-y-4">
            <TextInput label="Title" value={draft.title} maxLength={160} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            {(['hook', 'cta'] as const).map((k) => (
              <fieldset key={k} className="rounded-lg border border-slate-200 p-3">
                <legend className="px-1 text-xs font-bold text-brand-900 uppercase">{k === 'hook' ? `Hook (${draft.hook.timeRange})` : `CTA (${draft.cta.timeRange})`}</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  <TextArea label="Visual" value={draft[k].visual} onChange={(e) => setBeat(k, 'visual', e.target.value)} />
                  <TextArea label="Voice" value={draft[k].voice} onChange={(e) => setBeat(k, 'voice', e.target.value)} />
                </div>
              </fieldset>
            ))}
            {draft.scenes.map((sc, i) => (
              <fieldset key={i} className="rounded-lg border border-slate-200 p-3">
                <legend className="px-1 text-xs font-bold text-brand-900 uppercase">
                  Scene {sc.sceneNumber} ({sc.timeRange})
                </legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  <TextArea label="Visual" value={sc.visual} onChange={(e) => setScene(i, 'visual', e.target.value)} />
                  <TextArea label="Voice" value={sc.voice} onChange={(e) => setScene(i, 'voice', e.target.value)} />
                </div>
              </fieldset>
            ))}
            <TextArea label="Voice-over" value={draft.voiceOver} maxLength={5000} onChange={(e) => setDraft({ ...draft, voiceOver: e.target.value })} />
            <TextArea label="Caption" value={draft.caption} maxLength={2200} onChange={(e) => setDraft({ ...draft, caption: e.target.value })} />
            <TextInput label="Hashtags (space separated)" value={draft.hashtags.join(' ')} onChange={(e) => setDraft({ ...draft, hashtags: e.target.value.split(/\s+/) })} />
          </div>
        ) : (
          <div className="space-y-3">
            <BeatBlock label="Hook 0-3 second" beat={s.hook} accent />
            {s.scenes.map((sc) => (
              <BeatBlock key={sc.sceneNumber} label={`Scene ${sc.sceneNumber}`} beat={sc} />
            ))}
            <BeatBlock label="CTA" beat={s.cta} accent />
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-lg bg-slate-50 p-4">
                <p className="text-xs font-bold text-slate-500 uppercase">Voice-over</p>
                <p className="mt-1 text-sm whitespace-pre-line text-slate-800">{s.voiceOver}</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-4">
                <p className="text-xs font-bold text-slate-500 uppercase">Caption</p>
                <p className="mt-1 text-sm whitespace-pre-line text-slate-800">{s.caption}</p>
                <p className="mt-2 text-sm font-medium text-brand-800">{s.hashtags.join(' ')}</p>
                {s.musicSuggestion && <p className="mt-2 text-xs text-slate-500">Music: {s.musicSuggestion}</p>}
              </div>
            </div>
          </div>
        )}
      </Modal>
      <ConfirmDialog
        open={confirmDelete}
        title="Delete script?"
        message="The script will be permanently deleted. Videos already generated from it are kept."
        loading={deleting}
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          setDeleting(true)
          try {
            await deleteScript(script.id)
            toast.success('Script deleted.')
            setConfirmDelete(false)
            onClose()
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
