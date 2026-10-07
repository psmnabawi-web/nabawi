import 'server-only';
import { adminDb } from '../firebase/admin';
import type { NotifySettings } from '../types';
import { HttpError } from '../utils';

export const NOTIFY_DOC = 'settings/notify';

export const DEFAULT_NOTIFY: NotifySettings = { enabled: false, provider: 'fonnte', token: '', target: '', baseUrl: '', schedule: '09.00 & 14.00 WIB', updatedAt: 0, updatedByName: null, lastSentAt: null, lastResult: null };

export async function loadNotifySettings(): Promise<NotifySettings> {
  const snap = await adminDb().doc(NOTIFY_DOC).get();
  return snap.exists ? { ...DEFAULT_NOTIFY, ...(snap.data() as Partial<NotifySettings>) } : DEFAULT_NOTIFY;
}

/** Token disamarkan untuk ditampilkan di UI. */
export function maskToken(t: string) {
  if (!t) return '';
  return t.length <= 6 ? '•'.repeat(t.length) : `${'•'.repeat(Math.max(4, t.length - 4))}${t.slice(-4)}`;
}

/** Daftar tujuan efektif: targets, atau target tunggal lama. */
export function targetsOf(s: NotifySettings): string[] {
  const list = (s.targets && s.targets.length ? s.targets : [s.target]).map((t) => t.trim()).filter(Boolean);
  return [...new Set(list)];
}

export function isConfigured(s: NotifySettings) {
  if (!s.token || targetsOf(s).length === 0) return false;
  if (s.provider === 'wablas' && !s.baseUrl) return false;
  return true;
}

const TIMEOUT_MS = 20_000;

async function post(url: string, init: RequestInit): Promise<{ status: number; body: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    return { status: res.status, body: (await res.text()).slice(0, 500) };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Kirim teks ke grup lewat provider yang dipilih.
 * - fonnte  : POST https://api.fonnte.com/send (Authorization: <token>), target = id grup xxx@g.us
 * - wablas  : POST <baseUrl>/api/send-message (Authorization: <token>.<secret>), phone = id grup, isGroup=true
 * - telegram: POST https://api.telegram.org/bot<token>/sendMessage, chat_id = id grup (negatif)
 */
export async function sendNotification(s: NotifySettings, text: string): Promise<{ ok: boolean; detail: string; results: { target: string; ok: boolean; detail: string }[] }> {
  if (!isConfigured(s)) throw new HttpError(400, 'Notifikasi belum dikonfigurasi (token/target kosong).');
  const results: { target: string; ok: boolean; detail: string }[] = [];
  for (const target of targetsOf(s)) {
    try {
      results.push({ target, ...(await sendOne(s, target, text)) });
    } catch (e) {
      results.push({ target, ok: false, detail: e instanceof Error ? e.message : 'gagal' });
    }
  }
  const ok = results.every((r) => r.ok);
  const detail = results.map((r) => `${r.target}: ${r.ok ? 'OK' : 'GAGAL'} ${r.detail.slice(0, 160)}`).join(' | ');
  return { ok, detail, results };
}

async function sendOne(s: NotifySettings, target: string, text: string): Promise<{ ok: boolean; detail: string }> {
  let r: { status: number; body: string };
  if (s.provider === 'fonnte') {
    r = await post('https://api.fonnte.com/send', { method: 'POST', headers: { Authorization: s.token, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ target, message: text, countryCode: '0' }) });
    const ok = r.status < 300 && /"status"\s*:\s*true/.test(r.body);
    return { ok, detail: `${r.status} ${r.body}` };
  }
  if (s.provider === 'wablas') {
    const base = s.baseUrl.replace(/\/+$/, '');
    r = await post(`${base}/api/send-message`, { method: 'POST', headers: { Authorization: s.token, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ phone: target, message: text, isGroup: 'true' }) });
    const ok = r.status < 300 && /"status"\s*:\s*true/.test(r.body);
    return { ok, detail: `${r.status} ${r.body}` };
  }
  // telegram: Bot API memakai HTML/Markdown; teks kita pakai *bold* gaya WhatsApp -> ganti ke <b>
  const html = text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string).replace(/\*([^*\n]+)\*/g, '<b>$1</b>');
  r = await post(`https://api.telegram.org/bot${s.token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: target, text: html, parse_mode: 'HTML' }) });
  const ok = r.status < 300 && /"ok"\s*:\s*true/.test(r.body);
  return { ok, detail: `${r.status} ${r.body}` };
}

export async function recordSendResult(ok: boolean, detail: string) {
  await adminDb().doc(NOTIFY_DOC).set({ lastSentAt: Date.now(), lastResult: `${ok ? 'OK' : 'GAGAL'} · ${detail.slice(0, 300)}` }, { merge: true });
}
