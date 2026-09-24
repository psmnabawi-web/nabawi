import { useState } from 'react'
import { Outlet } from 'react-router'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../../hooks/useToast'
import { useEmulators } from '../../firebase/config'
import { errorMessage } from '../../utils/errors'
import { Button } from '../ui'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'

function VerifyEmailBanner() {
  const { user, resendVerification, refreshAccess } = useAuth()
  const toast = useToast()
  const [busy, setBusy] = useState<'resend' | 'refresh' | null>(null)
  const isPasswordUser = user?.providerData.some((p) => p.providerId === 'password')
  if (!user || user.emailVerified || !isPasswordUser) return null
  const act = async (kind: 'resend' | 'refresh') => {
    setBusy(kind)
    try {
      if (kind === 'resend') {
        await resendVerification()
        toast.success('Verification email sent.')
      } else {
        await refreshAccess()
        toast.success(user.emailVerified ? 'Email verified.' : 'Access refreshed.')
      }
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 sm:px-6">
      <span className="flex-1">Please verify your email address ({user.email}).</span>
      <Button size="sm" variant="outline" loading={busy === 'resend'} onClick={() => act('resend')}>
        Resend email
      </Button>
      <Button size="sm" variant="secondary" loading={busy === 'refresh'} onClick={() => act('refresh')}>
        I have verified
      </Button>
    </div>
  )
}

export function AppLayout() {
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <div className="min-h-dvh">
      <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
      <div className="lg:pl-64">
        <Topbar onMenu={() => setMenuOpen(true)} />
        {useEmulators && <div className="bg-brand-50 px-4 py-1 text-center text-xs text-brand-800 sm:px-6">Local emulator mode — data is not production.</div>}
        <VerifyEmailBanner />
        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
