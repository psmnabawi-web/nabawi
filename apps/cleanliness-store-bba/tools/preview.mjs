// Pratinjau app Bangor Cleanliness Control TANPA Firebase: layani public/, ganti modul Firebase (gstatic) dengan tiruan
// berisi data contoh (14 hari audit, sesi capture 12/26), lalu screenshot tiap halaman di desktop (1440px) dan HP (390px),
// termasuk potongan layar saat di-scroll dan deteksi overflow horizontal. Dipakai untuk mengecek perubahan UI sebelum deploy.
//   npm i -g playwright && npx playwright install chromium   (sekali)
//   NODE_PATH=$(npm root -g) node tools/preview.mjs public /tmp/preview-out
//   DEBUG_OVERFLOW=1 ... → cetak elemen yang melebar keluar layar
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, extname } from "node:path";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");

const [PUBLIC_DIR = "public", OUT = "preview-out"] = process.argv.slice(2).map((p) => new URL(p + (p.endsWith("/") ? "" : "/"), "file://" + process.cwd() + "/").pathname);
mkdirSync(OUT, { recursive: true });
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json" };
const server = createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const f = join(PUBLIC_DIR, p === "/" ? "index.html" : p);
  if (!existsSync(f)) { res.writeHead(404); return res.end("nf"); }
  res.writeHead(200, { "Content-Type": TYPES[extname(f)] || "application/octet-stream" }); res.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

// ---- data contoh ----
const master = await import(join(PUBLIC_DIR, "master-data.js"));
const { STORE_MASTER, CREW_MASTER, CONTROL_POINTS } = master;
const WIB = (d = new Date()) => new Date(d.getTime() + 7 * 3600e3);
const dayKey = (d) => WIB(d).toISOString().slice(0, 10);
const today = dayKey(new Date());
const rnd = (seed) => { let x = Math.sin(seed) * 10000; return x - Math.floor(x); };
const audits = [];
const withCrew = STORE_MASTER.filter((s) => CREW_MASTER.some((c) => c.storeId === s.id));
let seed = 1;
for (let back = 13; back >= 0; back--) {
  const d = new Date(Date.now() - back * 86400e3), key = dayKey(d);
  for (const store of withCrew) {
    const crew = CREW_MASTER.find((c) => c.storeId === store.id);
    for (const [i, slot] of ["SHIFT_1", "SHIFT_2", "SHIFT_3"].entries()) {
      const r = rnd(seed++);
      if (back === 0 && i > 0) continue; // hari ini baru shift 1
      if (back === 0 && r < 0.3) { // sebagian masih progress / belum
        if (r < 0.15) continue;
        const done = Math.floor(r * 60);
        audits.push({ id: `${store.id}_${key}_${slot}`, storeId: store.id, storeCode: store.code, storeName: store.name, officerId: crew.id, officerName: crew.name, operationalDate: key, calendarDate: key, slot, slotLabel: `Shift ${i + 1}`, status: "IN_PROGRESS", scoringMode: "AI_VISION_V1", completedCount: done, results: {}, createdAt: { toDate: () => d } });
        continue;
      }
      if (r < 0.12) continue; // bolong
      const score = 62 + r * 36, late = r > 0.82;
      const results = Object.fromEntries(CONTROL_POINTS.map((p, j) => [p.id, { score: Math.max(30, Math.min(100, score + (rnd(seed + j) - 0.5) * 40)), status: score > 85 ? "CLEAN" : score > 70 ? "NEED_CLEANING" : "DIRTY", reason: "Permukaan relatif bersih, sedikit noda di sudut.", confidence: 0.86, capturedDisplay: `${key} 10:1${j % 10} WIB`, evidencePaths: [`x/${p.id}.jpg`] }]));
      const hh = ["09", "15", "21"][i];
      audits.push({ id: `${store.id}_${key}_${slot}`, storeId: store.id, storeCode: store.code, storeName: store.name, officerId: crew.id, officerName: crew.name, operationalDate: key, calendarDate: key, slot, slotLabel: `Shift ${i + 1}`, status: "AUTO_SCORED", scoringMode: "AI_VISION_V1", score: +score.toFixed(1), completedCount: 26, controlPointCount: 26, cleanCount: 18, needCleaningCount: 5, dirtyCount: 2, invalidCount: 1, submissionStatus: late ? "LATE" : "ON_TIME", submittedDisplay: `${key} ${hh}:3${i} WIB`, submittedAtMillis: d.getTime(), latenessMinutes: late ? 40 : 0, results, createdAt: { toDate: () => d } });
    }
  }
}
// sesi capture aktif untuk store pertama: 12/26 sudah dinilai
const capStore = withCrew[0], capCrew = CREW_MASTER.find((c) => c.storeId === capStore.id);
const nowWib = WIB(); const sec = nowWib.getUTCHours() * 3600 + nowWib.getUTCMinutes() * 60; const slot = sec <= 12 * 3600 + 59 ? "SHIFT_1" : sec <= 17 * 3600 + 59 ? "SHIFT_2" : "SHIFT_3";
const capResults = Object.fromEntries(CONTROL_POINTS.slice(0, 12).map((p, j) => [p.id, { score: [92, 78, 55, 88, 95, 40, 81, 90, 73, 97, 66, 85][j], status: ["CLEAN", "NEED_CLEANING", "DIRTY", "CLEAN", "CLEAN", "INVALID", "CLEAN", "CLEAN", "NEED_CLEANING", "CLEAN", "DIRTY", "CLEAN"][j], reason: "Area terlihat bersih, lantai kering, tidak ada sisa makanan. Sedikit debu pada bagian atas rak.", issues: j % 3 ? ["Debu tipis di sudut atas", "Label botol pudar"] : [], confidence: 0.9, capturedDisplay: `${today} 08:1${j} WIB`, evidencePaths: [`x/${p.id}.jpg`] }]));
const capSession = { id: `${capStore.id}_${today}_${slot}`, storeId: capStore.id, storeName: capStore.name, officerId: capCrew.id, officerName: capCrew.name, operationalDate: today, slot, slotLabel: slot.replace("SHIFT_", "Shift "), status: "IN_PROGRESS", scoringMode: "AI_VISION_V1", results: capResults, completedCount: 12 };
const docs = Object.fromEntries(audits.map((a) => [a.id, a])); docs[capSession.id] = capSession;
const fake = { docs, stores: {} };

