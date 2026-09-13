import 'server-only';
import { NextResponse } from 'next/server';
import { adminAuth, adminDb } from './firebase/admin';
import type { AuditLog, Role, UserProfile } from './types';
import { HttpError } from './utils';

export interface AuthContext {
  uid: string;
  email: string;
  profile: UserProfile;
}

function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isBootstrapAdmin(email: string | undefined | null) {
  return !!email && adminEmails().includes(email.toLowerCase());
}

/** Verifikasi Firebase ID token dari header Authorization: Bearer <token>. */
export async function requireAuth(req: Request): Promise<{ uid: string; email: string; name: string }> {
  const header = req.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new HttpError(401, 'Tidak terautentikasi.');
  try {
    const decoded = await adminAuth().verifyIdToken(token, true);
    return {
      uid: decoded.uid,
      email: decoded.email ?? '',
      name: (decoded.name as string | undefined) ?? decoded.email ?? decoded.uid,
    };
  } catch {
    throw new HttpError(401, 'Sesi tidak valid atau kedaluwarsa. Silakan login ulang.');
  }
}

/** Ambil profil user; buat otomatis jika belum ada (role crew, atau admin jika email masuk ADMIN_EMAILS). */
export async function requireProfile(req: Request): Promise<AuthContext> {
  const { uid, email, name } = await requireAuth(req);
  const ref = adminDb().collection('users').doc(uid);
  const snap = await ref.get();
  let profile: UserProfile;
  if (snap.exists) {
    profile = snap.data() as UserProfile;
    if (isBootstrapAdmin(email) && profile.role !== 'admin') {
      profile = { ...profile, role: 'admin', updatedAt: Date.now() };
      await ref.set(profile, { merge: true });
    }
  } else {
    const now = Date.now();
    profile = {
      uid,
      email,
      name,
      role: isBootstrapAdmin(email) ? 'admin' : 'crew',
      storeId: null,
      storeName: null,
      active: true,
      createdAt: now,
      updatedAt: now,
    };
    await ref.set(profile);
  }
  if (!profile.active) throw new HttpError(403, 'Akun dinonaktifkan. Hubungi admin.');
  return { uid, email, profile };
}

export function requireRole(ctx: AuthContext, roles: Role[]) {
  if (!roles.includes(ctx.profile.role)) {
    throw new HttpError(403, 'Anda tidak memiliki akses untuk aksi ini.');
  }
}

/** Manager/crew hanya boleh mengakses store mereka sendiri; admin bebas. */
export function assertStoreAccess(ctx: AuthContext, storeId: string) {
  if (ctx.profile.role === 'admin') return;
  if (!ctx.profile.storeId || ctx.profile.storeId !== storeId) {
    throw new HttpError(403, 'Anda hanya dapat mengakses data store Anda sendiri.');
  }
}

export async function writeAuditLog(
  ctx: AuthContext,
  entry: Pick<AuditLog, 'action' | 'entity' | 'entityId' | 'details'>,
) {
  const ref = adminDb().collection('auditLogs').doc();
  const log: AuditLog = {
    id: ref.id,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId,
    uid: ctx.uid,
    name: ctx.profile.name,
    role: ctx.profile.role,
    details: entry.details,
    at: Date.now(),
  };
  await ref.set(log);
}

export function jsonError(err: unknown) {
  if (err instanceof HttpError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const message = err instanceof Error ? err.message : 'Terjadi kesalahan di server.';
  console.error('[api]', err);
  return NextResponse.json({ error: message }, { status: 500 });
}
