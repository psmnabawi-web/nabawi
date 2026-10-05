// Tambahan untuk app Trecking Filter Oil (tanpa mengubah app.js):
//   1. Menu "Kepatuhan & Export": store tidak patuh, peta harian, detail slot, export Excel.
//   2. Tombol "Export Excel" di Dashboard, memakai periode & store yang sedang dipilih di Dashboard.
// Data dibaca dari Firestore (REST, hanya baca). Tidak ada yang ditulis ke database.
import { buildReport, STATUS, ymdWib, addDays, fmtDate, dayName } from "./kepatuhan.js";
import { loadStores, loadSettings, loadRecords, loadExcelJS, buildWorkbook, downloadWorkbook, wibNowLabel, exportFileName } from "./core.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const pct = (x, d = 0) => (x === null || x === undefined || Number.isNaN(x) ? "–" : `${(x * 100).toFixed(d).replace(".", ",")}%`);
const MAX_HEAT_DAYS = 31;
const MAX_DETAIL_ROWS = 300;

// ---------- data (cache per sesi halaman) ----------
const cache = { stores: null, settings: null, records: new Map() };
async function getData(start, end, force = false) {
  if (force || !cache.stores) [cache.stores, cache.settings] = await Promise.all([loadStores(), loadSettings()]);
  const key = `${start}|${end}`;
  if (force || !cache.records.has(key)) cache.records.set(key, await loadRecords(start, end));
  return { stores: cache.stores, settings: cache.settings || {}, records: cache.records.get(key) };
}
function report({ start, end, storeId = "", target = 0.95 }, data) {
  const stores = storeId ? data.stores.filter((s) => s.id === storeId) : data.stores;
  return buildReport({ stores, records: data.records, settings: data.settings, start, end, nowMs: Date.now(), target });
}
async function exportExcel(params, data) {
  const r = report(params, data);
  if (!r.rows.length) throw new Error("Tidak ada slot wajib pada periode ini.");
  const ExcelJS = await loadExcelJS();
  const storeName = params.storeId ? (data.stores.find((s) => s.id === params.storeId)?.name || params.storeId) : "";
  const wb = await buildWorkbook(ExcelJS, r, { area: storeName ? `Store ${storeName}` : "", generatedAt: wibNowLabel() });
  await downloadWorkbook(wb, exportFileName(r, storeName));
  return r;
}

function toast(msg) {
  const t = $("toast");
  if (!t) return;
  t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.add("hidden"), 3500);
}
async function busy(btn, label, fn) {
  const old = btn.innerHTML; btn.disabled = true; btn.textContent = label;
  try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = old; }
}

// ---------- 1. tombol Export di Dashboard ----------
function initDashboardExport() {
  const load = $("btnLoadDashboard");
  if (!load || $("btnExportDashboard")) return;
  const btn = document.createElement("button");
  btn.id = "btnExportDashboard"; btn.type = "button"; btn.className = "btn secondary";
  btn.innerHTML = "⬇ Export Excel";
  btn.title = "Export data compliance periode & store yang dipilih ke Excel";
  load.insertAdjacentElement("afterend", btn);
  load.closest(".filterbar")?.classList.add("kp-has-export");
  btn.addEventListener("click", () => busy(btn, "Menyiapkan Excel…", async () => {
    const start = $("dashFrom")?.value, end = $("dashTo")?.value;
    const store = $("dashStore")?.value || "ALL";
    if (!start || !end) { toast("Isi Periode Dari dan Sampai dulu."); return; }
    const [s, e] = start <= end ? [start, end] : [end, start];
    try {
      const r = await exportExcel({ start: s, end: e, storeId: store === "ALL" ? "" : store, target: 0.95 }, await getData(s, e));
      toast(`Excel terunduh: ${r.stores.length} store, ${r.rows.length} slot.`);
    } catch (err) { toast(`Export gagal: ${err.message}`); }
  }));
}

