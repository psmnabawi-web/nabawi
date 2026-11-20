// Uji asap situs live (Firestore asli): dua "perangkat" dengan kode tim ACAK sekali pakai (bukan kode tim asli),
// fixture sintetis, Google Sheet diganti fixture lewat route. Data uji tertinggal di ruang kode acak itu (tidak terbaca tim).
//   LIVE_URL=https://rop-gudang-pku.web.app node test/live-smoke.cjs
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const URL0 = (process.env.LIVE_URL || "").replace(/\/$/, "") + "/";
if (!/^https:\/\//.test(URL0)) { console.error("Isi LIVE_URL"); process.exit(1); }
const FX = (f) => path.join(__dirname, "fixtures", f);
const TEAM = crypto.randomBytes(32).toString("base64url");
const SHEET_ID = "SMOKETEST_abcdefghijklmnopqrstuvwxyz";

(async () => {
  const browser = await chromium.launch();
  const problems = [];
  const device = async (name) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.route("https://docs.google.com/**", (r) => r.fulfill({ status: 200, contentType: "text/csv; charset=utf-8", body: fs.readFileSync(FX("master-contoh.csv"), "utf8") }));
    const page = await ctx.newPage();
    page.on("pageerror", (e) => problems.push(`${name} pageerror: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error" && !/status of 404/.test(m.text())) problems.push(`${name} console: ${m.text().slice(0, 300)}`); });
    return page;
  };
  try {
    const A = await device("A");
    await A.goto(`${URL0}#sheet=${SHEET_ID}&gid=0&tab=PKU&team=${TEAM}`);
    await A.waitForSelector("#masterChip.ok", { timeout: 20000 });
    await A.waitForFunction(() => /Data bersama tim aktif/.test(document.getElementById("sharedInfo").textContent), null, { timeout: 30000 });
    await A.setInputFiles("#fileZahir", FX("zahir-contoh.xls"));
    await A.waitForFunction(() => /File terbaru: zahir-contoh\.xls/.test(document.getElementById("sharedInfo").textContent), null, { timeout: 30000 });
    const B = await device("B");
    await B.goto(`${URL0}#team=${TEAM}`);
    await B.waitForSelector("#results:not([hidden])", { timeout: 30000 });
    assert.match(await B.textContent("#kpis"), /5 item/);
    const fin = B.locator('input[data-code="K002"][data-field="final"]');
    await fin.fill("600"); await fin.press("Tab");
    await A.waitForFunction(() => /Rp 335\.500/.test(document.getElementById("kpis").textContent), null, { timeout: 30000 });
    assert.deepEqual(problems, [], problems.join("\n"));
    console.log("LIVE SMOKE OK: upload di A tampil di B, edit B tampil di A (Firestore asli).");
  } catch (e) {
    console.error("LIVE SMOKE GAGAL:", e.message);
    if (problems.length) console.error(problems.join("\n"));
    process.exitCode = 1;
  } finally { await browser.close(); }
})();
