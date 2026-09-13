import { NextResponse } from 'next/server';
import { z } from 'zod/v4';
import { requireProfile, requireRole, jsonError, writeAuditLog } from '@/lib/auth-server';
import { adminAuth, adminDb } from '@/lib/firebase/admin';
import type { Store, UserProfile } from '@/lib/types';
import { HttpError } from '@/lib/utils';

export const runtime = 'nodejs';

/** GET /api/admin/users -> daftar user (admin: semua; manager: store sendiri). */
export async function GET(req: Request) {
  try {
    const ctx = await requireProfile(req);
    requireRole(ctx, ['manager', 'admin']);
    let q = adminDb().collection('users') as FirebaseFirestore.Query;
    if (ctx.profile.role === 'manager') q = q.where('storeId', '==', ctx.profile.storeId ?? '__none__');
    const snap = await q.get();
    const users = snap.docs.map((d) => d.data() as UserProfile).sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json({ users });
  } catch (err) {
    return jsonError(err);
  }
}

const CreateSchema = z.object({
  email: z.email(),
  password: z.string().min(6).max(64),
  name: z.string().trim().min(2).max(80),
  role: z.enum(['crew', 'manager', 'admin']),
  storeId: z.string().trim().min(1).nullable(),
});

/** POST /api/admin/users -> admin membuat akun crew/manager langsung (tanpa self-register). */
export async function POST(req: Request) {
  try {
    const ctx = await requireProfile(req);
    requireRole(ctx, ['admin']);
    const body = CreateSchema.parse(await req.json());
    let storeName: string | null = null;
    if (body.storeId) {
      const s = await adminDb().collection('stores').doc(body.storeId).get();
      if (!s.exists) throw new HttpError(404, 'Store tidak ditemukan.');
      storeName = (s.data() as Store).name;
    }
    const user = await adminAuth().createUser({ email: body.email, password: body.password, displayName: body.name });
    const now = Date.now();
    const profile: UserProfile = {
      uid: user.uid,
      email: body.email,
      name: body.name,
      role: body.role,
      storeId: body.storeId,
      storeName,
      active: true,
      createdAt: now,
      updatedAt: now,
    };
    await adminDb().collection('users').doc(user.uid).set(profile);
    await writeAuditLog(ctx, { action: 'CREATE_USER', entity: 'user', entityId: user.uid, details: { email: body.email, role: body.role, storeId: body.storeId } });
    return NextResponse.json({ user: profile }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: 'Input tidak valid.', issues: err.issues }, { status: 400 });
    const code = (err as { code?: string }).code;
    if (code === 'auth/email-already-exists') return NextResponse.json({ error: 'Email sudah terdaftar.' }, { status: 409 });
    return jsonError(err);
  }
}

const PatchSchema = z.object({
  uid: z.string().min(1),
  name: z.string().trim().min(2).max(80).optional(),
  role: z.enum(['crew', 'manager', 'admin']).optional(),
  storeId: z.string().trim().min(1).nullable().optional(),
  active: z.boolean().optional(),
  password: z.string().min(6).max(64).optional(),
});

/** PATCH /api/admin/users -> ubah role/store/status/reset password (admin). */
export async function PATCH(req: Request) {
  try {
    const ctx = await requireProfile(req);
    requireRole(ctx, ['admin']);
    const body = PatchSchema.parse(await req.json());
    if (body.uid === ctx.uid && (body.role !== undefined && body.role !== 'admin' || body.active === false)) {
      throw new HttpError(400, 'Anda tidak dapat menurunkan role atau menonaktifkan akun sendiri.');
    }
    const ref = adminDb().collection('users').doc(body.uid);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpError(404, 'User tidak ditemukan.');

    const update: Record<string, unknown> = { updatedAt: Date.now() };
    if (body.name) update.name = body.name;
    if (body.role) update.role = body.role;
    if (body.active !== undefined) update.active = body.active;
    if (body.storeId !== undefined) {
      if (body.storeId) {
        const s = await adminDb().collection('stores').doc(body.storeId).get();
        if (!s.exists) throw new HttpError(404, 'Store tidak ditemukan.');
        update.storeId = body.storeId;
        update.storeName = (s.data() as Store).name;
      } else {
        update.storeId = null;
        update.storeName = null;
      }
    }
    await ref.set(update, { merge: true });
    if (body.password) await adminAuth().updateUser(body.uid, { password: body.password });
    if (body.active === false) await adminAuth().updateUser(body.uid, { disabled: true });
    if (body.active === true) await adminAuth().updateUser(body.uid, { disabled: false });

    const { password: _pw, ...logDetails } = body;
    void _pw;
    await writeAuditLog(ctx, { action: 'UPDATE_USER', entity: 'user', entityId: body.uid, details: { ...logDetails, passwordReset: !!body.password } });
    const fresh = await ref.get();
    return NextResponse.json({ user: fresh.data() });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: 'Input tidak valid.', issues: err.issues }, { status: 400 });
    return jsonError(err);
  }
}
