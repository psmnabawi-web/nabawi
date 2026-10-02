import { NextResponse } from 'next/server';
import { z } from 'zod/v4';
import { requireProfile, jsonError, writeAuditLog, assertStoreAccess, requireRole } from '@/lib/auth-server';
import { adminBucket } from '@/lib/firebase/admin';
import { effectiveScore, meetsSubmitThreshold, MIN_SUBMIT_PCT } from '@/lib/scoring';
import { assertStoreActive, autoSubmitIfDone, loadAudit, recomputeSummary } from '@/lib/server/audits';
import type { AuditItem } from '@/lib/types';
import { HttpError } from '@/lib/utils';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string; itemId: string }> };

const PatchSchema = z.object({
  action: z.enum(['lock', 'unlock', 'skip', 'unskip', 'override', 'clear_override', 'note', 'reset', 'request_review', 'cancel_review', 'verify_lock']),
  score: z.number().int().min(1).max(5).optional(),
  note: z.string().trim().max(500).optional().nullable(),
});

/**
 * PATCH /api/audits/:id/items/:itemId
 * - lock            : crew "Submit Area". Syarat: ada foto, skor >= batas (75%). Semua area selesai -> audit auto-submit.
 * - unlock          : manager/admin membuka kunci area agar bisa difoto ulang.
 * - skip / unskip   : manager/admin melewati area (mis. renovasi), wajib alasan. Tidak dihitung dalam skor.
 * - override / clear_override : manager/admin mengoreksi skor AI (wajib alasan).
 * - note            : catatan crew.
 * - reset           : hapus foto & hasil AI agar bisa capture ulang. Crew hanya jika belum terkunci.
 * - request_review  : crew minta verifikasi manager setelah >= 2 percobaan gagal (wajib catatan).
 * - cancel_review   : batalkan permintaan verifikasi (crew/manager).
 * - verify_lock     : manager/admin memverifikasi langsung: set skor (override, wajib alasan) dan kunci area jika skor >= batas.
 */
