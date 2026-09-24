import { useState } from 'react'
import { publishVideo, renameVideo } from '../../services/firestore'
import type { GeneratedVideo, Platform } from '../../types'
import { PLATFORMS } from '../../utils/constants'
import { errorMessage } from '../../utils/errors'
import { Alert, Button, Modal, Segmented, TextInput } from '../ui'

export function PublishModal({ video, onClose, onDone }: { video: GeneratedVideo | null; onClose: () => void; onDone: (msg: string) => void }) {
  const [platform, setPlatform] = useState<Platform>(video?.platform ?? 'TikTok')
  const [url, setUrl] = useState(video?.publishedUrl ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    if (!video) return
    if (url && !/^https:\/\/\S+$/.test(url.trim())) {
      setError('Post URL must start with https://')
      return
    }
    setSaving(true)
    try {
      await publishVideo(video.id, platform, url.trim())
      onDone('Video marked as published. Record its performance in Analytics.')
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
      title="Mark as published"
      description={video?.title}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button loading={saving} onClick={save}>
            Mark published
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Segmented label="Published on" value={platform} onChange={setPlatform} options={PLATFORMS.map((p) => ({ value: p, label: p }))} />
        <TextInput label="Post URL (optional)" type="url" placeholder="https://www.tiktok.com/@brand/video/…" value={url} onChange={(e) => setUrl(e.target.value)} />
        {error && <Alert>{error}</Alert>}
      </div>
    </Modal>
  )
}

export function RenameModal({ video, onClose, onDone }: { video: GeneratedVideo | null; onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState(video?.title ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const save = async () => {
    if (!video) return
    if (title.trim().length < 3) {
      setError('Title must be at least 3 characters.')
      return
    }
    setSaving(true)
    try {
      await renameVideo(video.id, title)
      onDone()
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
      title="Rename video"
      size="sm"
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
      <TextInput label="Title" value={title} maxLength={140} onChange={(e) => setTitle(e.target.value)} error={error ?? undefined} />
    </Modal>
  )
}
