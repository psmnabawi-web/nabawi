import { HttpsError } from './errors.js';
import { db, serverTimestamp } from './firebase.js';

/** Day key in Asia/Jakarta so quotas reset at local midnight. */
export function dayKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/**
 * Atomically consumes `amount` units of the caller's daily quota.
 * Doc: usage/{uid}_{yyyy-mm-dd} → { uid, date, ai, video }
 * @param {'ai'|'video'} kind
 */
export async function consumeQuota(uid, kind, limit, amount = 1) {
  const date = dayKey();
  const ref = db.doc(`usage/${uid}_${date}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const used = snap.exists ? Number(snap.get(kind) ?? 0) : 0;
    if (used + amount > limit) {
      throw new HttpsError('resource-exhausted', `Daily ${kind === 'ai' ? 'AI generation' : 'video'} limit reached (${limit}/day). Try again tomorrow or ask an admin to raise the limit.`);
    }
    tx.set(ref, { uid, date, [kind]: used + amount, updatedAt: serverTimestamp() }, { merge: true });
  });
}

/** Gives back quota when the provider call failed, so users are not charged for errors. */
export async function refundQuota(uid, kind, amount = 1) {
  const ref = db.doc(`usage/${uid}_${dayKey()}`);
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const used = Number(snap.get(kind) ?? 0);
      tx.update(ref, { [kind]: Math.max(0, used - amount), updatedAt: serverTimestamp() });
    });
  } catch {
    /* best effort */
  }
}
