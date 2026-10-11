#!/usr/bin/env node
// Rakit folder overlay/ untuk deploy ke situs utama app:
//   overlay/index.html        = live/files/index.html + 4 sisipan (CSS, tombol menu, panel kosong, script)
//   overlay/app.js            = live/files/app.js + pengalih loadDashboard() ke Dashboard baru + perbaikan slot lewat tengah malam
//   overlay/kepatuhan/*       = src/*.{js,css} + logika & export Excel dari apps/filter-oil-kepatuhan/public
// File app lain (styles.css, dst.) TIDAK diubah; deploy memakai ulang file live yang sama persis.
// Setiap titik sisip harus ditemukan tepat satu kali; kalau file live berubah bentuk, build gagal (aman).

import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const LIVE = join(APP_DIR, "live", "files");
const OUT = join(APP_DIR, "overlay");
const SHARED = join(APP_DIR, "..", "filter-oil-kepatuhan", "public");

export const PATCHES = {
  "index.html": [
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
  ],
  "app.js": [
    // Dashboard baru (kepatuhan/dashboard.js) memasang window.foDashboard. Bila tidak terpasang, Dashboard lama jalan seperti biasa.
    { after: `async function loadDashboard(){\n`, add: `  if(window.foDashboard) return window.foDashboard.load();\n` },
    // Perbaikan slot lewat tengah malam: slot kemarin & besok ikut dibandingkan, jadi foto 00:40 tercatat sebagai
    // Filter 3 (23:30) KEMARIN (terlambat 70 menit), bukan Filter 1 hari ini (yang lalu memblokir input Filter 1 pagi).
    {
      find: `  let best = slots[0], diff = Infinity, signed = 0;
  for(const s of slots){
    const delta = nowMin - minutesOf(s.time);
    if(Math.abs(delta) < diff){
      best = s;
      diff = Math.abs(delta);
      signed = delta;
    }
  }
`,
      replace: `  let best = slots[0], diff = Infinity, signed = 0, dayOffset = 0;
  for(const s of slots){
    for(const off of [0, -1, 1]){
      const delta = nowMin - (minutesOf(s.time) + off * 1440);
      if(Math.abs(delta) < diff){
        best = s;
        diff = Math.abs(delta);
        signed = delta;
        dayOffset = off;
      }
    }
  }
  const slotDay = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + dayOffset);
`,
    },
    { find: `  return { ...best, deviationMin: signed, status };`, replace: `  return { ...best, deviationMin: signed, status, dayOffset, slotDay, slotDateKey: toDateKey(slotDay) };` },
    { find: `    $("metaSlot").textContent = slot.label;`, replace: `    $("metaSlot").textContent = slot.dayOffset ? \`\${slot.label} · \${fmtDay(slot.slotDay)}, \${fmtDate(slot.slotDay)}\` : slot.label;` },
    {
      find: "      alert.textContent = `Timestamp dibaca dari ${meta.source}.`;",
      replace: "      alert.textContent = `Timestamp dibaca dari ${meta.source}.` + (slot.dayOffset ? ` Foto lewat tengah malam, dicatat sebagai ${slot.label} tanggal ${fmtDate(slot.slotDay)}.` : \"\");",
    },
    { find: `  const dateKey = toDateKey(m.dt);`, replace: `  const dateKey = m.slotDateKey || toDateKey(m.dt);` },
    {
      find: `  const duplicateExists = sameDaySnap.docs.some(x => {
    const d = x.data();
    return d.dedupArchived !== true && d.storeId === storeId && d.slotId === m.id;
  });
  if(duplicateExists) return toast("Slot filter ini sudah memiliki evidence. Duplicate tidak diizinkan.");`,
      replace: `  const duplicate = sameDaySnap.docs.map(x => x.data()).find(d => d.dedupArchived !== true && d.storeId === storeId && d.slotId === m.id);
  if(duplicate) return toast(\`\${m.label} tanggal \${dateKey.split("-").reverse().join("/")} sudah terisi oleh \${duplicate.crewName || "crew lain"} (foto \${String(duplicate.evidenceLocalIso || "-").replace("T", " ").slice(0, 16)}). Duplicate tidak diizinkan. Bila slot salah, hubungi admin.\`, 8000);`,
    },
    { find: `      dayName: fmtDay(m.dt),`, replace: `      dayName: fmtDay(m.slotDay || m.dt),` },
    { find: "      evidenceLocalIso: `${dateKey}T${toTime(m.dt)}`,", replace: "      evidenceLocalIso: `${toDateKey(m.dt)}T${toTime(m.dt)}`," },
  ],
};
export const INSERTS = PATCHES["index.html"];

export const COPIES = [
  ["src/panel.js", "kepatuhan/panel.js"],
  ["src/panel.css", "kepatuhan/panel.css"],
  ["src/common.js", "kepatuhan/common.js"],
  ["src/dashboard.js", "kepatuhan/dashboard.js"],
  ["@shared/core.js", "kepatuhan/core.js"],
  ["@shared/kepatuhan.js", "kepatuhan/kepatuhan.js"],
  ["@shared/vendor/exceljs.min.js", "kepatuhan/vendor/exceljs.min.js"],
  ["@shared/vendor/exceljs.LICENSE", "kepatuhan/vendor/exceljs.LICENSE"],
];

// Jenis tambalan: { after|before, add } = sisipkan teks; { find, replace } = ganti potongan teks.
// Titik/potongan harus ditemukan tepat 1x di file live, kalau tidak build gagal.
export function patchFile(name, text) {
  let out = text;
  for (const ins of PATCHES[name]) {
    const anchor = ins.find ?? ins.after ?? ins.before;
    const n = out.split(anchor).length - 1;
    if (n !== 1) throw new Error(`Titik sisip ${JSON.stringify(anchor.trim().slice(0, 80))} ditemukan ${n}x di ${name} live (harus 1x). Cek ulang snapshot.`);
    if (ins.find !== undefined) out = out.replace(anchor, () => ins.replace);
    else out = ins.after ? out.replace(anchor, () => anchor + ins.add) : out.replace(anchor, () => ins.add + anchor);
  }
  return out;
}
// Kebalikan patchFile: dipakai tes untuk memastikan isi asli file tidak berubah selain tambalan.
export function unpatchFile(name, text) {
  let out = text;
  for (const ins of [...PATCHES[name]].reverse()) out = ins.find !== undefined ? out.replace(ins.replace, () => ins.find) : out.replace(ins.add, "");
  return out;
}
export const patchIndex = (html) => patchFile("index.html", html);
export const unpatchIndex = (html) => unpatchFile("index.html", html);

export function build({ liveDir = LIVE, outDir = OUT, sharedDir = SHARED, appDir = APP_DIR } = {}) {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(join(outDir, "kepatuhan", "vendor"), { recursive: true });
  for (const name of Object.keys(PATCHES)) writeFileSync(join(outDir, name), patchFile(name, readFileSync(join(liveDir, name), "utf8")));
  for (const [from, to] of COPIES) {
    const src = from.startsWith("@shared/") ? join(sharedDir, from.slice(8)) : join(appDir, from);
    copyFileSync(src, join(outDir, to));
  }
  return [...Object.keys(PATCHES), ...COPIES.map(([, to]) => to)];
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
