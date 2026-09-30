import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod/v4';
import { analyzeProduct } from '@/lib/ai/productAnalyze';
import { requireProfile, jsonError, writeAuditLog, requireSuperAdmin } from '@/lib/auth-server';
import { adminBucket } from '@/lib/firebase/admin';
import { productById } from '@/lib/productChecklists';
import { loadProductAudit, summaryOf } from '@/lib/server/productAudits';
import type { ProductAuditItem } from '@/lib/types';
import { HttpError } from '@/lib/utils';

export const runtime = 'nodejs';
export const maxDuration = 180;

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_IMAGES = 6;

const BodySchema = z.object({
  images: z
    .array(z.object({ base64: z.string().min(100), mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp']).default('image/jpeg'), label: z.string().trim().max(80).default('') }))
    .max(MAX_IMAGES),
  /** Indeks foto lama yang dipertahankan (tidak diunggah ulang). */
  keepPhotoIndexes: z.array(z.number().int().min(0)).default([]),
  measures: z.record(z.string(), z.number().finite().nullable()).default({}),
  notes: z.object({ process: z.string().trim().max(2000).nullable().default(null), sensory: z.string().trim().max(2000).nullable().default(null), label: z.string().trim().max(2000).nullable().default(null) }),
});

/**
 * POST /api/product-audits/:id/analyze (super admin)
 * 1. Simpan foto baru ke Storage (foto lama yang tidak dipertahankan dihapus).
 * 2. AI menilai semua item checklist sekaligus dari foto + pengukuran + catatan.
 * 3. Simpan hasil; koreksi inspector sebelumnya dipertahankan.
 */
export async function POST(req: Request, { params }: Params) {
  try {
    const { id } = await params;
    const ctx = await requireProfile(req);
    requireSuperAdmin(ctx);
    const body = BodySchema.parse(await req.json());
    const { ref, audit } = await loadProductAudit(id);
    if (audit.status === 'submitted') throw new HttpError(400, 'Audit sudah disubmit. Buka kembali dulu untuk analisa ulang.');
    const product = productById(audit.productId);
    if (!product) throw new HttpError(400, 'Produk tidak dikenal.');
    for (const img of body.images) {
      if (Math.floor((img.base64.length * 3) / 4) > MAX_IMAGE_BYTES) throw new HttpError(413, 'Ukuran foto terlalu besar (maks 4MB per foto).');
    }
    const keep = new Set(body.keepPhotoIndexes.filter((i) => i < audit.photoUrls.length));
    const total = keep.size + body.images.length;
    if (total === 0) throw new HttpError(400, 'Minimal 1 foto produk wajib dikirim.');
    if (total > MAX_IMAGES) throw new HttpError(400, `Maksimal ${MAX_IMAGES} foto.`);

    // 1) Foto: pertahankan yang dipilih, unggah yang baru, hapus sisanya
    const bucket = adminBucket();
    const stamp = Date.now();
    const photoUrls: string[] = [];
    const photoPaths: string[] = [];
    const photoLabels: string[] = [];
    const keptImages: Array<{ base64: string; mediaType: string; label: string }> = [];
    for (const i of [...keep].sort((a, b) => a - b)) {
      photoUrls.push(audit.photoUrls[i]);
      photoPaths.push(audit.photoPaths[i]);
      photoLabels.push(audit.photoLabels[i] ?? '');
      const [buf] = await bucket.file(audit.photoPaths[i]).download();
      const ext = audit.photoPaths[i].split('.').pop();
      keptImages.push({ base64: buf.toString('base64'), mediaType: ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg', label: audit.photoLabels[i] ?? '' });
    }
    for (let i = 0; i < body.images.length; i += 1) {
      const img = body.images[i];
      const ext = img.mediaType === 'image/png' ? 'png' : img.mediaType === 'image/webp' ? 'webp' : 'jpg';
      const path = `productAudits/${audit.storeId}/${audit.date}/${audit.id}/${stamp}-${i + 1}.${ext}`;
      const token = randomUUID();
      await bucket.file(path).save(Buffer.from(img.base64, 'base64'), {
        contentType: img.mediaType,
        resumable: false,
        metadata: { cacheControl: 'private, max-age=31536000', metadata: { firebaseStorageDownloadTokens: token, productAuditId: audit.id, uploadedBy: ctx.uid } },
      });
      photoPaths.push(path);
      photoUrls.push(`https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`);
      photoLabels.push(img.label);
    }
    const removed = audit.photoPaths.filter((p) => !photoPaths.includes(p));
    await Promise.allSettled(removed.map((p) => bucket.file(p).delete()));

    // 2) Analisa AI
    const images = [...keptImages, ...body.images.map((img) => ({ base64: img.base64, mediaType: img.mediaType, label: img.label }))].map((img, i) => ({ ...img, label: img.label || `Foto ${i + 1}` }));
    const result = await analyzeProduct({ product, images, measures: body.measures, notes: body.notes, storeName: audit.storeName, date: audit.date });

    // 3) Simpan hasil (koreksi inspector dipertahankan)
    const now = Date.now();
    const items: ProductAuditItem[] = audit.items.map((it) => {
      const ai = result.items[it.no] ?? null;
      if (it.finalSource === 'inspector') return { ...it, ai };
      return { ...it, ai, final: ai ? ai.verdict : null, finalSource: ai ? 'ai' : null };
    });
    const summary = summaryOf(items);
    await ref.set(
      { photoUrls, photoPaths, photoLabels, measures: body.measures, notes: body.notes, items, ai: result.ai, summary, attempts: (audit.attempts ?? 0) + 1, updatedAt: now },
      { merge: true },
    );
    await writeAuditLog(ctx, {
      action: 'ANALYZE_PRODUCT_AUDIT',
      entity: 'productAudit',
      entityId: id,
      details: { store: audit.storeName, product: audit.productName, photos: images.length, score: summary.score, decision: summary.decision, ya: summary.ya, tidak: summary.tidak, na: summary.na, model: result.ai.model, adjustments: result.ai.adjustments },
    });
    const fresh = await ref.get();
    return NextResponse.json({ audit: fresh.data() });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: 'Input tidak valid.', issues: err.issues }, { status: 400 });
    return jsonError(err);
  }
}

type Params = { params: Promise<{ id: string }> };
