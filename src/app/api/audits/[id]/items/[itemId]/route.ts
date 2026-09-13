import { NextResponse } from 'next/server';
import { z } from 'zod/v4';
import { requireProfile, jsonError, writeAuditLog, assertStoreAccess, requireRole } from '@/lib/auth-server';
import { adminBucket } from '@/lib/firebase/admin';
import type { AuditItem } from '@/lib/types';
import { HttpError } from '@/lib/utils';
import { loadAudit, recomputeSummary } from '@/lib/server/audits';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string; itemId: string }> };

const PatchSchema = z.object({
  action: z.enum(['override', 'clear_override', 'note', 'reset']),
  score: z.number().int().min(1).max(5).optional(),
  note: z.string().trim().max(500).optional().nullable(),
});

/**
 * PATCH /api/audits/:id/items/:itemId
 * - override / clear_override : manager & admin mengoreksi skor AI (wajib alasan).
 * - note                       : crew menambah catatan.
 * - reset                      : hapus foto & hasil AI agar bisa capture ulang (draft saja).
 */
export async function PATCH(req: Request, { params }: Params) {
  try {
    const { id, itemId } = await params;
    const ctx = await requireProfile(req);
    const body = PatchSchema.parse(await req.json());
    const { ref, audit } = await loadAudit(id);
    assertStoreAccess(ctx, audit.storeId);

    const itemRef = ref.collection('items').doc(itemId);
    const itemSnap = await itemRef.get();
    if (!itemSnap.exists) throw new HttpError(404, 'Item audit tidak ditemukan.');
    const item = itemSnap.data() as AuditItem;
    const now = Date.now();

    if (body.action === 'override') {
      requireRole(ctx, ['manager', 'admin']);
      if (body.score === undefined) throw new HttpError(400, 'Skor override wajib diisi (1-5).');
      if (!body.note || body.note.length < 5) throw new HttpError(400, 'Alasan override wajib diisi (min. 5 karakter).');
      await itemRef.set(
        {
          overrideScore: body.score,
          overrideNote: body.note,
          overrideByUid: ctx.uid,
          overrideByName: ctx.profile.name,
          overrideAt: now,
          finalScore: body.score,
          status: 'override',
          updatedAt: now,
        },
        { merge: true },
      );
      await writeAuditLog(ctx, {
        action: 'OVERRIDE_SCORE',
        entity: 'auditItem',
        entityId: `${id}/${itemId}`,
        details: { area: item.area, aiScore: item.ai?.score ?? null, newScore: body.score, note: body.note },
      });
    } else if (body.action === 'clear_override') {
      requireRole(ctx, ['manager', 'admin']);
      const aiScore = item.ai?.photoValid ? item.ai.score : null;
      await itemRef.set(
        {
          overrideScore: null,
          overrideNote: null,
          overrideByUid: null,
          overrideByName: null,
          overrideAt: null,
          finalScore: aiScore,
          status: item.ai ? (item.ai.photoValid ? 'scored' : 'invalid') : 'pending',
          updatedAt: now,
        },
        { merge: true },
      );
      await writeAuditLog(ctx, { action: 'CLEAR_OVERRIDE', entity: 'auditItem', entityId: `${id}/${itemId}`, details: { area: item.area } });
    } else if (body.action === 'note') {
      await itemRef.set({ crewNote: body.note ?? null, updatedAt: now }, { merge: true });
    } else if (body.action === 'reset') {
      if (audit.status === 'submitted' && ctx.profile.role === 'crew') {
        throw new HttpError(403, 'Audit sudah disubmit. Minta manager membuka kembali audit.');
      }
      if (item.photoPath) {
        await adminBucket().file(item.photoPath).delete().catch(() => undefined);
      }
      await itemRef.set(
        {
          status: 'pending',
          photoUrl: null,
          photoPath: null,
          capturedAt: null,
          capturedByUid: null,
          capturedByName: null,
          ai: null,
          finalScore: null,
          overrideScore: null,
          overrideNote: null,
          overrideByUid: null,
          overrideByName: null,
          overrideAt: null,
          updatedAt: now,
        },
        { merge: true },
      );
      await writeAuditLog(ctx, { action: 'RESET_ITEM', entity: 'auditItem', entityId: `${id}/${itemId}`, details: { area: item.area } });
    }

    const summary = await recomputeSummary(id);
    const fresh = await itemRef.get();
    return NextResponse.json({ item: fresh.data(), summary });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: 'Input tidak valid.', issues: err.issues }, { status: 400 });
    return jsonError(err);
  }
}
