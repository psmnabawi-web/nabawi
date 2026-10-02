#!/usr/bin/env node
// Blast pencapaian ke grup WhatsApp secara terjadwal.
//
// Cara kerja: membuka Dashboard Inti Warna secara headless (Chromium/Playwright), menunggu data Google Sheet
// termuat, mengambil pesan yang PERSIS sama dengan tombol "Kirim WA" di dashboard (window.SSSG.wa(mode)),
// lalu mengirimkannya ke grup lewat gateway WhatsApp (Fonnte / Wablas / webhook generik).
//
// Dipakai oleh .github/workflows/wa-blast.yml (jadwal 09.00 & 14.00 WIB) dan bisa dijalankan manual:
//   node scripts/wa-blast.mjs                      # ACTION=send: kirim (gagal bila konfigurasi tidak lengkap)
//   ACTION=dry_run node scripts/wa-blast.mjs       # susun pesan saja, simpan ke wa-out/, tidak mengirim
//   ACTION=list_groups node scripts/wa-blast.mjs   # (Fonnte) tulis daftar grup + ID ke wa-out/daftar-grup.txt
//
// Env (isi lewat GitHub Secrets/Variables, jangan ditulis di kode):
//   SSSG_URL          URL dashboard (default https://dashboard-inti-warna.web.app/#exec)
//   WA_GATEWAY        fonnte | wablas | webhook
//   WA_TOKEN          Fonnte: token device · Wablas: "token.secret_key" (gabung dengan titik) · webhook: bearer token (opsional)
//   WA_API_URL        Wablas: domain server (mis. https://jogja.wablas.com) · webhook: URL tujuan POST (wajib https)
//   WA_TARGET_BOD     ID grup WhatsApp untuk BOD/manajemen (pesan rinci, dengan rupiah), format 1203…@g.us
//   WA_TARGET_LEADER  ID grup WhatsApp untuk Grup Leader (pesan persentase, tanpa rupiah)
//   WA_MODE_BOD       detail | compact | pct (default detail)
//   WA_MODE_LEADER    pct (default). Mode lain (yang memuat rupiah) hanya bila WA_LEADER_ALLOW_RUPIAH=1
//   WA_HEADER         teks pembuka opsional (default: "Laporan otomatis · <waktu WIB>")
//   OUT_DIR           folder salinan pesan (default wa-out)
//   ACTION            send (default) | dry_run | list_groups
//   PLAYWRIGHT_PATH / PLAYWRIGHT_CHROMIUM_PATH  lokasi modul & browser bila tidak di node_modules (uji lokal)
//   WA_TEST_ROUTES    (uji lokal saja, diabaikan di GitHub Actions) modul ESM: export default async (page) => {...}

import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const env = (k, d = "") => (process.env[k] ?? d).toString().trim();
const IN_CI = !!process.env.GITHUB_ACTIONS;
const URL_DASH = env("SSSG_URL", "https://dashboard-inti-warna.web.app/#exec");
const GATEWAY = env("WA_GATEWAY").toLowerCase();
const TOKEN = env("WA_TOKEN");
const API_URL = env("WA_API_URL").replace(/\/+$/, "");
const ACTION = env("ACTION", "send").toLowerCase();
const OUT_DIR = env("OUT_DIR", "wa-out");
const MODES = ["detail", "compact", "pct"];
const TARGETS = [
  { name: "BOD", id: env("WA_TARGET_BOD"), mode: env("WA_MODE_BOD", "detail") || "detail" },
  { name: "Grup Leader", id: env("WA_TARGET_LEADER"), mode: env("WA_MODE_LEADER", "pct") || "pct" },
];
const nowWib = () => new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date()).replace(/\./g, ":") + " WIB";
const HEADER = env("WA_HEADER") || `_Laporan otomatis · ${nowWib()}_`;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const warn = (m) => console.log(IN_CI ? `::warning::${m}` : `PERINGATAN: ${m}`);
const fail = (m) => { console.error(IN_CI ? `::error::${m}` : `ERROR: ${m}`); process.exit(1); };
// Jangan pernah menulis token, ID grup, atau isi balasan gateway ke log (log Actions di repo publik bisa dibaca siapa saja).
const isGroup = (t) => /@g\.us$/i.test(t);
const describeTarget = (t) => (isGroup(t) ? "grup" : "nomor") + " (" + t.length + " karakter)";