// ---------- 2. panel Kepatuhan & Export ----------
const ui = { onlyIssues: true, storeDetail: "", report: null };
const TEMPLATE = `
  <div class="card filterbar kp-filterbar">
    <div class="filterbar-title">
      <div><div class="section-label">KEPATUHAN STORE</div><h2>Store Tidak Patuh &amp; Export Data</h2></div>
      <div class="hint">Compliance = slot filter dikerjakan ÷ slot wajib. Store di bawah target ditandai <b>Tidak patuh</b>. Slot hari ini baru dihitung setelah lewat jam filter + toleransi, jadi angka hari berjalan bisa sedikit beda dengan Dashboard.</div>
    </div>
    <label>Periode Dari <input id="kpFrom" type="date"></label>
    <label>Periode Sampai <input id="kpTo" type="date"></label>
    <label>Store <select id="kpStore"><option value="">ALL STORE</option></select></label>
    <label>Target Compliance (%) <input id="kpTarget" type="number" min="0" max="100" step="5" value="95"></label>
    <div class="kp-actions">
      <button id="kpLoad" type="button" class="btn secondary">Tampilkan</button>
      <button id="kpExport" type="button" class="btn primary">⬇ Export Excel</button>
    </div>
  </div>
  <div id="kpError" class="alert danger" hidden></div>
  <div class="kpis kp-kpis" id="kpKpis"></div>
  <div class="card">
    <div class="card-head"><div><div class="section-label">RANKING</div><h2>Peringkat Kepatuhan Store</h2>
      <div class="hint">Diurutkan dari compliance terendah. Klik baris untuk melihat detail slot store tersebut.</div></div></div>
    <div class="table-wrap"><table id="kpStores"></table></div>
  </div>
  <div class="card">
    <div class="card-head"><div><div class="section-label">PETA HARIAN</div><h2>Slot Dikerjakan per Hari</h2>
      <div class="hint">Angka = slot dikerjakan / slot wajib. Arahkan kursor atau ketuk kotak untuk rincian.</div></div>
      <ul class="kp-legend" id="kpLegend"></ul></div>
    <div class="kp-heat-wrap"><table class="kp-heat" id="kpHeat"></table></div>
    <div class="hint" id="kpHeatNote" hidden></div>
  </div>
  <div class="card" id="kpDetailCard">
    <div class="card-head"><div><div class="section-label">DETAIL</div><h2>Detail Slot</h2><div class="hint" id="kpDetailHint"></div></div>
      <label class="kp-check"><input type="checkbox" id="kpOnlyIssues" checked> Hanya yang bermasalah</label></div>
    <div class="table-wrap"><table id="kpDetail"></table></div>
    <div class="hint" id="kpDetailNote" hidden></div>
  </div>
  <div class="kp-tip" id="kpTip" hidden></div>`;

const statusBadge = (key) => {
  const s = STATUS[key] || STATUS.MISSED;
  const cls = { good: "good", warning: "warn", serious: "warn", critical: "bad" }[s.tone];
  return `<span class="status ${cls}"><span aria-hidden="true">${s.icon}</span>&nbsp;${esc(s.label)}</span>`;
};
const compliantBadge = (ok) => (ok ? `<span class="status good">✓&nbsp;Patuh</span>` : `<span class="status bad">✕&nbsp;Tidak patuh</span>`);
function dayTone(d, target) {
  if (!d || !d.expected) return "none";
  if (d.pctDone >= target - 1e-9) return "good";
  if (d.pctDone >= 0.5) return "warning";
  if (d.pctDone > 0) return "serious";
  return "critical";
}
const params = () => {
  const a = $("kpFrom").value, b = $("kpTo").value;
  const [start, end] = a <= b ? [a, b] : [b, a];
  const t = Math.min(100, Math.max(0, Number($("kpTarget").value) || 0));
  return { start, end, storeId: $("kpStore").value, target: t / 100 };
};

