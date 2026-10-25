#!/usr/bin/env node
// Pengaman "satu kiriman per sesi per hari" untuk workflow WA Blast (berlaku untuk run terjadwal dan dispatch action=auto).
// Cron GitHub sering telat (10 menit sampai 2 jam) dan kadang dilewati, jadi workflow dijadwalkan tiap 10 menit selama 2 jam
// setelah tiap jam kirim. Run pertama yang benar-benar jalan yang mengirim; run berikutnya pada sesi yang sama dilewati karena
// menemukan artifact penanda "sent-<YYYYMMDD>-<pagi|siang>" yang diunggah workflow hanya setelah kiriman nyata berhasil.
// Run manual (workflow_dispatch) tidak pernah dilewati: itu perintah eksplisit; penandanya tetap dibuat agar cron sesudahnya diam.
//
// Env (semua disediakan GitHub Actions): GITHUB_API_URL, GITHUB_REPOSITORY, GITHUB_EVENT_NAME, GITHUB_TOKEN
// (butuh permissions actions: read), GITHUB_OUTPUT. Output: slot=<kunci sesi>, skip=true|false.
import { appendFileSync } from "node:fs";

const API = (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, "");
const REPO = process.env.GITHUB_REPOSITORY || "psmnabawi-web/nabawi";
const EVENT = process.env.GITHUB_EVENT_NAME || "";
// AUTO = run terjadwal (cron GitHub) atau dispatch dengan action=auto (pemicu luar/Claude): boleh dilewati bila sesi sudah terkirim.
const AUTO = EVENT === "schedule" || process.env.WA_AUTO === "true";
const headers = { Accept: "application/vnd.github+json", "User-Agent": "wa-blast-dedupe" };
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

// Kunci sesi menurut jam WIB saat run berjalan: sebelum 12.00 = pagi (jadwal 09.00), selebihnya = siang (jadwal 14.00).
export function wib(d = new Date()) {
  return Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(d).filter(x => x.type !== "literal").map(x => [x.type, x.value]));
}
export function slotKey(d = new Date()) { const p = wib(d); return `${p.year}${p.month}${p.day}-${+p.hour < 12 ? "pagi" : "siang"}`; }
// Jendela mode auto: boleh mengirim 08.50-11.59 (sesi pagi) dan 13.30-16.59 (sesi siang) WIB. Di luar itu run dilewati: slot pagi
// yang baru jalan pukul 12.30 jangan mengirim "laporan siang" lebih awal, dan slot yang telat berjam-jam jangan mengirim malam hari.
// Batas bawah siang 13.30 karena cron GitHub di repo ini terbukti sering jalan 13.43-13.51 WIB; laporan 15 menit lebih awal
// lebih baik daripada tidak terkirim (kejadian 23-24 Okt 2026). action=send (perintah manual eksplisit) tidak terkena aturan ini.
export function inBackupWindow(d = new Date()) {
  const p = wib(d), m = +p.hour * 60 + +p.minute;
  return (m >= 8 * 60 + 50 && m < 12 * 60) || (m >= 13 * 60 + 30 && m < 17 * 60);
}

function out(k, v) { if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`); }
function finish(skip, why) { console.log(`${skip ? "LEWATI" : "LANJUT"}: ${why}`); out("skip", skip); }

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const slot = slotKey();
  out("slot", slot);
  console.log(`Sesi: ${slot} · event: ${EVENT || "(lokal)"} · auto: ${AUTO}`);
  if (!AUTO) finish(false, "bukan mode auto/jadwal (perintah eksplisit), tidak pernah dilewati");
  else if (!inBackupWindow()) { const p = wib(); finish(true, `mode auto di luar jendela (sekarang ${p.hour}.${p.minute} WIB; jendela 08.50-11.59 dan 13.30-16.59)`); }
  else {
    try {
      const r = await fetch(`${API}/repos/${REPO}/actions/artifacts?name=sent-${slot}&per_page=5`, { headers, signal: AbortSignal.timeout(20_000) });
      if (!r.ok) throw new Error(`GitHub API artifacts: HTTP ${r.status}`);
      const hit = ((await r.json()).artifacts || []).find(a => !a.expired);
      if (hit) finish(true, `sesi ${slot} sudah dikirim oleh run ${hit.workflow_run?.id ?? "?"} (${hit.created_at})`);
      else finish(false, `belum ada kiriman untuk sesi ${slot}`);
    } catch (e) {
      // Bila pengecekan gagal, lebih aman tetap mengirim daripada diam (risiko ganda kecil, risiko tidak terkirim nyata).
      console.log(`::warning::pengecekan kiriman ganda gagal (${e.message}); lanjut mengirim`);
      finish(false, "pengecekan gagal, tetap kirim");
    }
  }
}
