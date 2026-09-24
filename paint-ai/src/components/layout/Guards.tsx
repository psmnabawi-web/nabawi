import { Clock, LogOut, ShieldAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { useAuth } from '../../hooks/useAuth'
import type { Role } from '../../types'
import { Button, PageLoader } from '../ui'

function FullScreenMessage({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  const { signOut } = useAuth()
  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-50 p-4">
      <div className="card w-full max-w-md p-8 text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-brand-50 text-brand-800">{icon}</div>
        <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
        <div className="mt-2 text-sm text-slate-600">{children}</div>
        <Button variant="outline" className="mt-6" icon={<LogOut className="size-4" />} onClick={() => signOut()}>
          Sign out
        </Button>
      </div>
    </div>
  )
}

/** Requires a signed-in, active user with a usable profile. */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, profile, loading, profileError, refreshAccess } = useAuth()
  const location = useLocation()

  if (loading) return <PageLoader label="Loading your workspace…" />
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (!profile) {
    return (
      <FullScreenMessage icon={<ShieldAlert className="size-6" />} title="Profile unavailable">
        <p>{profileError ?? 'We could not load your profile.'}</p>
        <Button className="mt-4" onClick={() => refreshAccess().catch(() => undefined)}>
          Try again
        </Button>
      </FullScreenMessage>
    )
  }
  if (profile.active === false) {
    return (
      <FullScreenMessage icon={<ShieldAlert className="size-6" />} title="Account disabled">
        Your account has been disabled. Contact your administrator.
      </FullScreenMessage>
    )
  }
  if (profile.role === 'store_manager' && !profile.storeId) {
    return (
      <FullScreenMessage icon={<Clock className="size-6" />} title="Waiting for access">
        <p>
          Your account (<strong>{profile.email}</strong>) is registered. A super admin needs to assign your role and store before you can use the platform.
        </p>
        <Button variant="secondary" className="mt-4" onClick={() => refreshAccess().catch(() => undefined)}>
          Check again
        </Button>
      </FullScreenMessage>
    )
  }
  return <>{children}</>
}

/** Renders children only for the given roles (UI convenience — security is enforced by rules/functions). */
export function RoleGate({ roles, children, fallback = null }: { roles: Role[]; children: ReactNode; fallback?: ReactNode }) {
  const { profile } = useAuth()
  return profile && roles.includes(profile.role) ? <>{children}</> : <>{fallback}</>
}