// ---------- validasi konfigurasi ----------
function validate() {
  if (ACTION !== "send" && ACTION !== "dry_run" && ACTION !== "list_groups") fail(`ACTION "${ACTION}" tidak dikenal (send | dry_run | list_groups)`);
  for (const t of TARGETS) if (!MODES.includes(t.mode)) fail(`Mode "${t.mode}" untuk ${t.name} tidak dikenal (detail | compact | pct)`);
  const leader = TARGETS[1];
  if (leader.mode !== "pct" && env("WA_LEADER_ALLOW_RUPIAH") !== "1") fail(`WA_MODE_LEADER="${leader.mode}" memuat angka rupiah. Grup Leader seharusnya "pct". Bila memang disengaja, set variabel WA_LEADER_ALLOW_RUPIAH=1.`);
  if (ACTION === "dry_run") return { dry: true, reason: "ACTION=dry_run" };
  // send / list_groups: konfigurasi gateway harus lengkap
  if (!GATEWAY && !TOKEN && !TARGETS.some(t => t.id)) {
    if (ACTION === "send") { warn("Gateway WhatsApp belum dikonfigurasi (WA_GATEWAY, WA_TOKEN, WA_TARGET_*). Berjalan sebagai dry-run; isi secret untuk mulai mengirim."); return { dry: true, reason: "gateway belum dikonfigurasi" }; }
    fail("Gateway WhatsApp belum dikonfigurasi (WA_GATEWAY, WA_TOKEN).");
  }
  if (!["fonnte", "wablas", "webhook"].includes(GATEWAY)) fail(`WA_GATEWAY "${GATEWAY || "(kosong)"}" tidak dikenal (fonnte | wablas | webhook)`);
  if (GATEWAY !== "webhook" && !TOKEN) fail("WA_TOKEN kosong padahal WA_GATEWAY sudah diisi.");
  if (GATEWAY !== "fonnte") {
    if (!API_URL) fail(`WA_API_URL wajib untuk gateway ${GATEWAY}`);
    if (!/^https:\/\//i.test(API_URL) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/i.test(API_URL)) fail("WA_API_URL harus memakai https:// (http hanya diizinkan untuk uji di 127.0.0.1/localhost)");
  }
  if (ACTION === "send" && !TARGETS.some(t => t.id)) fail("WA_TARGET_BOD dan WA_TARGET_LEADER kosong: tidak ada tujuan pengiriman.");
  return { dry: false, reason: "" };
}

// ---------- gateway ----------
class GatewayError extends Error { constructor(msg, retryable) { super(msg); this.retryable = retryable; } }
async function request(url, init) {
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 45_000);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, redirect: "error" });
    const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* bukan JSON */ }
    return { status: res.status, ok: res.ok, json };
  } catch (e) {
    // Timeout = status kiriman tidak pasti (bisa saja sudah terkirim) → jangan diulang. Koneksi gagal sebelum terkirim → boleh diulang.
    if (e && e.name === "AbortError") throw new GatewayError("gateway tidak merespons dalam 45 detik", false);
    throw new GatewayError(`koneksi ke gateway gagal (${e && e.code ? e.code : e && e.name ? e.name : "network"})`, true);
  } finally { clearTimeout(timer); }
}
const form = (fields) => ({ method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields) });
const reasonOf = (r) => { const j = r.json || {}; const s = [j.reason, j.message, j.detail, j.error].find(v => typeof v === "string" && v); return `HTTP ${r.status}${s ? " · " + s.slice(0, 120) : ""}`; };
async function sendOnce(target, message) {
  if (GATEWAY === "fonnte") {
    const r = await request("https://api.fonnte.com/send", { ...form({ target, message, countryCode: "62" }), headers: { Authorization: TOKEN, "Content-Type": "application/x-www-form-urlencoded" } });
    if (r.ok && r.json && r.json.status === true) return "diterima gateway";
    throw new GatewayError(`gateway menolak: ${reasonOf(r)}`, r.status >= 500);
  }
  if (GATEWAY === "wablas") {
    // Wablas: Authorization = "token.secret_key"; pengiriman ke grup wajib isGroup=true.
    const r = await request(`${API_URL}/api/send-message`, { ...form({ phone: target, message, isGroup: isGroup(target) ? "true" : "false" }), headers: { Authorization: TOKEN, "Content-Type": "application/x-www-form-urlencoded" } });
    if (r.ok && r.json && r.json.status === true) return "diterima gateway";
    throw new GatewayError(`gateway menolak: ${reasonOf(r)}`, r.status >= 500);
  }
  if (GATEWAY === "webhook") {
    const headers = { "Content-Type": "application/json" }; if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
    const r = await request(API_URL, { method: "POST", headers, body: JSON.stringify({ target, message }) });
    if (r.ok) return `diterima (HTTP ${r.status})`;
    throw new GatewayError(`webhook menolak: HTTP ${r.status}`, r.status >= 500);
  }
  throw new GatewayError(`WA_GATEWAY "${GATEWAY}" tidak dikenal`, false);
}
async function send(target, message) {
  try { return await sendOnce(target, message); }
  catch (e) {
    if (!(e instanceof GatewayError) || !e.retryable) throw e;
    log(`  gagal (${e.message}); kiriman dipastikan belum masuk, ulangi sekali dalam 5 detik…`);
    await new Promise(r => setTimeout(r, 5000));
    return sendOnce(target, message);
  }
}
async function listGroups() {
  if (GATEWAY !== "fonnte") fail("ACTION=list_groups hanya untuk gateway fonnte. Untuk Wablas, ID grup ada di menu Group pada panel Wablas.");
  const auth = { Authorization: TOKEN, "Content-Type": "application/x-www-form-urlencoded" };
  // Fonnte: /fetch-group menyegarkan daftar grup di server, /get-whatsapp-group membacanya.
  const f = await request("https://api.fonnte.com/fetch-group", { ...form({}), headers: auth });
  if (!(f.json && f.json.status === true)) warn(`fetch-group: ${reasonOf(f)} (lanjut membaca daftar yang tersimpan)`);
  const r = await request("https://api.fonnte.com/get-whatsapp-group", { ...form({}), headers: auth });
  if (!(r.json && r.json.status === true)) fail(`get-whatsapp-group gagal: ${reasonOf(r)}`);
  const data = Array.isArray(r.json.data) ? r.json.data : [];
  mkdirSync(OUT_DIR, { recursive: true });
  const file = join(OUT_DIR, "daftar-grup.txt");
  writeFileSync(file, [`Daftar grup pada nomor gateway (${data.length}) · ${nowWib()}`, "", ...data.map(g => `${g.id || g.jid || "?"}\t${g.name || g.subject || ""}`), "", "Salin ID (format 1203…@g.us) ke secret WA_TARGET_BOD / WA_TARGET_LEADER, lalu HAPUS artifact ini dari halaman run."].join("\n"), "utf8");
  log(`${data.length} grup ditulis ke ${file} (tidak dicetak ke log karena log repo publik bisa dibaca siapa saja).`);
}

