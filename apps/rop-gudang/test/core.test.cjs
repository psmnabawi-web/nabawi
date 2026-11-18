// Tes logika inti: node --test test/core.test.cjs
// Fixture sintetis (bukan data perusahaan): test/fixtures/zahir-contoh.xls (format export Zahir) & master-contoh.csv (format export tab PKU).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const C = require("../public/rop-core.js");

const FX = (f) => path.join(__dirname, "fixtures", f);
const zahirBytes = fs.readFileSync(FX("zahir-contoh.xls"));
const masterText = fs.readFileSync(FX("master-contoh.csv"), "utf8");
const parseZ = (bytes) => C.parseZahir(C.textToRows(C.decodeText(bytes)));
const master = () => C.parseMaster(C.textToRows(masterText), { localeHint: "id" });
const MAIN = "GUDANG PUSAT › GUDANG PUSAT";
const run = (settings, edits) => {
  const z = parseZ(zahirBytes);
  return C.compute({ stockItems: z.items.filter((i) => i.gkey === MAIN), master: master(), settings, edits });
};
const byCode = (res, code) => res.rows.find((r) => r.code === code);

test("parseNum: format EN (Zahir) dan ID (Google Sheet)", () => {
  assert.equal(C.parseNum("1,504.17", "en"), 1504.17);
  assert.equal(C.parseNum("126,976.92", "en"), 126976.92);
  assert.equal(C.parseNum("28.22", "en"), 28.22);
  assert.equal(C.parseNum("1.733", "id"), 1733);
  assert.equal(C.parseNum("1.733", "en"), 1.733);
  assert.equal(C.parseNum("22,0", "id"), 22);
  assert.equal(C.parseNum("13.889.958", "id"), 13889958);
  assert.equal(C.parseNum("26.263.644,13", "id"), 26263644.13);
  assert.equal(C.parseNum("-40,000.00", "en"), -40000);
  assert.equal(C.parseNum("(1,000.00)", "en"), -1000);
  assert.equal(C.parseNum("", "en"), null);
  assert.equal(C.parseNum("abc", "en"), null);
  assert.equal(C.parseNum(12.5), 12.5);
  assert.equal(C.detectLocale(["1,504.17", "28.22", "4500"]), "en");
  assert.equal(C.detectLocale(["22,0", "1.733", "95,5"]), "id");
});

test("sniff & baca teks: file Zahir .xls sebenarnya teks bertab", () => {
  assert.equal(C.sniff(zahirBytes), "text");
  assert.equal(C.sniff(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 1, 2])), "ole");
  assert.equal(C.sniff(Buffer.from("PK\x03\x04xx")), "zip");
  assert.equal(C.sniff(Buffer.from("  <html><table>")), "html");
  assert.equal(C.sniff(Buffer.from('<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet">')), "xml2003");
  const rows = C.textToRows(C.decodeText(zahirBytes));
  assert.deepEqual(rows[6].slice(0, 3), ["Kode Produk", "Nama Produk", "Jumlah"]);
  const csv = C.textToRows('a,"b ""q"", c",d\n1,"x\ny",2\n');
  assert.deepEqual(csv[0], ["a", 'b "q", c', "d"]);
  assert.deepEqual(csv[1], ["1", "x\ny", "2"]);
  assert.equal(C.decodeText(Buffer.from([0x43, 0x61, 0x66, 0xe9])), "Café"); // windows-1252
});

test("parseZahir: gudang bersarang, kategori, rekonsiliasi subtotal", () => {
  const z = parseZ(zahirBytes);
  assert.equal(z.meta.company, "PT. Contoh Usaha");
  assert.equal(z.meta.title, "DAFTAR PRODUK PER GUDANG");
  assert.equal(z.items.length, 9);
  assert.deepEqual(z.gudangs.map((g) => [g.key, g.name, g.induk, g.items]), [[MAIN, "GUDANG PUSAT", "GUDANG PUSAT", 8], ["GUDANG PUSAT › Sales", "Sales", "GUDANG PUSAT", 1]]);
  const a1 = z.items.find((i) => i.code === "A001");
  assert.equal(a1.kategori, "Bahan Baku"); assert.equal(a1.gudang, "GUDANG PUSAT");
  assert.equal(a1.qty, 5000); assert.equal(a1.harga, 10); assert.equal(a1.total, 50000);
  assert.equal(a1.pathStr, "GUDANG PUSAT › GUDANG PUSAT › Bahan Baku");
  assert.equal(z.items.find((i) => i.code === "A004").qty, -2);
  assert.equal(z.recon.length, 6);
  assert.ok(z.recon.every((r) => r.ok), JSON.stringify(z.recon.filter((r) => !r.ok)));
  const grand = z.recon.find((r) => r.depth === 0);
  assert.equal(grand.qtyFile, 7558); assert.equal(grand.valCalc, 1011000);
  assert.deepEqual(z.warnings, []); assert.deepEqual(z.unparsed, []); assert.deepEqual(z.duplicates, []);
});

