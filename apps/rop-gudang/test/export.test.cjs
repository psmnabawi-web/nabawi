// Tes export Excel: node --test test/export.test.cjs
// 1) struktur & rumus workbook (ExcelJS di Node, file vendor yang sama dengan browser)
// 2) bila LibreOffice ada: workbook ditulis TANPA nilai cache, dihitung ulang oleh LibreOffice, lalu hasil rumus
//    dibandingkan dengan hasil hitung aplikasi. Ini memastikan rumus Excel = logika aplikasi.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync, spawnSync } = require("child_process");
const ExcelJS = require("../public/vendor/exceljs.min.js");
const C = require("../public/rop-core.js");
const X = require("../public/excel-export.js");

const FX = (f) => path.join(__dirname, "fixtures", f);
const z = C.parseZahir(C.textToRows(C.decodeText(fs.readFileSync(FX("zahir-contoh.xls")))));
const m = C.parseMaster(C.textToRows(fs.readFileSync(FX("master-contoh.csv"), "utf8")), { localeHint: "id" });
const MAIN = "GUDANG PUSAT › GUDANG PUSAT";
const edits = { final: { K002: 600 }, note: { K002: "naik karena promo" } };
const result = C.compute({ stockItems: C.aggregateStock(z.items, [MAIN]), master: m, edits });
const log = [{ t: Date.UTC(2026, 10, 16, 3), code: "K002", kode: "K002", nama: "Plastik Uji", field: "Final PR", from: 500, to: 600, system: 500, by: "Tes" }];
const meta = { gudangLabel: "GUDANG PUSAT", company: "PT. Contoh Usaha", stockDate: "16/11/2026", preparedBy: "Tes", generatedAt: Date.UTC(2026, 10, 16, 3), fileName: "zahir-contoh.xls", fileHash: "abc123", gudangKeys: [MAIN], masterSource: "fixture", masterLoadedAt: Date.UTC(2026, 10, 16, 2) };
const build = () => X.buildWorkbook(ExcelJS, { result, zahir: z, meta, log, prioritySort: C.prioritySort });
const OUT = path.join(__dirname, "out");
fs.mkdirSync(OUT, { recursive: true });

async function roundTrip(wb) {
  const buf = await wb.xlsx.writeBuffer();
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(buf);
  return { wb2, buf };
}
const rowOf = (ws, code, col = 2, from = 6) => { for (let r = from; r <= ws.rowCount; r++) if (ws.getCell(r, col).value === code) return r; return -1; };

