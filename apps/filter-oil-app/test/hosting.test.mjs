// Uji scripts/hosting.mjs (snapshot / deploy / rollback situs utama) terhadap Firebase Hosting API tiruan.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync, gunzipSync } from "node:zlib";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "hosting.mjs");
const gz = (s) => gzipSync(Buffer.from(s), { level: 9 });
const h = (buf) => createHash("sha256").update(buf).digest("hex");
const SITE = "trecking-filter-oil-store";

function makeWorkdir() {
  const dir = mkdtempSync(join(tmpdir(), "fo-app-"));
  mkdirSync(join(dir, "scripts"), { recursive: true });
  cpSync(SRC, join(dir, "scripts", "hosting.mjs"));
  return dir;
}

async function mock() {
  // situs dengan 2 file live: /index.html dan /app.js
  const content = { "/index.html": "<html><body><div id=app></div></body></html>", "/app.js": "console.log('app')" };
  const stored = new Map(); // hash → gzip buffer (penyimpanan Hosting)
  const versions = {};
  const live = { name: `sites/${SITE}/versions/v0`, files: {}, config: { rewrites: [{ glob: "**", path: "/index.html" }], cleanUrls: true } };
  for (const [p, c] of Object.entries(content)) { const g = gz(c); stored.set(h(g), g); live.files[p] = h(g); }
  versions[live.name] = { ...live, status: "FINALIZED" };
  const releases = [{ type: "DEPLOY", version: { name: live.name, status: "FINALIZED", config: live.config }, releaseTime: "2026-10-01T00:00:00Z", releaseUser: { email: "owner@x" }, message: "deploy app" }];
  let vcount = 0;
  const calls = { created: [], released: [], uploaded: 0 };
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const url = new URL(req.url, "http://x");
    const p = decodeURIComponent(url.pathname);
    const json = (code, o) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
    // origin publik (tanpa auth): sajikan file dari versi yang sedang live
    if (p.startsWith("/origin/")) {
      const path = p.slice("/origin".length);
      const curr = versions[releases[0].version.name];
      const hh = curr.files[path === "/" ? "/index.html" : path];
      if (!hh) { res.writeHead(404); return res.end("nf"); }
      res.writeHead(200, { "Content-Type": "text/plain" }); return res.end(gunzipSync(stored.get(hh)));
    }
    if (req.headers.authorization !== "Bearer tok") return json(401, { error: { message: "unauth" } });
    if (req.method === "GET" && p === `/sites/${SITE}/channels/live/releases`) return json(200, { releases });
    let m;
    if (req.method === "GET" && (m = p.match(/^\/(sites\/[^/]+\/versions\/[^/]+)\/files$/))) return json(200, { files: Object.entries(versions[m[1]].files).map(([path, hash]) => ({ path, hash, status: "ACTIVE" })) });
    if (req.method === "POST" && p === `/sites/${SITE}/versions`) { const name = `sites/${SITE}/versions/v${++vcount}`; versions[name] = { name, config: JSON.parse(body).config, files: {}, status: "CREATED" }; calls.created.push(versions[name]); return json(200, { name }); }
    if (req.method === "POST" && (m = p.match(/^\/(sites\/[^/]+\/versions\/[^/]+):populateFiles$/))) {
      const files = JSON.parse(body).files; versions[m[1]].files = files;
      return json(200, { uploadRequiredHashes: [...new Set(Object.values(files))].filter((x) => !stored.has(x)), uploadUrl: "x" });
    }
    if (req.method === "POST" && (m = p.match(/:upload\/([0-9a-f]{64})$/))) { if (h(body) !== m[1]) return json(400, { error: { message: "hash" } }); stored.set(m[1], body); calls.uploaded++; return json(200, {}); }
    if (req.method === "PATCH" && (m = p.match(/^\/(sites\/[^/]+\/versions\/[^/]+)$/))) { versions[m[1]].status = JSON.parse(body).status; return json(200, {}); }
    if (req.method === "POST" && p === `/sites/${SITE}/releases`) {
      const vn = url.searchParams.get("versionName");
      if (!versions[vn] || versions[vn].status !== "FINALIZED") return json(400, { error: { message: "version not finalized" } });
      releases.unshift({ type: "DEPLOY", version: { name: vn, config: versions[vn].config }, releaseTime: "now", message: JSON.parse(body).message });
      calls.released.push(vn); return json(200, {});
    }
    return json(404, { error: { message: `no route ${req.method} ${p}` } });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, calls, versions, releases, live, content, stored, close: () => new Promise((r) => server.close(r)) };
}
const run = (dir, m, cmd, extra = {}) => new Promise((resolve) => execFile(process.execPath, [join(dir, "scripts", "hosting.mjs"), cmd], {
  env: { PATH: process.env.PATH, FO_ACCESS_TOKEN: "tok", FO_TEST_HOSTING_BASE: m.base, FO_TEST_UPLOAD_BASE: m.base, FO_TEST_ORIGIN: `${m.base}/origin`, ...extra },
}, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr })));

