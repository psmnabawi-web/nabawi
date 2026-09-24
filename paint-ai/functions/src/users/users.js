import { logger } from 'firebase-functions';
import { config, ROLES } from '../config.js';
import { logAudit } from '../lib/audit.js';
import { HttpsError } from '../lib/errors.js';
import { auth, db, serverTimestamp } from '../lib/firebase.js';

/**
 * Creates the caller's users/{uid} profile on first sign-in.
 * - Emails listed in SUPER_ADMIN_EMAILS become super_admin, but only when the email is verified
 *   (Google sign-in or email/password after clicking the verification link).
 * - Everyone else starts as store_manager without a store (sees nothing until an admin assigns one).
 */
export async function bootstrapProfile(request, input) {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Please sign in first.');
  const { uid, token } = request.auth;
  const email = String(token.email ?? '').toLowerCase();
  const verified = token.email_verified === true;
  const isBootstrapAdmin = !!email && verified && config.superAdminEmails.includes(email);
  const ref = db.doc(`users/${uid}`);

  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      const profile = snap.data();
      const updates = { lastLoginAt: serverTimestamp() };
      if (isBootstrapAdmin && profile.role !== ROLES.SUPER_ADMIN) {
        updates.role = ROLES.SUPER_ADMIN;
        updates.updatedAt = serverTimestamp();
      }
      tx.update(ref, updates);
      return { created: false, promoted: !!updates.role, role: updates.role ?? profile.role };
    }
    const name = (input.name || token.name || email.split('@')[0] || 'User').slice(0, 80);
    const profile = {
      uid,
      name,
      email,
      role: isBootstrapAdmin ? ROLES.SUPER_ADMIN : ROLES.STORE,
      storeId: null,
      active: true,
      photoURL: token.picture ?? null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastLoginAt: serverTimestamp(),
    };
    tx.set(ref, profile);
    return { created: true, promoted: false, role: profile.role };
  });

  if (result.created || result.promoted) {
    await logAudit({ actor: { uid, email, role: result.role }, action: result.created ? 'user.bootstrap' : 'user.promote', entity: 'users', entityId: uid, details: { role: result.role } });
  }
  return { role: result.role, created: result.created };
}

async function assertStoreForRole(role, storeId) {
  if (role !== ROLES.STORE) return null;
  if (!storeId) return null; // allowed: store manager waiting for assignment
  const snap = await db.doc(`stores/${storeId}`).get();
  if (!snap.exists) throw new HttpsError('invalid-argument', `Store "${storeId}" does not exist.`);
  return storeId;
}

/** Super admin user management: create accounts, change role/store, activate/deactivate. */
export async function manageUser(actor, input) {
  if (input.action === 'create') {
    const storeId = await assertStoreForRole(input.role, input.storeId);
    let userRecord;
    try {
      userRecord = await auth.createUser({ email: input.email, password: input.password, displayName: input.name, emailVerified: false });
    } catch (err) {
      if (err?.code === 'auth/email-already-exists') throw new HttpsError('already-exists', 'A user with this email already exists.');
      if (err?.code === 'auth/invalid-password') throw new HttpsError('invalid-argument', 'Password is too weak.');
      logger.error('createUser failed', err);
      throw new HttpsError('internal', 'Could not create the user account.');
    }
    await db.doc(`users/${userRecord.uid}`).set({
      uid: userRecord.uid,
      name: input.name,
      email: input.email,
      role: input.role,
      storeId: input.role === ROLES.STORE ? storeId : null,
      active: true,
      photoURL: null,
      createdBy: actor.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await logAudit({ actor, action: 'user.create', entity: 'users', entityId: userRecord.uid, details: { email: input.email, role: input.role, storeId } });
    return { uid: userRecord.uid };
  }

  // update
  const ref = db.doc(`users/${input.uid}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'User not found.');
  const current = snap.data();
  if (input.uid === actor.uid && ((input.role && input.role !== ROLES.SUPER_ADMIN) || input.active === false)) {
    throw new HttpsError('failed-precondition', 'You cannot remove your own super admin access or deactivate yourself.');
  }
  const role = input.role ?? current.role;
  const updates = { updatedAt: serverTimestamp(), updatedBy: actor.uid };
  if (input.name !== undefined) updates.name = input.name;
  if (input.role !== undefined) updates.role = input.role;
  if (input.storeId !== undefined || input.role !== undefined) {
    updates.storeId = role === ROLES.STORE ? await assertStoreForRole(role, input.storeId !== undefined ? input.storeId : current.storeId) : null;
  }
  if (input.active !== undefined) updates.active = input.active;
  await ref.update(updates);

  try {
    if (input.active !== undefined) {
      await auth.updateUser(input.uid, { disabled: !input.active });
      if (!input.active) await auth.revokeRefreshTokens(input.uid);
    }
    if (input.name !== undefined) await auth.updateUser(input.uid, { displayName: input.name });
  } catch (err) {
    logger.warn('auth user update failed', { uid: input.uid, err: err?.message });
  }
  const { updatedAt: _u, updatedBy: _b, ...changed } = updates;
  await logAudit({ actor, action: 'user.update', entity: 'users', entityId: input.uid, details: { before: { role: current.role, storeId: current.storeId ?? null, active: current.active !== false }, changes: changed } });
  return { uid: input.uid };
}