const stub = {
  "firebase-app.js": `export function initializeApp(c){return {c}}`,
  "firebase-firestore.js": `const F=globalThis.__fake;export function getFirestore(){return {}}export function doc(db,col,id){return {col,id}}export function collection(db,col){return {col}}export function query(c){return c}export function orderBy(){return 0}export function limit(){return 0}export function serverTimestamp(){return {toDate:()=>new Date()}}
export async function getDoc(r){const d=r.col==='audits'?F.docs[r.id]:F.stores[r.id];return {exists:()=>!!d,data:()=>d,id:r.id}}
export async function setDoc(r,v,o){if(r.col==='stores'){F.stores[r.id]={...(o?.merge?F.stores[r.id]:{}),...v};return}F.docs[r.id]={...(o?.merge?F.docs[r.id]:{}),...v}}
export async function addDoc(c,v){const id='new'+Date.now();if(c.col==='stores')F.stores[id]=v;return {id}}
export async function getDocs(c){const src=c.col==='audits'?F.docs:F.stores;return {docs:Object.entries(src).map(([id,d])=>({id,data:()=>d}))}}`,
  "firebase-storage.js": `export function getStorage(){return {}}export function ref(s,p){return {p}}export async function uploadBytes(){return {}}export async function getDownloadURL(r){const h=[...r.p].reduce((a,c)=>a+c.charCodeAt(0),0)%360;return 'data:image/svg+xml;utf8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="hsl('+h+',40%,75%)"/><text x="100" y="105" font-size="20" text-anchor="middle" fill="#334">foto</text></svg>')}`,
  "firebase-functions.js": `export function getFunctions(){return {}}export function httpsCallable(f,name){return async(payload)=>{await new Promise(r=>setTimeout(r,800));if(name==='scoreEvidence'){const F=globalThis.__fake,s=F.docs[payload.sessionId];const result={score:84,status:'CLEAN',reason:'Objek sesuai, permukaan bersih.',issues:[],confidence:.91,capturedDisplay:'baru saja',evidencePaths:['x/'+payload.pointId+'.jpg']};s.results={...(s.results||{}),[payload.pointId]:result};return {data:{ok:true,result,session:{...s,completedCount:Object.keys(s.results).length}}}}if(name==='finalizeSession'){const F=globalThis.__fake,s=F.docs[payload.sessionId];Object.assign(s,{status:'AUTO_SCORED',score:82.4,submissionStatus:'ON_TIME',submittedDisplay:'${today} 10:22 WIB',deadlineTime:'12:00'});return {data:{ok:true,session:s}}}return {data:{ok:true}}}}`,
};

