import { doc, onSnapshot, type DocumentData, type Query } from 'firebase/firestore'
import { useEffect, useMemo, useState } from 'react'
import { db } from '../firebase/config'
import { errorMessage } from '../utils/errors'

interface ListState<T> {
  data: T[]
  loading: boolean
  error: string | null
}

/**
 * Realtime query subscription. `build` returns null to skip (e.g. while the profile loads).
 * The query is rebuilt only when `deps` change; `loading` is derived from whether the latest
 * snapshot belongs to the current query.
 */
export function useCollection<T extends { id: string }>(build: () => Query<DocumentData> | null, deps: unknown[]): ListState<T> {
  // oxlint-disable-next-line react/use-memo, react-hooks/exhaustive-deps -- callers pass the values `build` closes over in `deps`
  const q = useMemo(build, deps)
  const [snapshot, setSnapshot] = useState<{ q: Query<DocumentData> | null; data: T[]; error: string | null }>({ q: null, data: [], error: null })

  useEffect(() => {
    if (!q) return
    return onSnapshot(
      q,
      (snap) => setSnapshot({ q, data: snap.docs.map((d) => ({ ...(d.data() as Omit<T, 'id'>), id: d.id }) as T), error: null }),
      (err) => setSnapshot({ q, data: [], error: errorMessage(err, 'Could not load data.') }),
    )
  }, [q])

  if (!q) return { data: [], loading: false, error: null }
  if (snapshot.q !== q) return { data: [], loading: true, error: null }
  return { data: snapshot.data, loading: false, error: snapshot.error }
}

interface DocState<T> {
  data: T | null
  loading: boolean
  error: string | null
  exists: boolean
}

export function useDocument<T>(path: string | null): DocState<T> {
  const [snapshot, setSnapshot] = useState<{ path: string | null; data: T | null; error: string | null; exists: boolean }>({ path: null, data: null, error: null, exists: false })
  useEffect(() => {
    if (!path) return
    return onSnapshot(
      doc(db, path),
      (snap) => setSnapshot({ path, data: snap.exists() ? ({ ...(snap.data() as T), id: snap.id } as T) : null, error: null, exists: snap.exists() }),
      (err) => setSnapshot({ path, data: null, error: errorMessage(err, 'Could not load data.'), exists: false }),
    )
  }, [path])
  if (!path) return { data: null, loading: false, error: null, exists: false }
  if (snapshot.path !== path) return { data: null, loading: true, error: null, exists: false }
  return { data: snapshot.data, loading: false, error: snapshot.error, exists: snapshot.exists }
}
