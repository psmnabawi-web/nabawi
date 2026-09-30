import 'server-only';
import { adminDb } from '../firebase/admin';
import { summarizeCheck } from '../productChecklists';
import type { ProductAudit, ProductAuditItem } from '../types';
import { HttpError } from '../utils';

export async function loadProductAudit(id: string) {
  const ref = adminDb().collection('productAudits').doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpError(404, 'Audit produk tidak ditemukan.');
  return { ref, audit: snap.data() as ProductAudit };
}

export function summaryOf(items: ProductAuditItem[]) {
  return summarizeCheck(items.map((i) => ({ gate: i.gate, final: i.final })));
}

/** Nomor pemeriksaan berikutnya untuk store+produk di bulan tersebut (1..n). */
export async function nextCheckNo(storeId: string, productId: string, month: string): Promise<number> {
  const snap = await adminDb().collection('productAudits').where('storeId', '==', storeId).where('productId', '==', productId).where('month', '==', month).get();
  return snap.size + 1;
}
