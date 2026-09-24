import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut as fbSignOut,
  updateProfile,
  type User,
} from 'firebase/auth'
import { doc, onSnapshot } from 'firebase/firestore'
import { FirebaseError } from 'firebase/app'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { auth, db, googleProvider } from '../firebase/config'
import { bootstrapProfile } from '../services/functions'
import type { UserProfile } from '../types'
import { errorMessage } from '../utils/errors'

interface AuthContextValue {
  user: User | null
  profile: UserProfile | null
  loading: boolean
  profileError: string | null
  signIn: (email: string, password: string) => Promise<void>
  signUp: (name: string, email: string, password: string) => Promise<void>
  signInWithGoogle: () => Promise<void>
  resetPassword: (email: string) => Promise<void>
  resendVerification: () => Promise<void>
  refreshAccess: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const pendingName = useRef<string | undefined>(undefined)

  const ensureProfile = useCallback(async () => {
    try {
      setProfileError(null)
      await bootstrapProfile(pendingName.current ? { name: pendingName.current } : {})
      pendingName.current = undefined
    } catch (err) {
      setProfileError(errorMessage(err, 'Could not load your profile. Please try again.'))
      throw err
    }
  }, [])

  useEffect(() => {
    let unsubProfile: (() => void) | undefined
    const unsubAuth = onAuthStateChanged(auth, (u) => {
      unsubProfile?.()
      unsubProfile = undefined
      setUser(u)
      setProfile(null)
      setAuthLoading(false)
      if (!u) {
        setProfileLoading(false)
        return
      }
      setProfileLoading(true)
      ensureProfile()
        .catch(() => undefined)
        .finally(() => {
          unsubProfile = onSnapshot(
            doc(db, 'users', u.uid),
            (snap) => {
              setProfile(snap.exists() ? ({ ...(snap.data() as UserProfile), uid: snap.id } as UserProfile) : null)
              setProfileLoading(false)
            },
            (err) => {
              setProfileError(errorMessage(err))
              setProfileLoading(false)
            },
          )
        })
    })
    return () => {
      unsubProfile?.()
      unsubAuth()
    }
  }, [ensureProfile])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      profile,
      loading: authLoading || profileLoading,
      profileError,
      signIn: async (email, password) => {
        await signInWithEmailAndPassword(auth, email.trim(), password)
      },
      signUp: async (name, email, password) => {
        pendingName.current = name.trim()
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password)
        await updateProfile(cred.user, { displayName: name.trim() })
        await sendEmailVerification(cred.user).catch(() => undefined)
      },
      signInWithGoogle: async () => {
        try {
          await signInWithPopup(auth, googleProvider)
        } catch (err) {
          if (err instanceof FirebaseError && err.code === 'auth/popup-blocked') {
            await signInWithRedirect(auth, googleProvider)
            return
          }
          throw err
        }
      },
      resetPassword: async (email) => {
        await sendPasswordResetEmail(auth, email.trim())
      },
      resendVerification: async () => {
        if (auth.currentUser) await sendEmailVerification(auth.currentUser)
      },
      /** After verifying email or being granted a role: refresh token claims + profile. */
      refreshAccess: async () => {
        if (!auth.currentUser) return
        await auth.currentUser.reload()
        await auth.currentUser.getIdToken(true)
        setUser(auth.currentUser)
        await ensureProfile()
      },
      signOut: () => fbSignOut(auth),
    }),
    [user, profile, authLoading, profileLoading, profileError, ensureProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
