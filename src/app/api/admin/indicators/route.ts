import { NextResponse } from 'next/server';
import { z } from 'zod/v4';
import { requireProfile, requireRole, jsonError, writeAuditLog } from '@/lib/auth-server';
import { adminDb } from '@/lib/firebase/admin';
import { CATEGORY_ORDER, DEFAULT_INDICATORS, type Indicator } from '@/lib/indicators';
import { HttpError } from '@/lib/utils';

export const runtime = 'nodejs';

const codes = CATEGORY_ORDER.map((c) => c.code) as [string, ...string[]];

const IndicatorSchema = z.object({
  id: z.string().trim().min(1).optional(),
  no: z.number().int().min(1).max(999),
  categoryCode: z.enum(codes),
  area: z.string().trim().min(2).max(120),
  standard: z.string().trim().min(5).max(1000),
  active: z.boolean().default(true),
  weight: z.number().min(0).max(5).default(1),
});

/** POST /api/admin/indicators -> tambah/ubah indikator (admin). Upsert berdasarkan id. */
export async function POST(req: Request) {
  try {
    const ctx = await requireProfile(req);
    requireRole(ctx, ['admin']);
    const body = IndicatorSchema.parse(await req.json());
    const category = CATEGORY_ORDER.find((c) => c.code === body.categoryCode)!;
    const id = body.id ?? `IND-${String(body.no).padStart(2, '0')}`;
    const ind: Indicator = {
      id,
      no: body.no,
      categoryCode: category.code,
      category: category.label,
      area: body.area,
      standard: body.standard,
      active: body.active,
      weight: body.weight,
    };
    await adminDb().collection('indicators').doc(id).set(ind);
    await writeAuditLog(ctx, { action: 'UPSERT_INDICATOR', entity: 'indicator', entityId: id, details: { no: ind.no, area: ind.area, active: ind.active } });
    return NextResponse.json({ indicator: ind });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: 'Input tidak valid.', issues: err.issues }, { status: 400 });
    return jsonError(err);
  }
}

/** DELETE /api/admin/indicators?id=IND-01 -> hapus indikator (admin). Audit lama tidak terpengaruh. */
export async function DELETE(req: Request) {
  try {
    const ctx = await requireProfile(req);
    requireRole(ctx, ['admin']);
    const id = new URL(req.url).searchParams.get('id');
    if (!id) throw new HttpError(400, 'Parameter id wajib.');
    await adminDb().collection('indicators').doc(id).delete();
    await writeAuditLog(ctx, { action: 'DELETE_INDICATOR', entity: 'indicator', entityId: id, details: {} });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}

/** PUT /api/admin/indicators -> reset ke 57 indikator default dari Form Audit Cleaning (admin). */
export async function PUT(req: Request) {
  try {
    const ctx = await requireProfile(req);
    requireRole(ctx, ['admin']);
    const batch = adminDb().batch();
    for (const ind of DEFAULT_INDICATORS) batch.set(adminDb().collection('indicators').doc(ind.id), ind);
    await batch.commit();
    await writeAuditLog(ctx, { action: 'SEED_INDICATORS', entity: 'indicator', entityId: '*', details: { count: DEFAULT_INDICATORS.length } });
    return NextResponse.json({ ok: true, count: DEFAULT_INDICATORS.length });
  } catch (err) {
    return jsonError(err);
  }
}
