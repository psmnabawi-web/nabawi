// Inti bersama: baca data Firestore app Filter Oil (REST, hanya baca) dan susun workbook Excel kepatuhan.
// Dipakai halaman kepatuhan dan panel "Kepatuhan & Export" di dalam app Filter Oil. Tanpa efek samping saat di-import.
import { fmtDate } from "./kepatuhan.js";

export const PROJECT = "trecking-filter-oil-store";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const RECORD_FIELDS = ["storeId", "storeName", "slotId", "dateKey", "deviationMin", "complianceScore", "status", "metadataTrust",
  "evidenceTimeSource", "evidenceLocalIso", "submittedAt", "crewName", "note", "dedupArchived"];

// ---------- Firestore REST ----------
export async function api(url, body) {
  const res = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* bukan JSON */ }
  if (!res.ok) {
    const msg = (Array.isArray(json) ? json[0] : json)?.error?.message || `HTTP ${res.status}`;
    throw new Error(res.status === 403 ? `Akses data ditolak (${msg}). Aturan keamanan database mungkin sudah diperketat; halaman ini perlu disesuaikan.` : msg);
  }
  return json;
}
export function val(v) {
  if (!v || typeof v !== "object") return undefined;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("nullValue" in v) return null;
  if ("referenceValue" in v) return decodeURIComponent(v.referenceValue.split("/").pop());
  return undefined;
}
export const flat = (doc) => ({ id: decodeURIComponent(doc.name.split("/").pop()), ...Object.fromEntries(Object.entries(doc.fields || {}).map(([k, v]) => [k, val(v)])) });

export async function loadStores() {
  const out = []; let token = "";
  do {
    const j = await api(`${BASE}/stores?pageSize=300${token ? `&pageToken=${encodeURIComponent(token)}` : ""}`);
    out.push(...(j.documents || []).map(flat)); token = j.nextPageToken || "";
  } while (token);
  return out;
}
export async function loadSettings() {
  try { return flat(await api(`${BASE}/settings/app`)); } catch { return {}; }
}
export async function loadRecords(start, end) {
  const ff = (op, value) => ({ fieldFilter: { field: { fieldPath: "dateKey" }, op, value: { stringValue: value } } });
  const j = await api(`${BASE}:runQuery`, {
    structuredQuery: {
      from: [{ collectionId: "filterRecords" }],
      where: { compositeFilter: { op: "AND", filters: [ff("GREATER_THAN_OR_EQUAL", start), ff("LESS_THAN_OR_EQUAL", end)] } },
      select: { fields: RECORD_FIELDS.map((f) => ({ fieldPath: f })) },
    },
  });
  return (Array.isArray(j) ? j : []).filter((x) => x.document).map((x) => flat(x.document));
}

