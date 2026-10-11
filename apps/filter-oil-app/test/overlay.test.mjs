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

test("app.js: tambalan bisa dibalik persis, sisanya identik dengan live", () => {
  const out = patchFile("app.js", LIVE_APP);
  assert.equal(unpatchFile("app.js", out), LIVE_APP);
  assert.match(out, /async function loadDashboard\(\)\{\n  if\(window\.foDashboard\) return window\.foDashboard\.load\(\);\n  const from = \$\("dashFrom"\)\.value;/);
  // baris yang berubah hanya di autoSlot, pratinjau slot, cek duplikat, dan penanggalan record
  const liveLines = new Set(LIVE_APP.split("\n"));
  const added = out.split("\n").filter((l) => !liveLines.has(l));
  assert.ok(added.length > 0 && added.length <= 20, `${added.length} baris berubah`);
  for (const l of added) assert.match(l, /foDashboard|dayOffset|slotDay|slotDateKey|for\(const off|const delta|Math\.abs\(delta\) < diff|best = s|diff = Math|signed = delta|^\s*\}$|duplicate|toDateKey\(m\.dt\)\}T/, l);
  assert.equal(out.split("\n").length - LIVE_APP.split("\n").length, 2); // +1 pengalih dashboard, +4 autoSlot, -3 cek duplikat
});

// Jalankan autoSlot hasil tambalan apa adanya (diambil dari app.js) dengan pengaturan slot live.
function loadAutoSlot(settings = { slot1: "09:00", slot2: "16:00", slot3: "23:30", toleranceMin: 30 }) {
  const src = patchFile("app.js", LIVE_APP);
  const start = src.indexOf("function autoSlot(dt){");
  const end = src.indexOf("\n}\n", start) + 2;
  const helpers = "function pad(n){ return String(n).padStart(2, \"0\"); }\n" +
    src.match(/function toDateKey\(d\)\{[^\n]*\n/)[0] + src.match(/function minutesOf\(timeStr\)\{[\s\S]*?\n\}\n/)[0];
  return new Function("state", `${helpers}${src.slice(start, end)}; return autoSlot;`)({ settings });
}
const at = (iso) => new Date(`${iso}+07:00`);

test("autoSlot: foto lewat tengah malam = Filter 3 kemarin (kasus Jagakarsa 11/10 00:40)", () => {
  process.env.TZ = "Asia/Jakarta";
  const autoSlot = loadAutoSlot();
  const r = autoSlot(at("2026-10-11T00:40:59"));
  assert.equal(r.id, "FILTER-3"); assert.equal(r.dayOffset, -1); assert.equal(r.slotDateKey, "2026-10-10");
  assert.equal(r.deviationMin, 70); assert.equal(r.status, "LATE");
  const cases = [
    ["2026-10-11T09:10:00", "FILTER-1", 0, "2026-10-11", 10, "ON TIME"],
    ["2026-10-11T08:00:00", "FILTER-1", 0, "2026-10-11", -60, "EARLY"],
    ["2026-10-11T16:40:00", "FILTER-2", 0, "2026-10-11", 40, "LATE"],
    ["2026-10-11T23:50:00", "FILTER-3", 0, "2026-10-11", 20, "ON TIME"],
    ["2026-10-11T23:00:00", "FILTER-3", 0, "2026-10-11", -30, "ON TIME"],
    ["2026-10-11T00:00:00", "FILTER-3", -1, "2026-10-10", 30, "ON TIME"],
    ["2026-10-11T03:54:04", "FILTER-3", -1, "2026-10-10", 264, "LATE"],
    ["2026-10-11T04:36:20", "FILTER-1", 0, "2026-10-11", -264, "EARLY"],   // lebih dekat ke 09:00 hari ini
    ["2026-10-01T00:21:25", "FILTER-3", -1, "2026-09-30", 51, "LATE"],     // ganti bulan
    ["2027-01-01T00:10:00", "FILTER-3", -1, "2026-12-31", 40, "LATE"],     // ganti tahun
    ["2026-03-01T00:10:00", "FILTER-3", -1, "2026-02-28", 40, "LATE"],     // Februari
  ];
  for (const [iso, id, off, key, dev, st] of cases) {
    const x = autoSlot(at(iso));
    assert.deepEqual([x.id, x.dayOffset, x.slotDateKey, x.deviationMin, x.status], [id, off, key, dev, st], iso);
  }
});

test("autoSlot: jarak sama → slot hari yang sama menang; pengaturan slot lain tetap jalan", () => {
  process.env.TZ = "Asia/Jakarta";
  // 04:15 tepat di tengah 23:30 kemarin dan 09:00: dua-duanya 285 menit → tetap Filter 1 hari ini (perilaku lama)
  const mid = loadAutoSlot()(at("2026-10-11T04:15:00"));
  assert.deepEqual([mid.id, mid.dayOffset, mid.deviationMin], ["FILTER-1", 0, -285]);
  const early = loadAutoSlot({ slot1: "06:00", slot2: "14:00", slot3: "22:00", toleranceMin: 15 });
  const r = early(at("2026-10-11T01:00:00"));
  assert.deepEqual([r.id, r.dayOffset, r.slotDateKey, r.deviationMin, r.status], ["FILTER-3", -1, "2026-10-10", 180, "LATE"]);
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
