import { useState } from 'react'
import { generateScript } from '../../services/functions'
import type { ContentIdea, Platform, ScriptTone, VideoDuration } from '../../types'
import { DURATIONS, PLATFORMS, SCRIPT_TONES } from '../../utils/constants'
import { errorMessage } from '../../utils/errors'
import { Alert, Button, Modal, Segmented, SelectInput, TextArea } from '../ui'

/** MODULE 4 — request an AI video script for a content idea. */
export function ScriptRequestModal({ idea, onClose, onCreated }: { idea: ContentIdea | null; onClose: () => void; onCreated: (scriptId: string) => void }) {
  const [duration, setDuration] = useState<VideoDuration>(30)
  const [tone, setTone] = useState<ScriptTone>('Friendly')
  const [platform, setPlatform] = useState<Platform>(idea?.platform ?? 'TikTok')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!idea) return
    setLoading(true)
    setError(null)
    try {
      const res = await generateScript({ contentId: idea.id, duration, tone, platform, notes: notes.trim() })
      onCreated(res.scriptId)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      open={!!idea}
      onClose={onClose}
      busy={loading}
      title="Generate video script"
      description={idea?.title}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button loading={loading} onClick={submit}>
            {loading ? 'Writing script…' : 'Generate script'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Segmented label="Duration" value={duration} onChange={setDuration} options={DURATIONS.map((d) => ({ value: d, label: `${d} sec` }))} disabled={loading} />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectInput label="Tone" value={tone} onChange={(e) => setTone(e.target.value as ScriptTone)} options={SCRIPT_TONES.map((t) => ({ value: t, label: t }))} disabled={loading} />
          <SelectInput label="Platform" value={platform} onChange={(e) => setPlatform(e.target.value as Platform)} options={PLATFORMS.map((p) => ({ value: p, label: p }))} disabled={loading} />
        </div>
        <TextArea label="Notes for the AI (optional)" placeholder="e.g. mention free color consultation, shoot in our Jakarta store" value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} disabled={loading} />
        <p className="text-xs text-slate-500">Output: TITLE → HOOK 0-3 sec → SCENE 1..n (Visual / Voice) → CTA, plus full voice-over, caption and hashtags.</p>
        {error && <Alert>{error}</Alert>}
      </div>
    </Modal>
  )
}