test("parseZahir: file diedit (angka berubah) → subtotal tidak cocok", () => {
  const tampered = Buffer.from(zahirBytes.toString("utf8").replace("A001\tTepung Uji\t5000", "A001\tTepung Uji\t6000"));
  const z = parseZ(tampered);
  const bad = z.recon.filter((r) => !r.ok).map((r) => r.name);
  assert.ok(bad.includes("Bahan Baku") && bad.includes("GUDANG PUSAT"), bad.join(","));
});

test("parseZahir: dari baris array (hasil xlsx) dengan angka bertipe number", () => {
  const rows = [["PT X"], ["DAFTAR PRODUK PER GUDANG"], ["G1"], ["Kode Produk", "Nama Produk", "Jumlah", "Satuan Ukur", "Mata Uang", "Harga Satuan", "Total"], ["Kat"], [12107, "Air", 10, "Pcs", "IDR", 2000, 20000], ["Total Kat", "", 10, "", "", 2000, 20000], ["Total G1", "", 10, "", "", 2000, 20000]];
  const z = C.parseZahir(rows);
  assert.equal(z.items[0].code, "12107"); assert.equal(z.items[0].gudang, "G1"); assert.equal(z.items[0].kategori, "Kat");
  assert.ok(z.recon.every((r) => r.ok));
});

test("parseMaster: header tab PKU, locale ID, kode dinormalisasi, kode ganda & kode kosong", () => {
  const m = master();
  assert.equal(m.ok, true, m.error);
  assert.equal(m.locale, "id");
  assert.equal(m.headerRow, 2);
  assert.equal(m.items.length, 9);
  const a1 = m.byCode.A001;
  assert.equal(a1.usage, 1250); assert.equal(a1.buffer, 2); assert.equal(a1.lead, 2); assert.equal(a1.moq, 10000); assert.equal(a1.harga, 11.5);
  assert.equal(a1.nama, "Tepung Uji"); assert.equal(a1.brand, "Brand X");
  assert.equal(m.byCode.K002.kode, "k 002");
  assert.equal(m.byCode.A004.harga, 21000);
  assert.equal(m.byCode.K002.harga, 95.5);
  assert.equal(m.hasColumn.target, false); assert.equal(m.hasColumn.kelipatan, false);
  const types = m.issues.map((i) => i.type).sort();
  assert.deepEqual(types, ["Baris tanpa kode", "Kode ganda di master"]);
});

test("parseMaster: kolom wajib hilang → error jelas", () => {
  const m = C.parseMaster([["Kode Barang", "Nama", "Penjualan 1 Hari"], ["A", "x", "1"]]);
  assert.equal(m.ok, false);
  assert.match(m.error, /Buffer Stock \(Hari\).*Lead Time \(Hari\)/);
});

test("parseMaster: label header gabungan ala gviz tetap terbaca", () => {
  const rows = [["", "No", "KODE BARANG", "Nama", "Satuan", "Kategori", "Penjualan 1 Hari", "Buffer Stock (Hari)", "Buffer Stok (Jlh)", "Lead Time (Hari)", "13/11/2026 Sisa Stok (Qty)", "Minimum Order Versi Purchasing", "13.889.958 Nilai PR", "Harga"], ["", "1", "X1", "Barang", "Pcs", "B", "5", "2", "10", "1", "0", "12", "0", "1500"]];
  const m = C.parseMaster(rows);
  assert.equal(m.ok, true, m.error);
  assert.equal(m.byCode.X1.moq, 12); assert.equal(m.byCode.X1.harga, 1500); assert.equal(m.byCode.X1.buffer, 2);
});