const browser = await chromium.launch();
async function shoot(name, { width, height, mobile = false, page: pageName = "dashboard", before, scrolls = [] } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, timezoneId: "Asia/Jakarta", locale: "id-ID" });
  await ctx.route("**/www.gstatic.com/**", (route) => { const file = route.request().url().split("/").pop(); route.fulfill({ status: 200, contentType: "text/javascript", body: stub[file] || "export default {}" }); });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await ctx.addInitScript((f) => { globalThis.__fake = f; localStorage.setItem("cleanliness_capture_store_id", f.capStoreId); localStorage.setItem("cleanliness_capture_officer_id", f.capCrewId); }, { ...fake, capStoreId: capStore.id, capCrewId: capCrew.id });
  const page = await ctx.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("console", (m) => { if (m.type() === "error" && !/ERR_FAILED|fonts\.g/.test(m.text())) errors.push(m.text()); });
  await page.goto(base + "/", { waitUntil: "networkidle" });
  await page.waitForSelector("#bootOverlay.hidden", { state: "attached", timeout: 15000 });
  if (pageName !== "dashboard") { await page.evaluate((p) => document.querySelector(`.nav-item[data-page="${p}"]`).click(), pageName); await page.waitForTimeout(700); }
  await page.waitForTimeout(900);
  if (before) await before(page);
  await page.screenshot({ path: join(OUT, name + ".png"), fullPage: true });
  for (const [i, y] of scrolls.entries()) { await page.evaluate((y) => window.scrollTo(0, y), y); await page.waitForTimeout(350); await page.screenshot({ path: join(OUT, `${name}-vp${i}.png`) }); }
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  const sw = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth));
  if (sw > width && process.env.DEBUG_OVERFLOW) { const bad = await page.evaluate((w) => { const inScroller = (e) => { for (let a = e.parentElement; a; a = a.parentElement) { const o = getComputedStyle(a).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') return true; } return false; }; return [...document.querySelectorAll('body *')].filter((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.right > w + 1 && cs.position !== 'fixed' && cs.display !== 'none' && !inScroller(e); }).slice(0, 20).map((e) => `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}.${[...e.classList].join('.')} right=${Math.round(e.getBoundingClientRect().right)}`); }, width); console.log('  melebar (di luar scroller):', bad.join(' | ') || '(tidak ada; overflow dari scroller/sticky)'); }
  console.log(`${name}: ${width}x${height} fullPage tinggi ${h}px${sw > width ? `  OVERFLOW lebar ${sw}px > ${width}px` : ""}${errors.length ? "  ERROR: " + errors.join(" | ").slice(0, 300) : ""}`);
  await ctx.close();
}
if (process.env.INTERACT) {
  // Uji interaksi UX: tombol "Berikutnya", kunci foto saat store tanpa crew, pencarian master store.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: "Asia/Jakarta", locale: "id-ID" });
  await ctx.route("**/www.gstatic.com/**", (route) => { const file = route.request().url().split("/").pop(); route.fulfill({ status: 200, contentType: "text/javascript", body: stub[file] || "export default {}" }); });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await ctx.addInitScript((f) => { globalThis.__fake = f; localStorage.setItem("cleanliness_capture_store_id", f.capStoreId); localStorage.setItem("cleanliness_capture_officer_id", f.capCrewId); }, { ...fake, capStoreId: capStore.id, capCrewId: capCrew.id });
  const page = await ctx.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  const check = (name, ok, extra = "") => console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  (" + extra + ")" : ""}`);
  await page.goto(base + "/", { waitUntil: "networkidle" }); await page.waitForSelector("#bootOverlay.hidden", { state: "attached" });
  await page.evaluate(() => document.querySelector('.nav-item[data-page="capture"]').click()); await page.waitForTimeout(800);
  const chips = await page.$$eval(".area-chip", (els) => els.map((e) => e.textContent.trim()));
  check("chip area terisi progres", chips.length === 10 && /3\/3$/.test(chips[0]), chips.slice(0, 3).join(", "));
  const btn = await page.textContent("#csAction"); check("bar sticky: tombol Berikutnya (14)", /Berikutnya \(14\)/.test(btn), btn);
  await page.click("#csAction"); await page.waitForTimeout(900);
  const y = await page.evaluate(() => window.scrollY); const flashed = await page.$eval(".audit-item.flash", (e) => e.id).catch(() => "");
  check("Berikutnya menggulir ke titik pertama yang belum difoto", y > 1500 && flashed === "card-" + CONTROL_POINTS[12].id, `scrollY=${Math.round(y)} ${flashed}`);
  const states = await page.$$eval(".audit-item", (els) => ({ done: els.filter((e) => e.classList.contains("is-done")).length, pending: els.filter((e) => !e.classList.contains("is-done")).length }));
  check("12 kartu bertanda selesai, 14 belum", states.done === 12 && states.pending === 14, JSON.stringify(states));
  const labels = await page.$$eval(".file-cta b", (els) => [...new Set(els.map((e) => e.textContent))]); check("label tombol foto: Ambil Foto / Foto Ulang / Ambil Ulang Foto", labels.includes("Ambil Foto") && labels.includes("Foto Ulang") && labels.includes("Ambil Ulang Foto"), labels.join(" | "));
  // store tanpa crew → terkunci
  const noCrew = STORE_MASTER.find((s) => !CREW_MASTER.some((c) => c.storeId === s.id));
  await page.selectOption("#captureStore", noCrew.id); await page.waitForTimeout(600);
  const locked = await page.evaluate(() => ({ note: !document.querySelector("#captureLockNote").classList.contains("hidden"), locked: document.querySelector("#evidenceItems").classList.contains("locked"), officer: document.querySelector("#captureOfficer").disabled, opt: document.querySelector("#captureOfficer option").textContent }));
  check("store tanpa crew: tombol foto terkunci + catatan tampil", locked.note && locked.locked && locked.officer, JSON.stringify(locked));
  await page.selectOption("#captureStore", capStore.id); await page.waitForTimeout(600);
  const unlocked = await page.evaluate(() => ({ note: document.querySelector("#captureLockNote").classList.contains("hidden"), locked: document.querySelector("#evidenceItems").classList.contains("locked") }));
  check("kembali ke store dengan crew: terbuka lagi", unlocked.note && !unlocked.locked, JSON.stringify(unlocked));
  // dashboard: urutan rekap & ringkasan
  await page.evaluate(() => document.querySelector('.nav-item[data-page="dashboard"]').click()); await page.waitForTimeout(1200);
  const rows = await page.$$eval("#dailySessionRecap tr", (trs) => trs.map((tr) => tr.className || "row")); const chipsTxt = await page.textContent("#dailyRecapSummary");
  check("rekap: store tanpa crew di bawah, ringkasan shift tampil", rows.slice(-13).every((c) => c === "row-nocrew") && /belum mulai/.test(chipsTxt) && /13 store belum bisa evidence/.test(chipsTxt), rows.length + " baris");
  // master: pencarian crew
  await page.evaluate(() => document.querySelector('.nav-item[data-page="stores"]').click()); await page.waitForTimeout(600);
  await page.fill("#storeSearch", "fauzan"); await page.waitForTimeout(300);
  const found = await page.$$eval(".store-row", (els) => els.map((e) => ({ name: e.querySelector("summary b").textContent, open: e.open, crew: [...e.querySelectorAll(".crew-list li span")].map((x) => x.textContent) })));
  check("cari 'fauzan' → 1 store (JAKAL UII) terbuka dengan daftar crew", found.length === 1 && found[0].name === "JAKAL UII" && found[0].open && found[0].crew.includes("Fauzan"), JSON.stringify(found.map((f) => f.name)));
  check("tanpa error JavaScript", errors.length === 0, errors.join(" | ").slice(0, 200));
  await ctx.close(); await browser.close(); server.close(); process.exit(0);
}
if (process.env.EXTRA) {
  for (const [name, vp, mobile] of [["desktop", { width: 1440, height: 900 }, false], ["mobile", { width: 390, height: 844 }, true]]) {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, timezoneId: "Asia/Jakarta", locale: "id-ID" });
    await ctx.route("**/www.gstatic.com/**", (route) => { const file = route.request().url().split("/").pop(); route.fulfill({ status: 200, contentType: "text/javascript", body: stub[file] || "export default {}" }); });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
    await ctx.addInitScript((f) => { globalThis.__fake = f; }, fake);
    const page = await ctx.newPage(); await page.goto(base + "/", { waitUntil: "networkidle" }); await page.waitForSelector("#bootOverlay.hidden", { state: "attached" });
    // layar boot
    await page.evaluate(() => { document.querySelector("#bootOverlay").classList.remove("hidden"); document.querySelector("#bootText").textContent = "Menghubungkan aplikasi..."; });
    await page.waitForTimeout(200); await page.screenshot({ path: join(OUT, `${name}-boot.png`) });
    await page.evaluate(() => document.querySelector("#bootOverlay").classList.add("hidden"));
    // modal skor final dengan contoh isi
    await page.evaluate(() => { const $ = (s) => document.querySelector(s); $("#finalScoreValue").textContent = "87.4"; $("#finalScoreBadge").textContent = "GOOD"; $("#finalScoreBadge").className = "final-score-badge green";
      $("#finalScoreMeta").innerHTML = '<div><span>Store</span><b>JAKAL UII</b></div><div><span>Crew</span><b>Fauzan</b></div><div><span>Shift</span><b>Shift 1 · Max 12:00 WIB</b></div><div><span>Submission</span><b><span class="badge green">ON TIME</span> 10:42 WIB</b></div>';
      $("#finalScoreBreakdown").innerHTML = '<div class="final-mini clean"><span>Bersih</span><b>21</b></div><div class="final-mini need"><span>Perlu Cleaning</span><b>3</b></div><div class="final-mini dirty"><span>Kotor</span><b>1</b></div><div class="final-mini invalid"><span>Invalid</span><b>1</b></div>';
      $("#finalScoreWarning").textContent = "1 evidence INVALID dihitung 0."; $("#finalScoreWarning").classList.remove("hidden"); $("#finalScoreModal").classList.remove("hidden"); });
    await page.waitForTimeout(400); await page.screenshot({ path: join(OUT, `${name}-modal.png`) });
    console.log(`${name}-boot / ${name}-modal tersimpan`); await ctx.close();
  }
  await browser.close(); server.close(); process.exit(0);
}
for (const [pg, label] of [["dashboard", "dashboard"], ["capture", "evidence"], ["stores", "master"]]) {
  await shoot(`desktop-${label}`, { width: 1440, height: 900, page: pg });
  await shoot(`mobile-${label}`, { width: 390, height: 844, mobile: true, page: pg, scrolls: { dashboard: [0, 760], capture: [0, 1500, 3400], stores: [0] }[pg] });
}
await browser.close(); server.close();
