#!/usr/bin/env node
// Blast pencapaian ke grup WhatsApp secara terjadwal.
//
// Cara kerja: membuka Dashboard Inti Warna secara headless (Chromium/Playwright), menunggu data Google Sheet
// termuat, mengambil pesan yang PERSIS sama dengan tombol "Kirim WA" di dashboard (window.SSSG.wa(mode)),
// lalu mengirimkannya ke grup lewat gateway WhatsApp (Fonnte / Wablas / webhook generik).
//
// Dipakai oleh .github/workflows/wa-blast.yml (jadwal 09.00 & 14.00 WIB) dan bisa dijalankan manual:
//   node scripts/wa-blast.mjs                      # kirim sesuai env (atau dry-run bila gateway belum diisi)
//   DRY_RUN=1 node scripts/wa-blast.mjs            # susun pesan saja, simpan ke wa-out/, tidak mengirim
//   ACTION=list_groups node scripts/wa-blast.mjs   # (Fonnte) cetak daftar grup + ID untuk diisi ke secret
//
// Env:
//   SSSG_URL          URL dashboard (default https://dashboard-inti-warna.web.app/#exec)
//   WA_GATEWAY        fonnte | wablas | webhook
//   WA_TOKEN          token gateway (JANGAN ditulis di kode; isi lewat GitHub Secrets)
//   WA_API_URL        wablas: domain server (mis. https://jogja.wablas.com) · webhook: URL tujuan POST
//   WA_TARGET_BOD     ID grup WhatsApp untuk BOD/manajemen (pesan rinci, dengan rupiah)
//   WA_TARGET_LEADER  ID grup WhatsApp untuk Grup Leader (pesan persentase, tanpa rupiah)
//   WA_MODE_BOD       detail | compact | pct (default detail)
//   WA_MODE_LEADER    detail | compact | pct (default pct)
//   WA_HEADER         teks pembuka opsional (default: "Laporan otomatis · <waktu WIB>")
//   DRY_RUN           1 = tidak mengirim
//   OUT_DIR           folder untuk menyimpan salinan pesan (default wa-out)
//   ACTION            send (default) | dry_run | list_groups
//   PLAYWRIGHT_PATH / PLAYWRIGHT_CHROMIUM_PATH  lokasi modul & browser bila tidak di node_modules (untuk uji lokal)
//   WA_TEST_ROUTES    (uji lokal) modul ESM yang mengekspor default async (page) => {...} untuk memasang mock route

import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const env = (k, d = "") => (process.env[k] ?? d).toString().trim();
const URL_DASH = env("SSSG_URL", "https://dashboard-inti-warna.web.app/#exec");
const GATEWAY = env("WA_GATEWAY").toLowerCase();
const TOKEN = env("WA_TOKEN");
const API_URL = env("WA_API_URL").replace(/\/+$/, "");
const ACTION = env("ACTION", "send").toLowerCase();
const OUT_DIR = env("OUT_DIR", "wa-out");
const DRY = ACTION === "dry_run" || /^(1|true|yes)$/i.test(env("DRY_RUN")) || !GATEWAY || !TOKEN;
const TARGETS = [
  { name: "BOD", id: env("WA_TARGET_BOD"), mode: env("WA_MODE_BOD", "detail") },
  { name: "Grup Leader", id: env("WA_TARGET_LEADER"), mode: env("WA_MODE_LEADER", "pct") },
];
const nowWib = () => new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date()).replace(/\./g, ":") + " WIB";
const HEADER = env("WA_HEADER") || `_Laporan otomatis · ${nowWib()}_`;
const mask = (s) => (s ? s.slice(0, 3) + "…" + s.slice(-2) : "(kosong)");
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---------- gateway ----------
async function postForm(url, headers, fields) {
  const body = new URLSearchParams(fields);
  const res = await fetch(url, { method: "POST", headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" }, body });
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* bukan JSON */ }
  return { ok: res.ok, status: res.status, json, text: text.slice(0, 500) };
}
async function sendOnce(target, message) {
  if (GATEWAY === "fonnte") {
    const r = await postForm("https://api.fonnte.com/send", { Authorization: TOKEN }, { target, message, countryCode: "62" });
    return { ok: r.ok && !!(r.json && r.json.status === true), detail: r.json ? JSON.stringify(r.json).slice(0, 300) : r.text };
  }
  if (GATEWAY === "wablas") {
    if (!API_URL) throw new Error("WA_API_URL (domain server Wablas, mis. https://jogja.wablas.com) belum diisi");
    const r = await postForm(`${API_URL}/api/send-message`, { Authorization: TOKEN }, { phone: target, message });
    return { ok: r.ok && !!(r.json && r.json.status === true), detail: r.json ? JSON.stringify(r.json).slice(0, 300) : r.text };
  }
  if (GATEWAY === "webhook") {
    if (!API_URL) throw new Error("WA_API_URL (URL webhook) belum diisi");
    const res = await fetch(API_URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ target, message }) });
    return { ok: res.ok, detail: `HTTP ${res.status} ${(await res.text()).slice(0, 300)}` };
  }
  throw new Error(`WA_GATEWAY "${GATEWAY}" tidak dikenal (pilih fonnte | wablas | webhook)`);
}
async function send(target, message) {
  let last = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try { const r = await sendOnce(target, message); if (r.ok) return r; last = new Error(`gateway menolak: ${r.detail}`); }
    catch (e) { last = e; }
    if (attempt === 1) { log(`  percobaan ${attempt} gagal (${last.message}), ulangi dalam 5 detik…`); await new Promise(r => setTimeout(r, 5000)); }
  }
  throw last;
}
async function listGroups() {
  if (GATEWAY !== "fonnte") throw new Error("ACTION=list_groups hanya tersedia untuk gateway fonnte; untuk Wablas lihat menu Group di panel Wablas.");
  if (!TOKEN) throw new Error("WA_TOKEN belum diisi");
  const r = await postForm("https://api.fonnte.com/get-whatsapp-group", { Authorization: TOKEN }, {});
  if (!r.ok || !r.json) throw new Error(`gagal mengambil daftar grup: HTTP ${r.status} ${r.text}`);
  const data = Array.isArray(r.json.data) ? r.json.data : [];
  console.log(`\nDaftar grup di nomor gateway (${data.length}):`);
  for (const g of data) console.log(`  ${g.id || g.jid || "?"}  →  ${g.name || g.subject || ""}`);
  console.log("\nSalin ID grup (format 1203…@g.us) ke secret WA_TARGET_BOD / WA_TARGET_LEADER.");
}

