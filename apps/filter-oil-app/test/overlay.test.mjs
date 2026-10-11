// Uji scripts/build-overlay.mjs: index.html & app.js live hanya mendapat sisipan yang ditentukan, file pendukung disalin
// persis, dan semua nama yang di-import modul tambahan memang diekspor.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build, patchIndex, unpatchIndex, patchFile, unpatchFile, INSERTS, COPIES, PATCHES } from "../scripts/build-overlay.mjs";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
const SHARED = join(APP, "..", "filter-oil-kepatuhan", "public");
const LIVE_INDEX = readFileSync(join(APP, "live", "files", "index.html"), "utf8");
const LIVE_APP = readFileSync(join(APP, "live", "files", "app.js"), "utf8");

test("index.html: isi asli utuh, hanya 4 sisipan (CSS, menu, panel, script)", () => {
  const out = patchIndex(LIVE_INDEX);
  assert.equal(unpatchIndex(out), LIVE_INDEX);
  for (const ins of INSERTS) assert.equal(out.split(ins.add).length - 1, 1);
  assert.match(out, /<button class="tab" data-tab="kepatuhan"[^>]*>/);
  assert.match(out, /<section id="kepatuhan" class="panel"><\/section>\n  <\/main>/);
  // panel.js dimuat setelah app.js supaya tombol menu sudah terpasang handler app
  assert.ok(out.indexOf('src="app.js"') < out.indexOf('src="kepatuhan/panel.js"'));
  // menu baru ada di dalam <nav> (bukan di luar) dan id panel unik
  const nav = out.slice(out.indexOf('<nav class="sidebar-nav">'), out.indexOf("</nav>"));
  assert.match(nav, /data-tab="kepatuhan"/);
  assert.equal(out.split('id="kepatuhan"').length - 1, 1);
});

test("titik sisip hilang/dobel → build gagal, bukan menyisip sembarangan", () => {
  assert.throws(() => patchIndex(LIVE_INDEX.replace("\n      </nav>", "</nav>")), /ditemukan 0x/);
  assert.throws(() => patchIndex(LIVE_INDEX + "\n  </main>"), /ditemukan 2x/);
});

