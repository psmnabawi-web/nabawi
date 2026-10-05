// Uji end-to-end scripts/wa-blast.mjs terhadap server tiruan (Firestore REST, OAuth Google, Fonnte).
// Jalankan: npm test (di folder apps/filter-oil-wa). Tidak butuh internet maupun paket tambahan.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "wa-blast.mjs");
const PROJECT = "trecking-filter-oil-store";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const SA = { type: "service_account", project_id: PROJECT, client_email: `wa-blast-reader@${PROJECT}.iam.gserviceaccount.com`, private_key: privateKey.export({ type: "pkcs8", format: "pem" }) };

// ---------- nilai Firestore ----------
const S = (v) => ({ stringValue: v });
const TS = (v) => ({ timestampValue: v });
const I = (v) => ({ integerValue: String(v) });
const B = (v) => ({ booleanValue: v });
const REF = (path) => ({ referenceValue: `projects/${PROJECT}/databases/(default)/documents/${path}` });
const cmpVal = (a, b) => {
  const num = (v) => ("integerValue" in v ? Number(v.integerValue) : "doubleValue" in v ? Number(v.doubleValue) : null);
  if (num(a) !== null && num(b) !== null) return num(a) - num(b);
  if ("timestampValue" in a && "timestampValue" in b) return Date.parse(a.timestampValue) - Date.parse(b.timestampValue);
  if ("stringValue" in a && "stringValue" in b) return a.stringValue < b.stringValue ? -1 : a.stringValue > b.stringValue ? 1 : 0;
  return null; // beda tipe: tidak cocok (seperti Firestore)
};
const unquote = (p) => p.replace(/^`|`$/g, "");

