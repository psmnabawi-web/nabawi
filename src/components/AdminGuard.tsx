'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AppShell } from './AppShell';
import { useAuth } from './AuthProvider';
import { Alert } from './ui';
import { cn } from '@/lib/utils';

const TABS = [
  { href: '/admin/stores', label: 'Store' },
  { href: '/admin/users', label: 'User' },
  { href: '/admin/indicators', label: 'Indikator' },
  { href: '/admin/logs', label: 'Audit Trail' },
];

export function AdminGuard({ children }: { children: React.ReactNode }) {
  const { profile } = useAuth();
  const pathname = usePathname();
  return (
    <AppShell>
      {profile?.role !== 'admin' ? (
        <Alert>Halaman ini hanya untuk admin.</Alert>
      ) : (
        <>
          <div className="mb-4 flex gap-2 overflow-x-auto">
            {TABS.map((t) => (
              <Link key={t.href} href={t.href} className={cn('shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold', pathname.startsWith(t.href) ? 'border-brand bg-brand text-white' : 'border-line bg-white text-ink')}>
                {t.label}
              </Link>
            ))}
          </div>
          {children}
        </>
      )}
    </AppShell>
  );
}