export async function PATCH(req: Request, { params }: Params) {
  try {
    const { id, itemId } = await params;
    const ctx = await requireProfile(req);
    const body = PatchSchema.parse(await req.json());
    const { ref, audit } = await loadAudit(id);
    assertStoreAccess(ctx, audit.storeId);
    await assertStoreActive(audit.storeId);

    const itemRef = ref.collection('items').doc(itemId);
    const itemSnap = await itemRef.get();
    if (!itemSnap.exists) throw new HttpError(404, 'Item audit tidak ditemukan.');
    const item = itemSnap.data() as AuditItem;
    const now = Date.now();
    const isManager = ctx.profile.role !== 'crew';
    let autoSubmitted = false;

    if (body.action === 'lock') {
      if (audit.status === 'submitted') throw new HttpError(400, 'Audit sudah disubmit.');
      if (item.locked) throw new HttpError(400, 'Area ini sudah di-submit.');
      if (item.status === 'skipped') throw new HttpError(400, 'Area ini dilewati.');
      if (!item.photoUrl || !item.ai) throw new HttpError(400, 'Ambil foto dan tunggu hasil AI dulu.');
      const score = effectiveScore(item);
      if (!meetsSubmitThreshold(score)) {
        throw new HttpError(422, `Skor area ${score === null ? 'belum ada' : `${score * 20}%`} di bawah batas ${MIN_SUBMIT_PCT}%. Bersihkan area sesuai rekomendasi lalu foto ulang.`);
      }
      await itemRef.set({ locked: true, lockedAt: now, lockedByUid: ctx.uid, lockedByName: ctx.profile.name, updatedAt: now }, { merge: true });
      await writeAuditLog(ctx, { action: 'LOCK_ITEM', entity: 'auditItem', entityId: `${id}/${itemId}`, details: { area: item.area, score, attempts: item.attempts ?? 1 } });
      autoSubmitted = await autoSubmitIfDone(id);
      if (autoSubmitted) await writeAuditLog(ctx, { action: 'AUTO_SUBMIT_AUDIT', entity: 'audit', entityId: id, details: { trigger: `lock ${item.area}` } });
    } else if (body.action === 'unlock') {
      requireRole(ctx, ['manager', 'admin']);
      await itemRef.set({ locked: false, lockedAt: null, lockedByUid: null, lockedByName: null, updatedAt: now }, { merge: true });
      if (audit.status === 'submitted') await ref.set({ status: 'draft', submittedAt: null, updatedAt: now }, { merge: true });
      await writeAuditLog(ctx, { action: 'UNLOCK_ITEM', entity: 'auditItem', entityId: `${id}/${itemId}`, details: { area: item.area, note: body.note ?? null } });
    } else if (body.action === 'skip') {
      requireRole(ctx, ['manager', 'admin']);
      if (!body.note || body.note.length < 5) throw new HttpError(400, 'Alasan melewati area wajib diisi (min. 5 karakter).');
      await itemRef.set({ status: 'skipped', skipNote: body.note, skippedByName: ctx.profile.name, locked: false, updatedAt: now }, { merge: true });
      await writeAuditLog(ctx, { action: 'SKIP_ITEM', entity: 'auditItem', entityId: `${id}/${itemId}`, details: { area: item.area, note: body.note } });
      autoSubmitted = await autoSubmitIfDone(id);
    } else if (body.action === 'unskip') {
      requireRole(ctx, ['manager', 'admin']);
      const restored: AuditItem['status'] = item.overrideScore !== null ? 'override' : item.ai ? (item.ai.photoValid ? 'scored' : 'invalid') : 'pending';
      await itemRef.set({ status: restored, skipNote: null, skippedByName: null, updatedAt: now }, { merge: true });
      if (audit.status === 'submitted') await ref.set({ status: 'draft', submittedAt: null, updatedAt: now }, { merge: true });
      await writeAuditLog(ctx, { action: 'UNSKIP_ITEM', entity: 'auditItem', entityId: `${id}/${itemId}`, details: { area: item.area } });
    } else if (body.action === 'override') {
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
    } else if (body.action === 'request_review') {
      if (audit.status === 'submitted') throw new HttpError(400, 'Audit sudah disubmit.');
      if (item.locked) throw new HttpError(400, 'Area ini sudah di-submit.');
      if ((item.attempts ?? 0) < 2) throw new HttpError(400, 'Verifikasi manager bisa diminta setelah minimal 2 kali foto ulang.');
      if (!body.note || body.note.length < 5) throw new HttpError(400, 'Tulis catatan untuk manager (min. 5 karakter), mis. apa yang sudah dibersihkan.');
      await itemRef.set({ reviewRequested: true, reviewNote: body.note, reviewRequestedAt: now, reviewRequestedByName: ctx.profile.name, updatedAt: now }, { merge: true });
      await writeAuditLog(ctx, { action: 'REQUEST_REVIEW', entity: 'auditItem', entityId: `${id}/${itemId}`, details: { area: item.area, attempts: item.attempts ?? 0, note: body.note } });
    } else if (body.action === 'cancel_review') {
      await itemRef.set({ reviewRequested: false, updatedAt: now }, { merge: true });
      await writeAuditLog(ctx, { action: 'CANCEL_REVIEW', entity: 'auditItem', entityId: `${id}/${itemId}`, details: { area: item.area, note: body.note ?? null } });
    } else if (body.action === 'verify_lock') {
      requireRole(ctx, ['manager', 'admin']);
      if (body.score === undefined) throw new HttpError(400, 'Skor verifikasi wajib diisi (1-5).');
      if (!body.note || body.note.length < 5) throw new HttpError(400, 'Alasan verifikasi wajib diisi (min. 5 karakter).');
      if (!item.photoUrl) throw new HttpError(400, 'Belum ada foto untuk diverifikasi.');
      const passes = meetsSubmitThreshold(body.score);
      await itemRef.set(
        {
          overrideScore: body.score,
          overrideNote: `Verifikasi manager: ${body.note}`,
          overrideByUid: ctx.uid,
          overrideByName: ctx.profile.name,
          overrideAt: now,
          finalScore: body.score,
          status: 'override',
          reviewRequested: false,
          ...(passes ? { locked: true, lockedAt: now, lockedByUid: ctx.uid, lockedByName: ctx.profile.name } : {}),
          updatedAt: now,
        },
        { merge: true },
      );
      await writeAuditLog(ctx, { action: 'VERIFY_ITEM', entity: 'auditItem', entityId: `${id}/${itemId}`, details: { area: item.area, aiScore: item.ai?.score ?? null, score: body.score, locked: passes, note: body.note } });
      if (passes) {
        autoSubmitted = await autoSubmitIfDone(id);
        if (autoSubmitted) await writeAuditLog(ctx, { action: 'AUTO_SUBMIT_AUDIT', entity: 'audit', entityId: id, details: { trigger: `verify ${item.area}` } });
      }
    } else if (body.action === 'note') {
      await itemRef.set({ crewNote: body.note ?? null, updatedAt: now }, { merge: true });
    } else if (body.action === 'reset') {
      if (!isManager && (audit.status === 'submitted' || item.locked)) {
        throw new HttpError(403, 'Area sudah di-submit. Minta manager membuka kunci area ini.');
      }
      const paths = [...(item.photoPaths ?? []), ...(item.photoPath ? [item.photoPath] : [])];
      await Promise.allSettled(paths.map((p) => adminBucket().file(p).delete()));
      await itemRef.set(
        {
          status: 'pending',
          photoUrl: null,
          photoPath: null,
          photoUrls: [],
          photoPaths: [],
          reviewRequested: false,
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
          locked: false,
          lockedAt: null,
          lockedByUid: null,
          lockedByName: null,
          updatedAt: now,
        },
        { merge: true },
      );
      if (audit.status === 'submitted') await ref.set({ status: 'draft', submittedAt: null, updatedAt: now }, { merge: true });
      await writeAuditLog(ctx, { action: 'RESET_ITEM', entity: 'auditItem', entityId: `${id}/${itemId}`, details: { area: item.area } });
    }

    const summary = await recomputeSummary(id);
    const fresh = await itemRef.get();
    return NextResponse.json({ item: fresh.data(), summary, autoSubmitted });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: 'Input tidak valid.', issues: err.issues }, { status: 400 });
    return jsonError(err);
  }
}
