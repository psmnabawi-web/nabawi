'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from './AuthProvider';
import { Alert, Spinner } from './ui';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: '▦', roles: ['crew', 'manager', 'admin'] },
  { href: '/audits', label: 'Audit', icon: '☑', roles: ['crew', 'manager', 'admin'] },
  { href: '/audits/new', label: 'Mulai', icon: '＋', roles: ['crew', 'manager', 'admin'], primary: true },
  { href: '/admin', label: 'Admin', icon: '⚙', roles: ['admin'] },
  { href: '/profile', label: 'Profil', icon: '◉', roles: ['crew', 'manager', 'admin'] },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, profile, loading, error, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [loading, user, router, pathname]);

  if (loading || (!user && !error)) {
    return (
      <div className="flex min-h-screen items-center justify-center text-brand">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }
  if (error && !profile) {
    return (
      <div className="mx-auto max-w-md p-6">
        <Alert kind="error">{error}</Alert>
        <button onClick={logout} className="mt-4 text-sm font-semibold text-brand underline">
          Kembali ke login
        </button>
      </div>
    );
  }
  const role = profile?.role ?? 'crew';
  const nav = NAV.filter((n) => n.roles.includes(role));
  const isActive = (href: string) => (href === '/audits' ? pathname === '/audits' || /^\/audits\/(?!new)/.test(pathname) : pathname.startsWith(href));

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <header className="sticky top-0 z-30 border-b border-line bg-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link href="/dashboard" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-sm font-black text-white">SC</span>
            <div className="leading-tight">
              <div className="text-sm font-bold text-ink">Store Cleanliness</div>
              <div className="text-[11px] text-muted">{profile?.storeName ?? (role === 'admin' ? 'Semua store' : 'Store belum dipilih')}</div>
            </div>
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {nav.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={cn(
                  'rounded-lg px-3 py-2 text-sm font-semibold',
                  n.primary ? 'bg-brand text-white hover:bg-brand-dark' : isActive(n.href) ? 'bg-brand/10 text-brand' : 'text-ink hover:bg-surface-2',
                )}
              >
                {n.label}
              </Link>
            ))}
            <button onClick={logout} className="ml-2 rounded-lg px-3 py-2 text-sm font-semibold text-muted hover:bg-surface-2">
              Keluar
            </button>
          </nav>
          <div className="text-right text-xs md:hidden">
            <div className="font-semibold text-ink">{profile?.name}</div>
            <div className="capitalize text-muted">{role}</div>
          </div>
        </div>
      </header>

      {profile && !profile.storeId && role !== 'admin' && pathname !== '/profile' && (
        <div className="mx-auto w-full max-w-6xl px-4 pt-3">
          <Alert kind="warning">
            Store belum dipilih.{' '}
            <Link href="/profile" className="font-semibold underline">
              Pilih store Anda
            </Link>{' '}
            sebelum memulai audit.
          </Alert>
        </div>
      )}

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-24 pt-4 md:pb-8">{children}</main>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white md:hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="mx-auto flex max-w-6xl items-stretch justify-around">
          {nav.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={cn(
                'flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-semibold',
                n.primary ? 'text-brand' : isActive(n.href) ? 'text-brand' : 'text-muted',
              )}
            >
              <span className={cn('flex h-7 w-7 items-center justify-center rounded-full text-base', n.primary && 'bg-brand text-white')}>{n.icon}</span>
              {n.label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
