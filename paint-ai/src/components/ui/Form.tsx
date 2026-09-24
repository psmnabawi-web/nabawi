import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { cn } from '../../utils/cn'

interface FieldProps {
  label: string
  error?: string
  hint?: ReactNode
  required?: boolean
  className?: string
  children: (id: string, describedBy: string | undefined) => ReactNode
}

export function Field({ label, error, hint, required, className, children }: FieldProps) {
  const id = useId()
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined
  return (
    <div className={className}>
      <label htmlFor={id} className="label">
        {label}
        {required && <span className="ml-0.5 text-rose-600">*</span>}
      </label>
      {children(id, describedBy)}
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-xs text-rose-600">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1 text-xs text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

type Base = { label: string; error?: string; hint?: ReactNode; wrapperClassName?: string }

export function TextInput({ label, error, hint, wrapperClassName, className, required, ...rest }: Base & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Field label={label} error={error} hint={hint} required={required} className={wrapperClassName}>
      {(id, describedBy) => <input id={id} aria-invalid={!!error} aria-describedby={describedBy} required={required} className={cn('input', error && 'border-rose-400', className)} {...rest} />}
    </Field>
  )
}

export function TextArea({ label, error, hint, wrapperClassName, className, required, ...rest }: Base & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <Field label={label} error={error} hint={hint} required={required} className={wrapperClassName}>
      {(id, describedBy) => <textarea id={id} aria-invalid={!!error} aria-describedby={describedBy} required={required} className={cn('input min-h-[88px] resize-y', error && 'border-rose-400', className)} {...rest} />}
    </Field>
  )
}

export function SelectInput({
  label,
  error,
  hint,
  wrapperClassName,
  className,
  options,
  required,
  ...rest
}: Base & SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string | number; label: string; disabled?: boolean }[] }) {
  return (
    <Field label={label} error={error} hint={hint} required={required} className={wrapperClassName}>
      {(id, describedBy) => (
        <select id={id} aria-invalid={!!error} aria-describedby={describedBy} required={required} className={cn('input pr-8', error && 'border-rose-400', className)} {...rest}>
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  )
}

/** Segmented control for small option sets (duration, style...). */
export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string
  value: T
  options: { value: T; label: string; disabled?: boolean }[]
  onChange: (v: T) => void
  disabled?: boolean
}) {
  return (
    <fieldset>
      <legend className="label">{label}</legend>
      <div className="inline-flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            disabled={disabled || o.disabled}
            onClick={() => onChange(o.value)}
            aria-pressed={value === o.value}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
              value === o.value ? 'bg-white text-brand-900 shadow-sm' : 'text-slate-600 hover:text-slate-900',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

/** Accessible on/off switch with a label and optional description. */
export function Switch({ label, description, checked, onChange, disabled }: { label: string; description?: ReactNode; checked: boolean; onChange: (next: boolean) => void; disabled?: boolean }) {
  const id = useId()
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium text-slate-900">
          {label}
        </label>
        {description && (
          <p id={`${id}-desc`} className="mt-0.5 text-xs text-slate-500">
            {description}
          </p>
        )}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={description ? `${id}-desc` : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn('relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-50', checked ? 'bg-brand-800' : 'bg-slate-300')}
      >
        <span className={cn('inline-block size-5 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-5.5' : 'translate-x-0.5')} />
      </button>
    </div>
  )
}