test("workbook: sheet, header, rumus inti, input & override manual", async () => {
  const { wb2, buf } = await roundTrip(build());
  fs.writeFileSync(path.join(OUT, "export-contoh.xlsx"), Buffer.from(buf));
  assert.deepEqual(wb2.worksheets.map((w) => w.name), ["Ringkasan", "PR", "Perhitungan", "Data Issue", "Stok Zahir", "Log Perubahan"]);
  const ws = wb2.getWorksheet("Perhitungan");
  assert.equal(ws.getCell("B5").value, "Kode"); assert.equal(ws.getCell("AA5").value, "Status"); assert.equal(ws.getCell("AF5").value, "Supplier");
  const r = rowOf(ws, "A003");
  assert.ok(r > 5);
  assert.equal(ws.getCell(`M${r}`).formula, `G${r}*(H${r}+I${r})`); // ROP
  assert.equal(ws.getCell(`P${r}`).formula, `IF(AND(N(G${r})>0,MAX(K${r},0)<=M${r},MAX(K${r},0)<N${r}),N${r}-MAX(K${r},0),0)`); // Saran PR
  assert.equal(ws.getCell(`Q${r}`).formula, `IF(P${r}>0,CEILING(P${r},IF(N(T${r})>0,T${r},1)),0)`); // Kebutuhan
  assert.equal(ws.getCell(`U${r}`).formula, `IF(Q${r}>0,IF(MAX(N(R${r}),Q${r})-Q${r}<=Ringkasan!$C$20*N(G${r}),MAX(N(R${r}),Q${r}),Q${r}),0)`); // Final PR
  assert.equal(ws.getCell("Q5").value, "Kebutuhan (dibulatkan kemasan)"); assert.equal(ws.getCell("AM5").value, "Aturan MOQ");
  assert.equal(ws.getCell(`J${r}`).formula, "Ringkasan!$C$16"); // target DSI default dirujuk ke sel parameter global
  assert.equal(ws.getCell(`J5`).value, "Target DSI (hari)");
  assert.equal(ws.getCell(`N${r}`).formula, `G${r}*IF(N(J${r})=0,H${r}+I${r},MAX(H${r}+1,2*J${r}-H${r})+I${r})`); // Stok maksimum
  assert.equal(ws.getCell(`AJ5`).value, "Stok fisik maks");
  assert.equal(ws.getCell(`AG5`).value, "Rincian SOH per gudang");
  assert.match(ws.getCell(`K${r}`).formula, /^SUMIFS\('Stok Zahir'!\$G\$5:\$G\$\d+,'Stok Zahir'!\$M\$5:\$M\$\d+,"A003",'Stok Zahir'!\$L\$5:\$L\$\d+,"Ya"\)$/);
  const headers = []; ws.getRow(5).eachCell((c) => headers.push(String(c.value)));
  assert.ok(!headers.some((h) => /outstanding|posisi/i.test(h)), "kolom PO outstanding/posisi sudah dihapus");
  const k2 = rowOf(ws, "K002");
  assert.equal(ws.getCell(`U${k2}`).value, 600); // override = nilai, bukan rumus
  assert.match(ws.getCell(`U${k2}`).note.texts ? ws.getCell(`U${k2}`).note.texts.map((t) => t.text).join("") : String(ws.getCell(`U${k2}`).note), /Rekomendasi sistem: 500/);
  assert.equal(ws.getCell(`AD${k2}`).value, "naik karena promo");
  const k3 = rowOf(ws, "K003");
  assert.equal(ws.getCell(`G${k3}`).value, null); // tanpa parameter → input kosong
  assert.equal(ws.getCell(`AA${k3}`).result, "Tanpa parameter");
  assert.ok(ws.views[0].state === "frozen");
  const dv = ws.getCell(`G${r}`).dataValidation || {};
  assert.equal(dv.type, "decimal"); assert.equal(dv.operator, "greaterThanOrEqual");

  // Urutan PR: OOS (DSI sama 0 → nilai PR terbesar dulu) → Kritis → Order
  const pr = wb2.getWorksheet("PR");
  const prCodes = []; for (let i = 5; i < 5 + result.kpi.prCount; i++) prCodes.push(pr.getCell(`C${i}`).value);
  assert.deepEqual(prCodes, ["A004", "K009", "A002", "K002", "A003", "A001"]);
  assert.equal(pr.getCell(`D${5 + result.kpi.prCount}`).value, "TOTAL");
  assert.equal(pr.getCell("L4").value, "Final PR");
  assert.match(pr.getCell("L5").formula, /^IFERROR\(INDEX\(Perhitungan!\$U\$6:\$U\$\d+,\$S5\),""\)$/);
  assert.match(pr.getCell("S5").formula, /^MATCH\(\$C5,Perhitungan!\$B\$6:\$B\$\d+,0\)$/);
  assert.equal(pr.getCell("J4").value, "Kebutuhan"); assert.equal(pr.getCell("M4").value, "Lebih dari kebutuhan");

  const rs = wb2.getWorksheet("Ringkasan");
  const kr = (label) => { for (let i = 24; i < 60; i++) if (String(rs.getCell(`B${i}`).value || "").startsWith(label)) return i; return -1; };
  assert.equal(rs.getCell("C16").value, 3);
  assert.equal(rs.getCell(`C${kr("Target DSI (hari)")}`).formula, "Ringkasan!$C$16");
  const ip = kr("Item perlu order");
  assert.match(rs.getCell(`C${ip}`).formula, /^COUNTIF\(Perhitungan!\$U\$6:\$U\$\d+,">0"\)$/);
  assert.equal(rs.getCell("C20").value, 2); // batas kelebihan MOQ (hari)
  assert.equal(rs.getCell(`C${ip}`).result, result.kpi.prCount);
  assert.equal(rs.getCell(`C${kr("Nilai PR")}`).result, result.kpi.prValue);
  assert.equal(rs.getCell(`C${kr("DSI gudang aktual")}`).result, result.kpi.dsiActual);

  const iss = wb2.getWorksheet("Data Issue");
  assert.equal(iss.getCell("B5").value, "Tinggi");
  const lg = wb2.getWorksheet("Log Perubahan");
  assert.equal(lg.getCell("B5").value, "K002"); assert.equal(lg.getCell("F5").value, 600);
  const zs = wb2.getWorksheet("Stok Zahir");
  assert.equal(zs.getCell("A5").value, "GUDANG PUSAT › GUDANG PUSAT › Bahan Baku");
});

