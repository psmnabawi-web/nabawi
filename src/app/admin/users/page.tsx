'use client';

import { useEffect, useState } from 'react';
import { AdminGuard } from '@/components/AdminGuard';
import { useAuth } from '@/components/AuthProvider';
import { Alert, Badge, Button, Card, Input, Label, Modal, PageHeader, Select } from '@/components/ui';
import { apiFetch } from '@/lib/api-client';
import { useStores } from '@/lib/hooks';
import { ROLES, type Role, type UserProfile } from '@/lib/types';

interface Form {
  uid: string;
  email: string;
  password: string;
  name: string;
  role: Role;
  storeId: string;
  active: boolean;
}
const empty: Form = { uid: '', email: '', password: '', name: '', role: 'crew', storeId: '', active: true };

export default function AdminUsersPage() {
  const { profile } = useAuth();
  const { stores } = useStores(true);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [form, setForm] = useState<Form>(empty);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');

  const [reloadKey, setReloadKey] = useState(0);
  const load = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    if (profile?.role !== 'admin') return;
    let alive = true;
    apiFetch<{ users: UserProfile[] }>('/api/admin/users')
      .then((r) => alive && setUsers(r.users))
      .catch((err) => alive && setError(err instanceof Error ? err.message : 'Gagal memuat user.'));
    return () => {
      alive = false;
    };
  }, [profile, reloadKey]);

  function edit(u?: UserProfile) {
    setForm(u ? { uid: u.uid, email: u.email, password: '', name: u.name, role: u.role, storeId: u.storeId ?? '', active: u.active } : empty);
    setError(null);
    setOpen(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (form.uid) {
        await apiFetch('/api/admin/users', {
          method: 'PATCH',
          body: JSON.stringify({ uid: form.uid, name: form.name, role: form.role, storeId: form.storeId || null, active: form.active, password: form.password || undefined }),
        });
      } else {
        await apiFetch('/api/admin/users', {
          method: 'POST',
          body: JSON.stringify({ email: form.email, password: form.password, name: form.name, role: form.role, storeId: form.storeId || null }),
        });
      }
      setOpen(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan.');
    } finally {
      setBusy(false);
    }
  }

  const list = users.filter((u) => !q || `${u.name} ${u.email} ${u.storeName ?? ''}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <AdminGuard>
      <PageHeader title="User & Role" subtitle={`${users.length} akun`} actions={<Button size="sm" onClick={() => edit()}>+ Tambah User</Button>} />
      <Input placeholder="Cari nama / email / store" value={q} onChange={(e) => setQ(e.target.value)} className="mb-3 max-w-sm" />
      {error && !open && <Alert className="mb-3">{error}</Alert>}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((u) => (
          <Card key={u.uid} className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-bold text-ink">{u.name}</div>
              <div className="truncate text-xs text-muted">{u.email}</div>
              <div className="mt-1 flex flex-wrap gap-1">
                <Badge color={u.role === 'admin' ? '#7a4ac7' : u.role === 'manager' ? '#2a78d6' : '#5f5e5a'}>{ROLES.find((r) => r.value === u.role)?.label}</Badge>
                <Badge color="#5f5e5a">{u.storeName ?? 'Tanpa store'}</Badge>
                {!u.active && <Badge color="#e34948">Nonaktif</Badge>}
              </div>
            </div>
            <Button size="sm" variant="secondary" onClick={() => edit(u)}>
              Edit
            </Button>
          </Card>
        ))}
      </div>

      <Modal open={open} title={form.uid ? 'Edit User' : 'Tambah User'} onClose={() => setOpen(false)}>
        <form onSubmit={save} className="space-y-3">
          {error && <Alert>{error}</Alert>}
          <div>
            <Label>Nama</Label>
            <Input required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <Label>Email</Label>
            <Input type="email" required disabled={!!form.uid} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div>
            <Label>{form.uid ? 'Reset password (kosongkan jika tidak diubah)' : 'Password (min. 6)'}</Label>
            <Input type="password" autoComplete="new-password" required={!form.uid} minLength={6} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Role</Label>
              <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Store</Label>
              <Select value={form.storeId} onChange={(e) => setForm({ ...form, storeId: e.target.value })}>
                <option value="">— Tidak ada —</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} · {s.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          {form.uid && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Akun aktif
            </label>
          )}
          <Button type="submit" className="w-full" loading={busy}>
            Simpan
          </Button>
        </form>
      </Modal>
    </AdminGuard>
  );
}
