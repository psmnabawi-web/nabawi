'use client';

import Link from 'next/link';
import { Suspense, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { useAuth } from '@/components/AuthProvider';
import { GradeBadge } from '@/components/ScoreBadge';
import { Alert, Badge, Button, EmptyState, Input, LinkButton, PageHeader, Select, Spinner } from '@/components/ui';
import { exportRecapExcel } from '@/lib/export-excel';
import { useAudits, useStores } from '@/lib/hooks';
import { SHIFTS } from '@/lib/types';
import { fmtDate } from '@/lib/utils';

function AuditsInner() {
  const params = useSearchParams();
  const { profile } = useAuth();
  const { stores } = useStores(true);
  const [storeFilter, setStoreFilter] = useState<string>('all');
  const initial = params.get('status');
  const [status, setStatus] = useState<'all' | 'draft' | 'submitted'>(initial === 'draft' || initial === 'submitted' ? initial : 'all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const { audits, loading, error } = useAudits(profile, storeFilter);
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(
    () =>
      audits.filter((a) => {
        if (status !== 'all' && a.status !== status) return false;
        if (from && a.date < from) return false;
        if (to && a.date > to) return false;
        return true;
      }),
    [audits, status, from, to],
  );

  return (
    <AppShell>
      <PageHeader
        title="Daftar Audit"
        subtitle={profile?.role === 'admin' ? 'Semua store' : profile?.storeName ?? '-'}
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              loading={busy}
              disabled={filtered.length === 0}
              onClick={async () => {
                setBusy(true);
                try {
                  await exportRecapExcel(filtered);
                } finally {
                  setBusy(false);
                }
              }}
            >
              ⬇ Rekap Excel
            </Button>
            <LinkButton href="/audits/new" size="sm">
              + Audit Baru
            </LinkButton>
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
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
        <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="all">Semua status</option>
          <option value="draft">Draft</option>
          <option value="submitted">Submitted</option>
        </Select>
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Dari tanggal" />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Sampai tanggal" />
      </div>

      {error && <Alert className="mb-3">{error}</Alert>}
      {loading ? (
        <div className="flex justify-center p-10 text-brand">
          <Spinner className="h-8 w-8" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState title="Belum ada audit" desc="Mulai audit pertama dengan mengambil foto area store." action={<LinkButton href="/audits/new">Mulai Audit</LinkButton>} />
      ) : (
        <div className="space-y-2">
          {filtered.map((a) => (
            <Link key={a.id} href={`/audits/${a.id}`} className="flex items-center gap-3 rounded-xl border border-line bg-white p-3 shadow-sm hover:border-brand">
              <GradeBadge grade={a.summary.grade} pct={a.summary.pct} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-ink">{a.storeName}</div>
                <div className="text-xs text-muted">
                  {fmtDate(a.date)} · {SHIFTS.find((s) => s.value === a.shift)?.label} · {a.auditorName}
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <Badge color={a.status === 'submitted' ? '#008300' : '#eda100'}>{a.status === 'submitted' ? 'Submitted' : 'Draft'}</Badge>
                  <Badge color="#5f5e5a">
                    {a.summary.scoredCount}/{a.summary.itemCount} dinilai
                  </Badge>
                  {a.summary.criticalCount > 0 && <Badge color="#e34948">{a.summary.criticalCount} kritikal</Badge>}
                </div>
              </div>
              <span className="text-muted">›</span>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}

export default function AuditsPage() {
  return (
    <Suspense>
      <AuditsInner />
    </Suspense>
  );
}