// ---------- dashboard headless ----------
function loadPlaywright() {
  const require = createRequire(import.meta.url);
  for (const p of ["playwright", env("PLAYWRIGHT_PATH")].filter(Boolean)) { try { return require(p); } catch { /* coba berikutnya */ } }
  throw new Error("Modul playwright tidak ditemukan. Jalankan: npm i --no-save playwright && npx playwright install --with-deps chromium");
}
async function buildMessages(modes) {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ executablePath: env("PLAYWRIGHT_CHROMIUM_PATH") || undefined, args: ["--no-sandbox"] });
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "id-ID", timezoneId: "Asia/Jakarta" })).newPage();
    const errors = []; page.on("pageerror", e => errors.push(e.message));
    if (env("WA_TEST_ROUTES")) { const m = await import(pathToFileURL(env("WA_TEST_ROUTES")).href); await m.default(page); }
    log(`membuka ${URL_DASH}`);
    await page.goto(URL_DASH, { waitUntil: "domcontentloaded", timeout: 90_000 });
    const t0 = Date.now(); let st = null;
    while (Date.now() - t0 < 180_000) {
      st = await page.evaluate(() => window.SSSG ? window.SSSG.status() : null).catch(() => null);
      if (st && (st.error || (st.months > 0 && !/^Memuat/.test(st.text)))) break;
      await page.waitForTimeout(1500);
    }
    if (!st) throw new Error("window.SSSG tidak tersedia: versi dashboard belum mendukung otomasi atau halaman gagal dimuat" + (errors.length ? ` (${errors[0]})` : ""));
    if (st.error) throw new Error(`dashboard gagal memuat data: ${st.text}`);
    if (!(st.months > 0)) throw new Error(`data belum termuat setelah 3 menit: ${st.text}`);
    log(`data termuat: ${st.text}`); if (st.salesErr) log(`catatan: sheet sales tidak terbaca (${st.salesErr})`);
    // tunggu sheet sales ikut selesai (opsional, maksimal 20 detik)
    const t1 = Date.now(); while (Date.now() - t1 < 20_000) { const s2 = await page.evaluate(() => window.SSSG.status()); if (s2.sales > 0 || s2.salesErr) break; await page.waitForTimeout(1000); }
    const out = {};
    for (const mode of modes) { out[mode] = await page.evaluate(m => window.SSSG.wa(m), mode); if (!out[mode]) throw new Error(`pesan mode "${mode}" kosong (tidak ada data target untuk periode ini)`); }
    return { messages: out, status: st, errors };
  } finally { await browser.close(); }
}

// ---------- main ----------
(async () => {
  log(`gateway=${GATEWAY || "(belum diisi)"} token=${mask(TOKEN)} dry_run=${DRY} action=${ACTION}`);
  if (ACTION === "list_groups") { await listGroups(); return; }
  const active = TARGETS.filter(t => t.id || DRY);
  const modes = [...new Set(active.map(t => t.mode))];
  if (!modes.length) { console.log("Tidak ada target (WA_TARGET_BOD / WA_TARGET_LEADER kosong) dan bukan dry-run. Tidak ada yang dikerjakan."); return; }
  const { messages } = await buildMessages(modes);
  mkdirSync(OUT_DIR, { recursive: true });
  let failed = 0;
  for (const t of active) {
    const text = `${HEADER}\n\n${messages[t.mode]}`;
    const file = join(OUT_DIR, `${t.name.replace(/\s+/g, "-").toLowerCase()}-${t.mode}.txt`);
    writeFileSync(file, text, "utf8");
    log(`${t.name}: mode ${t.mode}, ${text.length} karakter → ${file}`);
    if (DRY) { log(`  dry-run: tidak dikirim${t.id ? ` (target ${mask(t.id)})` : " (target belum diisi)"}`); continue; }
    if (!t.id) { log("  target belum diisi, dilewati"); continue; }
    try { const r = await send(t.id, text); log(`  terkirim ke ${mask(t.id)} · ${r.detail}`); }
    catch (e) { failed++; console.error(`  GAGAL kirim ke ${mask(t.id)}: ${e.message}`); }
  }
  if (DRY) console.log(`\nDRY RUN selesai. Pesan tersimpan di folder ${OUT_DIR}/. Isi secret gateway lalu jalankan lagi untuk mengirim.`);
  if (failed) { console.error(`\n${failed} pengiriman gagal.`); process.exit(1); }
})().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
