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
const edits = { final: { K002: 600 }, onOrder: { A003: 50 }, note: { K002: "naik karena promo" } };
const result = C.compute({ stockItems: z.items.filter((i) => i.gkey === MAIN), master: m, edits });
const log = [{ t: Date.UTC(2026, 10, 16, 3), code: "K002", kode: "K002", nama: "Plastik Uji", field: "Final PR", from: 500, to: 600, system: 500, by: "Tes" }];
const meta = { gudangLabel: "GUDANG PUSAT", company: "PT. Contoh Usaha", stockDate: "16/11/2026", preparedBy: "Tes", generatedAt: Date.UTC(2026, 10, 16, 3), fileName: "zahir-contoh.xls", fileHash: "abc123", masterSource: "fixture", masterLoadedAt: Date.UTC(2026, 10, 16, 2) };
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
  assert.equal(ws.getCell("B5").value, "Kode"); assert.equal(ws.getCell("Z5").value, "Status"); assert.equal(ws.getCell("AE5").value, "Supplier");
  const r = rowOf(ws, "A003");
  assert.ok(r > 5);
  assert.equal(ws.getCell(`N${r}`).formula, `G${r}*(H${r}+I${r})`);
  assert.equal(ws.getCell(`R${r}`).formula, `IF(AND(N(G${r})>0,P${r}<=N${r},P${r}<O${r}),O${r}-P${r},0)`);
  assert.equal(ws.getCell(`U${r}`).formula, `IF(R${r}>0,MAX(S${r},CEILING(R${r},IF(N(T${r})>0,T${r},1))),0)`);
  assert.equal(ws.getCell(`J${r}`).formula, "Ringkasan!$C$16"); // siklus default dirujuk ke sel parameter global
  assert.equal(ws.getCell(`L${r}`).value, 50); // PO outstanding dari edit
  const k2 = rowOf(ws, "K002");
  assert.equal(ws.getCell(`U${k2}`).value, 600); // override = nilai, bukan rumus
  assert.match(ws.getCell(`U${k2}`).note.texts ? ws.getCell(`U${k2}`).note.texts.map((t) => t.text).join("") : String(ws.getCell(`U${k2}`).note), /Rekomendasi sistem: 500/);
  assert.equal(ws.getCell(`AC${k2}`).value, "naik karena promo");
  const k3 = rowOf(ws, "K003");
  assert.equal(ws.getCell(`G${k3}`).value, null); // tanpa parameter → input kosong
  assert.equal(ws.getCell(`Z${k3}`).result, "Tanpa parameter");
  assert.ok(ws.views[0].state === "frozen");
  const dv = ws.getCell(`G${r}`).dataValidation || {};
  assert.equal(dv.type, "decimal"); assert.equal(dv.operator, "greaterThanOrEqual");

  // Urutan PR: OOS (DSI sama 0 → nilai PR terbesar dulu) → Kritis → Order
  const pr = wb2.getWorksheet("PR");
  const prCodes = []; for (let i = 5; i < 5 + result.kpi.prCount; i++) prCodes.push(pr.getCell(`C${i}`).value);
  assert.deepEqual(prCodes, ["A004", "K009", "A002", "K002", "A003"]);
  assert.equal(pr.getCell(`D${5 + result.kpi.prCount}`).value, "TOTAL");
  assert.match(pr.getCell("M5").formula, /^IFERROR\(INDEX\(Perhitungan!\$U\$6:\$U\$\d+,\$R5\),""\)$/);
  assert.match(pr.getCell("R5").formula, /^MATCH\(\$C5,Perhitungan!\$B\$6:\$B\$\d+,0\)$/);

  const rs = wb2.getWorksheet("Ringkasan");
  assert.equal(rs.getCell("B24").value, "Item perlu order (Final PR > 0)");
  assert.match(rs.getCell("C24").formula, /^COUNTIF\(Perhitungan!\$U\$6:\$U\$\d+,">0"\)$/);
  assert.equal(rs.getCell("C24").result, result.kpi.prCount);
  assert.equal(rs.getCell("C25").result, result.kpi.prValue);

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
  assert.equal(m2.hasColumn.kelipatan, true); assert.equal(m2.hasColumn.cycle, true);
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
    assert.equal(n("ROP"), r.rop || 0, `${kode} ROP`);
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
  const val = (label) => { const row = ring.find((x) => x[1] === label); return row ? row[2] : undefined; };
  assert.equal(Number(val("Item perlu order (Final PR > 0)")), result.kpi.prCount);
  assert.equal(Math.round(Number(val("Nilai PR"))), result.kpi.prValue);
  assert.equal(Number(val("Stok habis (OOS)")), result.kpi.oos);
  assert.equal(Math.round(Number(val("Overstock (nilai stok)"))), result.kpi.overValue);
  const recRows = ring.filter((x) => x[9] === "Cocok" || x[9] === "SELISIH");
  assert.equal(recRows.length, z.recon.length);
  assert.ok(recRows.every((x) => x[9] === "Cocok"), JSON.stringify(recRows));
  const prs = csv("PR");
  const prTotal = prs.find((x) => x[3] === "TOTAL");
  assert.equal(Math.round(Number(prTotal[14])), result.kpi.prValue);
  assert.equal(prs[4][12] !== undefined, true);
  fs.rmSync(dir, { recursive: true, force: true });
});
