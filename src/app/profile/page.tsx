'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { useAuth } from '@/components/AuthProvider';
import { Alert, Button, Card, Input, Label, PageHeader, Select } from '@/components/ui';
import { apiFetch } from '@/lib/api-client';
import { useStores } from '@/lib/hooks';
import { ROLES, type UserProfile } from '@/lib/types';

function ProfileForm() {
  const { profile } = useAuth();
  if (!profile) return null;
  // key = reset form saat profil berubah (tanpa effect)
  return <ProfileFormInner key={`${profile.uid}-${profile.updatedAt}`} profile={profile} />;
}

function ProfileFormInner({ profile }: { profile: UserProfile }) {
  const { refreshProfile, logout } = useAuth();
  const { stores } = useStores();
  const params = useSearchParams();
  const onboarding = params.get('onboarding') === '1';
  const [name, setName] = useState(profile.name);
  const [storeId, setStoreId] = useState(profile.storeId ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const storeLocked = profile.role !== 'admin' && !!profile.storeId;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await apiFetch('/api/me', { method: 'PATCH', body: JSON.stringify({ name, storeId: storeId || null }) });
      await refreshProfile();
      setMsg({ kind: 'success', text: 'Profil tersimpan.' });
    } catch (err) {
      setMsg({ kind: 'error', text: err instanceof Error ? err.message : 'Gagal menyimpan.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Profil" subtitle={profile.email} />
      {onboarding && !profile.storeId && <Alert kind="info" className="mb-4">Selamat datang! Pilih store tempat Anda bekerja untuk mulai audit.</Alert>}
      <Card className="max-w-lg">
        <form onSubmit={save} className="space-y-4">
          {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
          <div>
            <Label htmlFor="name">Nama</Label>
            <Input id="name" required minLength={2} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label>Role</Label>
            <Input value={ROLES.find((r) => r.value === profile.role)?.label ?? profile.role} disabled />
          </div>
          <div>
            <Label htmlFor="store">Store</Label>
            <Select id="store" value={storeId} onChange={(e) => setStoreId(e.target.value)} disabled={storeLocked}>
              <option value="">{profile.role === 'admin' ? '— Semua store —' : '— Pilih store —'}</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} · {s.name}
                </option>
              ))}
            </Select>
            {storeLocked && <p className="mt-1 text-xs text-muted">Perubahan store dilakukan oleh admin.</p>}
            {stores.length === 0 && <p className="mt-1 text-xs text-warn">Belum ada store. Admin perlu menambahkan store di menu Admin.</p>}
          </div>
          <div className="flex gap-2">
            <Button type="submit" loading={busy}>
              Simpan
            </Button>
            <Button type="button" variant="secondary" onClick={logout}>
              Keluar
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}

export default function ProfilePage() {
  return (
    <AppShell>
      <Suspense>
        <ProfileForm />
      </Suspense>
    </AppShell>
  );
}
