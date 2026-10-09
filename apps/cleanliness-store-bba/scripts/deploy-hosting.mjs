#!/usr/bin/env node
// Deploy folder public/ ke situs UTAMA app Bangor Cleanliness Control (https://cleanliness-store-bba.web.app)
// lewat Firebase Hosting REST API, tanpa firebase-tools.
//
//   ACCESS_TOKEN="$(gcloud auth print-access-token)" node scripts/deploy-hosting.mjs      (Cloud Shell)
//   GitHub Actions: workflow deploy-cleanliness-store-bba.yml (token dari Workload Identity)
//
// Pengaman: deploy hanya jalan bila versi yang sedang live adalah
//   - versi snapshot di snapshot.json (versi yang menjadi dasar isi public/), atau
//   - versi hasil deploy script ini sendiri (pesan rilis berawalan "bba-app:").
// Kalau app sudah di-deploy ulang dari tempat lain (mis. firebase CLI di laptop), deploy dibatalkan supaya
// perubahan itu tidak tertimpa: ambil snapshot baru dulu, perbarui public/ + snapshot.json. FORCE_DEPLOY=1 memaksa.
//
// Env: ACCESS_TOKEN (wajib), SITE (default cleanliness-store-bba), PUBLIC_DIR (default public),
//      FORCE_DEPLOY (1 = abaikan pengaman), SKIP_SMOKE (1 = lewati cek situs setelah rilis), DEPLOY_LABEL (teks pesan rilis)

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, appendFileSync } from "node:fs";
import { join, relative, sep, dirname } from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const env = (k, d = "") => (process.env[k] ?? d).toString().trim();
const IN_CI = !!process.env.GITHUB_ACTIONS;
const API = (!IN_CI && env("TEST_HOSTING_BASE")) || "https://firebasehosting.googleapis.com/v1beta1";
const UPLOAD_OVERRIDE = !IN_CI && env("TEST_UPLOAD_BASE");
const ORIGIN_OVERRIDE = !IN_CI && env("TEST_ORIGIN");
const SMOKE_DELAY_MS = (!IN_CI && Number(env("TEST_SMOKE_DELAY_MS"))) || 5000;
const TOKEN = env("ACCESS_TOKEN");
const SITE = env("SITE", "cleanliness-store-bba");
const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DIR = join(APP_DIR, env("PUBLIC_DIR", "public"));
const SNAPSHOT = JSON.parse(readFileSync(join(APP_DIR, "snapshot.json"), "utf8"));
const MSG_PREFIX = "bba-app:";
const REQUIRED = ["index.html", "app.js", "master-data.js", "styles.css", "firebase-config.js"];
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const fail = (m) => { console.error(IN_CI ? `::error::${m}` : `ERROR: ${m}`); process.exit(1); };
const summary = (t) => { if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, t + "\n"); };

async function call(method, url, body, { raw = false, contentType = "application/json" } = {}) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": contentType },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* bukan JSON */ }
  return { ok: res.ok, status: res.status, json, text };
}
const why = (r) => `HTTP ${r.status} ${(r.json && r.json.error && r.json.error.message) || r.text.slice(0, 200)}`;
const shortVer = (name = "") => String(name).split("/").pop();

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".") || name.endsWith(".map")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p)); else out.push(p);
  }
  return out;
}

async function liveRelease() {
  const r = await call("GET", `${API}/sites/${SITE}/channels/live/releases?pageSize=10`);
  if (!r.ok) fail(`Riwayat rilis situs ${SITE} tidak bisa dibaca: ${why(r)}. Pastikan akun/service account punya role Firebase Hosting Admin di project ${SITE}.`);
  return (r.json.releases || []).find((x) => x.version && x.version.name) || null;
}