test("compute (target DSI 0 = sheet lama): ROP, Saran PR, Final PR, status, nilai + pembulatan", () => {
  const r = run({ targetDsi: 0, moqTolDays: 999 }); // target 0 + selalu ikut MOQ = sheet lama
  assert.equal(r.masterFitsGudang, true);
  assert.equal(r.rows.length, 9); // 8 baris Zahir + K009 (ada di master, tidak ada di file)
  const a1 = byCode(r, "A001");
  assert.equal(a1.rop, 5000); assert.equal(a1.pos, 5000); assert.equal(a1.saran, 0); assert.equal(a1.final, 0); assert.equal(a1.status, "Aman");
  const a2 = byCode(r, "A002");
  assert.equal(a2.status, "OOS"); assert.equal(a2.saran, 200); assert.equal(a2.kelipatan, 1000); assert.equal(a2.final, 1000); assert.equal(a2.nilaiPR, 16000); assert.equal(a2.hargaSrc, "Master");
  const a3 = byCode(r, "A003");
  assert.equal(a3.status, "Order"); assert.equal(a3.rop, 400); assert.equal(a3.dsi, 3.75); assert.equal(a3.saran, 100); assert.equal(a3.final, 100); assert.equal(a3.harga, 1500); assert.equal(a3.hargaSrc, "Zahir");
  const a4 = byCode(r, "A004");
  assert.equal(a4.soh, 0); assert.equal(a4.status, "OOS"); assert.equal(a4.saran, 4); assert.equal(a4.final, 5); assert.equal(a4.nilaiPR, 105000);
  assert.ok(a4.issues.includes("Stok negatif di Zahir"));
  assert.equal(byCode(r, "A005").status, "Tidak bergerak");
  const k1 = byCode(r, "11401");
  assert.equal(k1.status, "Overstock"); assert.equal(k1.dsi, 50); assert.ok(k1.issues.includes("Satuan beda"));
  const k2 = byCode(r, "K002");
  assert.equal(k2.status, "Kritis"); assert.equal(k2.saran, 100); assert.equal(k2.final, 500); assert.equal(k2.nilaiPR, 47750);
  const k3 = byCode(r, "K003");
  assert.equal(k3.status, "Tanpa parameter"); assert.equal(k3.final, 0); assert.ok(k3.issues.includes("Tanpa parameter (ada stok)"));
  const k9 = byCode(r, "K009");
  assert.equal(k9.inZahir, false); assert.equal(k9.status, "OOS"); assert.equal(k9.final, 20); assert.ok(k9.issues.includes("Kode master tidak ada di file Zahir"));
  const k = r.kpi;
  assert.equal(k.prCount, 5); assert.equal(k.prValue, 338750);
  assert.equal(k.oos, 3); assert.equal(k.kritis, 1); assert.equal(k.order, 1);
  assert.equal(k.over, 1); assert.equal(k.overValue, 500000);
  assert.equal(k.dead, 1); assert.equal(k.deadValue, 20000);
  assert.equal(k.noParamStock, 1); assert.equal(k.noParamValue, 10000);
  assert.deepEqual(k.byBrand, { "Brand X": 16000, "Brand Y": 322750 });
});

test("compute: tanpa pembulatan = Final PR sama dengan PR sheet lama (dengan MOQ minimum)", () => {
  const r = run({ targetDsi: 0, moqTolDays: 999, roundGramMl: false });
  assert.equal(byCode(r, "A002").final, 200);
  assert.equal(r.kpi.prValue, 338750 - 16000 + 3200);
});

