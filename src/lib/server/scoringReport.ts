import 'server-only';
import { adminDb } from '../firebase/admin';
import type { Audit, Store } from '../types';

export interface StoreStatus {
  name: string;
  state: 'done' | 'draft' | 'none';
  pct: number | null;
  grade: string | null;
  finished: number;
  total: number;
}

export interface ScoringReport {
  date: string; // YYYY-MM-DD (WIB)
  timeLabel: string; // HH.MM WIB
  totalStores: number;
  started: number; // done + draft
  done: number;
  draft: number;
  none: number;
  pctStarted: number;
  rows: StoreStatus[];
  text: string;
}

const WIB_OFFSET_MS = 7 * 3600_000;
const short = (name: string) => name.replace(/^Almaz Fried Chicken\s*-\s*/i, '');

/** Tanggal & jam Jakarta dari timestamp. */
export function wibParts(ms: number) {
  const d = new Date(ms + WIB_OFFSET_MS);
  const iso = d.toISOString();
  const hh = iso.slice(11, 13);
  const mm = iso.slice(14, 16);
  const dayName = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'][d.getUTCDay()];
  return { date: iso.slice(0, 10), timeLabel: `${hh}.${mm} WIB`, dayName, dateLabel: `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` };
}

/** Status scoring semua store aktif pada tanggal tertentu + teks siap kirim (format WhatsApp). */
export async function buildScoringReport(now = Date.now(), dateOverride?: string): Promise<ScoringReport> {
  const w = wibParts(now);
  const date = dateOverride ?? w.date;
  const db = adminDb();
  const stores = (await db.collection('stores').get()).docs.map((d) => d.data() as Store).filter((s) => s.active);
  const audits = (await db.collection('audits').where('date', '==', date).get()).docs.map((d) => d.data() as Audit);
  const byStore = new Map<string, Audit[]>();
  for (const a of audits) byStore.set(a.storeId, [...(byStore.get(a.storeId) ?? []), a]);

  const rows: StoreStatus[] = stores
    .map((s): StoreStatus => {
      const list = byStore.get(s.id) ?? [];
      const done = list.find((a) => a.status === 'submitted');
      const draft = list.find((a) => a.status === 'draft');
      const pick = done ?? draft;
      const total = (pick?.summary.itemCount ?? 0) + (pick?.summary.skippedCount ?? 0);
      const finished = (pick?.summary.lockedCount ?? 0) + (pick?.summary.skippedCount ?? 0);
      return { name: short(s.name), state: done ? 'done' : draft ? 'draft' : 'none', pct: pick?.summary.pct ?? null, grade: pick?.summary.grade ?? null, finished, total };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const done = rows.filter((r) => r.state === 'done');
  const draft = rows.filter((r) => r.state === 'draft');
  const none = rows.filter((r) => r.state === 'none');
  const started = done.length + draft.length;
  const pctStarted = rows.length ? Math.round((started / rows.length) * 100) : 0;
  const fmtPct = (p: number | null) => (p === null ? '-' : `${Math.round(p)}%`);

  const lines: string[] = [];
  lines.push(`*Laporan Scoring Kebersihan Almaz*`);
  lines.push(`${w.dayName}, ${dateOverride ? dateOverride.split('-').reverse().join('/') : w.dateLabel} · ${w.timeLabel}`);
  lines.push('');
  lines.push(`✅ *Sudah scoring: ${started} dari ${rows.length} store (${pctStarted}%)*`);
  if (done.length) {
    lines.push(`Selesai (${done.length}):`);
    for (const r of done) lines.push(`• ${r.name} — ${fmtPct(r.pct)}${r.grade ? ` (${r.grade})` : ''}`);
  }
  if (draft.length) {
    lines.push(`Sedang proses (${draft.length}):`);
    for (const r of draft) lines.push(`• ${r.name} — ${r.finished}/${r.total} area${r.pct !== null ? `, sementara ${fmtPct(r.pct)}` : ''}`);
  }
  lines.push('');
  lines.push(`❌ *Belum scoring: ${none.length} store (${100 - pctStarted}%)*`);
  for (const r of none) lines.push(`• ${r.name}`);
  if (none.length === 0) lines.push('Semua store sudah mulai scoring. 👍');
  lines.push('');
  lines.push(none.length ? 'Mohon store yang belum segera melakukan scoring hari ini.' : 'Terima kasih, pertahankan.');

  return { date, timeLabel: w.timeLabel, totalStores: rows.length, started, done: done.length, draft: draft.length, none: none.length, pctStarted, rows, text: lines.join('\n') };
}
