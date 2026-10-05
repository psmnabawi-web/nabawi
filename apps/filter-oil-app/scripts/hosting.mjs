#!/usr/bin/env node
// Kelola situs UTAMA app Trecking Filter Oil (trecking-filter-oil-store.web.app) lewat Firebase Hosting REST API.
//
//   node scripts/hosting.mjs snapshot   → salin versi yang sedang live (semua file + konfigurasi hosting) ke live/
//   node scripts/hosting.mjs deploy     → terbitkan versi baru = semua file live yang sama persis + file dari overlay/
//                                          (mis. index.html yang ditambah menu Kepatuhan, folder /kepatuhan/)
//   node scripts/hosting.mjs rollback   → terbitkan ulang versi ROLLBACK_VERSION (atau versi sebelum deploy terakhir)
//
// Pengaman:
//   - deploy hanya jalan bila versi live sama dengan versi di live/hosting.json (snapshot). Kalau app sudah
//     di-deploy ulang oleh orang lain sejak snapshot, deploy dibatalkan supaya perubahan mereka tidak tertimpa.
//   - file overlay yang menggantikan file lama (mis. index.html) hanya diterima bila file lama di live masih sama
//     dengan yang ada di snapshot.
//   - konfigurasi hosting (rewrites, headers, redirects, cleanUrls) disalin persis dari versi live.
//
// Env: FO_ACCESS_TOKEN (wajib), FO_SITE (default trecking-filter-oil-store), ROLLBACK_VERSION (opsional)

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, existsSync, rmSync, appendFileSync } from "node:fs";
import { join, dirname, relative, sep } from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const env = (k, d = "") => (process.env[k] ?? d).toString().trim();
const IN_CI = !!process.env.GITHUB_ACTIONS;
const API = (!IN_CI && env("FO_TEST_HOSTING_BASE")) || "https://firebasehosting.googleapis.com/v1beta1";
const UPLOAD_OVERRIDE = !IN_CI && env("FO_TEST_UPLOAD_BASE");
const SITE = env("FO_SITE", "trecking-filter-oil-store");
const ORIGIN = (!IN_CI && env("FO_TEST_ORIGIN")) || `https://${SITE}.web.app`;
const TOKEN = env("FO_ACCESS_TOKEN");
const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const LIVE_DIR = join(APP_DIR, "live");
const OVERLAY_DIR = join(APP_DIR, "overlay");
const STATE = join(LIVE_DIR, "hosting.json");
const MSG_PREFIX = "kepatuhan:";
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const fail = (m) => { console.error(IN_CI ? `::error::${m}` : `ERROR: ${m}`); process.exit(1); };
const summary = (t) => { if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, t + "\n"); };

async function call(method, url, body, { raw = false, contentType = "application/json" } = {}) {
  const res = await fetch(url, { method, headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": contentType }, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* bukan JSON */ }
  return { ok: res.ok, status: res.status, json, text };
}
const why = (r) => `HTTP ${r.status} ${(r.json && r.json.error && r.json.error.message) || r.text.slice(0, 200)}`;
const gzHash = (buf) => createHash("sha256").update(gzipSync(buf, { level: 9 })).digest("hex");
const sha = (buf) => createHash("sha256").update(buf).digest("hex");

async function liveRelease() {
  const r = await call("GET", `${API}/sites/${SITE}/channels/live/releases?pageSize=10`);
  if (!r.ok) fail(`Riwayat rilis situs ${SITE} tidak bisa dibaca: ${why(r)}`);
  const rel = (r.json.releases || []).find((x) => x.type === "DEPLOY" || x.version);
  if (!rel || !rel.version) fail("Belum ada versi live di situs ini.");
  return { release: rel, releases: r.json.releases || [] };
}
async function listFiles(versionName) {
  const files = []; let token = "";
  do {
    const r = await call("GET", `${API}/${versionName}/files?pageSize=1000${token ? `&pageToken=${encodeURIComponent(token)}` : ""}`);
    if (!r.ok) fail(`Daftar file versi tidak bisa dibaca: ${why(r)}`);
    files.push(...(r.json.files || []).filter((f) => !f.status || f.status === "ACTIVE" || f.status === "EXPECTED"));
    token = r.json.nextPageToken || "";
  } while (token);
  return files.map((f) => ({ path: f.path, hash: f.hash }));
}
function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p)); else out.push(p);
  }
  return out;
}
const toWebPath = (base, f) => "/" + relative(base, f).split(sep).join("/");

