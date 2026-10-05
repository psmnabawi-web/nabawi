#!/usr/bin/env node
// Blast WhatsApp: persentase store yang SUDAH dan BELUM scoring di app Trecking Filter Oil Store.
//
// Cara kerja: membaca Firestore project trecking-filter-oil-store langsung lewat REST API memakai service account
// read-only (roles/datastore.viewer), menghitung store yang punya data scoring pada tanggal laporan, lalu mengirim
// ringkasannya ke grup WhatsApp lewat gateway (Fonnte / Wablas / webhook). App Filter Oil-nya sendiri tidak disentuh.
//
// Jadwal ada di .github/workflows/filter-oil-wa-blast.yml: 12.00, 18.00, 00.00 WIB.
// Laporan yang dibuat sebelum jam FO_CUTOFF_HOUR WIB (default 06) = REKAP FINAL hari sebelumnya,
// supaya kiriman jam 00.00 tidak berisi "0% sudah scoring" untuk hari yang baru dimulai.
//
//   node scripts/wa-blast.mjs                      # ACTION=send: susun & kirim
//   ACTION=dry_run node scripts/wa-blast.mjs       # susun pesan saja, simpan ke wa-out/, tidak mengirim
//   ACTION=discover node scripts/wa-blast.mjs      # tulis struktur Firestore (nama koleksi, field, tipe; TANPA isi data) ke log
//   ACTION=list_groups node scripts/wa-blast.mjs   # (Fonnte) tulis daftar grup + ID ke wa-out/daftar-grup.txt
//
// Env (isi lewat GitHub Secrets/Variables, jangan ditulis di kode):
//   FO_SA_KEY              JSON service account (atau base64 dari JSON tsb) dengan role Cloud Datastore Viewer
//   FO_PROJECT_ID          default: project_id dari service account
//   FO_STORE_COLLECTION    koleksi master store (default "stores")
//   FO_STORE_NAME_FIELD    field nama store (default: deteksi otomatis name/nama/storeName/...)
//   FO_STORE_ACTIVE_FIELD  field aktif/status store (default: deteksi otomatis active/aktif/isActive/status)
//   FO_STORE_LIST          alternatif master store: daftar nama dipisah koma (dipakai bila diisi)
//   FO_SCORE_COLLECTION    koleksi data scoring, mis. "scorings". Sub-koleksi per store: "stores/{store}/scorings"
//   FO_SCORE_STORE_FIELD   field penunjuk store di data scoring (default: deteksi otomatis storeId/store/namaStore/...)
//   FO_SCORE_DATE_FIELD    field tanggal/waktu scoring (default: deteksi otomatis date/tanggal/createdAt/timestamp/...)
//   FO_SCORE_DATE_FORMAT   khusus tanggal teks "5/10/2026": dmy (default) atau mdy
//   FO_TITLE               judul pesan (default "Scoring Filter Oil")
//   FO_CUTOFF_HOUR         sebelum jam ini (WIB) laporan = rekap final kemarin (default 6)
//   REPORT_DATE            YYYY-MM-DD, paksa tanggal laporan (untuk uji)
//   WA_GATEWAY             fonnte (default) | wablas | webhook
//   WA_TOKEN               Fonnte: token device · Wablas: "token.secret_key" · webhook: bearer token (opsional)
//   WA_API_URL             Wablas: domain server (mis. https://jogja.wablas.com) · webhook: URL tujuan POST (https)
//   WA_TARGET              tujuan, pisahkan dengan koma: ID grup (1203…@g.us) atau NAMA grup persis seperti di WhatsApp
//                          (nama hanya untuk Fonnte; dicari otomatis lewat daftar grup device)
//   OUT_DIR                folder salinan pesan (default wa-out)
//   ACTION                 send (default) | dry_run | discover | list_groups

import { createSign } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const env = (k, d = "") => (process.env[k] ?? d).toString().trim();
const IN_CI = !!process.env.GITHUB_ACTIONS;
const ACTION = env("ACTION", "send").toLowerCase();
const OUT_DIR = env("OUT_DIR", "wa-out");
const GATEWAY = (env("WA_GATEWAY") || "fonnte").toLowerCase();
const TOKEN = env("WA_TOKEN");
const API_URL = env("WA_API_URL").replace(/\/+$/, "");
const TARGETS = env("WA_TARGET").split(/\s*[,;\n]\s*/).filter(Boolean);
const TITLE = env("FO_TITLE") || "Scoring Filter Oil";
const CUTOFF_HOUR = Number(env("FO_CUTOFF_HOUR", "6"));
const REPORT_DATE = env("REPORT_DATE");
const CFG = {
  storeCollection: env("FO_STORE_COLLECTION") || "stores",
  storeNameField: env("FO_STORE_NAME_FIELD"),
  storeActiveField: env("FO_STORE_ACTIVE_FIELD"),
  storeList: env("FO_STORE_LIST"),
  scoreCollection: env("FO_SCORE_COLLECTION"),
  scoreStoreField: env("FO_SCORE_STORE_FIELD"),
  scoreDateField: env("FO_SCORE_DATE_FIELD"),
  dateFormat: env("FO_SCORE_DATE_FORMAT").toLowerCase(),
};
// Alamat & jam pengganti HANYA untuk uji lokal (diabaikan di GitHub Actions).
const testEnv = (k) => (IN_CI ? "" : env(k));
const FIRESTORE_BASE = testEnv("FO_TEST_FIRESTORE_BASE") || "https://firestore.googleapis.com/v1";
const TOKEN_URL = testEnv("FO_TEST_TOKEN_URL") || "https://oauth2.googleapis.com/token";
const FONNTE_BASE = testEnv("FO_TEST_FONNTE_BASE") || "https://api.fonnte.com";
const NOW_MS = testEnv("FO_TEST_NOW") ? Date.parse(testEnv("FO_TEST_NOW")) : Date.now();

