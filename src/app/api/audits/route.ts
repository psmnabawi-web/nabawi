import { NextResponse } from 'next/server';
import { z } from 'zod/v4';
import { requireProfile, jsonError, writeAuditLog, assertStoreAccess } from '@/lib/auth-server';
import { adminDb } from '@/lib/firebase/admin';
import { emptySummary, summarize } from '@/lib/scoring';
import { loadIndicators } from '@/lib/server/audits';
import type { Audit, AuditItem, Store } from '@/lib/types';
import { HttpError } from '@/lib/utils';

export const runtime = 'nodejs';

const CreateSchema = z.object({
  storeId: z.string().trim().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal YYYY-MM-DD'),
  shift: z.enum(['PAGI', 'SIANG', 'MALAM']),
  note: z.string().trim().max(500).optional().nullable(),
});

/** POST /api/audits -> buat audit baru + 57 item indikator. */
export async function POST(req: Request) {
  try {
    const ctx = await requireProfile(req);
    const body = CreateSchema.parse(await req.json());
    assertStoreAccess(ctx, body.storeId);

    const storeSnap = await adminDb().collection('stores').doc(body.storeId).get();
    if (!storeSnap.exists) throw new HttpError(404, 'Store tidak ditemukan.');
    const store = storeSnap.data() as Store;
    if (!store.active) throw new HttpError(400, 'Store tidak aktif.');

    // Cegah duplikasi audit draft untuk store+tanggal+shift yang sama.
    const dup = await adminDb()
      .collection('audits')
      .where('storeId', '==', body.storeId)
      .where('date', '==', body.date)
      .where('shift', '==', body.shift)
      .limit(1)
      .get();
    if (!dup.empty) {
      const existing = dup.docs[0].data() as Audit;
      return NextResponse.json(
        { error: `Audit ${store.name} tanggal ${body.date} shift ${body.shift} sudah ada.`, existingId: existing.id },
        { status: 409 },
      );
    }

    const indicators = await loadIndicators();
    const now = Date.now();
    const db = adminDb();
    const auditRef = db.collection('audits').doc();
    const items: AuditItem[] = indicators.map((ind) => ({
      id: ind.id,
      auditId: auditRef.id,
      indicatorId: ind.id,
      no: ind.no,
      categoryCode: ind.categoryCode,
      category: ind.category,
      area: ind.area,
      standard: ind.standard,
      status: 'pending',
      photoUrl: null,
      photoPath: null,
      capturedAt: null,
      capturedByUid: null,
      capturedByName: null,
      crewNote: null,
      ai: null,
      finalScore: null,
      overrideScore: null,
      overrideNote: null,
      overrideByUid: null,
      overrideByName: null,
      overrideAt: null,
      updatedAt: now,
    }));

    const audit: Audit = {
      id: auditRef.id,
      storeId: store.id,
      storeName: store.name,
      date: body.date,
      shift: body.shift,
      auditorUid: ctx.uid,
      auditorName: ctx.profile.name,
      status: 'draft',
      note: body.note ?? null,
      summary: items.length ? summarize(items) : emptySummary(),
      submittedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    const batch = db.batch();
    batch.set(auditRef, audit);
    for (const item of items) batch.set(auditRef.collection('items').doc(item.id), item);
    await batch.commit();

    await writeAuditLog(ctx, {
      action: 'CREATE_AUDIT',
      entity: 'audit',
      entityId: audit.id,
      details: { storeId: store.id, date: body.date, shift: body.shift, items: items.length },
    });

    return NextResponse.json({ audit }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: 'Input tidak valid.', issues: err.issues }, { status: 400 });
    return jsonError(err);
  }
}