test("template master bisa dibaca balik oleh parseMaster", async () => {
  const { wb2 } = await roundTrip(X.buildMasterTemplate(ExcelJS, m));
  const ws = wb2.getWorksheet("Master Parameter");
  const rows = [];
  ws.eachRow({ includeEmpty: true }, (row, rn) => { const a = []; row.eachCell({ includeEmpty: true }, (c, cn) => (a[cn - 1] = c.value == null ? "" : c.value)); rows[rn - 1] = Array.from(a, (x) => (x == null ? "" : x)); });
  const m2 = C.parseMaster(Array.from(rows, (r) => r || []));
  assert.equal(m2.ok, true, m2.error);
  assert.equal(m2.items.length, m.items.length);
  assert.equal(m2.byCode.A001.usage, 1250); assert.equal(m2.byCode.A001.moq, 10000); assert.equal(m2.byCode.K002.harga, 95.5);
  assert.equal(m2.hasColumn.kelipatan, true); assert.equal(m2.hasColumn.target, true);
  assert.equal(m2.byCode.A001.supplier, "CV Tepung Jaya");
});

const hasLO = spawnSync("soffice", ["--version"]).status === 0;
test("rumus Excel dihitung ulang LibreOffice = hasil aplikasi", { skip: !hasLO && "LibreOffice tidak terpasang" }, async () => {
  const wb = build();
  wb.eachSheet((ws) => ws.eachRow((row) => row.eachCell((cell) => { const v = cell.value; if (v && typeof v === "object" && v.formula) cell.value = { formula: v.formula }; })));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rop-lo-"));
  const src = path.join(dir, "nocache.xlsx");
  fs.writeFileSync(src, Buffer.from(await wb.xlsx.writeBuffer()));
  execFileSync("soffice", [`-env:UserInstallation=file://${dir}/profile`, "--headless", "--convert-to", 'csv:Text - txt - csv (StarCalc):44,34,76,1,,1033,false,true,false,false,false,-1', "--outdir", dir, src], { stdio: "pipe", timeout: 120000 });
  const csv = (sheet) => C.textToRows(fs.readFileSync(path.join(dir, `nocache-${sheet}.csv`), "utf8"));
  const calc = csv("Perhitungan");
  const H = calc[4];
  const idx = (h) => H.indexOf(h);
  let checked = 0;
  for (const row of calc.slice(5)) {
    const kode = row[1]; if (!kode) continue;
    const r = result.rows.find((x) => x.kode === kode);
    assert.ok(r, "kode " + kode);
    const n = (h) => Number(row[idx(h)] || 0);
    assert.equal(n("SOH Zahir"), r.sohRaw, `${kode} SOH`);
    assert.equal(n("Kebutuhan (dibulatkan kemasan)"), r.need || 0, `${kode} Kebutuhan`);
    assert.equal(n("Lebih dari kebutuhan"), r.overNeed || 0, `${kode} Lebih`);
    assert.equal(row[idx("Aturan MOQ")] || "", r.moqRule || "", `${kode} Aturan MOQ`);
    assert.equal(n("ROP"), r.rop || 0, `${kode} ROP`);
    assert.equal(n("Stok maksimum"), r.max || 0, `${kode} Stok maksimum`);
    if (r.hasParam) assert.equal(n("Kelebihan di atas stok fisik maks"), r.excess, `${kode} kelebihan`);
    if (r.usage > 0) { assert.equal(n("Stok fisik maks"), r.physMax, `${kode} stok fisik maks`); assert.ok(Math.abs(n("Rata-rata stok fisik (hari)") - r.avgDays) < 1e-9, `${kode} rata-rata`); }
    assert.equal(n("Saran PR"), r.saran, `${kode} Saran PR`);
    assert.equal(n("Final PR"), r.final, `${kode} Final PR`);
    assert.equal(Math.round(n("Nilai PR")), Math.round(r.nilaiPR), `${kode} Nilai PR`);
    assert.equal(row[idx("Status")], r.status, `${kode} Status`);
    assert.equal(row[idx("Band DSI (sheet lama)")], r.band || "", `${kode} Band`);
    if (r.dsi != null) assert.ok(Math.abs(n("DSI (hari)") - r.dsi) < 1e-6, `${kode} DSI`);
    checked++;
  }
  assert.equal(checked, result.rows.length);
  const ring = csv("Ringkasan");
  const val = (label) => { const row = ring.find((x) => String(x[1]).startsWith(label)); return row ? row[2] : undefined; };
  assert.equal(Number(val("Item perlu order (Final PR > 0)")), result.kpi.prCount);
  assert.equal(Math.round(Number(val("Nilai PR"))), result.kpi.prValue);
  assert.equal(Number(val("Stok habis (OOS)")), result.kpi.oos);
  assert.equal(Math.round(Number(val("Overstock (nilai stok)"))), result.kpi.overValue);
  assert.equal(Math.round(Number(val("Kebutuhan riil"))), result.kpi.needValue);
  assert.equal(Math.round(Number(val("PR lebih dari kebutuhan"))), result.kpi.overNeedValue);
  assert.equal(Number(val("MOQ ditahan")), result.kpi.moqHeldCount);
  assert.ok(Math.abs(Number(val("DSI gudang aktual")) - result.kpi.dsiActual) < 0.006, "DSI aktual " + val("DSI gudang aktual"));
  assert.ok(Math.abs(Number(val("DSI desain parameter")) - result.kpi.dsiDesign) < 0.006, "DSI desain " + val("DSI desain parameter"));
  assert.ok(Math.abs(Number(val("DSI bila kelebihan")) - result.kpi.dsiNoExcess) < 0.006, "DSI tanpa kelebihan " + val("DSI bila kelebihan"));
  assert.equal(Math.round(Number(val("Kelebihan stok di atas target"))), result.kpi.excessValue);
  assert.equal(Number(val("Di atas target, barang bergerak")), result.kpi.excessCount);
  const recRows = ring.filter((x) => x[9] === "Cocok" || x[9] === "SELISIH");
  assert.equal(recRows.length, z.recon.length);
  assert.ok(recRows.every((x) => x[9] === "Cocok"), JSON.stringify(recRows));
  const prs = csv("PR");
  const prTotal = prs.find((x) => x[3] === "TOTAL");
  assert.equal(Math.round(Number(prTotal[14])), result.kpi.prValue);
  assert.equal(prs[4][12] !== undefined, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("SOH gabungan SCM + Produksi dihitung ulang LibreOffice dari sheet Stok Zahir", { skip: !hasLO && "LibreOffice tidak terpasang" }, async () => {
  const zg = C.parseZahir(C.textToRows(C.decodeText(fs.readFileSync(FX("zahir-gabungan-contoh.xls")))));
  const keys = [MAIN, "Head Quarter › PRODUKSI"];
  const res = C.compute({ stockItems: C.aggregateStock(zg.items, keys), master: m });
  const wb = X.buildWorkbook(ExcelJS, { result: res, zahir: zg, meta: { ...meta, gudangLabel: "GUDANG PUSAT + PRODUKSI", gudangKeys: keys }, log: [], prioritySort: C.prioritySort });
  const zs = wb.getWorksheet("Stok Zahir");
  const dihitung = []; for (let i = 5; i < 5 + zg.items.length; i++) dihitung.push(zs.getCell(`L${i}`).value);
  assert.equal(dihitung.filter((x) => x === "Ya").length, 11); // 8 gudang + 3 produksi; Sales = Tidak
  wb.eachSheet((ws) => ws.eachRow((row) => row.eachCell((cell) => { const v = cell.value; if (v && typeof v === "object" && v.formula) cell.value = { formula: v.formula }; })));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rop-lo2-"));
  const src = path.join(dir, "gab.xlsx");
  fs.writeFileSync(src, Buffer.from(await wb.xlsx.writeBuffer()));
  execFileSync("soffice", [`-env:UserInstallation=file://${dir}/profile`, "--headless", "--convert-to", 'csv:Text - txt - csv (StarCalc):44,34,76,1,,1033,false,true,false,false,false,-1', "--outdir", dir, src], { stdio: "pipe", timeout: 120000 });
  const calc = C.textToRows(fs.readFileSync(path.join(dir, "gab-Perhitungan.csv"), "utf8"));
  const H = calc[4], ix = (h) => H.indexOf(h);
  let n = 0;
  for (const row of calc.slice(5)) {
    if (!row[1]) continue;
    const r = res.rows.find((x) => x.kode === row[1]);
    assert.equal(Number(row[ix("SOH Zahir")] || 0), r.sohRaw, `${row[1]} SOH`);
    assert.equal(Number(row[ix("Final PR")] || 0), r.final, `${row[1]} Final PR`);
    assert.equal(row[ix("Status")], r.status, `${row[1]} Status`);
    n++;
  }
  assert.equal(n, res.rows.length);
  assert.equal(Number(calc.slice(5).find((x) => x[1] === "A002")[ix("SOH Zahir")]), 300);
  fs.rmSync(dir, { recursive: true, force: true });
});
