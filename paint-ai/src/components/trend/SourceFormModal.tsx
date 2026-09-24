import { useState } from 'react'
import { useStoreScope } from '../../hooks/useStoreScope'
import { createSource, updateSource } from '../../services/firestore'
import type { Platform, SocialSource, SourceType } from '../../types'
import { CATEGORIES, PLATFORM_HOSTS, PLATFORMS, SOURCE_TYPES } from '../../utils/constants'
import { errorMessage } from '../../utils/errors'
import { fieldErrors, sourceSchema, type SourceInput } from '../../utils/validation'
import { ScopeSelect } from '../ScopeSelect'
import { Alert, Button, Modal, Segmented, SelectInput, TextArea, TextInput } from '../ui'

const empty = (storeId: string) => ({
  platform: 'TikTok' as Platform,
  sourceType: 'content' as SourceType,
  url: '',
  keyword: '',
  category: 'paint',
  competitor: '',
  location: '',
  contentSample: '',
  storeId,
})

/**
 * MODULE 1 — add/edit a social media source (TikTok / Instagram / YouTube link, competitor account or hashtag).
 * "Save & Analyze Trend" saves then triggers the AI analyzer.
 */
export function SourceFormModal({ open, source, onClose, onSaved }: { open: boolean; source: SocialSource | null; onClose: () => void; onSaved: (id: string, analyze: boolean) => void }) {
  const { defaultScope } = useStoreScope()
  // Parent remounts per open (key), so state initializes from props.
  const [form, setForm] = useState(() =>
    source
      ? { platform: source.platform, sourceType: source.sourceType, url: source.url, keyword: source.keyword, category: source.category as string, competitor: source.competitor, location: source.location, contentSample: source.contentSample, storeId: source.storeId }
      : empty(defaultScope),
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<'save' | 'analyze' | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }))

  const save = async (analyze: boolean) => {
    setFormError(null)
    const parsed = sourceSchema.safeParse(form)
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error))
      return
    }
    setErrors({})
    setSaving(analyze ? 'analyze' : 'save')
    try {
      const data: SourceInput = parsed.data
      let id = source?.id
      if (id) await updateSource(id, data)
      else id = await createSource(data)
      onSaved(id, analyze)
    } catch (err) {
      setFormError(errorMessage(err))
    } finally {
      setSaving(null)
    }
  }

  const isHashtag = form.sourceType === 'hashtag'
  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={!!saving}
      size="lg"
      title={source ? 'Edit social source' : 'Add social media source'}
      description="Monitor a post, an account (incl. competitors) or a hashtag."
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={!!saving}>
            Cancel
          </Button>
          <Button variant="secondary" loading={saving === 'save'} disabled={!!saving} onClick={() => save(false)}>
            Save
          </Button>
          <Button loading={saving === 'analyze'} disabled={!!saving} onClick={() => save(true)}>
            Save & Analyze Trend
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Segmented label="Platform" value={form.platform} onChange={(v) => set('platform', v)} options={PLATFORMS.map((p) => ({ value: p, label: p }))} />
        </div>
        <SelectInput
          label="Source type"
          value={form.sourceType}
          onChange={(e) => set('sourceType', e.target.value as SourceType)}
          hint={SOURCE_TYPES.find((t) => t.value === form.sourceType)?.hint}
          options={SOURCE_TYPES.map((t) => ({ value: t.value, label: t.label }))}
        />
        <SelectInput label="Category" value={form.category} onChange={(e) => set('category', e.target.value)} error={errors.category} options={CATEGORIES.map((c) => ({ value: c.value, label: c.label }))} />
        <TextInput
          wrapperClassName="sm:col-span-2"
          label={isHashtag ? 'URL (optional)' : 'URL'}
          type="url"
          inputMode="url"
          placeholder={`https://${PLATFORM_HOSTS[form.platform][0]}/@brand`}
          value={form.url}
          onChange={(e) => set('url', e.target.value)}
          error={errors.url}
          required={!isHashtag}
        />
        <TextInput label={isHashtag ? 'Hashtag / keyword' : 'Keyword / hashtag'} placeholder="#catrumah" value={form.keyword} onChange={(e) => set('keyword', e.target.value)} error={errors.keyword} required={isHashtag} />
        <TextInput label="Competitor account (optional)" placeholder="@competitor" value={form.competitor} onChange={(e) => set('competitor', e.target.value)} error={errors.competitor} />
        <TextInput label="Location / market" placeholder="Jakarta" value={form.location} onChange={(e) => set('location', e.target.value)} error={errors.location} />
        <ScopeSelect value={form.storeId} onChange={(v) => set('storeId', v)} error={errors.storeId} />
        <TextArea
          wrapperClassName="sm:col-span-2"
          label="Caption, transcript or observations (recommended)"
          placeholder="Paste the caption, the spoken hook, on-screen text, view/like counts or what happens in the video. The AI cannot watch videos, so this makes the analysis far more accurate."
          value={form.contentSample}
          onChange={(e) => set('contentSample', e.target.value)}
          error={errors.contentSample}
          maxLength={3000}
          hint={`${form.contentSample.length}/3000 · TikTok & YouTube captions are also fetched automatically when public.`}
        />
      </div>
      {formError && (
        <div className="mt-4">
          <Alert>{formError}</Alert>
        </div>
      )}
    </Modal>
  )
}