test("compute (default target DSI 3 = rata-rata stok fisik 3 hari)", () => {
  const r = run();
  assert.equal(r.settings.targetDsi, 3);
  const a1 = byCode(r, "A001"); // buffer 2, LT 2 → stok fisik 2–4 hari, rata-rata 3, order tiap ±2 hari
  assert.equal(a1.rop, 5000); assert.equal(a1.physMax, 5000); assert.equal(a1.max, 7500); assert.equal(a1.avgDays, 3); assert.equal(a1.cycleDays, 2);
  assert.equal(a1.saran, 2500); assert.equal(a1.status, "Order");
  assert.equal(a1.need, 3000); // CEILING(2.500; 1.000)
  assert.equal(a1.moqDays, 8); assert.equal(a1.moqExtraIfFollow, 7000);
  assert.equal(a1.moqRule, "MOQ ditahan"); assert.equal(a1.final, 3000); // ikut MOQ menambah 7.000 g = 5,6 hari > batas 2 hari
  assert.ok(a1.issues.includes("MOQ melebihi kebutuhan"));
  const a3 = byCode(r, "A003"); // buffer 2, LT 3
  assert.equal(a3.physMax, 320); assert.equal(a3.max, 560); assert.equal(a3.saran, 260); assert.equal(a3.final, 260);
  assert.equal(byCode(r, "A004").final, 6); assert.equal(byCode(r, "K009").final, 60);
  const k2 = byCode(r, "K002"); // buffer 1 → stok fisik 1–5 hari, rata-rata 3, order tiap ±4 hari
  assert.equal(k2.physMax, 500); assert.equal(k2.max, 700); assert.equal(k2.saran, 500); assert.equal(k2.final, 500); assert.equal(k2.cycleDays, 4); assert.equal(k2.avgDays, 3);
  const k1 = byCode(r, "11401");
  assert.equal(k1.physMax, 80); assert.equal(k1.max, 140); assert.equal(k1.excess, 920); assert.equal(k1.excessValue, 460000); assert.equal(k1.status, "Overstock");
  assert.equal(byCode(r, "A005").excess, 1000);
  const k = r.kpi;
  assert.equal(k.prCount, 6); assert.equal(k.prValue, 674250);
  assert.equal(k.needValue, 674250); assert.equal(k.overNeedValue, 0); assert.equal(k.moqHeldCount, 1); assert.equal(k.moqHeldValue, 80500);
  assert.equal(k.oos, 3); assert.equal(k.kritis, 1); assert.equal(k.order, 2);
  // DSI gudang = nilai stok ÷ nilai pemakaian per hari = 1.046.600 ÷ 186.525
  assert.equal(k.paramStockValue, 1046600); assert.equal(k.usageValue, 186525);
  assert.equal(k.dsiActual, 5.61);
  assert.equal(k.dsiDesign, 3);       // semua item dirancang rata-rata 3 hari
  assert.equal(k.dsiNoExcess, 3.04);  // (1.046.600 − 460.000 − 20.000) ÷ 186.525
  assert.equal(k.excessCount, 1); assert.equal(k.excessValue, 460000);
});

test("compute: status Di atas target, target per item, dan target tidak tercapai", () => {
  const rows = [["Kode Barang", "Nama", "Satuan", "Penjualan 1 Hari", "Buffer Stock (Hari)", "Lead Time (Hari)", "Target DSI (Hari)", "Harga"],
    ["X1", "Kotak", "Pcs", "10", "2", "2", "", "100"],
    ["X2", "Plastik", "Pcs", "10", "10", "14", "", "50"],
    ["X3", "Botol", "Pcs", "10", "1", "1", "5", "20"]];
  const m = C.parseMaster(rows);
  assert.equal(m.ok, true, m.error); assert.equal(m.hasColumn.target, true);
  const stock = [["X1", 150], ["X2", 100], ["X3", 25]].map(([c, q]) => ({ code: c, kode: c, nama: c, qty: q, satuan: "Pcs", harga: 0, kategori: "K", gudang: "W" }));
  const r = C.compute({ stockItems: stock, master: m });
  const x1 = byCode(r, "X1");
  assert.equal(x1.physMax, 40); assert.equal(x1.max, 60); assert.equal(x1.dsi, 15); assert.equal(x1.status, "Di atas target"); assert.equal(x1.excess, 110); assert.equal(x1.excessValue, 11000);
  const x2 = byCode(r, "X2");
  assert.equal(x2.physMax, 110); assert.equal(x2.max, 250); assert.equal(x2.status, "Kritis"); // DSI 10 ≤ lead time 14 assert.ok(x2.issues.includes("Target DSI tidak tercapai"));
  const x3 = byCode(r, "X3");
  assert.equal(x3.targetFromMaster, true); assert.equal(x3.target, 5); assert.equal(x3.physMax, 90); assert.equal(x3.max, 100); assert.equal(x3.avgDays, 5); assert.equal(x3.status, "Aman");
  assert.equal(r.kpi.above, 1); assert.equal(r.kpi.excessValue, 11000);
});

