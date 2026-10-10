import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod/v4';
import { analyzeCleanliness } from '@/lib/ai/analyze';
import { requireProfile, jsonError } from '@/lib/auth-server';
import { adminBucket, adminDb } from '@/lib/firebase/admin';
import { mustSeeText } from '@/lib/photoGuides';
import { loadAiSettings } from '@/lib/server/aiSettings';
import { isSuperAdmin, type AiSettings, type AiTestItem, type AiTestReport, type Audit, type AuditItem } from '@/lib/types';
import { HttpError } from '@/lib/utils';

export const runtime = 'nodejs';
export const maxDuration = 300;

const BodySchema = z.object({
  n: z.number().int().min(1).max(20).default(8),
  /** Uji konfigurasi lain tanpa menyimpannya. */
  settings: z
    .object({
      provider: z.enum(['google', 'openai', 'anthropic']).optional(),
      model: z.string().trim().max(120).optional(),
      apiKey: z.string().trim().max(400).optional(),
      baseUrl: z.string().trim().max(300).optional(),
      useVertex: z.boolean().optional(),
      thinkingLevel: z.enum(['', 'minimal', 'low', 'medium', 'high']).optional(),
      mediaResolution: z.enum(['', 'low', 'medium', 'high']).optional(),
      jsonMode: z.enum(['auto', 'prompt']).optional(),
    })
    .optional(),
  /** Label laporan. */
  label: z.string().trim().max(80).optional(),
});

function secretMatches(given: string | null) {
  const expected = process.env.CRON_SECRET ?? '';
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * POST /api/cron/ai-selftest (X-Cron-Secret atau super admin)
 * Menjalankan analisa ulang pada n foto audit terbaru (tersebar per skor) dengan konfigurasi AI aktif (atau override),
 * lalu menyimpan laporan ke koleksi aiTests: kesepakatan skor vs hasil asli, waktu, token, error.
 */
export async function POST(req: Request) {
  const started = Date.now();
  try {
    let by = 'Cloud Scheduler';
    if (!secretMatches(req.headers.get('x-cron-secret'))) {
      const ctx = await requireProfile(req);
      if (!isSuperAdmin(ctx.profile)) throw new HttpError(403, 'Hanya super admin.');
      by = ctx.profile.name;
    }
    const body = BodySchema.parse(await req.json().catch(() => ({})));
    const base = await loadAiSettings(true);
    const s: AiSettings = { ...base, ...(body.settings ? Object.fromEntries(Object.entries(body.settings).filter(([, v]) => v !== undefined)) : {}) } as AiSettings;

    // sampel: item dengan skor AI & foto dari audit 30 hari terakhir, tersebar per skor
    const db = adminDb();
    const since = new Date(Date.now() - 30 * 86400e3 + 7 * 3600e3).toISOString().slice(0, 10);
    const audits = (await db.collection('audits').where('date', '>=', since).orderBy('date', 'desc').limit(60).get()).docs.map((d) => d.data() as Audit);
    const pool: Array<AuditItem & { storeName: string }> = [];
    for (const a of audits) {
      if (pool.length > 400) break;
      const items = (await db.collection('audits').doc(a.id).collection('items').get()).docs.map((d) => d.data() as AuditItem);
      for (const it of items) if (it.ai?.photoValid && it.ai.score && (it.photoPaths?.length || it.photoPath)) pool.push({ ...it, storeName: a.storeName });
    }
    if (pool.length === 0) throw new HttpError(400, 'Tidak ada foto audit untuk diuji.');
    const perScore = Math.max(1, Math.ceil(body.n / 5));
    const sample: typeof pool = [];
    for (let sc = 1; sc <= 5 && sample.length < body.n; sc += 1) {
      const c = pool.filter((p) => p.ai?.score === sc).sort((a, b) => (b.capturedAt ?? 0) - (a.capturedAt ?? 0)).slice(0, perScore);
      sample.push(...c);
    }
    for (const p of pool.sort((a, b) => (b.capturedAt ?? 0) - (a.capturedAt ?? 0))) {
      if (sample.length >= body.n) break;
      if (!sample.includes(p)) sample.push(p);
    }

    const bucket = adminBucket();
    const items: AiTestItem[] = [];
    for (const it of sample.slice(0, body.n)) {
      if (Date.now() - started > 240_000) break; // sisakan waktu untuk menyimpan laporan
      const paths = (it.photoPaths?.length ? it.photoPaths : it.photoPath ? [it.photoPath] : []).slice(0, 3);
      const images: Array<{ base64: string; mediaType: 'image/jpeg' }> = [];
      for (const p of paths) {
        try {
          const [buf] = await bucket.file(p).download();
          images.push({ base64: buf.toString('base64'), mediaType: 'image/jpeg' });
        } catch {
          /* foto hilang */
        }
      }
      const t0 = Date.now();
      const row: AiTestItem = { area: it.area, store: it.storeName.replace(/^Almaz Fried Chicken\s*-\s*/i, ''), photos: images.length, orig: it.ai?.score ?? null, score: null, photoValid: null, coverage: null, ms: 0, usage: null, error: null, findings: null };
      if (images.length === 0) {
        row.error = 'foto tidak ditemukan di storage';
      } else {
        try {
          const ai = await analyzeCleanliness({ images, area: it.area, category: it.category, standard: it.standard, mustSee: mustSeeText(it.indicatorId ?? it.id), crewNote: null }, s);
          row.score = ai.photoValid ? ai.score : null;
          row.photoValid = ai.photoValid;
          row.coverage = ai.coverage ?? null;
          row.usage = ai.usage ?? null;
          row.findings = ai.findings.slice(0, 200);
        } catch (e) {
          row.error = (e instanceof Error ? e.message : String(e)).slice(0, 300);
        }
      }
      row.ms = Date.now() - t0;
      items.push(row);
    }
    const ok = items.filter((r) => !r.error);
    const scored = ok.filter((r) => r.score !== null && r.orig !== null);
    const report: AiTestReport = {
      id: db.collection('aiTests').doc().id,
      at: Date.now(),
      by: body.label ? `${by} · ${body.label}` : by,
      provider: s.provider,
      model: s.model,
      baseUrl: s.provider === 'openai' ? s.baseUrl : s.useVertex ? 'vertex' : 'gemini-api',
      n: items.length,
      ok: ok.length,
      failed: items.length - ok.length,
      exactAgree: scored.filter((r) => r.score === r.orig).length,
      passAgree: scored.filter((r) => (r.score ?? 0) >= 4 === (r.orig ?? 0) >= 4).length,
      avgMs: ok.length ? Math.round(ok.reduce((a, r) => a + r.ms, 0) / ok.length) : 0,
      avgPromptTokens: ok.length ? Math.round(ok.reduce((a, r) => a + (r.usage?.promptTokens ?? 0), 0) / ok.length) : 0,
      avgOutputTokens: ok.length ? Math.round(ok.reduce((a, r) => a + (r.usage?.outputTokens ?? 0) + (r.usage?.thoughtTokens ?? 0), 0) / ok.length) : 0,
      items,
    };
    await db.collection('aiTests').doc(report.id).set(report);
    return NextResponse.json({ report });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: 'Input tidak valid.', issues: err.issues }, { status: 400 });
    return jsonError(err);
  }
}
