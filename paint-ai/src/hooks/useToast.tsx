import { CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { cn } from '../utils/cn'

type ToastKind = 'success' | 'error' | 'info'
interface Toast {
  id: number
  kind: ToastKind
  message: string
}
interface ToastValue {
  toast: (message: string, kind?: ToastKind) => void
  success: (message: string) => void
  error: (message: string) => void
}

const ToastContext = createContext<ToastValue | null>(null)
let nextId = 1

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), [])
  const toast = useCallback(
    (message: string, kind: ToastKind = 'info') => {
      const id = nextId++
      setToasts((t) => [...t.slice(-3), { id, kind, message }])
      setTimeout(() => dismiss(id), kind === 'error' ? 8000 : 4500)
    },
    [dismiss],
  )
  const value = useMemo(() => ({ toast, success: (m: string) => toast(m, 'success'), error: (m: string) => toast(m, 'error') }), [toast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-6">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            className={cn(
              'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border bg-white px-4 py-3 text-sm shadow-lg',
              t.kind === 'success' && 'border-emerald-200',
              t.kind === 'error' && 'border-rose-200',
              t.kind === 'info' && 'border-slate-200',
            )}
          >
            {t.kind === 'success' && <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />}
            {t.kind === 'error' && <XCircle className="mt-0.5 size-4 shrink-0 text-rose-600" aria-hidden />}
            {t.kind === 'info' && <Info className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden />}
            <p className="flex-1 text-slate-800">{t.message}</p>
            <button type="button" onClick={() => dismiss(t.id)} className="text-slate-400 hover:text-slate-600" aria-label="Dismiss">
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}
