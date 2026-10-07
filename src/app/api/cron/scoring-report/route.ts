import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requireProfile, jsonError } from '@/lib/auth-server';
import { adminDb } from '@/lib/firebase/admin';
import { isConfigured, loadNotifySettings, recordSendResult, sendNotification } from '@/lib/server/notify';
import { buildScoringReport } from '@/lib/server/scoringReport';
import { isSuperAdmin } from '@/lib/types';
import { HttpError } from '@/lib/utils';

export const runtime = 'nodejs';
export const maxDuration = 60;

function secretMatches(given: string | null) {
  const expected = process.env.CRON_SECRET ?? '';
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * GET/POST /api/cron/scoring-report
 * Dipanggil Cloud Scheduler (header X-Cron-Secret) jam 09.00 & 14.00 WIB, atau super admin (Bearer token) untuk pratinjau/kirim manual.
 * ?dry=1   -> hanya mengembalikan teks laporan, tidak mengirim.
 * ?date=YYYY-MM-DD -> laporan untuk tanggal lain (pratinjau).
 */
async function handle(req: Request) {
  try {
    const url = new URL(req.url);
    const dry = url.searchParams.get('dry') === '1';
    const dateParam = url.searchParams.get('date');
    const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : undefined;

    let actor: { uid: string; name: string } | null = null;
    if (secretMatches(req.headers.get('x-cron-secret'))) {
      actor = { uid: 'system', name: 'Cloud Scheduler' };
    } else {
      const ctx = await requireProfile(req);
      if (!isSuperAdmin(ctx.profile)) throw new HttpError(403, 'Hanya super admin.');
      actor = { uid: ctx.uid, name: ctx.profile.name };
    }

    const settings = await loadNotifySettings();
    const report = await buildScoringReport(Date.now(), date);
    if (dry) return NextResponse.json({ report, configured: isConfigured(settings), enabled: settings.enabled, provider: settings.provider });

    if (!isConfigured(settings)) {
      await log(actor, 'SKIP_SCORING_REPORT', { reason: 'belum dikonfigurasi', pctStarted: report.pctStarted });
      return NextResponse.json({ sent: false, reason: 'Notifikasi belum dikonfigurasi. Isi token & ID grup di menu Notifikasi WA.', report });
    }
    if (!settings.enabled && actor.uid === 'system') {
      await log(actor, 'SKIP_SCORING_REPORT', { reason: 'dinonaktifkan', pctStarted: report.pctStarted });
      return NextResponse.json({ sent: false, reason: 'Notifikasi dinonaktifkan.', report });
    }
    const result = await sendNotification(settings, report.text);
    await recordSendResult(result.ok, result.detail);
    await log(actor, result.ok ? 'SEND_SCORING_REPORT' : 'FAIL_SCORING_REPORT', { provider: settings.provider, pctStarted: report.pctStarted, started: report.started, total: report.totalStores, targets: result.results.map((r) => `${r.target}:${r.ok ? 'OK' : 'GAGAL'}`), detail: result.detail.slice(0, 400) });
    if (!result.ok) return NextResponse.json({ sent: false, reason: `Provider menolak: ${result.detail}`, report }, { status: 502 });
    return NextResponse.json({ sent: true, report });
  } catch (err) {
    return jsonError(err);
  }
}

async function log(actor: { uid: string; name: string }, action: string, details: Record<string, unknown>) {
  const ref = adminDb().collection('auditLogs').doc();
  await ref.set({ id: ref.id, action, entity: 'notify', entityId: 'scoring-report', uid: actor.uid, name: actor.name, role: 'admin', details, at: Date.now() });
}

export const GET = handle;
export const POST = handle;
