import { AlertTriangle, BarChart3, Clapperboard, Download, Film, Loader2, Pencil, Play, RefreshCw, RotateCcw, Send, Trash2, Undo2, Wand2 } from 'lucide-react'
import type { GeneratedVideo, SocialPost } from '../../types'
import { VIDEO_STATUS_STYLES, videoProviderLabel } from '../../utils/constants'
import { timeAgo } from '../../utils/format'
import { Badge, Button } from '../ui'
import { PostStatusLine } from './PostModal'

export type VideoCardAction = 'start' | 'refresh' | 'retry' | 'brand' | 'post' | 'publish' | 'unpublish' | 'rename' | 'delete' | 'performance'

export function VideoCard({ video, canEdit, busy, onAction, storeLabel, post }: { video: GeneratedVideo; canEdit: boolean; busy: VideoCardAction | null; onAction: (a: VideoCardAction) => void; storeLabel: string; post?: SocialPost }) {
  const ready = (video.status === 'Completed' || video.status === 'Published') && !!video.videoUrl
  const pct = video.progress?.total ? Math.round((video.progress.done / video.progress.total) * 100) : 0
  return (
    <article className="card flex flex-col overflow-hidden">
      <div className="relative flex aspect-[9/16] max-h-[420px] items-center justify-center bg-slate-900">
        {ready ? (
          <video src={video.videoUrl ?? undefined} poster={video.thumbnail ?? undefined} controls playsInline preload="metadata" className="size-full object-contain" aria-label={`Video: ${video.title}`} />
        ) : video.status === 'Processing' ? (
          <div className="flex flex-col items-center gap-3 px-6 text-center text-white">
            <Loader2 className="size-8 animate-spin text-brand-300" aria-hidden />
            <p className="text-sm font-medium">Generating with {videoProviderLabel(video.provider)}…</p>
            {video.progress?.total ? (
              <div className="w-40">
                <div className="h-1.5 overflow-hidden rounded-full bg-white/15" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full rounded-full bg-brand-400 transition-all" style={{ width: `${Math.max(5, pct)}%` }} />
                </div>
                <p className="mt-1 text-xs text-slate-300 tabular-nums">
                  {video.progress.done}/{video.progress.total} clips ready
                </p>
              </div>
            ) : (
              <p className="text-xs text-slate-300">Submitting jobs…</p>
            )}
          </div>
        ) : video.status === 'Failed' ? (
          <div className="flex flex-col items-center gap-2 px-6 text-center text-white">
            <AlertTriangle className="size-8 text-rose-400" aria-hidden />
            <p className="text-sm font-medium">Generation failed</p>
            <p className="line-clamp-4 text-xs text-slate-300">{video.error}</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-center text-slate-400">
            <Clapperboard className="size-8" aria-hidden />
            <p className="text-sm">{video.status === 'Draft' ? 'Draft — not generated yet' : 'No video file'}</p>
          </div>
        )}
        <Badge className={`absolute top-3 left-3 ${VIDEO_STATUS_STYLES[video.status]}`}>{video.status}</Badge>
        {video.demo && <Badge className="absolute top-3 right-3 bg-amber-50 text-amber-800 ring-amber-200">Demo</Badge>}
      </div>
      <div className="flex flex-1 flex-col p-4">
        <h3 className="line-clamp-2 text-sm font-semibold text-slate-900">{video.title}</h3>
        <p className="mt-1 text-xs text-slate-500">
          {video.templateLabel} · {video.duration}s {video.ratio} · {video.style}
        </p>
        <p className="mt-0.5 text-xs text-slate-400">
          {videoProviderLabel(video.provider)} · {storeLabel} · {timeAgo(video.createdAt)}
          {video.status === 'Published' && video.platform && <> · on {video.platform}</>}
        </p>
        <PostStatusLine post={post} />
        {canEdit && (
          <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-3">
            {video.status === 'Draft' && (
              <Button size="sm" icon={<Play className="size-4" />} loading={busy === 'start'} onClick={() => onAction('start')}>
                Generate
              </Button>
            )}
            {video.status === 'Processing' && (
              <Button size="sm" variant="outline" icon={<RefreshCw className="size-4" />} loading={busy === 'refresh'} onClick={() => onAction('refresh')}>
                Check status
              </Button>
            )}
            {video.status === 'Failed' && (
              <Button size="sm" icon={<RotateCcw className="size-4" />} loading={busy === 'retry'} onClick={() => onAction('retry')}>
                Retry
              </Button>
            )}
            {ready && !video.brandTemplateApplied && (
              <Button size="sm" variant="secondary" icon={<Wand2 className="size-4" />} loading={busy === 'brand'} onClick={() => onAction('brand')}>
                Apply template
              </Button>
            )}
            {video.status === 'Completed' && (
              <Button size="sm" icon={<Send className="size-4" />} onClick={() => onAction('post')}>
                Post
              </Button>
            )}
            {video.status === 'Published' && (
              <>
                <Button size="sm" variant="secondary" icon={<BarChart3 className="size-4" />} onClick={() => onAction('performance')}>
                  Performance
                </Button>
                <Button size="sm" variant="ghost" aria-label="Unpublish" icon={<Undo2 className="size-4" />} loading={busy === 'unpublish'} onClick={() => onAction('unpublish')} />
              </>
            )}
            <span className="ml-auto flex items-center gap-0.5">
              {ready && (
                <a href={video.videoUrl ?? '#'} download target="_blank" rel="noopener noreferrer" className="rounded-lg p-2 text-slate-600 hover:bg-slate-100" aria-label="Download video" title="Download video">
                  <Download className="size-4" />
                </a>
              )}
              {ready && video.cleanVideoUrl && (
                <a href={video.cleanVideoUrl} download target="_blank" rel="noopener noreferrer" className="rounded-lg p-2 text-slate-600 hover:bg-slate-100" aria-label="Download without template" title="Download without template (for editing)">
                  <Film className="size-4" />
                </a>
              )}
              {video.status === 'Published' && (
                <Button size="sm" variant="ghost" aria-label="Post & captions" title="Post again / captions" icon={<Send className="size-4" />} onClick={() => onAction('post')} />
              )}
              {ready && video.brandTemplateApplied && (
                <Button size="sm" variant="ghost" aria-label="Re-apply template" title="Re-apply template (uses the latest Brand template settings)" icon={<Wand2 className="size-4" />} loading={busy === 'brand'} onClick={() => onAction('brand')} />
              )}
              <Button size="sm" variant="ghost" aria-label="Rename" icon={<Pencil className="size-4" />} onClick={() => onAction('rename')} />
              {video.status !== 'Processing' && <Button size="sm" variant="ghost" aria-label="Delete video" icon={<Trash2 className="size-4" />} onClick={() => onAction('delete')} />}
            </span>
          </div>
        )}
        {!canEdit && ready && (
          <span className="mt-3 flex flex-wrap gap-4">
            <a href={video.videoUrl ?? '#'} download target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
              <Download className="size-3.5" /> Download
            </a>
            {video.cleanVideoUrl && (
              <a href={video.cleanVideoUrl} download target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
                <Film className="size-3.5" /> Without template
              </a>
            )}
          </span>
        )}
      </div>
    </article>
  )
}
