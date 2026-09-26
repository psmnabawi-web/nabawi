'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { RankBars, type RankBarDatum } from './Charts';
import { Card, Input } from './ui';
import type { Audit, Store } from '@/lib/types';
import { cn, fmtDate, scoreColor, todayISO } from '@/lib/utils';
import { round1 } from '@/lib/scoring';

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
          const total = (draft.summary.itemCount ?? 0) + (draft.summary.skippedCount ?? 0);
          const finished = (draft.summary.lockedCount ?? 0) + (draft.summary.skippedCount ?? 0);
          return { store, state: 'draft', audit: draft, progress: total ? Math.round((finished / total) * 100) : 0 };
        }
        return { store, state: 'none', audit: null, progress: null };
      })
      .sort((a, b) => a.store.name.localeCompare(b.store.name));
  }, [stores, audits, date]);

  // peringkat skor hari itu: audit submitted (final) dan draft (skor sementara, ditandai)
  const rank = useMemo<RankBarDatum[]>(() => {
    const agg = new Map<string, { name: string; sum: number; n: number; grade: string | null; drafts: number; locked: number; total: number }>();
    for (const a of audits) {
      if (a.date !== date || a.summary.pct === null) continue;
      const g = agg.get(a.storeId) ?? { name: a.storeName, sum: 0, n: 0, grade: null, drafts: 0, locked: 0, total: 0 };
      g.sum += a.summary.pct;
      g.n += 1;
      g.grade = a.summary.grade;
      if (a.status === 'draft') {
        g.drafts += 1;
        g.locked += a.summary.lockedCount ?? 0;
        g.total += a.summary.itemCount ?? 0;
      }
      agg.set(a.storeId, g);
    }
    return [...agg.entries()]
      .filter(([id]) => stores.some((s) => s.id === id))
      .map(([id, g]) => {
        const draft = g.drafts > 0;
        const parts: string[] = [];
        if (g.n > 1) parts.push(`${g.n} audit`);
        if (draft) parts.push(`draft ${g.locked}/${g.total} area`);
        return { id, label: g.name.replace(/^Almaz Fried Chicken\s*-\s*/i, ''), value: round1(g.sum / g.n), grade: g.grade, sub: parts.join(' · ') || undefined, draft };
      });
  }, [audits, date, stores]);
  const rankAvg = rank.length ? round1(rank.reduce((s, r) => s + r.value, 0) / rank.length) : null;

  const none = rows.filter((r) => r.state === 'none');
  const draft = rows.filter((r) => r.state === 'draft');
  const done = rows.filter((r) => r.state === 'done');
  const short = (n: string) => n.replace(/^Almaz Fried Chicken\s*-\s*/i, '');

  return (
    <div className="grid gap-5 lg:grid-cols-2">
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-ink">Kepatuhan scoring harian</h2>
          <p className="mt-0.5 text-sm text-muted">Store yang belum melakukan scoring pada tanggal terpilih.</p>
        </div>
        <Input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} className="!w-auto" aria-label="Tanggal" />
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

    <Card className="flex flex-col">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-ink">Peringkat store berdasarkan skor</h2>
          <p className="mt-0.5 text-sm text-muted">
            {fmtDate(date)} · {rank.length} dari {stores.filter((s) => s.active).length} store sudah scoring
          </p>
        </div>
        {rankAvg !== null && (
          <div className="shrink-0 rounded-2xl bg-surface px-3 py-2 text-right">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Rata-rata</div>
            <div className="text-xl font-black" style={{ color: scoreColor((rankAvg / 100) * 5) }}>{rankAvg.toLocaleString('id-ID')}%</div>
          </div>
        )}
      </div>
      <div className="flex-1">
        <RankBars data={rank} target={90} />
      </div>
    </Card>
    </div>
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
