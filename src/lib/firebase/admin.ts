import 'server-only';
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

/**
 * Firebase Admin SDK (server only).
 * Kredensial:
 * 1. FIREBASE_SERVICE_ACCOUNT_JSON  -> isi JSON service account (satu baris), atau
 * 2. GOOGLE_APPLICATION_CREDENTIALS  -> path file JSON (default credential), atau
 * 3. Application Default Credentials saat jalan di Firebase App Hosting / Cloud Run.
 */
function init(): App {
  const existing = getApps()[0];
  if (existing) return existing;

  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const storageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  if (raw) {
    const sa = JSON.parse(raw) as { project_id: string; client_email: string; private_key: string };
    return initializeApp({
      credential: cert({
        projectId: sa.project_id,
        clientEmail: sa.client_email,
        privateKey: sa.private_key.replace(/\\n/g, '\n'),
      }),
      projectId: sa.project_id,
      storageBucket,
    });
  }
  return initializeApp({ projectId, storageBucket });
}

export function adminApp() {
  return init();
}
export function adminAuth() {
  return getAuth(adminApp());
}
export function adminDb() {
  return getFirestore(adminApp());
}
export function adminBucket() {
  const name = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  if (!name) throw new Error('NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET belum diisi.');
  return getStorage(adminApp()).bucket(name);
}
