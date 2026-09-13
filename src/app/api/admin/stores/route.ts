import { NextResponse } from 'next/server';
import { z } from 'zod/v4';
import { requireProfile, requireRole, jsonError, writeAuditLog } from '@/lib/auth-server';
import { adminDb } from '@/lib/firebase/admin';
import type { Store } from '@/lib/types';
import { HttpError, slugify } from '@/lib/utils';

export const runtime = 'nodejs';

const StoreSchema = z.object({
  id: z.string().trim().min(1).optional(),
  code: z.string().trim().min(2).max(20),
  name: z.string().trim().min(2).max(80),
  city: z.string().trim().max(80).default(''),
  active: z.boolean().default(true),
  excludedIndicatorIds: z.array(z.string().trim().min(1)).max(200).default([]),
});

/** POST /api/admin/stores -> tambah store (admin). */
export async function POST(req: Request) {
  try {
    const ctx = await requireProfile(req);
    requireRole(ctx, ['admin']);
    const body = StoreSchema.parse(await req.json());
    const id = body.id ?? slugify(body.code);
    const ref = adminDb().collection('stores').doc(id);
    if ((await ref.get()).exists) throw new HttpError(409, 'Kode store sudah dipakai.');
    const now = Date.now();
    const store: Store = { id, code: body.code.toUpperCase(), name: body.name, city: body.city, active: body.active, excludedIndicatorIds: body.excludedIndicatorIds, createdAt: now, updatedAt: now };
    await ref.set(store);
    await writeAuditLog(ctx, { action: 'CREATE_STORE', entity: 'store', entityId: id, details: { code: store.code, name: store.name } });
    return NextResponse.json({ store }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: 'Input tidak valid.', issues: err.issues }, { status: 400 });
    return jsonError(err);
  }
}

/** PATCH /api/admin/stores -> ubah store (admin). */
export async function PATCH(req: Request) {
  try {
    const ctx = await requireProfile(req);
    requireRole(ctx, ['admin']);
    const body = StoreSchema.extend({ id: z.string().trim().min(1) }).parse(await req.json());
    const ref = adminDb().collection('stores').doc(body.id);
    if (!(await ref.get()).exists) throw new HttpError(404, 'Store tidak ditemukan.');
    const update = { code: body.code.toUpperCase(), name: body.name, city: body.city, active: body.active, excludedIndicatorIds: body.excludedIndicatorIds, updatedAt: Date.now() };
    await ref.set(update, { merge: true });
    // sinkron nama store di profil user & audit tidak diubah (histori tetap), hanya user aktif.
    const users = await adminDb().collection('users').where('storeId', '==', body.id).get();
    const batch = adminDb().batch();
    users.docs.forEach((d) => batch.set(d.ref, { storeName: body.name }, { merge: true }));
    await batch.commit();
    await writeAuditLog(ctx, { action: 'UPDATE_STORE', entity: 'store', entityId: body.id, details: { ...update, excludedCount: update.excludedIndicatorIds.length } });
    return NextResponse.json({ store: (await ref.get()).data() });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: 'Input tidak valid.', issues: err.issues }, { status: 400 });
    return jsonError(err);
  }
}
