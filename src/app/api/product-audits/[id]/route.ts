import { NextResponse } from 'next/server';
import { z } from 'zod/v4';
import { requireProfile, jsonError, writeAuditLog, requireSuperAdmin } from '@/lib/auth-server';
import { adminBucket } from '@/lib/firebase/admin';
import { loadProductAudit, summaryOf } from '@/lib/server/productAudits';
import type { ProductAuditItem } from '@/lib/types';
import { HttpError } from '@/lib/utils';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

const PatchSchema = z.object({
  action: z.enum(['verdict', 'submit', 'reopen', 'inputs']),
  no: z.number().int().min(1).max(60).optional(),
  verdict: z.enum(['ya', 'tidak', 'na']).nullable().optional(),
  note: z.string().trim().max(500).optional().nullable(),
  measures: z.record(z.string(), z.number().finite().nullable()).optional(),
  notes: z.object({ process: z.string().trim().max(2000).nullable(), sensory: z.string().trim().max(2000).nullable(), label: z.string().trim().max(2000).nullable() }).optional(),
});

/**
 * PATCH /api/product-audits/:id (super admin)
 * - verdict : koreksi keputusan satu item oleh inspector (verdict null = kembali ke hasil AI)
 * - inputs  : simpan pengukuran & catatan tanpa analisa
 * - submit / reopen
 */
export async function PATCH(req: Request, { params }: Params) {
  try {
    const { id } = await params;
    const ctx = await requireProfile(req);
    requireSuperAdmin(ctx);
    const body = PatchSchema.parse(await req.json());
    const { ref, audit } = await loadProductAudit(id);
    const now = Date.now();

    if (body.action === 'verdict') {
      if (audit.status === 'submitted') throw new HttpError(400, 'Audit sudah disubmit. Buka kembali dulu untuk mengubah.');
      if (!body.no) throw new HttpError(400, 'Nomor item wajib.');
      const idx = audit.items.findIndex((i) => i.no === body.no);
      if (idx < 0) throw new HttpError(404, 'Item tidak ditemukan.');
      const cur = audit.items[idx];
      const next: ProductAuditItem =
        body.verdict === null || body.verdict === undefined
          ? { ...cur, final: cur.ai?.verdict ?? null, finalSource: cur.ai ? 'ai' : null, inspectorNote: null, inspectorAt: null }
          : { ...cur, final: body.verdict, finalSource: 'inspector', inspectorNote: body.note ?? null, inspectorAt: now };
      if (next.finalSource === 'inspector' && next.final !== next.ai?.verdict && !next.inspectorNote) {
        throw new HttpError(400, 'Koreksi yang berbeda dari hasil AI wajib disertai alasan.');
      }
      const items = audit.items.map((i, k) => (k === idx ? next : i));
      const summary = summaryOf(items);
      await ref.set({ items, summary, updatedAt: now }, { merge: true });
      await writeAuditLog(ctx, { action: 'PRODUCT_ITEM_VERDICT', entity: 'productAudit', entityId: id, details: { no: body.no, verdict: next.final, source: next.finalSource, note: next.inspectorNote, aiVerdict: cur.ai?.verdict ?? null } });
      return NextResponse.json({ items, summary });
    }

    if (body.action === 'inputs') {
      if (audit.status === 'submitted') throw new HttpError(400, 'Audit sudah disubmit.');
      const update: Record<string, unknown> = { updatedAt: now };
      if (body.measures) update.measures = { ...audit.measures, ...body.measures };
      if (body.notes) update.notes = body.notes;
      await ref.set(update, { merge: true });
      return NextResponse.json({ ok: true });
    }

    if (body.action === 'submit') {
      if (audit.status === 'submitted') throw new HttpError(400, 'Audit sudah disubmit.');
      const summary = summaryOf(audit.items);
      if (summary.unanswered > 0) throw new HttpError(400, `Masih ${summary.unanswered} item belum dinilai. Jalankan analisa AI atau isi manual.`);
      await ref.set({ status: 'submitted', submittedAt: now, submittedByName: ctx.profile.name, summary, updatedAt: now }, { merge: true });
      await writeAuditLog(ctx, { action: 'SUBMIT_PRODUCT_AUDIT', entity: 'productAudit', entityId: id, details: { store: audit.storeName, product: audit.productName, score: summary.score, decision: summary.decision, criticalNg: summary.criticalNg, majorNg: summary.majorNg } });
      return NextResponse.json({ ok: true, summary });
    }

    // reopen
    if (audit.status !== 'submitted') throw new HttpError(400, 'Audit masih draft.');
    await ref.set({ status: 'draft', submittedAt: null, submittedByName: null, updatedAt: now }, { merge: true });
    await writeAuditLog(ctx, { action: 'REOPEN_PRODUCT_AUDIT', entity: 'productAudit', entityId: id, details: { note: body.note ?? null } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: 'Input tidak valid.', issues: err.issues }, { status: 400 });
    return jsonError(err);
  }
}

/** DELETE /api/product-audits/:id -> hapus audit produk beserta foto (super admin). */
export async function DELETE(req: Request, { params }: Params) {
  try {
    const { id } = await params;
    const ctx = await requireProfile(req);
    requireSuperAdmin(ctx);
    const { ref, audit } = await loadProductAudit(id);
    const bucket = adminBucket();
    await Promise.allSettled(audit.photoPaths.map((p) => bucket.file(p).delete()));
    await ref.delete();
    await writeAuditLog(ctx, { action: 'DELETE_PRODUCT_AUDIT', entity: 'productAudit', entityId: id, details: { store: audit.storeName, product: audit.productName, date: audit.date, status: audit.status } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
