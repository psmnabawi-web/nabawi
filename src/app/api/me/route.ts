import { NextResponse } from 'next/server';
import { z } from 'zod/v4';
import { requireProfile, jsonError, writeAuditLog } from '@/lib/auth-server';
import { adminDb } from '@/lib/firebase/admin';
import type { Store } from '@/lib/types';
import { HttpError } from '@/lib/utils';

export const runtime = 'nodejs';

/** GET /api/me -> profil user (dibuat otomatis jika belum ada). */
export async function GET(req: Request) {
  try {
    const ctx = await requireProfile(req);
    return NextResponse.json({ profile: ctx.profile });
  } catch (err) {
    return jsonError(err);
  }
}

const UpdateSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  storeId: z.string().trim().min(1).max(64).nullable().optional(),
});

/** PATCH /api/me -> user mengubah nama / memilih store (crew & manager hanya jika belum punya store). */
export async function PATCH(req: Request) {
  try {
    const ctx = await requireProfile(req);
    const body = UpdateSchema.parse(await req.json());
    const update: Record<string, unknown> = { updatedAt: Date.now() };
    if (body.name) update.name = body.name;
    if (body.storeId !== undefined) {
      if (ctx.profile.role !== 'admin' && ctx.profile.storeId && ctx.profile.storeId !== body.storeId) {
        throw new HttpError(403, 'Perubahan store hanya dapat dilakukan oleh admin.');
      }
      if (body.storeId) {
        const store = await adminDb().collection('stores').doc(body.storeId).get();
        if (!store.exists) throw new HttpError(404, 'Store tidak ditemukan.');
        const s = store.data() as Store;
        update.storeId = s.id;
        update.storeName = s.name;
      } else {
        update.storeId = null;
        update.storeName = null;
      }
    }
    await adminDb().collection('users').doc(ctx.uid).set(update, { merge: true });
    await writeAuditLog(ctx, { action: 'UPDATE_PROFILE', entity: 'user', entityId: ctx.uid, details: update });
    const fresh = await adminDb().collection('users').doc(ctx.uid).get();
    return NextResponse.json({ profile: fresh.data() });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: 'Input tidak valid.', issues: err.issues }, { status: 400 });
    return jsonError(err);
  }
}
