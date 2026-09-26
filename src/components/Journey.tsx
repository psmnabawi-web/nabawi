'use client';

import Link from 'next/link';
import { IconCheck } from './icons';
import { cn } from '@/lib/utils';

export interface JourneyStep {
  label: string;
  desc: string;
  done: boolean;
  cta?: { label: string; href: string };
}

/** Langkah proses dengan lingkaran & garis penghubung (gaya "Perjalanan brand"). */
export function Journey({ steps }: { steps: JourneyStep[] }) {
  return (
    <ol className="flex gap-2 overflow-x-auto pb-1">
      {steps.map((s, i) => {
        const next = steps[i + 1];
        return (
          <li key={s.label} className="flex min-w-[130px] flex-1 flex-col items-center text-center">
            <div className="flex w-full items-center">
              <div className={cn('h-0.5 flex-1', i === 0 ? 'bg-transparent' : s.done ? 'bg-good' : 'bg-line')} />
              <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2', s.done ? 'border-good bg-good text-white' : 'border-line bg-white text-muted')}>
                {s.done ? <IconCheck size={20} /> : <span className="h-2 w-2 rounded-full bg-muted" />}
              </span>
              <div className={cn('h-0.5 flex-1', !next ? 'bg-transparent' : next.done ? 'bg-good' : 'bg-line')} />
            </div>
            <div className="mt-2 text-sm font-bold text-ink">{s.label}</div>
            <div className="text-xs text-muted">{s.desc}</div>
            {s.cta && (
              <Link href={s.cta.href} className="mt-1 text-xs font-semibold text-brand hover:underline">
                {s.cta.label} →
              </Link>
            )}
          </li>
        );
      })}
    </ol>
  );
}
