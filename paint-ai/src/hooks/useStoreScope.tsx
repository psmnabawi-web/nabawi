import { doc, getDoc } from 'firebase/firestore'
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { db } from '../firebase/config'
import { isContentManager, storesQuery } from '../services/firestore'
import type { Store } from '../types'
import { useAuth } from './useAuth'
import { useCollection } from './useFirestore'

interface StoreScopeValue {
  /** '' = all stores (content managers); 'ALL' = brand-wide only; otherwise a storeId. */
  selectedStoreId: string
  setSelectedStoreId: (id: string) => void
  stores: Store[]
  storesLoading: boolean
  /** Human label for a storeId (incl. 'ALL'). */
  storeName: (id: string | null | undefined) => string
  /** Default storeId for new content created from the current view. */
  defaultScope: string
}

const StoreScopeContext = createContext<StoreScopeValue | null>(null)
const STORAGE_KEY = 'paint-ai.selectedStore'

function readStored() {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

export function StoreScopeProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const manager = isContentManager(profile)
  const [selected, setSelected] = useState<string>(readStored)
  const all = useCollection<Store>(() => (manager ? storesQuery() : null), [manager])
  const [ownStore, setOwnStore] = useState<Store | null>(null)

  useEffect(() => {
    if (profile?.role !== 'store_manager' || !profile.storeId) return
    getDoc(doc(db, 'stores', profile.storeId))
      .then((snap) => setOwnStore(snap.exists() ? ({ ...(snap.data() as Store), id: snap.id } as Store) : null))
      .catch(() => setOwnStore(null))
  }, [profile?.role, profile?.storeId])

  const value = useMemo<StoreScopeValue>(() => {
    const assigned = profile?.role === 'store_manager' && ownStore && ownStore.id === profile.storeId ? ownStore : null
    const stores = manager ? all.data : assigned ? [assigned] : []
    const effective = profile?.role === 'store_manager' ? (profile.storeId ?? '') : selected
    return {
      selectedStoreId: effective,
      setSelectedStoreId: (id) => {
        setSelected(id)
        try {
          localStorage.setItem(STORAGE_KEY, id)
        } catch {
          /* private mode */
        }
      },
      stores,
      storesLoading: manager ? all.loading : false,
      storeName: (id) => {
        if (!id || id === 'ALL') return 'All stores (brand-wide)'
        return stores.find((s) => s.id === id)?.storeName ?? id
      },
      defaultScope: effective || 'ALL',
    }
  }, [manager, all.data, all.loading, ownStore, profile?.role, profile?.storeId, selected])

  return <StoreScopeContext.Provider value={value}>{children}</StoreScopeContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useStoreScope() {
  const ctx = useContext(StoreScopeContext)
  if (!ctx) throw new Error('useStoreScope must be used inside <StoreScopeProvider>')
  return ctx
}