async function loadPanel(force = false) {
  const err = $("kpError"); err.hidden = true;
  const p = params();
  if (!p.start || !p.end) return;
  $("kpKpis").innerHTML = `<div class="kpi"><span>Memuat</span><strong>…</strong></div>`;
  try {
    const data = await getData(p.start, p.end, force);
    const sel = $("kpStore"), cur = sel.value;
    if (sel.options.length <= 1) {
      for (const s of data.stores.filter((x) => x.active !== false).sort((a, b) => String(a.name).localeCompare(String(b.name), "id"))) sel.add(new Option(s.name || s.id, s.id));
      sel.value = cur;
    }
    ui.report = report(p, data);
    render();
  } catch (e) {
    err.textContent = `Data gagal dimuat: ${e.message}`; err.hidden = false; $("kpKpis").innerHTML = "";
  }
}

function render() {
  const r = ui.report, t = r.total, tgt = Math.round(r.target * 100);
  const kpis = [
    ["kpi-compliance", "Compliance", pct(t.pctDone, 1), `${t.done} dari ${t.expected} slot · target ${tgt}%`, t.pctDone !== null && t.pctDone < r.target],
    ["kpi-ontime", "Tepat waktu", String(t.ONTIME), `${pct(t.pctOntime, 1)} dalam ±${r.tol} menit`],
    ["kpi-variance", "Early / Late", String(t.EARLY + t.LATE), `${t.EARLY} awal · ${t.LATE} terlambat`],
    ["kpi-missed", "Tidak dikerjakan", String(t.MISSED), `${pct(t.expected ? t.MISSED / t.expected : null, 1)} dari slot wajib`, t.MISSED > 0],
    ["kpi-trust", "Store tidak patuh", `${r.nonCompliant}/${r.stores.length}`, `compliance di bawah ${tgt}%`, r.nonCompliant > 0],
  ];
  $("kpKpis").innerHTML = kpis.map(([c, l, v, n, bad]) => `<div class="kpi ${c}${bad ? " danger" : ""}"><span>${esc(l)}</span><strong>${esc(v)}</strong><small>${esc(n)}</small></div>`).join("");

  $("kpStores").innerHTML = `<thead><tr><th>#</th><th>Store</th><th>Area</th><th>Slot wajib</th><th>Tepat waktu</th><th>Terlalu awal</th><th>Terlambat</th><th>Tidak dikerjakan</th><th>Compliance</th><th>% Tepat waktu</th><th>Status</th><th title="Foto bukti dari galeri/berkas, bukan kamera app">Foto galeri</th></tr></thead>
    <tbody>${r.stores.map((s, i) => `<tr class="kp-row${ui.storeDetail === s.id ? " kp-selected" : ""}" data-store="${esc(s.id)}" tabindex="0">
      <td>${i + 1}</td><td><strong>${esc(s.name)}</strong></td><td>${esc(s.area)}</td><td>${s.expected}</td><td>${s.ONTIME}</td><td>${s.EARLY}</td><td>${s.LATE}</td>
      <td>${s.MISSED ? `<strong class="kp-red">${s.MISSED}</strong>` : 0}</td>
      <td><span class="kp-bar"><i style="width:${Math.round((s.pctDone || 0) * 100)}%"></i></span> <strong>${pct(s.pctDone, 1)}</strong></td>
      <td>${pct(s.pctOntime)}</td><td>${compliantBadge(s.compliant)}</td><td>${s.gallery}</td></tr>`).join("") || `<tr><td colspan="12">Tidak ada slot wajib pada periode ini.</td></tr>`}</tbody>
    ${r.stores.length ? `<tfoot><tr><td></td><td><strong>Total</strong></td><td></td><td><strong>${t.expected}</strong></td><td><strong>${t.ONTIME}</strong></td><td><strong>${t.EARLY}</strong></td><td><strong>${t.LATE}</strong></td><td><strong>${t.MISSED}</strong></td><td><strong>${pct(t.pctDone, 1)}</strong></td><td><strong>${pct(t.pctOntime)}</strong></td><td></td><td><strong>${t.gallery}</strong></td></tr></tfoot>` : ""}`;

  // peta harian
  const days = r.days.slice(-MAX_HEAT_DAYS);
  $("kpHeatNote").hidden = r.days.length <= MAX_HEAT_DAYS;
  $("kpHeatNote").textContent = `Menampilkan ${MAX_HEAT_DAYS} hari terakhir dari ${r.days.length} hari. Excel memuat semua hari.`;
  $("kpLegend").innerHTML = [["good", `≥ target (${tgt}%)`], ["warning", "50% s/d di bawah target"], ["serious", "di bawah 50%"], ["critical", "0 (tidak ada filter)"], ["none", "belum wajib"]]
    .map(([k, l]) => `<li><span class="kp-sw kp-${k}"></span>${esc(l)}</li>`).join("");
  $("kpHeat").innerHTML = `<thead><tr><th class="kp-sticky">Store</th>${days.map((d) => `<th>${esc(dayName(d).slice(0, 3))}<br>${d.slice(8, 10)}/${d.slice(5, 7)}</th>`).join("")}</tr></thead><tbody>${
    r.stores.map((s) => `<tr><th class="kp-sticky">${esc(s.name)}</th>${days.map((d) => {
      const x = s.daily[d];
      if (!x) return `<td class="kp-none" tabindex="0" data-tip="${esc(`${s.name} · ${fmtDate(d)}: belum wajib`)}">–</td>`;
      const tip = `${s.name} · ${dayName(d)} ${fmtDate(d)}\nDikerjakan ${x.done}/${x.expected} (${pct(x.pctDone)})\nTepat waktu ${x.ONTIME} · awal ${x.EARLY} · terlambat ${x.LATE} · tidak dikerjakan ${x.MISSED}`;
      return `<td class="kp-${dayTone(x, r.target)}" tabindex="0" data-tip="${esc(tip)}" aria-label="${esc(tip)}">${x.done}/${x.expected}</td>`;
    }).join("")}</tr>`).join("")}</tbody>`;

  renderDetail();
}

