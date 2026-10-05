// Uji scripts/deploy-hosting.mjs terhadap Firebase Hosting API tiruan.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "deploy-hosting.mjs");

async function mock({ sites = [{ id: "trecking-filter-oil-store", type: "DEFAULT_SITE" }], taken = [] } = {}) {
  const calls = { created: [], uploads: {}, finalized: 0, released: [], manifest: null, config: null };
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const url = new URL(req.url, "http://x");
    const json = (code, o) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
    if (req.headers.authorization !== "Bearer tok") return json(401, { error: { message: "unauth" } });
    const p = decodeURIComponent(url.pathname);
    if (req.method === "GET" && p === "/projects/trecking-filter-oil-store/sites") return json(200, { sites: sites.map((s) => ({ name: `projects/trecking-filter-oil-store/sites/${s.id}`, type: s.type || "USER_SITE", defaultUrl: `https://${s.id}.web.app` })) });
    if (req.method === "POST" && p === "/projects/trecking-filter-oil-store/sites") {
      const id = url.searchParams.get("siteId");
      if (taken.includes(id)) return json(409, { error: { message: `Site ${id} already exists in another project` } });
      calls.created.push(id); sites.push({ id }); return json(200, { name: `projects/x/sites/${id}` });
    }
    let m;
    if (req.method === "POST" && (m = p.match(/^\/sites\/([^/]+)\/versions$/))) { calls.config = JSON.parse(body).config; return json(200, { name: `sites/${m[1]}/versions/v1` }); }
    if (req.method === "POST" && p.endsWith("/versions/v1:populateFiles")) {
      calls.manifest = JSON.parse(body).files;
      return json(200, { uploadRequiredHashes: Object.values(calls.manifest), uploadUrl: "ignored" });
    }
    if (req.method === "POST" && (m = p.match(/\/versions\/v1:upload\/([0-9a-f]{64})$/))) {
      const h = createHash("sha256").update(body).digest("hex");
      if (h !== m[1]) return json(400, { error: { message: "hash mismatch" } });
      calls.uploads[h] = gunzipSync(body).toString("utf8").slice(0, 40); return json(200, {});
    }
    if (req.method === "PATCH" && p.endsWith("/versions/v1")) { if (JSON.parse(body).status === "FINALIZED") calls.finalized++; return json(200, {}); }
    if (req.method === "POST" && (m = p.match(/^\/sites\/([^/]+)\/releases$/))) { calls.released.push({ site: m[1], version: url.searchParams.get("versionName"), type: (body.length && JSON.parse(body).type) || undefined }); return json(200, {}); }
    return json(404, { error: { message: `no route ${req.method} ${p}` } });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, calls, close: () => new Promise((r) => server.close(r)) };
}
const run = (m, extra = {}, args = []) => new Promise((resolve) => execFile(process.execPath, [SCRIPT, ...args], {
  env: { PATH: process.env.PATH, FO_ACCESS_TOKEN: "tok", FO_TEST_HOSTING_BASE: m.base, FO_TEST_UPLOAD_BASE: m.base, FO_SKIP_SMOKE: "1", ...extra },
}, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr })));

test("buat situs baru (lewati nama yang sudah dipakai project lain), upload, finalisasi, rilis", async () => {
  const m = await mock({ taken: ["kepatuhan-filter-oil"] });
  try {
    const r = await run(m);
    assert.equal(r.code, 0, r.stderr + r.stdout);
    assert.deepEqual(m.calls.created, ["kepatuhan-filter-oil-bba"]);
    assert.ok(m.calls.manifest["/index.html"] && m.calls.manifest["/app.js"] && m.calls.manifest["/kepatuhan.js"] && m.calls.manifest["/vendor/exceljs.min.js"]);
    assert.equal(Object.keys(m.calls.uploads).length, new Set(Object.values(m.calls.manifest)).size);
    assert.match(Object.values(m.calls.uploads).join("|"), /<!doctype html>/);
    assert.equal(m.calls.finalized, 1);
    assert.deepEqual(m.calls.released, [{ site: "kepatuhan-filter-oil-bba", version: "sites/kepatuhan-filter-oil-bba/versions/v1", type: undefined }]);
    assert.match(r.stdout, /SELESAI: https:\/\/kepatuhan-filter-oil-bba\.web\.app/);
    assert.equal(m.calls.config.headers[0].headers["X-Robots-Tag"], "noindex, nofollow");
  } finally { await m.close(); }
});

test("pakai situs yang sudah ada tanpa membuat baru", async () => {
  const m = await mock({ sites: [{ id: "trecking-filter-oil-store", type: "DEFAULT_SITE" }, { id: "kepatuhan-filter-oil" }] });
  try {
    const r = await run(m);
    assert.equal(r.code, 0, r.stderr + r.stdout);
    assert.deepEqual(m.calls.created, []);
    assert.equal(m.calls.released[0].site, "kepatuhan-filter-oil");
  } finally { await m.close(); }
});

test("menolak deploy ke situs utama app Filter Oil", async () => {
  const m = await mock();
  try {
    const r = await run(m, { FO_SITE_CANDIDATES: "trecking-filter-oil-store" });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Menolak deploy ke situs utama app/);
    assert.equal(m.calls.released.length, 0);
  } finally { await m.close(); }
});

test("disable: matikan situs terpisah yang ada (SITE_DISABLE), tanpa membuat situs baru", async () => {
  const m = await mock({ sites: [{ id: "trecking-filter-oil-store", type: "DEFAULT_SITE" }, { id: "kepatuhan-filter-oil" }] });
  try {
    const r = await run(m, {}, ["disable"]);
    assert.equal(r.code, 0, r.stderr + r.stdout);
    assert.deepEqual(m.calls.created, []);
    assert.deepEqual(m.calls.released, [{ site: "kepatuhan-filter-oil", version: null, type: "SITE_DISABLE" }]);
    assert.match(r.stdout, /kepatuhan-filter-oil dimatikan/);
  } finally { await m.close(); }
});

test("disable: tidak menyentuh situs utama dan tidak membuat situs bila belum ada", async () => {
  const m = await mock();
  try {
    const r = await run(m, {}, ["disable"]);
    assert.equal(r.code, 0, r.stderr + r.stdout);
    assert.deepEqual(m.calls.created, []);
    assert.equal(m.calls.released.length, 0);
    const r2 = await run(m, { FO_SITE_CANDIDATES: "trecking-filter-oil-store" }, ["disable"]);
    assert.equal(r2.code, 1);
    assert.match(r2.stderr, /Menolak mematikan situs utama app/);
    assert.equal(m.calls.released.length, 0);
  } finally { await m.close(); }
});