const NAME_FIELDS = ["name", "nama", "storeName", "namaStore", "nama_store", "store_name", "namaToko", "nama_toko", "outletName", "namaOutlet", "nama_outlet", "outlet", "store", "toko", "label", "title"];
const CODE_FIELDS = ["code", "kode", "storeCode", "kodeStore", "kode_store", "store_code", "storeId", "store_id", "idStore", "outletCode", "kodeOutlet"];
const ACTIVE_FIELDS = ["active", "aktif", "isActive", "is_active", "status", "enabled"];
const SCORE_STORE_FIELDS = ["storeId", "store_id", "idStore", "storeRef", "storeCode", "kodeStore", "kode_store", "store", "storeName", "namaStore", "nama_store", "store_name", "toko", "namaToko", "outletId", "outlet", "namaOutlet", "nama_outlet", "lokasi", "location"];
const SCORE_DATE_FIELDS = ["date", "tanggal", "tgl", "scoreDate", "scoringDate", "tanggalScoring", "tanggal_scoring", "createdAt", "created_at", "timestamp", "submittedAt", "submitted_at", "waktu", "time", "updatedAt", "updated_at"];
const INACTIVE = new Set(["false", "0", "no", "tidak", "inactive", "nonaktif", "non-aktif", "non aktif", "tidak aktif", "tutup", "closed", "disabled", "off", "deleted", "dihapus", "archived"]);

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const warn = (m) => console.log(IN_CI ? `::warning::${m}` : `PERINGATAN: ${m}`);
class FatalError extends Error {}
const fail = (m) => { throw new FatalError(m); };
// Jangan pernah menulis token, ID/nama grup, nama store, atau isi data ke log: log Actions di repo publik bisa dibaca siapa saja.
const isGroupId = (t) => /@g\.us$/i.test(t);
const looksLikeId = (t) => isGroupId(t) || /^\+?\d[\d-]{6,}$/.test(t) || /^-\d+$/.test(t);
const describeTarget = (t) => (isGroupId(t) ? "grup" : "nomor") + " (" + t.length + " karakter)";

// ---------- waktu WIB (UTC+7, tanpa DST) ----------
const WIB = 7 * 3600_000;
const DAY = 86_400_000;
const DAYS = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const wibIso = (ms) => new Date(ms + WIB).toISOString();
const ymd = (ms) => wibIso(ms).slice(0, 10);
const hhmm = (ms) => wibIso(ms).slice(11, 16).replace(":", ".");
export function reportWindow(nowMs, reportDate = "", cutoffHour = 6) {
  const today = ymd(nowMs);
  const hour = Number(wibIso(nowMs).slice(11, 13));
  let date, final;
  if (reportDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate) || Number.isNaN(Date.parse(`${reportDate}T00:00:00Z`))) fail(`REPORT_DATE "${reportDate}" harus berformat YYYY-MM-DD`);
    date = reportDate; final = reportDate < today;
  } else if (hour < cutoffHour) { date = ymd(nowMs - DAY); final = true; }
  else { date = today; final = false; }
  const start = Date.parse(`${date}T00:00:00Z`) - WIB;
  const [y, m, d] = date.split("-");
  return { date, final, start, end: start + DAY, sentAt: hhmm(nowMs), dayName: DAYS[new Date(`${date}T00:00:00Z`).getUTCDay()], dateLabel: `${d}/${m}/${y}`, y, m, d };
}

// ---------- HTTP ----------
class GatewayError extends Error { constructor(msg, retryable) { super(msg); this.retryable = retryable; } }
async function request(url, init = {}) {
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 45_000);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, redirect: "error" });
    const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* bukan JSON */ }
    return { status: res.status, ok: res.ok, json };
  } catch (e) {
    // Timeout = status kiriman tidak pasti (bisa saja sudah terkirim) → jangan diulang. Koneksi gagal sebelum terkirim → boleh diulang.
    if (e && e.name === "AbortError") throw new GatewayError(`tidak ada respons dalam 45 detik (${new URL(url).host})`, false);
    throw new GatewayError(`koneksi gagal ke ${new URL(url).host} (${e && e.cause && e.cause.code ? e.cause.code : e && e.code ? e.code : "network"})`, true);
  } finally { clearTimeout(timer); }
}
const form = (fields, headers = {}) => ({ method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers }, body: new URLSearchParams(fields) });
const reasonOf = (r) => {
  const j = (Array.isArray(r.json) ? r.json[0] : r.json) || {};
  const e = j.error && typeof j.error === "object" ? j.error : j;
  const s = [e.message, e.reason, e.detail, e.error_description, typeof e.error === "string" ? e.error : null].find((v) => typeof v === "string" && v);
  return `HTTP ${r.status}${s ? " · " + s.slice(0, 200) : ""}`;
};

