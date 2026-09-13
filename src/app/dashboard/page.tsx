'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { useAuth } from '@/components/AuthProvider';
import { CategoryBars, TrendLine } from '@/components/Charts';
import { GradeBadge } from '@/components/ScoreBadge';
import { Alert, Card, EmptyState, LinkButton, PageHeader, Select, Spinner } from '@/components/ui';
import { useAudits, useStores } from '@/lib/hooks';
import { CATEGORY_ORDER } from '@/lib/indicators';
import { GRADE_RULES, gradeFor, round1 } from '@/lib/scoring';
import { daysAgoISO, fmtDate, scoreColor } from '@/lib/utils';

const RANGES = [
  { value: 7, label: '7 hari' },
  { value: 30, label: '30 hari' },
  { value: 90, label: '90 hari' },
  { value: 365, label: '1 tahun' },
];
const TARGET = 90;

export default function DashboardPage() {
  const { profile } = useAuth();
  const { stores } = useStores(true);
  const [storeFilter, setStoreFilter] = useState<string>('all');
  const [days, setDays] = useState(30);
  const { audits, loading, error } = useAudits(profile, storeFilter);

  const data = useMemo(() => {
    const since = daysAgoISO(days);
    const submitted = audits.filter((a) => a.status === 'submitted' && a.date >= since && a.summary.pct !== null);
    const drafts = audits.filter((a) => a.status === 'draft');
    const avgPct = submitted.length ? round1(submitted.reduce((s, a) => s + (a.summary.pct ?? 0), 0) / submitted.length) : null;
    const critical = submitted.reduce((s, a) => s + a.summary.criticalCount, 0);
    const belowTarget = submitted.filter((a) => (a.summary.pct ?? 0) < TARGET).length;

    const cat = CATEGORY_ORDER.map((c) => {
      let sum = 0;
      let max = 0;
      let scored = 0;
      for (const a of submitted) {
        const cs = a.summary.categories.find((x) => x.code === c.code);
        if (cs) {
          sum += cs.sum;
          max += cs.max;
          scored += cs.scored;
        }
      }
      return { label: c.label, pct: max ? round1((sum / max) * 100) : null, scored };
    }).filter((c) => c.scored > 0);

    const trend = [...submitted]
      .sort((a, b) => (a.date + a.createdAt < b.date + b.createdAt ? -1 : 1))
      .slice(-20)
      .map((a) => ({ label: fmtDate(a.date).slice(0, 5), value: a.summary.pct ?? 0, sub: `${a.storeName} · ${a.shift}` }));

    // Pareto area terburuk: rata-rata per area dari kategori tidak tersedia di summary; pakai count kritikal per audit sebagai proxi
    const byStore = new Map<string, { name: string; sum: number; n: number; crit: number }>();
    for (const a of submitted) {
      const s = byStore.get(a.storeId) ?? { name: a.storeName, sum: 0, n: 0, crit: 0 };
      s.sum += a.summary.pct ?? 0;
      s.n += 1;
      s.crit += a.summary.criticalCount;
      byStore.set(a.storeId, s);
    }
    const storeRank = [...byStore.values()].map((s) => ({ ...s, avg: round1(s.sum / s.n) })).sort((a, b) => a.avg - b.avg);

    return { submitted, drafts, avgPct, critical, belowTarget, cat, trend, storeRank };
  }, [audits, days]);

  const grade = gradeFor(data.avgPct);
  const gradeColor = GRADE_RULES.find((g) => g.grade === grade)?.color;

  return (
    <AppShell>
      <PageHeader
        title="Dashboard Kebersihan"
        subtitle={profile?.role === 'admin' ? 'Semua store' : profile?.storeName ?? 'Store belum dipilih'}
        actions={<LinkButton href="/audits/new" size="sm">+ Audit Baru</LinkButton>}
      />
      <div className="mb-4 grid grid-cols-2 gap-2 sm:max-w-md">
        {profile?.role === 'admin' && (
          <Select value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)}>
            <option value="all">Semua store</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} · {s.name}
              </option>
            ))}
          </Select>
        )}
        <Select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {RANGES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label} terakhir
            </option>
          ))}
        </Select>
      </div>

      {error && <Alert className="mb-3">{error}</Alert>}
      {loading ? (
        <div className="flex justify-center p-10 text-brand">
          <Spinner className="h-8 w-8" />
        </div>
      ) : audits.length === 0 ? (
        <EmptyState title="Belum ada audit" desc="Data dashboard muncul setelah audit pertama disubmit." action={<LinkButton href="/audits/new">Mulai Audit</LinkButton>} />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label="Skor rata-rata" value={data.avgPct === null ? '-' : `${data.avgPct.toLocaleString('id-ID')}%`} color={gradeColor} sub={`Target ${TARGET}% · Grade ${grade ?? '-'}`} />
            <Tile label="Audit submitted" value={String(data.submitted.length)} sub={`${data.drafts.length} draft berjalan`} />
            <Tile label="Temuan kritikal" value={String(data.critical)} color={data.critical ? '#e34948' : '#008300'} sub="skor ≤ 2, wajib tindak lanjut" />
            <Tile label="Audit di bawah target" value={String(data.belowTarget)} color={data.belowTarget ? '#eda100' : '#008300'} sub={`dari ${data.submitted.length} audit`} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <h2 className="mb-3 text-sm font-bold text-ink">Tren skor per audit</h2>
              <TrendLine points={data.trend} target={TARGET} />
            </Card>
            <Card>
              <h2 className="mb-3 text-sm font-bold text-ink">Skor per kategori area</h2>
              {data.cat.length ? <CategoryBars data={data.cat} target={TARGET} /> : <p className="text-sm text-muted">Belum ada audit submitted di periode ini.</p>}
            </Card>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {profile?.role === 'admin' && data.storeRank.length > 1 && (
              <Card>
                <h2 className="mb-3 text-sm font-bold text-ink">Ranking store (terendah di atas)</h2>
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-muted">
                    <tr>
                      <th className="py-1">Store</th>
                      <th className="py-1 text-right">Audit</th>
                      <th className="py-1 text-right">Rata-rata</th>
                      <th className="py-1 text-right">Kritikal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.storeRank.map((s) => (
                      <tr key={s.name} className="border-t border-line">
                        <td className="py-1.5 font-semibold">{s.name}</td>
                        <td className="py-1.5 text-right">{s.n}</td>
                        <td className="py-1.5 text-right font-bold" style={{ color: scoreColor((s.avg / 100) * 5) }}>
                          {s.avg.toLocaleString('id-ID')}%
                        </td>
                        <td className="py-1.5 text-right">{s.crit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
            <Card>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-bold text-ink">Audit terbaru</h2>
                <Link href="/audits" className="text-xs font-semibold text-brand underline">
                  Lihat semua
                </Link>
              </div>
              <div className="space-y-2">
                {audits.slice(0, 6).map((a) => (
                  <Link key={a.id} href={`/audits/${a.id}`} className="flex items-center gap-3 rounded-lg border border-line p-2 hover:border-brand">
                    <GradeBadge grade={a.summary.grade} pct={a.summary.pct} />
                    <div className="min-w-0 flex-1 text-xs">
                      <div className="truncate font-semibold text-ink">{a.storeName}</div>
                      <div className="text-muted">
                        {fmtDate(a.date)} · {a.shift} · {a.status === 'submitted' ? 'Submitted' : 'Draft'}
                        {a.summary.criticalCount > 0 && <span className="text-danger"> · {a.summary.criticalCount} kritikal</span>}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </Card>
          </div>
        </>
      )}
    </AppShell>
  );
}

function Tile({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <Card className="p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-2xl font-black text-ink" style={{ color }}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[11px] text-muted">{sub}</div>}
    </Card>
  );
}
