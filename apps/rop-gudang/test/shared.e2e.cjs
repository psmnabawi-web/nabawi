// Uji data bersama tim (Firestore emulator + 3 perangkat/browser terpisah) dan rules Firestore.
// Jalankan:  npx -y firebase-tools@13 emulators:exec --only firestore --project demo-rop --config firebase.emulator.json "node test/shared.e2e.cjs"
// (butuh Java). Tanpa FIRESTORE_EMULATOR_HOST tes dilewati.
const path = require("path");
const fs = require("fs");
const assert = require("node:assert/strict");

const EMU = process.env.FIRESTORE_EMULATOR_HOST;
if (!EMU) { console.log("SHARED E2E dilewati: jalankan lewat firebase emulators:exec (lihat komentar di atas)."); process.exit(0); }

const { chromium } = require("playwright");
const { serve } = require("../scripts/serve.cjs");
const FX = (f) => path.join(__dirname, "fixtures", f);
const OUT = path.join(__dirname, "out");
fs.mkdirSync(OUT, { recursive: true });
const SHEET_ID = "TESTSHEET_abcdefghijklmnopqrstuvwxyz";
const TEAM = "TeamKeyUntukTes_0123456789abcdefghijklmnopqrstu"; // 48 karakter
const local = JSON.stringify({ FIREBASE: { config: { apiKey: "demo-key", projectId: "demo-rop", appId: "1:1:web:1" }, emulator: EMU } });