// ---------- dashboard headless ----------
function loadPlaywright() {
  const require = createRequire(import.meta.url);
  for (const p of ["playwright", env("PLAYWRIGHT_PATH")].filter(Boolean)) { try { return require(p); } catch { /* coba berikutnya */ } }
  throw new Error("Modul playwright tidak ditemukan. Jalankan: npm install && npx playwright install --with-deps chromium (di folder apps/sssg-dashboard)");
}
async function buildMessages(modes) {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ executablePath: env("PLAYWRIGHT_CHROMIUM_PATH") || undefined, args: ["--no-sandbox"] });
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "id-ID", timezoneId: "Asia/Jakarta" })).newPage();
    const errors = []; page.on("pageerror", e => errors.push(e.message));
    if (env("WA_TEST_ROUTES")) { if (IN_CI) warn("WA_TEST_ROUTES diabaikan di GitHub Actions."); else { const m = await import(pathToFileURL(env("WA_TEST_ROUTES")).href); await m.default(page); } }
    log(`membuka ${URL_DASH}`);
    await page.goto(URL_DASH, { waitUntil: "domcontentloaded", timeout: 90_000 });
    const t0 = Date.now(); let st = null;
    while (Date.now() - t0 < 180_000) {
      st = await page.evaluate(() => window.SSSG ? window.SSSG.status() : null).catch(() => null);
      if (st && (st.months > 0 || (st.error && !/^Memuat/.test(st.text)))) break;
      if (!st && errors.length && Date.now() - t0 > 20_000) break; // app.js gagal sebelum window.SSSG dibuat
      await page.waitForTimeout(1500);
    }
    if (!st) throw new Error("window.SSSG tidak tersedia: dashboard gagal dimuat" + (errors.length ? ` (${errors[0].slice(0, 160)})` : " atau versi dashboard belum mendukung otomasi"));
    if (!(st.months > 0)) throw new Error(st.error ? `dashboard gagal memuat data: ${st.text}` : `data belum termuat setelah 3 menit: ${st.text}`);
    if (st.error) warn(`halaman menampilkan error setelah data termuat (pesan tetap disusun dari data): ${st.text.slice(0, 160)}`);
    log(`data termuat: ${st.text}`);
    // tunggu sheet sales ikut selesai (maksimal 20 detik)
    const t1 = Date.now(); while (Date.now() - t1 < 20_000) { const s2 = await page.evaluate(() => window.SSSG.status()); if (s2.sales > 0 || s2.salesErr) { if (s2.salesErr) warn(`sheet sales tidak terbaca, bagian sales dilewati: ${String(s2.salesErr).slice(0, 160)}`); break; } await page.waitForTimeout(1000); }
    const out = {};
    for (const mode of modes) { out[mode] = await page.evaluate(m => window.SSSG.wa(m), mode); if (!out[mode]) throw new Error(`pesan mode "${mode}" kosong (tidak ada data target untuk periode ini)`); }
    return { messages: out, status: st };
  } finally { await browser.close(); }
}

