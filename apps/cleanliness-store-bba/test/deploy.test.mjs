// Uji scripts/deploy-hosting.mjs terhadap Firebase Hosting API tiruan (tanpa menyentuh situs asli).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(APP, "scripts", "deploy-hosting.mjs");
const SNAP = JSON.parse(readFileSync(join(APP, "snapshot.json"), "utf8"));
const SITE = "cleanliness-store-bba";

async function mock({ liveVersion = SNAP.version, liveMessage = "", releaseUser = "nabawim@gmail.com" } = {}) {
  const calls = { versions: 0, config: null, manifest: null, uploads: {}, finalized: 0, released: [] };
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const url = new URL(req.url, "http://x");
    const json = (code, o) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
    const p = decodeURIComponent(url.pathname);
    let m;
    // Situs publik tiruan (tanpa Authorization) untuk cek pasca-rilis: layani file yang sudah di-upload.
    if (req.method === "GET" && (m = p.match(/^\/site\/(.+)$/))) {
      const h = calls.manifest && calls.manifest["/" + m[1]];
      if (!h || !calls.uploads[h]) { res.writeHead(404); return res.end("nf"); }
      res.writeHead(200, { "Content-Type": "text/plain" }); return res.end(calls.uploads[h]);
    }
    if (req.headers.authorization !== "Bearer tok") return json(401, { error: { message: "unauth" } });
    if (req.method === "GET" && p === `/sites/${SITE}/channels/live/releases`) {
      return json(200, { releases: [{ name: `sites/${SITE}/channels/live/releases/1`, type: "DEPLOY", message: liveMessage, releaseTime: "2026-08-25T07:47:36.295Z", releaseUser: { email: releaseUser }, version: { name: liveVersion, status: "FINALIZED" } }] });
    }
    if (req.method === "POST" && (m = p.match(/^\/sites\/([^/]+)\/versions$/))) { calls.versions++; calls.config = JSON.parse(body).config; return json(200, { name: `sites/${m[1]}/versions/v1` }); }
    if (req.method === "POST" && p.endsWith("/versions/v1:populateFiles")) {
      calls.manifest = JSON.parse(body).files;
      return json(200, { uploadRequiredHashes: Object.values(calls.manifest), uploadUrl: "ignored" });
    }
    if (req.method === "POST" && (m = p.match(/\/versions\/v1:upload\/([0-9a-f]{64})$/))) {
      const h = createHash("sha256").update(body).digest("hex");
      if (h !== m[1]) return json(400, { error: { message: "hash mismatch" } });
      calls.uploads[h] = gunzipSync(body); return json(200, {});
    }
    if (req.method === "PATCH" && p.endsWith("/versions/v1")) { if (JSON.parse(body).status === "FINALIZED") calls.finalized++; return json(200, {}); }
    if (req.method === "POST" && (m = p.match(/^\/sites\/([^/]+)\/releases$/))) { calls.released.push({ site: m[1], version: url.searchParams.get("versionName"), message: JSON.parse(body).message }); return json(200, {}); }
    return json(404, { error: { message: `no route ${req.method} ${p}` } });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, calls, close: () => new Promise((r) => server.close(r)) };
}
const run = (m, extra = {}) => new Promise((resolve) => execFile(process.execPath, [SCRIPT], {
  env: { PATH: process.env.PATH, ACCESS_TOKEN: "tok", TEST_HOSTING_BASE: m.base, TEST_UPLOAD_BASE: m.base, TEST_ORIGIN: `${m.base}/site`, TEST_SMOKE_DELAY_MS: "10", ...extra },
}, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr })));

test("versi live = snapshot: upload semua file, headers sama dengan versi live, rilis berpesan bba-app:, cek situs lolos", async () => {
  const m = await mock();
  try {
    const r = await run(m);
    assert.equal(r.code, 0, r.stderr + r.stdout);
    assert.equal(m.calls.versions, 1);
    assert.deepEqual(m.calls.config, SNAP.config);
    assert.deepEqual(Object.keys(m.calls.manifest).sort(), SNAP.files.filter((p) => !p.startsWith("/__/")).sort());
    assert.equal(Object.keys(m.calls.uploads).length, new Set(Object.values(m.calls.manifest)).size);
    const master = m.calls.uploads[m.calls.manifest["/master-data.js"]].toString("utf8");
    assert.ok(master.includes("BASUKI RAHMAT TUBAN") && master.includes("PANGLIMA SUDIRMAN LUMAJANG"), "master-data.js yang di-upload belum memuat store baru");
    assert.equal(m.calls.finalized, 1);
    assert.equal(m.calls.released.length, 1);
    assert.equal(m.calls.released[0].site, SITE);
    assert.equal(m.calls.released[0].version, `sites/${SITE}/versions/v1`);
    assert.match(m.calls.released[0].message, /^bba-app: deploy manual \(dasar 0deb67c34a2cbd3f, sebelumnya 0deb67c34a2cbd3f\)$/);
    assert.match(r.stdout, /cek situs OK/);
    assert.match(r.stdout, /SELESAI: /);
  } finally { await m.close(); }
});

test("versi live berbeda dan bukan hasil script ini: dibatalkan sebelum membuat versi", async () => {
  const m = await mock({ liveVersion: `sites/${SITE}/versions/lain123`, liveMessage: "", releaseUser: "orang-lain@gmail.com" });
  try {
    const r = await run(m);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /berbeda dari snapshot/);
    assert.match(r.stderr, /orang-lain@gmail.com/);
    assert.equal(m.calls.versions, 0);
    assert.equal(m.calls.released.length, 0);
  } finally { await m.close(); }
});

test("versi live hasil deploy script ini sebelumnya: boleh deploy lagi", async () => {
  const m = await mock({ liveVersion: `sites/${SITE}/versions/kita456`, liveMessage: "bba-app: commit abc1234 (dasar 0deb67c34a2cbd3f, sebelumnya 0deb67c34a2cbd3f)" });
  try {
    const r = await run(m, { DEPLOY_LABEL: "commit def5678" });
    assert.equal(r.code, 0, r.stderr + r.stdout);
    assert.equal(m.calls.released.length, 1);
    assert.equal(m.calls.released[0].message, "bba-app: commit def5678 (dasar 0deb67c34a2cbd3f, sebelumnya kita456)");
  } finally { await m.close(); }
});

test("FORCE_DEPLOY=1 menimpa versi asing dengan peringatan", async () => {
  const m = await mock({ liveVersion: `sites/${SITE}/versions/lain123` });
  try {
    const r = await run(m, { FORCE_DEPLOY: "1" });
    assert.equal(r.code, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /PERINGATAN \(FORCE_DEPLOY\)/);
    assert.equal(m.calls.released.length, 1);
  } finally { await m.close(); }
});

test("tanpa ACCESS_TOKEN berhenti sebelum memanggil API", async () => {
  const m = await mock();
  try {
    const r = await run(m, { ACCESS_TOKEN: "" });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /ACCESS_TOKEN kosong/);
    assert.equal(m.calls.versions, 0);
  } finally { await m.close(); }
});

test("cek situs gagal bila situs melayani isi berbeda", async () => {
  const m = await mock();
  try {
    const r = await run(m, { TEST_ORIGIN: `${m.base}/tidak-ada` });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /belum melayani versi baru/);
    assert.equal(m.calls.released.length, 1, "rilis sudah terjadi; yang gagal hanya verifikasi");
  } finally { await m.close(); }
});