// ---------- server tiruan ----------
async function startMock(db, groups = [], sheet = null) {
  const calls = { token: 0, sent: [], fetchGroup: 0, queries: [], riwayat: [] };
  const server = createServer(async (req, res) => {
    let body = ""; for await (const ch of req) body += ch;
    const url = new URL(req.url, "http://x");
    const json = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
    // OAuth: verifikasi JWT benar-benar ditandatangani private key service account
    if (url.pathname === "/token") {
      const p = new URLSearchParams(body); const [h, c, sig] = (p.get("assertion") || "").split(".");
      const ok = createVerify("RSA-SHA256").update(`${h}.${c}`).verify(publicKey, Buffer.from(sig || "", "base64url"));
      const claim = JSON.parse(Buffer.from(c || "", "base64url").toString() || "{}");
      if (!ok || claim.iss !== SA.client_email || !/datastore/.test(claim.scope)) return json(400, { error: "invalid_grant", error_description: "bad jwt" });
      calls.token++; return json(200, { access_token: "tok-123", expires_in: 3600 });
    }
    // Fonnte
    if (url.pathname.startsWith("/fonnte/")) {
      if (req.headers.authorization !== "fonnte-token") return json(200, { status: false, reason: "invalid token" });
      const p = new URLSearchParams(body);
      if (url.pathname === "/fonnte/send") { calls.sent.push({ target: p.get("target"), message: p.get("message") }); return json(200, { status: true, detail: "success! message in queue" }); }
      if (url.pathname === "/fonnte/fetch-group") { calls.fetchGroup++; return json(200, { status: true, detail: "update whatsapp group list" }); }
      if (url.pathname === "/fonnte/get-whatsapp-group") return calls.fetchGroup ? json(200, { status: true, data: groups }) : json(200, { status: false, reason: "data not found, please fetch" });
      return json(404, {});
    }
    if (!["Bearer tok-123", "Bearer direct-tok"].includes(req.headers.authorization)) return json(401, { error: { code: 401, message: "unauthenticated", status: "UNAUTHENTICATED" } });
    // Google Sheets (pengaturan & riwayat)
    if (url.pathname.startsWith("/v4/spreadsheets/")) {
      const [, , , id, , range] = url.pathname.split("/").map(decodeURIComponent);
      if (!sheet || id !== sheet.id) return json(404, { error: { code: 404, message: "Requested entity was not found.", status: "NOT_FOUND" } });
      if (sheet.forbidden) return json(403, { error: { code: 403, message: "The caller does not have permission", status: "PERMISSION_DENIED" } });
      if (req.method === "GET" && range === "Pengaturan!A2:B30") return json(200, { range, values: sheet.config });
      if (req.method === "POST" && range === "Riwayat!A:G:append" && url.searchParams.get("valueInputOption") === "RAW") { calls.riwayat.push(...JSON.parse(body).values); return json(200, { updates: { updatedRows: 1 } }); }
      return json(400, { error: { code: 400, message: `unsupported sheets ${req.method} ${range}` } });
    }
    // Firestore
    const prefix = `/v1/projects/${PROJECT}/databases/(default)/documents`;
    if (!decodeURIComponent(url.pathname).startsWith(prefix)) return json(404, { error: { code: 404, message: "project not found", status: "NOT_FOUND" } });
    let rest = decodeURIComponent(url.pathname).slice(prefix.length).replace(/^\//, "");
    let verb = ""; const m = rest.match(/^(.*?):(\w+)$/); if (m) { rest = m[1]; verb = m[2]; }
    const docsOf = (coll) => (db[coll] || []).map((d) => ({ name: `projects/${PROJECT}/databases/(default)/documents/${coll}/${d.id}`, fields: d.fields }));
    if (verb === "listCollectionIds") {
      const depth = rest ? rest.split("/").length + 1 : 1;
      const ids = [...new Set(Object.keys(db).filter((k) => k.split("/").length === depth && (rest ? k.startsWith(rest + "/") : true)).map((k) => k.split("/").pop()))];
      return json(200, { collectionIds: ids });
    }
    if (verb === "runAggregationQuery") {
      const q = JSON.parse(body).structuredAggregationQuery.structuredQuery; const coll = rest ? `${rest}/${q.from[0].collectionId}` : q.from[0].collectionId;
      return json(200, [{ result: { aggregateFields: { n: { integerValue: String((db[coll] || []).length) } } }, readTime: "x" }]);
    }
    if (verb === "runQuery") {
      const q = JSON.parse(body).structuredQuery; calls.queries.push(q);
      const coll = rest ? `${rest}/${q.from[0].collectionId}` : q.from[0].collectionId;
      let docs = docsOf(coll);
      const filters = q.where ? (q.where.compositeFilter ? q.where.compositeFilter.filters : [q.where]) : [];
      docs = docs.filter((d) => filters.every(({ fieldFilter: f }) => {
        const v = d.fields[unquote(f.field.fieldPath)]; if (!v) return false; const c = cmpVal(v, f.value); if (c === null) return false;
        return { GREATER_THAN_OR_EQUAL: c >= 0, LESS_THAN: c < 0, EQUAL: c === 0 }[f.op];
      }));
      if (q.orderBy) { const f = unquote(q.orderBy[0].field.fieldPath); docs = docs.filter((d) => d.fields[f]).sort((a, b) => cmpVal(b.fields[f], a.fields[f])); }
      if (q.limit) docs = docs.slice(0, q.limit);
      return json(200, docs.length ? docs.map((document) => ({ document, readTime: "x" })) : [{ readTime: "x" }]);
    }
    if (!verb && req.method === "GET") {
      const size = Number(url.searchParams.get("pageSize") || 300); const start = Number(url.searchParams.get("pageToken") || 0);
      const all = docsOf(rest); const page = all.slice(start, start + size);
      return json(200, { documents: page.length ? page : undefined, nextPageToken: start + size < all.length ? String(start + size) : undefined });
    }
    return json(400, { error: { code: 400, message: `unsupported ${req.method} ${url.pathname}` } });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, calls, close: () => new Promise((r) => server.close(r)) };
}

function run(mock, envOver) {
  const out = mkdtempSync(join(tmpdir(), "fo-wa-"));
  const env = { PATH: process.env.PATH, OUT_DIR: out, FO_SA_KEY: JSON.stringify(SA), FO_TEST_FIRESTORE_BASE: `${mock.base}/v1`, FO_TEST_TOKEN_URL: `${mock.base}/token`, FO_TEST_FONNTE_BASE: `${mock.base}/fonnte`, FO_TEST_SHEETS_BASE: mock.base, ...envOver };
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
  return new Promise((resolve) => execFile(process.execPath, [SCRIPT], { env }, (err, stdout, stderr) => {
    const files = readdirSync(out); const text = files.filter((f) => f.startsWith("laporan-")).map((f) => readFileSync(join(out, f), "utf8"))[0] || "";
    resolve({ code: err ? err.code : 0, stdout, stderr, files, text, out });
  }));
}

const STORES = {
  stores: [
    { id: "s1", fields: { name: S("BBA Cipete"), code: S("CPT"), active: B(true) } },
    { id: "s2", fields: { name: S("BBA Kemang"), code: S("KMG"), active: B(true) } },
    { id: "s3", fields: { name: S("BBA Bintaro"), code: S("BTR"), active: B(true) } },
    { id: "s4", fields: { name: S("BBA Tutup"), code: S("TTP"), active: B(false) } },
  ],
};
// "sekarang" = Senin 05/10/2026 12.02 WIB (05:02 UTC)
const NOON = "2026-10-05T05:02:00Z";

test("timestamp + storeId: hitung sudah/belum, store nonaktif tidak dihitung, data tanggal lain diabaikan", async () => {
  const mock = await startMock({ ...STORES, scorings: [
    { id: "a", fields: { storeId: S("s1"), createdAt: TS("2026-10-05T01:30:00Z"), score: I(80) } }, // 08.30 WIB hari ini
    { id: "b", fields: { storeId: S("s1"), createdAt: TS("2026-10-05T03:00:00Z"), score: I(90) } }, // dobel, tetap 1 store
    { id: "c", fields: { storeId: S("s2"), createdAt: TS("2026-10-04T16:59:00Z"), score: I(70) } }, // 23.59 WIB kemarin → bukan hari ini
    { id: "d", fields: { storeId: S("s4"), createdAt: TS("2026-10-05T02:00:00Z"), score: I(70) } }, // store nonaktif
  ] });
  try {
    const r = await run(mock, { ACTION: "dry_run", FO_TEST_NOW: NOON, FO_SCORE_COLLECTION: "scorings" });
    assert.equal(r.code, 0, r.stderr + r.stdout);
    assert.match(r.text, /\*Laporan Scoring Filter Oil\*/);
    assert.match(r.text, /Senin, 05\/10\/2026 · posisi 12\.02 WIB/);
    assert.match(r.text, /Sudah scoring: 1 dari 3 store \(33%\)\*\n1\. BBA Cipete\n/);
    assert.match(r.text, /Belum scoring: 2 dari 3 store \(67%\)\*\n1\. BBA Bintaro\n2\. BBA Kemang\n/);
    assert.doesNotMatch(r.text, /Tutup/);
    assert.match(r.stdout, /1 tidak cocok/); // dokumen store nonaktif
    assert.equal(mock.calls.sent.length, 0, "dry_run tidak boleh mengirim");
    // log publik tidak boleh memuat nama store
    assert.doesNotMatch(r.stdout + r.stderr, /Cipete|Kemang|Bintaro/);
    assert.match(r.stdout, /scorings — 4 dok — storeId:string, createdAt:timestamp, score:integer/);
  } finally { await mock.close(); }
});

test("jam 00.02 WIB = rekap final hari sebelumnya, bukan 0% hari baru", async () => {
  const mock = await startMock({ ...STORES, scorings: [
    { id: "a", fields: { storeId: S("s1"), createdAt: TS("2026-10-05T01:30:00Z") } },
    { id: "b", fields: { storeId: S("s2"), createdAt: TS("2026-10-05T16:30:00Z") } }, // 23.30 WIB Senin
    { id: "c", fields: { storeId: S("s3"), createdAt: TS("2026-10-05T17:01:00Z") } }, // 00.01 WIB Selasa → bukan Senin
  ] });
  try {
    const r = await run(mock, { ACTION: "dry_run", FO_TEST_NOW: "2026-10-05T17:02:00Z", FO_SCORE_COLLECTION: "scorings" });
    assert.equal(r.code, 0, r.stderr + r.stdout);
    assert.match(r.text, /\*Rekap Final Scoring Filter Oil\*\nSenin, 05\/10\/2026 · ditutup 00\.02 WIB/);
    assert.match(r.text, /Sudah scoring: 2 dari 3 store \(67%\)/);
    assert.match(r.text, /Tidak scoring: 1 dari 3 store \(33%\)\*\n1\. BBA Bintaro/);
    assert.match(r.text, /mohon dicek dan ditindaklanjuti/);
    assert.ok(r.files.includes("laporan-2026-10-05-final.txt"));
  } finally { await mock.close(); }
});

test("tanggal teks YYYY-MM-DD + field nama store (cocok tanpa peka huruf besar/spasi)", async () => {
  const mock = await startMock({ ...STORES, oil_checks: [
    { id: "a", fields: { namaStore: S("  bba  KEMANG "), tanggal: S("2026-10-05") } },
    { id: "b", fields: { namaStore: S("BBA Bintaro"), tanggal: S("2026-10-05 17:45") } },
    { id: "c", fields: { namaStore: S("BBA Cipete"), tanggal: S("2026-10-04") } },
  ] });
  try {
    const r = await run(mock, { ACTION: "dry_run", FO_TEST_NOW: "2026-10-05T11:02:00Z", FO_SCORE_COLLECTION: "oil_checks" });
    assert.equal(r.code, 0, r.stderr + r.stdout);
    assert.match(r.text, /posisi 18\.02 WIB/);
    assert.match(r.text, /Sudah scoring: 2 dari 3 store \(67%\)\*\n1\. BBA Bintaro\n2\. BBA Kemang/);
    assert.match(r.stdout, /tanggal:string "9999-99-99"/);
  } finally { await mock.close(); }
});

test("tanggal teks d/m/yyyy tanpa nol di depan + kode store", async () => {
  const mock = await startMock({ ...STORES, scoring: [
    { id: "a", fields: { store: S("BTR"), tgl: S("5/10/2026, 09.12.00") } },
    { id: "b", fields: { store: S("CPT"), tgl: S("05/10/2026") } },
    { id: "c", fields: { store: S("KMG"), tgl: S("15/10/2026") } }, // tanggal lain (awalan "5/10" tidak boleh cocok)
  ] });
  try {
    const r = await run(mock, { ACTION: "dry_run", FO_TEST_NOW: NOON, FO_SCORE_COLLECTION: "scoring" });
    assert.equal(r.code, 0, r.stderr + r.stdout);
    assert.match(r.text, /Sudah scoring: 2 dari 3 store \(67%\)\*\n1\. BBA Bintaro\n2\. BBA Cipete/);
    assert.match(r.stdout, /tgl\/bln\/thn/);
  } finally { await mock.close(); }
});

test("epoch milidetik + referensi dokumen store", async () => {
  const at = Date.parse("2026-10-05T04:00:00Z");
  const mock = await startMock({ ...STORES, scorings: [
    { id: "a", fields: { store: REF("stores/s3"), timestamp: I(at) } },
    { id: "b", fields: { store: REF("stores/s2"), timestamp: I(at - 86400000) } },
  ] });
  try {
    const r = await run(mock, { ACTION: "dry_run", FO_TEST_NOW: NOON, FO_SCORE_COLLECTION: "scorings" });
    assert.equal(r.code, 0, r.stderr + r.stdout);
    assert.match(r.text, /Sudah scoring: 1 dari 3 store \(33%\)\*\n1\. BBA Bintaro/);
    assert.match(r.stdout, /epoch ms/);
  } finally { await mock.close(); }
});

test("sub-koleksi per store: stores/{store}/scores", async () => {
  const mock = await startMock({ ...STORES,
    "stores/s1/scores": [{ id: "x", fields: { date: TS("2026-10-05T02:00:00Z") } }],
    "stores/s2/scores": [{ id: "y", fields: { date: TS("2026-10-03T02:00:00Z") } }],
    "stores/s3/scores": [{ id: "z", fields: { date: TS("2026-10-05T04:59:00Z") } }],
  });
  try {
    const r = await run(mock, { ACTION: "dry_run", FO_TEST_NOW: NOON, FO_SCORE_COLLECTION: "stores/{store}/scores" });
    assert.equal(r.code, 0, r.stderr + r.stdout);
    assert.match(r.text, /Sudah scoring: 2 dari 3 store \(67%\)\*\n1\. BBA Bintaro\n2\. BBA Cipete/);
  } finally { await mock.close(); }
});

test("dry_run tanpa FO_SCORE_COLLECTION: tampilkan struktur & tebak koleksi bila hanya satu kandidat", async () => {
  const mock = await startMock({ ...STORES, users: [{ id: "u", fields: { email: S("a@b.c") } }], filterOilScores: [{ id: "a", fields: { storeId: S("s2"), createdAt: TS("2026-10-05T02:00:00Z") } }] });
  try {
    const r = await run(mock, { ACTION: "dry_run", FO_TEST_NOW: NOON });
    assert.equal(r.code, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /3 koleksi/);
    assert.match(r.stdout, /tebakan koleksi "filterOilScores"/);
    assert.doesNotMatch(r.stdout, /a@b\.c/, "isi data tidak boleh masuk log");
    assert.match(r.text, /Sudah scoring: 1 dari 3 store/);
  } finally { await mock.close(); }
});

test("send: nama grup dicari lewat Fonnte lalu dikirim ke ID-nya; ID langsung juga didukung", async () => {
  const mock = await startMock({ ...STORES, scorings: [{ id: "a", fields: { storeId: S("s1"), createdAt: TS("2026-10-05T02:00:00Z") } }] },
    [{ id: "120363000000000001@g.us", name: "Grup Lain" }, { id: "120363000000000002@g.us", name: "Filter Oil BBA" }]);
  try {
    const r = await run(mock, { ACTION: "send", FO_TEST_NOW: NOON, FO_SCORE_COLLECTION: "scorings", WA_GATEWAY: "fonnte", WA_TOKEN: "fonnte-token", WA_TARGET: "filter oil bba, 120363000000000009@g.us" });
    assert.equal(r.code, 0, r.stderr + r.stdout);
    assert.deepEqual(mock.calls.sent.map((s) => s.target), ["120363000000000002@g.us", "120363000000000009@g.us"]);
    assert.match(mock.calls.sent[0].message, /Sudah scoring: 1 dari 3 store \(33%\)/);
    assert.equal(mock.calls.fetchGroup, 1);
    assert.doesNotMatch(r.stdout + r.stderr, /Filter Oil BBA|120363/i, "nama/ID grup tidak boleh masuk log");
    assert.match(r.stdout, /Selesai: 2 terkirim, 0 gagal/);
  } finally { await mock.close(); }
});

test("send: nama grup tidak ditemukan → exit 1, pesan jelas, tidak ada kiriman", async () => {
  const mock = await startMock({ ...STORES, scorings: [{ id: "a", fields: { storeId: S("s1"), createdAt: TS("2026-10-05T02:00:00Z") } }] }, [{ id: "120363000000000001@g.us", name: "Grup Lain" }]);
  try {
    const r = await run(mock, { ACTION: "send", FO_TEST_NOW: NOON, FO_SCORE_COLLECTION: "scorings", WA_TOKEN: "fonnte-token", WA_TARGET: "Filter Oil BBA" });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /nama grup tidak ditemukan/);
    assert.equal(mock.calls.sent.length, 0);
  } finally { await mock.close(); }
});

test("konfigurasi kurang: tanpa secret di dry_run aman (exit 0), di send gagal jelas", async () => {
  const mock = await startMock(STORES);
  try {
    const a = await run(mock, { ACTION: "dry_run", FO_SA_KEY: undefined });
    assert.equal(a.code, 0); assert.match(a.stdout, /Login Google belum tersedia/);
    const b = await run(mock, { ACTION: "send", FO_SA_KEY: undefined, WA_TOKEN: "fonnte-token", WA_TARGET: "x@g.us" });
    assert.equal(b.code, 1); assert.match(b.stderr, /Login Google belum tersedia/);
    const c = await run(mock, { ACTION: "send", WA_TOKEN: "", WA_TARGET: "x@g.us", FO_SCORE_COLLECTION: "scorings" });
    assert.equal(c.code, 1); assert.match(c.stderr, /Token gateway WhatsApp kosong/);
    const d = await run(mock, { ACTION: "dry_run", FO_SA_KEY: "{bukan json" });
    assert.equal(d.code, 1); assert.match(d.stderr, /bukan JSON service account/);
    const e = await run(mock, { ACTION: "dry_run", FO_SA_KEY: Buffer.from(JSON.stringify(SA)).toString("base64"), FO_TEST_NOW: NOON, FO_SCORE_COLLECTION: "kosong" });
    assert.equal(e.code, 1); assert.match(e.stderr, /Koleksi scoring "kosong" kosong/); // base64 diterima, login OK
  } finally { await mock.close(); }
});

test("nama store di data scoring tidak persis sama: cocok hanya bila tepat satu kandidat", async () => {
  const mock = await startMock({ stores: [
    { id: "s1", fields: { name: S("BBA Cipete Raya") } },
    { id: "s2", fields: { name: S("BBA Kemang 1") } },
    { id: "s3", fields: { name: S("BBA Kemang 2") } },
  ], scorings: [
    { id: "a", fields: { storeName: S("Cipete"), createdAt: TS("2026-10-05T02:00:00Z") } }, // 1 kandidat → cocok
    { id: "b", fields: { storeName: S("Kemang"), createdAt: TS("2026-10-05T02:00:00Z") } }, // 2 kandidat → tidak ditebak
  ] });
  try {
    const r = await run(mock, { ACTION: "dry_run", FO_TEST_NOW: NOON, FO_SCORE_COLLECTION: "scorings" });
    assert.equal(r.code, 0, r.stderr + r.stdout);
    assert.match(r.text, /Sudah scoring: 1 dari 3 store \(33%\)\*\n1\. BBA Cipete Raya\n/);
    assert.match(r.stdout, /1 data scoring dicocokkan lewat nama store yang mirip/);
    assert.match(r.stdout, /1 tidak cocok/);
  } finally { await mock.close(); }
});

// ---------- Sheet pengaturan + login tanpa key (FO_ACCESS_TOKEN dari Workload Identity) ----------
const SHEET_ID = "sheet-abc";
const SCORES_TODAY = { ...STORES, scorings: [{ id: "a", fields: { storeId: S("s1"), createdAt: TS("2026-10-05T02:00:00Z") } }] };
const GROUPS = [{ id: "120363000000000002@g.us", name: "Filter Oil BBA" }];
const viaSheet = (extra = {}) => ({ FO_SA_KEY: undefined, FO_ACCESS_TOKEN: "direct-tok", FO_PROJECT_ID: PROJECT, FO_CONFIG_SHEET_ID: SHEET_ID, FO_TEST_NOW: NOON, FO_SCORE_COLLECTION: "scorings", ...extra });

test("Sheet status UJI: jadwal tidak mengirim, pesan lengkap dicatat di tab Riwayat", async () => {
  const sheet = { id: SHEET_ID, config: [["status", "UJI"], ["fonnte_token", "fonnte-token"], ["grup_tujuan", "Filter Oil BBA"], ["judul", "Scoring Filter Oil BBA"]] };
  const mock = await startMock(SCORES_TODAY, GROUPS, sheet);
  try {
    const r = await run(mock, viaSheet({ ACTION: "send", FO_RUN_LABEL: "schedule" }));
    assert.equal(r.code, 0, r.stderr + r.stdout);
    assert.equal(mock.calls.token, 0, "FO_ACCESS_TOKEN dipakai langsung, tanpa tukar JWT");
    assert.equal(mock.calls.sent.length, 0);
    assert.equal(mock.calls.riwayat.length, 1);
    const [waktu, jenis, tgl, status, sudah, total, pesan] = mock.calls.riwayat[0];
    assert.equal(waktu, "2026-10-05 12.02"); assert.equal(jenis, "Progress"); assert.equal(tgl, "05/10/2026");
    assert.match(status, /Status UJI: tidak dikirim/); assert.equal(sudah, 1); assert.equal(total, 3);
    assert.match(pesan, /^\*Laporan Scoring Filter Oil BBA\*/);
    assert.match(r.stdout, /status=UJI \(Sheet\)/);
    assert.doesNotMatch(r.stdout + r.stderr, /fonnte-token|Filter Oil BBA|Cipete/);
  } finally { await mock.close(); }
});

test("Sheet status AKTIF: token & grup dari Sheet, terkirim, tercatat 'Terkirim'", async () => {
  const sheet = { id: SHEET_ID, config: [["status", "aktif"], ["fonnte_token", "fonnte-token"], ["grup_tujuan", "Filter Oil BBA"]] };
  const mock = await startMock(SCORES_TODAY, GROUPS, sheet);
  try {
    const r = await run(mock, viaSheet({ ACTION: "send" }));
    assert.equal(r.code, 0, r.stderr + r.stdout);
    assert.deepEqual(mock.calls.sent.map((x) => x.target), ["120363000000000002@g.us"]);
    assert.match(mock.calls.sent[0].message, /^\*Laporan Scoring Filter Oil\*/);
    assert.equal(mock.calls.riwayat[0][3], "Terkirim ke 1 grup");
  } finally { await mock.close(); }
});

test("Secret WA_TOKEN/WA_TARGET mengalahkan isi Sheet", async () => {
  const sheet = { id: SHEET_ID, config: [["status", "AKTIF"], ["fonnte_token", "token-salah"], ["grup_tujuan", "Grup Salah"]] };
  const mock = await startMock(SCORES_TODAY, GROUPS, sheet);
  try {
    const r = await run(mock, viaSheet({ ACTION: "send", WA_TOKEN: "fonnte-token", WA_TARGET: "120363000000000002@g.us" }));
    assert.equal(r.code, 0, r.stderr + r.stdout);
    assert.deepEqual(mock.calls.sent.map((x) => x.target), ["120363000000000002@g.us"]);
  } finally { await mock.close(); }
});

test("Sheet status MATI: tidak membaca Firestore, tidak mengirim", async () => {
  const mock = await startMock(SCORES_TODAY, GROUPS, { id: SHEET_ID, config: [["status", "MATI"], ["fonnte_token", "fonnte-token"], ["grup_tujuan", "Filter Oil BBA"]] });
  try {
    const r = await run(mock, viaSheet({ ACTION: "send" }));
    assert.equal(r.code, 0, r.stderr + r.stdout);
    assert.equal(mock.calls.queries.length, 0); assert.equal(mock.calls.sent.length, 0); assert.equal(mock.calls.riwayat.length, 0);
    assert.match(r.stdout, /Status MATI/);
  } finally { await mock.close(); }
});

test("AKTIF tapi grup kosong / Sheet belum dibagikan / data error: gagal jelas & tercatat bila bisa", async () => {
  const m1 = await startMock(SCORES_TODAY, GROUPS, { id: SHEET_ID, config: [["status", "AKTIF"], ["fonnte_token", "fonnte-token"]] });
  try {
    const r = await run(m1, viaSheet({ ACTION: "send" }));
    assert.equal(r.code, 1); assert.match(r.stderr, /Grup tujuan kosong/); assert.equal(m1.calls.sent.length, 0);
  } finally { await m1.close(); }
  const m2 = await startMock(SCORES_TODAY, GROUPS, { id: SHEET_ID, forbidden: true, config: [] });
  try {
    const r = await run(m2, viaSheet({ ACTION: "send" }));
    assert.equal(r.code, 1); assert.match(r.stderr, /bagikan Sheet ke service account sebagai Editor/);
  } finally { await m2.close(); }
  const m3 = await startMock(STORES, GROUPS, { id: SHEET_ID, config: [["status", "AKTIF"], ["fonnte_token", "fonnte-token"], ["grup_tujuan", "Filter Oil BBA"]] });
  try {
    const r = await run(m3, viaSheet({ ACTION: "send" }));
    assert.equal(r.code, 1); assert.equal(m3.calls.sent.length, 0);
    assert.match(m3.calls.riwayat[0][3], /^ERROR: Koleksi scoring "scorings" kosong/);
  } finally { await m3.close(); }
});
