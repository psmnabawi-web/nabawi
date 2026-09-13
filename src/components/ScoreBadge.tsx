'use client';

import { gradeMeta } from '@/lib/scoring';
import type { Grade } from '@/lib/types';
import { cn, scoreColor } from '@/lib/utils';

export function ScoreDot({ score, className }: { score: number | null; className?: string }) {
  return (
    <span
      className={cn('inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white', className)}
      style={{ backgroundColor: scoreColor(score) }}
      aria-label={score === null ? 'Belum dinilai' : `Skor ${score}`}
    >
      {score ?? '–'}
    </span>
  );
}

export function GradeBadge({ grade, pct, size = 'md' }: { grade: Grade | null; pct: number | null; size?: 'md' | 'lg' }) {
  const meta = gradeMeta(grade);
  const color = meta?.color ?? '#9a9994';
  return (
    <div className={cn('inline-flex items-center gap-2 rounded-lg border px-2.5 py-1', size === 'lg' && 'px-4 py-2')} style={{ borderColor: `${color}66`, backgroundColor: `${color}12` }}>
      <span className={cn('font-black', size === 'lg' ? 'text-3xl' : 'text-lg')} style={{ color }}>
        {grade ?? '–'}
      </span>
      <div className="leading-tight">
        <div className={cn('font-bold text-ink', size === 'lg' ? 'text-lg' : 'text-sm')}>{pct === null ? '-' : `${pct.toLocaleString('id-ID')}%`}</div>
        <div className="text-[11px] text-muted">{meta?.label ?? 'Belum ada skor'}</div>
      </div>
    </div>
  );
}

export function ProgressBar({ pct, color, height = 8 }: { pct: number | null; color?: string; height?: number }) {
  const v = Math.max(0, Math.min(100, pct ?? 0));
  return (
    <div className="w-full overflow-hidden rounded-full bg-surface-2" style={{ height }} role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full transition-all" style={{ width: `${v}%`, backgroundColor: color ?? scoreColor(pct === null ? null : (pct / 100) * 5) }} />
    </div>
  );
}
