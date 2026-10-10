// Uji konsistensi master data app (public/master-data.js) + kelengkapan folder public/ dan script setup.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { STORE_MASTER, CREW_MASTER, CONTROL_POINTS, SCORE_CONFIG } from "../public/master-data.js";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
const ORIGINAL = [
  ["store-710", "#710", "KRAMATWATU"], ["store-923", "#923", "GRAHA RAYA"], ["store-922", "#922", "SEPATAN"],
  ["store-315", "#315", "ZAMRUD"], ["store-920", "#920", "BERINGIN"], ["store-914", "#914", "KOJA"],
  ["store-938", "#938", "CIGANJUR JAGAKARSA"], ["store-711", "#711", "CIKANDE"], ["store-840", "#840", "JOMBANG"],
  ["store-metland-puri", "", "METLAND PURI"],
];
const ADDED_YOGYA = { "JAKAL UII": ["UII", 10], "DEMANGAN": ["DMG", 9], "TAJEM": ["TJM", 8], "JAKAL 88": ["J88", 10], "JAKAL KM 5": ["JK5", 8] };
const ADDED = [
  "BASUKI RAHMAT TUBAN", "KEDIRI WACHID HASYIM", "TENGGILIS", "LAMONGREJO LAMONGAN", "MULYOSARI", "KRIAN SIDOARJO",
  "GRESIK KOTA BARU", "KENJERAN SURABAYA", "KARANG PILANG", "DHARMAWANGSA", "GELURAN SIDOARJO", "BUKIT PALMA",
  "PANGLIMA SUDIRMAN LUMAJANG",
];

test("10 store lama tidak berubah (id, kode, nama)", () => {
  for (const [id, code, name] of ORIGINAL) {
    const s = STORE_MASTER.find((x) => x.id === id);
    assert.ok(s, `store ${id} hilang`);
    assert.equal(s.code, code); assert.equal(s.name, name);
  }
});

test("13 store Jawa Timur + 5 store Yogyakarta ada, total 28, id/nama unik dan rapi", () => {
  assert.equal(STORE_MASTER.length, ORIGINAL.length + ADDED.length + Object.keys(ADDED_YOGYA).length);
  for (const name of [...ADDED, ...Object.keys(ADDED_YOGYA)]) {
    const s = STORE_MASTER.find((x) => x.name === name);
    assert.ok(s, `store ${name} belum ada`);
    assert.equal(s.code, "", `${name}: kode store belum diketahui, harus kosong`);
    assert.match(s.id, /^store-[a-z0-9]+(-[a-z0-9]+)*$/, `${name}: id ${s.id} harus slug huruf kecil`);
  }
  assert.equal(new Set(STORE_MASTER.map((s) => s.id)).size, STORE_MASTER.length, "id store duplikat");
  assert.equal(new Set(STORE_MASTER.map((s) => s.name)).size, STORE_MASTER.length, "nama store duplikat");
  for (const s of STORE_MASTER) {
    assert.equal(s.name, s.name.trim().toUpperCase(), `${s.id}: nama store harus huruf besar tanpa spasi tepi`);
    assert.ok(s.name.length >= 3);
  }
});

test("setiap crew terhubung ke store yang ada, nama store konsisten, id crew unik", () => {
  const byId = new Map(STORE_MASTER.map((s) => [s.id, s]));
  for (const c of CREW_MASTER) {
    assert.ok(byId.has(c.storeId), `crew ${c.id} (${c.name}) menunjuk store ${c.storeId} yang tidak ada`);
    assert.equal(c.storeName, byId.get(c.storeId).name, `crew ${c.id}: storeName tidak sama dengan master`);
    assert.ok(c.name.trim().length > 1);
  }
  assert.equal(new Set(CREW_MASTER.map((c) => c.id)).size, CREW_MASTER.length, "id crew duplikat");
});

