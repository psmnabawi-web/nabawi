import { useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useStoreScope } from '../../hooks/useStoreScope'
import { useToast } from '../../hooks/useToast'
import { updateOwnName } from '../../services/firestore'
import { ROLE_LABELS } from '../../utils/constants'
import { errorMessage } from '../../utils/errors'
import { formatDateTime } from '../../utils/format'
import { Button, Card, CardBody, CardHeader, TextInput } from '../ui'

export function ProfileTab() {
  const { profile, user, resetPassword } = useAuth()
  const { storeName } = useStoreScope()
  const toast = useToast()
  const [name, setName] = useState(profile?.name ?? '')
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  if (!profile) return null
  const hasPassword = user?.providerData.some((p) => p.providerId === 'password')

  const save = async () => {
    if (name.trim().length < 2) {
      toast.error('Name must be at least 2 characters.')
      return
    }
    setSaving(true)
    try {
      await updateOwnName(name)
      toast.success('Profile updated.')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="Your profile" />
        <CardBody className="space-y-4">
          <TextInput label="Full name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          <TextInput label="Email" value={profile.email} disabled />
          <div className="flex justify-end">
            <Button loading={saving} onClick={save} disabled={name.trim() === profile.name}>
              Save
            </Button>
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Access" />
        <CardBody>
          <dl className="grid grid-cols-[120px_1fr] gap-y-2 text-sm">
            <dt className="text-slate-500">Role</dt>
            <dd className="font-medium text-slate-900">{ROLE_LABELS[profile.role]}</dd>
            <dt className="text-slate-500">Store</dt>
            <dd className="text-slate-900">{profile.role === 'store_manager' ? storeName(profile.storeId) : 'All stores'}</dd>
            <dt className="text-slate-500">Member since</dt>
            <dd className="text-slate-900">{formatDateTime(profile.createdAt)}</dd>
          </dl>
          {hasPassword && (
            <Button
              variant="outline"
              className="mt-5"
              loading={sending}
              onClick={async () => {
                setSending(true)
                try {
                  await resetPassword(profile.email)
                  toast.success('Password reset email sent.')
                } catch (err) {
                  toast.error(errorMessage(err))
                } finally {
                  setSending(false)
                }
              }}
            >
              Send password reset email
            </Button>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
