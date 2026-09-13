'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { useAuth } from '@/components/AuthProvider';
import { Alert, Button, Card, Input, Label, PageHeader, Select, Textarea } from '@/components/ui';
import { ApiError, apiFetch } from '@/lib/api-client';
import { useIndicators, useStores } from '@/lib/hooks';
import { SHIFTS, type Audit, type Shift } from '@/lib/types';
import { todayISO } from '@/lib/utils';

export default function NewAuditPage() {
  const { profile } = useAuth();
  const { stores } = useStores();
  const { indicators } = useIndicators();
  const router = useRouter();
  const [storeChoice, setStoreChoice] = useState('');
  const [date, setDate] = useState(todayISO());
  const [shift, setShift] = useState<Shift>('PAGI');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingId, setExistingId] = useState<string | null>(null);

  const isAdmin = profile?.role === 'admin';
  const storeId = isAdmin ? storeChoice : (profile?.storeId ?? storeChoice);
  const selectedStore = stores.find((s) => s.id === storeId);
  const excluded = new Set(selectedStore?.excludedIndicatorIds ?? []);
  const activeCount = indicators.filter((i) => i.active && !excluded.has(i.id)).length;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setExistingId(null);
    try {
      const { audit } = await apiFetch<{ audit: Audit }>('/api/audits', {
        method: 'POST',
        body: JSON.stringify({ storeId, date, shift, note: note || null }),
      });
      router.push(`/audits/${audit.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setExistingId((err.data as { existingId?: string })?.existingId ?? null);
      }
      setError(err instanceof Error ? err.message : 'Gagal membuat audit.');
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <PageHeader title="Mulai Audit Kebersihan" subtitle={`${activeCount} indikator akan dibuat untuk audit ini${excluded.size ? ` (${excluded.size} area tidak berlaku di store ini)` : ''}.`} />
      <Card className="max-w-lg">
        <form onSubmit={submit} className="space-y-4">
          {error && (
            <Alert>
              {error}{' '}
              {existingId && (
                <button type="button" className="font-semibold underline" onClick={() => router.push(`/audits/${existingId}`)}>
                  Buka audit tersebut
                </button>
              )}
            </Alert>
          )}
          <div>
            <Label htmlFor="store">Store</Label>
            <Select id="store" required value={storeId} onChange={(e) => setStoreChoice(e.target.value)} disabled={!isAdmin && !!profile?.storeId}>
              <option value="">— Pilih store —</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} · {s.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="date">Tanggal</Label>
              <Input id="date" type="date" required value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="shift">Shift</Label>
              <Select id="shift" value={shift} onChange={(e) => setShift(e.target.value as Shift)}>
                {SHIFTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="note">Catatan (opsional)</Label>
            <Textarea id="note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Contoh: audit setelah closing, ada renovasi di area lobby." />
          </div>
          <Alert kind="info">
            Auditor: <b>{profile?.name}</b>. Setelah audit dibuat, ambil foto per area langsung dari HP. AI akan menilai skor 1-5 sesuai standar tiap area.
          </Alert>
          <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!storeId}>
            Buat Audit & Mulai Capture
          </Button>
        </form>
      </Card>
    </AppShell>
  );
}
