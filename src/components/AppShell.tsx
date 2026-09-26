'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from './AuthProvider';
import { LogoMark } from './brand/Logo';
import { IconBell, IconChevron, IconClipboard, IconDashboard, IconHistory, IconList, IconLogout, IconPlus, IconStore, IconUser, IconUsers } from './icons';
import { Alert, Spinner } from './ui';
import { useAudits } from '@/lib/hooks';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: IconDashboard, roles: ['crew', 'manager', 'admin'] },
  { href: '/audits', label: 'Audit', icon: IconClipboard, roles: ['crew', 'manager', 'admin'] },
  { href: '/audits/new', label: 'Mulai Audit', icon: IconPlus, roles: ['crew', 'manager', 'admin'], primary: true },
  { href: '/admin/stores', label: 'Store', icon: IconStore, roles: ['admin'] },
  { href: '/admin/users', label: 'User & Role', icon: IconUsers, roles: ['admin'] },
  { href: '/admin/indicators', label: 'Indikator', icon: IconList, roles: ['admin'] },
  { href: '/admin/logs', label: 'Audit Trail', icon: IconHistory, roles: ['admin'] },
];
const MOBILE_NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: IconDashboard },
  { href: '/audits', label: 'Audit', icon: IconClipboard },
  { href: '/audits/new', label: 'Mulai', icon: IconPlus, primary: true },
  { href: '/admin/stores', label: 'Admin', icon: IconStore, adminOnly: true },
  { href: '/profile', label: 'Profil', icon: IconUser },
];

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]!.toUpperCase())
    .join('');
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, profile, loading, error, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const { audits } = useAudits(profile, 'all');
  const drafts = audits.filter((a) => a.status === 'draft').length;

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
  const isActive = (href: string) =>
    href === '/audits' ? pathname === '/audits' || /^\/audits\/(?!new)/.test(pathname) : href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(href);
  const roleLabel = role === 'admin' ? 'Admin' : role === 'manager' ? 'Manager Store' : 'Crew';

  return (
    <div className="flex min-h-screen bg-surface">
      {/* ===== Sidebar (desktop) ===== */}
      <aside className={cn('sticky top-0 hidden h-screen shrink-0 flex-col border-r border-line/70 bg-white transition-[width] md:flex', collapsed ? 'w-[76px]' : 'w-64')}>
        <div className="flex items-center justify-between gap-2 px-4 py-4">
          <Link href="/dashboard" className="flex min-w-0 items-center gap-3">
            <LogoMark size={40} />
            {!collapsed && (
              <div className="min-w-0 leading-tight">
                <div className="truncate text-base font-black text-ink">Almaz</div>
                <div className="truncate text-xs text-muted">Store Cleanliness</div>
              </div>
            )}
          </Link>
          <button type="button" onClick={() => setCollapsed((c) => !c)} className="rounded-lg p-1.5 text-muted hover:bg-surface-2" aria-label={collapsed ? 'Perlebar menu' : 'Persempit menu'}>
            <IconChevron size={18} className={cn('transition-transform', !collapsed && 'rotate-180')} />
          </button>
        </div>

        {!collapsed && (
          <Link href="/profile" className="mx-4 mb-4 flex items-center gap-3 rounded-2xl border border-line/70 p-3 hover:bg-surface">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand to-[#F9A57A] text-white">
              <IconStore size={22} />
            </span>
            <div className="min-w-0">
              <div className="text-[11px] text-muted">{role === 'admin' ? 'Cakupan' : 'My Store'}</div>
              <div className="truncate text-sm font-bold text-ink">{profile?.storeName?.replace(/^Almaz Fried Chicken\s*-\s*/i, '') ?? (role === 'admin' ? 'Semua store' : 'Belum dipilih')}</div>
            </div>
            <IconChevron size={16} className="ml-auto shrink-0 rotate-90 text-muted" />
          </Link>
        )}

        <nav className="flex-1 space-y-1 px-3">
          {!collapsed && <div className="px-2 pb-1 pt-1 text-[11px] font-bold uppercase tracking-wider text-muted">Main Menu</div>}
          {nav.map((n) => {
            const Icon = n.icon;
            const active = isActive(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                title={n.label}
                className={cn(
                  'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors',
                  active ? 'border border-brand/30 bg-brand/10 text-brand' : n.primary ? 'text-brand hover:bg-brand/10' : 'text-ink hover:bg-surface',
                  collapsed && 'justify-center px-0',
                )}
              >
                <Icon size={20} />
                {!collapsed && <span className="truncate">{n.label}</span>}
              </Link>
            );
          })}
        </nav>

        <div className="space-y-1 border-t border-line/70 px-3 py-3">
          <Link href="/profile" title="Profil" className={cn('flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-ink hover:bg-surface', collapsed && 'justify-center px-0', isActive('/profile') && 'bg-brand/10 text-brand')}>
            <IconUser size={20} />
            {!collapsed && 'Profil & Pengaturan'}
          </Link>
          <button type="button" onClick={logout} className={cn('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-danger hover:bg-red-50', collapsed && 'justify-center px-0')}>
            <IconLogout size={20} />
            {!collapsed && 'Logout'}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* ===== Top bar ===== */}
        <header className="sticky top-0 z-30 border-b border-line/70 bg-white/90 backdrop-blur">
          <div className="flex h-16 items-center justify-between gap-3 px-4 md:px-8">
            <Link href="/dashboard" className="flex items-center gap-2 md:hidden">
              <LogoMark size={34} />
              <div className="leading-tight">
                <div className="text-sm font-black text-ink">Almaz Cleanliness</div>
                <div className="text-[11px] text-muted">{profile?.storeName?.replace(/^Almaz Fried Chicken\s*-\s*/i, '') ?? (role === 'admin' ? 'Semua store' : 'Store belum dipilih')}</div>
              </div>
            </Link>
            <div className="hidden text-sm text-muted md:block" />
            <div className="flex items-center gap-2">
              <Link href="/audits?status=draft" className="relative rounded-xl p-2 text-ink hover:bg-surface" aria-label="Audit draft" title="Audit draft belum selesai">
                <IconBell size={22} />
                {drafts > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold text-white">{drafts}</span>}
              </Link>
              <Link href="/profile" className="flex items-center gap-2 rounded-xl py-1 pl-1 pr-2 hover:bg-surface">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-brand to-[#F9A57A] text-xs font-black text-white">{initials(profile?.name ?? '?')}</span>
                <span className="hidden leading-tight sm:block">
                  <span className="block max-w-[140px] truncate text-sm font-semibold text-ink">{profile?.name}</span>
                  <span className="block text-[11px] text-muted">{roleLabel}</span>
                </span>
              </Link>
            </div>
          </div>
        </header>

        {profile && !profile.storeId && role !== 'admin' && pathname !== '/profile' && (
          <div className="px-4 pt-4 md:px-8">
            <Alert kind="warning">
              Store belum dipilih.{' '}
              <Link href="/profile" className="font-semibold underline">
                Pilih store Anda
              </Link>{' '}
              sebelum memulai audit.
            </Alert>
          </div>
        )}

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-24 pt-5 md:px-8 md:pb-10 md:pt-8">{children}</main>

        {/* ===== Bottom nav (mobile) ===== */}
        <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white md:hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
          <div className="flex items-stretch justify-around">
            {MOBILE_NAV.filter((n) => !n.adminOnly || role === 'admin').map((n) => {
              const Icon = n.icon;
              const active = isActive(n.href) || (n.href === '/admin/stores' && pathname.startsWith('/admin'));
              return (
                <Link key={n.href} href={n.href} className={cn('flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-semibold', active || n.primary ? 'text-brand' : 'text-muted')}>
                  <span className={cn('flex h-8 w-8 items-center justify-center rounded-full', n.primary && 'bg-brand text-white shadow')}>
                    <Icon size={20} />
                  </span>
                  {n.label}
                </Link>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}