function renderDetail() {
  const r = ui.report;
  let rows = r.rows.filter((x) => (!ui.storeDetail || x.storeId === ui.storeDetail) && (!ui.onlyIssues || x.status !== "ONTIME"));
  rows = rows.sort((a, b) => b.date.localeCompare(a.date) || a.store.localeCompare(b.store, "id") || a.slotId.localeCompare(b.slotId));
  const shown = rows.slice(0, MAX_DETAIL_ROWS);
  const nm = ui.storeDetail ? r.stores.find((s) => s.id === ui.storeDetail)?.name : "";
  $("kpDetailHint").textContent = `${rows.length} slot${ui.onlyIssues ? " bermasalah" : ""}${nm ? ` di ${nm}` : ""}, terbaru di atas.${nm ? " Klik baris store lagi untuk melihat semua store." : ""}`;
  $("kpDetailNote").hidden = rows.length <= MAX_DETAIL_ROWS;
  $("kpDetailNote").textContent = `Menampilkan ${MAX_DETAIL_ROWS} dari ${rows.length} baris. Semua baris ada di file Excel.`;
  const dev = (d) => (d === null ? "" : `${d > 0 ? "+" : ""}${d}`);
  $("kpDetail").innerHTML = `<thead><tr><th>Tanggal</th><th>Hari</th><th>Store</th><th>Slot</th><th>Jam slot</th><th>Jam aktual</th><th>Selisih (mnt)</th><th>Status</th><th>Crew</th><th>Foto</th><th>Catatan</th></tr></thead>
    <tbody>${shown.map((x) => `<tr><td>${fmtDate(x.date)}</td><td>${esc(x.day)}</td><td>${esc(x.store)}</td><td>${esc(x.slot)}</td><td>${esc(x.planned)}</td><td>${esc(x.actual) || "–"}</td><td>${dev(x.deviation)}</td><td>${statusBadge(x.status)}</td><td>${esc(x.crew)}</td><td>${x.photo === "Dari galeri" ? `<strong>${esc(x.photo)}</strong>` : esc(x.photo)}</td><td class="kp-note">${esc(x.note)}</td></tr>`).join("") || `<tr><td colspan="11">Tidak ada slot bermasalah. 👍</td></tr>`}</tbody>`;
}

