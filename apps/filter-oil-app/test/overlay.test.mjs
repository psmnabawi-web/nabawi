// Uji scripts/build-overlay.mjs: index.html live hanya mendapat 4 sisipan, file pendukung disalin persis,
// dan semua nama yang di-import panel.js memang diekspor modulnya.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build, patchIndex, unpatchIndex, INSERTS, COPIES } from "../scripts/build-overlay.mjs";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
const SHARED = join(APP, "..", "filter-oil-kepatuhan", "public");
const LIVE_INDEX = readFileSync(join(APP, "live", "files", "index.html"), "utf8");

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

test("build: overlay berisi index.html + salinan persis file pendukung", () => {
  const out = mkdtempSync(join(tmpdir(), "overlay-"));
  try {
    const files = build({ outDir: out });
    assert.deepEqual(files, ["index.html", ...COPIES.map(([, to]) => to)]);
    assert.equal(readFileSync(join(out, "index.html"), "utf8"), patchIndex(LIVE_INDEX));
    for (const [from, to] of COPIES) {
      const src = from.startsWith("@shared/") ? join(SHARED, from.slice(8)) : join(APP, from);
      assert.ok(readFileSync(join(out, to)).equals(readFileSync(src)), to);
    }
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test("panel.js hanya meng-import nama yang benar-benar diekspor", async () => {
  const src = readFileSync(join(APP, "src", "panel.js"), "utf8");
  const imports = [...src.matchAll(/import\s*\{([^}]+)\}\s*from\s*"\.\/([\w.]+)"/g)];
  assert.equal(imports.length, 2);
  for (const [, names, file] of imports) {
    const mod = await import(pathToFileURL(join(SHARED, file)).href);
    for (const n of names.split(",").map((x) => x.trim()).filter(Boolean)) assert.ok(n in mod, `${file} tidak mengekspor ${n}`);
  }
});
