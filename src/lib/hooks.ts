'use client';

import { collection, doc, limit, onSnapshot, orderBy, query, where, type DocumentData, type Query } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { db } from './firebase/client';
import { DEFAULT_INDICATORS, type Indicator } from './indicators';
import type { Audit, AuditItem, AuditLog, Store, UserProfile } from './types';

/** Realtime daftar store aktif. */
export function useStores(includeInactive = false) {
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db(), 'stores'),
      (snap) => {
        const list = snap.docs.map((d) => d.data() as Store).sort((a, b) => a.name.localeCompare(b.name));
        setStores(includeInactive ? list : list.filter((s) => s.active));
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsub;
  }, [includeInactive]);
  return { stores, loading };
}

/** Realtime indikator (fallback ke default jika Firestore kosong). */
export function useIndicators() {
  const [indicators, setIndicators] = useState<Indicator[]>(DEFAULT_INDICATORS);
  const [fromDb, setFromDb] = useState(false);
  useEffect(() => {
    const unsub = onSnapshot(collection(db(), 'indicators'), (snap) => {
      if (snap.empty) {
        setIndicators(DEFAULT_INDICATORS);
        setFromDb(false);
      } else {
        setIndicators(snap.docs.map((d) => d.data() as Indicator).sort((a, b) => a.no - b.no));
        setFromDb(true);
      }
    });
    return unsub;
  }, []);
  return { indicators, fromDb };
}

/** Realtime daftar audit sesuai role / filter store. */
export function useAudits(profile: UserProfile | null, storeFilter: string | 'all') {
  const [state, setState] = useState<{ q: Query<DocumentData> | null; audits: Audit[]; error: string | null }>({ q: null, audits: [], error: null });

  const q = useMemo<Query<DocumentData> | null>(() => {
    if (!profile) return null;
    const col = collection(db(), 'audits');
    if (profile.role === 'admin') {
      return storeFilter === 'all' ? query(col, orderBy('createdAt', 'desc')) : query(col, where('storeId', '==', storeFilter), orderBy('createdAt', 'desc'));
    }
    if (!profile.storeId) return null;
    return query(col, where('storeId', '==', profile.storeId), orderBy('createdAt', 'desc'));
  }, [profile, storeFilter]);

  useEffect(() => {
    if (!q) return;
    const unsub = onSnapshot(
      q,
      (snap) => setState({ q, audits: snap.docs.map((d) => d.data() as Audit), error: null }),
      (err) => setState({ q, audits: [], error: err.message }),
    );
    return unsub;
  }, [q]);

  const ready = q !== null && state.q === q;
  return { audits: ready ? state.audits : [], loading: q !== null && !ready, error: ready ? state.error : null };
}

/** Realtime satu audit + item-itemnya. */
export function useAudit(id: string | null) {
  const [audit, setAudit] = useState<Audit | null>(null);
  const [items, setItems] = useState<AuditItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    const unsubA = onSnapshot(
      doc(db(), 'audits', id),
      (snap) => {
        if (!snap.exists()) {
          setError('Audit tidak ditemukan atau Anda tidak memiliki akses.');
          setAudit(null);
        } else {
          setAudit(snap.data() as Audit);
          setError(null);
        }
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      },
    );
    const unsubI = onSnapshot(collection(db(), 'audits', id, 'items'), (snap) => {
      setItems(snap.docs.map((d) => d.data() as AuditItem).sort((a, b) => a.no - b.no));
    });
    return () => {
      unsubA();
      unsubI();
    };
  }, [id]);

  return { audit, items, loading, error };
}

/** Aktivitas terakhir (audit trail) untuk admin; user lain mendapat [] tanpa error. */
export function useRecentLogs(enabled: boolean, max = 8) {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  useEffect(() => {
    if (!enabled) return;
    const q = query(collection(db(), 'auditLogs'), orderBy('at', 'desc'), limit(max));
    return onSnapshot(q, (snap) => setLogs(snap.docs.map((d) => d.data() as AuditLog)), () => setLogs([]));
  }, [enabled, max]);
  return enabled ? logs : [];
}
