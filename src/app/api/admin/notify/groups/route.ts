import { NextResponse } from 'next/server';
import { z } from 'zod/v4';
import { requireProfile, jsonError, requireSuperAdmin } from '@/lib/auth-server';
import { loadNotifySettings } from '@/lib/server/notify';
import { HttpError } from '@/lib/utils';

export const runtime = 'nodejs';

const Schema = z.object({ token: z.string().trim().max(300).optional() });

async function fonnte(path: string, token: string) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch(`https://api.fonnte.com/${path}`, { method: 'POST', headers: { Authorization: token }, signal: ctrl.signal });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      /* bukan JSON */
    }
    return { status: res.status, json, text: text.slice(0, 300) };
  } finally {
    clearTimeout(t);
  }
}

/** POST /api/admin/notify/groups -> daftar grup WhatsApp dari perangkat Fonnte (token dari body, atau yang tersimpan). Super admin. */
export async function POST(req: Request) {
  try {
    const ctx = await requireProfile(req);
    requireSuperAdmin(ctx);
    const body = Schema.parse(await req.json().catch(() => ({})));
    const token = body.token || (await loadNotifySettings()).token;
    if (!token) throw new HttpError(400, 'Token Fonnte belum diisi.');
    await fonnte('fetch-group', token); // segarkan daftar grup di sisi Fonnte
    const r = await fonnte('get-whatsapp-group', token);
    if (r.json.status !== true) throw new HttpError(502, `Fonnte menolak permintaan (${r.status}): ${(r.json.reason as string) ?? r.text}`);
    const raw = Array.isArray(r.json.data) ? (r.json.data as Record<string, unknown>[]) : [];
    const groups = raw.map((g) => ({ id: String(g.id ?? ''), name: String(g.name ?? g.subject ?? '') })).filter((g) => g.id);
    return NextResponse.json({ groups });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: 'Input tidak valid.' }, { status: 400 });
    return jsonError(err);
  }
}