test("compute: edit manual Final PR (PO outstanding tidak dipakai lagi)", () => {
  const r = run({}, { final: { K002: 600 }, onOrder: { A003: 150 } }); // onOrder lama di browser diabaikan
  const k2 = byCode(r, "K002");
  assert.equal(k2.final, 600); assert.equal(k2.finalEdited, true); assert.equal(k2.finalAuto, 500); assert.equal(k2.nilaiPR, 57300);
  const a3 = byCode(r, "A003");
  assert.equal(a3.pos, 300); assert.equal(a3.saran, 260); assert.equal(a3.final, 260); assert.equal(a3.status, "Order");
  assert.equal(a3.onOrder, undefined);
  assert.equal(r.kpi.edited, 1);
  // edit yang sama dengan rekomendasi tidak dihitung "diubah"
  assert.equal(byCode(run({}, { final: { K002: 500 } }), "K002").finalEdited, false);
});

test("compute: kelipatan dari master & kolom target per item", () => {
  const rows = [["Kode Barang", "Nama", "Satuan", "Penjualan 1 Hari", "Buffer Stock (Hari)", "Lead Time (Hari)", "Target DSI (Hari)", "Minimum Order", "Kelipatan Order", "Harga", "PO Outstanding", "Aktif"],
    ["G1", "Gula", "Gram", "15925", "2", "5", "", "50000", "50000", "18", "", "Ya"],
    ["G2", "Garam", "Gram", "100", "2", "2", "10", "", "", "10", "", "Ya"],
    ["G3", "Lama", "Pcs", "10", "1", "1", "", "", "", "", "", "Tidak"]];
  const m = C.parseMaster(rows);
  assert.equal(m.ok, true, m.error);
  const stock = [{ code: "G1", kode: "G1", nama: "Gula", qty: 51960, satuan: "Gram", harga: 18.6, kategori: "BB", gudang: "W" }, { code: "G2", kode: "G2", nama: "Garam", qty: 100, satuan: "Gram", harga: 10, kategori: "BB", gudang: "W" }];
  const r = C.compute({ stockItems: stock, master: m });
  const g1 = byCode(r, "G1");
  assert.equal(g1.rop, 111475); assert.equal(g1.max, 143325); assert.equal(g1.saran, 91365); assert.equal(g1.final, 100000); assert.equal(g1.kelipatanFromMaster, true);
  const g2 = byCode(r, "G2");
  assert.equal(g2.targetFromMaster, true); assert.equal(g2.max, 2000); assert.equal(g2.saran, 1900); assert.equal(g2.final, 2000);
  assert.equal(byCode(r, "G3"), undefined); // tidak aktif → tidak dihitung
});

test("compute: gudang lain (Sales) tidak ditambah item master yang tidak ada di file", () => {
  const z = parseZ(zahirBytes);
  const r = C.compute({ stockItems: z.items.filter((i) => i.gudang === "Sales"), master: master() });
  assert.equal(r.masterFitsGudang, false);
  assert.equal(r.rows.length, 1);
});

test("prioritySort & prText", () => {
  const r = run();
  const pr = r.rows.filter((x) => x.final > 0).sort(C.prioritySort).map((x) => x.code);
  assert.deepEqual(pr.slice(0, 3).sort(), ["A002", "A004", "K009"]);
  assert.deepEqual(pr.slice(3), ["K002", "A003", "A001"]); // Kritis, lalu Order dengan DSI terkecil
  const t = C.prText(r.rows, { gudang: "GUDANG PUSAT", stockDate: "16/11/2026", preparedBy: "Tes" });
  assert.match(t, /Rekomendasi Pembelian GUDANG PUSAT/);
  assert.match(t, /Jumlah item: 6 · Nilai: Rp 674\.250/);
  assert.match(t, /Tepung Uji \(A001\): 3\.000 Gram · Rp 34\.500 · di bawah MOQ 10\.000/);
  assert.match(t, /\*Stok habis \(3\)\*/);
  assert.match(t, /Plastik Uji \(K002\): 500 Pcs/);
});

test("ceilStep & dsiBand", () => {
  assert.equal(C.ceilStep(4832, 1000), 5000);
  assert.equal(C.ceilStep(5000.0000001, 1000), 5000);
  assert.equal(C.ceilStep(0.3, 0.1), 0.3);
  assert.equal(C.ceilStep(7, 0), 7);
  const s = C.DEFAULT_SETTINGS;
  assert.equal(C.dsiBand(3.4, s), "Min ≤3 hari"); assert.equal(C.dsiBand(3.5, s), "Safety 4–6 hari"); assert.equal(C.dsiBand(6.5, s), "Max ≥7 hari"); assert.equal(C.dsiBand(null, s), "");
});

