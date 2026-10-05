// Halaman Kepatuhan Filter Oil: baca data app Trecking Filter Oil (Firestore REST), tampilkan store yang
// tidak patuh, dan export Excel berformula. Tidak menulis apa pun ke database.
import { buildReport, STATUS, ymdWib, addDays, fmtDate, dayName } from "./kepatuhan.js";

const PROJECT = "trecking-filter-oil-store";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const RECORD_FIELDS = ["storeId", "storeName", "slotId", "dateKey", "deviationMin", "complianceScore", "status", "metadataTrust",
  "evidenceTimeSource", "evidenceLocalIso", "submittedAt", "crewName", "note", "dedupArchived"];
const MAX_HEAT_DAYS = 31;
const MAX_DETAIL_ROWS = 400;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const pct = (x, d = 0) => (x === null || x === undefined || Number.isNaN(x) ? "–" : `${(x * 100).toFixed(d).replace(".", ",")}%`);
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* abaikan */ } } };

const state = {
  stores: null, settings: null, records: [], loadedRange: null, loadedAt: 0,
  start: "", end: "", area: store.get("fo.area") || "", target: Number(store.get("fo.target")) || 90,
  storeFilter: "", onlyIssues: true, report: null, preset: store.get("fo.preset") || "7",
};

// ---------- Firestore REST ----------
async function api(url, body) {
  const res = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* bukan JSON */ }
  if (!res.ok) {
    const msg = (Array.isArray(json) ? json[0] : json)?.error?.message || `HTTP ${res.status}`;
    throw new Error(res.status === 403 ? `Akses data ditolak (${msg}). Aturan keamanan database mungkin sudah diperketat; halaman ini perlu disesuaikan.` : msg);
  }
  return json;
}
function val(v) {
  if (!v || typeof v !== "object") return undefined;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("nullValue" in v) return null;
  if ("referenceValue" in v) return decodeURIComponent(v.referenceValue.split("/").pop());
  return undefined;
}
const flat = (doc) => ({ id: decodeURIComponent(doc.name.split("/").pop()), ...Object.fromEntries(Object.entries(doc.fields || {}).map(([k, v]) => [k, val(v)])) });

