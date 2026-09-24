import { FileText, Pencil, Star, Trash2, Wand2 } from 'lucide-react'
import type { ContentIdea } from '../../types'
import { cn } from '../../utils/cn'
import { timeAgo } from '../../utils/format'
import { Badge, Button } from '../ui'

const IMPACT = { High: 'bg-emerald-50 text-emerald-700 ring-emerald-200', Medium: 'bg-blue-50 text-blue-700 ring-blue-200', Low: 'bg-slate-100 text-slate-700 ring-slate-200' }

export function IdeaCard({
  idea,
  canEdit,
  onScript,
  onViewScript,
  onEdit,
  onDelete,
  onFavorite,
}: {
  idea: ContentIdea
  canEdit: boolean
  onScript: () => void
  onViewScript: () => void
  onEdit: () => void
  onDelete: () => void
  onFavorite: () => void
}) {
  return (
    <article className="card flex flex-col p-5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-xs font-semibold text-slate-400 tabular-nums">#{idea.rank}</span>
        <div className="min-w-0 flex-1">
          <h3 className="text-base leading-snug font-semibold text-slate-900">{idea.title}</h3>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Badge className={IMPACT[idea.impactLevel]}>{idea.impactLevel} impact</Badge>
            <Badge>{idea.format}</Badge>
            <Badge>{idea.platform}</Badge>
            {idea.status === 'scripted' && <Badge className="bg-brand-50 text-brand-800 ring-brand-200">Scripted</Badge>}
            {idea.demo && <Badge className="bg-amber-50 text-amber-800 ring-amber-200">Demo</Badge>}
          </div>
        </div>
        {canEdit && (
          <button type="button" onClick={onFavorite} className="rounded-md p-1 hover:bg-slate-100" aria-label={idea.favorite ? 'Remove from favorites' : 'Add to favorites'} aria-pressed={idea.favorite}>
            <Star className={cn('size-5', idea.favorite ? 'fill-amber-400 text-amber-500' : 'text-slate-300')} />
          </button>
        )}
      </div>

      <dl className="mt-4 space-y-3 text-sm">
        <div className="rounded-lg bg-slate-50 px-3 py-2">
          <dt className="text-xs font-semibold text-slate-500">Hook</dt>
          <dd className="mt-0.5 font-medium text-slate-900">“{idea.hook}”</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-slate-500">Storyline</dt>
          <dd className="mt-0.5 text-slate-700">{idea.storyline}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-slate-500">CTA</dt>
          <dd className="mt-0.5 text-slate-700">{idea.cta}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-slate-500">Expected impact</dt>
          <dd className="mt-0.5 text-slate-700">{idea.expectedImpact}</dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-slate-400">
        {idea.product} · {idea.targetAudience || idea.audience} · {idea.objective} · {timeAgo(idea.createdAt)}
      </p>

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
        {idea.lastScriptId && (
          <Button size="sm" variant="secondary" icon={<FileText className="size-4" />} onClick={onViewScript}>
            View script
          </Button>
        )}
        {canEdit && (
          <>
            <Button size="sm" icon={<Wand2 className="size-4" />} onClick={onScript}>
              {idea.lastScriptId ? 'New script' : 'Generate script'}
            </Button>
            <Button size="sm" variant="ghost" className="ml-auto" aria-label="Edit idea" icon={<Pencil className="size-4" />} onClick={onEdit} />
            <Button size="sm" variant="ghost" aria-label="Delete idea" icon={<Trash2 className="size-4" />} onClick={onDelete} />
          </>
        )}
      </div>
    </article>
  )
}
