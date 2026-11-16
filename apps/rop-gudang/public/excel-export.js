/* ROP Gudang — export Excel (ExcelJS). Dipakai di browser (window.ROPExport) dan Node (tes).
 * Semua angka hasil hitung ditulis sebagai RUMUS supaya bisa diaudit dan diubah di Excel:
 * ubah Pemakaian/hari, Buffer, Lead time, PO outstanding, MOQ, harga → Saran PR, Final PR, status, nilai ikut berubah.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ROPExport = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const NAVY = "FF14305A", INK = "FF1F2937", MUTED = "FF6B7280", LINE = "FFD9DEE7";
  const INPUT_FILL = "FFFFF8DB", EDIT_FILL = "FFFFE0B8", HEAD_FILL = "FF14305A", SUB_FILL = "FFEEF2F8";
  const STATUS_FILL = {
    "OOS": "FFF6D3D3", "Kritis": "FFFBE0C8", "Order": "FFFFF1C2", "Aman": "FFDDF1E3",
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
    const G = { cycle: "$C$16", over: "$C$17", dsiMin: "$C$18", dsiSafe: "$C$19" };
    const R = (a) => `Ringkasan!${a}`;

    // ---------------- Perhitungan ----------------
    const HC = ["No", "Kode", "Nama", "Satuan", "Kategori", "Kategori Zahir", "Pemakaian / hari", "Buffer (hari)", "Lead time (hari)", "Siklus order (hari)",
      "SOH Zahir", "PO outstanding", "Safety stock", "ROP", "Stok maksimum", "Posisi stok", "DSI (hari)", "Saran PR", "MOQ", "Kelipatan",
      "Final PR", "DSI setelah PR", "Harga", "Nilai PR", "Nilai SOH", "Status", "Band DSI (sheet lama)", "Sumber harga", "Catatan", "Data issue", "Supplier"];
    title(wsC, `Perhitungan ROP — ${meta.gudangLabel || ""}`, "Kolom kuning = input (boleh diubah). Kolom putih = rumus. Oranye = Final PR diubah manual di aplikasi.");
    wsC.getCell("A3").value = "Rumus: Safety stock = Pemakaian × Buffer · ROP = Pemakaian × (Buffer + Lead time) · Stok maks = ROP + Pemakaian × Siklus · Saran PR = Stok maks − Posisi stok bila Posisi ≤ ROP · Final PR = MAX(MOQ, CEILING(Saran, Kelipatan))";
    wsC.getCell("A3").font = { size: 9, color: { argb: MUTED } };
    const H0 = 5, D0 = 6;
    const hr = wsC.getRow(H0); HC.forEach((h, i) => (hr.getCell(i + 1).value = h)); styleHeader(hr, 1, HC.length);
    const last = D0 + Math.max(rows.length, 1) - 1;
    rows.forEach((r, i) => {
      const n = D0 + i;
      const row = wsC.getRow(n);
      const v = (c, val) => (row.getCell(c).value = val);
      v(1, i + 1); v(2, r.kode); v(3, r.nama); v(4, r.satuan || r.satuanMaster); v(5, r.brand); v(6, r.kategori);
      if (r.hasParam) {
        v(7, r.usage); v(8, r.buffer); v(9, r.lead);
        v(10, r.cycleFromMaster ? r.cycle : { formula: R(G.cycle), result: r.cycle });
      }
      v(11, r.sohRaw); v(12, r.onOrder || 0);
      v(13, { formula: `G${n}*H${n}`, result: r.ss || 0 });
      v(14, { formula: `G${n}*(H${n}+I${n})`, result: r.rop || 0 });
      v(15, { formula: `N${n}+G${n}*J${n}`, result: r.max || 0 });
      v(16, { formula: `MAX(K${n},0)+L${n}`, result: r.pos || 0 });
      v(17, { formula: `IF(N(G${n})>0,MAX(K${n},0)/G${n},"")`, result: r.dsi == null ? "" : r.dsi });
      v(18, { formula: `IF(AND(N(G${n})>0,P${n}<=N${n},P${n}<O${n}),O${n}-P${n},0)`, result: r.saran || 0 });
      if (r.hasParam) { v(19, r.moq || 0); v(20, r.kelipatan || 1); }
      const finalFormula = `IF(R${n}>0,MAX(S${n},CEILING(R${n},IF(N(T${n})>0,T${n},1))),0)`;
      if (r.finalEdited) {
        v(21, r.final);
        row.getCell(21).fill = { type: "pattern", pattern: "solid", fgColor: { argb: EDIT_FILL } };
        row.getCell(21).note = `Diubah manual. Rekomendasi sistem: ${r.finalAuto}. Rumus asli: =${finalFormula}${r.note ? `\nCatatan: ${r.note}` : ""}`;
      } else v(21, { formula: finalFormula, result: r.final || 0 });
      v(22, { formula: `IF(N(G${n})>0,(P${n}+U${n})/G${n},"")`, result: r.dsiAfter == null ? "" : r.dsiAfter });
      v(23, r.harga || 0);
      v(24, { formula: `U${n}*W${n}`, result: r.nilaiPR || 0 });
      v(25, { formula: `MAX(K${n},0)*W${n}`, result: r.nilaiSOH || 0 });
      v(26, { formula: `IF(G${n}="","Tanpa parameter",IF(G${n}<=0,IF(K${n}>0,"Tidak bergerak","Tidak aktif"),IF(K${n}<=0,"OOS",IF(Q${n}<=I${n},"Kritis",IF(AND(P${n}<=N${n},P${n}<O${n}),"Order",IF(Q${n}>${R(G.over)},"Overstock","Aman"))))))`, result: r.status });
      v(27, { formula: `IF(Q${n}="","",IF(Q${n}<${R(G.dsiMin)},"Min ≤3 hari",IF(Q${n}<${R(G.dsiSafe)},"Safety 4–6 hari","Max ≥7 hari")))`, result: r.band || "" });
      v(28, r.hargaSrc || ""); v(29, r.note || ""); v(30, (r.issues || []).join("; ")); v(31, r.supplier || "");
      [7, 11, 12, 13, 14, 15, 16, 18, 19, 20, 21].forEach((c) => (row.getCell(c).numFmt = fmtQty(row.getCell(c).value && row.getCell(c).value.result != null ? row.getCell(c).value.result : row.getCell(c).value)));
      [8, 9, 10].forEach((c) => (row.getCell(c).numFmt = "#,##0.##;-#,##0.##;0"));
      [17, 22].forEach((c) => (row.getCell(c).numFmt = "#,##0.0"));
      [23].forEach((c) => (row.getCell(c).numFmt = '"Rp" #,##0.00'));
      [24, 25].forEach((c) => (row.getCell(c).numFmt = RP));
      [7, 8, 9, 10, 11, 12, 19, 20, 23, 29].forEach((c) => { if (!(c === 21)) inputCell(row.getCell(c)); });
      for (let c = 1; c <= HC.length; c++) if (!row.getCell(c).border) border(row.getCell(c));
    });
    const widthsC = [5, 12, 34, 8, 13, 22, 11, 9, 9, 9, 11, 11, 11, 11, 11, 11, 9, 11, 10, 10, 11, 10, 12, 14, 14, 14, 15, 10, 24, 34, 20];
    widthsC.forEach((w, i) => (wsC.getColumn(i + 1).width = w));
    wsC.views = [{ state: "frozen", xSplit: 3, ySplit: H0 }];
    wsC.autoFilter = { from: { row: H0, column: 1 }, to: { row: last, column: HC.length } };
    for (const c of ["G", "H", "I", "J", "K", "L", "S", "T", "U", "W"]) {
      wsC.dataValidations.add(`${c}${D0}:${c}${last}`, { type: "decimal", operator: c === "K" ? "between" : "greaterThanOrEqual", allowBlank: true, formulae: c === "K" ? [-1e12, 1e12] : [0], showErrorMessage: true, errorTitle: "Input tidak valid", error: c === "K" ? "Isi angka." : "Isi angka ≥ 0." });
    }
    const stRules = Object.keys(STATUS_FILL).map((st, i) => ({ type: "expression", priority: i + 1, formulae: [`$Z${D0}="${st}"`], style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: STATUS_FILL[st] } } } }));
    wsC.addConditionalFormatting({ ref: `Z${D0}:Z${last}`, rules: stRules });
    wsC.addConditionalFormatting({ ref: `Q${D0}:Q${last}`, rules: [{ type: "expression", priority: 20, formulae: [`AND(ISNUMBER(Q${D0}),Q${D0}<=I${D0})`], style: { font: { color: { argb: "FFB91C1C" }, bold: true } } }] });

    const RC = (c) => `Perhitungan!$${c}$${D0}:$${c}$${last}`;

    // ---------------- PR (daftar beli) ----------------
    const pr = result.rows.filter((r) => r.final > 0).sort(ctx.prioritySort || (() => 0));
    title(wsPR, `Daftar Purchase Request — ${meta.gudangLabel || ""}`, `Tanggal stok ${meta.stockDate || "-"} · disusun ${meta.preparedBy || "-"} · angka diambil dari sheet Perhitungan (INDEX/MATCH per kode, aman bila Perhitungan diurutkan)`);
    const HP = ["No", "Status", "Kode", "Nama", "Satuan", "Kategori", "SOH", "Pemakaian / hari", "DSI (hari)", "PO outstanding", "Saran PR", "MOQ", "Final PR", "Harga", "Nilai PR", "DSI setelah PR", "Catatan", "Baris di Perhitungan"];
    const hp = wsPR.getRow(4); HP.forEach((h, i) => (hp.getCell(i + 1).value = h)); styleHeader(hp, 1, HP.length);
    const P0 = 5;
    const pick = (c, n) => `IFERROR(INDEX(${RC(c)},$R${n}),"")`;
    pr.forEach((r, i) => {
      const n = P0 + i, row = wsPR.getRow(n);
      row.getCell(1).value = i + 1;
      row.getCell(3).value = r.kode;
      row.getCell(18).value = { formula: `MATCH($C${n},${RC("B")},0)`, result: rows.indexOf(r) + 1 };
      const map = [[2, "Z", r.status], [4, "C", r.nama], [5, "D", r.satuan || r.satuanMaster], [6, "E", r.brand], [7, "K", r.sohRaw], [8, "G", r.usage], [9, "Q", r.dsi == null ? "" : r.dsi],
        [10, "L", r.onOrder || 0], [11, "R", r.saran], [12, "S", r.moq || 0], [13, "U", r.final], [14, "W", r.harga || 0], [15, "X", r.nilaiPR], [16, "V", r.dsiAfter == null ? "" : r.dsiAfter], [17, "AC", r.note || ""]];
      for (const [c, src, res] of map) row.getCell(c).value = { formula: pick(src, n), result: res };
      [7, 8, 10, 11, 12, 13].forEach((c) => (row.getCell(c).numFmt = "#,##0.##;-#,##0.##;0"));
      [9, 16].forEach((c) => (row.getCell(c).numFmt = "#,##0.0"));
      row.getCell(14).numFmt = '"Rp" #,##0.00'; row.getCell(15).numFmt = RP;
      for (let c = 1; c <= HP.length; c++) border(row.getCell(c));
    });
    const pLast = P0 + Math.max(pr.length, 1) - 1;
    const tRow = wsPR.getRow(pLast + 1);
    tRow.getCell(4).value = "TOTAL";
    tRow.getCell(15).value = { formula: `SUM(O${P0}:O${pLast})`, result: Math.round(pr.reduce((a, r) => a + r.nilaiPR, 0)) };
    tRow.getCell(15).numFmt = RP;
    [4, 15].forEach((c) => (tRow.getCell(c).font = { bold: true }));
    tRow.getCell(1).value = { formula: `COUNTA(C${P0}:C${pLast})&" item"`, result: `${pr.length} item` };
    [5, 9, 5, 34, 8, 13, 11, 11, 9, 11, 11, 10, 11, 12, 15, 10, 26, 10].forEach((w, i) => (wsPR.getColumn(i + 1).width = w));
    wsPR.views = [{ state: "frozen", xSplit: 4, ySplit: 4 }];
    if (pr.length) wsPR.autoFilter = { from: { row: 4, column: 1 }, to: { row: pLast, column: HP.length } };
    wsPR.addConditionalFormatting({ ref: `B${P0}:B${pLast}`, rules: Object.keys(STATUS_FILL).map((st, i) => ({ type: "expression", priority: i + 1, formulae: [`$B${P0}="${st}"`], style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: STATUS_FILL[st] } } } })) });
    wsPR.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };

    // ---------------- Stok Zahir ----------------
    title(wsZ, "Stok Zahir (hasil baca file, semua gudang)", `File: ${meta.fileName || "-"} · SHA-256 ${meta.fileHash || "-"}`);
    const HZ = ["Jalur grup", "Induk", "Gudang", "Kategori", "Kode", "Nama", "Jumlah", "Satuan", "Mata uang", "Harga satuan", "Total", "Baris file"];
    const hz = wsZ.getRow(4); HZ.forEach((h, i) => (hz.getCell(i + 1).value = h)); styleHeader(hz, 1, HZ.length);
    const Z0 = 5;
    zahir.items.forEach((it, i) => {
      const row = wsZ.getRow(Z0 + i);
      [it.pathStr, it.induk, it.gudang, it.kategori, it.kode, it.nama, it.qty, it.satuan, it.mataUang, it.harga, it.total, it.row].forEach((val, c) => (row.getCell(c + 1).value = val));
      row.getCell(7).numFmt = fmtQty(it.qty); row.getCell(10).numFmt = "#,##0.00"; row.getCell(11).numFmt = "#,##0.00";
    });
    const zLast = Z0 + Math.max(zahir.items.length, 1) - 1;
    [44, 12, 14, 26, 12, 36, 12, 9, 9, 13, 16, 9].forEach((w, i) => (wsZ.getColumn(i + 1).width = w));
    wsZ.views = [{ state: "frozen", ySplit: 4 }];
    wsZ.autoFilter = { from: { row: 4, column: 1 }, to: { row: zLast, column: HZ.length } };

    // ---------------- Ringkasan ----------------
    title(wsR, "Rekomendasi Pembelian Gudang", [meta.company, meta.gudangLabel].filter(Boolean).join(" · "));
    const kv = (r, k, val, fmt) => { wsR.getCell(`B${r}`).value = k; wsR.getCell(`C${r}`).value = val; wsR.getCell(`B${r}`).font = { color: { argb: MUTED } }; if (fmt) wsR.getCell(`C${r}`).numFmt = fmt; };
    const section = (r, text) => { const c = wsR.getCell(`B${r}`); c.value = text; c.font = { bold: true, color: { argb: NAVY }, size: 11 }; wsR.getCell(`B${r}`).border = { bottom: { style: "thin", color: { argb: NAVY } } }; };
    section(4, "Informasi");
    kv(5, "Gudang", meta.gudangLabel || "");
    kv(6, "Tanggal stok", meta.stockDate || "");
    kv(7, "Disusun oleh", meta.preparedBy || "");
    kv(8, "Dibuat", meta.generatedAt ? new Date(meta.generatedAt).toLocaleString("id-ID") : "");
    kv(9, "File Zahir", meta.fileName || "");
    kv(10, "SHA-256 file", meta.fileHash || "");
    kv(11, "Sumber parameter", meta.masterSource || "");
    kv(12, "Parameter dimuat", meta.masterLoadedAt ? new Date(meta.masterLoadedAt).toLocaleString("id-ID") : "");
    kv(13, "Jumlah item dihitung", rows.length, "#,##0");
    section(15, "Parameter global (boleh diubah, kuning)");
    kv(16, "Siklus order default (hari) — dipakai bila master tidak punya kolom Siklus", s.cycleDays);
    kv(17, "Batas overstock (DSI, hari)", s.overstockDays);
    kv(18, "Batas band Min (DSI <)", s.dsiMin);
    kv(19, "Batas band Safety (DSI <)", s.dsiSafety);
    [16, 17, 18, 19].forEach((r) => inputCell(wsR.getCell(`C${r}`)));
    kv(20, "Pembulatan otomatis Gram/Ml", s.roundGramMl ? `Ke atas kelipatan ${s.roundStep} (bila kolom Kelipatan di master kosong)` : "Tidak");
    kv(21, "Sumber harga", s.priceSource === "zahir" ? "Harga Zahir (HPP rata-rata), cadangan: master" : "Harga master (harga terakhir), cadangan: Zahir");

    section(23, "Hasil");
    const k = result.kpi;
    const kpiRows = [
      ["Item perlu order (Final PR > 0)", { formula: `COUNTIF(${RC("U")},">0")`, result: k.prCount }, "#,##0"],
      ["Nilai PR", { formula: `SUM(${RC("X")})`, result: k.prValue }, RP],
      ["Stok habis (OOS)", { formula: `COUNTIF(${RC("Z")},"OOS")`, result: k.oos }, "#,##0"],
      ["Kritis (DSI ≤ lead time)", { formula: `COUNTIF(${RC("Z")},"Kritis")`, result: k.kritis }, "#,##0"],
      ["Order (posisi ≤ ROP)", { formula: `COUNTIF(${RC("Z")},"Order")`, result: k.order }, "#,##0"],
      ["Overstock (item)", { formula: `COUNTIF(${RC("Z")},"Overstock")`, result: k.over }, "#,##0"],
      ["Overstock (nilai stok)", { formula: `SUMIF(${RC("Z")},"Overstock",${RC("Y")})`, result: k.overValue }, RP],
      ["Tidak bergerak (item)", { formula: `COUNTIF(${RC("Z")},"Tidak bergerak")`, result: k.dead }, "#,##0"],
      ["Tidak bergerak (nilai stok)", { formula: `SUMIF(${RC("Z")},"Tidak bergerak",${RC("Y")})`, result: k.deadValue }, RP],
      ["Tanpa parameter, ada stok (item)", { formula: `COUNTIFS(${RC("Z")},"Tanpa parameter",${RC("K")},">0")`, result: k.noParamStock }, "#,##0"],
      ["Tanpa parameter, ada stok (nilai)", { formula: `SUMIFS(${RC("Y")},${RC("Z")},"Tanpa parameter")`, result: k.noParamValue }, RP],
      ["Nilai stok gudang", { formula: `SUM(${RC("Y")})`, result: k.stockValue }, RP],
      ["% nilai stok overstock + tidak bergerak", { formula: `IFERROR((C30+C32)/C35,0)`, result: k.stockValue ? (k.overValue + k.deadValue) / k.stockValue : 0 }, "0.0%"],
    ];
    kpiRows.forEach(([label, val, fmt], i) => { kv(24 + i, label, val, fmt); wsR.getCell(`C${24 + i}`).font = { bold: true, color: { argb: INK } }; });

    let rr = 24 + kpiRows.length + 1;
    section(rr, "Nilai PR per kategori"); rr++;
    const hb = wsR.getRow(rr); ["", "Kategori", "Item PR", "Nilai PR"].forEach((h, i) => { if (i) hb.getCell(i + 1).value = h; }); styleHeader(hb, 2, 4); hb.height = 20; rr++;
    const brands = Array.from(new Set(result.rows.filter((r) => r.hasParam).map((r) => r.brand || ""))).sort();
    for (const b of brands) {
      wsR.getCell(`B${rr}`).value = b || "(kosong)";
      wsR.getCell(`C${rr}`).value = { formula: `COUNTIFS(${RC("E")},"${esc(b)}",${RC("U")},">0")`, result: result.rows.filter((r) => (r.brand || "") === b && r.final > 0).length };
      wsR.getCell(`D${rr}`).value = { formula: `SUMIFS(${RC("X")},${RC("E")},"${esc(b)}")`, result: Math.round(result.rows.filter((r) => (r.brand || "") === b).reduce((a, r) => a + r.nilaiPR, 0)) };
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
    title(wsL, "Log perubahan manual", "Setiap perubahan Final PR, PO outstanding, dan catatan di aplikasi.");
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
    const H = ["Kode Barang", "Nama", "Satuan", "Kategori", "Penjualan 1 Hari", "Buffer Stock (Hari)", "Lead Time (Hari)", "Siklus Order (Hari)", "Minimum Order", "Kelipatan Order", "Harga", "PO Outstanding", "Aktif", "Supplier"];
    const hr = ws.getRow(1); H.forEach((h, i) => (hr.getCell(i + 1).value = h)); styleHeader(hr, 1, H.length);
    const items = (master && master.items) || [];
    items.forEach((m, i) => {
      const row = ws.getRow(2 + i);
      [m.kode, m.nama, m.satuan, m.brand, m.usage, m.buffer, m.lead, m.cycle, m.moq, m.kelipatan, m.harga, m.onOrder, m.aktif === false ? "Tidak" : "Ya", m.supplier || ""].forEach((v, c) => (row.getCell(c + 1).value = v == null ? null : v));
    });
    ws.getColumn(1).numFmt = "@";
    [14, 34, 9, 16, 14, 14, 13, 14, 13, 13, 12, 13, 8, 24].forEach((w, i) => (ws.getColumn(i + 1).width = w));
    ws.views = [{ state: "frozen", ySplit: 1, xSplit: 2 }];
    const n = Math.max(items.length + 1, 200);
    for (const c of ["E", "F", "G", "H", "I", "J", "K", "L"]) ws.dataValidations.add(`${c}2:${c}${n}`, { type: "decimal", operator: "greaterThanOrEqual", allowBlank: true, formulae: [0], showErrorMessage: true, error: "Isi angka ≥ 0." });
    ws.dataValidations.add(`M2:M${n}`, { type: "list", allowBlank: true, formulae: ['"Ya,Tidak"'] });
    const info = wb.addWorksheet("Petunjuk");
    [
      ["Kolom wajib", "Kode Barang, Penjualan 1 Hari, Buffer Stock (Hari), Lead Time (Hari)."],
      ["Penjualan 1 Hari", "Rata-rata pemakaian per hari dalam SATUAN ZAHIR (gram, pcs, liter, ...)."],
      ["Buffer Stock (Hari)", "Safety stock dalam hari pemakaian."],
      ["Lead Time (Hari)", "Hari dari PR dibuat sampai barang diterima gudang."],
      ["Siklus Order (Hari)", "Jarak antar order rutin. Kosong = pakai nilai default aplikasi (0 = sama dengan sheet lama)."],
      ["Minimum Order", "MOQ supplier. Final PR tidak akan di bawah angka ini."],
      ["Kelipatan Order", "Isi per kemasan (mis. 1 sak = 50000 gram). Final PR dibulatkan ke atas ke kelipatan ini."],
      ["Harga", "Harga beli terakhir. Kosong = pakai harga satuan di file Zahir."],
      ["PO Outstanding", "Qty sudah dipesan tetapi belum diterima. Mengurangi Saran PR."],
      ["Aktif", "Tidak = barang tidak dihitung."],
      ["Supplier", "Nama supplier utama. Dipakai untuk memisah Cetak PO per supplier."],
    ].forEach((r, i) => { info.getCell(`A${i + 1}`).value = r[0]; info.getCell(`B${i + 1}`).value = r[1]; info.getCell(`A${i + 1}`).font = { bold: true }; });
    info.getColumn(1).width = 22; info.getColumn(2).width = 100;
    return wb;
  }

  return { buildWorkbook, buildMasterTemplate };
});
