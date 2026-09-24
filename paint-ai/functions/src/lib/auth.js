import { ALL_STORES, ROLES } from '../config.js';
import { HttpsError } from './errors.js';
import { db } from './firebase.js';

/**
 * Loads the caller's profile and enforces authentication, active status and role.
 * @param {import('firebase-functions/v2/https').CallableRequest} request
 * @param {string[]} [allowedRoles]
 */
export async function requireUser(request, allowedRoles) {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Please sign in first.');
  const snap = await db.doc(`users/${request.auth.uid}`).get();
  if (!snap.exists) throw new HttpsError('failed-precondition', 'User profile not found. Please sign in again.');
  const profile = snap.data();
  if (profile.active === false) throw new HttpsError('permission-denied', 'Your account is disabled.');
  if (allowedRoles && !allowedRoles.includes(profile.role)) {
    throw new HttpsError('permission-denied', 'Your role is not allowed to perform this action.');
  }
  return { uid: request.auth.uid, email: request.auth.token?.email ?? profile.email ?? '', ...profile };
}

export const isAdmin = (user) => user.role === ROLES.SUPER_ADMIN;
export const isContentManager = (user) => user.role === ROLES.SUPER_ADMIN || user.role === ROLES.MARKETING;

/** Can the user read a document scoped to `storeId`? Mirrors firestore.rules. */
export function canAccessStore(user, storeId) {
  if (isContentManager(user)) return true;
  return user.role === ROLES.STORE && !!user.storeId && (storeId === user.storeId || storeId === ALL_STORES);
}

export function assertStoreAccess(user, storeId) {
  if (!canAccessStore(user, storeId)) throw new HttpsError('permission-denied', 'You cannot access data for this store.');
}

/** Validates that a target storeId exists (or is the brand-wide scope). */
export async function assertStoreExists(storeId) {
  if (storeId === ALL_STORES) return;
  const snap = await db.doc(`stores/${storeId}`).get();
  if (!snap.exists) throw new HttpsError('invalid-argument', `Store "${storeId}" does not exist.`);
}
