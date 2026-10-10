import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod/v4';
import { requireProfile, jsonError } from '@/lib/auth-server';
import { adminDb } from '@/lib/firebase/admin';
import { loadAiSettings } from '@/lib/server/aiSettings';
import { isSuperAdmin } from '@/lib/types';
import { HttpError } from '@/lib/utils';

export const runtime = 'nodejs';
export const maxDuration = 120;

const Schema = z.object({
  baseUrls: z.array(z.string().trim().url().max(300)).min(1).max(12),
  apiKey: z.string().trim().max(400).optional(),
  /** Jika diisi, kirim juga satu chat completion teks singkat ke model ini. */
  model: z.string().trim().max(120).optional(),
  label: z.string().trim().max(80).optional(),
});

function secretMatches(given: string | null) {
  const expected = process.env.CRON_SECRET ?? '';
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function hit(url: string, init: RequestInit, timeoutMs = 20_000, maxChars = 1500) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = (await res.text()).slice(0, maxChars);
    return { status: res.status, text };
  } catch (e) {
    return { status: 0, text: (e instanceof Error ? `${e.name}: ${e.message}${e.cause ? ' | ' + String((e.cause as Error).message ?? e.cause) : ''}` : String(e)).slice(0, 300) };
  } finally {
    clearTimeout(t);
  }
}

/**
 * POST /api/cron/ai-probe (X-Cron-Secret atau super admin)
 * Untuk tiap base URL: GET {base}/models dan (opsional) POST {base}/chat/completions teks singkat. Hasil disimpan ke aiProbes.
 */
export async function POST(req: Request) {
  try {
    if (!secretMatches(req.headers.get('x-cron-secret'))) {
      const ctx = await requireProfile(req);
      if (!isSuperAdmin(ctx.profile)) throw new HttpError(403, 'Hanya super admin.');
    }
    const body = Schema.parse(await req.json());
    const key = body.apiKey || (await loadAiSettings(true)).apiKey;
    const results: Array<Record<string, unknown>> = [];
    for (const raw of body.baseUrls) {
      const base = raw.replace(/\/+$/, '');
      const models = await hit(`${base}/models`, { headers: { Authorization: `Bearer ${key}` } }, 20_000, 200_000);
      let modelIds: string[] = [];
      try {
        const j = JSON.parse(models.text) as { data?: Array<{ id?: string; vision?: boolean; enabled?: boolean; available?: boolean; grade?: string; modalities?: { input?: string[] } }> };
        modelIds = (j.data ?? [])
          .map((m) => `${m.id ?? ''}${m.vision || m.modalities?.input?.includes('image') ? ' [vision]' : ''}${m.enabled === false || m.available === false ? ' [off]' : ''}${m.grade ? ` (${m.grade})` : ''}`)
          .filter((x) => !x.startsWith(' '))
          .slice(0, 200);
      } catch {
        /* bukan JSON */
      }
      let chat: { status: number; text: string } | null = null;
      if (body.model) {
        chat = await hit(`${base}/chat/completions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: body.model, messages: [{ role: 'user', content: 'Balas satu kata: ok' }], max_tokens: 8, stream: false }),
        }, 40_000);
      }
      results.push({ base, modelsStatus: models.status, modelsHead: modelIds.length ? '' : models.text.slice(0, 300), modelIds, chatStatus: chat?.status ?? null, chatHead: chat?.text.slice(0, 400) ?? null });
    }
    const ref = adminDb().collection('aiProbes').doc();
    await ref.set({ id: ref.id, at: Date.now(), label: body.label ?? null, model: body.model ?? null, results });
    return NextResponse.json({ id: ref.id, results });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: 'Input tidak valid.', issues: err.issues }, { status: 400 });
    return jsonError(err);
  }
}
