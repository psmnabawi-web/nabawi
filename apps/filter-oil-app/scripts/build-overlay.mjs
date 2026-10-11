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

    // ---- Perbaikan slot filter malam (kasus Jagakarsa 11/10: foto 00:40 tercatat Filter 1 hari ini & mengunci Filter 1 pagi) ----
    {
      before: `function autoSlot(dt){`,
      add: `// Jam dinding WIB untuk menentukan slot & tanggal. Foto kamera (EXIF) sudah berisi jam lokal; sumber lain dihitung dari
// waktu absolut, jadi HP dengan zona waktu salah tetap tercatat dengan jam WIB yang benar.
function wibWall(meta){
  if(String(meta.source || "").startsWith("EXIF")) return meta.dt;
  return new Date(meta.dt.getTime() + (meta.dt.getTimezoneOffset() + 420) * 60000);
}
// Jam foto untuk daftar; tanggal foto ikut ditulis bila beda dengan tanggal slot (filter malam yang selesai lewat tengah malam).
function evidenceClock(r){
  const iso = String(r?.evidenceLocalIso || "");
  return iso.length >= 16 && iso.slice(0, 10) !== r?.dateKey ? \`foto \${iso.slice(8, 10)}/\${iso.slice(5, 7)} \${iso.slice(11)}\` : iso.slice(11);
}
`,
    },
    {
      find: `  const nowMin = dt.getHours() * 60 + dt.getMinutes();
  let best = slots[0], diff = Infinity, signed = 0;
  for(const s of slots){
    const delta = nowMin - minutesOf(s.time);
    if(Math.abs(delta) < diff){
      best = s;
      diff = Math.abs(delta);
      signed = delta;
    }
  }
  let status = "ON TIME";
  const tol = Number(state.settings.toleranceMin || 30);
  if(Math.abs(signed) > tol) status = signed < 0 ? "EARLY" : "LATE";
  return { ...best, deviationMin: signed, status };`,
      replace: `  const nowMin = dt.getHours() * 60 + dt.getMinutes();
  // Hari operasional berganti jam 05:00 (bisa diatur lewat settings.dayCutoff): foto 00:00-04:59 milik hari kemarin,
  // jadi filter malam yang selesai lewat tengah malam tercatat sebagai Filter 3 kemarin, bukan Filter 1 hari ini.
  const cut = minutesOf(state.settings.dayCutoff || "05:00");
  const op = mm => (mm < cut ? mm + 1440 : mm);
  const base = nowMin < cut ? -1 : 0;
  const tol = Number(state.settings.toleranceMin || 30);
  const pick = (s, k) => {
    const delta = op(nowMin) - (op(minutesOf(s.time)) + k * 1440);
    const slotDay = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + base + k);
    const status = Math.abs(delta) <= tol ? "ON TIME" : (delta < 0 ? "EARLY" : "LATE");
    return { ...s, deviationMin: delta, status, dayOffset: base + k, slotDay, slotDateKey: toDateKey(slotDay) };
  };
  const byGap = (a, b) => Math.abs(a.deviationMin) - Math.abs(b.deviationMin);
  // Utama: slot terdekat di hari operasional yang sama. Cadangan HANYA untuk foto dini hari (00:00-cutoff), yang memang bisa
  // milik dua hari: slot terdekat di hari kalender foto (mis. Filter 1 hari ini). Foto siang/malam tidak diberi cadangan,
  // supaya slot yang terisi tidak "dialihkan" ke slot lain hari yang sama (mis. Filter 1 jadi Filter 2).
  const same = slots.map(s => pick(s, 0)).filter(c => Number.isFinite(c.deviationMin)).sort(byGap);
  const today = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
  const best = same[0] || { ...slots[0], deviationMin: 0, status: "ON TIME", dayOffset: 0, slotDay: today, slotDateKey: toDateKey(today) };
  const alternatives = base === -1 ? slots.map(s => pick(s, 1)).filter(c => Number.isFinite(c.deviationMin)).sort(byGap).slice(0, 1) : [];
  return { ...best, alternatives };`,
    },
    { find: `    const slot = autoSlot(meta.dt);`, replace: `    const wall = wibWall(meta);\n    const slot = autoSlot(wall);` },
    { find: `    state.evidenceMeta = { ...meta, ...slot, ageHours, integrity, hash };`, replace: `    state.evidenceMeta = { ...meta, ...slot, wall, ageHours, integrity, hash };` },
    { find: `    $("metaDay").textContent = fmtDay(meta.dt);`, replace: `    $("metaDay").textContent = fmtDay(wall);` },
    { find: `    $("metaDate").textContent = fmtDate(meta.dt);`, replace: `    $("metaDate").textContent = fmtDate(wall);` },
    { find: `    $("metaTime").textContent = toTime(meta.dt);`, replace: `    $("metaTime").textContent = toTime(wall);` },
    { find: `    $("metaSlot").textContent = slot.label;`, replace: `    $("metaSlot").textContent = slot.dayOffset ? \`\${slot.label} · \${fmtDay(slot.slotDay)}, \${fmtDate(slot.slotDay)}\` : slot.label;` },
    {
      find: "      alert.textContent = `Timestamp dibaca dari ${meta.source}.`;",
      replace: "      alert.textContent = `Timestamp dibaca dari ${meta.source}.` + (slot.dayOffset ? ` Foto sebelum jam ${state.settings.dayCutoff || \"05:00\"} termasuk hari operasional kemarin: dicatat sebagai ${slot.label} tanggal ${fmtDate(slot.slotDay)}.` : \"\");",
    },
    {
      find: `  const dateKey = toDateKey(m.dt);
  const recordId = \`\${dateKey}_\${storeId}_\${m.id}\`.replace(/[^A-Za-z0-9_-]/g, "-");
  const ref = doc(db, "filterRecords", recordId);
  const sameDaySnap = await getDocs(query(collection(db, "filterRecords"), where("dateKey", "==", dateKey), limit(500)));
  const duplicateExists = sameDaySnap.docs.some(x => {
    const d = x.data();
    return d.dedupArchived !== true && d.storeId === storeId && d.slotId === m.id;
  });
  if(duplicateExists) return toast("Slot filter ini sudah memiliki evidence. Duplicate tidak diizinkan.");`,
      replace: `  const findTaken = async (key, slotId) => (await getDocs(query(collection(db, "filterRecords"), where("dateKey", "==", key), limit(500))))
    .docs.map(x => x.data()).find(d => d.dedupArchived !== true && d.storeId === storeId && d.slotId === slotId);
  const fmtKey = key => key.split("-").reverse().join("/");
  let dateKey = m.slotDateKey || toDateKey(m.wall || m.dt);
  const taken = await findTaken(dateKey, m.id);
  if(taken){
    // Slot utama sudah terisi: tawarkan slot terdekat berikutnya bila masih kosong; crew yang memutuskan.
    const msg = \`\${m.label} tanggal \${fmtKey(dateKey)} sudah terisi oleh \${taken.crewName || "crew lain"} (foto \${String(taken.evidenceLocalIso || "-").replace("T", " ").slice(0, 16)}).\`;
    const alt = (m.alternatives || [])[0];
    const altFree = alt && !(await findTaken(alt.slotDateKey, alt.id));
    if(!altFree || !confirm(\`\${msg}\\n\\nSimpan foto ini sebagai \${alt.label} tanggal \${fmtKey(alt.slotDateKey)} (jadwal \${alt.time}, \${alt.status} \${alt.deviationMin >= 0 ? "+" : ""}\${alt.deviationMin} menit)?\`))
      return toast(\`\${msg} Duplicate tidak diizinkan. Bila slot salah, hubungi admin.\`, 8000);
    Object.assign(m, { id: alt.id, label: alt.label, time: alt.time, deviationMin: alt.deviationMin, status: alt.status, dayOffset: alt.dayOffset, slotDay: alt.slotDay, slotDateKey: alt.slotDateKey });
    dateKey = alt.slotDateKey;
  }
  const recordId = \`\${dateKey}_\${storeId}_\${m.id}\`.replace(/[^A-Za-z0-9_-]/g, "-");
  const ref = doc(db, "filterRecords", recordId);`,
    },
    { find: `      dayName: fmtDay(m.dt),`, replace: `      dayName: fmtDay(m.slotDay || m.wall || m.dt),` },
    { find: "      evidenceLocalIso: `${dateKey}T${toTime(m.dt)}`,", replace: "      evidenceLocalIso: `${toDateKey(m.wall || m.dt)}T${toTime(m.wall || m.dt)}`," },
    // Daftar Evidence Terakhir & log Dashboard lama: tulis tanggal foto bila beda dengan tanggal slot.
    {
      find: "        <small>${safe(r.crewName)} • ${safe(r.dayName)}, ${safe(r.dateKey)} ${safe((r.evidenceLocalIso || \"\").slice(11))}</small>",
      replace: "        <small>${safe(r.crewName)} • ${safe(r.dayName)}, ${safe(r.dateKey)} ${safe(evidenceClock(r))}</small>",
    },
    { find: "      <td>${safe((r.evidenceLocalIso || \"\").slice(11))}</td>", replace: "      <td>${safe(evidenceClock(r))}</td>" },
    // Record yang diarsipkan (dedupArchived) tidak ikut dihitung/ditampilkan, sama seperti laporan Kepatuhan & Dashboard baru.
    { after: `  for(const raw of records){`, add: `\n    if(raw?.dedupArchived === true) continue;` },
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
