'use client';

import { useState } from 'react';
import { AdminGuard } from '@/components/AdminGuard';
import { Alert, Badge, Button, Card, Input, Label, Modal, PageHeader } from '@/components/ui';
import { apiFetch } from '@/lib/api-client';
import { useStores } from '@/lib/hooks';
import type { Store } from '@/lib/types';

const empty = { id: '', code: '', name: '', city: '', active: true };

export default function AdminStoresPage() {
  const { stores } = useStores(true);
  const [form, setForm] = useState(empty);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function edit(s?: Store) {
    setForm(s ? { id: s.id, code: s.code, name: s.name, city: s.city, active: s.active } : empty);
    setError(null);
    setOpen(true);
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

  return (
    <AdminGuard>
      <PageHeader title="Store" subtitle={`${stores.length} store`} actions={<Button size="sm" onClick={() => edit()}>+ Tambah Store</Button>} />
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {stores.map((s) => (
          <Card key={s.id} className="flex items-center justify-between">
            <div>
              <div className="text-sm font-bold text-ink">
                {s.code} · {s.name}
              </div>
              <div className="text-xs text-muted">{s.city || '-'}</div>
              <Badge color={s.active ? '#008300' : '#9a9994'} className="mt-1">
                {s.active ? 'Aktif' : 'Nonaktif'}
              </Badge>
            </div>
            <Button size="sm" variant="secondary" onClick={() => edit(s)}>
              Edit
            </Button>
          </Card>
        ))}
        {stores.length === 0 && <p className="text-sm text-muted">Belum ada store. Tambahkan store pertama.</p>}
      </div>

      <Modal open={open} title={form.id ? 'Edit Store' : 'Tambah Store'} onClose={() => setOpen(false)}>
        <form onSubmit={save} className="space-y-3">
          {error && <Alert>{error}</Alert>}
          <div>
            <Label>Kode store</Label>
            <Input required minLength={2} maxLength={20} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="JKT-01" />
          </div>
          <div>
            <Label>Nama store</Label>
            <Input required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <Label>Kota</Label>
            <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Aktif
          </label>
          <Button type="submit" className="w-full" loading={busy}>
            Simpan
          </Button>
        </form>
      </Modal>
    </AdminGuard>
  );
}
