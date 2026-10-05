#!/usr/bin/env node
// Rakit folder overlay/ untuk deploy ke situs utama app:
//   overlay/index.html        = live/files/index.html + 4 sisipan (CSS, tombol menu, panel kosong, script)
//   overlay/kepatuhan/*       = src/panel.{js,css} + logika & export Excel dari apps/filter-oil-kepatuhan/public
// File app lain (app.js, styles.css, dst.) TIDAK diubah; deploy memakai ulang file live yang sama persis.
// Setiap titik sisip harus ditemukan tepat satu kali; kalau index.html live berubah bentuk, build gagal (aman).

import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const LIVE = join(APP_DIR, "live", "files");
const OUT = join(APP_DIR, "overlay");
const SHARED = join(APP_DIR, "..", "filter-oil-kepatuhan", "public");

export const INSERTS = [
  { after: `<link rel="stylesheet" href="styles.css" />`, add: `\n  <link rel="stylesheet" href="kepatuhan/panel.css" />` },
  {
    before: `\n      </nav>`,
    add: `
        <button class="tab" data-tab="kepatuhan" data-title="Kepatuhan &amp; Export" data-subtitle="Store tidak patuh, peta harian, detail slot, dan export Excel.">
          <span class="nav-icon">⬇</span><span>Export Kepatuhan</span>
        </button>`,
  },
  { before: `\n  </main>`, add: `\n    <section id="kepatuhan" class="panel"></section>` },
  { after: `<script type="module" src="app.js"></script>`, add: `\n  <script type="module" src="kepatuhan/panel.js"></script>` },
];

export const COPIES = [
  ["src/panel.js", "kepatuhan/panel.js"],
  ["src/panel.css", "kepatuhan/panel.css"],
  ["@shared/core.js", "kepatuhan/core.js"],
  ["@shared/kepatuhan.js", "kepatuhan/kepatuhan.js"],
  ["@shared/vendor/exceljs.min.js", "kepatuhan/vendor/exceljs.min.js"],
  ["@shared/vendor/exceljs.LICENSE", "kepatuhan/vendor/exceljs.LICENSE"],
];

export function patchIndex(html) {
  let out = html;
  for (const ins of INSERTS) {
    const anchor = ins.after || ins.before;
    const n = out.split(anchor).length - 1;
    if (n !== 1) throw new Error(`Titik sisip ${JSON.stringify(anchor.trim())} ditemukan ${n}x di index.html live (harus 1x). Cek ulang snapshot.`);
    out = ins.after ? out.replace(anchor, () => anchor + ins.add) : out.replace(anchor, () => ins.add + anchor);
  }
  return out;
}

// Kebalikan patchIndex: dipakai tes untuk memastikan isi asli index.html tidak berubah selain sisipan.
export function unpatchIndex(html) {
  let out = html;
  for (const ins of INSERTS) out = out.replace(ins.add, "");
  return out;
}

export function build({ liveDir = LIVE, outDir = OUT, sharedDir = SHARED, appDir = APP_DIR } = {}) {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(join(outDir, "kepatuhan", "vendor"), { recursive: true });
  writeFileSync(join(outDir, "index.html"), patchIndex(readFileSync(join(liveDir, "index.html"), "utf8")));
  for (const [from, to] of COPIES) {
    const src = from.startsWith("@shared/") ? join(sharedDir, from.slice(8)) : join(appDir, from);
    copyFileSync(src, join(outDir, to));
  }
  return ["index.html", ...COPIES.map(([, to]) => to)];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const files = build();
    console.log(`overlay siap (${files.length} file):\n  ${files.join("\n  ")}`);
  } catch (e) {
    console.error(process.env.GITHUB_ACTIONS ? `::error::${e.message}` : `ERROR: ${e.message}`);
    process.exit(1);
  }
}
