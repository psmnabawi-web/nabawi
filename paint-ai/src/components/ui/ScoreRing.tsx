import { cn } from '../../utils/cn'

/** Circular 0-100 score indicator. Color is a secondary cue; the number is always shown. */
export function ScoreRing({ score, size = 56, className, light }: { score: number; size?: number; className?: string; light?: boolean }) {
  const value = Math.max(0, Math.min(100, Math.round(score)))
  const stroke = 5
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const color = light ? '#ffffff' : value >= 80 ? '#45398d' : value >= 60 ? '#7869d6' : '#94a3b8'
  return (
    <div className={cn('relative inline-flex shrink-0 items-center justify-center', className)} style={{ width: size, height: size }} role="img" aria-label={`Trend score ${value} out of 100`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={light ? 'rgba(255,255,255,0.2)' : '#e2e8f0'} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - value / 100)} />
      </svg>
      <span className={cn('absolute font-semibold tabular-nums', light ? 'text-white' : 'text-slate-900', size >= 72 ? 'text-xl' : 'text-sm')}>{value}</span>
    </div>
  )
}
