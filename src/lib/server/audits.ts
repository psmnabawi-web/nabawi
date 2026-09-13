import 'server-only';
import { adminDb } from '../firebase/admin';
import { DEFAULT_INDICATORS, type Indicator } from '../indicators';
import { summarize } from '../scoring';
import type { Audit, AuditItem } from '../types';
import { HttpError } from '../utils';

export async function loadIndicators(): Promise<Indicator[]> {
  const snap = await adminDb().collection('indicators').where('active', '==', true).get();
  if (snap.empty) return DEFAULT_INDICATORS.filter((i) => i.active);
  return snap.docs.map((d) => d.data() as Indicator).sort((a, b) => a.no - b.no);
}

export async function loadAudit(id: string) {
  const ref = adminDb().collection('audits').doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpError(404, 'Audit tidak ditemukan.');
  return { ref, audit: snap.data() as Audit };
}

/** Hitung ulang ringkasan skor audit dari seluruh item, simpan ke dokumen audit. */
export async function recomputeSummary(id: string) {
  const ref = adminDb().collection('audits').doc(id);
  const itemsSnap = await ref.collection('items').get();
  const items = itemsSnap.docs.map((d) => d.data() as AuditItem);
  const summary = summarize(items);
  await ref.set({ summary, updatedAt: Date.now() }, { merge: true });
  return summary;
}
