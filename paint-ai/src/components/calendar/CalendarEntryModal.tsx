import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useStoreScope } from '../../hooks/useStoreScope'
import { createCalendarEntry, deleteCalendarEntry, updateCalendarEntry } from '../../services/firestore'
import type { CalendarEntry, CalendarStatus, ContentIdea, GeneratedVideo, Platform } from '../../types'
import { CALENDAR_STATUSES, PLATFORMS } from '../../utils/constants'
import { errorMessage } from '../../utils/errors'
import { calendarSchema, fieldErrors } from '../../utils/validation'
import { ScopeSelect } from '../ScopeSelect'
import { Alert, Button, Modal, SelectInput, TextArea, TextInput } from '../ui'

export function CalendarEntryModal({
  open,
  entry,
  date,
  canEdit,
  ideas,
  videos,
  onClose,
  onDone,
}: {
  open: boolean
  entry: CalendarEntry | null
  date: string
  canEdit: boolean
  ideas: ContentIdea[]
  videos: GeneratedVideo[]
  onClose: () => void
  onDone: (msg: string) => void
}) {
  const { defaultScope, storeName } = useStoreScope()
  // Parent remounts per opened entry/date (key), so state initializes from props.
  const [form, setForm] = useState(() =>
    entry
      ? { title: entry.title, date: entry.date, platform: entry.platform, status: entry.status, contentId: entry.contentId, videoId: entry.videoId, notes: entry.notes, storeId: entry.storeId }
      : { title: '', date, platform: 'TikTok' as Platform, status: 'Planned' as CalendarStatus, contentId: null as string | null, videoId: null as string | null, notes: '', storeId: defaultScope },
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<'save' | 'delete' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    const parsed = calendarSchema.safeParse(form)
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error))
      return
    }
    setSaving('save')
    setError(null)
    try {
      if (entry) await updateCalendarEntry(entry.id, parsed.data)
      else await createCalendarEntry(parsed.data)
      onDone(entry ? 'Entry updated.' : 'Added to the calendar.')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(null)
    }
  }
  const remove = async () => {
    if (!entry) return
    setSaving('delete')
    try {
      await deleteCalendarEntry(entry.id)
      onDone('Entry deleted.')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(null)
    }
  }

  const linkedIdea = ideas.find((i) => i.id === form.contentId)
  const linkedVideo = videos.find((v) => v.id === form.videoId)

  if (!canEdit) {
    return (
      <Modal open={open} onClose={onClose} title={entry?.title ?? 'Calendar entry'}>
        {entry && (
          <dl className="grid grid-cols-[100px_1fr] gap-y-2 text-sm">
            <dt className="text-slate-500">Date</dt>
            <dd>{entry.date}</dd>
            <dt className="text-slate-500">Platform</dt>
            <dd>{entry.platform}</dd>
            <dt className="text-slate-500">Status</dt>
            <dd>{entry.status}</dd>
            <dt className="text-slate-500">Scope</dt>
            <dd>{storeName(entry.storeId)}</dd>
            {linkedIdea && (
              <>
                <dt className="text-slate-500">Content</dt>
                <dd>{linkedIdea.title}</dd>
              </>
            )}
            {linkedVideo && (
              <>
                <dt className="text-slate-500">Video</dt>
                <dd>{linkedVideo.title}</dd>
              </>
            )}
            {entry.notes && (
              <>
                <dt className="text-slate-500">Notes</dt>
                <dd className="whitespace-pre-line">{entry.notes}</dd>
              </>
            )}
          </dl>
        )}
      </Modal>
    )
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={!!saving}
      title={entry ? 'Edit calendar entry' : 'Schedule content'}
      footer={
        <>
          {entry && (
            <Button variant="ghost" className="mr-auto text-rose-700" icon={<Trash2 className="size-4" />} loading={saving === 'delete'} disabled={!!saving} onClick={remove}>
              Delete
            </Button>
          )}
          <Button variant="outline" onClick={onClose} disabled={!!saving}>
            Cancel
          </Button>
          <Button loading={saving === 'save'} disabled={!!saving} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextInput wrapperClassName="sm:col-span-2" label="Title" value={form.title} maxLength={140} onChange={(e) => setForm({ ...form, title: e.target.value })} error={errors.title} required />
        <TextInput label="Date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} error={errors.date} required />
        <SelectInput label="Platform" value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value as Platform })} options={PLATFORMS.map((p) => ({ value: p, label: p }))} />
        <SelectInput label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as CalendarStatus })} options={CALENDAR_STATUSES.map((s) => ({ value: s, label: s }))} />
        <ScopeSelect value={form.storeId} onChange={(v) => setForm({ ...form, storeId: v })} error={errors.storeId} />
        <SelectInput
          wrapperClassName="sm:col-span-2"
          label="Linked content idea (optional)"
          value={form.contentId ?? ''}
          onChange={(e) => {
            const idea = ideas.find((i) => i.id === e.target.value)
            setForm({ ...form, contentId: idea?.id ?? null, title: form.title || idea?.title || '' })
          }}
          options={[{ value: '', label: '—' }, ...ideas.map((i) => ({ value: i.id, label: i.title }))]}
        />
        <SelectInput
          wrapperClassName="sm:col-span-2"
          label="Linked video (optional)"
          value={form.videoId ?? ''}
          onChange={(e) => {
            const v = videos.find((x) => x.id === e.target.value)
            setForm({ ...form, videoId: v?.id ?? null, title: form.title || v?.title || '' })
          }}
          options={[{ value: '', label: '—' }, ...videos.map((v) => ({ value: v.id, label: `${v.title} (${v.status})` }))]}
        />
        <TextArea wrapperClassName="sm:col-span-2" label="Notes" value={form.notes} maxLength={1000} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        {error && (
          <div className="sm:col-span-2">
            <Alert>{error}</Alert>
          </div>
        )}
      </div>
    </Modal>
  )
}