test("daftar store yang belum punya crew hanya 13 store baru (menu Evidence belum bisa dipakai di sana)", () => {
  const withCrew = new Set(CREW_MASTER.map((c) => c.storeId));
  const noCrew = STORE_MASTER.filter((s) => !withCrew.has(s.id)).map((s) => s.name).sort();
  assert.deepEqual(noCrew, [...ADDED].sort());
});

test("5 store Yogyakarta punya crew lengkap dengan id sementara PREFIX-NN", () => {
  for (const [storeName, [prefix, count]] of Object.entries(ADDED_YOGYA)) {
    const store = STORE_MASTER.find((s) => s.name === storeName);
    const crew = CREW_MASTER.filter((c) => c.storeId === store.id);
    assert.equal(crew.length, count, `${storeName}: jumlah crew`);
    crew.forEach((c, i) => {
      assert.equal(c.id, `${prefix}-${String(i + 1).padStart(2, "0")}`, `${storeName}: id crew urut`);
      assert.match(c.name, /^[A-Z][a-z]+$/, `${storeName}: nama crew ${c.name}`);
    });
  }
  assert.equal(CREW_MASTER.length, 61 + 37 + 8);
});

test("26 titik kontrol & bobot skor tidak berubah", () => {
  assert.equal(CONTROL_POINTS.length, 26);
  assert.equal(new Set(CONTROL_POINTS.map((p) => p.id)).size, 26);
  const sum = CONTROL_POINTS.reduce((s, p) => s + p.weight, 0);
  assert.equal(sum, 1500);
  assert.equal(SCORE_CONFIG.maxPoints, sum);
  assert.equal(SCORE_CONFIG.version, "AI_VISION_V1");
});

test("public/ lengkap dan sama persis dengan daftar file versi live (minus file otomatis /__/)", () => {
  const snap = JSON.parse(readFileSync(join(APP, "snapshot.json"), "utf8"));
  const expected = snap.files.filter((p) => !p.startsWith("/__/")).map((p) => p.slice(1)).sort();
  const actual = readdirSync(join(APP, "public")).filter((n) => !n.startsWith(".")).sort();
  assert.deepEqual(actual, expected);
  const html = readFileSync(join(APP, "public", "index.html"), "utf8");
  assert.match(html, /<title>Bangor Cleanliness Control<\/title>/);
  for (const ref of ["app.js", "styles.css", "favicon.png", "favicon.ico", "bangor-logo.png"]) assert.ok(html.includes(ref), `index.html tidak merujuk ${ref}`);
  const app = readFileSync(join(APP, "public", "app.js"), "utf8");
  assert.ok(app.includes('from "./master-data.js"') && app.includes('from "./firebase-config.js"'));
});

test("elemen UX (bar progres, navigasi area, kunci foto, ringkasan rekap, pencarian master) ada di HTML dan dipakai app.js", () => {
  const html = readFileSync(join(APP, "public", "index.html"), "utf8");
  const app = readFileSync(join(APP, "public", "app.js"), "utf8");
  for (const id of ["captureSticky", "csAction", "areaNav", "captureLockNote", "dailyRecapSummary", "storeSearch", "storeCount"]) {
    assert.ok(html.includes(`id="${id}"`), `index.html tanpa #${id}`);
    assert.ok(app.includes(`#${id}`), `app.js tidak memakai #${id}`);
  }
  assert.ok(!html.includes("11 Store Crew.xlsx"), "teks lama XLSX masih ada");
  assert.ok(app.includes("Belum ada crew terdaftar") && app.includes("renderStoresAdmin"));
});

test("setup-cloudshell.sh mengunduh semua file public/ + script + snapshot", () => {
  const sh = readFileSync(join(APP, "setup-cloudshell.sh"), "utf8");
  for (const n of readdirSync(join(APP, "public"))) assert.ok(sh.includes(`public/${n}`), `setup-cloudshell.sh tidak mengunduh public/${n}`);
  assert.ok(sh.includes("scripts/deploy-hosting.mjs") && sh.includes("snapshot.json"));
});
