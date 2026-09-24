import { logger } from 'firebase-functions';
import { db, serverTimestamp } from './firebase.js';

/**
 * Append-only audit trail (collection audit_logs, readable by super admin only).
 * Never throws: an audit failure must not break the business action.
 */
export async function logAudit({ actor, action, entity, entityId = null, details = {} }) {
  try {
    await db.collection('audit_logs').add({
      actorUid: actor?.uid ?? null,
      actorEmail: actor?.email ?? null,
      actorRole: actor?.role ?? null,
      action,
      entity,
      entityId,
      details,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    logger.error('audit log failed', { action, entity, entityId, err: err?.message });
  }
}