async function main() {
  if (!TOKEN) fail("ACCESS_TOKEN kosong. Cloud Shell: ACCESS_TOKEN=\"$(gcloud auth print-access-token)\" node scripts/deploy-hosting.mjs");

  // 1. Pengaman: versi live harus versi snapshot atau hasil deploy kita sendiri.
  const live = await liveRelease();
  if (!live) fail(`Situs ${SITE} belum punya versi live; cek nama situs/project.`);
  const liveName = live.version.name, liveMsg = live.message || "";
  const ours = liveMsg.startsWith(MSG_PREFIX);
  if (liveName !== SNAPSHOT.version && !ours) {
    const m = `Versi live ${shortVer(liveName)} (rilis ${live.releaseTime || "-"} oleh ${live.releaseUser?.email || "-"}) berbeda dari snapshot ${shortVer(SNAPSHOT.version)} dan bukan hasil deploy script ini. ` +
      "App sudah di-deploy ulang dari tempat lain; perubahan itu akan tertimpa. Ambil snapshot baru (export-firebase-app.sh), perbarui public/ + snapshot.json, lalu deploy lagi. FORCE_DEPLOY=1 untuk memaksa.";
    if (!env("FORCE_DEPLOY")) fail(m);
    log("PERINGATAN (FORCE_DEPLOY): " + m);
  } else {
    log(`versi live ${shortVer(liveName)} ${ours ? "(deploy script ini sebelumnya)" : "= snapshot"}; aman untuk deploy`);
  }

  // 2. Siapkan file.
  const files = walk(PUBLIC_DIR);
  const rels = files.map((f) => relative(PUBLIC_DIR, f).split(sep).join("/"));
  for (const r of REQUIRED) if (!rels.includes(r)) fail(`${r} tidak ada di ${PUBLIC_DIR}`);
  const byHash = new Map();
  const manifest = {};
  for (const f of files) {
    const gz = gzipSync(readFileSync(f), { level: 9 });
    const hash = createHash("sha256").update(gz).digest("hex");
    manifest["/" + relative(PUBLIC_DIR, f).split(sep).join("/")] = hash;
    byHash.set(hash, gz);
  }
  log(`${files.length} file siap di-upload ke situs ${SITE}`);

  // 3. Versi baru dengan konfigurasi hosting persis seperti versi live (headers).
  const config = SNAPSHOT.config && Object.keys(SNAPSHOT.config).length ? SNAPSHOT.config : {};
  const v = await call("POST", `${API}/sites/${SITE}/versions`, { config });
  if (!v.ok) fail(`Gagal membuat versi: ${why(v)}`);
  const version = v.json.name;

  const pop = await call("POST", `${API}/${version}:populateFiles`, { files: manifest });
  if (!pop.ok) fail(`Gagal mendaftarkan file: ${why(pop)}`);
  const need = pop.json.uploadRequiredHashes || [];
  const uploadUrl = UPLOAD_OVERRIDE ? `${UPLOAD_OVERRIDE}/${version}:upload` : pop.json.uploadUrl;
  for (const h of need) {
    const up = await call("POST", `${uploadUrl}/${h}`, byHash.get(h), { raw: true, contentType: "application/octet-stream" });
    if (!up.ok) fail(`Upload file gagal: ${why(up)}`);
  }
  log(`${need.length} file di-upload (${files.length - need.length} sudah ada di server)`);

  const fin = await call("PATCH", `${API}/${version}?update_mask=status`, { status: "FINALIZED" });
  if (!fin.ok) fail(`Gagal finalisasi versi: ${why(fin)}`);
  const label = env("DEPLOY_LABEL") || (env("GITHUB_SHA") ? `commit ${env("GITHUB_SHA").slice(0, 7)}` : "deploy manual");
  const msg = `${MSG_PREFIX} ${label} (dasar ${shortVer(SNAPSHOT.version)}, sebelumnya ${shortVer(liveName)})`.slice(0, 100);
  const rel = await call("POST", `${API}/sites/${SITE}/releases?versionName=${encodeURIComponent(version)}`, { message: msg });
  if (!rel.ok) fail(`Gagal merilis versi: ${why(rel)}`);
  log(`rilis ${shortVer(version)} diterbitkan: "${msg}"`);

  // 4. Cek situs benar-benar melayani file kita (CDN butuh beberapa detik).
  const base = ORIGIN_OVERRIDE || `https://${SITE}.web.app`;
  if (!env("SKIP_SMOKE")) {
    const want = Object.fromEntries(["index.html", "master-data.js"].map((n) => [n, readFileSync(join(PUBLIC_DIR, n), "utf8")]));
    let ok = false, lastErr = "";
    for (let i = 0; i < 8 && !ok; i++) {
      if (i) await new Promise((r) => setTimeout(r, SMOKE_DELAY_MS));
      try {
        const got = {};
        for (const n of Object.keys(want)) { const res = await fetch(`${base}/${n}?v=${Date.now()}`, { cache: "no-store" }); got[n] = res.ok ? await res.text() : `HTTP ${res.status}`; }
        ok = Object.keys(want).every((n) => got[n] === want[n]);
        lastErr = Object.keys(want).map((n) => `${n}: ${got[n] === want[n] ? "sama" : got[n].startsWith("HTTP ") ? got[n] : "isi berbeda"}`).join(", ");
      } catch (e) { lastErr = e.message; }
    }
    if (!ok) fail(`Situs ${base} belum melayani versi baru (${lastErr}).`);
    log(`cek situs OK: ${base} melayani index.html & master-data.js versi ini`);
  }
  console.log(`\nSELESAI: ${base} (versi ${shortVer(version)}, sebelumnya ${shortVer(liveName)})`);
  summary(`### Bangor Cleanliness Control\nTerbit di ${base}: versi \`${shortVer(version)}\` (${msg}). Rollback: Firebase Console → Hosting → riwayat rilis → versi \`${shortVer(liveName)}\`.`);
}

main().catch((e) => fail(e && e.stack ? e.stack : String(e)));
