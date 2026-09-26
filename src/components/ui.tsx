'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
};

const variants = {
  primary: 'bg-brand text-white hover:bg-brand-dark disabled:bg-brand/50 shadow-sm',
  secondary: 'bg-white text-ink border border-line hover:bg-surface-2 disabled:text-muted',
  danger: 'bg-danger text-white hover:bg-red-700 disabled:bg-danger/50',
  ghost: 'bg-transparent text-brand hover:bg-brand/10',
};
const sizes = { sm: 'h-9 px-3.5 text-sm', md: 'h-11 px-5 text-sm', lg: 'h-12 px-6 text-base' };

export function Button({ variant = 'primary', size = 'md', loading, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      className={cn('inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors disabled:cursor-not-allowed', variants[variant], sizes[size], className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
}

export function LinkButton({
  href,
  variant = 'primary',
  size = 'md',
  className,
  children,
}: {
  href: string;
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className={cn('inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors', variants[variant], sizes[size], className)}>
      {children}
    </Link>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn('animate-spin', className ?? 'h-5 w-5')} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
      <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" className="opacity-90" />
    </svg>
  );
}

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('rounded-2xl border border-line/60 bg-white p-5 shadow-[0_1px_2px_rgba(16,16,16,0.04),0_8px_24px_-12px_rgba(16,16,16,0.12)]', className)}>{children}</div>;
}

/** Judul kartu gaya dashboard: judul tebal + deskripsi kecil + slot kanan. */
export function CardHeader({ title, desc, right }: { title: string; desc?: string; right?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <h2 className="text-lg font-bold text-ink">{title}</h2>
        {desc && <p className="mt-0.5 text-sm text-muted">{desc}</p>}
      </div>
      {right}
    </div>
  );
}

export function Label({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">
      {children}
    </label>
  );
}

const fieldCls =
  'w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:bg-surface-2';

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(fieldCls, props.className)} />;
}
export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn(fieldCls, props.className)} />;
}
export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(fieldCls, 'min-h-20', props.className)} />;
}

export function Alert({ kind = 'error', children, className }: { kind?: 'error' | 'success' | 'info' | 'warning'; children: React.ReactNode; className?: string }) {
  const styles = {
    error: 'border-danger/30 bg-red-50 text-red-800',
    success: 'border-good/30 bg-green-50 text-green-800',
    info: 'border-brand/30 bg-orange-50 text-orange-950',
    warning: 'border-warn/40 bg-amber-50 text-amber-900',
  };
  return (
    <div role="alert" className={cn('rounded-xl border px-3.5 py-2.5 text-sm', styles[kind], className)}>
      {children}
    </div>
  );
}

export function Badge({ children, color, className }: { children: React.ReactNode; color?: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold', className)} style={color ? { backgroundColor: `${color}1a`, color } : undefined}>
      {children}
    </span>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted sm:text-base">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, desc, action }: { title: string; desc?: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-white p-8 text-center">
      <p className="font-semibold text-ink">{title}</p>
      {desc && <p className="mt-1 text-sm text-muted">{desc}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Modal({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:max-w-lg sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-ink">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-muted hover:bg-surface-2" aria-label="Tutup">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Kartu KPI: ikon dalam lingkaran berwarna, angka besar, label, keterangan. */
export function StatCard({ icon, value, label, sub, tint = '#F26522', href, className }: { icon: React.ReactNode; value: React.ReactNode; label: string; sub?: React.ReactNode; tint?: string; href?: string; className?: string }) {
  return (
    <Card className={cn('flex items-start gap-4', className)}>
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl" style={{ backgroundColor: `${tint}1a`, color: tint }}>
        {icon}
      </span>
      <div className="min-w-0">
        <div className="text-3xl font-black leading-none text-ink">{value}</div>
        <div className="mt-1.5 font-semibold text-ink">{label}</div>
        {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
        {href && (
          <Link href={href} className="mt-1 inline-block text-xs font-semibold text-brand hover:underline">
            Lihat detail →
          </Link>
        )}
      </div>
    </Card>
  );
}