test("snapshot → deploy overlay (file lama dipakai ulang via hash) → deploy ulang → rollback", async () => {
  const m = await mock(); const dir = makeWorkdir();
  try {
    const s = await run(dir, m, "snapshot");
    assert.equal(s.code, 0, s.stderr + s.stdout);
    const state = JSON.parse(readFileSync(join(dir, "live", "hosting.json"), "utf8"));
    assert.equal(state.version, `sites/${SITE}/versions/v0`);
    assert.deepEqual(state.config, m.live.config);
    assert.equal(readFileSync(join(dir, "live", "files", "app.js"), "utf8"), m.content["/app.js"]);

    // overlay: index.html dimodifikasi + halaman /kepatuhan/
    mkdirSync(join(dir, "overlay", "kepatuhan"), { recursive: true });
    writeFileSync(join(dir, "overlay", "index.html"), "<html><body><div id=app></div><script src=/kepatuhan/menu.js></script></body></html>");
    writeFileSync(join(dir, "overlay", "kepatuhan", "menu.js"), "/*menu*/");
    const d = await run(dir, m, "deploy");
    assert.equal(d.code, 0, d.stderr + d.stdout);
    const v1 = m.versions[`sites/${SITE}/versions/v1`];
    assert.deepEqual(v1.config, m.live.config, "konfigurasi hosting disalin persis");
    assert.equal(v1.files["/app.js"], m.live.files["/app.js"], "file lama dipakai ulang tanpa upload");
    assert.notEqual(v1.files["/index.html"], m.live.files["/index.html"]);
    assert.ok(v1.files["/kepatuhan/menu.js"]);
    assert.equal(m.calls.uploaded, 2, "hanya 2 file overlay yang di-upload");
    assert.match(m.releases[0].message, /^kepatuhan: .* v0/);
    assert.match(d.stdout, /Versi sebelumnya \(untuk rollback\): sites\/trecking-filter-oil-store\/versions\/v0/);
    assert.match(d.stdout, /cek situs OK/);

    // deploy ulang di atas deploy kita sendiri tetap boleh (snapshot sama)
    writeFileSync(join(dir, "overlay", "kepatuhan", "menu.js"), "/*menu v2*/");
    const d2 = await run(dir, m, "deploy");
    assert.equal(d2.code, 0, d2.stderr + d2.stdout);
    assert.equal(m.versions[`sites/${SITE}/versions/v2`].files["/app.js"], m.live.files["/app.js"]);

    // rollback otomatis ke versi terakhir yang bukan hasil deploy kepatuhan
    const r = await run(dir, m, "rollback");
    assert.equal(r.code, 0, r.stderr + r.stdout);
    assert.equal(m.releases[0].version.name, `sites/${SITE}/versions/v0`);
  } finally { await m.close(); }
});

test("deploy dibatalkan bila app sudah di-deploy ulang orang lain sejak snapshot", async () => {
  const m = await mock(); const dir = makeWorkdir();
  try {
    assert.equal((await run(dir, m, "snapshot")).code, 0);
    // pemilik app deploy versi baru (bukan kepatuhan)
    const g = gz("console.log('app v2')"); m.stored.set(h(g), g);
    m.versions[`sites/${SITE}/versions/vX`] = { name: `sites/${SITE}/versions/vX`, files: { ...m.live.files, "/app.js": h(g) }, config: m.live.config, status: "FINALIZED" };
    m.releases.unshift({ type: "DEPLOY", version: { name: `sites/${SITE}/versions/vX`, config: m.live.config }, message: "update app" });
    mkdirSync(join(dir, "overlay"), { recursive: true });
    writeFileSync(join(dir, "overlay", "index.html"), "<html>x</html>");
    const d = await run(dir, m, "deploy");
    assert.equal(d.code, 1);
    assert.match(d.stderr, /berbeda dari snapshot/);
    assert.equal(m.calls.released.length, 0, "tidak ada rilis");
  } finally { await m.close(); }
});

test("tanpa snapshot atau overlay: deploy menolak", async () => {
  const m = await mock(); const dir = makeWorkdir();
  try {
    const a = await run(dir, m, "deploy");
    assert.equal(a.code, 1); assert.match(a.stderr, /Jalankan snapshot dulu/);
    assert.equal((await run(dir, m, "snapshot")).code, 0);
    const b = await run(dir, m, "deploy");
    assert.equal(b.code, 1); assert.match(b.stderr, /overlay\/ kosong/);
    assert.ok(!existsSync(join(dir, "overlay")));
  } finally { await m.close(); }
});
