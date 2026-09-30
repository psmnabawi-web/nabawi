import { NextResponse } from 'next/server';
import { z } from 'zod/v4';
import { requireProfile, jsonError, writeAuditLog, requireSuperAdmin } from '@/lib/auth-server';
import { adminDb } from '@/lib/firebase/admin';
import { productById, summarizeCheck } from '@/lib/productChecklists';
import { nextCheckNo } from '@/lib/server/productAudits';
import type { ProductAudit, ProductAuditItem, Store } from '@/lib/types';
import { HttpError } from '@/lib/utils';

export const runtime = 'nodejs';

const CreateSchema = z.object({
  storeId: z.string().trim().min(1),
  productId: z.enum(['kebuli', 'saudi', 'ori']),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal YYYY-MM-DD'),
});

/** POST /api/product-audits -> buat audit kualitas produk (draft) dengan item checklist. Super admin saja. */
export async function POST(req: Request) {
  try {
    const ctx = await requireProfile(req);
    requireSuperAdmin(ctx);
    const body = CreateSchema.parse(await req.json());
    const product = productById(body.productId);
    if (!product) throw new HttpError(400, 'Produk tidak dikenal.');
    const storeSnap = await adminDb().collection('stores').doc(body.storeId).get();
    if (!storeSnap.exists) throw new HttpError(404, 'Store tidak ditemukan.');
    const store = storeSnap.data() as Store;

    const month = body.date.slice(0, 7);
    const checkNo = await nextCheckNo(store.id, product.id, month);
    const now = Date.now();
    const ref = adminDb().collection('productAudits').doc();
    const items: ProductAuditItem[] = product.items.map((it) => ({ ...it, ai: null, final: null, finalSource: null, inspectorNote: null, inspectorAt: null }));
    const audit: ProductAudit = {
      id: ref.id,
      storeId: store.id,
      storeCode: store.code,
      storeName: store.name,
      productId: product.id,
      productName: product.name,
      date: body.date,
      month,
      checkNo,
      inspectorUid: ctx.uid,
      inspectorName: ctx.profile.name,
      status: 'draft',
      photoUrls: [],
      photoPaths: [],
      photoLabels: [],
      measures: {},
      notes: { process: null, sensory: null, label: null },
      items,
      ai: null,
      summary: summarizeCheck(items.map((i) => ({ gate: i.gate, final: i.final }))),
      attempts: 0,
      createdAt: now,
      updatedAt: now,
      submittedAt: null,
      submittedByName: null,
    };
    await ref.set(audit);
    await writeAuditLog(ctx, { action: 'CREATE_PRODUCT_AUDIT', entity: 'productAudit', entityId: ref.id, details: { store: store.name, product: product.name, date: body.date, checkNo } });
    return NextResponse.json({ audit }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: 'Input tidak valid.', issues: err.issues }, { status: 400 });
    return jsonError(err);
  }
}
