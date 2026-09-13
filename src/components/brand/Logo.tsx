/* eslint-disable @next/next/no-img-element */
import { cn } from '@/lib/utils';

/** Mark Almaz (mahkota + ayam) dari /icons/logo-mark.svg. Ganti file sumber di branding/ lalu jalankan `npm run icons`. */
export function LogoMark({ size = 32, className, rounded = true }: { size?: number; className?: string; rounded?: boolean }) {
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center bg-black', rounded && 'rounded-lg', className)}
      style={{ width: size, height: size, padding: Math.round(size * 0.1) }}
      aria-hidden
    >
      <img src="/icons/logo-mark.svg" alt="" width={size} height={size} className="h-full w-full object-contain" />
    </span>
  );
}

/** Wordmark: ALMAZ Fried Chicken. */
export function LogoWordmark({ className, light = false }: { className?: string; light?: boolean }) {
  return (
    <span className={cn('leading-none', className)}>
      <span className={cn('block text-base font-black tracking-[0.18em]', light ? 'text-white' : 'text-brand')}>ALMAZ</span>
      <span className={cn('block text-[10px] font-semibold tracking-wide', light ? 'text-white/80' : 'text-muted')}>Fried Chicken</span>
    </span>
  );
}
