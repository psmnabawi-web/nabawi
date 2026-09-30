'use client';

import { AppShell } from './AppShell';
import { useAuth } from './AuthProvider';
import { Alert } from './ui';
import { isSuperAdmin } from '@/lib/types';

/** Pembungkus halaman Audit Kualitas Produk: hanya super admin (email di ADMIN_EMAILS). */
export function SuperAdminGuard({ children }: { children: React.ReactNode }) {
  const { profile } = useAuth();
  return <AppShell>{isSuperAdmin(profile) ? children : <Alert>Halaman ini hanya untuk super admin.</Alert>}</AppShell>;
}
