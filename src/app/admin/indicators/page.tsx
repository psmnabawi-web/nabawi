'use client';

import { useState } from 'react';
import { AdminGuard } from '@/components/AdminGuard';
import { Alert, Badge, Button, Card, Input, Label, Modal, PageHeader, Select, Textarea } from '@/components/ui';
import { apiFetch } from '@/lib/api-client';
import { useIndicators } from '@/lib/hooks';
import { CATEGORY_ORDER, type Indicator, type IndicatorCategoryCode } from '@/lib/indicators';

interface Form {
  id: string;
  no: number;
  categoryCode: IndicatorCategoryCode;
  area: string;
  standard: string;
  active: boolean;
}

export default function AdminIndicatorsPage() {
  const { indicators, fromDb } = useIndicators();
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [cat, setCat] = useState<string>('ALL');

  function edit(i?: Indicator) {
    setError(null);
    setForm(
      i
        ? { id: i.id, no: i.no, categoryCode: i.categoryCode, area: i.area, standard: i.standard, active: i.active }
        : { id: '', no: (indicators.at(-1)?.no ?? 0) + 1, categoryCode: 'KITCHEN', area: '', standard: '', active: true },
    );
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setBusy('save');
    setError(null);
    try {
      await apiFetch('/api/admin/indicators', { method: 'POST', body: JSON.stringify({ ...form, id: form.id || undefined, weight: 1 }) });
      setForm(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan.');
    } finally {
      setBusy(null);
    }
  }

  async function remove(i: Indicator) {
    if (!confirm(`Hapus indikator #${i.no} ${i.area}? Audit yang sudah ada tidak terpengaruh.`)) return;
    setBusy(i.id);
    try {
      await apiFetch(`/api/admin/indicators?id=${encodeURIComponent(i.id)}`, { method: 'DELETE' });
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Gagal menghapus.');
    } finally {
      setBusy(null);
    }
  }

  async function seed() {
    if (!confirm('Simpan / reset 57 indikator standar dari Form Audit Cleaning ke Firestore?')) return;
    setBusy('seed');
    setMsg(null);
    try {
      const r = await apiFetch<{ count: number }>('/api/admin/indicators', { method: 'PUT' });
      setMsg(`${r.count} indikator tersimpan di Firestore.`);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Gagal seed.');
    } finally {
      setBusy(null);
    }
  }

  const list = indicators.filter((i) => cat === 'ALL' || i.categoryCode === cat);

  return (
    <AdminGuard>
      <PageHeader
        title="Indikator Kebersihan"
        subtitle={fromDb ? `${indicators.length} indikator dari Firestore` : `${indicators.length} indikator default (belum disimpan ke Firestore)`}
        actions={
          <>
            <Button size="sm" variant="secondary" loading={busy === 'seed'} onClick={seed}>
              {fromDb ? 'Reset ke Default' : 'Simpan Default ke Firestore'}
            </Button>
            <Button size="sm" onClick={() => edit()} disabled={!fromDb}>
              + Tambah
            </Button>
          </>
        }
      />
      {!fromDb && <Alert kind="info" className="mb-3">Audit memakai 57 indikator default dari Excel. Klik &quot;Simpan Default ke Firestore&quot; agar bisa diedit.</Alert>}
      {msg && <Alert kind={msg.includes('tersimpan') ? 'success' : 'error'} className="mb-3">{msg}</Alert>}
      <Select value={cat} onChange={(e) => setCat(e.target.value)} className="mb-3 max-w-sm">
        <option value="ALL">Semua kategori</option>
        {CATEGORY_ORDER.map((c) => (
          <option key={c.code} value={c.code}>
            {c.label}
          </option>
        ))}
      </Select>
      <div className="space-y-2">
        {list.map((i) => (
          <Card key={i.id} className="flex items-start gap-3">
            <span className="w-8 shrink-0 text-sm font-bold text-muted">#{i.no}</span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold text-ink">{i.area}</div>
              <div className="text-xs text-muted">{i.category}</div>
              <p className="mt-1 text-xs text-ink">{i.standard}</p>
              {!i.active && <Badge color="#9a9994" className="mt-1">Nonaktif</Badge>}
            </div>
            {fromDb && (
              <div className="flex shrink-0 flex-col gap-1">
                <Button size="sm" variant="secondary" onClick={() => edit(i)}>
                  Edit
                </Button>
                <Button size="sm" variant="ghost" loading={busy === i.id} onClick={() => remove(i)}>
                  Hapus
                </Button>
              </div>
            )}
          </Card>
        ))}
      </div>

      <Modal open={!!form} title={form?.id ? 'Edit Indikator' : 'Tambah Indikator'} onClose={() => setForm(null)}>
        {form && (
          <form onSubmit={save} className="space-y-3">
            {error && <Alert>{error}</Alert>}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>No</Label>
                <Input type="number" min={1} required value={form.no} onChange={(e) => setForm({ ...form, no: Number(e.target.value) })} />
              </div>
              <div className="col-span-2">
                <Label>Kategori</Label>
                <Select value={form.categoryCode} onChange={(e) => setForm({ ...form, categoryCode: e.target.value as IndicatorCategoryCode })}>
                  {CATEGORY_ORDER.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div>
              <Label>Area audit</Label>
              <Input required minLength={2} value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} />
            </div>
            <div>
              <Label>Standar bersih / kondisi ideal</Label>
              <Textarea required minLength={5} rows={4} value={form.standard} onChange={(e) => setForm({ ...form, standard: e.target.value })} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Aktif (dipakai di audit baru)
            </label>
            <Button type="submit" className="w-full" loading={busy === 'save'}>
              Simpan
            </Button>
          </form>
        )}
      </Modal>
    </AdminGuard>
  );
}
