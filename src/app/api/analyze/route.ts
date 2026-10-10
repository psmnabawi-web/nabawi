import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod/v4';
import { analyzeCleanliness } from '@/lib/ai/analyze';
import { requireProfile, jsonError, writeAuditLog, assertStoreAccess } from '@/lib/auth-server';
import { adminBucket } from '@/lib/firebase/admin';
import { mustSeeText } from '@/lib/photoGuides';
import { assertStoreActive, findBlockingItem, loadAudit, recomputeSummary } from '@/lib/server/audits';
import type { AttemptRecord, AuditItem } from '@/lib/types';
import { HttpError } from '@/lib/utils';

export const runtime = 'nodejs';
export const maxDuration = 150;

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_IMAGES = 3;

const ImageSchema = z.object({
  base64: z.string().min(100),
  mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp']).default('image/jpeg'),
});

const BodySchema = z.object({
  auditId: z.string().trim().min(1),
  itemId: z.string().trim().min(1),
  /** Baru: sampai 3 foto. */
  images: z.array(ImageSchema).min(1).max(MAX_IMAGES).optional(),
  /** Lama: satu foto (kompatibilitas). */
  imageBase64: z.string().min(100).optional(),
  mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp']).default('image/jpeg'),
  crewNote: z.string().trim().max(500).optional().nullable(),
});

/**
 * POST /api/analyze
 * 1. Validasi auth + akses store + status audit draft + aturan satu area aktif.
 * 2. Simpan 1-3 foto ke Firebase Storage.
 * 3. Analisa semua foto sekaligus dengan AI -> skor 1-5 + temuan + panduan.
 * 4. Simpan hasil, riwayat percobaan, hitung ulang summary, tulis audit log.
 */
export async function POST(req: Request) {
  try {
    const ctx = await requireProfile(req);
    const body = BodySchema.parse(await req.json());
    const images = body.images ?? (body.imageBase64 ? [{ base64: body.imageBase64, mediaType: body.mediaType }] : []);
    if (images.length === 0) throw new HttpError(400, 'Foto wajib dikirim.');
    for (const img of images) {
      if (Math.floor((img.base64.length * 3) / 4) > MAX_IMAGE_BYTES) throw new HttpError(413, 'Ukuran foto terlalu besar (maks 4MB per foto).');
    }

    const { ref, audit } = await loadAudit(body.auditId);
    assertStoreAccess(ctx, audit.storeId);
    await assertStoreActive(audit.storeId);
    if (audit.status === 'submitted') throw new HttpError(400, 'Audit sudah disubmit. Minta manager membuka kembali audit untuk capture ulang.');

    const itemRef = ref.collection('items').doc(body.itemId);
    const itemSnap = await itemRef.get();
    if (!itemSnap.exists) throw new HttpError(404, 'Item audit tidak ditemukan.');
    const item = itemSnap.data() as AuditItem;
    if (item.locked) throw new HttpError(400, 'Area ini sudah di-submit dan terkunci. Minta manager membuka kunci jika perlu foto ulang.');
    if (item.status === 'skipped') throw new HttpError(400, 'Area ini dilewati oleh manager.');
    const allItems = (await ref.collection('items').get()).docs.map((d) => d.data() as AuditItem);
    const blocking = findBlockingItem(allItems, item);
    if (blocking) throw new HttpError(409, `Area #${blocking.no} ${blocking.area} masih dikerjakan. Selesaikan (Submit Area) atau hapus fotonya dulu sebelum memulai area lain.`);

    // 1) Simpan foto
    const bucket = adminBucket();
    const stamp = Date.now();
    const photoPaths: string[] = [];
    const photoUrls: string[] = [];
    for (let i = 0; i < images.length; i += 1) {
      const img = images[i];
      const ext = img.mediaType === 'image/png' ? 'png' : img.mediaType === 'image/webp' ? 'webp' : 'jpg';
      const path = `audits/${audit.storeId}/${audit.date}/${audit.id}/${item.id}-${stamp}-${i + 1}.${ext}`;
      const token = randomUUID();
      await bucket.file(path).save(Buffer.from(img.base64, 'base64'), {
        contentType: img.mediaType,
        resumable: false,
        metadata: { cacheControl: 'private, max-age=31536000', metadata: { firebaseStorageDownloadTokens: token, auditId: audit.id, itemId: item.id, uploadedBy: ctx.uid } },
      });
      photoPaths.push(path);
      photoUrls.push(`https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`);
    }
    // hapus foto lama (foto ulang); riwayat menyimpan URL lama tapi file dihapus agar storage hemat
    const oldPaths = [...(item.photoPaths ?? []), ...(item.photoPath ? [item.photoPath] : [])].filter((p) => !photoPaths.includes(p));
    await Promise.allSettled(oldPaths.map((p) => bucket.file(p).delete()));

    // 2) Analisa AI (semua foto sekaligus)
    const ai = await analyzeCleanliness({
      images,
      area: item.area,
      category: item.category,
      standard: item.standard,
      mustSee: mustSeeText(item.indicatorId ?? item.id),
      crewNote: body.crewNote ?? item.crewNote,
    });

    // 3) Simpan hasil
    const now = Date.now();
    const attempts = (item.attempts ?? (item.ai ? 1 : 0)) + 1;
    const firstAiScore = item.firstAiScore !== undefined && item.firstAiScore !== null ? item.firstAiScore : ai.photoValid ? ai.score : (item.firstAiScore ?? null);
    const record: AttemptRecord = { at: now, score: ai.photoValid ? ai.score : null, photoValid: ai.photoValid, photoUrl: photoUrls[0], photoUrls, byName: ctx.profile.name };
    const history = [...(item.history ?? []), record].slice(-12);
    const update: Partial<AuditItem> = {
      attempts,
      firstAiScore,
      history,
      status: ai.photoValid ? 'scored' : 'invalid',
      photoUrl: photoUrls[0],
      photoPath: photoPaths[0],
      photoUrls,
      photoPaths,
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
      details: { area: item.area, score: ai.score, photoValid: ai.photoValid, coverage: ai.coverage ?? null, photos: images.length, confidence: ai.confidence, model: ai.model, attempt: attempts, adjustments: ai.adjustments ?? [], tokens: ai.usage ?? null },
    });

    const fresh = await itemRef.get();
    return NextResponse.json({ item: fresh.data(), summary });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: 'Input tidak valid.', issues: err.issues }, { status: 400 });
    return jsonError(err);
  }
}
