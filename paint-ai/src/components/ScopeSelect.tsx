import { useStoreScope } from '../hooks/useStoreScope'
import { SelectInput } from './ui'

/** Store scope for new documents: brand-wide ('ALL') or one store. */
export function ScopeSelect({ value, onChange, error, label = 'Store scope' }: { value: string; onChange: (v: string) => void; error?: string; label?: string }) {
  const { stores } = useStoreScope()
  return (
    <SelectInput
      label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      error={error}
      hint="Brand-wide items are visible to every store manager."
      options={[{ value: 'ALL', label: 'All stores (brand-wide)' }, ...stores.filter((s) => s.status === 'active' || s.id === value).map((s) => ({ value: s.id, label: s.storeName }))]}
    />
  )
}
