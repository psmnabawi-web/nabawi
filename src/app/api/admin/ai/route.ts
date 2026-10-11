import { NextResponse } from 'next/server';
import { z } from 'zod/v4';
import { requireProfile, jsonError, writeAuditLog, requireSuperAdmin } from '@/lib/auth-server';
import { adminDb } from '@/lib/firebase/admin';
import { AI_DOC, invalidateAiSettings, loadAiSettings, maskKey } from '@/lib/server/aiSettings';
import type { AiTestReport } from '@/lib/types';

export const runtime = 'nodejs';

/** GET /api/admin/ai -> pengaturan provider AI (key disamarkan) + 5 hasil uji terakhir. Super admin. */
export async function GET(req: Request) {
  try {
    const ctx = await requireProfile(req);
    requireSuperAdmin(ctx);
    const s = await loadAiSettings(true);
    const tests = (await adminDb().collection('aiTests').orderBy('at', 'desc').limit(5).get()).docs.map((d) => {
      const t = d.data() as AiTestReport;
      return { ...t, items: t.items.slice(0, 40) };
    });
    return NextResponse.json({ settings: { ...s, apiKey: maskKey(s.apiKey) }, hasKey: !!s.apiKey, tests });
  } catch (err) {
    return jsonError(err);
  }
}

const Schema = z.object({
  provider: z.enum(['google', 'openai', 'anthropic']),
  model: z.string().trim().max(120),
  /** Kosong = key lama dipertahankan. */
  apiKey: z.string().trim().max(400).optional(),
  baseUrl: z.string().trim().max(300).default(''),
  useVertex: z.boolean().default(false),
  thinkingLevel: z.enum(['', 'minimal', 'low', 'medium', 'high']).default(''),
  mediaResolution: z.enum(['', 'low', 'medium', 'high']).default(''),
  maxConcurrent: z.number().int().min(1).max(8).default(2),
  jsonMode: z.enum(['auto', 'prompt']).default('auto'),
  extraBody: z.record(z.string(), z.unknown()).default({}),
});

/** PUT /api/admin/ai -> simpan pengaturan provider AI. Super admin. */
export async function PUT(req: Request) {
  try {
    const ctx = await requireProfile(req);
    requireSuperAdmin(ctx);
    const body = Schema.parse(await req.json());
    const cur = await loadAiSettings(true);
    const next = { ...body, apiKey: body.apiKey ? body.apiKey : cur.apiKey, updatedAt: Date.now(), updatedByName: ctx.profile.name };
    await adminDb().doc(AI_DOC).set(next, { merge: true });
    invalidateAiSettings();
    await writeAuditLog(ctx, { action: 'UPDATE_AI_SETTINGS', entity: 'ai', entityId: 'settings', details: { provider: next.provider, model: next.model, baseUrl: next.baseUrl, useVertex: next.useVertex, thinkingLevel: next.thinkingLevel, mediaResolution: next.mediaResolution, keyChanged: !!body.apiKey } });
    const s = await loadAiSettings(true);
    return NextResponse.json({ settings: { ...s, apiKey: maskKey(s.apiKey) }, hasKey: !!s.apiKey });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: 'Input tidak valid.', issues: err.issues }, { status: 400 });
    return jsonError(err);
  }
}
