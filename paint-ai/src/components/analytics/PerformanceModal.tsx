import { useState } from 'react'
import { savePerformance } from '../../services/firestore'
import type { GeneratedVideo, PerformanceRecord, Platform } from '../../types'
import { PLATFORMS } from '../../utils/constants'
import { engagementRate } from '../../utils/engagement'
import { errorMessage } from '../../utils/errors'
import { formatPercent } from '../../utils/format'
import { fieldErrors, performanceSchema } from '../../utils/validation'
import { Alert, Button, Modal, Segmented, TextInput } from '../ui'

const FIELDS = [
  { key: 'views', label: 'Views' },
  { key: 'likes', label: 'Likes' },
  { key: 'comments', label: 'Comments' },
  { key: 'shares', label: 'Shares' },
  { key: 'leads', label: 'Leads (WA/DM/visits)' },
  { key: 'salesImpact', label: 'Sales impact (IDR)' },
] as const

type FormState = Record<(typeof FIELDS)[number]['key'], string> & { platform: Platform; publishedUrl: string }

export function PerformanceModal({ video, record, onClose, onSaved }: { video: GeneratedVideo | null; record: PerformanceRecord | null; onClose: () => void; onSaved: () => void }) {
  // Parent remounts per video (key) once the existing record is known.
  const [form, setForm] = useState<FormState>(() => ({
    platform: record?.platform ?? video?.platform ?? 'TikTok',
    publishedUrl: record?.publishedUrl ?? video?.publishedUrl ?? '',
    views: String(record?.views ?? ''),
    likes: String(record?.likes ?? ''),
    comments: String(record?.comments ?? ''),
    shares: String(record?.shares ?? ''),
    leads: String(record?.leads ?? ''),
    salesImpact: String(record?.salesImpact ?? ''),
  }))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const num = (v: string) => (v.trim() === '' ? 0 : Number(v.replace(/[.,\s](?=\d{3}(\D|$))/g, '')))
  const preview = engagementRate({ views: num(form.views), likes: num(form.likes), comments: num(form.comments), shares: num(form.shares) })

  const save = async () => {
    if (!video) return
    const parsed = performanceSchema.safeParse({
      platform: form.platform,
      publishedUrl: form.publishedUrl,
      views: num(form.views),
      likes: num(form.likes),
      comments: num(form.comments),
      shares: num(form.shares),
      leads: num(form.leads),
      salesImpact: num(form.salesImpact),
    })
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error))
      return
    }
    setErrors({})
    setSaving(true)
    try {
      await savePerformance(video, parsed.data)
      onSaved()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={!!video}
      onClose={onClose}
      busy={saving}
      title="Record performance"
      description={video?.title}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button loading={saving} onClick={save}>
            Save metrics
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Segmented label="Platform" value={form.platform} onChange={(p) => setForm({ ...form, platform: p })} options={PLATFORMS.map((p) => ({ value: p, label: p }))} />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {FIELDS.map((f) => (
            <TextInput key={f.key} label={f.label} inputMode="numeric" value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} error={errors[f.key]} placeholder="0" />
          ))}
        </div>
        <TextInput label="Post URL (optional)" type="url" value={form.publishedUrl} onChange={(e) => setForm({ ...form, publishedUrl: e.target.value })} error={errors.publishedUrl} />
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
          Engagement rate = (likes + comments + shares) / views = <strong className="text-slate-900 tabular-nums">{formatPercent(preview)}</strong>
        </p>
        {error && <Alert>{error}</Alert>}
      </div>
    </Modal>
  )
}