// ---------- export Excel ----------
/** Muat ExcelJS (vendor/exceljs.min.js di sebelah modul ini) sekali saja. */
export function loadExcelJS() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = new URL("./vendor/exceljs.min.js", import.meta.url).href;
    s.onload = () => (window.ExcelJS ? resolve(window.ExcelJS) : reject(new Error("ExcelJS tidak termuat")));
    s.onerror = () => reject(new Error("Pustaka Excel gagal dimuat"));
    document.head.appendChild(s);
  });
}
const NAVY = "FF1F3864";
const headerStyle = (row) => {
  row.eachCell((c) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" }, name: "Arial", size: 10 };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    c.border = { bottom: { style: "thin", color: { argb: "FFBFBFBF" } } };
  });
  row.height = 30;
};
const xlDate = (ymd) => new Date(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10))));
const colLetter = (n) => { let s = ""; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

export async function buildWorkbook(ExcelJS, r, opts) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Kepatuhan Filter Oil"; wb.created = new Date();
  wb.calcProperties = { fullCalcOnLoad: true };
  const D = "'Detail Slot'";
  const nDetail = r.rows.length;
  const last = nDetail + 1; // baris data detail: 2..last
  const rng = (col) => `${D}!$${col}$2:$${col}$${Math.max(last, 2)}`;
  // Tab dibuat sesuai urutan tampil: Ringkasan, Harian, Detail Slot, Parameter (rumus antar-sheet tidak bergantung urutan).
  const withDaily = r.days.length > 0 && r.days.length <= 62 && r.stores.length > 0;
  const R = wb.addWorksheet("Ringkasan Store", { views: [{ state: "frozen", ySplit: 4, xSplit: 1 }], properties: { tabColor: { argb: NAVY } } });
  const H = withDaily ? wb.addWorksheet("Harian", { views: [{ state: "frozen", ySplit: 3, xSplit: 1 }] }) : null;
  const S = wb.addWorksheet("Detail Slot", { views: [{ state: "frozen", ySplit: 1 }] });
  const P = wb.addWorksheet("Parameter", { properties: { tabColor: { argb: "FF85827A" } } });

  // --- Parameter ---
  P.columns = [{ width: 30 }, { width: 22 }, { width: 70 }];
  P.addRow(["Parameter", "Nilai", "Keterangan"]); headerStyle(P.getRow(1));
  const prm = [
    ["Periode awal", xlDate(r.start), "Tanggal pertama laporan"],
    ["Target compliance", r.target, "INPUT: ubah angka ini, kolom Status di Ringkasan Store ikut berubah"],
    ["Periode akhir", xlDate(r.end), "Tanggal terakhir laporan (maksimal hari ini)"],
    ["Toleransi (menit)", r.tol, "Selisih dari jam slot yang masih dihitung tepat waktu (dari pengaturan app)"],
    ...r.slots.map((s) => [`Jam ${s.label}`, s.time, "Slot wajib per store per hari (dari pengaturan app)"]),
    ["Area", opts.area || "Semua area", "Filter area saat export"],
    ["Dibuat (WIB)", opts.generatedAt, "Waktu file dibuat"],
    ["Sumber data", "Firestore app Trecking Filter Oil (trecking-filter-oil-store), koleksi filterRecords, stores, settings", ""],
    ["Compliance", "Slot dikerjakan ÷ slot wajib (sama dengan dashboard app)", "Dasar status Patuh / Tidak patuh"],
    ["Skor tertimbang", "Tepat waktu = 1; Terlalu awal / Terlambat = 0,5; Tidak dikerjakan = 0", "Mengikuti complianceScore di app"],
    ["Slot hari ini", `${r.pending} slot belum jatuh tempo tidak dihitung`, "Slot dihitung setelah jam slot + toleransi lewat"],
  ];
  // urutan baris dijaga agar target ada di B3 (dipakai rumus Status)
  prm.forEach((p) => P.addRow(p));
  P.getCell("B2").numFmt = "dd/mm/yyyy"; P.getCell("B4").numFmt = "dd/mm/yyyy";
  P.getCell("B3").numFmt = "0%"; P.getCell("B3").font = { color: { argb: "FF0000FF" }, bold: true, name: "Arial" };
  P.getCell("B3").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF9D9" } };
  P.eachRow((row, i) => { if (i > 1) row.eachCell((c) => { if (!c.font || !c.font.color) c.font = { name: "Arial", size: 10 }; c.alignment = { vertical: "top", wrapText: true }; }); });

  // --- Detail Slot (data) ---
  S.columns = [
    { header: "Tanggal", key: "date", width: 12 }, { header: "Hari", key: "day", width: 9 }, { header: "Store", key: "store", width: 20 },
    { header: "Area", key: "area", width: 14 }, { header: "Slot", key: "slot", width: 10 }, { header: "Jam slot", key: "planned", width: 9 },
    { header: "Jam aktual", key: "actual", width: 12 }, { header: "Selisih (menit)", key: "deviation", width: 10 }, { header: "Status", key: "status", width: 16 },
    { header: "Skor", key: "score", width: 7 }, { header: "Crew", key: "crew", width: 22 }, { header: "Sumber foto", key: "photo", width: 13 },
    { header: "Catatan", key: "note", width: 40 },
  ];
  headerStyle(S.getRow(1));
  const sorted = [...r.rows].sort((a, b) => a.date.localeCompare(b.date) || a.store.localeCompare(b.store, "id") || a.slotId.localeCompare(b.slotId));
  for (const x of sorted) S.addRow({ ...x, date: xlDate(x.date), status: x.statusLabel, deviation: x.deviation });
  S.getColumn("date").numFmt = "dd/mm/yyyy";
  S.getColumn("score").numFmt = "0.0";
  S.autoFilter = { from: "A1", to: `M${Math.max(last, 1)}` };
  const fillFor = { "Tepat waktu": "FFDFF3DF", "Terlalu awal": "FFFDEFC9", "Terlambat": "FFFBE1D5", "Tidak dikerjakan": "FFF7D6D6" };
  for (let i = 2; i <= last; i++) {
    const c = S.getCell(`I${i}`); const f = fillFor[c.value]; if (f) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: f } };
    S.getRow(i).font = { name: "Arial", size: 10 };
  }

  // --- Ringkasan Store (rumus ke Detail Slot) ---
  R.mergeCells("A1:M1");
  R.getCell("A1").value = `Kepatuhan Filter Oil per Store · ${fmtDate(r.start)} s/d ${fmtDate(r.end)}${opts.area ? ` · ${opts.area}` : ""}`;
  R.getCell("A1").font = { bold: true, size: 14, color: { argb: NAVY }, name: "Arial" };
  R.mergeCells("A2:M2");
  R.getCell("A2").value = `Status "Tidak patuh" = compliance (slot dikerjakan ÷ slot wajib) di bawah target di sheet Parameter (B3). Angka dihitung dengan rumus dari sheet Detail Slot. Urutan: compliance terendah di atas.`;
  R.getCell("A2").font = { italic: true, size: 9, color: { argb: "FF55534E" }, name: "Arial" };
  const heads = ["Store", "Area", "Slot wajib", "Tepat waktu", "Terlalu awal", "Terlambat", "Tidak dikerjakan", "Slot dikerjakan", "Compliance", "% Tepat waktu", "Skor tertimbang", "Status", "Foto dari galeri"];
  R.getRow(4).values = heads; headerStyle(R.getRow(4));
  R.columns = [22, 14, 10, 10, 10, 10, 12, 11, 11, 11, 12, 13, 11].map((w) => ({ width: w }));
  const first = 5;
  r.stores.forEach((s, i) => {
    const n = first + i;
    const A = `$A${n}`;
    const cnt = (status) => `COUNTIFS(${rng("C")},${A},${rng("I")},"${status}")`;
    const row = R.getRow(n);
    row.getCell(1).value = s.name;
    row.getCell(2).value = s.area;
    row.getCell(3).value = { formula: `COUNTIFS(${rng("C")},${A})`, result: s.expected };
    row.getCell(4).value = { formula: cnt("Tepat waktu"), result: s.ONTIME };
    row.getCell(5).value = { formula: cnt("Terlalu awal"), result: s.EARLY };
    row.getCell(6).value = { formula: cnt("Terlambat"), result: s.LATE };
    row.getCell(7).value = { formula: cnt("Tidak dikerjakan"), result: s.MISSED };
    row.getCell(8).value = { formula: `C${n}-G${n}`, result: s.done };
    row.getCell(9).value = { formula: `IF(C${n}=0,"",H${n}/C${n})`, result: s.pctDone };
    row.getCell(10).value = { formula: `IF(C${n}=0,"",D${n}/C${n})`, result: s.pctOntime };
    row.getCell(11).value = { formula: `IF(C${n}=0,"",SUMIFS(${rng("J")},${rng("C")},${A})/C${n})`, result: s.score };
    row.getCell(12).value = { formula: `IF(I${n}="","",IF(I${n}<Parameter!$B$3,"Tidak patuh","Patuh"))`, result: s.compliant ? "Patuh" : "Tidak patuh" };
    row.getCell(13).value = { formula: `COUNTIFS(${rng("C")},${A},${rng("L")},"Dari galeri")`, result: s.gallery };
    row.font = { name: "Arial", size: 10 };
  });
  const lastS = first + r.stores.length - 1;
  const tot = R.getRow(lastS + 1);
  if (r.stores.length) {
    tot.getCell(1).value = "Total";
    for (const [col, key] of [[3, "expected"], [4, "ONTIME"], [5, "EARLY"], [6, "LATE"], [7, "MISSED"], [8, "done"], [13, "gallery"]]) {
      const L = colLetter(col); tot.getCell(col).value = { formula: `SUM(${L}${first}:${L}${lastS})`, result: r.total[key] };
    }
    const t = lastS + 1;
    tot.getCell(9).value = { formula: `IF(C${t}=0,"",H${t}/C${t})`, result: r.total.pctDone };
    tot.getCell(10).value = { formula: `IF(C${t}=0,"",D${t}/C${t})`, result: r.total.pctOntime };
    tot.getCell(11).value = { formula: `IF(C${t}=0,"",SUM(${rng("J")})/C${t})`, result: r.total.score };
    tot.getCell(12).value = { formula: `COUNTIF(L${first}:L${lastS},"Tidak patuh")&" store tidak patuh"`, result: `${r.nonCompliant} store tidak patuh` };
    tot.font = { bold: true, name: "Arial", size: 10 };
    tot.eachCell((c) => { c.border = { top: { style: "medium", color: { argb: NAVY } } }; });
    for (const col of ["I", "J", "K"]) for (let i = first; i <= lastS + 1; i++) R.getCell(`${col}${i}`).numFmt = col === "I" ? "0.0%" : "0%";
    R.autoFilter = { from: "A4", to: `M${lastS}` };
    R.addConditionalFormatting({ ref: `L${first}:L${lastS}`, rules: [
      { type: "containsText", operator: "containsText", text: "Tidak patuh", priority: 1, style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFF7D6D6" } }, font: { bold: true, color: { argb: "FF9C1C1C" } } } },
      { type: "containsText", operator: "containsText", text: "Patuh", priority: 2, style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFDFF3DF" } }, font: { color: { argb: "FF0B6B0B" } } } },
    ] });
    R.addConditionalFormatting({ ref: `G${first}:G${lastS}`, rules: [
      { type: "cellIs", operator: "greaterThan", formulae: ["0"], priority: 3, style: { font: { bold: true, color: { argb: "FF9C1C1C" } } } },
    ] });
  }

  // --- Harian (store x tanggal, rumus) ---
  if (H) {
    H.getCell("A1").value = "Compliance harian per store (slot dikerjakan ÷ slot wajib hari itu). Kosong = belum wajib.";
    H.getCell("A1").font = { italic: true, size: 9, color: { argb: "FF55534E" }, name: "Arial" };
    const hr = H.getRow(3);
    hr.getCell(1).value = "Store";
    r.days.forEach((d, j) => { const c = hr.getCell(j + 2); c.value = xlDate(d); c.numFmt = "dd/mm"; });
    headerStyle(hr);
    H.getColumn(1).width = 22;
    r.stores.forEach((s, i) => {
      const n = 4 + i; const row = H.getRow(n);
      row.getCell(1).value = s.name;
      r.days.forEach((d, j) => {
        const L = colLetter(j + 2);
        const crit = `${rng("C")},$A${n},${rng("A")},${L}$3`;
        const x = s.daily[d];
        row.getCell(j + 2).value = { formula: `IFERROR(1-COUNTIFS(${crit},${rng("I")},"Tidak dikerjakan")/COUNTIFS(${crit}),"")`, result: x ? x.pctDone : "" };
        row.getCell(j + 2).numFmt = "0%";
      });
      row.font = { name: "Arial", size: 10 };
    });
    for (let j = 0; j < r.days.length; j++) H.getColumn(j + 2).width = 7;
    const ref = `B4:${colLetter(r.days.length + 1)}${3 + r.stores.length}`;
    H.addConditionalFormatting({ ref, rules: [{ type: "colorScale", priority: 1, cfvo: [{ type: "num", value: 0 }, { type: "num", value: 0.5 }, { type: "num", value: 1 }], color: [{ argb: "FFF4B6B6" }, { argb: "FFFDE7A8" }, { argb: "FFB7E1B7" }] }] });
  }

  wb.views = [{ activeTab: 0 }];
  return wb;
}

/** Simpan workbook sebagai file .xlsx di perangkat pengguna. */
export async function downloadWorkbook(wb, filename) {
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
export const wibNowLabel = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 16).replace("T", " ");
export const exportFileName = (r, suffix = "") => `Kepatuhan_Filter_Oil_${r.start}_sd_${r.end}${suffix ? `_${suffix.replace(/[^\w-]+/g, "-")}` : ""}.xlsx`;
