// Uji end-to-end di Chromium (Playwright): node test/e2e.cjs
// Situs disajikan dengan header yang sama dengan firebase.json (termasuk CSP). Google Sheet diganti fixture lewat route.
const path = require("path");
const fs = require("fs");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const ExcelJS = require("../public/vendor/exceljs.min.js");
const { serve } = require("../scripts/serve.cjs");

const FX = (f) => path.join(__dirname, "fixtures", f);
const OUT = path.join(__dirname, "out");
fs.mkdirSync(OUT, { recursive: true });
const SHEET = "https://docs.google.com/spreadsheets/d/TESTSHEET_abcdefghijklmnopqrstuvwxyz/edit#gid=0";

(async () => {
  const srv = await serve(0);
  const base = `http://127.0.0.1:${srv.address().port}/`;
  const browser = await chromium.launch();
  const problems = [];
  let sheetHits = 0;
  try {
    const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
    await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base.replace(/\/$/, "") });
    await ctx.route("https://docs.google.com/**", (route) => { sheetHits++; route.fulfill({ status: 200, contentType: "text/csv; charset=utf-8", body: fs.readFileSync(FX("master-contoh.csv"), "utf8") }); });
    await ctx.addInitScript((s) => { if (!localStorage.getItem("rop.settings.v1")) localStorage.setItem("rop.settings.v1", JSON.stringify({ sheetUrl: s, preparedBy: "Tes E2E" })); }, SHEET);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/config\.local\.json|status of 404/.test(m.text())) problems.push("console: " + m.text()); });

    await page.goto(base);
    await page.waitForSelector("#masterChip.ok", { timeout: 10000 });
    assert.match(await page.textContent("#masterChip"), /9 item/);
    assert.ok(sheetHits >= 1, "Google Sheet (route) dipanggil");

    // upload file Zahir (.xls teks)
    await page.setInputFiles("#fileZahir", FX("zahir-contoh.xls"));
    await page.waitForSelector("#results:not([hidden])");
    const kpi = await page.textContent("#kpis");
    assert.match(kpi, /5 item/); assert.match(kpi, /Rp 338\.750/);
    assert.match(await page.textContent("#alerts"), /6 dari 6 subtotal/);
    assert.equal(await page.inputValue("#selGudang"), "GUDANG PUSAT › GUDANG PUSAT");
    assert.equal(await page.textContent("#cntPr"), "5");

    // edit Final PR K002 500 → 600 (Tab pindah sel; fokus harus tetap di sel berikutnya)
    const fin = page.locator('input[data-code="K002"][data-field="final"]');
    await fin.fill("600"); await fin.press("Tab");
    await page.waitForFunction(() => document.getElementById("kpis").textContent.includes("Rp 348.300"));
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.dataset.code), "K002");
    assert.ok(await page.locator('input[data-code="K002"][data-field="final"].edited').count());
    // PO outstanding A003 = 150 → keluar dari PR
    const po = page.locator('input[data-code="A003"][data-field="onOrder"]');
    await po.fill("150"); await po.press("Enter");
    await page.waitForFunction(() => document.getElementById("kpis").textContent.includes("Rp 198.300"));

    // rincian hitungan
    await page.click('button[data-detail="A002"]');
    await page.waitForSelector("#dlgItem[open]");
    const det = await page.textContent("#dlgItemBody");
    assert.match(det, /ROP/); assert.match(det, /100 × \(1 \+ 1\)/);
    await page.keyboard.press("Escape");

    // tab lain
    await page.click('#tabs button[data-tab="issue"]');
    assert.match(await page.textContent("#tbl"), /Kode ganda di master/);
    await page.click('#tabs button[data-tab="over"]');
    assert.match(await page.textContent("#tbl"), /Kotak Uji/);
    await page.click('#tabs button[data-tab="pr"]');
    await page.screenshot({ path: path.join(OUT, "desktop.png"), fullPage: true });

    // salin teks PR
    await page.click("#btnCopy");
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    assert.match(clip, /Rekomendasi Pembelian GUDANG PUSAT/); assert.match(clip, /Plastik Uji \(K002\): 600 Pcs/);

    // export Excel
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#btnExport")]);
    assert.match(dl.suggestedFilename(), /^PR_GUDANG_PUSAT_\d{8}\.xlsx$/);
    const xlsx = path.join(OUT, "e2e-export.xlsx");
    await dl.saveAs(xlsx);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(fs.readFileSync(xlsx));
    const ws = wb.getWorksheet("Perhitungan");
    let k2 = -1; for (let r = 6; r <= ws.rowCount; r++) if (ws.getCell(`B${r}`).value === "K002") k2 = r;
    assert.equal(ws.getCell(`U${k2}`).value, 600);
    const log = wb.getWorksheet("Log Perubahan");
    assert.equal(log.getCell("B5").value, "K002"); assert.equal(log.getCell("H5").value, "Tes E2E");
    assert.equal(wb.getWorksheet("Ringkasan").getCell("C7").value, "Tes E2E");

    // template master
    const [dl2] = await Promise.all([page.waitForEvent("download"), page.click("#btnTemplate")]);
    const tpl = path.join(OUT, "e2e-template.xlsx"); await dl2.saveAs(tpl);

    // reload: file & perubahan dipulihkan dari browser
    await page.reload();
    await page.waitForSelector("#results:not([hidden])");
    await page.waitForSelector("#masterChip.ok");
    assert.equal(await page.inputValue('input[data-code="K002"][data-field="final"]'), "600");

    // upload master dari file xlsx (template) dan file Zahir versi .xlsx
    await page.setInputFiles("#fileMaster", tpl);
    await page.waitForFunction(() => /Upload: e2e-template\.xlsx/.test(document.getElementById("masterInfo").textContent));
    const zwb = new ExcelJS.Workbook(); const zs = zwb.addWorksheet("Sheet1");
    const lines = fs.readFileSync(FX("zahir-contoh.xls"), "utf8").split("\n");
    lines.forEach((l, i) => l.split("\t").forEach((c, j) => { if (c !== "") zs.getCell(i + 1, j + 1).value = /^-?[\d,]+(\.\d+)?$/.test(c) && j >= 2 ? Number(c.replace(/,/g, "")) : c; }));
    const zx = path.join(OUT, "zahir-contoh.xlsx"); fs.writeFileSync(zx, Buffer.from(await zwb.xlsx.writeBuffer()));
    await page.setInputFiles("#fileZahir", zx);
    await page.waitForFunction(() => /9 baris · subtotal 6\/6 cocok/.test(document.getElementById("fileChip").textContent));
    assert.match(await page.textContent("#kpis"), /5 item/);

    // gudang Sales
    await page.selectOption("#selGudang", "GUDANG PUSAT › Sales");
    assert.match(await page.textContent("#alerts"), /bukan untuk gudang ini/);
    await page.selectOption("#selGudang", "GUDANG PUSAT › GUDANG PUSAT");

    // pengaturan: siklus 2 hari → A001 ikut order
    await page.click("#btnSettings");
    await page.fill("#setCycle", "2");
    await page.click("#btnSaveSettings");
    await page.waitForFunction(() => document.getElementById("cntPr").textContent === "6");

    // mobile: tidak ada scroll horizontal halaman
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(200);
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(sw <= 390, "scrollWidth mobile " + sw);
    await page.screenshot({ path: path.join(OUT, "mobile.png"), fullPage: false });

    // link untuk tim: perangkat baru membuka https://situs/#sheet=<ID>&gid=0&tab=PKU → sumber parameter tersimpan, hash dibersihkan
    const ctx2 = await browser.newContext();
    await ctx2.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base.replace(/\/$/, "") });
    await ctx2.route("https://docs.google.com/**", (route) => route.fulfill({ status: 200, contentType: "text/csv; charset=utf-8", body: fs.readFileSync(FX("master-contoh.csv"), "utf8") }));
    const p2 = await ctx2.newPage();
    p2.on("pageerror", (e) => problems.push("pageerror(p2): " + e.message));
    await p2.goto(base + "#sheet=TESTSHEET_abcdefghijklmnopqrstuvwxyz&gid=0&tab=PKU");
    await p2.waitForSelector("#masterChip.ok");
    assert.equal(await p2.evaluate(() => location.hash), "");
    assert.match(await p2.evaluate(() => localStorage.getItem("rop.settings.v1")), /TESTSHEET_abcdefghijklmnopqrstuvwxyz/);
    await p2.click("#btnSettings"); await p2.click("#btnShareLink");
    assert.equal(await p2.evaluate(() => navigator.clipboard.readText()), base + "#sheet=TESTSHEET_abcdefghijklmnopqrstuvwxyz&gid=0&tab=PKU");
    await ctx2.close();

    assert.deepEqual(problems, [], problems.join("\n"));
    console.log("E2E OK · screenshot & export di test/out/");
  } catch (e) {
    console.error("E2E GAGAL:", e.message);
    if (problems.length) console.error(problems.join("\n"));
    process.exitCode = 1;
  } finally {
    await browser.close();
    srv.close();
  }
})();
