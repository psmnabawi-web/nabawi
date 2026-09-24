import { ChevronDown, ChevronUp, ExternalLink, Sparkles, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { TrendAnalysis } from '../../types'
import { GROWTH_STYLES, categoryLabel, providerLabel } from '../../utils/constants'
import { timeAgo } from '../../utils/format'
import { PlatformIcon } from '../PlatformIcon'
import { Badge, Button, ScoreRing } from '../ui'

function Detail({ label, children }: { label: string; children: string }) {
  if (!children) return null
  return (
    <div>
      <dt className="text-xs font-semibold text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-800">{children}</dd>
    </div>
  )
}

export function TrendCard({ trend, canEdit, onGenerate, onDelete }: { trend: TrendAnalysis; canEdit: boolean; onGenerate: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <article className="card flex flex-col">
      <div className="flex items-start gap-4 p-5">
        <ScoreRing score={trend.trendScore} size={60} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={GROWTH_STYLES[trend.growthLevel]}>{trend.growthLevel}</Badge>
            <Badge>{categoryLabel(trend.category)}</Badge>
            {trend.demo && <Badge className="bg-amber-50 text-amber-800 ring-amber-200">Demo</Badge>}
          </div>
          <h3 className="mt-1.5 text-base leading-snug font-semibold text-slate-900">{trend.trendName}</h3>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
            <PlatformIcon platform={trend.platform} className="size-5 text-[9px]" />
            {trend.keyword || trend.sourceUrl}
            <span aria-hidden>·</span> {timeAgo(trend.createdAt)}
          </p>
        </div>
      </div>
      <div className="mx-5 rounded-lg bg-brand-50 px-3 py-2.5">
        <p className="text-xs font-semibold text-brand-800">Recommendation</p>
        <p className="mt-0.5 text-sm font-medium text-brand-950">{trend.recommendation}</p>
      </div>

      {open && (
        <dl className="mt-4 grid gap-3 border-t border-slate-100 px-5 pt-4">
          <Detail label="Viral pattern">{trend.viralPattern}</Detail>
          <Detail label="Content pattern">{trend.contentPattern}</Detail>
          <Detail label="Hook analysis">{trend.hookAnalysis}</Detail>
          <Detail label="Audience emotion">{trend.audienceEmotion}</Detail>
          <Detail label="Visual strategy">{trend.visualStyle}</Detail>
          <Detail label="Marketing opportunity">{trend.marketingOpportunity}</Detail>
          {trend.suggestedFormats?.length > 0 && <Detail label="Suggested formats">{trend.suggestedFormats.join(' · ')}</Detail>}
          {trend.keywords?.length > 0 && <Detail label="Keywords">{trend.keywords.join(' ')}</Detail>}
          <Detail label={`Rationale · confidence ${trend.confidence}`}>{trend.rationale}</Detail>
          {trend.sourceMeta?.title && <Detail label="Fetched caption">{trend.sourceMeta.title}</Detail>}
          <p className="text-xs text-slate-400">
            {providerLabel(trend.provider)} · {trend.model}
          </p>
        </dl>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-2 px-5 pt-4 pb-5">
        <Button size="sm" variant="ghost" icon={open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? 'Less' : 'Full analysis'}
        </Button>
        {trend.sourceUrl && (
          <a href={trend.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-medium text-slate-600 hover:bg-slate-100">
            <ExternalLink className="size-3.5" /> Source
          </a>
        )}
        {canEdit && (
          <>
            <Button size="sm" className="ml-auto" icon={<Sparkles className="size-4" />} onClick={onGenerate}>
              Generate ideas
            </Button>
            <Button size="sm" variant="ghost" onClick={onDelete} aria-label="Delete analysis" icon={<Trash2 className="size-4 text-slate-500" />} />
          </>
        )}
      </div>
    </article>
  )
}
