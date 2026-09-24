import { Database, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useToast } from '../../hooks/useToast'
import { seedDemoData } from '../../services/functions'
import { errorMessage } from '../../utils/errors'
import { Alert, Button, Card, CardBody, CardHeader, ConfirmDialog } from '../ui'

export function DemoDataTab() {
  const toast = useToast()
  const [busy, setBusy] = useState<'seed' | 'remove' | null>(null)
  const [confirm, setConfirm] = useState(false)

  const run = async (action: 'seed' | 'remove') => {
    setBusy(action)
    try {
      const res = await seedDemoData({ action })
      toast.success(action === 'seed' ? `Demo data loaded (${res.written} documents).` : `Demo data removed (${res.removed} documents).`)
      setConfirm(false)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card>
      <CardHeader title="Demo data" subtitle="Sample store, trend, content idea, script, videos and metrics to explore the platform." />
      <CardBody className="space-y-4">
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
          <li>
            Store: <strong>Cat XYZ Jakarta</strong>
          </li>
          <li>
            Trends: <strong>Before After Rumah Minimalis</strong>, <strong>Minimalist Beige House Color</strong> (score 94)
          </li>
          <li>
            Content idea: <strong>5 Warna Cat Membuat Rumah Lebih Mahal</strong> with a 30-second script
          </li>
          <li>Three published demo videos with sample metrics and two calendar entries</li>
        </ul>
        <Alert kind="info">Every demo document is flagged and labelled “Demo”. Sample metrics are illustrative, not real results. Remove them before going live.</Alert>
        <div className="flex flex-wrap gap-2">
          <Button icon={<Database className="size-4" />} loading={busy === 'seed'} disabled={!!busy} onClick={() => run('seed')}>
            Load demo data
          </Button>
          <Button variant="outline" icon={<Trash2 className="size-4" />} disabled={!!busy} onClick={() => setConfirm(true)}>
            Remove demo data
          </Button>
        </div>
      </CardBody>
      <ConfirmDialog
        open={confirm}
        title="Remove all demo data?"
        message="All documents flagged as demo (including the demo store) will be deleted. Your real data is not affected."
        confirmLabel="Remove"
        loading={busy === 'remove'}
        onClose={() => setConfirm(false)}
        onConfirm={() => run('remove')}
      />
    </Card>
  )
}