(async () => {
  const srv = await serve(0, { connectSrc: [`http://${EMU}`, `ws://${EMU}`], files: { "/config.local.json": local } });
  const base = `http://127.0.0.1:${srv.address().port}/`;
  const browser = await chromium.launch();
  const problems = [], logs = [], pages = {};
  const device = async (name, opts) => {
    const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
    await ctx.route("https://docs.google.com/**", (r) => r.fulfill({ status: 200, contentType: "text/csv; charset=utf-8", body: fs.readFileSync(FX("master-contoh.csv"), "utf8") }));
    await ctx.addInitScript(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });
    if (opts && opts.by) await ctx.addInitScript((by) => { if (!localStorage.getItem("rop.settings.v1")) localStorage.setItem("rop.settings.v1", JSON.stringify({ preparedBy: by, orderBasis: "master" })); }, opts.by);
    const page = await ctx.newPage();
    pages[name] = page;
    page.on("console", (m) => logs.push(`${name} ${m.type()}: ${m.text().slice(0, 300)}`));
    page.on("pageerror", (e) => problems.push(`${name} pageerror: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error" && !/status of 404|permission|PERMISSION_DENIED|Missing or insufficient/i.test(m.text())) problems.push(`${name} console: ${m.text()}`); });
    page.on("dialog", (d) => d.accept());
    return { ctx, page };
  };
  const kpis = (p) => p.textContent("#kpis");
  const waitKpi = (p, re) => p.waitForFunction((src) => new RegExp(src).test(document.getElementById("kpis").textContent), re.source, { timeout: 15000 });

  try {
    // Perangkat A (admin): link tim lengkap (sheet + kode tim), upload file pertama
    const A = await device("A", { by: "Admin SCM" });
    await A.page.goto(`${base}#sheet=${SHEET_ID}&gid=0&tab=PKU&team=${TEAM}`);
    await A.page.waitForSelector("#masterChip.ok");
    await A.page.waitForFunction(() => /Belum ada file\. Upload pertama/.test(document.getElementById("sharedInfo").textContent), null, { timeout: 15000 });
    assert.equal(await A.page.evaluate(() => location.hash), "");
    assert.match(await A.page.textContent("#dropNote"), /disimpan sebagai data terbaru untuk tim/);
    await A.page.setInputFiles("#fileZahir", FX("zahir-contoh.xls"));
    await A.page.waitForSelector("#results:not([hidden])");
    await A.page.waitForFunction(() => /File terbaru: zahir-contoh\.xls/.test(document.getElementById("sharedInfo").textContent), null, { timeout: 15000 });
    assert.match(await kpis(A.page), /5 item/); assert.match(await kpis(A.page), /Rp 287\.750/);
    assert.match(await A.page.textContent("#sharedInfo"), /diupload Admin SCM/);

    // Perangkat B: hanya kode tim (tanpa link sheet) → sumber parameter & file terbaru ikut dari tim
    const B = await device("B", { by: "Staf Purchasing" });
    await B.page.goto(`${base}#team=${TEAM}`);
    await B.page.waitForSelector("#masterChip.ok", { timeout: 15000 });
    await B.page.waitForSelector("#results:not([hidden])", { timeout: 15000 });
    assert.match(await kpis(B.page), /5 item/); assert.match(await kpis(B.page), /Rp 287\.750/);
    assert.match(await B.page.evaluate(() => localStorage.getItem("rop.settings.v1")), new RegExp(SHEET_ID));

    // B mengubah Final PR → A melihat tanpa reload
    const fin = B.page.locator('input[data-code="K002"][data-field="final"]');
    await fin.fill("600"); await fin.press("Tab");
    await waitKpi(B.page, /Rp 335\.500/);
    await waitKpi(A.page, /Rp 335\.500/);
    assert.equal(await A.page.inputValue('input[data-code="K002"][data-field="final"]'), "600");
    // A mengubah catatan item lain → B melihat; edit B tidak tertimpa
    const note = A.page.locator('input[data-code="A003"][data-field="note"]');
    await note.fill("cek supplier"); await note.press("Enter"); await A.page.locator("#q").click();
    await B.page.waitForFunction(() => { const el = document.querySelector('input[data-code="A003"][data-field="note"]'); return el && el.value === "cek supplier"; }, null, { timeout: 15000 });
    assert.equal(await B.page.inputValue('input[data-code="K002"][data-field="final"]'), "600");

    // Nomor PO bersama: A cetak 4 PO, B membuka dialog → nomor lanjut 5; B memaksa mulai 1 → disesuaikan ke 5
    await A.page.click("#btnPO"); await A.page.waitForSelector("#dlgPO[open]");
    await A.page.waitForFunction(() => document.getElementById("poSeq").value === "1");
    const nA = await A.page.locator("#poGroups input[type=checkbox]").count();
    await A.page.click("#btnDoPrint"); await A.page.waitForFunction(() => window.__printed === 1);
    await A.page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
    await B.page.click("#btnPO"); await B.page.waitForSelector("#dlgPO[open]");
    await B.page.waitForFunction((n) => document.getElementById("poSeq").value === String(n + 1), nA, { timeout: 10000 });
    await B.page.fill("#poSeq", "1");
    await B.page.click("#btnDoPrint"); await B.page.waitForFunction(() => window.__printed === 1);
    const firstB = await B.page.textContent("#printArea .po:nth-child(1)");
    assert.match(firstB, new RegExp(`/${String(nA + 1).padStart(3, "0")}`), "nomor PO B lanjut setelah A");
    await B.page.evaluate(() => window.dispatchEvent(new Event("afterprint")));

    // A menambah file Produksi → versi baru untuk semua; B ikut berubah (stok dijumlah)
    await A.page.setInputFiles("#fileZahirAdd", FX("zahir-produksi-contoh.xls"));
    await waitKpi(A.page, /4 item/);
    await B.page.waitForFunction(() => /2 file/.test(document.getElementById("fileChip").textContent), null, { timeout: 15000 });
    await waitKpi(B.page, /4 item/);
    assert.match(await B.page.textContent("#alerts"), /GUDANG PUSAT \+ PRODUKSI/);

    // Perangkat C tanpa kode tim: tidak melihat data tim
    const Cd = await device("C");
    await Cd.page.goto(base);
    await Cd.page.waitForFunction(() => /belum aktif di perangkat ini/.test(document.getElementById("sharedInfo").textContent));
    assert.equal(await Cd.page.isHidden("#results"), true);

    // Riwayat: B mengembalikan versi pertama → A ikut kembali ke 1 file; edit K002 di versi itu masih ada
    await B.page.click("#btnHistory");
    await B.page.waitForSelector("#historyList [data-use-upload]");
    assert.equal(await B.page.locator("#historyList .file-row").count(), 2);
    await B.page.click("#historyList [data-use-upload]");
    await A.page.waitForFunction(() => /1 file/.test(document.getElementById("fileChip").textContent), null, { timeout: 15000 });
    await waitKpi(A.page, /Rp 335\.500/);
    assert.match(await A.page.textContent("#sharedInfo"), /dipilih dari riwayat oleh Staf Purchasing/);

    // Reload B: tetap data tim
    await B.page.reload();
    await B.page.waitForSelector("#results:not([hidden])");
    await waitKpi(B.page, /Rp 335\.500/);

    // Export Excel di B membawa log dari dua orang
    const [dl] = await Promise.all([B.page.waitForEvent("download"), B.page.click("#btnExport")]);
    const xlsx = path.join(OUT, "shared-export.xlsx"); await dl.saveAs(xlsx);
    assert.ok(fs.statSync(xlsx).size > 5000);

    // Rules: tanpa kode / bentuk data salah ditolak
    const denied = await A.page.evaluate(async (team) => {
      const db = firebase.app("rop").firestore();
      const tryIt = async (fn) => { try { await fn(); return "ok"; } catch (e) { return e.code || e.message; } };
      return {
        listTeams: await tryIt(() => db.collection("ropGudang").get()),
        shortKey: await tryIt(() => db.collection("ropGudang").doc("pendek").get()),
        otherCollection: await tryIt(() => db.collection("lain").doc("x").set({ a: 1 })),
        extraField: await tryIt(() => db.collection("ropGudang").doc(team).set({ hack: 1 }, { merge: true })),
        deleteUpload: await tryIt(async () => { const q = await db.collection("ropGudang").doc(team).collection("uploads").limit(1).get(); await q.docs[0].ref.delete(); }),
        badSheet: await tryIt(() => db.collection("ropGudang").doc(team).set({ sheet: { url: "https://evil.example/x", gid: "0", tab: "PKU" } }, { merge: true })),
        poSeqOk: await tryIt(() => db.collection("ropGudang").doc(team).collection("poSeq").doc("20991231").set({ n: 3, updatedAt: 1 })),
      };
    }, TEAM);
    assert.equal(denied.listTeams, "permission-denied");
    assert.equal(denied.shortKey, "permission-denied");
    assert.equal(denied.otherCollection, "permission-denied");
    assert.equal(denied.extraField, "permission-denied");
    assert.equal(denied.deleteUpload, "permission-denied");
    assert.equal(denied.badSheet, "permission-denied");
    assert.equal(denied.poSeqOk, "ok");

    await A.page.screenshot({ path: path.join(OUT, "shared-A.png"), fullPage: false });
    await B.page.setViewportSize({ width: 390, height: 844 });
    await B.page.screenshot({ path: path.join(OUT, "shared-B-mobile.png"), fullPage: false });

    assert.deepEqual(problems, [], problems.join("\n"));
    console.log("SHARED E2E OK");
  } catch (e) {
    console.error("SHARED E2E GAGAL:", e.message, e.stack.split("\n").find((l) => /shared\.e2e/.test(l)));
    for (const [n, pg] of Object.entries(pages)) console.error(n, "sharedInfo:", await pg.textContent("#sharedInfo").catch(() => "?"), "| chip:", await pg.textContent("#fileChip").catch(() => "?"), "| toast:", await pg.textContent("#toast").catch(() => "?"));
    console.error(logs.slice(-25).join("\n"));
    if (problems.length) console.error(problems.join("\n"));
    process.exitCode = 1;
  } finally {
    await browser.close();
    srv.close();
  }
})();
