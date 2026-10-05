#!/usr/bin/env node
// Deploy folder public/ ke situs Firebase Hosting TERPISAH di project trecking-filter-oil-store,
// lewat Firebase Hosting REST API (tanpa firebase-tools). Situs app Filter Oil utama tidak pernah disentuh:
// script menolak deploy ke situs default project.
//
// Env:
//   FO_ACCESS_TOKEN      access token Google (google-github-actions/auth, Workload Identity, scope cloud-platform)
//   FO_PROJECT_ID        default trecking-filter-oil-store
//   FO_SITE_CANDIDATES   ID situs yang dipakai/dibuat, dipisah koma; yang pertama yang sudah ada / berhasil dibuat dipakai
//   PUBLIC_DIR           default public (relatif ke folder app)

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep, dirname } from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const env = (k, d = "") => (process.env[k] ?? d).toString().trim();
const IN_CI = !!process.env.GITHUB_ACTIONS;
const API = (!IN_CI && env("FO_TEST_HOSTING_BASE")) || "https://firebasehosting.googleapis.com/v1beta1";
const UPLOAD_OVERRIDE = !IN_CI && env("FO_TEST_UPLOAD_BASE");
const TOKEN = env("FO_ACCESS_TOKEN");
const PROJECT = env("FO_PROJECT_ID", "trecking-filter-oil-store");
const CANDIDATES = env("FO_SITE_CANDIDATES", "kepatuhan-filter-oil,kepatuhan-filter-oil-bba,trecking-filter-oil-kepatuhan").split(",").map((s) => s.trim()).filter(Boolean);
const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DIR = join(APP_DIR, env("PUBLIC_DIR", "public"));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const fail = (m) => { console.error(IN_CI ? `::error::${m}` : `ERROR: ${m}`); process.exit(1); };

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

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".") || name.endsWith(".map")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p)); else out.push(p);
  }
  return out;
}

async function pickSite() {
  const list = await call("GET", `${API}/projects/${PROJECT}/sites?pageSize=100`);
  if (!list.ok) fail(`Daftar situs Hosting tidak bisa dibaca: ${why(list)}. Pastikan service account punya role Firebase Hosting Admin (jalankan setup-cloudshell.sh).`);
  const sites = (list.json.sites || []).map((s) => ({ id: s.name.split("/").pop(), type: s.type, url: s.defaultUrl }));
  const defaultIds = sites.filter((s) => s.type === "DEFAULT_SITE").map((s) => s.id);
  for (const id of CANDIDATES) {
    if (defaultIds.includes(id) || id === PROJECT) fail(`Menolak deploy ke situs utama app (${id}).`);
    const hit = sites.find((s) => s.id === id);
    if (hit) { log(`situs ${id} sudah ada`); return id; }
  }
  for (const id of CANDIDATES) {
    const r = await call("POST", `${API}/projects/${PROJECT}/sites?siteId=${encodeURIComponent(id)}`, {});
    if (r.ok) { log(`situs ${id} dibuat`); return id; }
    log(`situs ${id} tidak bisa dibuat (${why(r)}), coba nama berikutnya`);
  }
  fail("Tidak ada nama situs yang bisa dipakai. Isi FO_SITE_CANDIDATES dengan nama lain.");
}

async function main() {
  if (!TOKEN) fail("FO_ACCESS_TOKEN kosong (login Google gagal?).");
  const site = await pickSite();

  const files = walk(PUBLIC_DIR);
  if (!files.some((f) => relative(PUBLIC_DIR, f) === "index.html")) fail(`index.html tidak ada di ${PUBLIC_DIR}`);
  const byHash = new Map();
  const manifest = {};
  for (const f of files) {
    const gz = gzipSync(readFileSync(f), { level: 9 });
    const hash = createHash("sha256").update(gz).digest("hex");
    manifest["/" + relative(PUBLIC_DIR, f).split(sep).join("/")] = hash;
    byHash.set(hash, gz);
  }
  log(`${files.length} file siap di-upload ke situs ${site}`);

  const config = {
    headers: [
      { glob: "**", headers: { "X-Robots-Tag": "noindex, nofollow", "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" } },
      { glob: "/vendor/**", headers: { "Cache-Control": "public, max-age=604800" } },
    ],
  };
  const v = await call("POST", `${API}/sites/${site}/versions`, { config });
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
  const msg = (env("GITHUB_SHA") ? `commit ${env("GITHUB_SHA").slice(0, 7)}` : "deploy manual").slice(0, 100);
  const rel = await call("POST", `${API}/sites/${site}/releases?versionName=${encodeURIComponent(version)}`, { message: msg });
  if (!rel.ok) fail(`Gagal merilis versi: ${why(rel)}`);
  // Cek situs benar-benar melayani versi baru (CDN butuh beberapa detik).
  if (!env("FO_SKIP_SMOKE")) {
    const base = `https://${site}.web.app`;
    let ok = false, lastErr = "";
    for (let i = 0; i < 6 && !ok; i++) {
      if (i) await new Promise((r) => setTimeout(r, 5000));
      try {
        const page = await fetch(`${base}/?v=${Date.now()}`);
        const html = await page.text();
        const lib = await fetch(`${base}/vendor/exceljs.min.js`, { method: "HEAD" });
        ok = page.ok && html.includes("<title>Kepatuhan Filter Oil</title>") && lib.ok;
        lastErr = `halaman HTTP ${page.status}, exceljs HTTP ${lib.status}`;
      } catch (e) { lastErr = e.message; }
    }
    if (!ok) fail(`Situs ${base} belum melayani halaman dengan benar (${lastErr}).`);
    log(`cek situs OK: ${base} melayani halaman & pustaka Excel`);
  }
  console.log(`\nSELESAI: https://${site}.web.app`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Kepatuhan Filter Oil\nTerbit di https://${site}.web.app (${msg})\n`);
  }
}

main().catch((e) => fail(e && e.stack ? e.stack : String(e)));