// ---------- main ----------
(async () => {
  const { dry, reason } = validate();
  log(`action=${ACTION} gateway=${GATEWAY || "(belum diisi)"} token=${TOKEN ? "terisi" : "kosong"} dry_run=${dry}${reason ? ` (${reason})` : ""}`);
  if (ACTION === "list_groups") { await listGroups(); return; }
  const active = TARGETS.filter(t => t.id || dry);
  const modes = [...new Set(active.map(t => t.mode))];
  const { messages } = await buildMessages(modes);
  mkdirSync(OUT_DIR, { recursive: true });
  let sent = 0, failed = 0;
  for (const t of active) {
    const text = `${HEADER}\n\n${messages[t.mode]}`;
    const file = join(OUT_DIR, `${t.name.replace(/\s+/g, "-").toLowerCase()}-${t.mode}.txt`);
    writeFileSync(file, text, "utf8");
    log(`${t.name}: mode ${t.mode}, ${text.length} karakter → ${file}`);
    if (dry) { log(`  dry-run: tidak dikirim${t.id ? ` (tujuan ${describeTarget(t.id)})` : " (tujuan belum diisi)"}`); continue; }
    if (!t.id) { warn(`${t.name}: WA_TARGET belum diisi, dilewati`); continue; }
    try { const r = await send(t.id, text); sent++; log(`  terkirim ke ${describeTarget(t.id)} · ${r}`); }
    catch (e) { failed++; console.error(IN_CI ? `::error::${t.name}: GAGAL kirim: ${e.message}` : `  GAGAL kirim ${t.name}: ${e.message}`); }
  }
  if (dry) console.log(`\nDRY RUN selesai. Pesan tersimpan di folder ${OUT_DIR}/.`);
  else console.log(`\nSelesai: ${sent} terkirim, ${failed} gagal.`);
  if (failed) process.exit(1);
})().catch(e => fail(e.message));
