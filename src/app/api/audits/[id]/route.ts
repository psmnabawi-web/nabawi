import { NextResponse } from 'next/server';
import { z } from 'zod/v4';
import { requireProfile, jsonError, writeAuditLog, assertStoreAccess, requireRole } from '@/lib/auth-server';
import { adminBucket, adminDb } from '@/lib/firebase/admin';
import { loadAudit, recomputeSummary } from '@/lib/server/audits';
import type { AuditItem } from '@/lib/types';
import { HttpError } from '@/lib/utils';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

const PatchSchema = z.object({
  action: z.enum(['submit', 'reopen', 'note']),
  note: z.string().trim().max(500).optional().nullable(),
});

/** PATCH /api/audits/:id -> submit (crew/manager), reopen (manager/admin), ubah catatan. */
export async function PATCH(req: Request, { params }: Params) {
  try {
    const { id } = await params;
    const ctx = await requireProfile(req);
    const body = PatchSchema.parse(await req.json());
    const { ref, audit } = await loadAudit(id);
    assertStoreAccess(ctx, audit.storeId);

    if (body.action === 'submit') {
      if (audit.status === 'submitted') throw new HttpError(400, 'Audit sudah disubmit.');
      const summary = await recomputeSummary(id);
      if (summary.scoredCount === 0) throw new HttpError(400, 'Belum ada item yang dinilai. Ambil foto minimal 1 area.');
      const notDone = summary.itemCount - summary.lockedCount;
      if (notDone > 0 && ctx.profile.role === 'crew') throw new HttpError(400, `Masih ${notDone} area belum di-submit. Selesaikan semua area dulu.`);
      await ref.set({ status: 'submitted', submittedAt: Date.now(), updatedAt: Date.now() }, { merge: true });
      await writeAuditLog(ctx, {
        action: 'SUBMIT_AUDIT',
        entity: 'audit',
        entityId: id,
        details: { pct: summary.pct, grade: summary.grade, scored: summary.scoredCount, pending: summary.pendingCount },
      });
    } else if (body.action === 'reopen') {
      requireRole(ctx, ['manager', 'admin']);
      await ref.set({ status: 'draft', submittedAt: null, updatedAt: Date.now() }, { merge: true });
      await writeAuditLog(ctx, { action: 'REOPEN_AUDIT', entity: 'audit', entityId: id, details: {} });
    } else if (body.action === 'note') {
      await ref.set({ note: body.note ?? null, updatedAt: Date.now() }, { merge: true });
      await writeAuditLog(ctx, { action: 'UPDATE_AUDIT_NOTE', entity: 'audit', entityId: id, details: { note: body.note ?? null } });
    }

    const fresh = await ref.get();
    return NextResponse.json({ audit: fresh.data() });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: 'Input tidak valid.', issues: err.issues }, { status: 400 });
    return jsonError(err);
  }
}

/** DELETE /api/audits/:id -> hapus audit beserta item dan foto (admin, atau manager untuk draft store sendiri). */
export async function DELETE(req: Request, { params }: Params) {
  try {
    const { id } = await params;
    const ctx = await requireProfile(req);
    requireRole(ctx, ['manager', 'admin']);
    const { ref, audit } = await loadAudit(id);
    assertStoreAccess(ctx, audit.storeId);
    if (ctx.profile.role === 'manager' && audit.status === 'submitted') {
      throw new HttpError(403, 'Audit yang sudah disubmit hanya dapat dihapus oleh admin.');
    }

    const itemsSnap = await ref.collection('items').get();
    const paths = itemsSnap.docs.map((d) => (d.data() as AuditItem).photoPath).filter((p): p is string => !!p);
    const bucket = adminBucket();
    await Promise.allSettled(paths.map((p) => bucket.file(p).delete()));

    const batch = adminDb().batch();
    itemsSnap.docs.forEach((d) => batch.delete(d.ref));
    batch.delete(ref);
    await batch.commit();

    await writeAuditLog(ctx, {
      action: 'DELETE_AUDIT',
      entity: 'audit',
      entityId: id,
      details: { storeId: audit.storeId, date: audit.date, shift: audit.shift, photos: paths.length },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
