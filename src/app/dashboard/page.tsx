'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { useAuth } from '@/components/AuthProvider';
import { CategoryBars, DateBars, StoreBars, TrendLine, type DateBarDatum, type StoreBarDatum } from '@/components/Charts';
import { DailyCompliance } from '@/components/DailyCompliance';
import { IconAlert, IconBook, IconCamera, IconChart, IconCheck, IconClipboard, IconPlus, IconSparkle, IconStore } from '@/components/icons';
import { Journey } from '@/components/Journey';
import { GradeBadge } from '@/components/ScoreBadge';
import { Alert, Card, CardHeader, EmptyState, LinkButton, Select, Spinner, StatCard } from '@/components/ui';
import { useAudits, useRecentLogs, useStores } from '@/lib/hooks';
import { CATEGORY_ORDER } from '@/lib/indicators';
import { GRADE_RULES, gradeFor, round1 } from '@/lib/scoring';
import { daysAgoISO, fmtDate, fmtDateTime, todayISO } from '@/lib/utils';

const RANGES = [
  { value: 7, label: '7 hari' },
  { value: 30, label: '30 hari' },
  { value: 90, label: '90 hari' },
  { value: 365, label: '1 tahun' },
];
const TARGET = 90;

const ACTION_LABEL: Record<string, string> = {
  CREATE_AUDIT: 'Membuat audit',
  ANALYZE_ITEM: 'Analisa foto area',
  LOCK_ITEM: 'Submit area',
  AUTO_SUBMIT_AUDIT: 'Audit selesai (otomatis)',
  SUBMIT_AUDIT: 'Submit audit',
  OVERRIDE_SCORE: 'Koreksi skor',
  SKIP_ITEM: 'Lewati area',
  UNLOCK_ITEM: 'Buka kunci area',
  RESET_ITEM: 'Hapus foto area',
  REOPEN_AUDIT: 'Buka kembali audit',
  DELETE_AUDIT: 'Hapus audit',
  CREATE_USER: 'Buat user',
  UPDATE_USER: 'Ubah user',
  CREATE_STORE: 'Tambah store',
  UPDATE_STORE: 'Ubah store',
};

