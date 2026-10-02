'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { IconAlert, IconCheck, IconClipboard, IconQuality } from '@/components/icons';
import { DecisionBadge, scorePctColor } from '@/components/ProductBits';
import { SuperAdminGuard } from '@/components/SuperAdminGuard';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, LinkButton, PageHeader, Select, Spinner, StatCard } from '@/components/ui';
import { apiFetch } from '@/lib/api-client';
import { exportProductRecapExcel } from '@/lib/export-product-excel';
import { useProductAudits, useStores } from '@/lib/hooks';
import { DECISION_COLOR, monthlyStatus, PRODUCTS } from '@/lib/productChecklists';
import { isSuperAdmin } from '@/lib/types';
import { cn, fmtDate, todayISO } from '@/lib/utils';

function monthLabel(m: string) {
  const [y, mm] = m.split('-');
  return new Date(Number(y), Number(mm) - 1, 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
}

export default function ProductAuditListPage() {
  const { profile } = useAuth();
  const enabled = isSuperAdmin(profile);
  const { audits, loading, error } = useProductAudits(enabled);
  const { stores: allStores } = useStores(true);
  const [month, setMonth] = useState(todayISO().slice(0, 7));
  const [storeFilter, setStoreFilter] = useState('all');
  const [productFilter, setProductFilter] = useState('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const months = useMemo(() => {
    const set = new Set(audits.map((a) => a.month));
    set.add(todayISO().slice(0, 7));
    return [...set].sort().reverse();
  }, [audits]);

  const inMonth = useMemo(() => audits.filter((a) => a.month === month), [audits, month]);
  /** Store aktif + store nonaktif yang punya pemeriksaan di bulan terpilih (histori tetap terlihat). */
  const stores = useMemo(() => allStores.filter((s) => s.active || inMonth.some((a) => a.storeId === s.id)).sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name)), [allStores, inMonth]);
  const list = useMemo(
    () => inMonth.filter((a) => (storeFilter === 'all' || a.storeId === storeFilter) && (productFilter === 'all' || a.productId === productFilter)).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt),
    [inMonth, storeFilter, productFilter],
  );

  const submitted = inMonth.filter((a) => a.status === 'submitted');
  const ok = submitted.filter((a) => a.summary.decision.startsWith('BOLEH')).length;
  const hold = submitted.filter((a) => a.summary.decision === 'HOLD - TIDAK AMAN').length;
  const major = submitted.filter((a) => a.summary.decision === 'JANGAN DISAJIKAN').length;

  // Rekap bulanan: store x produk (mengikuti sheet "Rekap Bulanan")
  const recap = useMemo(() => {
    return stores.map((s) => ({
      store: s,
      cells: PRODUCTS.map((p) => {
        const checks = inMonth
          .filter((a) => a.storeId === s.id && a.productId === p.id && a.status === 'submitted')
          .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt)
          .map((a) => a.summary);
        return { product: p, ...monthlyStatus(checks), checks: checks.length };
      }),
    }));
  }, [stores, inMonth]);

  async function remove(id: string, label: string) {
    if (!confirm(`Hapus audit ${label} beserta fotonya? Tindakan tidak dapat dibatalkan.`)) return;
    setBusy(id);
    setMsg(null);
    try {
      await apiFetch(`/api/product-audits/${id}`, { method: 'DELETE' });
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Gagal menghapus.');
    } finally {
      setBusy(null);
    }
  }

  async function exportRecap() {
    setBusy('export');
    try {
      await exportProductRecapExcel(inMonth, month, stores);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Gagal export.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <SuperAdminGuard>
      <PageHeader
        title="Audit Kualitas Produk"
        subtitle="Nasi Kebuli · Ayam Saudi · Ayam ORI/Crispy. Penilaian Ya/Tidak per item oleh AI, keputusan mengikuti gate CRITICAL/MAJOR/CONTROL."
        actions={
          <>
            <Button variant="secondary" size="sm" loading={busy === 'export'} onClick={exportRecap} disabled={inMonth.length === 0}>
              ⬇ Rekap Excel
            </Button>
            <LinkButton href="/product-audit/new" size="sm">
              + Audit Produk
            </LinkButton>
          </>
        }
      />
      {error && <Alert className="mb-4">{error}</Alert>}
      {msg && <Alert className="mb-4">{msg}</Alert>}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select value={month} onChange={(e) => setMonth(e.target.value)} className="!w-auto">
          {months.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m)}
            </option>
          ))}
        </Select>
        <Select value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)} className="!w-auto max-w-[220px]">
          <option value="all">Semua store</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code} · {s.name.replace(/^Almaz Fried Chicken\s*-\s*/i, '')}{s.active ? '' : ' (nonaktif)'}
            </option>
          ))}
        </Select>
        <Select value={productFilter} onChange={(e) => setProductFilter(e.target.value)} className="!w-auto">
          <option value="all">Semua produk</option>
          {PRODUCTS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.short}
            </option>
          ))}
        </Select>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={<IconClipboard size={22} />} value={inMonth.length} label="Pemeriksaan" sub={`${submitted.length} submitted · ${inMonth.length - submitted.length} draft`} tint="#F26522" />
        <StatCard icon={<IconCheck size={22} />} value={submitted.length ? `${Math.round((ok / submitted.length) * 100)}%` : '-'} label="Boleh Disajikan" sub={`${ok} dari ${submitted.length} submitted`} tint="#008300" />
        <StatCard icon={<IconAlert size={22} />} value={hold} label="HOLD (Critical)" sub="Tidak aman disajikan" tint="#e34948" />
        <StatCard icon={<IconQuality size={22} />} value={major} label="Gagal Major" sub="Jangan disajikan" tint="#eda100" />
      </div>

      <Card className="mb-6 overflow-hidden p-0">
        <div className="p-5 pb-0">
          <CardHeader title={`Rekap Bulanan · ${monthLabel(month)}`} desc="Status per store per produk dari pemeriksaan yang sudah disubmit (target 4 kali per produk per bulan)." />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-y border-line/70 bg-surface text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-5 py-2.5">Store</th>
                {PRODUCTS.map((p) => (
                  <th key={p.id} className="px-3 py-2.5">
                    {p.short}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recap
                .filter((r) => storeFilter === 'all' || r.store.id === storeFilter)
                .map((r) => (
                  <tr key={r.store.id} className="border-b border-line/50 align-top">
                    <td className="px-5 py-2.5 font-semibold text-ink">
                      {r.store.name.replace(/^Almaz Fried Chicken\s*-\s*/i, '')}
                      {!r.store.active && <Badge color="#9a9994" className="ml-1">nonaktif</Badge>}
                    </td>
                    {r.cells.map((c) => (
                      <td key={c.product.id} className="px-3 py-2.5">
                        <button type="button" className="text-left" onClick={() => { setStoreFilter(r.store.id); setProductFilter(c.product.id); }}>
                          <DecisionBadge decision={c.status} />
                          <div className="mt-1 text-xs text-muted">
                            {c.done}/4 pemeriksaan{c.avg !== null && (
                              <>
                                {' '}· skor <span className="font-semibold" style={{ color: scorePctColor(c.avg) }}>{c.avg}%</span>
                              </>
                            )}
                            {c.totalTidak > 0 && ` · ${c.totalTidak} Tidak`}
                          </div>
                        </button>
                      </td>
                    ))}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="p-5 pb-0">
          <CardHeader title="Daftar Pemeriksaan" desc={`${list.length} pemeriksaan pada ${monthLabel(month)}.`} />
        </div>
        {loading ? (
          <div className="flex justify-center p-8 text-brand">
            <Spinner />
          </div>
        ) : list.length === 0 ? (
          <div className="p-5">
            <EmptyState title="Belum ada pemeriksaan" desc="Buat audit produk untuk mulai menilai." action={<LinkButton href="/product-audit/new">+ Audit Produk</LinkButton>} />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-y border-line/70 bg-surface text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-5 py-2.5">Tanggal</th>
                  <th className="px-3 py-2.5">Store</th>
                  <th className="px-3 py-2.5">Produk</th>
                  <th className="px-3 py-2.5">Cek ke</th>
                  <th className="px-3 py-2.5">Skor</th>
                  <th className="px-3 py-2.5">Ya / Tidak / N/A</th>
                  <th className="px-3 py-2.5">Keputusan</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {list.map((a) => (
                  <tr key={a.id} className="border-b border-line/50 hover:bg-surface/60">
                    <td className="px-5 py-2.5 whitespace-nowrap">
                      <Link href={`/product-audit/${a.id}`} className="font-semibold text-brand hover:underline">
                        {fmtDate(a.date)}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5">{a.storeName.replace(/^Almaz Fried Chicken\s*-\s*/i, '')}</td>
                    <td className="px-3 py-2.5">{a.productName}</td>
                    <td className="px-3 py-2.5">#{a.checkNo}</td>
                    <td className="px-3 py-2.5 font-bold" style={{ color: scorePctColor(a.summary.score) }}>
                      {a.summary.score === null ? '-' : `${a.summary.score}%`}
                    </td>
                    <td className="px-3 py-2.5 text-muted">
                      {a.summary.ya} / {a.summary.tidak} / {a.summary.na}
                    </td>
                    <td className="px-3 py-2.5">
                      <DecisionBadge decision={a.summary.decision} />
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge color={a.status === 'submitted' ? '#008300' : '#eda100'}>{a.status === 'submitted' ? 'Submitted' : 'Draft'}</Badge>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <button type="button" className={cn('text-xs font-semibold text-danger hover:underline', busy === a.id && 'opacity-50')} disabled={busy === a.id} onClick={() => remove(a.id, `${a.productName} ${a.storeName} ${fmtDate(a.date)}`)}>
                        Hapus
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="mt-3 text-xs text-muted">
        Warna keputusan: <span style={{ color: DECISION_COLOR['BOLEH DISAJIKAN'] }}>hijau</span> memenuhi, <span style={{ color: DECISION_COLOR['BOLEH DISAJIKAN - CATAT DEVIASI'] }}>biru</span> memenuhi dengan catatan (CONTROL gagal), <span style={{ color: DECISION_COLOR['JANGAN DISAJIKAN'] }}>kuning</span> gagal MAJOR, <span style={{ color: DECISION_COLOR['HOLD - TIDAK AMAN'] }}>merah</span> gagal CRITICAL.
      </p>
    </SuperAdminGuard>
  );
}
