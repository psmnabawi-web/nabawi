import { useState } from 'react'
import { updateIdea } from '../../services/firestore'
import type { ContentIdea } from '../../types'
import { errorMessage } from '../../utils/errors'
import { Alert, Button, Modal, TextArea, TextInput } from '../ui'

export function IdeaEditModal({ idea, onClose, onSaved }: { idea: ContentIdea | null; onClose: () => void; onSaved: () => void }) {
  // Parent remounts this component per idea (key), so state initializes from props.
  const [form, setForm] = useState({ title: idea?.title ?? '', hook: idea?.hook ?? '', storyline: idea?.storyline ?? '', cta: idea?.cta ?? '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    if (form.title.trim().length < 3) {
      setError('Title must be at least 3 characters.')
      return
    }
    if (!idea) return
    setSaving(true)
    try {
      await updateIdea(idea.id, { title: form.title.trim(), hook: form.hook.trim(), storyline: form.storyline.trim(), cta: form.cta.trim() })
      onSaved()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }
  return (
    <Modal
      open={!!idea}
      onClose={onClose}
      busy={saving}
      title="Edit content idea"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button loading={saving} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <TextInput label="Title" value={form.title} maxLength={160} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
        <TextArea label="Hook" value={form.hook} maxLength={400} onChange={(e) => setForm({ ...form, hook: e.target.value })} />
        <TextArea label="Storyline" value={form.storyline} maxLength={1500} onChange={(e) => setForm({ ...form, storyline: e.target.value })} />
        <TextArea label="CTA" value={form.cta} maxLength={300} onChange={(e) => setForm({ ...form, cta: e.target.value })} />
        {error && <Alert>{error}</Alert>}
      </div>
    </Modal>
  )
}
