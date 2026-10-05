// Halaman Kepatuhan Filter Oil: baca data app Trecking Filter Oil (Firestore REST), tampilkan store yang
// tidak patuh, dan export Excel berformula. Tidak menulis apa pun ke database.
import { buildReport, STATUS, ymdWib, addDays, fmtDate, dayName } from "./kepatuhan.js";
import { loadStores, loadSettings, loadRecords, loadExcelJS, buildWorkbook, downloadWorkbook, wibNowLabel, exportFileName } from "./core.js";
const MAX_HEAT_DAYS = 31;
const MAX_DETAIL_ROWS = 400;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const pct = (x, d = 0) => (x === null || x === undefined || Number.isNaN(x) ? "–" : `${(x * 100).toFixed(d).replace(".", ",")}%`);
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* abaikan */ } } };

const state = {
  stores: null, settings: null, records: [], loadedRange: null, loadedAt: 0,
  start: "", end: "", area: store.get("fo.area") || "", target: Number(store.get("fo.target95")) || 95,
  storeFilter: "", onlyIssues: true, report: null, preset: store.get("fo.preset") || "7",
};

// ---------- periode ----------
function presetRange(p) {
  const today = ymdWib(Date.now());
  if (p === "today") return [today, today];
  if (p === "yesterday") { const y = addDays(today, -1); return [y, y]; }
  if (p === "month") return [`${today.slice(0, 8)}01`, today];
  const n = Number(p) || 7;
  return [addDays(today, -(n - 1)), today];
}
function setPreset(p) {
  state.preset = p; store.set("fo.preset", p);
  [state.start, state.end] = presetRange(p);
  $("start").value = state.start; $("end").value = state.end;
  document.querySelectorAll("[data-preset]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.preset === p)));
}

// ---------- muat & hitung ----------
async function refresh(force = false) {
  const errBox = $("error");
  errBox.hidden = true;
  $("sub").textContent = "Memuat data…";
  $("btnExport").disabled = true;
  try {
    if (force || !state.stores) [state.stores, state.settings] = await Promise.all([loadStores(), loadSettings()]);
    const key = `${state.start}|${state.end}`;
    if (force || state.loadedRange !== key) { state.records = await loadRecords(state.start, state.end); state.loadedRange = key; state.loadedAt = Date.now(); }
    recompute();
  } catch (e) {
    errBox.textContent = `Data gagal dimuat: ${e.message}`;
    errBox.hidden = false;
    $("sub").textContent = "Data gagal dimuat";
  }
}
function recompute() {
  state.report = buildReport({
    stores: state.stores, records: state.records, settings: state.settings || {},
    start: state.start, end: state.end, nowMs: Date.now(), area: state.area, target: state.target / 100,
  });
  render();
  $("btnExport").disabled = !state.report.rows.length;
}

// ---------- render ----------
const tone = (s) => (STATUS[s] || STATUS.MISSED).tone;
const badge = (key) => { const s = STATUS[key] || STATUS.MISSED; return `<span class="badge t-${s.tone}"><span class="ic" aria-hidden="true">${s.icon}</span>${esc(s.label)}</span>`; };
const compliantBadge = (ok) => (ok ? `<span class="badge t-good"><span class="ic" aria-hidden="true">✓</span>Patuh</span>` : `<span class="badge t-critical"><span class="ic" aria-hidden="true">✕</span>Tidak patuh</span>`);
function dayTone(d, target) {
  if (!d || !d.expected) return "none";
  if (d.pctDone >= target - 1e-9) return "good";
  if (d.pctDone >= 0.5) return "warning";
  if (d.pctDone > 0) return "serious";
  return "critical";
}

function render() {
  const r = state.report;
  const areaSel = $("area");
  if (areaSel.options.length <= 1) for (const a of r.areas) areaSel.add(new Option(a, a));
  areaSel.value = state.area;

  const loaded = new Date(state.loadedAt + 7 * 3600_000).toISOString().slice(11, 16).replace(":", ".");
  $("sub").textContent = `${fmtDate(r.start)} s/d ${fmtDate(r.end)} · ${r.stores.length} store${state.area ? ` · ${state.area}` : ""} · data dimuat ${loaded} WIB`;

  // KPI
  const t = r.total;
  const tiles = [
    { label: "Compliance", value: pct(t.pctDone, 1), note: `${t.done} dari ${t.expected} slot dikerjakan · target ${state.target}%`, cls: t.pctDone === null ? "" : t.pctDone >= r.target ? "ok-kpi" : "alert-kpi" },
    { label: "Tepat waktu", value: String(t.ONTIME), note: `${pct(t.pctOntime, 1)} slot dalam ±${r.tol} menit` },
    { label: "Early / Late", value: String(t.EARLY + t.LATE), note: `${t.EARLY} terlalu awal · ${t.LATE} terlambat` },
    { label: "Tidak dikerjakan", value: String(t.MISSED), note: `${pct(t.expected ? t.MISSED / t.expected : null, 1)} dari slot wajib`, cls: t.MISSED ? "alert-kpi" : "ok-kpi" },
    { label: "Store tidak patuh", value: `${r.nonCompliant}/${r.stores.length}`, note: `compliance di bawah ${state.target}%`, cls: r.nonCompliant ? "alert-kpi" : "ok-kpi" },
  ];
  $("kpis").innerHTML = tiles.map((k) => `<div class="kpi ${k.cls || ""}"><div class="label">${esc(k.label)}</div><div class="value">${esc(k.value)}</div><div class="note">${esc(k.note)}</div></div>`).join("");

  // peringkat store
  const rows = r.stores.map((s, i) => `<tr class="clickable${state.storeFilter === s.id ? " selected" : ""}" data-store="${esc(s.id)}" tabindex="0">
    <td class="num muted">${i + 1}</td><td><strong>${esc(s.name)}</strong></td><td>${esc(s.area)}</td>
    <td class="num">${s.expected}</td><td class="num">${s.ONTIME}</td><td class="num">${s.EARLY}</td><td class="num">${s.LATE}</td>
    <td class="num">${s.MISSED ? `<strong>${s.MISSED}</strong>` : 0}</td>
    <td><span class="scorecell"><span class="scorebar" aria-hidden="true"><i style="width:${Math.round((s.pctDone || 0) * 100)}%"></i></span><strong>${pct(s.pctDone, 1)}</strong></span></td>
    <td class="num">${pct(s.pctOntime)}</td><td class="num">${pct(s.score)}</td>
    <td>${compliantBadge(s.compliant)}</td><td class="num">${s.gallery}</td></tr>`).join("");
  $("tblStores").innerHTML = `<thead><tr><th class="num">#</th><th>Store</th><th>Area</th><th class="num">Slot wajib</th><th class="num">Tepat waktu</th><th class="num">Terlalu awal</th><th class="num">Terlambat</th><th class="num">Tidak dikerjakan</th><th>Compliance</th><th class="num">% Tepat waktu</th><th class="num" title="Tepat waktu = 1, terlalu awal / terlambat = 0,5, tidak dikerjakan = 0">Skor tertimbang</th><th>Status</th><th class="num" title="Foto bukti diambil dari galeri/berkas, bukan kamera app (tingkat kepercayaan rendah)">Foto galeri</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="13" class="muted">Tidak ada slot wajib pada periode ini.</td></tr>`}</tbody>
    ${r.stores.length ? `<tfoot><tr><td></td><td>Total</td><td></td><td class="num">${t.expected}</td><td class="num">${t.ONTIME}</td><td class="num">${t.EARLY}</td><td class="num">${t.LATE}</td><td class="num">${t.MISSED}</td><td>${pct(t.pctDone, 1)}</td><td class="num">${pct(t.pctOntime)}</td><td class="num">${pct(t.score)}</td><td></td><td class="num">${t.gallery}</td></tr></tfoot>` : ""}`;

  renderHeat(r);
  renderDetail(r);

  const sl = r.slots.map((s) => `${s.label} jam ${s.time.replace(":", ".")}`).join(", ");
  $("rules").innerHTML = [
    `Slot wajib per store per hari: ${esc(sl)} (dari pengaturan app), mulai tanggal aktif store.`,
    `Compliance = slot dikerjakan ÷ slot wajib (sama dengan dashboard app). Store "Tidak patuh" bila compliance di bawah target ${state.target}%.`,
    `Tepat waktu = dalam ±${r.tol} menit dari jam slot. Di luar itu = terlalu awal / terlambat (tetap dihitung dikerjakan). Skor tertimbang: tepat waktu 1, awal/terlambat 0,5, tidak dikerjakan 0.`,
    `Slot hari ini baru dihitung setelah jam slot + ${r.tol} menit lewat${r.pending ? ` (saat ini ${r.pending} slot belum jatuh tempo)` : ""}. Dashboard app sudah menghitung slot yang belum jatuh tempo sebagai wajib, jadi angka hari ini bisa sedikit berbeda; untuk hari yang sudah lewat angkanya sama.`,
    `Foto galeri = waktu bukti diambil dari berkas foto (trust LOW), bukan kamera app. Perlu dicek bila jumlahnya tinggi.`,
  ].map((x) => `<li>${x}</li>`).join("");
}

function renderHeat(r) {
  const days = r.days.slice(-MAX_HEAT_DAYS);
  $("heatNote").hidden = r.days.length <= MAX_HEAT_DAYS;
  $("heatNote").textContent = `Menampilkan ${MAX_HEAT_DAYS} hari terakhir dari ${r.days.length} hari. Excel memuat semua hari.`;
  const tones = [["good", `semua/≥ target (${state.target}%)`], ["warning", "50% s/d di bawah target"], ["serious", "di bawah 50%"], ["critical", "0 (tidak ada filter)"], ["none", "belum wajib"]];
  $("legendHeat").innerHTML = tones.map(([k, l]) => `<li><span class="sw" style="background:var(--${k === "none" ? "none" : k}-bg);box-shadow:inset 0 -3px 0 var(--${k === "none" ? "border" : k})"></span>${esc(l)}</li>`).join("");
  const head = `<thead><tr><th class="store">Store</th>${days.map((d) => `<th class="d">${esc(dayName(d).slice(0, 3))}<br>${d.slice(8, 10)}/${d.slice(5, 7)}</th>`).join("")}</tr></thead>`;
  const body = r.stores.map((s) => `<tr><th class="store" scope="row">${esc(s.name)}</th>${days.map((d) => {
    const x = s.daily[d];
    const tn = dayTone(x, r.target);
    if (!x) return `<td class="h-none" tabindex="0" data-tip="${esc(`${s.name} · ${fmtDate(d)}: belum wajib`)}">–</td>`;
    const tip = `${s.name} · ${dayName(d)} ${fmtDate(d)}\nDikerjakan ${x.done}/${x.expected} (${pct(x.pctDone)})\nTepat waktu ${x.ONTIME} · awal ${x.EARLY} · terlambat ${x.LATE} · tidak dikerjakan ${x.MISSED}`;
    return `<td class="h-${tn}" tabindex="0" data-tip="${esc(tip)}" aria-label="${esc(tip)}">${x.done}/${x.expected}</td>`;
  }).join("")}</tr>`).join("");
  $("heat").innerHTML = head + `<tbody>${body}</tbody>`;
}

function renderDetail(r) {
  const sel = $("storeFilter");
  const cur = state.storeFilter;
  sel.innerHTML = `<option value="">Semua store</option>` + r.stores.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("");
  sel.value = r.stores.some((s) => s.id === cur) ? cur : "";
  state.storeFilter = sel.value;
  $("onlyIssues").checked = state.onlyIssues;

  let rows = r.rows.filter((x) => (!state.storeFilter || x.storeId === state.storeFilter) && (!state.onlyIssues || x.status !== "ONTIME"));
  rows = rows.sort((a, b) => b.date.localeCompare(a.date) || a.store.localeCompare(b.store, "id") || a.slotId.localeCompare(b.slotId));
  const shown = rows.slice(0, MAX_DETAIL_ROWS);
  $("detailHint").textContent = `${rows.length} slot${state.onlyIssues ? " bermasalah" : ""}${state.storeFilter ? ` di ${r.stores.find((s) => s.id === state.storeFilter)?.name || ""}` : ""}, terbaru di atas.`;
  $("detailNote").hidden = rows.length <= MAX_DETAIL_ROWS;
  $("detailNote").textContent = `Menampilkan ${MAX_DETAIL_ROWS} dari ${rows.length} baris. Semua baris ada di file Excel.`;
  const dev = (d) => (d === null ? "" : `${d > 0 ? "+" : ""}${d}`);
  $("tblDetail").innerHTML = `<thead><tr><th>Tanggal</th><th>Hari</th><th>Store</th><th>Slot</th><th>Jam slot</th><th>Jam aktual</th><th class="num">Selisih (mnt)</th><th>Status</th><th class="num">Skor</th><th>Crew</th><th>Foto</th><th>Catatan</th></tr></thead>
    <tbody>${shown.map((x) => `<tr><td>${fmtDate(x.date)}</td><td>${esc(x.day)}</td><td>${esc(x.store)}</td><td>${esc(x.slot)}</td><td>${esc(x.planned)}</td><td>${esc(x.actual) || `<span class="muted">–</span>`}</td><td class="num">${dev(x.deviation)}</td><td>${badge(x.status)}</td><td class="num">${String(x.score).replace(".", ",")}</td><td>${esc(x.crew)}</td><td>${x.photo === "Dari galeri" ? `<strong>${esc(x.photo)}</strong>` : esc(x.photo)}</td><td class="note">${esc(x.note)}</td></tr>`).join("") || `<tr><td colspan="12" class="muted">Tidak ada slot bermasalah. 👍</td></tr>`}</tbody>`;
}

// ---------- tooltip peta harian ----------
function initTooltip() {
  const tip = $("tip");
  const show = (el) => {
    const text = el.getAttribute("data-tip"); if (!text) return;
    tip.textContent = ""; text.split("\n").forEach((line, i) => { if (i) tip.appendChild(document.createElement("br")); tip.appendChild(document.createTextNode(line)); });
    tip.hidden = false;
    const r = el.getBoundingClientRect(); const w = tip.offsetWidth, h = tip.offsetHeight;
    let left = r.left + r.width / 2 - w / 2; left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    let top = r.top - h - 8; if (top < 8) top = r.bottom + 8;
    tip.style.left = `${left}px`; tip.style.top = `${top}px`;
  };
  const hide = () => { tip.hidden = true; };
  const heat = $("heat");
  heat.addEventListener("mouseover", (e) => { const td = e.target.closest("td[data-tip]"); if (td) show(td); });
  heat.addEventListener("mouseout", hide);
  heat.addEventListener("focusin", (e) => { const td = e.target.closest("td[data-tip]"); if (td) show(td); });
  heat.addEventListener("focusout", hide);
  heat.addEventListener("click", (e) => { const td = e.target.closest("td[data-tip]"); if (td) show(td); });
  window.addEventListener("scroll", hide, { passive: true });
}

async function exportExcel() {
  const btn = $("btnExport");
  const label = btn.innerHTML;
  btn.disabled = true; btn.textContent = "Menyiapkan Excel…";
  try {
    const ExcelJS = await loadExcelJS();
    const r = state.report;
    const wb = await buildWorkbook(ExcelJS, r, { area: state.area, generatedAt: wibNowLabel() });
    await downloadWorkbook(wb, exportFileName(r, state.area));
  } catch (e) {
    const box = $("error"); box.textContent = `Export gagal: ${e.message}`; box.hidden = false;
  } finally {
    btn.innerHTML = label; btn.disabled = false;
  }
}

// ---------- event ----------
function init() {
  document.querySelectorAll("[data-preset]").forEach((b) => b.addEventListener("click", () => { setPreset(b.dataset.preset); refresh(); }));
  const onDate = () => {
    const s = $("start").value, e = $("end").value;
    if (!s || !e) return;
    state.preset = "custom"; document.querySelectorAll("[data-preset]").forEach((b) => b.setAttribute("aria-pressed", "false"));
    [state.start, state.end] = s <= e ? [s, e] : [e, s];
    refresh();
  };
  $("start").addEventListener("change", onDate);
  $("end").addEventListener("change", onDate);
  $("area").addEventListener("change", (e) => { state.area = e.target.value; store.set("fo.area", state.area); state.storeFilter = ""; recompute(); });
  $("target").value = state.target;
  $("target").addEventListener("change", (e) => { const v = Math.min(100, Math.max(0, Number(e.target.value) || 0)); e.target.value = v; state.target = v; store.set("fo.target95", String(v)); recompute(); });
  $("btnReload").addEventListener("click", () => refresh(true));
  $("btnExport").addEventListener("click", exportExcel);
  $("storeFilter").addEventListener("change", (e) => { state.storeFilter = e.target.value; render(); });
  $("onlyIssues").addEventListener("change", (e) => { state.onlyIssues = e.target.checked; renderDetail(state.report); });
  const pick = (tr) => { state.storeFilter = state.storeFilter === tr.dataset.store ? "" : tr.dataset.store; render(); if (state.storeFilter) $("detailCard").scrollIntoView({ behavior: "smooth", block: "start" }); };
  $("tblStores").addEventListener("click", (e) => { const tr = e.target.closest("tr[data-store]"); if (tr) pick(tr); });
  $("tblStores").addEventListener("keydown", (e) => { const tr = e.target.closest("tr[data-store]"); if (tr && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); pick(tr); } });
  initTooltip();
  setPreset(["today", "yesterday", "7", "30", "month"].includes(state.preset) ? state.preset : "7");
  refresh();
}

if (typeof document !== "undefined") init();
