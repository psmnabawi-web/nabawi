'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Card, Input } from './ui';
import type { Audit, Store } from '@/lib/types';
import { cn, fmtDate, scoreColor, todayISO } from '@/lib/utils';

interface Row {
  store: Store;
  state: 'none' | 'draft' | 'done';
  audit: Audit | null;
  progress: number | null;
}

/** Store mana yang belum scoring pada tanggal tertentu (default hari ini). */
export function DailyCompliance({ stores, audits }: { stores: Store[]; audits: Audit[] }) {
  const [date, setDate] = useState(todayISO());

  const rows = useMemo<Row[]>(() => {
    const byStore = new Map<string, Audit[]>();
    for (const a of audits) {
      if (a.date !== date) continue;
      const list = byStore.get(a.storeId) ?? [];
      list.push(a);
      byStore.set(a.storeId, list);
    }
    return stores
      .filter((s) => s.active)
      .map((store): Row => {
        const list = byStore.get(store.id) ?? [];
        const done = list.find((a) => a.status === 'submitted');
        const draft = list.find((a) => a.status === 'draft');
        if (done) return { store, state: 'done', audit: done, progress: 100 };
        if (draft) {
          const total = draft.summary.itemCount + draft.summary.skippedCount;
          const finished = draft.summary.lockedCount + draft.summary.skippedCount;
          return { store, state: 'draft', audit: draft, progress: total ? Math.round((finished / total) * 100) : 0 };
        }
        return { store, state: 'none', audit: null, progress: null };
      })
      .sort((a, b) => a.store.name.localeCompare(b.store.name));
  }, [stores, audits, date]);

  const none = rows.filter((r) => r.state === 'none');
  const draft = rows.filter((r) => r.state === 'draft');
  const done = rows.filter((r) => r.state === 'done');
  const short = (n: string) => n.replace(/^Almaz Fried Chicken\s*-\s*/i, '');

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-ink">Kepatuhan scoring harian</h2>
          <p className="text-[11px] text-muted">Store yang belum melakukan scoring pada tanggal terpilih.</p>
        </div>
        <Input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} className="w-auto" aria-label="Tanggal" />
      </div>

      <div className="mb-3 grid grid-cols-3 gap-2 text-center">
        <Tile label="Belum mulai" value={none.length} color="#e34948" />
        <Tile label="Sedang berjalan" value={draft.length} color="#eda100" />
        <Tile label="Selesai" value={done.length} color="#008300" />
      </div>

      <Group title={`Belum scoring ${date === todayISO() ? 'hari ini' : fmtDate(date)}`} color="#e34948" empty="Semua store sudah mulai scoring.">
        {none.map((r) => (
          <Chip key={r.store.id} color="#e34948">
            {short(r.store.name)}
          </Chip>
        ))}
      </Group>
      <Group title="Sedang berjalan (draft)" color="#eda100" empty="Tidak ada audit yang menggantung.">
        {draft.map((r) => (
          <Link key={r.store.id} href={`/audits/${r.audit!.id}`}>
            <Chip color="#eda100">
              {short(r.store.name)} · {r.progress}% · {r.audit!.shift}
            </Chip>
          </Link>
        ))}
      </Group>
      <Group title="Selesai (submitted)" color="#008300" empty="Belum ada yang selesai.">
        {done.map((r) => (
          <Link key={r.store.id} href={`/audits/${r.audit!.id}`}>
            <Chip color={scoreColor(((r.audit!.summary.pct ?? 0) / 100) * 5)}>
              {short(r.store.name)} · {r.audit!.summary.pct === null ? '-' : `${r.audit!.summary.pct}%`}
            </Chip>
          </Link>
        ))}
      </Group>
    </Card>
  );
}

function Tile({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-lg border border-line p-2">
      <div className="text-xl font-black" style={{ color }}>
        {value}
      </div>
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
    </div>
  );
}

function Group({ title, color, empty, children }: { title: string; color: string; empty: string; children: React.ReactNode[] }) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-ink">
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
        {title}
        <span className="text-muted">({children.length})</span>
      </div>
      {children.length === 0 ? <p className="text-xs text-muted">{empty}</p> : <div className="flex flex-wrap gap-1.5">{children}</div>}
    </div>
  );
}

function Chip({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold')} style={{ borderColor: `${color}66`, backgroundColor: `${color}14`, color }}>
      {children}
    </span>
  );
}
