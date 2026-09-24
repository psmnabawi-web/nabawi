import { Pencil, Plus, Store as StoreIcon, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useCollection } from '../../hooks/useFirestore'
import { useToast } from '../../hooks/useToast'
import { createStore, deleteStore, storesQuery, updateStore } from '../../services/firestore'
import type { Store } from '../../types'
import { errorMessage } from '../../utils/errors'
import { slugify } from '../../utils/format'
import { fieldErrors, storeSchema } from '../../utils/validation'
import { Alert, Badge, Button, Card, ConfirmDialog, EmptyState, Modal, SelectInput, Skeleton, TextInput } from '../ui'

export function StoresTab() {
  const stores = useCollection<Store>(() => storesQuery(), [])
  const toast = useToast()
  const [editing, setEditing] = useState<Store | 'new' | null>(null)
  const [form, setForm] = useState({ storeId: '', storeName: '', address: '', city: '', status: 'active' as 'active' | 'inactive' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<Store | null>(null)
  const [deleting, setDeleting] = useState(false)

  const open = (s: Store | 'new') => {
    setEditing(s)
    setErrors({})
    setError(null)
    setForm(s === 'new' ? { storeId: '', storeName: '', address: '', city: '', status: 'active' } : { storeId: s.id, storeName: s.storeName, address: s.address ?? '', city: s.city, status: s.status })
  }

  const save = async () => {
    const parsed = storeSchema.safeParse(form)
    const id = editing === 'new' ? slugify(form.storeId || `${form.storeName}`) : (editing as Store).id
    const errs = parsed.success ? {} : fieldErrors(parsed.error)
    if (editing === 'new' && !/^[a-z0-9][a-z0-9-]{2,63}$/.test(id)) errs.storeId = 'ID must be 3-64 characters: lowercase letters, numbers and dashes'
    if (editing === 'new' && stores.data.some((s) => s.id === id)) errs.storeId = 'A store with this ID already exists'
    if (Object.keys(errs).length || !parsed.success) {
      setErrors(errs)
      return
    }
    setSaving(true)
    setError(null)
    try {
      if (editing === 'new') await createStore(id, parsed.data)
      else await updateStore(id, parsed.data)
      toast.success('Store saved.')
      setEditing(null)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button icon={<Plus className="size-4" />} onClick={() => open('new')}>
          Add store
        </Button>
      </div>
      {stores.error && <Alert>{stores.error}</Alert>}
      {stores.loading ? (
        <Skeleton className="h-40" />
      ) : stores.data.length ? (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-slate-100">
            {stores.data.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-5 py-3">
                <StoreIcon className="size-5 shrink-0 text-brand-700" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">
                    {s.storeName} {s.demo && <Badge className="bg-amber-50 text-amber-800 ring-amber-200">Demo</Badge>}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {s.id} · {s.city}
                    {s.address && <> · {s.address}</>}
                  </p>
                </div>
                <Badge className={s.status === 'active' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : undefined}>{s.status}</Badge>
                <Button size="sm" variant="ghost" aria-label="Edit store" icon={<Pencil className="size-4" />} onClick={() => open(s)} />
                <Button size="sm" variant="ghost" aria-label="Delete store" icon={<Trash2 className="size-4" />} onClick={() => setConfirm(s)} />
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <EmptyState icon={<StoreIcon className="size-5" />} title="No stores yet" description="Add your paint stores so store managers can be assigned." />
      )}

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        busy={saving}
        title={editing === 'new' ? 'Add store' : 'Edit store'}
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>
              Cancel
            </Button>
            <Button loading={saving} onClick={save}>
              Save
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput wrapperClassName="sm:col-span-2" label="Store name" value={form.storeName} maxLength={100} onChange={(e) => setForm({ ...form, storeName: e.target.value })} error={errors.storeName} required />
          <TextInput
            label="Store ID"
            value={editing === 'new' ? form.storeId || slugify(form.storeName) : form.storeId}
            onChange={(e) => setForm({ ...form, storeId: e.target.value })}
            disabled={editing !== 'new'}
            error={errors.storeId}
            hint="Permanent. Lowercase, e.g. cat-xyz-jakarta"
          />
          <TextInput label="City" value={form.city} maxLength={80} onChange={(e) => setForm({ ...form, city: e.target.value })} error={errors.city} required />
          <TextInput wrapperClassName="sm:col-span-2" label="Address" value={form.address} maxLength={300} onChange={(e) => setForm({ ...form, address: e.target.value })} error={errors.address} />
          <SelectInput label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as 'active' | 'inactive' })} options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} />
          {error && (
            <div className="sm:col-span-2">
              <Alert>{error}</Alert>
            </div>
          )}
        </div>
      </Modal>
      <ConfirmDialog
        open={!!confirm}
        title="Delete store?"
        message={
          <>
            <strong>{confirm?.storeName}</strong> will be deleted. Store managers assigned to it lose access until reassigned. Content already created for this store stays in the database.
          </>
        }
        loading={deleting}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          if (!confirm) return
          setDeleting(true)
          try {
            await deleteStore(confirm.id)
            toast.success('Store deleted.')
            setConfirm(null)
          } catch (err) {
            toast.error(errorMessage(err))
          } finally {
            setDeleting(false)
          }
        }}
      />
    </>
  )
}
