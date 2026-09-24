import { History } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useCollection } from '../../hooks/useFirestore'
import { auditLogQuery } from '../../services/firestore'
import type { AuditLog } from '../../types'
import { formatDateTime } from '../../utils/format'
import { Alert, Card, EmptyState, Skeleton } from '../ui'

export function AuditLogTab() {
  const logs = useCollection<AuditLog>(() => auditLogQuery(300), [])
  const [q, setQ] = useState('')
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? logs.data.filter((l) => `${l.action} ${l.actorEmail} ${l.entity} ${l.entityId} ${JSON.stringify(l.details)}`.toLowerCase().includes(s)) : logs.data
  }, [logs.data, q])

  return (
    <>
      <input className="input mb-4" placeholder="Filter by action, user, entity…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter audit log" />
      {logs.error && <Alert>{logs.error}</Alert>}
      {logs.loading ? (
        <Skeleton className="h-64" />
      ) : shown.length ? (
        <Card className="overflow-hidden">
          <div className="scrollbar-thin overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Time</th>
                  <th className="px-3 py-2.5 font-medium">User</th>
                  <th className="px-3 py-2.5 font-medium">Action</th>
                  <th className="px-3 py-2.5 font-medium">Entity</th>
                  <th className="px-5 py-2.5 font-medium">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 align-top">
                {shown.map((l) => (
                  <tr key={l.id}>
                    <td className="px-5 py-2.5 text-xs whitespace-nowrap text-slate-500">{formatDateTime(l.createdAt)}</td>
                    <td className="px-3 py-2.5 text-xs text-slate-700">{l.actorEmail ?? l.actorUid ?? 'system'}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-brand-800">{l.action}</td>
                    <td className="px-3 py-2.5 text-xs text-slate-600">
                      {l.entity}
                      {l.entityId && <span className="block text-slate-400">{l.entityId}</span>}
                    </td>
                    <td className="max-w-md px-5 py-2.5 font-mono text-[11px] break-all text-slate-500">{JSON.stringify(l.details)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <EmptyState icon={<History className="size-5" />} title="No audit events yet" />
      )}
    </>
  )
}