test("Supplier di master, pengelompokan PO, dan konversi Gram→Kg", () => {
  const r = run();
  assert.equal(byCode(r, "A002").supplier, "CV Tepung Jaya");
  assert.equal(byCode(r, "K009").supplier, "");
  const g = C.poGroups(r.rows, "supplier");
  assert.deepEqual(g.map((x) => [x.key, x.items.length, x.missingSupplier]), [["CV Tepung Jaya", 2, false], ["PT Kemasan Uji", 1, false], ["UD Telur Segar", 1, false], ["(Supplier belum diisi)", 2, true]]);
  assert.equal(g[3].total, 126000 + 60000);
  assert.equal(g[1].maxLead, 2);
  const kat = C.poGroups(r.rows, "kategori");
  assert.deepEqual(kat.map((x) => x.key), ["(Tanpa kategori)", "Bahan Baku", "Kemasan"]);
  const one = C.poGroups(r.rows, "satu");
  assert.equal(one.length, 1); assert.equal(one[0].items.length, 6); assert.equal(one[0].total, 674250);
  const a2 = byCode(r, "A002");
  assert.deepEqual(C.poLine(a2, true), { qty: 1, satuan: "Kg", harga: 16000, jumlah: 16000 });
  assert.deepEqual(C.poLine(a2, false), { qty: 1000, satuan: "Gram", harga: 16, jumlah: 16000 });
  assert.deepEqual(C.poLine(byCode(r, "A003"), true), { qty: 260, satuan: "Butir", harga: 1500, jumlah: 390000 });
  assert.equal(C.poNumber("PO/20261116/", 7), "PO/20261116/007");
});

test("satu file berisi dua laporan (SCM + Produksi) & baris Total dobel", () => {
  const z = parseZ(fs.readFileSync(FX("zahir-gabungan-contoh.xls")));
  assert.equal(z.reports, 2);
  assert.equal(z.items.length, 12);
  assert.deepEqual(z.gudangs.map((g) => [g.key, g.items]), [["GUDANG PUSAT › GUDANG PUSAT", 8], ["GUDANG PUSAT › Sales", 1], ["Head Quarter › PRODUKSI", 3]]);
  assert.equal(z.recon.length, 10);
  assert.ok(z.recon.every((r) => r.ok), JSON.stringify(z.recon.filter((r) => !r.ok)));
  assert.equal(z.unparsed.length, 0);
  assert.equal(z.warnings.length, 2); // "Total PRODUKSI" & "Total Head Quarter" yang dobel diabaikan
  assert.ok(z.warnings.every((w) => /tidak punya grup terbuka/.test(w)));
  const p = z.items.find((i) => i.gkey === "Head Quarter › PRODUKSI" && i.code === "A002");
  assert.equal(p.qty, 300); assert.equal(p.induk, "Head Quarter"); assert.equal(p.kategori, "Bahan Baku");
  assert.ok(p.row > 30); // nomor baris asli di file gabungan
  assert.equal(z.meta.company, "PT. Contoh Usaha");
});

test("dua file digabung; gudang yang sama dari dua file tidak dihitung dobel", () => {
  const a = parseZ(zahirBytes), b = parseZ(fs.readFileSync(FX("zahir-produksi-contoh.xls")));
  a.source = "gudang.xls"; b.source = "produksi.xls";
  const m2 = C.mergeZahir([a, b]);
  assert.equal(m2.items.length, 12); assert.equal(m2.gudangs.length, 3); assert.equal(m2.recon.length, 10);
  const twice = C.mergeZahir([a, parseZ(zahirBytes)]);
  assert.equal(twice.items.length, 9);
  assert.equal(twice.warnings.length, 2);
  assert.match(twice.warnings[0], /lebih dari satu file/);
});

