import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod/v4';
import { analyzeCleanliness } from '@/lib/ai/analyze';
import { requireProfile, jsonError, writeAuditLog, assertStoreAccess } from '@/lib/auth-server';
import { adminBucket } from '@/lib/firebase/admin';
import type { AuditItem } from '@/lib/types';
import { HttpError } from '@/lib/utils';
import { loadAudit, recomputeSummary } from '@/lib/server/audits';

export const runtime = 'nodejs';
export const maxDuration = 120;

const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // setelah kompresi client (~300-600KB normal)

const BodySchema = z.object({
  auditId: z.string().trim().min(1),
  itemId: z.string().trim().min(1),
  imageBase64: z.string().min(100),
  mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp']).default('image/jpeg'),
  crewNote: z.string().trim().max(500).optional().nullable(),
});

/**
 * POST /api/analyze
 * 1. Validasi auth + akses store + status audit draft.
 * 2. Simpan foto ke Firebase Storage (Admin SDK, URL dengan download token).
 * 3. Analisa foto dengan Claude vision -> skor 1-5 + temuan.
 * 4. Simpan hasil ke Firestore audits/{id}/items/{itemId}, hitung ulang summary, tulis audit log.
 */
export async function POST(req: Request) {
  try {
    const ctx = await requireProfile(req);
    const body = BodySchema.parse(await req.json());

    const approxBytes = Math.floor((body.imageBase64.length * 3) / 4);
    if (approxBytes > MAX_IMAGE_BYTES) throw new HttpError(413, 'Ukuran foto terlalu besar (maks 4MB setelah kompresi).');

    const { ref, audit } = await loadAudit(body.auditId);
    assertStoreAccess(ctx, audit.storeId);
    if (audit.status === 'submitted') throw new HttpError(400, 'Audit sudah disubmit. Minta manager membuka kembali audit untuk capture ulang.');

    const itemRef = ref.collection('items').doc(body.itemId);
    const itemSnap = await itemRef.get();
    if (!itemSnap.exists) throw new HttpError(404, 'Item audit tidak ditemukan.');
    const item = itemSnap.data() as AuditItem;

    // 1) Simpan foto
    const buffer = Buffer.from(body.imageBase64, 'base64');
    const ext = body.mediaType === 'image/png' ? 'png' : body.mediaType === 'image/webp' ? 'webp' : 'jpg';
    const photoPath = `audits/${audit.storeId}/${audit.date}/${audit.id}/${item.id}-${Date.now()}.${ext}`;
    const token = randomUUID();
    const bucket = adminBucket();
    await bucket.file(photoPath).save(buffer, {
      contentType: body.mediaType,
      resumable: false,
      metadata: {
        cacheControl: 'private, max-age=31536000',
        metadata: { firebaseStorageDownloadTokens: token, auditId: audit.id, itemId: item.id, uploadedBy: ctx.uid },
      },
    });
    const photoUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(photoPath)}?alt=media&token=${token}`;

    // hapus foto lama (capture ulang)
    if (item.photoPath && item.photoPath !== photoPath) {
      await bucket.file(item.photoPath).delete().catch(() => undefined);
    }

    // 2) Analisa AI
    const ai = await analyzeCleanliness({
      imageBase64: body.imageBase64,
      mediaType: body.mediaType,
      area: item.area,
      category: item.category,
      standard: item.standard,
      crewNote: body.crewNote ?? item.crewNote,
    });

    // 3) Simpan hasil (override manager sebelumnya dihapus karena foto baru)
    const now = Date.now();
    const update: Partial<AuditItem> = {
      status: ai.photoValid ? 'scored' : 'invalid',
      photoUrl,
      photoPath,
      capturedAt: now,
      capturedByUid: ctx.uid,
      capturedByName: ctx.profile.name,
      crewNote: body.crewNote ?? item.crewNote ?? null,
      ai,
      finalScore: ai.photoValid ? ai.score : null,
      overrideScore: null,
      overrideNote: null,
      overrideByUid: null,
      overrideByName: null,
      overrideAt: null,
      updatedAt: now,
    };
    await itemRef.set(update, { merge: true });
    const summary = await recomputeSummary(audit.id);

    await writeAuditLog(ctx, {
      action: 'ANALYZE_ITEM',
      entity: 'auditItem',
      entityId: `${audit.id}/${item.id}`,
      details: { area: item.area, score: ai.score, photoValid: ai.photoValid, confidence: ai.confidence, model: ai.model },
    });

    const fresh = await itemRef.get();
    return NextResponse.json({ item: fresh.data(), summary });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: 'Input tidak valid.', issues: err.issues }, { status: 400 });
    return jsonError(err);
  }
}