test("app.js: semua tambalan bisa dibalik persis; sisanya identik dengan live", () => {
  const out = patchFile("app.js", LIVE_APP);
  assert.equal(unpatchFile("app.js", out), LIVE_APP);
  assert.match(out, /async function loadDashboard\(\)\{\n  if\(window\.foDashboard\) return window\.foDashboard\.load\(\);\n  const from = \$\("dashFrom"\)\.value;/);
  // fungsi app lain (simpan evidence ke Firestore, master data, pergantian minyak) tidak tersentuh
  for (const keep of ["await setDoc(ref, {", "async function loadMasters(", "async function loadOilChangeHistory(", "function compressImage(", "async function getMetadataTime("])
    assert.equal(out.split(keep).length, LIVE_APP.split(keep).length, keep);
});

// Ambil fungsi dari app.js hasil tambalan apa adanya, lalu jalankan di Node dengan pengaturan slot live.
function loadPatched(settings = { slot1: "09:00", slot2: "16:00", slot3: "23:30", toleranceMin: 30 }) {
  const src = patchFile("app.js", LIVE_APP);
  const fn = (name) => { const i = src.indexOf(`function ${name}(`); return src.slice(i, src.indexOf("\n}\n", i) + 2); };
  const body = ["pad", "toDateKey", "toTime", "minutesOf", "wibWall", "evidenceClock", "autoSlot"].map((n) => src.match(new RegExp(`function ${n}\\(`)) && (n === "pad" || n === "toDateKey" || n === "toTime" ? src.match(new RegExp(`function ${n}\\([^\\n]*\\n`))[0] : fn(n))).join("");
  return new Function("state", `${body}; return { autoSlot, wibWall, evidenceClock };`)({ settings });
}
const at = (iso) => new Date(`${iso}+07:00`);
const pickOf = (x) => [x.id, x.dayOffset, x.slotDateKey, x.deviationMin, x.status];

test("autoSlot: hari operasional berganti 05:00 → filter malam lewat tengah malam = Filter 3 kemarin", () => {
  process.env.TZ = "Asia/Jakarta";
  const { autoSlot } = loadPatched();
  assert.deepEqual(pickOf(autoSlot(at("2026-10-11T00:40:59"))), ["FILTER-3", -1, "2026-10-10", 70, "LATE"]); // kasus Jagakarsa
  const cases = [
    ["2026-10-11T09:10:00", "FILTER-1", 0, "2026-10-11", 10, "ON TIME"],
    ["2026-10-11T06:23:00", "FILTER-1", 0, "2026-10-11", -157, "EARLY"],
    ["2026-10-11T05:00:00", "FILTER-1", 0, "2026-10-11", -240, "EARLY"],   // tepat jam ganti hari
    ["2026-10-11T04:59:00", "FILTER-3", -1, "2026-10-10", 329, "LATE"],
    ["2026-10-11T04:36:20", "FILTER-3", -1, "2026-10-10", 306, "LATE"],    // pola Sektor 9
    ["2026-10-11T04:15:00", "FILTER-3", -1, "2026-10-10", 285, "LATE"],
    ["2026-10-11T00:00:00", "FILTER-3", -1, "2026-10-10", 30, "ON TIME"],
    ["2026-10-11T12:30:00", "FILTER-1", 0, "2026-10-11", 210, "LATE"],     // tengah 09:00-16:00 → slot lebih awal (seperti lama)
    ["2026-10-11T16:40:00", "FILTER-2", 0, "2026-10-11", 40, "LATE"],
    ["2026-10-11T23:00:00", "FILTER-3", 0, "2026-10-11", -30, "ON TIME"],
    ["2026-10-11T23:59:00", "FILTER-3", 0, "2026-10-11", 29, "ON TIME"],
    ["2026-10-01T00:21:25", "FILTER-3", -1, "2026-09-30", 51, "LATE"],     // ganti bulan
    ["2027-01-01T00:10:00", "FILTER-3", -1, "2026-12-31", 40, "LATE"],     // ganti tahun
    ["2028-03-01T00:10:00", "FILTER-3", -1, "2028-02-29", 40, "LATE"],     // kabisat
  ];
  for (const [iso, ...want] of cases) assert.deepEqual(pickOf(autoSlot(at(iso))), want, iso);
});

test("autoSlot: jam 05:00-23:59 sama persis dengan aturan lama (tidak ada perubahan di siang hari)", () => {
  process.env.TZ = "Asia/Jakarta";
  const { autoSlot } = loadPatched();
  const slots = [["FILTER-1", 540], ["FILTER-2", 960], ["FILTER-3", 1410]];
  for (let m = 300; m < 1440; m++) {
    let best = slots[0], diff = Infinity, signed = 0;
    for (const [id, t] of slots) if (Math.abs(m - t) < diff) { best = [id, t]; diff = Math.abs(m - t); signed = m - t; }
    const r = autoSlot(at(`2026-10-11T${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:00`));
    assert.deepEqual([r.id, r.deviationMin, r.dayOffset], [best[0], signed, 0], `menit ${m}`);
  }
});

test("autoSlot: cadangan bila slot utama terisi; slot3 lewat tengah malam & dayCutoff bisa diatur", () => {
  process.env.TZ = "Asia/Jakarta";
  const { autoSlot } = loadPatched();
  // Sektor 9 23/09 02:50: utama Filter 3 22/09 (sudah terisi) → cadangan pertama Filter 1 23/09 (perilaku lama, atas pilihan crew)
  const r = autoSlot(at("2026-09-23T02:50:54"));
  assert.deepEqual(pickOf(r), ["FILTER-3", -1, "2026-09-22", 200, "LATE"]);
  assert.deepEqual(pickOf(r.alternatives[0]), ["FILTER-1", 0, "2026-09-23", -370, "EARLY"]);
  assert.equal(r.alternatives.length, 1);
  // foto siang/malam: tidak ada cadangan (Filter 1 yang terisi tidak dialihkan ke Filter 2/3 hari yang sama)
  for (const iso of ["2026-10-11T10:20:00", "2026-10-11T16:40:00", "2026-10-11T23:50:00", "2026-10-11T05:00:00"]) assert.deepEqual(autoSlot(at(iso)).alternatives, [], iso);
  const late = loadPatched({ slot1: "10:00", slot2: "17:00", slot3: "00:30", toleranceMin: 30 }).autoSlot;
  assert.deepEqual(pickOf(late(at("2026-10-10T23:50:00"))), ["FILTER-3", 0, "2026-10-10", -40, "EARLY"]);   // tidak lagi "besok"
  assert.deepEqual(pickOf(late(at("2026-10-11T00:20:00"))), ["FILTER-3", -1, "2026-10-10", -10, "ON TIME"]);
  const cut6 = loadPatched({ slot1: "09:00", slot2: "16:00", slot3: "23:30", toleranceMin: 30, dayCutoff: "06:00" }).autoSlot;
  assert.deepEqual(pickOf(cut6(at("2026-10-11T05:30:00"))), ["FILTER-3", -1, "2026-10-10", 360, "LATE"]);
  const broken = loadPatched({ slot1: "", slot2: "", slot3: "", toleranceMin: 30 }).autoSlot(at("2026-10-11T10:00:00"));
  assert.deepEqual(pickOf(broken), ["FILTER-1", 0, "2026-10-11", 0, "ON TIME"]);                           // sama dengan perilaku lama
});

test("wibWall: HP dengan zona waktu salah tetap memakai jam WIB; EXIF tidak diubah", () => {
  const instant = Date.parse("2026-10-05T07:16:25Z"); // 14:16:25 WIB (kasus Beringin 04/10, HP di UTC-12)
  for (const tz of ["Etc/GMT+12", "Asia/Jakarta", "UTC", "Asia/Makassar"]) {
    process.env.TZ = tz;
    const { wibWall, autoSlot } = loadPatched();
    const w = wibWall({ dt: new Date(instant), source: "Capture Session" });
    assert.deepEqual([w.getFullYear(), w.getMonth() + 1, w.getDate(), w.getHours(), w.getMinutes()], [2026, 10, 5, 14, 16], tz);
    assert.deepEqual(pickOf(autoSlot(w)), ["FILTER-2", 0, "2026-10-05", -104, "EARLY"], tz);
    const exif = new Date(2026, 9, 11, 0, 40, 0);
    assert.equal(wibWall({ dt: exif, source: "EXIF DateTimeOriginal" }), exif);
  }
  process.env.TZ = "Asia/Jakarta";
});

test("evidenceClock: tanggal foto ditulis bila beda dengan tanggal slot", () => {
  const { evidenceClock } = loadPatched();
  assert.equal(evidenceClock({ dateKey: "2026-10-11", evidenceLocalIso: "2026-10-11T09:40:41" }), "09:40:41");
  assert.equal(evidenceClock({ dateKey: "2026-10-10", evidenceLocalIso: "2026-10-11T00:40:59" }), "foto 11/10 00:40:59");
  assert.equal(evidenceClock({ dateKey: "2026-10-10" }), "");
});

test("build: overlay berisi file yang ditambal + salinan persis file pendukung", () => {
  const out = mkdtempSync(join(tmpdir(), "overlay-"));
  try {
    const files = build({ outDir: out });
    assert.deepEqual(files, [...Object.keys(PATCHES), ...COPIES.map(([, to]) => to)]);
    assert.equal(readFileSync(join(out, "index.html"), "utf8"), patchIndex(LIVE_INDEX));
    assert.equal(readFileSync(join(out, "app.js"), "utf8"), patchFile("app.js", LIVE_APP));
    for (const [from, to] of COPIES) {
      const src = from.startsWith("@shared/") ? join(SHARED, from.slice(8)) : join(APP, from);
      assert.ok(readFileSync(join(out, to)).equals(readFileSync(src)), to);
    }
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test("modul tambahan hanya meng-import nama yang benar-benar diekspor", async () => {
  const out = mkdtempSync(join(tmpdir(), "overlay-"));
  try {
    build({ outDir: out });
    const dir = join(out, "kepatuhan");
    let checked = 0;
    for (const file of ["panel.js", "common.js", "dashboard.js"]) {
      const src = readFileSync(join(dir, file), "utf8");
      for (const [, names, target] of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*"\.\/([\w.]+)"/g)) {
        const mod = await import(pathToFileURL(join(dir, target)).href);
        for (const n of names.split(",").map((x) => x.trim()).filter(Boolean)) { assert.ok(n in mod, `${file}: ${target} tidak mengekspor ${n}`); checked++; }
      }
    }
    assert.ok(checked > 30, `hanya ${checked} nama diperiksa`);
    // panel.js memuat dashboard.js secara dinamis
    assert.match(readFileSync(join(dir, "panel.js"), "utf8"), /import\("\.\/dashboard\.js"\)\.then\(\(m\) => m\.initDashboard\(\)\)/);
    const dash = await import(pathToFileURL(join(dir, "dashboard.js")).href);
    assert.equal(typeof dash.initDashboard, "function");
  } finally { rmSync(out, { recursive: true, force: true }); }
});