function timeAgo(ms: number) {
  const d = Math.max(0, Date.now() - ms);
  const m = Math.floor(d / 60000);
  if (m < 1) return 'baru saja';
  if (m < 60) return `${m} menit lalu`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} jam lalu`;
  return `${Math.floor(h / 24)} hari lalu`;
}

function weekRange() {
  const now = new Date();
  const day = (now.getDay() + 6) % 7; // Senin = 0
  const start = new Date(now);
  start.setDate(now.getDate() - day);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  return { from: iso(start), to: iso(end) };
}

export default function DashboardPage() {
  const { profile } = useAuth();
  const { stores } = useStores(true);
  const isAdmin = profile?.role === 'admin';
  const [storeFilter, setStoreFilter] = useState<string>('all');
  const [days, setDays] = useState(30);
  const { audits, loading, error } = useAudits(profile, storeFilter);
  const logs = useRecentLogs(!!isAdmin, 6);

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

    const byStore = new Map<string, { name: string; sum: number; n: number; crit: number }>();
    for (const a of submitted) {
      const s = byStore.get(a.storeId) ?? { name: a.storeName, sum: 0, n: 0, crit: 0 };
      s.sum += a.summary.pct ?? 0;
      s.n += 1;
      s.crit += a.summary.criticalCount;
      byStore.set(a.storeId, s);
    }
    const storeBars: StoreBarDatum[] = stores
      .filter((st) => st.active)
      .map((st) => {
        const agg = byStore.get(st.id);
        return { id: st.id, label: st.name.replace(/^Almaz Fried Chicken\s*-\s*/i, ''), pct: agg ? round1(agg.sum / agg.n) : null, audits: agg?.n ?? 0, critical: agg?.crit ?? 0 };
      })
      .sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1) || a.label.localeCompare(b.label));

    const byDate = new Map<string, { sum: number; n: number; crit: number }>();
    for (const a of submitted) {
      const d = byDate.get(a.date) ?? { sum: 0, n: 0, crit: 0 };
      d.sum += a.summary.pct ?? 0;
      d.n += 1;
      d.crit += a.summary.criticalCount;
      byDate.set(a.date, d);
    }
    const dateKeys = days <= 31 ? Array.from({ length: days }, (_, i) => daysAgoISO(days - 1 - i)) : [...byDate.keys()].sort();
    const dateBars: DateBarDatum[] = dateKeys.map((date) => {
      const d = byDate.get(date);
      return { date, pct: d ? round1(d.sum / d.n) : null, audits: d?.n ?? 0, critical: d?.crit ?? 0 };
    });

    // hari ini
    const today = todayISO();
    const todayAudits = audits.filter((a) => a.date === today);
    const todayPhotos = todayAudits.reduce((s, a) => s + (a.summary.scoredCount ?? 0) + (a.summary.invalidCount ?? 0), 0);
    const todayLocked = todayAudits.reduce((s, a) => s + (a.summary.lockedCount ?? 0), 0);
    const todayDone = todayAudits.filter((a) => a.status === 'submitted').length;

    // minggu ini
    const wk = weekRange();
    const week = audits.filter((a) => a.date >= wk.from && a.date <= wk.to);
    const weekSubmitted = week.filter((a) => a.status === 'submitted' && a.summary.pct !== null);
    const weekAvg = weekSubmitted.length ? round1(weekSubmitted.reduce((s, a) => s + (a.summary.pct ?? 0), 0) / weekSubmitted.length) : null;
    const weekCritical = weekSubmitted.reduce((s, a) => s + a.summary.criticalCount, 0);
    const weekStoresDone = new Set(weekSubmitted.map((a) => a.storeId));
    const activeStores = stores.filter((s) => s.active && (storeFilter === 'all' || s.id === storeFilter));
    const weekMissing = activeStores.filter((s) => !weekStoresDone.has(s.id));
    const weekRetries = weekSubmitted.reduce((s, a) => s + (a.summary.retryCount ?? 0), 0);

    return { submitted, drafts, avgPct, critical, belowTarget, cat, trend, storeBars, dateBars, todayAudits, todayPhotos, todayLocked, todayDone, wk, week, weekSubmitted, weekAvg, weekCritical, weekMissing, weekRetries, activeStores };
  }, [audits, days, stores, storeFilter]);

  const grade = gradeFor(data.avgPct);
  const gradeColor = GRADE_RULES.find((g) => g.grade === grade)?.color ?? '#F26522';
  const firstName = (profile?.name ?? '').split(/\s+/)[0] || 'Tim';
  const scopeStore = storeFilter === 'all' ? null : stores.find((s) => s.id === storeFilter);
  const heroTitle = isAdmin ? (scopeStore?.name ?? 'Almaz Fried Chicken') : (profile?.storeName ?? 'Store belum dipilih');
  const heroSub = isAdmin
    ? scopeStore
      ? `${scopeStore.code} · ${scopeStore.city || '-'}`
      : `${data.activeStores.length} store aktif · pantau kebersihan seluruh cabang`
    : 'Jaga standar bersih setiap shift';

  const journey = [
    { label: 'Store', desc: isAdmin ? `${data.activeStores.length} store aktif` : (profile?.storeName ? 'Store terpilih' : 'Belum dipilih'), done: isAdmin ? data.activeStores.length > 0 : !!profile?.storeId, cta: !isAdmin && !profile?.storeId ? { label: 'Pilih store', href: '/profile' } : undefined },
    { label: 'Audit dibuat', desc: `${data.todayAudits.length} audit hari ini`, done: data.todayAudits.length > 0, cta: data.todayAudits.length === 0 ? { label: 'Mulai audit', href: '/audits/new' } : undefined },
    { label: 'Foto & AI', desc: `${data.todayPhotos} area dinilai`, done: data.todayPhotos > 0 },
    { label: 'Area di-submit', desc: `${data.todayLocked} area`, done: data.todayLocked > 0 },
    { label: 'Audit selesai', desc: `${data.todayDone} submitted`, done: data.todayDone > 0, cta: data.drafts.length > 0 ? { label: `${data.drafts.length} draft menunggu`, href: '/audits?status=draft' } : undefined },
  ];

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">Selamat datang kembali, {firstName}</h1>
          <p className="mt-1 text-muted">Pantau kondisi kebersihan store dan lanjutkan pekerjaan Anda.</p>
        </div>
        <LinkButton href="/audits/new" variant="secondary" size="md">
          <IconBook size={18} /> Cara audit
        </LinkButton>
      </div>

      {/* Hero */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4 rounded-3xl bg-gradient-to-r from-orange-50 via-[#fff3ec] to-orange-100/60 p-5 sm:p-7">
        <div className="flex min-w-0 items-center gap-4">
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand to-[#F9A57A] text-white shadow">
            <IconStore size={30} />
          </span>
          <div className="min-w-0">
            <div className="truncate text-2xl font-bold text-ink">{heroTitle}</div>
            <div className="text-sm text-muted">{heroSub}</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && (
            <Select value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)} className="!w-auto max-w-[260px]">
              <option value="all">Semua store</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} · {s.name.replace(/^Almaz Fried Chicken\s*-\s*/i, '')}
                </option>
              ))}
            </Select>
          )}
          <Select value={days} onChange={(e) => setDays(Number(e.target.value))} className="!w-auto">
            {RANGES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label} terakhir
              </option>
            ))}
          </Select>
          <LinkButton href="/audits/new" size="md" className="rounded-full">
            <IconPlus size={18} /> Audit Baru
          </LinkButton>
        </div>
      </div>

      {error && <Alert className="mb-3">{error}</Alert>}
      {loading ? (
        <div className="flex justify-center p-10 text-brand">
          <Spinner className="h-8 w-8" />
        </div>
      ) : (
        <>
          {/* KPI */}
          <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard icon={<IconChart size={24} />} value={data.avgPct === null ? '-' : `${data.avgPct.toLocaleString('id-ID')}%`} label="Skor rata-rata" sub={`Target ${TARGET}% · Grade ${grade ?? '-'} · ${days} hari terakhir`} tint={gradeColor} />
            <StatCard icon={<IconClipboard size={24} />} value={data.submitted.length} label="Audit selesai" sub={`${data.drafts.length} draft masih berjalan`} tint="#2a78d6" href="/audits" />
            <StatCard icon={<IconAlert size={24} />} value={data.critical} label="Temuan kritikal" sub="skor ≤ 2, wajib tindak lanjut" tint={data.critical ? '#e34948' : '#008300'} />
            <StatCard icon={<IconCheck size={24} />} value={data.belowTarget} label="Audit di bawah target" sub={`dari ${data.submitted.length} audit selesai`} tint={data.belowTarget ? '#eda100' : '#008300'} />
          </div>

          {/* Perjalanan audit hari ini */}
          <Card className="mb-5">
            <CardHeader title="Perjalanan audit hari ini" desc={`Langkah dari store hingga audit selesai · ${fmtDate(todayISO())}`} />
            <Journey steps={journey} />
          </Card>

          {audits.length === 0 ? (
            <EmptyState title="Belum ada audit" desc="Data dashboard muncul setelah audit pertama dibuat." action={<LinkButton href="/audits/new">Mulai Audit</LinkButton>} />
          ) : (
            <>
              {isAdmin && (
                <div className="mb-5">
                  <DailyCompliance stores={storeFilter === 'all' ? stores : stores.filter((s) => s.id === storeFilter)} audits={audits} />
                </div>
              )}

              <div className="mb-5 grid gap-5 lg:grid-cols-3">
                <Card className="flex flex-col lg:col-span-2">
                  <CardHeader title="Skor per tanggal" desc={`Rata-rata audit selesai per hari · ${days} hari terakhir`} right={<span className="rounded-full bg-brand/10 px-3 py-1 text-xs font-bold text-brand">{data.submitted.length} audit</span>} />
                  <div className="flex min-h-[300px] flex-1 flex-col">
                    <DateBars data={data.dateBars} target={TARGET} minHeight={280} />
                  </div>
                </Card>
                <Card>
                  <CardHeader title="Aktivitas terakhir" desc={isAdmin ? 'Aktivitas terbaru yang tercatat.' : 'Audit terbaru di store Anda.'} />
                  <div className="space-y-2">
                    {isAdmin
                      ? logs.slice(0, 5).map((l) => (
                          <div key={l.id} className="flex items-center gap-3 rounded-2xl bg-surface p-3">
                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
                              <IconSparkle size={18} />
                            </span>
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold text-ink">
                                {ACTION_LABEL[l.action] ?? l.action}
                                {typeof l.details?.area === 'string' ? ` · ${l.details.area}` : ''}
                              </div>
                              <div className="text-xs text-muted">
                                {l.name} · {timeAgo(l.at)}
                              </div>
                            </div>
                          </div>
                        ))
                      : audits.slice(0, 5).map((a) => (
                          <Link key={a.id} href={`/audits/${a.id}`} className="flex items-center gap-3 rounded-2xl bg-surface p-3 hover:bg-surface-2">
                            <GradeBadge grade={a.summary.grade} pct={a.summary.pct} />
                            <div className="min-w-0 text-xs">
                              <div className="truncate font-semibold text-ink">
                                {fmtDate(a.date)} · {a.shift}
                              </div>
                              <div className="text-muted">{a.status === 'submitted' ? `Selesai · ${fmtDateTime(a.submittedAt)}` : 'Draft berjalan'}</div>
                            </div>
                          </Link>
                        ))}
                    {(isAdmin ? logs.length : audits.length) === 0 && <p className="text-sm text-muted">Belum ada aktivitas.</p>}
                  </div>
                  <Link href={isAdmin ? '/admin/logs' : '/audits'} className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-ink hover:text-brand">
                    Lihat {isAdmin ? 'aktivitas' : 'semua audit'} →
                  </Link>
                </Card>
              </div>

              <div className="mb-5 grid gap-5 lg:grid-cols-2">
                <Card>
                  <CardHeader title="Skor per kategori area" desc="Rata-rata skor tiap kategori vs target." />
                  {data.cat.length ? <CategoryBars data={data.cat} target={TARGET} /> : <p className="text-sm text-muted">Belum ada audit selesai di periode ini.</p>}
                </Card>
                <Card>
                  <CardHeader title="Tren skor per audit" desc="Setiap titik satu audit selesai." />
                  <TrendLine points={data.trend} target={TARGET} />
                </Card>
              </div>

              {isAdmin && (
                <Card className="mb-5">
                  <CardHeader
                    title="Skor per store"
                    desc={`${days} hari terakhir · klik store untuk memfilter dashboard`}
                    right={<span className="text-xs text-muted">{data.storeBars.filter((s) => s.pct !== null).length}/{data.storeBars.length} store sudah audit</span>}
                  />
                  <StoreBars data={data.storeBars} target={TARGET} onSelect={(id) => setStoreFilter(storeFilter === id ? 'all' : id)} />
                  {storeFilter !== 'all' && (
                    <button type="button" className="mt-2 text-xs font-semibold text-brand underline" onClick={() => setStoreFilter('all')}>
                      Tampilkan semua store
                    </button>
                  )}
                </Card>
              )}

              {/* Ringkasan minggu ini */}
              <Card>
                <CardHeader title="Ringkasan minggu ini" desc="Progress dan langkah berikutnya." right={<span className="text-sm text-muted">{fmtDate(data.wk.from)} - {fmtDate(data.wk.to)}</span>} />
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="rounded-2xl bg-surface p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted">Audit selesai</div>
                    <div className="mt-1 text-3xl font-black text-ink">{data.weekSubmitted.length}</div>
                    <div className="text-xs text-muted">dari {data.week.length} audit dibuat · {data.weekRetries}x foto ulang</div>
                  </div>
                  <div className="rounded-2xl bg-surface p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted">Skor rata-rata</div>
                    <div className="mt-1 text-3xl font-black" style={{ color: GRADE_RULES.find((g) => g.grade === gradeFor(data.weekAvg))?.color ?? '#0b0b0b' }}>
                      {data.weekAvg === null ? '-' : `${data.weekAvg.toLocaleString('id-ID')}%`}
                    </div>
                    <div className="text-xs text-muted">{data.weekCritical} temuan kritikal</div>
                  </div>
                  <div className="rounded-2xl bg-surface p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted">Langkah berikutnya</div>
                    <ul className="mt-2 space-y-1.5 text-sm text-ink">
                      {data.drafts.length > 0 && (
                        <li className="flex items-start gap-2">
                          <IconCamera size={16} className="mt-0.5 shrink-0 text-brand" />
                          <Link href="/audits?status=draft" className="hover:underline">
                            Selesaikan {data.drafts.length} audit draft
                          </Link>
                        </li>
                      )}
                      {isAdmin && data.weekMissing.length > 0 && (
                        <li className="flex items-start gap-2">
                          <IconStore size={16} className="mt-0.5 shrink-0 text-warn" />
                          <span>
                            {data.weekMissing.length} store belum audit minggu ini: {data.weekMissing.slice(0, 4).map((s) => s.name.replace(/^Almaz Fried Chicken\s*-\s*/i, '')).join(', ')}
                            {data.weekMissing.length > 4 ? `, +${data.weekMissing.length - 4} lagi` : ''}
                          </span>
                        </li>
                      )}
                      {data.weekCritical > 0 && (
                        <li className="flex items-start gap-2">
                          <IconAlert size={16} className="mt-0.5 shrink-0 text-danger" />
                          <span>Tindak lanjuti {data.weekCritical} temuan kritikal (skor ≤ 2)</span>
                        </li>
                      )}
                      {data.drafts.length === 0 && data.weekCritical === 0 && (!isAdmin || data.weekMissing.length === 0) && (
                        <li className="flex items-start gap-2">
                          <IconCheck size={16} className="mt-0.5 shrink-0 text-good" />
                          <span>Semua beres. Pertahankan standar bersih.</span>
                        </li>
                      )}
                    </ul>
                  </div>
                </div>
              </Card>
            </>
          )}
        </>
      )}
    </AppShell>
  );
}
