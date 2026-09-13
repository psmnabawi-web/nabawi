'use client';

import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { AdminGuard } from '@/components/AdminGuard';
import { useAuth } from '@/components/AuthProvider';
import { Alert, Card, PageHeader } from '@/components/ui';
import { db } from '@/lib/firebase/client';
import type { AuditLog } from '@/lib/types';
import { fmtDateTime } from '@/lib/utils';

export default function AdminLogsPage() {
  const { profile } = useAuth();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (profile?.role !== 'admin') return;
    const q = query(collection(db(), 'auditLogs'), orderBy('at', 'desc'), limit(200));
    return onSnapshot(
      q,
      (snap) => setLogs(snap.docs.map((d) => d.data() as AuditLog)),
      (err) => setError(err.message),
    );
  }, [profile]);

  return (
    <AdminGuard>
      <PageHeader title="Audit Trail" subtitle="200 aktivitas terakhir" />
      {error && <Alert className="mb-3">{error}</Alert>}
      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-surface text-left text-xs uppercase text-muted">
            <tr>
              <th className="p-2">Waktu</th>
              <th className="p-2">User</th>
              <th className="p-2">Aksi</th>
              <th className="p-2">Entitas</th>
              <th className="p-2">Detail</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id} className="border-t border-line align-top">
                <td className="whitespace-nowrap p-2 text-xs">{fmtDateTime(l.at)}</td>
                <td className="p-2 text-xs">
                  <div className="font-semibold">{l.name}</div>
                  <div className="text-muted">{l.role}</div>
                </td>
                <td className="p-2 text-xs font-semibold">{l.action}</td>
                <td className="p-2 text-xs">
                  {l.entity}
                  <div className="break-all text-muted">{l.entityId}</div>
                </td>
                <td className="p-2 text-xs text-muted">
                  <code className="break-all">{JSON.stringify(l.details)}</code>
                </td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-muted">
                  Belum ada aktivitas.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </AdminGuard>
  );
}
