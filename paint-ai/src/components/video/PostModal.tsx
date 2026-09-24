import { CalendarClock, CheckCircle2, Copy, ExternalLink, Loader2, Send, Sparkles, XCircle } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { useToast } from '../../hooks/useToast'
import { saveSocialCaptions } from '../../services/firestore'
import { cancelPost, schedulePost, videoAction } from '../../services/functions'
import type { GeneratedVideo, SocialAccount, SocialCaptions, SocialPost } from '../../types'
import { cn } from '../../utils/cn'
import { POST_STATUS_STYLES } from '../../utils/constants'
import { errorMessage } from '../../utils/errors'
import { formatDateTime } from '../../utils/format'
import { Alert, Badge, Button, Modal, Segmented, SelectInput, TextArea, TextInput } from '../ui'

type Channel = 'instagram' | 'tiktok' | 'facebook' | 'youtube'
const CHANNELS: { id: Channel; label: string }[] = [
  { id: 'instagram', label: 'Instagram' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'youtube', label: 'YouTube Shorts' },
]
const EMPTY: SocialCaptions = { instagram: '', tiktok: '', facebook: '', youtubeTitle: '', youtubeDescription: '', hashtags: [] }
const hashtagCount = (text: string) => (text.match(/(^|\s)#[\p{L}\p{N}_]+/gu) ?? []).length

/** 'YYYY-MM-DDTHH:mm' for <input type="datetime-local"> in the browser's time zone. */
function localInputValue(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function CopyButton({ text }: { text: string }) {
  const toast = useToast()
  return (
    <Button
      size="sm"
      variant="outline"
      icon={<Copy className="size-3.5" />}
      disabled={!text}
      onClick={() => navigator.clipboard.writeText(text).then(() => toast.success('Copied to clipboard.'), () => toast.error('Copy failed.'))}
    >
      Copy
    </Button>
  )
}

function PostHistory({ posts }: { posts: SocialPost[] }) {
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  if (!posts.length) return null
  const cancel = async (id: string) => {
    setBusy(id)
    try {
      await cancelPost({ postId: id })
      toast.success('Scheduled post cancelled.')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }
  return (
    <div>
      <p className="label">Posts of this video</p>
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
        {posts.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
            <Badge className={POST_STATUS_STYLES[p.status]}>
              {p.status === 'Publishing' && <Loader2 className="size-3 animate-spin" aria-hidden />}
              {p.status}
            </Badge>
            <span className="font-medium text-slate-800">@{p.accountName}</span>
            <span className="text-xs text-slate-500">{p.status === 'Published' ? formatDateTime(p.publishedAt) : formatDateTime(p.scheduledAt)}</span>
            {p.auto && <span className="text-xs text-slate-400">auto</span>}
            <span className="ml-auto flex items-center gap-2">
              {p.permalink && (
                <a href={p.permalink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-brand-800 hover:underline">
                  Open <ExternalLink className="size-3" />
                </a>
              )}
              {p.status === 'Scheduled' && (
                <Button size="sm" variant="ghost" loading={busy === p.id} onClick={() => cancel(p.id)}>
                  Cancel
                </Button>
              )}
            </span>
            {p.error && <p className="w-full text-xs text-rose-600">{p.error}</p>}
          </li>
        ))}
      </ul>
    </div>
  )
}

function PostForm({
  video,
  accounts,
  posts,
  instagramReady,
  captions,
  onClose,
  onManual,
}: {
  video: GeneratedVideo
  accounts: SocialAccount[]
  posts: SocialPost[]
  instagramReady: boolean
  captions: SocialCaptions
  onClose: () => void
  onManual: () => void
}) {
  const toast = useToast()
  const [draft, setDraft] = useState<SocialCaptions>(captions)
  const [channel, setChannel] = useState<Channel>('instagram')
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState<'ai' | 'save' | 'post' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const eligible = accounts.filter((a) => a.status === 'connected' && (a.storeId === 'ALL' || video.storeId === 'ALL' || a.storeId === video.storeId))
  const [accountId, setAccountId] = useState(eligible.find((a) => a.storeId === video.storeId)?.id ?? eligible[0]?.id ?? '')
  const [when, setWhen] = useState<'now' | 'later'>('now')
  const [at, setAt] = useState(() => localInputValue(new Date(Date.now() + 60 * 60_000)))
  const [minAt] = useState(() => localInputValue(new Date(Date.now() + 5 * 60_000)))
  const set = (patch: Partial<SocialCaptions>) => {
    setDraft((d) => ({ ...d, ...patch }))
    setDirty(true)
  }
  const igTags = hashtagCount(draft.instagram)

  const rewrite = async () => {
    setBusy('ai')
    setError(null)
    try {
      await videoAction({ videoId: video.id, action: 'captions' })
      toast.success('New captions written. They appear here in a moment.')
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }
  const save = async (quiet = false) => {
    await saveSocialCaptions(video.id, { ...draft, hashtags: draft.hashtags ?? [] })
    setDirty(false)
    if (!quiet) toast.success('Captions saved.')
  }
  const post = async () => {
    setError(null)
    if (!accountId) return setError('Choose an Instagram account.')
    if (!draft.instagram.trim()) return setError('Write or generate the Instagram caption first.')
    if (igTags > 30) return setError('Instagram allows at most 30 hashtags.')
    let scheduledAt: string | null = null
    if (when === 'later') {
      const date = new Date(at)
      if (Number.isNaN(date.getTime()) || date.getTime() < Date.now() + 5 * 60_000) return setError('Pick a time at least 5 minutes from now.')
      scheduledAt = date.toISOString()
    }
    setBusy('post')
    try {
      if (dirty) await save(true)
      const res = await schedulePost({ videoId: video.id, accountId, caption: draft.instagram.trim(), scheduledAt })
      if (res.status === 'Failed') throw new Error(res.error ?? 'Instagram rejected the post.')
      toast.success(scheduledAt ? `Scheduled for ${formatDateTime(new Date(scheduledAt))}.` : 'Sent to Instagram. It goes live in 1–3 minutes.')
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-5">
      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="Caption per platform">
            {CHANNELS.map((c) => (
              <button
                key={c.id}
                type="button"
                role="tab"
                aria-selected={channel === c.id}
                onClick={() => setChannel(c.id)}
                className={cn('rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition', channel === c.id ? 'bg-brand-800 text-white ring-brand-800' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50')}
              >
                {c.label}
              </button>
            ))}
          </div>
          <Button size="sm" variant="secondary" icon={<Sparkles className="size-3.5" />} loading={busy === 'ai'} disabled={!!busy} onClick={rewrite}>
            {captions.instagram ? 'Rewrite with AI' : 'Write with AI'}
          </Button>
        </div>
        {channel === 'instagram' && (
          <>
            <TextArea label="Instagram caption" rows={9} maxLength={2200} value={draft.instagram} onChange={(e) => set({ instagram: e.target.value })} hint={`${draft.instagram.length}/2200 characters · ${igTags}/30 hashtags`} error={igTags > 30 ? 'Instagram allows at most 30 hashtags.' : undefined} />
            <div className="mt-2 flex justify-end">
              <CopyButton text={draft.instagram} />
            </div>
          </>
        )}
        {channel === 'tiktok' && (
          <>
            <TextArea label="TikTok caption" rows={5} maxLength={2200} value={draft.tiktok} onChange={(e) => set({ tiktok: e.target.value })} hint={`${draft.tiktok.length} characters · upload in the TikTok app and add trending music`} />
            <div className="mt-2 flex justify-end">
              <CopyButton text={draft.tiktok} />
            </div>
          </>
        )}
        {channel === 'facebook' && (
          <>
            <TextArea label="Facebook caption" rows={6} maxLength={2200} value={draft.facebook} onChange={(e) => set({ facebook: e.target.value })} hint={`${draft.facebook.length} characters`} />
            <div className="mt-2 flex justify-end">
              <CopyButton text={draft.facebook} />
            </div>
          </>
        )}
        {channel === 'youtube' && (
          <div className="space-y-3">
            <TextInput label="YouTube Shorts title" maxLength={100} value={draft.youtubeTitle} onChange={(e) => set({ youtubeTitle: e.target.value })} hint={`${draft.youtubeTitle.length}/100`} />
            <TextArea label="Description" rows={4} maxLength={5000} value={draft.youtubeDescription} onChange={(e) => set({ youtubeDescription: e.target.value })} />
            <div className="flex justify-end gap-2">
              <CopyButton text={draft.youtubeTitle} />
              <CopyButton text={draft.youtubeDescription} />
            </div>
          </div>
        )}
        {dirty && (
          <div className="mt-2 flex justify-end">
            <Button size="sm" variant="outline" loading={busy === 'save'} onClick={() => save().catch((err) => setError(errorMessage(err)))}>
              Save captions
            </Button>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 p-4">
        <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Send className="size-4 text-brand-800" aria-hidden /> Post to Instagram Reels
        </p>
        {!instagramReady ? (
          <Alert kind="info">
            Instagram posting is not set up yet. A super admin can connect accounts in{' '}
            <Link to="/settings?tab=social" className="font-medium underline" onClick={onClose}>
              Settings → Social accounts
            </Link>
            .
          </Alert>
        ) : !eligible.length ? (
          <Alert kind="info">
            No connected Instagram account for this store.{' '}
            <Link to="/settings?tab=social" className="font-medium underline" onClick={onClose}>
              Connect or link an account
            </Link>
            .
          </Alert>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectInput label="Account" value={accountId} onChange={(e) => setAccountId(e.target.value)} options={eligible.map((a) => ({ value: a.id, label: `@${a.username}${a.storeId === 'ALL' ? ' (brand)' : ''}` }))} />
            <div className="space-y-2">
              <Segmented label="When" value={when} onChange={setWhen} options={[{ value: 'now', label: 'Now' }, { value: 'later', label: 'Schedule' }]} />
              {when === 'later' && <TextInput label="Date & time" type="datetime-local" value={at} min={minAt} onChange={(e) => setAt(e.target.value)} hint="Your device time zone (WIB in Indonesia West)." />}
            </div>
          </div>
        )}
        {error && (
          <div className="mt-3">
            <Alert>{error}</Alert>
          </div>
        )}
        {instagramReady && !!eligible.length && (
          <div className="mt-4 flex justify-end">
            <Button icon={when === 'now' ? <Send className="size-4" /> : <CalendarClock className="size-4" />} loading={busy === 'post'} disabled={!!busy} onClick={post}>
              {when === 'now' ? 'Post now' : 'Schedule post'}
            </Button>
          </div>
        )}
      </section>

      <PostHistory posts={posts} />

      <p className="text-xs text-slate-500">
        Posted somewhere else by hand?{' '}
        <button type="button" className="font-medium text-brand-800 hover:underline" onClick={onManual}>
          Record it as published
        </button>{' '}
        to track its performance.
      </p>
    </div>
  )
}

export function PostModal({
  video,
  accounts,
  posts,
  instagramReady,
  onClose,
  onManual,
}: {
  video: GeneratedVideo | null
  accounts: SocialAccount[]
  posts: SocialPost[]
  instagramReady: boolean
  onClose: () => void
  onManual: (video: GeneratedVideo) => void
}) {
  const captions = { ...EMPTY, ...(video?.socialCaptions ?? {}) }
  return (
    <Modal open={!!video} onClose={onClose} size="xl" title="Post & captions" description={video?.title}>
      {video && (
        <PostForm
          // Reload the form when new AI captions arrive.
          key={`${video.id}-${video.socialCaptions?.generatedAt?.toMillis?.() ?? 'none'}`}
          video={video}
          accounts={accounts}
          posts={posts}
          instagramReady={instagramReady}
          captions={captions}
          onClose={onClose}
          onManual={() => onManual(video)}
        />
      )}
    </Modal>
  )
}

export function PostStatusLine({ post }: { post: SocialPost | undefined }) {
  if (!post || post.status === 'Cancelled') return null
  const text =
    post.status === 'Published'
      ? `Posted on Instagram · @${post.accountName}`
      : post.status === 'Publishing'
        ? `Posting to Instagram… · @${post.accountName}`
        : post.status === 'Scheduled'
          ? `Scheduled ${formatDateTime(post.scheduledAt)} · @${post.accountName}`
          : `Instagram post failed · @${post.accountName}`
  const Icon = post.status === 'Published' ? CheckCircle2 : post.status === 'Failed' ? XCircle : post.status === 'Publishing' ? Loader2 : CalendarClock
  return (
    <p className={cn('mt-1 flex items-center gap-1.5 text-xs', post.status === 'Failed' ? 'text-rose-600' : post.status === 'Published' ? 'text-emerald-700' : 'text-brand-800')}>
      <Icon className={cn('size-3.5 shrink-0', post.status === 'Publishing' && 'animate-spin')} aria-hidden />
      {post.permalink ? (
        <a href={post.permalink} target="_blank" rel="noopener noreferrer" className="truncate hover:underline">
          {text}
        </a>
      ) : (
        <span className="truncate">{text}</span>
      )}
    </p>
  )
}
