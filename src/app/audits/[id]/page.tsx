'use client';

import { useParams, useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { useAuth } from '@/components/AuthProvider';
import { CaptureItem } from '@/components/CaptureItem';
import { GradeBadge, ProgressBar } from '@/components/ScoreBadge';
import { Alert, Badge, Button, Card, PageHeader, Spinner } from '@/components/ui';
import { apiFetch } from '@/lib/api-client';
import { exportAuditExcel } from '@/lib/export-excel';
import { useAudit } from '@/lib/hooks';
import { CATEGORY_ORDER } from '@/lib/indicators';
import { SHIFTS } from '@/lib/types';
import { cn, fmtDate, fmtDateTime, scoreColor } from '@/lib/utils';

type Filter = 'all' | 'pending' | 'critical' | 'invalid';

export default function AuditDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { profile } = useAuth();
  const router = useRouter();
  const { audit, items, loading, error } = useAudit(id);
  const [cat, setCat] = useState<string>('ALL');
  const [filter, setFilter] = useState<Filter>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const role = profile?.role ?? 'crew';
  const editable = audit?.status === 'draft';

  const visible = useMemo(() => {
    return items.filter((it) => {
      if (cat !== 'ALL' && it.categoryCode !== cat) return false;
      if (filter === 'pending') return it.status === 'pending';
      if (filter === 'invalid') return it.status === 'invalid';
      if (filter === 'critical') return (it.finalScore ?? 99) <= 2;
      return true;
    });
  }, [items, cat, filter]);

  async function act(action: 'submit' | 'reopen' | 'delete' | 'export') {
    if (!audit) return;
    setMsg(null);
    if (action === 'delete' && !confirm('Hapus audit ini beserta seluruh foto? Tindakan tidak dapat dibatalkan.')) return;
    if (action === 'submit' && audit.summary.pendingCount > 0 && !confirm(`Masih ada ${audit.summary.pendingCount} area belum difoto. Submit sekarang?`)) return;
    setBusy(action);
    try {
      if (action === 'export') {
        await exportAuditExcel(audit, items);
      } else if (action === 'delete') {
        await apiFetch(`/api/audits/${audit.id}`, { method: 'DELETE' });
        router.replace('/audits');
        return;
      } else {
        await apiFetch(`/api/audits/${audit.id}`, { method: 'PATCH', body: JSON.stringify({ action }) });
        setMsg(action === 'submit' ? 'Audit berhasil disubmit.' : 'Audit dibuka kembali.');
      }
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Gagal.');
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <AppShell>
        <div className="flex justify-center p-10 text-brand">
          <Spinner className="h-8 w-8" />
        </div>
      </AppShell>
    );
  }
  if (error || !audit) {
    return (
      <AppShell>
        <Alert>{error ?? 'Audit tidak ditemukan.'}</Alert>
      </AppShell>
    );
  }
  const s = audit.summary;
  const progressPct = s.itemCount ? Math.round(((s.itemCount - s.pendingCount) / s.itemCount) * 100) : 0;

  return (
    <AppShell>
      <PageHeader
        title={audit.storeName}
        subtitle={`${fmtDate(audit.date)} · Shift ${SHIFTS.find((x) => x.value === audit.shift)?.label} · Auditor ${audit.auditorName}`}
        actions={
          <>
            <Button variant="secondary" size="sm" loading={busy === 'export'} onClick={() => act('export')}>
              ⬇ Excel
            </Button>
            {editable ? (
              <Button size="sm" loading={busy === 'submit'} onClick={() => act('submit')} disabled={s.scoredCount === 0}>
                Submit Audit
              </Button>
            ) : (
              role !== 'crew' && (
                <Button variant="secondary" size="sm" loading={busy === 'reopen'} onClick={() => act('reopen')}>
                  Buka Kembali
                </Button>
              )
            )}
            {role !== 'crew' && (
              <Button variant="danger" size="sm" loading={busy === 'delete'} onClick={() => act('delete')}>
                Hapus
              </Button>
            )}
          </>
        }
      />
      {msg && <Alert kind={msg.includes('berhasil') || msg.includes('dibuka') ? 'success' : 'error'} className="mb-3">{msg}</Alert>}

      <Card className="mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <GradeBadge grade={s.grade} pct={s.pct} size="lg" />
          <div className="grid grid-cols-3 gap-3 text-center sm:gap-6">
            <Stat label="Dinilai" value={`${s.scoredCount}/${s.itemCount}`} />
            <Stat label="Rata-rata" value={s.avg?.toLocaleString('id-ID') ?? '-'} />
            <Stat label="Kritikal" value={String(s.criticalCount)} color={s.criticalCount ? '#e34948' : undefined} />
          </div>
          <Badge color={audit.status === 'submitted' ? '#008300' : '#eda100'}>{audit.status === 'submitted' ? `Submitted · ${fmtDateTime(audit.submittedAt)}` : 'Draft'}</Badge>
        </div>
        <div className="mt-3">
          <div className="mb-1 flex justify-between text-xs text-muted">
            <span>Progress capture</span>
            <span>{progressPct}%</span>
          </div>
          <ProgressBar pct={progressPct} color="#1f3a68" />
        </div>
        {s.categories.length > 0 && (
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {s.categories.map((c) => (
              <button key={c.code} type="button" onClick={() => setCat(cat === c.code ? 'ALL' : c.code)} className={cn('rounded-lg p-2 text-left hover:bg-surface', cat === c.code && 'bg-surface ring-1 ring-brand')}>
                <div className="flex justify-between text-xs">
                  <span className="font-semibold text-ink">{c.label}</span>
                  <span className="text-muted">
                    {c.scored}/{c.total} · <b style={{ color: scoreColor(c.avg) }}>{c.pct === null ? '-' : `${c.pct}%`}</b>
                  </span>
                </div>
                <ProgressBar pct={c.pct} height={6} />
              </button>
            ))}
          </div>
        )}
      </Card>

      <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
        <Chip active={cat === 'ALL'} onClick={() => setCat('ALL')}>
          Semua area
        </Chip>
        {CATEGORY_ORDER.filter((c) => items.some((i) => i.categoryCode === c.code)).map((c) => (
          <Chip key={c.code} active={cat === c.code} onClick={() => setCat(c.code)}>
            {c.label}
          </Chip>
        ))}
      </div>
      <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
        {(
          [
            ['all', `Semua (${items.length})`],
            ['pending', `Belum difoto (${s.pendingCount})`],
            ['critical', `Kritikal (${s.criticalCount})`],
            ['invalid', `Foto tidak valid (${s.invalidCount})`],
          ] as [Filter, string][]
        ).map(([k, label]) => (
          <Chip key={k} active={filter === k} onClick={() => setFilter(k)}>
            {label}
          </Chip>
        ))}
      </div>

      {!editable && <Alert kind="info" className="mb-3">Audit sudah disubmit. Foto tidak dapat diubah{role !== 'crew' ? ', kecuali dibuka kembali' : ''}.</Alert>}

      <div className="space-y-2">
        {visible.length === 0 && <p className="p-6 text-center text-sm text-muted">Tidak ada item untuk filter ini.</p>}
        {visible.map((it) => (
          <CaptureItem key={it.id} item={it} auditId={audit.id} editable={!!editable} role={role} />
        ))}
      </div>
    </AppShell>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div className="text-xl font-bold" style={{ color }}>
        {value}
      </div>
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={cn('shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold', active ? 'border-brand bg-brand text-white' : 'border-line bg-white text-ink')}>
      {children}
    </button>
  );
}
