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

test("app.js: hanya 1 baris pengalih di awal loadDashboard, sisanya identik", () => {
  const out = patchFile("app.js", LIVE_APP);
  assert.equal(unpatchFile("app.js", out), LIVE_APP);
  const diff = out.split("\n").filter((l, i, a) => !LIVE_APP.split("\n").includes(l));
  assert.deepEqual(diff, ["  if(window.foDashboard) return window.foDashboard.load();"]);
  assert.match(out, /async function loadDashboard\(\)\{\n  if\(window\.foDashboard\) return window\.foDashboard\.load\(\);\n  const from = \$\("dashFrom"\)\.value;/);
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