test("stok SCM + Produksi dijumlah per kode (SOH, harga tertimbang, rincian per gudang)", () => {
  const z = parseZ(fs.readFileSync(FX("zahir-gabungan-contoh.xls")));
  const st = C.aggregateStock(z.items, ["GUDANG PUSAT › GUDANG PUSAT", "Head Quarter › PRODUKSI"]);
  assert.equal(st.length, 8); // 3 kode Produksi (A002, A003, K002) sudah ada di gudang → dijumlah, bukan baris baru
  const a2 = st.find((x) => x.code === "A002");
  assert.equal(a2.qty, 300); assert.equal(a2.gudang, "GUDANG PUSAT + PRODUKSI"); assert.equal(a2.harga, 16);
  assert.deepEqual(a2.sohBy.map((x) => [x.gudang, x.qty]), [["GUDANG PUSAT", 0], ["PRODUKSI", 300]]);
  const a3 = st.find((x) => x.code === "A003");
  assert.equal(a3.qty, 360); assert.equal(a3.total, 546000); assert.ok(Math.abs(a3.harga - 1516.666667) < 1e-6);
  assert.equal(st.find((x) => x.code === "K002").qty, 250); // Sales (10) tidak dicentang
  const r = C.compute({ stockItems: st, master: master() });
  const A2 = byCode(r, "A002");
  assert.equal(A2.sohRaw, 300); assert.equal(A2.status, "Aman"); assert.equal(A2.final, 0); // sebelumnya OOS & PR 1.000 g
  assert.equal(byCode(r, "A003").final, 200);
  const K2 = byCode(r, "K002");
  assert.equal(K2.sohRaw, 250); assert.equal(K2.status, "Order"); assert.equal(K2.final, 500);
  assert.equal(r.kpi.prCount, 5); assert.equal(r.kpi.prValue, 571583);
  // hanya gudang → sama dengan sebelumnya
  const only = C.compute({ stockItems: C.aggregateStock(z.items, ["GUDANG PUSAT › GUDANG PUSAT"]), master: master() });
  assert.equal(only.kpi.prValue, 674250);
});

test("satuan beda antar gudang ditandai", () => {
  const items = [
    { gkey: "W", gudang: "W", code: "X1", kode: "X1", nama: "Gula", qty: 1000, satuan: "Gram", harga: 15, total: 15000, kategori: "K" },
    { gkey: "P", gudang: "P", code: "X1", kode: "X1", nama: "Gula", qty: 2, satuan: "Kg", harga: 15000, total: 30000, kategori: "K" },
  ];
  const st = C.aggregateStock(items, ["W", "P"]);
  assert.equal(st[0].unitConflict, true);
  const m = C.parseMaster([["Kode Barang", "Satuan", "Penjualan 1 Hari", "Buffer Stock (Hari)", "Lead Time (Hari)"], ["X1", "Gram", "100", "1", "1"]]);
  const r = C.compute({ stockItems: st, master: m });
  assert.ok(byCode(r, "X1").issues.includes("Satuan beda antar gudang"));
});

test("batas kelebihan MOQ: 0 = sesuai kebutuhan, 999 = selalu ikut MOQ, kecil = diikuti", () => {
  const always = run({ moqTolDays: 999 });
  assert.equal(byCode(always, "A001").final, 10000); assert.equal(byCode(always, "A001").moqRule, "MOQ diikuti");
  assert.equal(byCode(always, "A001").overNeed, 7000); assert.equal(always.kpi.prValue, 754750); assert.equal(always.kpi.overNeedValue, 80500);
  const never = run({ moqTolDays: 0 });
  assert.equal(byCode(never, "A001").final, 3000); assert.equal(byCode(never, "A004").final, 6); // A004: MOQ 5 < kebutuhan 6
  // legacy: target 0 → A004 kebutuhan 4, MOQ 5: tambah 1 Liter = 1 hari ≤ 2 → diikuti; K002 kebutuhan 100, MOQ 500: tambah 4 hari → ditahan
  const legacy = run({ targetDsi: 0 });
  assert.equal(byCode(legacy, "A004").final, 5); assert.equal(byCode(legacy, "A004").moqRule, "MOQ diikuti");
  assert.equal(byCode(legacy, "K002").final, 100); assert.equal(byCode(legacy, "K002").moqRule, "MOQ ditahan");
  // edit manual di atas kebutuhan ikut terhitung "lebih dari kebutuhan"
  const ed = run({}, { final: { A003: 400 } });
  assert.equal(byCode(ed, "A003").overNeed, 140); assert.equal(ed.kpi.overNeedCount, 1);
  assert.equal(byCode(run(), "A001").moqSuggest, 3000); // MOQ wajar = 1 siklus order (2 hari × 1.250) dibulatkan 1.000
});
