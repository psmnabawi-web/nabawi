/**
 * Seed awal ke Firestore (jalankan sekali setelah konfigurasi .env.local):
 *   npm run seed
 * - 57 indikator dari Form Audit Cleaning
 * - store contoh (opsional, edit di bawah)
 */
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { DEFAULT_INDICATORS } from '../src/lib/indicators';

const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
const sa = raw ? (JSON.parse(raw) as { project_id: string; client_email: string; private_key: string }) : null;
initializeApp(
  sa
    ? { credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key.replace(/\\n/g, '\n') }), projectId: sa.project_id }
    : { projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID },
);
const db = getFirestore();

const SAMPLE_STORES = [
  { id: 'store-01', code: 'STORE-01', name: 'Store 01', city: '' },
];

async function main() {
  const batch = db.batch();
  for (const ind of DEFAULT_INDICATORS) batch.set(db.collection('indicators').doc(ind.id), ind);
  const now = Date.now();
  for (const s of SAMPLE_STORES) {
    const ref = db.collection('stores').doc(s.id);
    if (!(await ref.get()).exists) batch.set(ref, { ...s, active: true, createdAt: now, updatedAt: now });
  }
  await batch.commit();
  console.log(`Seed selesai: ${DEFAULT_INDICATORS.length} indikator, ${SAMPLE_STORES.length} store contoh.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
