'use client';

import { useMemo, useState } from 'react';
import { AdminGuard } from '@/components/AdminGuard';
import { Alert, Badge, Button, Card, Input, Label, Modal, PageHeader } from '@/components/ui';
import { apiFetch } from '@/lib/api-client';
import { useIndicators, useStores } from '@/lib/hooks';
import { CATEGORY_ORDER } from '@/lib/indicators';
import type { Store } from '@/lib/types';
import { cn } from '@/lib/utils';

interface Form {
  id: string;
  code: string;
  name: string;
  city: string;
  active: boolean;
  excludedIndicatorIds: string[];
}
const empty: Form = { id: '', code: '', name: '', city: '', active: true, excludedIndicatorIds: [] };

export default function AdminStoresPage() {
  const { stores } = useStores(true);
  const { indicators } = useIndicators();
  const [form, setForm] = useState<Form>(empty);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');

  const activeIndicators = useMemo(() => indicators.filter((i) => i.active), [indicators]);
  const grouped = useMemo(
    () =>
      CATEGORY_ORDER.map((c) => ({
        ...c,
        items: activeIndicators.filter((i) => i.categoryCode === c.code && (!q || i.area.toLowerCase().includes(q.toLowerCase()))),
      })).filter((g) => g.items.length > 0),
    [activeIndicators, q],
  );

  function edit(s?: Store) {
    setForm(s ? { id: s.id, code: s.code, name: s.name, city: s.city, active: s.active, excludedIndicatorIds: s.excludedIndicatorIds ?? [] } : empty);
    setError(null);
    setQ('');
    setOpen(true);
  }

  function toggle(id: string) {
    setForm((f) => ({ ...f, excludedIndicatorIds: f.excludedIndicatorIds.includes(id) ? f.excludedIndicatorIds.filter((x) => x !== id) : [...f.excludedIndicatorIds, id] }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/api/admin/stores', {
        method: form.id ? 'PATCH' : 'POST',
        body: JSON.stringify(form.id ? form : { ...form, id: undefined }),
      });
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan.');
    } finally {
      setBusy(false);
    }
  }

  const applicable = activeIndicators.length - form.excludedIndicatorIds.filter((id) => activeIndicators.some((i) => i.id === id)).length;

  return (
    <AdminGuard>
      <PageHeader title="Store" subtitle={`${stores.length} store · ${activeIndicators.length} indikator aktif`} actions={<Button size="sm" onClick={() => edit()}>+ Tambah Store</Button>} />
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {stores.map((s) => {
          const excluded = (s.excludedIndicatorIds ?? []).filter((id) => activeIndicators.some((i) => i.id === id)).length;
          return (
            <Card key={s.id} className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-bold text-ink">
                  {s.code} · {s.name}
                </div>
                <div className="text-xs text-muted">{s.city || '-'}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  <Badge color={s.active ? '#008300' : '#9a9994'}>{s.active ? 'Aktif' : 'Nonaktif'}</Badge>
                  <Badge color={excluded ? '#eda100' : '#5f5e5a'}>
                    {activeIndicators.length - excluded} indikator{excluded ? ` (${excluded} dikecualikan)` : ''}
                  </Badge>
                </div>
              </div>
              <Button size="sm" variant="secondary" onClick={() => edit(s)}>
                Edit
              </Button>
            </Card>
          );
        })}
        {stores.length === 0 && <p className="text-sm text-muted">Belum ada store. Tambahkan store pertama.</p>}
      </div>

      <Modal open={open} title={form.id ? 'Edit Store' : 'Tambah Store'} onClose={() => setOpen(false)}>
        <form onSubmit={save} className="space-y-3">
          {error && <Alert>{error}</Alert>}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Kode</Label>
              <Input required minLength={2} maxLength={20} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="AFC-XXX" />
            </div>
            <div className="col-span-2">
              <Label>Nama store</Label>
              <Input required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
          </div>
          <div>
            <Label>Kota</Label>
            <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Aktif
          </label>

          <div className="rounded-lg border border-line">
            <div className="flex items-center justify-between gap-2 border-b border-line bg-surface px-3 py-2">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted">Indikator tidak berlaku di store ini</div>
                <div className="text-xs text-muted">
                  Centang area yang tidak ada di store. Audit store ini akan memuat <b className="text-ink">{applicable}</b> dari {activeIndicators.length} indikator.
                </div>
              </div>
              {form.excludedIndicatorIds.length > 0 && (
                <button type="button" className="shrink-0 text-xs font-semibold text-brand underline" onClick={() => setForm({ ...form, excludedIndicatorIds: [] })}>
                  Reset
                </button>
              )}
            </div>
            <div className="p-2">
              <Input placeholder="Cari area..." value={q} onChange={(e) => setQ(e.target.value)} className="mb-2" />
              <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                {grouped.map((g) => (
                  <div key={g.code}>
                    <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-muted">{g.label}</div>
                    {g.items.map((i) => {
                      const on = form.excludedIndicatorIds.includes(i.id);
                      return (
                        <label key={i.id} className={cn('flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm', on ? 'bg-amber-50 text-amber-900 line-through' : 'text-ink hover:bg-surface')}>
                          <input type="checkbox" checked={on} onChange={() => toggle(i.id)} />
                          <span className="w-6 shrink-0 text-xs text-muted">#{i.no}</span>
                          <span className="truncate">{i.area}</span>
                        </label>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <Button type="submit" className="w-full" loading={busy}>
            Simpan
          </Button>
        </form>
      </Modal>
    </AdminGuard>
  );
}