async function loadStores() {
  const out = []; let token = "";
  do {
    const j = await api(`${BASE}/stores?pageSize=300${token ? `&pageToken=${encodeURIComponent(token)}` : ""}`);
    out.push(...(j.documents || []).map(flat)); token = j.nextPageToken || "";
  } while (token);
  return out;
}
async function loadSettings() {
  try { return flat(await api(`${BASE}/settings/app`)); } catch { return {}; }
}
async function loadRecords(start, end) {
  const ff = (op, value) => ({ fieldFilter: { field: { fieldPath: "dateKey" }, op, value: { stringValue: value } } });
  const j = await api(`${BASE}:runQuery`, {
    structuredQuery: {
      from: [{ collectionId: "filterRecords" }],
      where: { compositeFilter: { op: "AND", filters: [ff("GREATER_THAN_OR_EQUAL", start), ff("LESS_THAN_OR_EQUAL", end)] } },
      select: { fields: RECORD_FIELDS.map((f) => ({ fieldPath: f })) },
    },
  });
  return (Array.isArray(j) ? j : []).filter((x) => x.document).map((x) => flat(x.document));
}

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
  if (d.score >= target - 1e-9) return "good";
  if (d.score >= 0.5) return "warning";
  if (d.score > 0) return "serious";
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
    { label: "Skor kepatuhan", value: pct(t.score), note: `Target ${state.target}% · ON TIME = 1, awal/terlambat = 0,5`, cls: t.score === null ? "" : t.score >= r.target ? "ok-kpi" : "alert-kpi" },
    { label: "Slot terlaksana", value: pct(t.pctDone), note: `${t.done} dari ${t.expected} slot wajib` },
    { label: "Tepat waktu", value: pct(t.pctOntime), note: `${t.ONTIME} slot dalam ±${r.tol} menit` },
    { label: "Tidak dikerjakan", value: String(t.MISSED), note: `${t.EARLY} terlalu awal · ${t.LATE} terlambat`, cls: t.MISSED ? "alert-kpi" : "ok-kpi" },
    { label: "Store tidak patuh", value: `${r.nonCompliant}/${r.stores.length}`, note: `skor di bawah ${state.target}%`, cls: r.nonCompliant ? "alert-kpi" : "ok-kpi" },
  ];
  $("kpis").innerHTML = tiles.map((k) => `<div class="kpi ${k.cls || ""}"><div class="label">${esc(k.label)}</div><div class="value">${esc(k.value)}</div><div class="note">${esc(k.note)}</div></div>`).join("");

  // peringkat store
  const rows = r.stores.map((s, i) => `<tr class="clickable${state.storeFilter === s.id ? " selected" : ""}" data-store="${esc(s.id)}" tabindex="0">
    <td class="num muted">${i + 1}</td><td><strong>${esc(s.name)}</strong></td><td>${esc(s.area)}</td>
    <td class="num">${s.expected}</td><td class="num">${s.ONTIME}</td><td class="num">${s.EARLY}</td><td class="num">${s.LATE}</td>
    <td class="num">${s.MISSED ? `<strong>${s.MISSED}</strong>` : 0}</td><td class="num">${pct(s.pctDone)}</td>
    <td><span class="scorecell"><span class="scorebar" aria-hidden="true"><i style="width:${Math.round((s.score || 0) * 100)}%"></i></span><strong>${pct(s.score)}</strong></span></td>
    <td>${compliantBadge(s.compliant)}</td><td class="num">${s.gallery}</td></tr>`).join("");
  $("tblStores").innerHTML = `<thead><tr><th class="num">#</th><th>Store</th><th>Area</th><th class="num">Slot wajib</th><th class="num">Tepat waktu</th><th class="num">Terlalu awal</th><th class="num">Terlambat</th><th class="num">Tidak dikerjakan</th><th class="num">Terlaksana</th><th>Skor</th><th>Status</th><th class="num" title="Foto bukti diambil dari galeri/berkas, bukan kamera app (tingkat kepercayaan rendah)">Foto galeri</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="12" class="muted">Tidak ada slot wajib pada periode ini.</td></tr>`}</tbody>
    ${r.stores.length ? `<tfoot><tr><td></td><td>Total</td><td></td><td class="num">${t.expected}</td><td class="num">${t.ONTIME}</td><td class="num">${t.EARLY}</td><td class="num">${t.LATE}</td><td class="num">${t.MISSED}</td><td class="num">${pct(t.pctDone)}</td><td>${pct(t.score)}</td><td></td><td class="num">${t.gallery}</td></tr></tfoot>` : ""}`;

  renderHeat(r);
  renderDetail(r);

  const sl = r.slots.map((s) => `${s.label} jam ${s.time.replace(":", ".")}`).join(", ");
  $("rules").innerHTML = [
    `Slot wajib per store per hari: ${esc(sl)} (dari pengaturan app), mulai tanggal aktif store.`,
    `Tepat waktu = dalam ±${r.tol} menit dari jam slot (skor 1). Terlalu awal / terlambat = di luar toleransi (skor 0,5). Tidak ada catatan = tidak dikerjakan (skor 0).`,
    `Slot hari ini baru dihitung setelah jam slot + ${r.tol} menit lewat${r.pending ? ` (saat ini ${r.pending} slot belum jatuh tempo)` : ""}.`,
    `Skor kepatuhan = total skor ÷ slot wajib. Store "Tidak patuh" bila skor di bawah target ${state.target}%.`,
    `Foto galeri = waktu bukti diambil dari berkas foto (trust LOW), bukan kamera app. Perlu dicek bila jumlahnya tinggi.`,
  ].map((x) => `<li>${x}</li>`).join("");
}

function renderHeat(r) {
  const days = r.days.slice(-MAX_HEAT_DAYS);
  $("heatNote").hidden = r.days.length <= MAX_HEAT_DAYS;
  $("heatNote").textContent = `Menampilkan ${MAX_HEAT_DAYS} hari terakhir dari ${r.days.length} hari. Excel memuat semua hari.`;
  const tones = [["good", `≥ target (${state.target}%)`], ["warning", "50% s/d di bawah target"], ["serious", "di bawah 50%"], ["critical", "0 (tidak ada filter)"], ["none", "belum wajib"]];
  $("legendHeat").innerHTML = tones.map(([k, l]) => `<li><span class="sw" style="background:var(--${k === "none" ? "none" : k}-bg);box-shadow:inset 0 -3px 0 var(--${k === "none" ? "border" : k})"></span>${esc(l)}</li>`).join("");
  const head = `<thead><tr><th class="store">Store</th>${days.map((d) => `<th class="d">${esc(dayName(d).slice(0, 3))}<br>${d.slice(8, 10)}/${d.slice(5, 7)}</th>`).join("")}</tr></thead>`;
  const body = r.stores.map((s) => `<tr><th class="store" scope="row">${esc(s.name)}</th>${days.map((d) => {
    const x = s.daily[d];
    const tn = dayTone(x, r.target);
    if (!x) return `<td class="h-none" tabindex="0" data-tip="${esc(`${s.name} · ${fmtDate(d)}: belum wajib`)}">–</td>`;
    const tip = `${s.name} · ${dayName(d)} ${fmtDate(d)}\nTerlaksana ${x.done}/${x.expected} · skor ${pct(x.score)}\nTepat waktu ${x.ONTIME} · awal ${x.EARLY} · terlambat ${x.LATE} · tidak dikerjakan ${x.MISSED}`;
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

// ---------- export Excel ----------
function loadExcelJS() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "vendor/exceljs.min.js";
    s.onload = () => (window.ExcelJS ? resolve(window.ExcelJS) : reject(new Error("ExcelJS tidak termuat")));
    s.onerror = () => reject(new Error("Pustaka Excel gagal dimuat"));
    document.head.appendChild(s);
  });
}
const NAVY = "FF1F3864";
const headerStyle = (row) => {
  row.eachCell((c) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" }, name: "Arial", size: 10 };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    c.border = { bottom: { style: "thin", color: { argb: "FFBFBFBF" } } };
  });
  row.height = 30;
};
const xlDate = (ymd) => new Date(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10))));
const colLetter = (n) => { let s = ""; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

export async function buildWorkbook(ExcelJS, r, opts) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Kepatuhan Filter Oil"; wb.created = new Date();
  wb.calcProperties = { fullCalcOnLoad: true };
  const D = "'Detail Slot'";
  const nDetail = r.rows.length;
  const last = nDetail + 1; // baris data detail: 2..last
  const rng = (col) => `${D}!$${col}$2:$${col}$${Math.max(last, 2)}`;
  // Tab dibuat sesuai urutan tampil: Ringkasan, Harian, Detail Slot, Parameter (rumus antar-sheet tidak bergantung urutan).
  const withDaily = r.days.length > 0 && r.days.length <= 62 && r.stores.length > 0;
  const R = wb.addWorksheet("Ringkasan Store", { views: [{ state: "frozen", ySplit: 4, xSplit: 1 }], properties: { tabColor: { argb: NAVY } } });
  const H = withDaily ? wb.addWorksheet("Harian", { views: [{ state: "frozen", ySplit: 3, xSplit: 1 }] }) : null;
  const S = wb.addWorksheet("Detail Slot", { views: [{ state: "frozen", ySplit: 1 }] });
  const P = wb.addWorksheet("Parameter", { properties: { tabColor: { argb: "FF85827A" } } });

  // --- Parameter ---
  P.columns = [{ width: 30 }, { width: 22 }, { width: 70 }];
  P.addRow(["Parameter", "Nilai", "Keterangan"]); headerStyle(P.getRow(1));
  const prm = [
    ["Periode awal", xlDate(r.start), "Tanggal pertama laporan"],
    ["Target skor kepatuhan", r.target, "INPUT: ubah angka ini, kolom Status di Ringkasan Store ikut berubah"],
    ["Periode akhir", xlDate(r.end), "Tanggal terakhir laporan (maksimal hari ini)"],
    ["Toleransi (menit)", r.tol, "Selisih dari jam slot yang masih dihitung tepat waktu (dari pengaturan app)"],
    ...r.slots.map((s) => [`Jam ${s.label}`, s.time, "Slot wajib per store per hari (dari pengaturan app)"]),
    ["Area", opts.area || "Semua area", "Filter area saat export"],
    ["Dibuat (WIB)", opts.generatedAt, "Waktu file dibuat"],
    ["Sumber data", "Firestore app Trecking Filter Oil (trecking-filter-oil-store), koleksi filterRecords, stores, settings", ""],
    ["Skor per slot", "Tepat waktu = 1; Terlalu awal / Terlambat = 0,5; Tidak dikerjakan = 0", "Mengikuti complianceScore di app"],
    ["Slot hari ini", `${r.pending} slot belum jatuh tempo tidak dihitung`, "Slot dihitung setelah jam slot + toleransi lewat"],
  ];
  // urutan baris dijaga agar target ada di B3 (dipakai rumus Status)
  prm.forEach((p) => P.addRow(p));
  P.getCell("B2").numFmt = "dd/mm/yyyy"; P.getCell("B4").numFmt = "dd/mm/yyyy";
  P.getCell("B3").numFmt = "0%"; P.getCell("B3").font = { color: { argb: "FF0000FF" }, bold: true, name: "Arial" };
  P.getCell("B3").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF9D9" } };
  P.eachRow((row, i) => { if (i > 1) row.eachCell((c) => { if (!c.font || !c.font.color) c.font = { name: "Arial", size: 10 }; c.alignment = { vertical: "top", wrapText: true }; }); });

  // --- Detail Slot (data) ---
  S.columns = [
    { header: "Tanggal", key: "date", width: 12 }, { header: "Hari", key: "day", width: 9 }, { header: "Store", key: "store", width: 20 },
    { header: "Area", key: "area", width: 14 }, { header: "Slot", key: "slot", width: 10 }, { header: "Jam slot", key: "planned", width: 9 },
    { header: "Jam aktual", key: "actual", width: 12 }, { header: "Selisih (menit)", key: "deviation", width: 10 }, { header: "Status", key: "status", width: 16 },
    { header: "Skor", key: "score", width: 7 }, { header: "Crew", key: "crew", width: 22 }, { header: "Sumber foto", key: "photo", width: 13 },
    { header: "Catatan", key: "note", width: 40 },
  ];
  headerStyle(S.getRow(1));
  const sorted = [...r.rows].sort((a, b) => a.date.localeCompare(b.date) || a.store.localeCompare(b.store, "id") || a.slotId.localeCompare(b.slotId));
  for (const x of sorted) S.addRow({ ...x, date: xlDate(x.date), status: x.statusLabel, deviation: x.deviation });
  S.getColumn("date").numFmt = "dd/mm/yyyy";
  S.getColumn("score").numFmt = "0.0";
  S.autoFilter = { from: "A1", to: `M${Math.max(last, 1)}` };
  const fillFor = { "Tepat waktu": "FFDFF3DF", "Terlalu awal": "FFFDEFC9", "Terlambat": "FFFBE1D5", "Tidak dikerjakan": "FFF7D6D6" };
  for (let i = 2; i <= last; i++) {
    const c = S.getCell(`I${i}`); const f = fillFor[c.value]; if (f) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: f } };
    S.getRow(i).font = { name: "Arial", size: 10 };
  }

  // --- Ringkasan Store (rumus ke Detail Slot) ---
  R.mergeCells("A1:M1");
  R.getCell("A1").value = `Kepatuhan Filter Oil per Store · ${fmtDate(r.start)} s/d ${fmtDate(r.end)}${opts.area ? ` · ${opts.area}` : ""}`;
  R.getCell("A1").font = { bold: true, size: 14, color: { argb: NAVY }, name: "Arial" };
  R.mergeCells("A2:M2");
  R.getCell("A2").value = `Status "Tidak patuh" = skor di bawah target di sheet Parameter (B3). Angka dihitung dengan rumus dari sheet Detail Slot. Urutan: skor terendah di atas.`;
  R.getCell("A2").font = { italic: true, size: 9, color: { argb: "FF55534E" }, name: "Arial" };
  const heads = ["Store", "Area", "Slot wajib", "Tepat waktu", "Terlalu awal", "Terlambat", "Tidak dikerjakan", "Slot terlaksana", "% Terlaksana", "% Tepat waktu", "Skor kepatuhan", "Status", "Foto dari galeri"];
  R.getRow(4).values = heads; headerStyle(R.getRow(4));
  R.columns = [22, 14, 10, 10, 10, 10, 12, 11, 11, 11, 12, 13, 11].map((w) => ({ width: w }));
  const first = 5;
  r.stores.forEach((s, i) => {
    const n = first + i;
    const A = `$A${n}`;
    const cnt = (status) => `COUNTIFS(${rng("C")},${A},${rng("I")},"${status}")`;
    const row = R.getRow(n);
    row.getCell(1).value = s.name;
    row.getCell(2).value = s.area;
    row.getCell(3).value = { formula: `COUNTIFS(${rng("C")},${A})`, result: s.expected };
    row.getCell(4).value = { formula: cnt("Tepat waktu"), result: s.ONTIME };
    row.getCell(5).value = { formula: cnt("Terlalu awal"), result: s.EARLY };
    row.getCell(6).value = { formula: cnt("Terlambat"), result: s.LATE };
    row.getCell(7).value = { formula: cnt("Tidak dikerjakan"), result: s.MISSED };
    row.getCell(8).value = { formula: `C${n}-G${n}`, result: s.done };
    row.getCell(9).value = { formula: `IF(C${n}=0,"",H${n}/C${n})`, result: s.pctDone };
    row.getCell(10).value = { formula: `IF(C${n}=0,"",D${n}/C${n})`, result: s.pctOntime };
    row.getCell(11).value = { formula: `IF(C${n}=0,"",SUMIFS(${rng("J")},${rng("C")},${A})/C${n})`, result: s.score };
    row.getCell(12).value = { formula: `IF(K${n}="","",IF(K${n}<Parameter!$B$3,"Tidak patuh","Patuh"))`, result: s.compliant ? "Patuh" : "Tidak patuh" };
    row.getCell(13).value = { formula: `COUNTIFS(${rng("C")},${A},${rng("L")},"Dari galeri")`, result: s.gallery };
    row.font = { name: "Arial", size: 10 };
  });
  const lastS = first + r.stores.length - 1;
  const tot = R.getRow(lastS + 1);
  if (r.stores.length) {
    tot.getCell(1).value = "Total";
    for (const [col, key] of [[3, "expected"], [4, "ONTIME"], [5, "EARLY"], [6, "LATE"], [7, "MISSED"], [8, "done"], [13, "gallery"]]) {
      const L = colLetter(col); tot.getCell(col).value = { formula: `SUM(${L}${first}:${L}${lastS})`, result: r.total[key] };
    }
    const t = lastS + 1;
    tot.getCell(9).value = { formula: `IF(C${t}=0,"",H${t}/C${t})`, result: r.total.pctDone };
    tot.getCell(10).value = { formula: `IF(C${t}=0,"",D${t}/C${t})`, result: r.total.pctOntime };
    tot.getCell(11).value = { formula: `IF(C${t}=0,"",SUM(${rng("J")})/C${t})`, result: r.total.score };
    tot.getCell(12).value = { formula: `COUNTIF(L${first}:L${lastS},"Tidak patuh")&" store tidak patuh"`, result: `${r.nonCompliant} store tidak patuh` };
    tot.font = { bold: true, name: "Arial", size: 10 };
    tot.eachCell((c) => { c.border = { top: { style: "medium", color: { argb: NAVY } } }; });
    for (const col of ["I", "J", "K"]) for (let i = first; i <= lastS + 1; i++) R.getCell(`${col}${i}`).numFmt = "0%";
    R.autoFilter = { from: "A4", to: `M${lastS}` };
    R.addConditionalFormatting({ ref: `L${first}:L${lastS}`, rules: [
      { type: "containsText", operator: "containsText", text: "Tidak patuh", priority: 1, style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFF7D6D6" } }, font: { bold: true, color: { argb: "FF9C1C1C" } } } },
      { type: "containsText", operator: "containsText", text: "Patuh", priority: 2, style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFDFF3DF" } }, font: { color: { argb: "FF0B6B0B" } } } },
    ] });
    R.addConditionalFormatting({ ref: `G${first}:G${lastS}`, rules: [
      { type: "cellIs", operator: "greaterThan", formulae: ["0"], priority: 3, style: { font: { bold: true, color: { argb: "FF9C1C1C" } } } },
    ] });
  }

  // --- Harian (store x tanggal, rumus) ---
  if (H) {
    H.getCell("A1").value = "Skor kepatuhan harian per store (skor ÷ slot wajib hari itu). Kosong = belum wajib.";
    H.getCell("A1").font = { italic: true, size: 9, color: { argb: "FF55534E" }, name: "Arial" };
    const hr = H.getRow(3);
    hr.getCell(1).value = "Store";
    r.days.forEach((d, j) => { const c = hr.getCell(j + 2); c.value = xlDate(d); c.numFmt = "dd/mm"; });
    headerStyle(hr);
    H.getColumn(1).width = 22;
    r.stores.forEach((s, i) => {
      const n = 4 + i; const row = H.getRow(n);
      row.getCell(1).value = s.name;
      r.days.forEach((d, j) => {
        const L = colLetter(j + 2);
        const crit = `${rng("C")},$A${n},${rng("A")},${L}$3`;
        const x = s.daily[d];
        row.getCell(j + 2).value = { formula: `IFERROR(SUMIFS(${rng("J")},${crit})/COUNTIFS(${crit}),"")`, result: x ? x.score : "" };
        row.getCell(j + 2).numFmt = "0%";
      });
      row.font = { name: "Arial", size: 10 };
    });
    for (let j = 0; j < r.days.length; j++) H.getColumn(j + 2).width = 7;
    const ref = `B4:${colLetter(r.days.length + 1)}${3 + r.stores.length}`;
    H.addConditionalFormatting({ ref, rules: [{ type: "colorScale", priority: 1, cfvo: [{ type: "num", value: 0 }, { type: "num", value: 0.5 }, { type: "num", value: 1 }], color: [{ argb: "FFF4B6B6" }, { argb: "FFFDE7A8" }, { argb: "FFB7E1B7" }] }] });
  }

  wb.views = [{ activeTab: 0 }];
  return wb;
}

async function exportExcel() {
  const btn = $("btnExport");
  const label = btn.innerHTML;
  btn.disabled = true; btn.textContent = "Menyiapkan Excel…";
  try {
    const ExcelJS = await loadExcelJS();
    const r = state.report;
    const generatedAt = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 16).replace("T", " ");
    const wb = await buildWorkbook(ExcelJS, r, { area: state.area, generatedAt });
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `Kepatuhan_Filter_Oil_${r.start}_sd_${r.end}${state.area ? `_${state.area.replace(/\s+/g, "-")}` : ""}.xlsx`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
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
  $("target").addEventListener("change", (e) => { const v = Math.min(100, Math.max(0, Number(e.target.value) || 0)); e.target.value = v; state.target = v; store.set("fo.target", String(v)); recompute(); });
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
