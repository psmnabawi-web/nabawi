import { Plus, UserRound } from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useCollection } from '../../hooks/useFirestore'
import { useStoreScope } from '../../hooks/useStoreScope'
import { useToast } from '../../hooks/useToast'
import { usersQuery } from '../../services/firestore'
import { manageUser } from '../../services/functions'
import type { Role, UserProfile } from '../../types'
import { ROLE_LABELS } from '../../utils/constants'
import { errorMessage } from '../../utils/errors'
import { timeAgo } from '../../utils/format'
import { fieldErrors, newUserSchema } from '../../utils/validation'
import { Alert, Badge, Button, Card, Modal, SelectInput, Skeleton, TextInput } from '../ui'

const ROLE_OPTIONS = (Object.keys(ROLE_LABELS) as Role[]).map((r) => ({ value: r, label: ROLE_LABELS[r] }))

export function UsersTab() {
  const { profile: me } = useAuth()
  const { stores, storeName } = useStoreScope()
  const users = useCollection<UserProfile & { id: string }>(() => usersQuery(), [])
  const toast = useToast()
  const [busyUid, setBusyUid] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'marketing_manager' as Role, storeId: null as string | null })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const storeOptions = [{ value: '', label: '— Not assigned —' }, ...stores.map((s) => ({ value: s.id, label: s.storeName }))]

  const update = async (u: UserProfile, patch: { role?: Role; storeId?: string | null; active?: boolean }) => {
    setBusyUid(u.uid)
    try {
      await manageUser({ action: 'update', uid: u.uid, ...patch })
      toast.success(`${u.name} updated.`)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusyUid(null)
    }
  }

  const create = async () => {
    const parsed = newUserSchema.safeParse(form)
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error))
      return
    }
    setErrors({})
    setCreating(true)
    setCreateError(null)
    try {
      await manageUser({ action: 'create', ...parsed.data, storeId: parsed.data.role === 'store_manager' ? parsed.data.storeId : null })
      toast.success('User created. Share the temporary password securely.')
      setCreateOpen(false)
      setForm({ name: '', email: '', password: '', role: 'marketing_manager', storeId: null })
    } catch (err) {
      setCreateError(errorMessage(err))
    } finally {
      setCreating(false)
    }
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-500">New sign-ups start as Store Manager without a store. Assign role and store here.</p>
        <Button icon={<Plus className="size-4" />} onClick={() => setCreateOpen(true)}>
          Create user
        </Button>
      </div>
      {users.error && <Alert>{users.error}</Alert>}
      {users.loading ? (
        <Skeleton className="h-48" />
      ) : (
        <Card className="overflow-hidden">
          <div className="scrollbar-thin overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-5 py-2.5 font-medium">User</th>
                  <th className="px-3 py-2.5 font-medium">Role</th>
                  <th className="px-3 py-2.5 font-medium">Store</th>
                  <th className="px-3 py-2.5 font-medium">Last login</th>
                  <th className="px-5 py-2.5 text-right font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.data.map((u) => {
                  const self = u.uid === me?.uid
                  const busy = busyUid === u.uid
                  return (
                    <tr key={u.uid} className={u.active === false ? 'bg-slate-50 text-slate-400' : ''}>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <UserRound className="size-4 shrink-0 text-slate-400" aria-hidden />
                          <div className="min-w-0">
                            <p className="truncate font-medium text-slate-900">
                              {u.name} {self && <Badge>You</Badge>}
                            </p>
                            <p className="truncate text-xs text-slate-500">{u.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <select className="input py-1.5" value={u.role} disabled={busy || self} onChange={(e) => update(u, { role: e.target.value as Role })} aria-label={`Role of ${u.name}`}>
                          {ROLE_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-3">
                        {u.role === 'store_manager' ? (
                          <select className="input py-1.5" value={u.storeId ?? ''} disabled={busy} onChange={(e) => update(u, { storeId: e.target.value || null })} aria-label={`Store of ${u.name}`}>
                            {storeOptions.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-xs text-slate-500">All stores</span>
                        )}
                        {u.role === 'store_manager' && u.storeId && !stores.some((s) => s.id === u.storeId) && <p className="mt-1 text-xs text-rose-600">Store “{storeName(u.storeId)}” no longer exists</p>}
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-500">{u.lastLoginAt ? timeAgo(u.lastLoginAt) : '—'}</td>
                      <td className="px-5 py-3 text-right">
                        <Button size="sm" variant={u.active === false ? 'secondary' : 'ghost'} disabled={self} loading={busy} onClick={() => update(u, { active: u.active === false })}>
                          {u.active === false ? 'Activate' : 'Deactivate'}
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        busy={creating}
        title="Create user"
        description="The user can change the password later via “Forgot password”."
        footer={
          <>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button loading={creating} onClick={create}>
              Create
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput label="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={errors.name} required />
          <TextInput label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} error={errors.email} required />
          <TextInput label="Temporary password" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} error={errors.password} required />
          <SelectInput label="Role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })} options={ROLE_OPTIONS} />
          {form.role === 'store_manager' && (
            <SelectInput wrapperClassName="sm:col-span-2" label="Store" value={form.storeId ?? ''} onChange={(e) => setForm({ ...form, storeId: e.target.value || null })} error={errors.storeId} options={storeOptions} />
          )}
          {createError && (
            <div className="sm:col-span-2">
              <Alert>{createError}</Alert>
            </div>
          )}
        </div>
      </Modal>
    </>
  )
}
