import { NextResponse } from 'next/server';
import { z } from 'zod/v4';
import { requireProfile, jsonError, writeAuditLog, requireSuperAdmin } from '@/lib/auth-server';
import { adminDb } from '@/lib/firebase/admin';
import { isConfigured, loadNotifySettings, maskToken, NOTIFY_DOC } from '@/lib/server/notify';
import { HttpError } from '@/lib/utils';

export const runtime = 'nodejs';

/** GET /api/admin/notify -> pengaturan notifikasi (token disamarkan). Super admin. */
export async function GET(req: Request) {
  try {
    const ctx = await requireProfile(req);
    requireSuperAdmin(ctx);
    const s = await loadNotifySettings();
    return NextResponse.json({ settings: { ...s, token: maskToken(s.token) }, configured: isConfigured(s), cronConfigured: !!process.env.CRON_SECRET });
  } catch (err) {
    return jsonError(err);
  }
}

const Schema = z.object({
  enabled: z.boolean(),
  provider: z.enum(['fonnte', 'wablas', 'telegram']),
  /** Kosong = token lama dipertahankan. */
  token: z.string().trim().max(300).optional(),
  target: z.string().trim().max(120).optional().default(''),
  targets: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
  baseUrl: z.string().trim().max(200).default(''),
});

/** PUT /api/admin/notify -> simpan pengaturan. Super admin. */
export async function PUT(req: Request) {
  try {
    const ctx = await requireProfile(req);
    requireSuperAdmin(ctx);
    const body = Schema.parse(await req.json());
    const cur = await loadNotifySettings();
    const targets = [...new Set((body.targets && body.targets.length ? body.targets : [body.target]).map((t) => t.trim()).filter(Boolean))];
    if (targets.length === 0) throw new HttpError(400, 'Minimal satu grup tujuan.');
    const next = { enabled: body.enabled, provider: body.provider, token: body.token ? body.token : cur.token, target: targets[0], targets, baseUrl: body.baseUrl, schedule: cur.schedule || '09.00 & 14.00 WIB', updatedAt: Date.now(), updatedByName: ctx.profile.name };
    await adminDb().doc(NOTIFY_DOC).set(next, { merge: true });
    await writeAuditLog(ctx, { action: 'UPDATE_NOTIFY_SETTINGS', entity: 'notify', entityId: 'settings', details: { enabled: next.enabled, provider: next.provider, targets: next.targets, tokenChanged: !!body.token } });
    const s = await loadNotifySettings();
    return NextResponse.json({ settings: { ...s, token: maskToken(s.token) }, configured: isConfigured(s) });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: 'Input tidak valid.', issues: err.issues }, { status: 400 });
    return jsonError(err);
  }
}
