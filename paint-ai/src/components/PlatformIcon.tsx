import { cn } from '../utils/cn'

const STYLES: Record<string, string> = {
  TikTok: 'bg-slate-900 text-white',
  Instagram: 'bg-gradient-to-br from-fuchsia-600 to-orange-500 text-white',
  YouTube: 'bg-red-600 text-white',
}

/** Compact platform marker (letter + label for screen readers). */
export function PlatformIcon({ platform, className }: { platform: string; className?: string }) {
  return (
    <span className={cn('inline-flex size-7 shrink-0 items-center justify-center rounded-md text-[11px] font-bold', STYLES[platform] ?? 'bg-slate-200 text-slate-700', className)} title={platform}>
      <span aria-hidden>{platform === 'YouTube' ? 'YT' : platform === 'Instagram' ? 'IG' : platform === 'TikTok' ? 'TT' : '?'}</span>
      <span className="sr-only">{platform}</span>
    </span>
  )
}
