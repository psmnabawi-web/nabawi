/* ROP Gudang — export Excel (ExcelJS). Dipakai di browser (window.ROPExport) dan Node (tes).
 * Semua angka hasil hitung ditulis sebagai RUMUS supaya bisa diaudit dan diubah di Excel:
 * ubah Pemakaian/hari, Buffer, Lead time, Target DSI, MOQ, harga → Kebutuhan, Final PR, status, nilai ikut berubah.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ROPExport = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const NAVY = "FF14305A", INK = "FF1F2937", MUTED = "FF6B7280", LINE = "FFD9DEE7";
  const INPUT_FILL = "FFFFF8DB", EDIT_FILL = "FFFFE0B8", HEAD_FILL = "FF14305A", SUB_FILL = "FFEEF2F8";
  const STATUS_FILL = {
    "OOS": "FFF6D3D3", "Kritis": "FFFBE0C8", "Order": "FFFFF1C2", "Aman": "FFDDF1E3", "Di atas target": "FFE6F0FB",
    "Overstock": "FFD9E6F7", "Tidak bergerak": "FFE5E7EB", "Tidak aktif": "FFF3F4F6", "Tanpa parameter": "FFEDE4F5",
  };
  const ACTION = {
    "Tanpa parameter (ada stok)": "Isi Penjualan 1 Hari, Buffer, Lead time, MOQ di master (tab PKU).",
    "Tanpa parameter (stok 0)": "Tambahkan ke master bila masih aktif; bila tidak, nonaktifkan produk di Zahir.",
    "Kode master tidak ada di file Zahir": "Samakan kode di master dengan kode Zahir (ejaan, spasi, huruf).",
    "Satuan beda": "Samakan satuan master dengan Zahir, atau konversi Penjualan 1 Hari ke satuan Zahir.",
    "Stok negatif di Zahir": "Telusuri transaksi di Zahir (keluar tanpa terima) lalu koreksi stok.",
    "Kode ganda di master": "Perbaiki kode di master: satu kode untuk satu barang.",
    "Kode ganda di file Zahir": "Cek master produk Zahir.",
    "Harga kosong": "Isi harga terakhir di Database Produk atau pastikan ada HPP di Zahir.",
    "MOQ melebihi kebutuhan": "Negosiasi MOQ / kemasan lebih kecil dengan supplier, cari supplier lain, atau isi Final PR manual bila memang harus ikut MOQ. Perbarui kolom Minimum Order di master setelah disepakati.",
    "Target DSI tidak tercapai": "Buffer + lead time sudah melebihi target. Perpendek lead time (supplier lebih dekat / jadwal kirim lebih sering) atau tetapkan target khusus item ini.",
    "Angka tidak terbaca": "Perbaiki isi sel di master (angka saja).",
    "Nilai negatif": "Perbaiki isi sel di master.",
    "Baris tanpa kode": "Isi kode barang; format kolom kode sebagai teks.",
    "Subtotal Zahir tidak cocok": "Download ulang file dari Zahir; jangan edit file sebelum upload.",
    "Baris tidak terbaca": "Cek baris di file Zahir.",
    "Peringatan file": "Cek kelengkapan file Zahir.",
  };
  const SEV_ORDER = { Tinggi: 0, Sedang: 1, Rendah: 2 };

  const col = (n) => { let s = ""; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  const fmtQty = (v) => (v != null && Math.abs(v % 1) > 1e-9 ? "#,##0.00" : "#,##0");
  const RP = '"Rp" #,##0';
  const esc = (s) => String(s).replace(/"/g, '""');
  const escWild = (s) => String(s).replace(/[~*?]/g, (m) => "~" + m);

  function styleHeader(row, from, to) {
    for (let c = from; c <= to; c++) {
      const cell = row.getCell(c);
      cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD_FILL } };
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      cell.border = { bottom: { style: "thin", color: { argb: LINE } } };
    }
    row.height = 32;
  }
  function title(ws, text, sub) {
    ws.getCell("A1").value = text;
    ws.getCell("A1").font = { bold: true, size: 15, color: { argb: NAVY } };
    if (sub) { ws.getCell("A2").value = sub; ws.getCell("A2").font = { size: 10, color: { argb: MUTED } }; }
  }
  function inputCell(cell) {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INPUT_FILL } };
  }
  function border(cell) { cell.border = { bottom: { style: "hair", color: { argb: LINE } } }; }

  function buildWorkbook(ExcelJS, ctx) {
    const { result, zahir, meta } = ctx;
    const s = result.settings;
    const wb = new ExcelJS.Workbook();
    wb.creator = "ROP Gudang"; wb.created = meta.generatedAt ? new Date(meta.generatedAt) : new Date();
    const rows = result.rows.slice().sort((a, b) => (a.nama || "").localeCompare(b.nama || "", "id"));

    // ---------------- Ringkasan (dibuat dulu supaya jadi sheet pertama; isi rumus setelah Perhitungan) ----------------
    const wsR = wb.addWorksheet("Ringkasan", { properties: { tabColor: { argb: NAVY } }, views: [{ showGridLines: false }] });
    const wsPR = wb.addWorksheet("PR", { properties: { tabColor: { argb: "FFB45309" } } });
    const wsC = wb.addWorksheet("Perhitungan");
    const wsI = wb.addWorksheet("Data Issue");
    const wsZ = wb.addWorksheet("Stok Zahir");
    const wsL = wb.addWorksheet("Log Perubahan");

    // Sel parameter global di Ringkasan (dirujuk rumus Perhitungan)
    const GL = { target: "$C$16", over: "$C$17", dsiMin: "$C$18", dsiSafe: "$C$19", moqTol: "$C$20", basis: "$C$21" };
    const R = (a) => `Ringkasan!${a}`;
    // Sheet "Stok Zahir": baris mulai 5. Kolom G = Jumlah, L = Dihitung (Ya/Tidak), M = Kode (normal).
    // SOH di Perhitungan = SUMIFS dari sheet ini untuk gudang yang dicentang → bisa ditelusuri ke file asli.
    const gsel = Array.isArray(meta.gudangKeys) && meta.gudangKeys.length ? new Set(meta.gudangKeys) : null;
    const ZS0 = 5, ZSL = ZS0 + Math.max(zahir.items.length, 1) - 1;
    const ZR = (c) => `'Stok Zahir'!$${c}$${ZS0}:$${c}$${ZSL}`;

    // ---------------- Perhitungan ----------------
    // Kolom didefinisikan per kunci; huruf kolom dihitung otomatis (rumus tidak rusak bila kolom ditambah/dihapus).
    const COLS = [
      ["no", "No", 5], ["kode", "Kode", 12], ["nama", "Nama", 34], ["satuan", "Satuan", 8], ["brand", "Kategori", 13], ["kat", "Kategori Zahir", 22],
      ["usage", "Pemakaian / hari", 11], ["buffer", "Buffer (hari)", 9], ["lead", "Lead time (hari)", 9], ["target", "Target DSI (hari)", 9],
      ["soh", "SOH Zahir", 11], ["ss", "Safety stock", 11], ["rop", "ROP", 11], ["max", "Stok maksimum", 11], ["dsi", "DSI (hari)", 9],
      ["saran", "Kebutuhan (stok maks − SOH)", 12], ["needPack", "Dibulatkan kemasan", 11], ["moq", "MOQ", 10], ["moqDays", "MOQ (hari pemakaian)", 10], ["kel", "Kelipatan", 10],
      ["final", "Final PR", 11], ["overNeed", "Lebih dari kebutuhan", 11], ["dsiAfter", "DSI setelah PR", 10],
      ["harga", "Harga", 12], ["nilaiPR", "Nilai PR", 14], ["nilaiSOH", "Nilai SOH", 14], ["status", "Status", 14], ["band", "Band DSI (sheet lama)", 15],
      ["hargaSrc", "Sumber harga", 10], ["note", "Catatan", 24], ["issue", "Data issue", 34], ["supplier", "Supplier", 20], ["sohBy", "Rincian SOH per gudang", 30],
      ["excess", "Kelebihan di atas batas target", 14], ["excessVal", "Nilai kelebihan", 15], ["phys", "Batas stok fisik (target)", 13],
      ["avg", "Rata-rata stok fisik (hari)", 12], ["cyc", "Order tiap ± (hari)", 11], ["moqRule", "Aturan MOQ", 13],
    ];
    const CI = {}; COLS.forEach(([key], i) => (CI[key] = i + 1));
    const L = (key) => col(CI[key]);
    title(wsC, `Perhitungan ROP — ${meta.gudangLabel || ""}`, "Kolom kuning = input (boleh diubah). Kolom putih = rumus. Oranye = Final PR diubah manual di aplikasi.");
    wsC.getCell("A3").value = "Rumus (Ringkasan C21 = Buffer + Lead time): ROP = Stok maks = Pemakaian × (Buffer + Lead time) · Kebutuhan = Stok maks − SOH bila SOH ≤ ROP · Final PR = MAX(MOQ, CEILING(Kebutuhan, Kelipatan)) bila tambahan MOQ ≤ batas (C20), selain itu CEILING(Kebutuhan, Kelipatan) · C21 = Target DSI: Stok maks = Pemakaian × (MAX(Buffer + 1, 2 × Target − Buffer) + Lead time)";
    wsC.getCell("A3").font = { size: 9, color: { argb: MUTED } };
    const H0 = 5, D0 = 6;
    const hr = wsC.getRow(H0); COLS.forEach(([, h], i) => (hr.getCell(i + 1).value = h)); styleHeader(hr, 1, COLS.length);
    const last = D0 + Math.max(rows.length, 1) - 1;
    const QTY = "#,##0.##;-#,##0.##;0";
    rows.forEach((r, i) => {
      const n = D0 + i;
      const row = wsC.getRow(n);
      const c = (key) => `${L(key)}${n}`;
      const v = (key, val) => (row.getCell(CI[key]).value = val);
      const G = c("usage"), H = c("buffer"), I = c("lead"), J = c("target"), K = c("soh"), SOH = `MAX(${K},0)`;
      v("no", i + 1); v("kode", r.kode); v("nama", r.nama); v("satuan", r.satuan || r.satuanMaster); v("brand", r.brand); v("kat", r.kategori);
      if (r.hasParam) {
        v("usage", r.usage); v("buffer", r.buffer); v("lead", r.lead);
        v("target", r.targetFromMaster ? r.target : { formula: R(GL.target), result: r.target });
      }
      if (gsel && r.inZahir) v("soh", { formula: `SUMIFS(${ZR("G")},${ZR("M")},"${esc(r.code)}",${ZR("L")},"Ya")`, result: r.sohRaw });
      else v("soh", r.sohRaw);
      v("sohBy", (r.sohBy || []).map((x) => `${x.gudang}: ${x.qty}`).join(" · "));
      v("ss", { formula: `${G}*${H}`, result: r.ss || 0 });
      v("rop", { formula: `${G}*(${H}+${I})`, result: r.rop || 0 });
      const BYT = `AND(${R(GL.basis)}="Target DSI",N(${J})>0)`; // dasar qty order: Target DSI (bila dipilih) atau Buffer + Lead time
      v("max", { formula: `${G}*IF(${BYT},MAX(${H}+1,2*${J}-${H})+${I},${H}+${I})`, result: r.max || 0 });
      v("dsi", { formula: `IF(N(${G})>0,${SOH}/${G},"")`, result: r.dsi == null ? "" : r.dsi });
      v("saran", { formula: `IF(AND(N(${G})>0,${SOH}<=${c("rop")},${SOH}<${c("max")}),${c("max")}-${SOH},0)`, result: r.saran || 0 });
      if (r.hasParam) { v("moq", r.moq || 0); v("kel", r.kelipatan || 1); }
      v("needPack", { formula: `IF(${c("saran")}>0,CEILING(${c("saran")},IF(N(${c("kel")})>0,${c("kel")},1)),0)`, result: r.needPack || 0 });
      v("moqDays", { formula: `IF(AND(N(${G})>0,N(${c("moq")})>0),${c("moq")}/${G},"")`, result: r.moqDays == null ? "" : r.moqDays });
      const NEED = c("needPack"), MQ = `MAX(N(${c("moq")}),${NEED})`;
      const finalFormula = `IF(${NEED}>0,IF(${MQ}-${NEED}<=${R(GL.moqTol)}*N(${G}),${MQ},${NEED}),0)`;
      if (r.finalEdited) {
        v("final", r.final);
        row.getCell(CI.final).fill = { type: "pattern", pattern: "solid", fgColor: { argb: EDIT_FILL } };
        row.getCell(CI.final).note = `Diubah manual. Rekomendasi sistem: ${r.finalAuto}. Rumus asli: =${finalFormula}${r.note ? `\nCatatan: ${r.note}` : ""}`;
      } else v("final", { formula: finalFormula, result: r.final || 0 });
      v("overNeed", { formula: `MAX(0,${c("final")}-${c("saran")})`, result: r.overNeed || 0 });
      v("moqRule", { formula: `IF(${NEED}>0,IF(${MQ}-${NEED}=0,"",IF(${MQ}-${NEED}<=${R(GL.moqTol)}*N(${G}),"MOQ diikuti","MOQ ditahan")),"")`, result: r.moqRule || "" });
      v("dsiAfter", { formula: `IF(N(${G})>0,(${SOH}+${c("final")})/${G},"")`, result: r.dsiAfter == null ? "" : r.dsiAfter });
      v("harga", r.harga || 0);
      v("nilaiPR", { formula: `${c("final")}*${c("harga")}`, result: r.nilaiPR || 0 });
      v("nilaiSOH", { formula: `${SOH}*${c("harga")}`, result: r.nilaiSOH || 0 });
      v("status", { formula: `IF(${G}="","Tanpa parameter",IF(${G}<=0,IF(${K}>0,"Tidak bergerak","Tidak aktif"),IF(${K}<=0,"OOS",IF(${c("dsi")}<=${I},"Kritis",IF(AND(${SOH}<=${c("rop")},${SOH}<${c("max")}),"Order",IF(${c("dsi")}>${R(GL.over)},"Overstock",IF(AND(N(${J})>0,${SOH}>${c("phys")}),"Di atas target","Aman")))))))`, result: r.status });
      v("band", { formula: `IF(${c("dsi")}="","",IF(${c("dsi")}<${R(GL.dsiMin)},"Min ≤3 hari",IF(${c("dsi")}<${R(GL.dsiSafe)},"Safety 4–6 hari","Max ≥7 hari")))`, result: r.band || "" });
      v("hargaSrc", r.hargaSrc || ""); v("note", r.note || ""); v("issue", (r.issues || []).join("; ")); v("supplier", r.supplier || "");
      v("excess", { formula: `IF(${G}="","",IF(${G}<=0,${SOH},IF(N(${J})=0,0,MAX(0,${SOH}-${c("phys")}))))`, result: r.hasParam ? r.excess || 0 : "" });
      v("excessVal", { formula: `IF(${c("excess")}="","",${c("excess")}*${c("harga")})`, result: r.hasParam ? r.excessValue || 0 : "" });
      v("phys", { formula: `IF(N(${G})>0,${G}*IF(${BYT},MAX(${H}+1,2*${J}-${H}),IF(N(${J})>0,MAX(${H}+1,${J}),${H}+1)),"")`, result: r.usage > 0 ? r.physMax : "" });
      v("avg", { formula: `IF(N(${G})>0,IF(${BYT},(${H}+${c("phys")}/${G})/2,${H}+0.5),"")`, result: r.usage > 0 ? r.avgDays : "" });
      v("cyc", { formula: `IF(N(${G})>0,IF(${BYT},${c("phys")}/${G}-${H},1),"")`, result: r.usage > 0 ? r.cycleDays : "" });
      const cell = (key) => row.getCell(CI[key]);
      const valOf = (key) => { const x = cell(key).value; return x && typeof x === "object" && "result" in x ? x.result : x; };
      ["usage", "soh", "ss", "rop", "max", "saran", "needPack", "moq", "kel", "final", "overNeed", "excess"].forEach((key) => (cell(key).numFmt = fmtQty(valOf(key))));
      ["buffer", "lead", "target"].forEach((key) => (cell(key).numFmt = QTY));
      ["dsi", "dsiAfter", "avg", "cyc", "moqDays"].forEach((key) => (cell(key).numFmt = "#,##0.0"));
      cell("phys").numFmt = "#,##0.##";
      cell("harga").numFmt = '"Rp" #,##0.00';
      ["nilaiPR", "nilaiSOH", "excessVal"].forEach((key) => (cell(key).numFmt = RP));
      ["usage", "buffer", "lead", "target", "soh", "moq", "kel", "harga", "note"].forEach((key) => inputCell(cell(key)));
      for (let k2 = 1; k2 <= COLS.length; k2++) if (!row.getCell(k2).border) border(row.getCell(k2));
    });
    COLS.forEach(([, , w], i) => (wsC.getColumn(i + 1).width = w));
    wsC.views = [{ state: "frozen", xSplit: 3, ySplit: H0 }];
    wsC.autoFilter = { from: { row: H0, column: 1 }, to: { row: last, column: COLS.length } };
    for (const key of ["usage", "buffer", "lead", "target", "soh", "moq", "kel", "final", "harga"]) {
      const a = L(key), any = key === "soh";
      wsC.dataValidations.add(`${a}${D0}:${a}${last}`, { type: "decimal", operator: any ? "between" : "greaterThanOrEqual", allowBlank: true, formulae: any ? [-1e12, 1e12] : [0], showErrorMessage: true, errorTitle: "Input tidak valid", error: any ? "Isi angka." : "Isi angka ≥ 0." });
    }
    const SC = L("status"), DC = L("dsi"), LC = L("lead");
    const stRules = Object.keys(STATUS_FILL).map((st, i) => ({ type: "expression", priority: i + 1, formulae: [`$${SC}${D0}="${st}"`], style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: STATUS_FILL[st] } } } }));
    wsC.addConditionalFormatting({ ref: `${SC}${D0}:${SC}${last}`, rules: stRules });
    wsC.addConditionalFormatting({ ref: `${DC}${D0}:${DC}${last}`, rules: [{ type: "expression", priority: 20, formulae: [`AND(ISNUMBER(${DC}${D0}),${DC}${D0}<=${LC}${D0})`], style: { font: { color: { argb: "FFB91C1C" }, bold: true } } }] });

    const RC = (key) => `Perhitungan!$${L(key)}$${D0}:$${L(key)}$${last}`;

    // ---------------- PR (daftar beli) ----------------
    const pr = result.rows.filter((r) => r.final > 0).sort(ctx.prioritySort || (() => 0));
    title(wsPR, `Daftar Purchase Request — ${meta.gudangLabel || ""}`, `Tanggal stok ${meta.stockDate || "-"} · disusun ${meta.preparedBy || "-"} · angka diambil dari sheet Perhitungan (INDEX/MATCH per kode, aman bila Perhitungan diurutkan)`);
    const PCOLS = [["no", "No", 5], ["status", "Status", 12], ["kode", "Kode", 11], ["nama", "Nama", 34], ["satuan", "Satuan", 8], ["brand", "Kategori", 13],
      ["soh", "SOH", 11], ["usage", "Pemakaian / hari", 11], ["dsi", "DSI (hari)", 9], ["saran", "Kebutuhan", 11], ["moq", "MOQ", 10], ["final", "Final PR", 11],
      ["overNeed", "Lebih dari kebutuhan", 11], ["harga", "Harga", 12], ["nilaiPR", "Nilai PR", 15], ["dsiAfter", "DSI setelah PR", 10], ["moqRule", "Aturan MOQ", 12],
      ["note", "Catatan", 26], ["ref", "Baris di Perhitungan", 10]];
    const PI = {}; PCOLS.forEach(([key], i) => (PI[key] = i + 1));
    const hp = wsPR.getRow(4); PCOLS.forEach(([, h], i) => (hp.getCell(i + 1).value = h)); styleHeader(hp, 1, PCOLS.length);
    const P0 = 5, REF = col(PI.ref);
    const pick = (key, n) => `IFERROR(INDEX(${RC(key)},$${REF}${n}),"")`;
    pr.forEach((r, i) => {
      const n = P0 + i, row = wsPR.getRow(n);
      row.getCell(PI.no).value = i + 1;
      row.getCell(PI.kode).value = r.kode;
      row.getCell(PI.ref).value = { formula: `MATCH($${col(PI.kode)}${n},${RC("kode")},0)`, result: rows.indexOf(r) + 1 };
      const map = { status: r.status, nama: r.nama, satuan: r.satuan || r.satuanMaster, brand: r.brand, soh: r.sohRaw, usage: r.usage, dsi: r.dsi == null ? "" : r.dsi,
        saran: r.saran || 0, moq: r.moq || 0, final: r.final, overNeed: r.overNeed || 0, harga: r.harga || 0, nilaiPR: r.nilaiPR, dsiAfter: r.dsiAfter == null ? "" : r.dsiAfter,
        moqRule: r.moqRule || "", note: r.note || "" };
      for (const [key, res] of Object.entries(map)) row.getCell(PI[key]).value = { formula: pick(key, n), result: res };
      ["soh", "usage", "saran", "moq", "final", "overNeed"].forEach((key) => (row.getCell(PI[key]).numFmt = QTY));
      ["dsi", "dsiAfter"].forEach((key) => (row.getCell(PI[key]).numFmt = "#,##0.0"));
      row.getCell(PI.harga).numFmt = '"Rp" #,##0.00'; row.getCell(PI.nilaiPR).numFmt = RP;
      for (let k2 = 1; k2 <= PCOLS.length; k2++) border(row.getCell(k2));
    });
    const pLast = P0 + Math.max(pr.length, 1) - 1;
    const tRow = wsPR.getRow(pLast + 1), NV = col(PI.nilaiPR);
    tRow.getCell(PI.nama).value = "TOTAL";
    tRow.getCell(PI.nilaiPR).value = { formula: `SUM(${NV}${P0}:${NV}${pLast})`, result: Math.round(pr.reduce((a, r) => a + r.nilaiPR, 0)) };
    tRow.getCell(PI.nilaiPR).numFmt = RP;
    [PI.nama, PI.nilaiPR].forEach((k2) => (tRow.getCell(k2).font = { bold: true }));
    tRow.getCell(PI.no).value = { formula: `COUNTA(${col(PI.kode)}${P0}:${col(PI.kode)}${pLast})&" item"`, result: `${pr.length} item` };
    PCOLS.forEach(([, , w], i) => (wsPR.getColumn(i + 1).width = w));
    wsPR.views = [{ state: "frozen", xSplit: 4, ySplit: 4 }];
    if (pr.length) wsPR.autoFilter = { from: { row: 4, column: 1 }, to: { row: pLast, column: PCOLS.length } };
    wsPR.addConditionalFormatting({ ref: `B${P0}:B${pLast}`, rules: Object.keys(STATUS_FILL).map((st, i) => ({ type: "expression", priority: i + 1, formulae: [`$B${P0}="${st}"`], style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: STATUS_FILL[st] } } } })) });
    wsPR.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };

    // ---------------- Stok Zahir ----------------
    title(wsZ, "Stok Zahir (hasil baca file, semua gudang · kolom Dihitung = ikut dijumlah ke SOH)", `File: ${meta.fileName || "-"} · SHA-256 ${meta.fileHash || "-"}`);
    const HZ = ["Jalur grup", "Induk", "Gudang", "Kategori", "Kode", "Nama", "Jumlah", "Satuan", "Mata uang", "Harga satuan", "Total", "Dihitung", "Kode (normal)", "File", "Baris file"];
    const hz = wsZ.getRow(4); HZ.forEach((h, i) => (hz.getCell(i + 1).value = h)); styleHeader(hz, 1, HZ.length);
    const Z0 = 5;
    zahir.items.forEach((it, i) => {
      const row = wsZ.getRow(Z0 + i);
      [it.pathStr, it.induk, it.gudang, it.kategori, it.kode, it.nama, it.qty, it.satuan, it.mataUang, it.harga, it.total, !gsel || gsel.has(it.gkey) ? "Ya" : "Tidak", it.code, it.source || meta.fileName || "", it.row].forEach((val, c) => (row.getCell(c + 1).value = val));
      row.getCell(7).numFmt = fmtQty(it.qty); row.getCell(10).numFmt = "#,##0.00"; row.getCell(11).numFmt = "#,##0.00";
    });
    const zLast = Z0 + Math.max(zahir.items.length, 1) - 1;
    [44, 12, 14, 26, 12, 36, 12, 9, 9, 13, 16, 9, 12, 30, 9].forEach((w, i) => (wsZ.getColumn(i + 1).width = w));
    if (zahir.items.length) wsZ.addConditionalFormatting({ ref: `L${Z0}:L${zLast}`, rules: [{ type: "expression", priority: 1, formulae: [`$L${Z0}="Ya"`], style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFDDF1E3" } } } }] });
    wsZ.views = [{ state: "frozen", ySplit: 4 }];
    wsZ.autoFilter = { from: { row: 4, column: 1 }, to: { row: zLast, column: HZ.length } };

    // ---------------- Ringkasan ----------------
    title(wsR, "Rekomendasi Pembelian Gudang", [meta.company, meta.gudangLabel].filter(Boolean).join(" · "));
    const kv = (r, k, val, fmt) => { wsR.getCell(`B${r}`).value = k; wsR.getCell(`C${r}`).value = val; wsR.getCell(`B${r}`).font = { color: { argb: MUTED } }; if (fmt) wsR.getCell(`C${r}`).numFmt = fmt; };
    const section = (r, text) => { const c = wsR.getCell(`B${r}`); c.value = text; c.font = { bold: true, color: { argb: NAVY }, size: 11 }; wsR.getCell(`B${r}`).border = { bottom: { style: "thin", color: { argb: NAVY } } }; };
    section(4, "Informasi");
    kv(5, "Gudang dihitung (stok dijumlah)", meta.gudangLabel || "");
    kv(6, "Tanggal stok", meta.stockDate || "");
    kv(7, "Disusun oleh", meta.preparedBy || "");
    kv(8, "Dibuat", meta.generatedAt ? new Date(meta.generatedAt).toLocaleString("id-ID") : "");
    kv(9, "File Zahir", meta.fileName || "");
    kv(10, "SHA-256 file", meta.fileHash || "");
    kv(11, "Sumber parameter", meta.masterSource || "");
    kv(12, "Parameter dimuat", meta.masterLoadedAt ? new Date(meta.masterLoadedAt).toLocaleString("id-ID") : "");
    kv(13, "Jumlah item dihitung", rows.length, "#,##0");
    section(15, "Parameter global (boleh diubah, kuning)");
    kv(16, "Target DSI (hari) = rata-rata stok fisik; dipakai bila master tidak punya kolom Target DSI (0 = sheet lama)", s.targetDsi);
    kv(17, "Batas overstock (DSI, hari)", s.overstockDays);
    kv(18, "Batas band Min (DSI <)", s.dsiMin);
    kv(19, "Batas band Safety (DSI <)", s.dsiSafety);
    kv(20, "Batas kelebihan MOQ (hari pemakaian): MOQ diikuti bila menambah ≤ angka ini; 0 = selalu sesuai kebutuhan, 999 = selalu ikut MOQ", s.moqTolDays);
    kv(21, "Dasar qty order: \"Buffer + Lead time\" (stok maks = ROP, sesuai master) atau \"Target DSI\" (stok maks dari target)", s.orderBasis === "target" ? "Target DSI" : "Buffer + Lead time");
    wsR.getCell("C21").dataValidation = { type: "list", allowBlank: false, formulae: ['"Buffer + Lead time,Target DSI"'] };
    [16, 17, 18, 19, 20, 21].forEach((r) => inputCell(wsR.getCell(`C${r}`)));
    kv(22, "Pembulatan otomatis Gram/Ml", s.roundGramMl ? `Ke atas kelipatan ${s.roundStep} (bila kolom Kelipatan di master kosong)` : "Tidak");
    kv(23, "Sumber harga", s.priceSource === "zahir" ? "Harga Zahir (HPP rata-rata), cadangan: master" : "Harga master (harga terakhir), cadangan: Zahir");

    section(24, "Hasil");
    const k = result.kpi;
    const sumG = `SUMPRODUCT(${RC("usage")},${RC("harga")})`;
    const kpiRows = [
      ["Target DSI (hari)", { formula: R(GL.target), result: s.targetDsi }, "#,##0.0"],
      ["DSI gudang aktual (hari) = nilai stok ÷ nilai pemakaian per hari", { formula: `IFERROR(SUMIF(${RC("usage")},"<>",${RC("nilaiSOH")})/${sumG},"")`, result: k.dsiActual == null ? "" : k.dsiActual }, "#,##0.0"],
      ["DSI bila kelebihan & barang tidak bergerak dihabiskan (hari)", { formula: `IFERROR((SUMIF(${RC("usage")},"<>",${RC("nilaiSOH")})-SUMIF(${RC("usage")},">0",${RC("excessVal")})-SUMIF(${RC("status")},"Tidak bergerak",${RC("nilaiSOH")}))/${sumG},"")`, result: k.dsiNoExcess == null ? "" : k.dsiNoExcess }, "#,##0.0"],
      ["DSI desain parameter (hari) = rata-rata stok fisik bila order sesuai rumus", { formula: `IFERROR(SUMPRODUCT(${RC("usage")},${RC("harga")},${RC("avg")})/${sumG},"")`, result: k.dsiDesign == null ? "" : k.dsiDesign }, "#,##0.0"],
      ["Di atas target, barang bergerak (item)", { formula: `COUNTIFS(${RC("usage")},">0",${RC("excess")},">0")`, result: k.excessCount }, "#,##0"],
      ["Kelebihan stok di atas target (nilai)", { formula: `SUMIF(${RC("usage")},">0",${RC("excessVal")})`, result: k.excessValue }, RP],
      ["Kebutuhan riil (nilai, sebelum MOQ)", { formula: `SUMPRODUCT(${RC("saran")},${RC("harga")})`, result: k.needValue }, RP],
      ["PR lebih dari kebutuhan (nilai, karena MOQ / edit manual)", { formula: `SUMPRODUCT(${RC("overNeed")},${RC("harga")})`, result: k.overNeedValue }, RP],
      ["MOQ ditahan (item, PR = kebutuhan)", { formula: `COUNTIF(${RC("moqRule")},"MOQ ditahan")`, result: k.moqHeldCount }, "#,##0"],
      ["Item perlu order (Final PR > 0)", { formula: `COUNTIF(${RC("final")},">0")`, result: k.prCount }, "#,##0"],
      ["Nilai PR", { formula: `SUM(${RC("nilaiPR")})`, result: k.prValue }, RP],
      ["Stok habis (OOS)", { formula: `COUNTIF(${RC("status")},"OOS")`, result: k.oos }, "#,##0"],
      ["Kritis (DSI ≤ lead time)", { formula: `COUNTIF(${RC("status")},"Kritis")`, result: k.kritis }, "#,##0"],
      ["Order (SOH ≤ ROP)", { formula: `COUNTIF(${RC("status")},"Order")`, result: k.order }, "#,##0"],
      ["Overstock (item)", { formula: `COUNTIF(${RC("status")},"Overstock")`, result: k.over }, "#,##0"],
      ["Overstock (nilai stok)", { formula: `SUMIF(${RC("status")},"Overstock",${RC("nilaiSOH")})`, result: k.overValue }, RP],
      ["Tidak bergerak (item)", { formula: `COUNTIF(${RC("status")},"Tidak bergerak")`, result: k.dead }, "#,##0"],
      ["Tidak bergerak (nilai stok)", { formula: `SUMIF(${RC("status")},"Tidak bergerak",${RC("nilaiSOH")})`, result: k.deadValue }, RP],
      ["Tanpa parameter, ada stok (item)", { formula: `COUNTIFS(${RC("status")},"Tanpa parameter",${RC("soh")},">0")`, result: k.noParamStock }, "#,##0"],
      ["Tanpa parameter, ada stok (nilai)", { formula: `SUMIFS(${RC("nilaiSOH")},${RC("status")},"Tanpa parameter")`, result: k.noParamValue }, RP],
      ["Nilai stok gudang", { formula: `SUM(${RC("nilaiSOH")})`, result: k.stockValue }, RP],
      ["% nilai stok overstock + tidak bergerak", { formula: "", result: k.stockValue ? (k.overValue + k.deadValue) / k.stockValue : 0 }, "0.0%"],
    ];
    const kRow = (label) => 25 + kpiRows.findIndex((x) => x[0] === label);
    kpiRows[kpiRows.length - 1][1].formula = `IFERROR((C${kRow("Overstock (nilai stok)")}+C${kRow("Tidak bergerak (nilai stok)")})/C${kRow("Nilai stok gudang")},0)`;
    kpiRows.forEach(([label, val, fmt], i) => { kv(25 + i, label, val, fmt); wsR.getCell(`C${25 + i}`).font = { bold: true, color: { argb: INK } }; });

    let rr = 25 + kpiRows.length + 1;
    section(rr, "Nilai PR per kategori"); rr++;
    const hb = wsR.getRow(rr); ["", "Kategori", "Item PR", "Nilai PR"].forEach((h, i) => { if (i) hb.getCell(i + 1).value = h; }); styleHeader(hb, 2, 4); hb.height = 20; rr++;
    const brands = Array.from(new Set(result.rows.filter((r) => r.hasParam).map((r) => r.brand || ""))).sort();
    for (const b of brands) {
      wsR.getCell(`B${rr}`).value = b || "(kosong)";
      wsR.getCell(`C${rr}`).value = { formula: `COUNTIFS(${RC("brand")},"${esc(b)}",${RC("final")},">0")`, result: result.rows.filter((r) => (r.brand || "") === b && r.final > 0).length };
      wsR.getCell(`D${rr}`).value = { formula: `SUMIFS(${RC("nilaiPR")},${RC("brand")},"${esc(b)}")`, result: Math.round(result.rows.filter((r) => (r.brand || "") === b).reduce((a, r) => a + r.nilaiPR, 0)) };
      wsR.getCell(`D${rr}`).numFmt = RP; rr++;
    }

    rr++;
    section(rr, "Rekonsiliasi file Zahir (subtotal di file vs jumlah baris produk)"); rr++;
    const hrec = wsR.getRow(rr); ["", "Grup", "Item", "Qty file", "Qty hitung", "Selisih qty", "Nilai file", "Nilai hitung", "Selisih nilai", "Status"].forEach((h, i) => { if (i) hrec.getCell(i + 1).value = h; }); styleHeader(hrec, 2, 10); hrec.height = 20; rr++;
    const ZC = (c) => `'Stok Zahir'!$${c}$${Z0}:$${c}$${zLast}`;
    for (const rc of zahir.recon) {
      const p = rc.prefix;
      wsR.getCell(`B${rr}`).value = "   ".repeat(rc.depth) + rc.name;
      wsR.getCell(`C${rr}`).value = rc.items;
      wsR.getCell(`D${rr}`).value = rc.qtyFile;
      wsR.getCell(`E${rr}`).value = { formula: `SUMIFS(${ZC("G")},${ZC("A")},"${esc(escWild(p))}")+SUMIFS(${ZC("G")},${ZC("A")},"${esc(escWild(p))} › *")`, result: rc.qtyCalc };
      wsR.getCell(`F${rr}`).value = { formula: `D${rr}-E${rr}`, result: (rc.qtyFile || 0) - rc.qtyCalc };
      wsR.getCell(`G${rr}`).value = rc.valFile;
      wsR.getCell(`H${rr}`).value = { formula: `SUMIFS(${ZC("K")},${ZC("A")},"${esc(escWild(p))}")+SUMIFS(${ZC("K")},${ZC("A")},"${esc(escWild(p))} › *")`, result: rc.valCalc };
      wsR.getCell(`I${rr}`).value = { formula: `G${rr}-H${rr}`, result: (rc.valFile || 0) - rc.valCalc };
      wsR.getCell(`J${rr}`).value = { formula: `IF(AND(ABS(F${rr})<0.01,ABS(I${rr})<=MAX(1,C${rr}*0.01)),"Cocok","SELISIH")`, result: rc.ok ? "Cocok" : "SELISIH" };
      ["D", "E", "F"].forEach((c) => (wsR.getCell(`${c}${rr}`).numFmt = "#,##0.##;-#,##0.##;0"));
      ["G", "H", "I"].forEach((c) => (wsR.getCell(`${c}${rr}`).numFmt = "#,##0.00"));
      if (rc.depth < 2) wsR.getCell(`B${rr}`).font = { bold: true };
      rr++;
    }
    const recFirst = rr - zahir.recon.length;
    if (zahir.recon.length) wsR.addConditionalFormatting({ ref: `J${recFirst}:J${rr - 1}`, rules: [{ type: "expression", priority: 1, formulae: [`$J${recFirst}="SELISIH"`], style: { font: { color: { argb: "FFB91C1C" }, bold: true } } }] });
    [2, 60, 18, 14, 14, 12, 16, 16, 12, 10].forEach((w, i) => (wsR.getColumn(i + 1).width = w));
    wsR.getColumn(2).width = 58;

    // ---------------- Data Issue ----------------
    title(wsI, "Data issue", "Perbaiki dari prioritas Tinggi. Selama belum diperbaiki, rekomendasi untuk item ini tidak bisa dipercaya penuh.");
    const HI = ["No", "Prioritas", "Jenis", "Kode", "Nama", "Detail", "Sumber", "Tindakan"];
    const hi = wsI.getRow(4); HI.forEach((h, i) => (hi.getCell(i + 1).value = h)); styleHeader(hi, 1, HI.length);
    const allIssues = result.issues.slice();
    for (const rc of zahir.recon) if (!rc.ok) allIssues.push({ type: "Subtotal Zahir tidak cocok", kode: "", nama: rc.name, detail: `Qty file ${rc.qtyFile} vs hitung ${rc.qtyCalc}; nilai file ${rc.valFile} vs hitung ${rc.valCalc}`, severity: "Tinggi", source: "Zahir" });
    for (const u of zahir.unparsed) allIssues.push({ type: "Baris tidak terbaca", kode: "", nama: "", detail: `Baris ${u.row}: ${u.text}`, severity: "Sedang", source: "Zahir" });
    for (const w of zahir.warnings) allIssues.push({ type: "Peringatan file", kode: "", nama: "", detail: w, severity: "Sedang", source: "Zahir" });
    allIssues.sort((a, b) => (SEV_ORDER[a.severity] ?? 3) - (SEV_ORDER[b.severity] ?? 3) || a.type.localeCompare(b.type) || String(a.kode).localeCompare(String(b.kode)));
    allIssues.forEach((it, i) => {
      const row = wsI.getRow(5 + i);
      [i + 1, it.severity || "", it.type, it.kode, it.nama, it.detail, it.source || "", ACTION[it.type] || ""].forEach((val, c) => (row.getCell(c + 1).value = val));
      row.getCell(6).alignment = { wrapText: true, vertical: "top" }; row.getCell(8).alignment = { wrapText: true, vertical: "top" };
    });
    [5, 9, 30, 12, 30, 60, 9, 50].forEach((w, i) => (wsI.getColumn(i + 1).width = w));
    wsI.views = [{ state: "frozen", ySplit: 4 }];
    if (allIssues.length) {
      wsI.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + allIssues.length, column: HI.length } };
      wsI.addConditionalFormatting({ ref: `B5:B${4 + allIssues.length}`, rules: [{ type: "expression", priority: 1, formulae: ['$B5="Tinggi"'], style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFF6D3D3" } } } }] });
    }

    // ---------------- Log Perubahan ----------------
    title(wsL, "Log perubahan manual", "Setiap perubahan Final PR dan catatan di aplikasi, serta setiap Cetak PO.");
    const HL = ["Waktu", "Kode", "Nama", "Kolom", "Nilai sebelum", "Nilai baru", "Rekomendasi sistem", "Oleh"];
    const hl = wsL.getRow(4); HL.forEach((h, i) => (hl.getCell(i + 1).value = h)); styleHeader(hl, 1, HL.length);
    (ctx.log || []).forEach((e, i) => {
      const row = wsL.getRow(5 + i);
      [e.t ? new Date(e.t).toLocaleString("id-ID") : "", e.kode, e.nama, e.field, e.from, e.to, e.system, e.by || meta.preparedBy || ""].forEach((val, c) => (row.getCell(c + 1).value = val == null ? "" : val));
    });
    if (!(ctx.log || []).length) wsL.getCell("A5").value = "Tidak ada perubahan manual.";
    [20, 12, 34, 16, 14, 14, 18, 18].forEach((w, i) => (wsL.getColumn(i + 1).width = w));

    return wb;
  }

  // Template master parameter (bisa dipakai untuk upload master atau memindahkan parameter dari Google Sheet).
  function buildMasterTemplate(ExcelJS, master) {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Master Parameter");
    const H = ["Kode Barang", "Nama", "Satuan", "Kategori", "Penjualan 1 Hari", "Buffer Stock (Hari)", "Lead Time (Hari)", "Target DSI (Hari)", "Minimum Order", "Kelipatan Order", "Harga", "Aktif", "Supplier"];
    const hr = ws.getRow(1); H.forEach((h, i) => (hr.getCell(i + 1).value = h)); styleHeader(hr, 1, H.length);
    const items = (master && master.items) || [];
    items.forEach((m, i) => {
      const row = ws.getRow(2 + i);
      [m.kode, m.nama, m.satuan, m.brand, m.usage, m.buffer, m.lead, m.target, m.moq, m.kelipatan, m.harga, m.aktif === false ? "Tidak" : "Ya", m.supplier || ""].forEach((v, c) => (row.getCell(c + 1).value = v == null ? null : v));
    });
    ws.getColumn(1).numFmt = "@";
    [14, 34, 9, 16, 14, 14, 13, 14, 13, 13, 12, 8, 24].forEach((w, i) => (ws.getColumn(i + 1).width = w));
    ws.views = [{ state: "frozen", ySplit: 1, xSplit: 2 }];
    const n = Math.max(items.length + 1, 200);
    for (const c of ["E", "F", "G", "H", "I", "J", "K"]) ws.dataValidations.add(`${c}2:${c}${n}`, { type: "decimal", operator: "greaterThanOrEqual", allowBlank: true, formulae: [0], showErrorMessage: true, error: "Isi angka ≥ 0." });
    ws.dataValidations.add(`L2:L${n}`, { type: "list", allowBlank: true, formulae: ['"Ya,Tidak"'] });
    const info = wb.addWorksheet("Petunjuk");
    [
      ["Kolom wajib", "Kode Barang, Penjualan 1 Hari, Buffer Stock (Hari), Lead Time (Hari)."],
      ["Penjualan 1 Hari", "Rata-rata pemakaian per hari dalam SATUAN ZAHIR (gram, pcs, liter, ...)."],
      ["Buffer Stock (Hari)", "Safety stock dalam hari pemakaian."],
      ["Lead Time (Hari)", "Hari dari PR dibuat sampai barang diterima gudang."],
      ["Target DSI (Hari)", "Target rata-rata stok fisik dalam hari pemakaian (default aplikasi 3). Kosong = pakai default. 0 = sama dengan sheet lama (order hanya sampai ROP)."],
      ["Minimum Order", "MOQ supplier. Final PR tidak akan di bawah angka ini."],
      ["Kelipatan Order", "Isi per kemasan (mis. 1 sak = 50000 gram). Final PR dibulatkan ke atas ke kelipatan ini."],
      ["Harga", "Harga beli terakhir. Kosong = pakai harga satuan di file Zahir."],
      ["Aktif", "Tidak = barang tidak dihitung."],
      ["Supplier", "Nama supplier utama. Dipakai untuk memisah Cetak PO per supplier."],
    ].forEach((r, i) => { info.getCell(`A${i + 1}`).value = r[0]; info.getCell(`B${i + 1}`).value = r[1]; info.getCell(`A${i + 1}`).font = { bold: true }; });
    info.getColumn(1).width = 22; info.getColumn(2).width = 100;
    return wb;
  }

  return { buildWorkbook, buildMasterTemplate };
});
