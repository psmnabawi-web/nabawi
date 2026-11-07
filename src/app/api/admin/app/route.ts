import { NextResponse } from 'next/server';
import { z } from 'zod/v4';
import { requireProfile, jsonError, writeAuditLog, requireSuperAdmin } from '@/lib/auth-server';
import { adminDb } from '@/lib/firebase/admin';
import { APP_DOC, DEFAULT_MESSAGE, invalidateAppStatus, loadAppStatus } from '@/lib/server/appStatus';

export const runtime = 'nodejs';

/** GET /api/admin/app -> status aplikasi. Super admin. */
export async function GET(req: Request) {
  try {
    const ctx = await requireProfile(req);
    requireSuperAdmin(ctx);
    return NextResponse.json({ status: await loadAppStatus(true) });
  } catch (err) {
    return jsonError(err);
  }
}

const Schema = z.object({ maintenance: z.boolean(), message: z.string().trim().max(300).optional() });

/** PUT /api/admin/app -> nyalakan/matikan mode nonaktif sementara. Super admin. */
export async function PUT(req: Request) {
  try {
    const ctx = await requireProfile(req);
    requireSuperAdmin(ctx);
    const body = Schema.parse(await req.json());
    const next = { maintenance: body.maintenance, message: body.message || DEFAULT_MESSAGE, updatedAt: Date.now(), updatedByName: ctx.profile.name };
    await adminDb().doc(APP_DOC).set(next, { merge: true });
    invalidateAppStatus();
    await writeAuditLog(ctx, { action: body.maintenance ? 'APP_DISABLE' : 'APP_ENABLE', entity: 'app', entityId: 'status', details: { message: next.message } });
    return NextResponse.json({ status: await loadAppStatus(true) });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: 'Input tidak valid.', issues: err.issues }, { status: 400 });
    return jsonError(err);
  }
}