// ---------- service account → access token ----------
const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
function parseServiceAccount(raw) {
  let txt = raw;
  if (!txt.startsWith("{")) { try { txt = Buffer.from(txt, "base64").toString("utf8"); } catch { /* bukan base64 */ } }
  let sa; try { sa = JSON.parse(txt); } catch { fail("Secret FO_FIREBASE_SA bukan JSON service account yang valid (salin seluruh isi file key, mulai dari { sampai })."); }
  if (!sa.client_email || !sa.private_key) fail("Secret FO_FIREBASE_SA tidak memuat client_email/private_key. Pastikan yang disalin adalah file key service account.");
  return sa;
}
async function accessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/datastore", aud: TOKEN_URL, iat: now, exp: now + 3600 }))}`;
  let sig; try { sig = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key); } catch { fail("private_key di FO_FIREBASE_SA rusak/terpotong. Salin ulang isi file key secara utuh."); }
  const r = await request(TOKEN_URL, form({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${b64url(sig)}` }));
  if (!r.ok || !r.json || !r.json.access_token) fail(`Login service account ditolak Google: ${reasonOf(r)}. Key mungkin sudah dihapus/dinonaktifkan; buat key baru.`);
  return r.json.access_token;
}

// ---------- Firestore REST ----------
class Firestore {
  constructor(project, token) { this.project = project; this.root = `${FIRESTORE_BASE}/projects/${encodeURIComponent(project)}/databases/(default)/documents`; this.headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }; }
  async call(path, body) {
    const r = await request(this.root + path, body === undefined ? { headers: this.headers } : { method: "POST", headers: this.headers, body: JSON.stringify(body) });
    if (!r.ok) {
      const hint = r.status === 403 ? " → service account belum punya role Cloud Datastore Viewer di project ini." : r.status === 404 ? " → project/database tidak ditemukan." : "";
      fail(`Firestore menolak permintaan: ${reasonOf(r)}${hint}`);
    }
    return r.json;
  }
  async list(collPath) {
    const docs = []; let pageToken = "";
    do {
      const q = new URLSearchParams({ pageSize: "300" }); if (pageToken) q.set("pageToken", pageToken);
      const j = await this.call(`/${collPath}?${q}`);
      docs.push(...((j && j.documents) || [])); pageToken = (j && j.nextPageToken) || "";
    } while (pageToken);
    return docs;
  }
  async first(collPath) { const j = await this.call(`/${collPath}?pageSize=1`); return ((j && j.documents) || [])[0] || null; }
  async collections(parent = "") { const j = await this.call(`${parent ? "/" + parent : ""}:listCollectionIds`, { pageSize: 200 }); return (j && j.collectionIds) || []; }
  async count(collectionId, parent = "") {
    const j = await this.call(`${parent ? "/" + parent : ""}:runAggregationQuery`, { structuredAggregationQuery: { structuredQuery: { from: [{ collectionId }] }, aggregations: [{ alias: "n", count: {} }] } });
    const v = Array.isArray(j) && j[0] && j[0].result && j[0].result.aggregateFields && j[0].result.aggregateFields.n;
    return v ? Number(v.integerValue) : null;
  }
  async query(parent, structuredQuery) {
    const j = await this.call(`${parent ? "/" + parent : ""}:runQuery`, { structuredQuery });
    return (Array.isArray(j) ? j : []).map((x) => x.document).filter(Boolean);
  }
}
const docId = (d) => decodeURIComponent(d.name.split("/").pop());
const relPath = (d) => d.name.split("/documents/")[1];
const valOf = (v) => {
  if (!v || typeof v !== "object") return undefined;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("timestampValue" in v) return v.timestampValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("referenceValue" in v) return decodeURIComponent(v.referenceValue.split("/").pop());
  if ("mapValue" in v) { const f = v.mapValue.fields || {}; for (const k of ["id", "storeId", "code", "kode", "name", "nama"]) if (k in f) return valOf(f[k]); }
  return undefined;
};
const norm = (s) => String(s ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
const fieldPath = (f) => f.split(".").map((p) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(p) ? p : "`" + p.replace(/[`\\]/g, "\\$&") + "`")).join(".");
/** Ambil nilai bertipe Firestore; path boleh bertitik untuk field di dalam map (mis. "store.id"). */
const getField = (fields, path) => { let cur = fields || {}, v; for (const p of path.split(".")) { v = cur ? cur[p] : undefined; cur = v && v.mapValue ? v.mapValue.fields || {} : null; } return v; };
const pickField = (fields, explicit, candidates) => (explicit ? explicit : candidates.find((c) => fields && c in fields) || null);
/** Pola nilai tanpa isi asli: angka → 9, huruf → a (aman untuk log publik). */
const shape = (s) => String(s).slice(0, 32).replace(/\d/g, "9").replace(/[A-Za-z]/g, "a");
const typeOf = (v) => {
  if (!v || typeof v !== "object") return "?";
  const k = Object.keys(v)[0] || "?";
  const t = k.replace(/Value$/, "");
  if (t === "string" && /\d/.test(v.stringValue) && /^[\d\s/:.,TZ+-]+$/.test(v.stringValue.slice(0, 32))) return `string "${shape(v.stringValue)}"`;
  if (t === "integer" || t === "double") { const n = Number(v[k]); return n > 1e12 ? `${t} (epoch ms)` : n > 1e9 ? `${t} (epoch detik)` : t; }
  return t;
};

// ---------- filter tanggal ----------
const iso = (ms) => new Date(ms).toISOString();
const fieldFilter = (field, op, value) => ({ fieldFilter: { field: { fieldPath: fieldPath(field) }, op, value } });
const rangeQuery = (field, lo, hi) => ({ compositeFilter: { op: "AND", filters: [fieldFilter(field, "GREATER_THAN_OR_EQUAL", lo), fieldFilter(field, "LESS_THAN", hi)] } });
const prefixQuery = (field, p) => rangeQuery(field, { stringValue: p }, { stringValue: p + "" });
/**
 * Susun filter Firestore untuk satu hari WIB berdasarkan contoh nilai field tanggal (dokumen terbaru).
 * Hasil: { filters: [...], kind } — lebih dari satu filter berarti hasil beberapa query digabung.
 */
export function dateFilters(sample, field, w, dateFormat = "") {
  if (!sample || typeof sample !== "object") fail(`Field tanggal "${field}" tidak ada di data scoring terbaru. Isi variabel FO_SCORE_DATE_FIELD dengan nama field yang benar.`);
  if ("timestampValue" in sample) return { kind: "timestamp", filters: [rangeQuery(field, { timestampValue: iso(w.start) }, { timestampValue: iso(w.end) })] };
  if ("integerValue" in sample || "doubleValue" in sample) {
    const n = Number(sample.integerValue ?? sample.doubleValue);
    if (n > 1e12) return { kind: "epoch ms", filters: [rangeQuery(field, { integerValue: String(w.start) }, { integerValue: String(w.end) })] };
    if (n > 1e9) return { kind: "epoch detik", filters: [rangeQuery(field, { integerValue: String(w.start / 1000) }, { integerValue: String(w.end / 1000) })] };
    fail(`Field tanggal "${field}" berisi angka yang bukan waktu epoch.`);
  }
  if ("stringValue" in sample) {
    const s = sample.stringValue.trim();
    const { y, m, d } = w; const dn = String(Number(d)); const mn = String(Number(m));
    if (/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/i.test(s)) return { kind: "teks ISO UTC", filters: [rangeQuery(field, { stringValue: iso(w.start) }, { stringValue: iso(w.end) })] };
    if (/^\d{4}-\d{2}-\d{2}T[\d:.]+[+-]\d{2}:?\d{2}$/.test(s) && !/[+]07:?00$/.test(s)) fail(`Field tanggal "${field}" memakai zona waktu selain WIB (${shape(s)}). Hubungi pengembang.`);
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return { kind: "teks YYYY-MM-DD", filters: [prefixQuery(field, `${y}-${m}-${d}`)] };
    const sep = /^\d{1,2}\/\d{1,2}\/\d{4}/.test(s) ? "/" : /^\d{1,2}-\d{1,2}-\d{4}/.test(s) ? "-" : /^\d{1,2}\.\d{1,2}\.\d{4}/.test(s) ? "." : "";
    if (sep) {
      const [a, b] = s.split(sep).map(Number);
      const fmt = dateFormat === "mdy" || dateFormat === "dmy" ? dateFormat : a > 12 ? "dmy" : b > 12 ? "mdy" : "dmy";
      const [p1, p1n, p2, p2n] = fmt === "dmy" ? [d, dn, m, mn] : [m, mn, d, dn];
      const prefixes = [...new Set([`${p1}${sep}${p2}${sep}${y}`, `${p1n}${sep}${p2n}${sep}${y}`, `${p1}${sep}${p2n}${sep}${y}`, `${p1n}${sep}${p2}${sep}${y}`])];
      return { kind: `teks ${fmt === "dmy" ? "tgl/bln/thn" : "bln/tgl/thn"} (pemisah "${sep}")`, filters: prefixes.map((p) => prefixQuery(field, p)) };
    }
    fail(`Format tanggal teks di field "${field}" tidak dikenali (pola: ${shape(s)}). Hubungi pengembang.`);
  }
  fail(`Field tanggal "${field}" bertipe ${typeOf(sample)}, bukan tanggal.`);
}

// ---------- data store & scoring ----------
const isInactive = (v) => v === false || (v !== undefined && v !== null && v !== true && INACTIVE.has(norm(v)));
async function loadStores(db) {
  if (CFG.storeList) {
    const names = [...new Set(CFG.storeList.split(/\s*[,;\n]\s*/).filter(Boolean))];
    return { stores: names.map((n) => ({ id: n, name: n, keys: [norm(n)] })).sort((a, b) => a.name.localeCompare(b.name, "id")), info: `FO_STORE_LIST (${names.length} nama)` };
  }
  const docs = await db.list(CFG.storeCollection);
  if (!docs.length) fail(`Koleksi store "${CFG.storeCollection}" kosong/tidak ada. Isi variabel FO_STORE_COLLECTION (lihat hasil ACTION=discover) atau FO_STORE_LIST.`);
  const nameF = CFG.storeNameField || NAME_FIELDS.find((c) => docs.some((d) => d.fields && typeof valOf(d.fields[c]) === "string"));
  const activeF = CFG.storeActiveField || ACTIVE_FIELDS.find((c) => docs.some((d) => d.fields && c in d.fields));
  const stores = []; let skipped = 0;
  for (const d of docs) {
    const f = d.fields || {};
    if (activeF && isInactive(valOf(getField(f, activeF)))) { skipped++; continue; }
    const nm = nameF ? valOf(getField(f, nameF)) : undefined;
    const name = typeof nm === "string" && nm.trim() ? nm.trim() : docId(d);
    const keys = new Set([norm(docId(d)), norm(name)]);
    for (const c of CODE_FIELDS) { const v = valOf(f[c]); if ((typeof v === "string" && v.trim()) || typeof v === "number") keys.add(norm(v)); }
    stores.push({ id: docId(d), path: relPath(d), name, keys: [...keys] });
  }
  stores.sort((a, b) => a.name.localeCompare(b.name, "id"));
  return { stores, info: `koleksi "${CFG.storeCollection}": ${docs.length} dok, ${skipped} nonaktif dilewati, field nama=${nameF || "(ID dokumen)"}, field aktif=${activeF || "-"}` };
}

/** Cadangan bila nama di data scoring tidak persis sama: cocok hanya jika tepat SATU store yang namanya memuat teks tsb (atau sebaliknya). */
function similarStore(stores, key) {
  if (key.length < 4) return null;
  const hits = stores.filter((s) => s.keys.some((k) => k.length >= 4 && (k.includes(key) || key.includes(k))));
  return hits.length === 1 ? hits[0] : null;
}

async function latestWithField(db, parent, collectionId, dateF) {
  const docs = await db.query(parent, { from: [{ collectionId }], orderBy: [{ field: { fieldPath: fieldPath(dateF) }, direction: "DESCENDING" }], limit: 1 });
  return docs[0] || null;
}

async function loadScores(db, stores, w) {
  const spec = CFG.scoreCollection;
  const sub = spec.match(/^([^/]+)\/\{store\}\/([^/]+)$/);
  const done = new Set(); let docsCount = 0; let unmatched = 0; let fuzzy = 0;
  if (sub) {
    // Sub-koleksi per store: stores/{store}/scorings → query per store (indeks otomatis per koleksi).
    if (CFG.storeList) fail("FO_SCORE_COLLECTION berbentuk sub-koleksi butuh master store dari Firestore, bukan FO_STORE_LIST.");
    const [, parentColl, collectionId] = sub;
    if (parentColl !== CFG.storeCollection) warn(`Sub-koleksi scoring berada di "${parentColl}", master store di "${CFG.storeCollection}".`);
    let dateF = CFG.scoreDateField, sample = null;
    for (const s of stores) { const d0 = await db.first(`${parentColl}/${encodeURIComponent(s.id)}/${collectionId}`); if (d0) { dateF = dateF || pickField(d0.fields, "", SCORE_DATE_FIELDS); if (dateF) sample = await latestWithField(db, `${parentColl}/${encodeURIComponent(s.id)}`, collectionId, dateF); if (sample) break; } }
    if (!dateF || !sample) fail(`Tidak menemukan data scoring dengan field tanggal di sub-koleksi "${spec}". Isi FO_SCORE_DATE_FIELD (lihat ACTION=discover).`);
    const { kind, filters } = dateFilters(getField(sample.fields, dateF), dateF, w, CFG.dateFormat);
    for (const s of stores) {
      const seen = new Set();
      for (const where of filters) for (const d of await db.query(`${parentColl}/${encodeURIComponent(s.id)}`, { from: [{ collectionId }], where, select: { fields: [{ fieldPath: fieldPath(dateF) }] } })) seen.add(d.name);
      docsCount += seen.size; if (seen.size) done.add(s.id);
    }
    return { done, info: `sub-koleksi "${spec}", field tanggal=${dateF} (${kind}), ${docsCount} dok pada ${w.date}` };
  }
  if (spec.includes("/")) fail(`FO_SCORE_COLLECTION "${spec}" tidak dikenali. Pakai nama koleksi (mis. "scorings") atau "stores/{store}/scorings".`);
  const first = await db.first(spec);
  if (!first) fail(`Koleksi scoring "${spec}" kosong/tidak ada. Cek FO_SCORE_COLLECTION (lihat ACTION=discover).`);
  const fields = first.fields || {};
  const dateF = pickField(fields, CFG.scoreDateField, SCORE_DATE_FIELDS);
  const storeF = pickField(fields, CFG.scoreStoreField, SCORE_STORE_FIELDS);
  const names = Object.keys(fields).join(", ");
  if (!dateF) fail(`Field tanggal di koleksi "${spec}" tidak terdeteksi. Field yang ada: ${names}. Isi variabel FO_SCORE_DATE_FIELD.`);
  if (!storeF) fail(`Field store di koleksi "${spec}" tidak terdeteksi. Field yang ada: ${names}. Isi variabel FO_SCORE_STORE_FIELD.`);
  const sample = await latestWithField(db, "", spec, dateF);
  const { kind, filters } = dateFilters(sample && getField(sample.fields || {}, dateF), dateF, w, CFG.dateFormat);
  const byKey = new Map(); for (const s of stores) for (const k of s.keys) if (!byKey.has(k)) byKey.set(k, s);
  const seen = new Set();
  for (const where of filters) {
    const docs = await db.query("", { from: [{ collectionId: spec }], where, select: { fields: [{ fieldPath: fieldPath(storeF) }, { fieldPath: fieldPath(dateF) }] } });
    for (const d of docs) {
      if (seen.has(d.name)) continue; seen.add(d.name); docsCount++;
      const key = norm(valOf(getField(d.fields || {}, storeF)));
      let s = byKey.get(key);
      if (!s && key) { s = similarStore(stores, key); if (s) { byKey.set(key, s); fuzzy++; } }
      if (s) done.add(s.id); else unmatched++;
    }
  }
  if (fuzzy) log(`${fuzzy} data scoring dicocokkan lewat nama store yang mirip (mis. tanpa awalan brand).`);
  if (unmatched) warn(`${unmatched} data scoring pada ${w.date} tidak cocok dengan master store (store nonaktif, salah ketik, atau field store berbeda). Data ini tidak dihitung.`);
  return { done, info: `koleksi "${spec}", field store=${storeF}, field tanggal=${dateF} (${kind}), ${docsCount} dok pada ${w.date}, ${unmatched} tidak cocok` };
}

// ---------- pesan ----------
export function buildMessage(stores, done, w, title = TITLE) {
  const sudah = stores.filter((s) => done.has(s.id));
  const belum = stores.filter((s) => !done.has(s.id));
  const total = stores.length;
  const pct = total ? Math.round((sudah.length / total) * 100) : 0;
  const L = [];
  L.push(w.final ? `*Rekap Final ${title}*` : `*Laporan ${title}*`);
  L.push(w.final ? `${w.dayName}, ${w.dateLabel} · ditutup ${w.sentAt} WIB` : `${w.dayName}, ${w.dateLabel} · posisi ${w.sentAt} WIB`);
  L.push("");
  L.push(`✅ *Sudah scoring: ${sudah.length} dari ${total} store (${pct}%)*`);
  sudah.forEach((s, i) => L.push(`${i + 1}. ${s.name}`));
  L.push("");
  L.push(`❌ *${w.final ? "Tidak" : "Belum"} scoring: ${belum.length} dari ${total} store (${total ? 100 - pct : 0}%)*`);
  belum.forEach((s, i) => L.push(`${i + 1}. ${s.name}`));
  if (!belum.length) L.push("Semua store sudah scoring. 👍");
  L.push("");
  if (belum.length) L.push(w.final ? "Store yang tidak scoring mohon dicek dan ditindaklanjuti." : "Mohon store yang belum segera melakukan scoring hari ini.");
  else L.push("Terima kasih, pertahankan.");
  L.push("_Pesan otomatis_");
  return { text: L.join("\n"), total, sudah: sudah.length, belum: belum.length, pct };
}

// ---------- gateway WhatsApp ----------
function validateGateway() {
  if (!["fonnte", "wablas", "webhook"].includes(GATEWAY)) fail(`WA_GATEWAY "${GATEWAY}" tidak dikenal (fonnte | wablas | webhook)`);
  if (GATEWAY !== "webhook" && !TOKEN) fail("Token gateway WhatsApp kosong. Isi secret WA_TOKEN (atau FO_WA_TOKEN).");
  if (GATEWAY !== "fonnte") {
    if (!API_URL) fail(`WA_API_URL wajib untuk gateway ${GATEWAY}`);
    if (!/^https:\/\//i.test(API_URL) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/i.test(API_URL)) fail("WA_API_URL harus memakai https://");
  }
}
const fonnteAuth = () => ({ Authorization: TOKEN });
async function sendOnce(target, message) {
  if (GATEWAY === "fonnte") {
    const r = await request(`${FONNTE_BASE}/send`, form({ target, message, countryCode: "62" }, fonnteAuth()));
    if (r.ok && r.json && r.json.status === true) return "diterima gateway";
    throw new GatewayError(`gateway menolak: ${reasonOf(r)}`, r.status >= 500);
  }
  if (GATEWAY === "wablas") {
    const r = await request(`${API_URL}/api/send-message`, form({ phone: target, message, isGroup: isGroupId(target) ? "true" : "false" }, { Authorization: TOKEN }));
    if (r.ok && r.json && r.json.status === true) return "diterima gateway";
    throw new GatewayError(`gateway menolak: ${reasonOf(r)}`, r.status >= 500);
  }
  const headers = { "Content-Type": "application/json" }; if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  const r = await request(API_URL, { method: "POST", headers, body: JSON.stringify({ target, message }) });
  if (r.ok) return `diterima (HTTP ${r.status})`;
  throw new GatewayError(`webhook menolak: HTTP ${r.status}`, r.status >= 500);
}
async function send(target, message) {
  try { return await sendOnce(target, message); }
  catch (e) {
    if (!(e instanceof GatewayError) || !e.retryable) throw e;
    log(`  gagal (${e.message}); kiriman dipastikan belum masuk, ulangi sekali dalam 5 detik…`);
    await new Promise((r) => setTimeout(r, 5000));
    return sendOnce(target, message);
  }
}
async function fonnteGroups(refresh) {
  if (refresh) {
    const f = await request(`${FONNTE_BASE}/fetch-group`, form({}, fonnteAuth()));
    if (!(f.json && f.json.status === true)) warn(`fetch-group: ${reasonOf(f)} (lanjut membaca daftar yang tersimpan)`);
  }
  const r = await request(`${FONNTE_BASE}/get-whatsapp-group`, form({}, fonnteAuth()));
  if (!(r.json && r.json.status === true)) { if (!refresh) return []; fail(`Daftar grup Fonnte gagal dibaca: ${reasonOf(r)}`); }
  return (Array.isArray(r.json.data) ? r.json.data : []).map((g) => ({ id: String(g.id || g.jid || ""), name: String(g.name || g.subject || "") })).filter((g) => g.id);
}
/** Ubah NAMA grup menjadi ID grup (Fonnte). Tujuan yang sudah berupa ID dibiarkan. */
async function resolveTargets(targets) {
  const names = targets.filter((t) => !looksLikeId(t));
  if (names.length && GATEWAY !== "fonnte") fail("FO_WA_TARGET berisi nama grup; pencarian nama grup hanya untuk Fonnte. Untuk gateway lain isi dengan ID grup (…@g.us).");
  let groups = names.length ? await fonnteGroups(false) : [];
  const findGroup = (n) => { const hits = groups.filter((g) => norm(g.name) === norm(n)); if (hits.length > 1) warn(`Ada ${hits.length} grup dengan nama yang sama; dipakai yang pertama.`); return hits[0]; };
  if (names.some((n) => !groups.some((g) => norm(g.name) === norm(n)))) groups = await fonnteGroups(true);
  return targets.map((t, i) => {
    if (looksLikeId(t)) return { label: `tujuan #${i + 1} ${describeTarget(t)}`, id: t };
    const g = findGroup(t);
    if (!g) return { label: `tujuan #${i + 1} (nama grup)`, id: "", error: "nama grup tidak ditemukan di nomor gateway. Pastikan nomor gateway sudah jadi anggota grup dan nama ditulis persis sama (atau pakai ID grup)." };
    return { label: `tujuan #${i + 1} (nama grup → ${describeTarget(g.id)})`, id: g.id };
  });
}
async function listGroups() {
  if (GATEWAY !== "fonnte") fail("ACTION=list_groups hanya untuk gateway fonnte.");
  if (!TOKEN) fail("Token gateway kosong. Isi secret WA_TOKEN (atau FO_WA_TOKEN).");
  const data = await fonnteGroups(true);
  mkdirSync(OUT_DIR, { recursive: true });
  const file = join(OUT_DIR, "daftar-grup.txt");
  writeFileSync(file, [`Daftar grup pada nomor gateway (${data.length})`, "", ...data.map((g) => `${g.id}\t${g.name}`), "", "Salin ID (1203…@g.us) atau nama grup ke secret FO_WA_TARGET, lalu HAPUS artifact ini dari halaman run."].join("\n"), "utf8");
  log(`${data.length} grup ditulis ke ${file} (tidak dicetak ke log karena log repo publik bisa dibaca siapa saja).`);
}

