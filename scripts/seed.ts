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
  { id: 'afc-cbn', code: 'AFC-CBN', name: 'Almaz Fried Chicken - Cibinong', city: 'Cibinong' },
  { id: 'afc-cks', code: 'AFC-CKS', name: 'Almaz Fried Chicken - Cikeas', city: 'Cikeas' },
  { id: 'afc-cld', code: 'AFC-CLD', name: 'Almaz Fried Chicken - Cilendek', city: 'Bogor' },
  { id: 'afc-cmg', code: 'AFC-CMG', name: 'Almaz Fried Chicken - Cimanggis', city: 'Depok' },
  { id: 'afc-cnr', code: 'AFC-CNR', name: 'Almaz Fried Chicken - Cinere', city: 'Depok', excludedIndicatorIds: ['IND-19', 'IND-22', 'IND-31', 'IND-49', 'IND-50', 'IND-52', 'IND-53', 'IND-54', 'IND-55'] },
  { id: 'afc-drm', code: 'AFC-DRM', name: 'Almaz Fried Chicken - Dramaga Bogor', city: 'Bogor' },
  { id: 'afc-mok', code: 'AFC-MOK', name: 'Almaz Fried Chicken - Mayor Oking Cibinong', city: 'Cibinong' },
  { id: 'afc-pdr', code: 'AFC-PDR', name: 'Almaz Fried Chicken - Pandu Raya', city: 'Bogor' },
  { id: 'afc-stl', code: 'AFC-STL', name: 'Almaz Fried Chicken - Sentul', city: 'Sentul' },
  { id: 'afc-wnh', code: 'AFC-WNH', name: 'Almaz Fried Chicken - Wanaherang', city: 'Gunung Putri' },
  { id: 'afc-ctm', code: 'AFC-CTM', name: 'Almaz Fried Chicken - Citraland Medan', city: 'Medan' },
  { id: 'afc-hrp', code: 'AFC-HRP', name: 'Almaz Fried Chicken - Harapan Raya PKU', city: 'Pekanbaru' },
  { id: 'afc-jmb', code: 'AFC-JMB', name: 'Almaz Fried Chicken - Jambi', city: 'Jambi' },
  { id: 'afc-kip', code: 'AFC-KIP', name: 'Almaz Fried Chicken - Kambang Iwak Palembang', city: 'Palembang' },
  { id: 'afc-kmm', code: 'AFC-KMM', name: 'Almaz Fried Chicken - Kapten Muslim Medan', city: 'Medan' },
  { id: 'afc-ktp', code: 'AFC-KTP', name: 'Almaz Fried Chicken - Kenten Palembang', city: 'Palembang' },
  { id: 'afc-mrp', code: 'AFC-MRP', name: 'Almaz Fried Chicken - Marpoyan PKU', city: 'Pekanbaru' },
  { id: 'afc-pnm', code: 'AFC-PNM', name: 'Almaz Fried Chicken - Panam PKU', city: 'Pekanbaru' },
  { id: 'afc-ryp', code: 'AFC-RYP', name: 'Almaz Fried Chicken - Ryacudu Palembang', city: 'Palembang' },
  { id: 'afc-adm', code: 'AFC-ADM', name: 'Almaz Fried Chicken - Adam Malik Medan', city: 'Medan', excludedIndicatorIds: ['IND-17', 'IND-29', 'IND-30', 'IND-31', 'IND-48', 'IND-50'] },
];

async function main() {
  const batch = db.batch();
  for (const ind of DEFAULT_INDICATORS) batch.set(db.collection('indicators').doc(ind.id), ind);
  const now = Date.now();
  for (const s of SAMPLE_STORES) {
    const ref = db.collection('stores').doc(s.id);
    if (!(await ref.get()).exists) batch.set(ref, { excludedIndicatorIds: [], ...s, active: true, createdAt: now, updatedAt: now });
  }
  await batch.commit();
  console.log(`Seed selesai: ${DEFAULT_INDICATORS.length} indikator, ${SAMPLE_STORES.length} store contoh.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