function initTooltip() {
  const tip = $("kpTip"), heat = $("kpHeat");
  const show = (el) => {
    const text = el.getAttribute("data-tip"); if (!text) return;
    tip.textContent = ""; text.split("\n").forEach((line, i) => { if (i) tip.appendChild(document.createElement("br")); tip.appendChild(document.createTextNode(line)); });
    tip.hidden = false;
    const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = `${Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8))}px`;
    tip.style.top = `${r.top - h - 8 < 8 ? r.bottom + 8 : r.top - h - 8}px`;
  };
  const hide = () => { tip.hidden = true; };
  for (const ev of ["mouseover", "focusin", "click"]) heat.addEventListener(ev, (e) => { const td = e.target.closest("td[data-tip]"); if (td) show(td); });
  heat.addEventListener("mouseout", hide); heat.addEventListener("focusout", hide);
  window.addEventListener("scroll", hide, { passive: true });
}

function initPanel() {
  const sec = $("kepatuhan");
  if (!sec || sec.dataset.ready) return;
  sec.dataset.ready = "1";
  sec.innerHTML = TEMPLATE;
  const today = ymdWib(Date.now());
  $("kpFrom").value = addDays(today, -6); $("kpTo").value = today;
  let loaded = false;
  const ensure = () => { if (!loaded) { loaded = true; loadPanel(); } };
  document.querySelector('.tab[data-tab="kepatuhan"]')?.addEventListener("click", ensure);
  if (sec.classList.contains("active")) ensure();
  $("kpLoad").addEventListener("click", () => busy($("kpLoad"), "Memuat…", () => loadPanel(true)));
  for (const id of ["kpFrom", "kpTo", "kpStore"]) $(id).addEventListener("change", () => loadPanel());
  $("kpTarget").addEventListener("change", () => loadPanel());
  $("kpOnlyIssues").addEventListener("change", (e) => { ui.onlyIssues = e.target.checked; if (ui.report) renderDetail(); });
  const pick = (tr) => { ui.storeDetail = ui.storeDetail === tr.dataset.store ? "" : tr.dataset.store; render(); if (ui.storeDetail) $("kpDetailCard").scrollIntoView({ behavior: "smooth", block: "start" }); };
  $("kpStores").addEventListener("click", (e) => { const tr = e.target.closest("tr[data-store]"); if (tr) pick(tr); });
  $("kpStores").addEventListener("keydown", (e) => { const tr = e.target.closest("tr[data-store]"); if (tr && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); pick(tr); } });
  $("kpExport").addEventListener("click", () => busy($("kpExport"), "Menyiapkan Excel…", async () => {
    const p = params();
    if (!p.start || !p.end) { toast("Isi Periode Dari dan Sampai dulu."); return; }
    try { const r = await exportExcel(p, await getData(p.start, p.end)); toast(`Excel terunduh: ${r.stores.length} store, ${r.rows.length} slot.`); }
    catch (err) { toast(`Export gagal: ${err.message}`); }
  }));
  initTooltip();
}

function init() {
  try { initDashboardExport(); } catch (e) { console.error("kepatuhan: tombol export dashboard", e); }
  try { initPanel(); } catch (e) { console.error("kepatuhan: panel", e); }
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