// ---------- discover: struktur Firestore tanpa isi data ----------
async function discover(db) {
  const cols = await db.collections();
  log(`Struktur Firestore project ${db.project}: ${cols.length} koleksi (hanya nama field & tipe, tanpa isi data)`);
  for (const c of cols) {
    const n = await db.count(c).catch(() => null);
    const d = await db.first(c);
    const fields = d ? Object.entries(d.fields || {}).map(([k, v]) => `${k}:${typeOf(v)}`).join(", ") : "(kosong)";
    console.log(`  • ${c} — ${n ?? "?"} dok — ${fields}`);
    if (d) { const subs = await db.collections(relPath(d)).catch(() => []); if (subs.length) console.log(`      sub-koleksi per dokumen: ${subs.join(", ")}`); }
  }
  return cols;
}

// ---------- main ----------
async function main() {
  if (!["send", "dry_run", "discover", "list_groups"].includes(ACTION)) fail(`ACTION "${ACTION}" tidak dikenal (send | dry_run | discover | list_groups)`);
  log(`action=${ACTION} gateway=${GATEWAY} token=${TOKEN ? "terisi" : "kosong"} tujuan=${TARGETS.length}`);
  if (ACTION === "list_groups") return listGroups();
  if (ACTION === "send") { validateGateway(); if (!TARGETS.length) fail("Secret FO_WA_TARGET kosong: tidak ada grup tujuan."); }

  const saRaw = env("FO_SA_KEY");
  if (!saRaw) {
    if (ACTION === "send") fail("Secret FO_FIREBASE_SA belum diisi: script tidak bisa membaca data Filter Oil.");
    warn("Secret FO_FIREBASE_SA belum diisi. Dry-run berhenti di sini; isi secret lalu jalankan ulang.");
    return;
  }
  const sa = parseServiceAccount(saRaw);
  const project = env("FO_PROJECT_ID") || sa.project_id;
  if (!project) fail("Project ID tidak diketahui. Isi FO_PROJECT_ID.");
  const db = new Firestore(project, await accessToken(sa));
  log(`login service account OK (project ${project})`);

  if (ACTION === "discover" || ACTION === "dry_run") {
    const cols = await discover(db);
    if (ACTION === "discover") return;
    if (!CFG.scoreCollection) {
      const guess = cols.filter((c) => c !== CFG.storeCollection && /scor|nilai|filter|oil|minyak|cek|check|inspe|audit|monitor/i.test(c));
      if (guess.length !== 1) { warn(`Variabel FO_SCORE_COLLECTION belum diisi dan koleksi scoring tidak bisa ditebak (${guess.length} kandidat). Pilih dari daftar di atas.`); return; }
      CFG.scoreCollection = guess[0];
      warn(`FO_SCORE_COLLECTION belum diisi; dry-run memakai tebakan koleksi "${guess[0]}". Isi variabel ini sebelum jadwal kirim aktif.`);
    }
  }
  if (!CFG.scoreCollection) fail("Variabel FO_SCORE_COLLECTION belum diisi (koleksi data scoring). Jalankan ACTION=dry_run/discover untuk melihat daftar koleksi.");

  const w = reportWindow(NOW_MS, REPORT_DATE, CUTOFF_HOUR);
  log(`laporan ${w.final ? "REKAP FINAL" : "progress"} tanggal ${w.date} (WIB), dibuat ${w.sentAt} WIB`);
  const { stores, info: storeInfo } = await loadStores(db);
  log(`master store: ${storeInfo} → ${stores.length} store aktif`);
  if (!stores.length) fail("Tidak ada store aktif di master store.");
  const { done, info: scoreInfo } = await loadScores(db, stores, w);
  log(`data scoring: ${scoreInfo}`);
  const msg = buildMessage(stores, done, w);
  log(`hasil: ${msg.sudah}/${msg.total} store sudah scoring (${msg.pct}%), ${msg.belum} belum`);

  mkdirSync(OUT_DIR, { recursive: true });
  const file = join(OUT_DIR, `laporan-${w.date}-${w.final ? "final" : "progress"}.txt`);
  writeFileSync(file, msg.text, "utf8");
  log(`pesan ${msg.text.length} karakter → ${file}`);
  if (ACTION === "dry_run") { console.log(`\nDRY RUN selesai. Pesan tersimpan di ${file}, tidak dikirim.`); return; }

  const targets = await resolveTargets(TARGETS);
  let sent = 0, failed = 0;
  for (const t of targets) {
    if (!t.id) { failed++; console.error(IN_CI ? `::error::${t.label}: ${t.error}` : `GAGAL ${t.label}: ${t.error}`); continue; }
    try { const r = await send(t.id, msg.text); sent++; log(`terkirim ke ${t.label} · ${r}`); }
    catch (e) { failed++; console.error(IN_CI ? `::error::${t.label}: GAGAL kirim: ${e.message}` : `GAGAL kirim ${t.label}: ${e.message}`); }
  }
  console.log(`\nSelesai: ${sent} terkirim, ${failed} gagal.`);
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    const m = e instanceof FatalError || e instanceof GatewayError ? e.message : `${e && e.stack ? e.stack : e}`;
    console.error(IN_CI ? `::error::${m}` : `ERROR: ${m}`);
    process.exit(1);
  });
}
