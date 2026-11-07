'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { SuperAdminGuard } from '@/components/SuperAdminGuard';
import { Alert, Badge, Button, Card, CardHeader, Label, PageHeader, Textarea } from '@/components/ui';
import { apiFetch } from '@/lib/api-client';
import { isSuperAdmin } from '@/lib/types';
import { fmtDateTime } from '@/lib/utils';

interface Status {
  maintenance: boolean;
  message: string;
  updatedAt: number;
  updatedByName: string | null;
}

export default function AppStatusPage() {
  const { profile } = useAuth();
  const [status, setStatus] = useState<Status | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);

  useEffect(() => {
    if (!isSuperAdmin(profile)) return;
    let alive = true;
    apiFetch<{ status: Status }>('/api/admin/app')
      .then((r) => {
        if (!alive) return;
        setStatus(r.status);
        setMessage(r.status.message);
      })
      .catch((e) => alive && setMsg({ kind: 'error', text: e instanceof Error ? e.message : 'Gagal memuat.' }));
    return () => {
      alive = false;
    };
  }, [profile]);

  async function set(maintenance: boolean) {
    if (!confirm(maintenance ? 'Nonaktifkan aplikasi untuk semua user (kecuali super admin)? Crew dan manager tidak bisa masuk sampai dinyalakan lagi.' : 'Nyalakan kembali aplikasi untuk semua user?')) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await apiFetch<{ status: Status }>('/api/admin/app', { method: 'PUT', body: JSON.stringify({ maintenance, message }) });
      setStatus(r.status);
      setMsg({ kind: 'success', text: maintenance ? 'Aplikasi dinonaktifkan. Berlaku dalam 15 detik.' : 'Aplikasi aktif kembali.' });
    } catch (e) {
      setMsg({ kind: 'error', text: e instanceof Error ? e.message : 'Gagal.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <SuperAdminGuard>
      <PageHeader title="Status Aplikasi" subtitle="Nonaktifkan sementara seluruh aplikasi tanpa menghapus data. Super admin tetap bisa masuk untuk menyalakan kembali." />
      {msg && (
        <Alert kind={msg.kind} className="mb-4">
          {msg.text}
        </Alert>
      )}
      <Card className="max-w-xl">
        <CardHeader title="Mode Nonaktif Sementara" right={status ? <Badge color={status.maintenance ? '#e34948' : '#008300'}>{status.maintenance ? 'NONAKTIF' : 'AKTIF'}</Badge> : null} />
        <div className="space-y-4">
          <div>
            <Label htmlFor="m">Pesan yang dilihat user saat nonaktif</Label>
            <Textarea id="m" value={message} maxLength={300} onChange={(e) => setMessage(e.target.value)} />
          </div>
          <p className="text-sm text-muted">Saat nonaktif: crew/manager/admin biasa tidak bisa login dan tidak ada analisa AI, laporan WhatsApp terjadwal dilewati. Data audit, foto, user, dan pengaturan tetap tersimpan.</p>
          {status?.updatedAt ? <p className="text-xs text-muted">Terakhir diubah {fmtDateTime(status.updatedAt)} oleh {status.updatedByName}</p> : null}
          <div className="flex gap-2">
            {status?.maintenance ? (
              <Button loading={busy} onClick={() => set(false)}>
                Nyalakan Kembali Aplikasi
              </Button>
            ) : (
              <Button variant="danger" loading={busy} onClick={() => set(true)}>
                Nonaktifkan Aplikasi
              </Button>
            )}
          </div>
        </div>
      </Card>
    </SuperAdminGuard>
  );
}