// ---------- snapshot ----------
async function snapshot() {
  const { release } = await liveRelease();
  const version = release.version;
  const files = await listFiles(version.name);
  log(`versi live ${version.name.split("/").pop()} (${files.length} file), dirilis ${release.releaseTime} oleh ${release.releaseUser?.email || "-"}`);
  rmSync(join(LIVE_DIR, "files"), { recursive: true, force: true });
  const entries = [];
  for (const f of files) {
    // ambil isi file dari situs publik; "?" mencegah cache CDN versi lama
    const res = await fetch(`${ORIGIN}${encodeURI(f.path)}?snapshot=${Date.now()}`, { redirect: "follow" });
    if (!res.ok) fail(`Gagal mengunduh ${f.path}: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const dest = join(LIVE_DIR, "files", ...f.path.split("/").filter(Boolean));
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, buf);
    entries.push({ path: f.path, hash: f.hash, bytes: buf.length, sha256: sha(buf) });
  }
  const state = {
    site: SITE, version: version.name, status: version.status, releaseTime: release.releaseTime,
    releaseUser: release.releaseUser?.email || null, message: release.message || null,
    config: version.config || {}, files: entries.sort((a, b) => a.path.localeCompare(b.path)), takenAt: new Date().toISOString(),
  };
  mkdirSync(LIVE_DIR, { recursive: true });
  writeFileSync(STATE, JSON.stringify(state, null, 2) + "\n");
  log(`snapshot tersimpan di ${relative(APP_DIR, LIVE_DIR)}/ (${entries.length} file)`);
  summary(`### Snapshot ${SITE}\nVersi \`${version.name}\`, ${entries.length} file, dirilis ${release.releaseTime} oleh ${state.releaseUser || "-"}.`);
}

// ---------- deploy ----------
async function deploy() {
  if (!existsSync(STATE)) fail("live/hosting.json belum ada. Jalankan snapshot dulu.");
  const snap = JSON.parse(readFileSync(STATE, "utf8"));
  const { release } = await liveRelease();
  const liveVersion = release.version.name;
  const liveFiles = await listFiles(liveVersion);
  const ours = (release.message || "").startsWith(MSG_PREFIX);
  // Versi live boleh: versi snapshot, atau versi hasil deploy kita sendiri sebelumnya (berbasis snapshot yang sama).
  const baseOk = liveVersion === snap.version || (ours && (release.message || "").includes(snap.version.split("/").pop()));
  if (!baseOk) fail(`Versi live (${liveVersion}) berbeda dari snapshot (${snap.version}) dan bukan hasil deploy kepatuhan. App mungkin sudah diperbarui orang lain; jalankan snapshot ulang dulu supaya perubahan mereka tidak tertimpa.`);

  // Peta file dasar = isi snapshot (hash asli), bukan versi live kita sebelumnya, supaya overlay lama yang dihapus ikut hilang.
  const files = Object.fromEntries(snap.files.map((f) => [f.path, f.hash]));
  if (liveVersion === snap.version) {
    const liveMap = Object.fromEntries(liveFiles.map((f) => [f.path, f.hash]));
    const drift = snap.files.filter((f) => liveMap[f.path] !== f.hash).map((f) => f.path);
    if (drift.length) fail(`File live berubah sejak snapshot: ${drift.slice(0, 5).join(", ")}. Jalankan snapshot ulang.`);
  }
  const overlay = walk(OVERLAY_DIR);
  if (!overlay.length) fail("Folder overlay/ kosong: tidak ada yang perlu di-deploy.");
  const uploads = new Map();
  for (const f of overlay) {
    const buf = readFileSync(f);
    const p = toWebPath(OVERLAY_DIR, f);
    const gz = gzipSync(buf, { level: 9 });
    const h = createHash("sha256").update(gz).digest("hex");
    files[p] = h; uploads.set(h, gz);
  }
  const replaced = overlay.map((f) => toWebPath(OVERLAY_DIR, f)).filter((p) => snap.files.some((s) => s.path === p));
  log(`versi dasar ${snap.version.split("/").pop()}: ${snap.files.length} file asli, ${overlay.length} file overlay (${replaced.length} menggantikan: ${replaced.join(", ") || "-"})`);

  const v = await call("POST", `${API}/sites/${SITE}/versions`, { config: snap.config || {} });
  if (!v.ok) fail(`Gagal membuat versi: ${why(v)}`);
  const version = v.json.name;
  const pop = await call("POST", `${API}/${version}:populateFiles`, { files });
  if (!pop.ok) fail(`Gagal mendaftarkan file: ${why(pop)}`);
  const need = pop.json.uploadRequiredHashes || [];
  const missingBase = need.filter((h) => !uploads.has(h));
  if (missingBase.length) fail(`${missingBase.length} file asli tidak ditemukan di server Hosting (tidak terduga). Deploy dibatalkan sebelum rilis; situs tidak berubah.`);
  const uploadUrl = UPLOAD_OVERRIDE ? `${UPLOAD_OVERRIDE}/${version}:upload` : pop.json.uploadUrl;
  for (const h of need) {
    const up = await call("POST", `${uploadUrl}/${h}`, uploads.get(h), { raw: true, contentType: "application/octet-stream" });
    if (!up.ok) fail(`Upload gagal: ${why(up)}`);
  }
  const fin = await call("PATCH", `${API}/${version}?update_mask=status`, { status: "FINALIZED" });
  if (!fin.ok) fail(`Gagal finalisasi versi: ${why(fin)}`);
  const msg = `${MSG_PREFIX} menu Kepatuhan & Export Excel di atas ${snap.version.split("/").pop()}${env("GITHUB_SHA") ? ` (commit ${env("GITHUB_SHA").slice(0, 7)})` : ""}`;
  const rel = await call("POST", `${API}/sites/${SITE}/releases?versionName=${encodeURIComponent(version)}`, { message: msg.slice(0, 500) });
  if (!rel.ok) fail(`Gagal merilis versi: ${why(rel)}`);
  log(`rilis OK: ${version}. Versi sebelumnya (untuk rollback): ${liveVersion}`);
  summary(`### Deploy ${SITE}\nVersi baru \`${version}\`.\n\nRollback: jalankan workflow ini dengan action **rollback** dan version \`${liveVersion}\`.`);

  // cek situs: halaman utama, halaman kepatuhan, dan file overlay lain terlayani
  const checks = ["/", ...overlay.map((f) => toWebPath(OVERLAY_DIR, f)).filter((p) => !p.endsWith("/index.html"))].slice(0, 12);
  const bad = [];
  for (let attempt = 0; attempt < 6; attempt++) {
    bad.length = 0;
    if (attempt) await new Promise((r) => setTimeout(r, 5000));
    for (const p of checks) {
      try { const r = await fetch(`${ORIGIN}${p}?check=${Date.now()}`); if (!r.ok) bad.push(`${p} HTTP ${r.status}`); } catch (e) { bad.push(`${p} ${e.message}`); }
    }
    if (!bad.length) break;
  }
  if (bad.length) fail(`Situs belum melayani semua file: ${bad.join("; ")}. Pertimbangkan rollback ke ${liveVersion}.`);
  log(`cek situs OK (${checks.length} alamat)`);
}

// ---------- rollback ----------
async function rollback() {
  let target = env("ROLLBACK_VERSION");
  if (!target) {
    const { releases } = await liveRelease();
    const prev = releases.find((x) => x.version && !(x.message || "").startsWith(MSG_PREFIX));
    if (!prev) fail("Tidak menemukan versi sebelum deploy kepatuhan. Isi ROLLBACK_VERSION.");
    target = prev.version.name;
  }
  if (!target.startsWith(`sites/${SITE}/versions/`)) target = `sites/${SITE}/versions/${target}`;
  const rel = await call("POST", `${API}/sites/${SITE}/releases?versionName=${encodeURIComponent(target)}`, { message: "rollback dari workflow kepatuhan" });
  if (!rel.ok) fail(`Rollback gagal: ${why(rel)}`);
  log(`rollback OK: ${target} live kembali`);
  summary(`### Rollback ${SITE}\nVersi \`${target}\` kembali live.`);
}

const cmd = process.argv[2];
if (!TOKEN) fail("FO_ACCESS_TOKEN kosong.");
({ snapshot, deploy, rollback }[cmd] || (() => fail(`Perintah tidak dikenal: ${cmd} (snapshot | deploy | rollback)`)))().catch((e) => fail(e && e.stack ? e.stack : String(e)));
