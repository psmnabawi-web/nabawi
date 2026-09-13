'use client';

import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/api-client';
import { firebaseAuth } from '@/lib/firebase/client';
import type { UserProfile } from '@/lib/types';

interface AuthState {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  error: string | null;
  refreshProfile: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const loadProfile = useCallback(async () => {
    try {
      const { profile } = await apiFetch<{ profile: UserProfile }>('/api/me');
      setProfile(profile);
      setError(null);
    } catch (e) {
      setProfile(null);
      setError(e instanceof Error ? e.message : 'Gagal memuat profil.');
    }
  }, []);

  useEffect(() => {
    let unsub = () => {};
    try {
      unsub = onAuthStateChanged(firebaseAuth(), async (u) => {
        setUser(u);
        if (u) await loadProfile();
        else setProfile(null);
        setLoading(false);
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Firebase belum dikonfigurasi.';
      queueMicrotask(() => {
        setError(message);
        setLoading(false);
      });
    }
    return () => unsub();
  }, [loadProfile]);

  const logout = useCallback(async () => {
    await signOut(firebaseAuth());
    setProfile(null);
    router.replace('/login');
  }, [router]);

  const value = useMemo<AuthState>(
    () => ({ user, profile, loading, error, refreshProfile: loadProfile, logout }),
    [user, profile, loading, error, loadProfile, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth harus dipakai di dalam AuthProvider');
  return ctx;
}
