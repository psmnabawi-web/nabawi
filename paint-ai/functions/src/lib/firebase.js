import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

if (!getApps().length) initializeApp();

export const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

export const auth = getAuth();
export const bucket = () => getStorage().bucket();
export { FieldValue, Timestamp };

export const serverTimestamp = () => FieldValue.serverTimestamp();

/** Firestore Timestamp | Date | ISO string → Date (or null). */
export function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') return value.toDate();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Commit writes in chunks of 450 (Firestore batch limit is 500). */
export async function commitInChunks(operations) {
  const CHUNK = 450;
  for (let i = 0; i < operations.length; i += CHUNK) {
    const batch = db.batch();
    for (const op of operations.slice(i, i + CHUNK)) op(batch);
    await batch.commit();
  }
}
