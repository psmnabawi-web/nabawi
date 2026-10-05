// Tambahan untuk app Trecking Filter Oil (titik masuk, dimuat setelah app.js):
//   1. Menu "Export Kepatuhan": ringkasan, peringkat store, peta harian, detail slot, export Excel.
//   2. Dashboard baru (dashboard.js); bila gagal dipasang, Dashboard lama tetap jalan + tombol Export Excel.
// Data dibaca dari Firestore (REST, hanya baca). Tidak ada yang ditulis ke database.
import { STATUS, ymdWib, addDays, fmtDate, dayName } from "./kepatuhan.js";
import {
  $, esc, pct, poin, short, pref, PRESETS, getData, report, exportExcel, toast, busy,
  statusBadge, compliantBadge, dayTone, periodLabel, stackHtml, legendHtml, wibClock, initTooltip,
} from "./common.js";

const MAX_HEAT_DAYS = 31;
const PAGE = 150;

// ---------- 1. tombol Export di Dashboard ----------
function initDashboardExport() {
  const load = $("btnLoadDashboard");
  if (!load || $("btnExportDashboard")) return;
  const btn = document.createElement("button");
  btn.id = "btnExportDashboard"; btn.type = "button"; btn.className = "btn secondary";
  btn.innerHTML = "⬇ Export Excel";
  btn.title = "Export data kepatuhan untuk periode & store yang dipilih ke Excel";
  load.insertAdjacentElement("afterend", btn);
  load.closest(".filterbar")?.classList.add("kp-has-export");
  btn.addEventListener("click", () => busy(btn, "Menyiapkan Excel…", async () => {
    const start = $("dashFrom")?.value, end = $("dashTo")?.value;
    const sel = $("dashStore")?.value || "ALL";
    if (!start || !end) { toast("Isi Periode Dari dan Sampai dulu."); return; }
    const [s, e] = start <= end ? [start, end] : [end, start];
    try {
      const r = await exportExcel({ start: s, end: e, storeId: sel === "ALL" ? "" : sel, target: 0.95 }, await getData(s, e));
      toast(`Excel terunduh: ${r.stores.length} store, ${r.rows.length} slot.`);
    } catch (err) { toast(`Export gagal: ${err.message}`); }
  }));
}

// ---------- 2. panel Export Kepatuhan ----------
const DETAIL_FILTERS = [
  { key: "issues", icon: "", label: "Bermasalah", test: (x) => x.status !== "ONTIME" },
  { key: "MISSED", icon: STATUS.MISSED.icon, label: "Tidak dikerjakan", test: (x) => x.status === "MISSED" },
  { key: "LATE", icon: STATUS.LATE.icon, label: "Terlambat", test: (x) => x.status === "LATE" },
  { key: "EARLY", icon: STATUS.EARLY.icon, label: "Terlalu awal", test: (x) => x.status === "EARLY" },
  { key: "gallery", icon: "", label: "Foto galeri", test: (x) => x.photo === "Dari galeri" },
  { key: "all", icon: "", label: "Semua slot", test: () => true },
];
const ui = { view: pref.get("fo.kp.view", "bar"), detail: "issues", storeDetail: "", report: null, data: null, shown: PAGE, seq: 0 };

const TEMPLATE = `
  <div class="card kp-filters" id="kpFilters">
    <div class="kp-progress" aria-hidden="true"></div>
    <div class="kp-filters-top">
      <div class="kp-presets" role="group" aria-label="Pilih periode">
        ${PRESETS.map(([k, l]) => `<button type="button" class="kp-chip" data-preset="${k}" aria-pressed="false">${l}</button>`).join("")}
      </div>
      <div class="kp-meta" id="kpMeta" aria-live="polite"></div>
    </div>
    <div class="kp-filter-grid">
      <label>Dari tanggal <input id="kpFrom" type="date"></label>
      <label>Sampai tanggal <input id="kpTo" type="date"></label>
      <label class="kp-f-store">Store <select id="kpStore"><option value="">Semua store</option></select></label>
      <label class="kp-f-target">Target <span class="kp-target"><input id="kpTarget" type="number" min="0" max="100" step="5" inputmode="numeric"><span aria-hidden="true">%</span></span></label>
      <div class="kp-actions">
        <button id="kpReload" type="button" class="btn ghost" title="Ambil data terbaru dari server">⟳ Muat ulang</button>
        <button id="kpExport" type="button" class="btn primary">⬇ Export Excel</button>
      </div>
    </div>
  </div>
  <div id="kpError" class="kp-error" role="alert" hidden><span id="kpErrorText"></span><button type="button" class="btn secondary smallbtn" id="kpRetry">Coba lagi</button></div>
  <div id="kpBody">
    <section class="kp-insight" id="kpInsight" aria-live="polite"></section>
    <div class="kp-kpis" id="kpKpis"></div>
    <div class="card" id="kpRankCard">
      <div class="card-head">
        <div><div class="section-label">Peringkat</div><h2>Kepatuhan per Store</h2>
          <div class="hint">Dari yang terendah. Batang = komposisi slot wajib, garis putus-putus = target. Klik store untuk melihat detail slotnya.</div></div>
        <div class="kp-seg" role="group" aria-label="Tampilan peringkat">
          <button type="button" data-view="bar">Grafik</button><button type="button" data-view="table">Tabel</button>
        </div>
      </div>
      <ul class="kp-legend" id="kpRankLegend">${legendHtml()}</ul>
      <div id="kpRank"></div>
    </div>
    <div class="card">
      <div class="card-head"><div><div class="section-label">Peta harian</div><h2>Slot Dikerjakan per Hari</h2>
        <div class="hint">Angka = slot dikerjakan / slot wajib. Arahkan kursor atau ketuk kotak untuk rinciannya.</div></div></div>
      <ul class="kp-legend" id="kpLegend"></ul>
      <div class="kp-heat-wrap"><table class="kp-heat" id="kpHeat"></table></div>
      <div class="hint kp-note-line" id="kpHeatNote" hidden></div>
    </div>
    <div class="card" id="kpDetailCard">
      <div class="card-head"><div><div class="section-label">Detail</div><h2>Detail Slot</h2><div class="hint" id="kpDetailHint"></div></div>
        <div id="kpStoreTag"></div></div>
      <div class="kp-chips" id="kpDetailChips" role="group" aria-label="Saring detail slot"></div>
      <div class="table-wrap kp-detail-wrap"><table id="kpDetail" class="kp-detail"></table></div>
      <div class="kp-more" id="kpMore"></div>
    </div>
  </div>
  <div class="kp-tip" id="kpTip" role="tooltip" hidden></div>`;

const params = () => {
  const a = $("kpFrom").value, b = $("kpTo").value;
  const [start, end] = a <= b ? [a, b] : [b, a];
  const t = Math.min(100, Math.max(0, Number($("kpTarget").value) || 0));
  return { start, end, storeId: $("kpStore").value, target: t / 100 };
};
function syncPresets() {
  const today = ymdWib(Date.now()), a = $("kpFrom").value, b = $("kpTo").value;
  for (const [k, , f] of PRESETS) {
    const [s, e] = f(today);
    document.querySelector(`#kepatuhan [data-preset="${k}"]`)?.setAttribute("aria-pressed", String(s === a && e === b));
  }
}

// ---------- muat & tampilkan ----------
function skeleton() {
  $("kpInsight").className = "kp-insight neutral";
  $("kpInsight").innerHTML = `<div class="kp-skel" style="width:55%"></div><div class="kp-skel" style="width:35%;margin-top:10px"></div>`;
  $("kpKpis").innerHTML = Array.from({ length: 5 }, () => `<div class="kpi"><div class="kp-skel" style="width:60%"></div><div class="kp-skel kp-skel-lg"></div></div>`).join("");
  $("kpRank").innerHTML = Array.from({ length: 6 }, () => `<div class="kp-skel kp-skel-row"></div>`).join("");
}
async function loadPanel(force = false) {
  const p = params();
  if (!p.start || !p.end) return;
  const seq = ++ui.seq;
  $("kpError").hidden = true;
  $("kepatuhan").classList.add("kp-busy");
  if (!ui.report) skeleton();
  try {
    const data = await getData(p.start, p.end, force);
    if (seq !== ui.seq) return; // filter sudah diganti selama data dimuat
    const sel = $("kpStore");
    if (sel.options.length <= 1) {
      const cur = sel.value;
      for (const s of data.stores.filter((x) => x.active !== false).sort((a, b) => String(a.name).localeCompare(String(b.name), "id"))) sel.add(new Option(s.name || s.id, s.id));
      sel.value = cur;
    }
    ui.data = data;
    ui.report = report(p, data);
    if (ui.storeDetail && !ui.report.stores.some((s) => s.id === ui.storeDetail)) ui.storeDetail = "";
    ui.shown = PAGE;
    render();
  } catch (e) {
    if (seq !== ui.seq) return;
    $("kpErrorText").textContent = `Data gagal dimuat (${e.message}). Cek koneksi internet lalu coba lagi.`;
    $("kpError").hidden = false;
    if (!ui.report) $("kpBody").hidden = true;
  } finally {
    if (seq === ui.seq) $("kepatuhan").classList.remove("kp-busy");
  }
}

function render() {
  const r = ui.report, p = params();
  $("kpBody").hidden = false;
  const at = wibClock(ui.data?.at);
  $("kpMeta").innerHTML = `<strong>${esc(periodLabel(p.start, r.end))}</strong>${at ? ` · data ${at} WIB` : ""}${r.pending ? ` · <span title="Slot hari ini yang jamnya belum lewat (jam filter + toleransi) belum dihitung">${r.pending} slot hari ini belum jatuh tempo</span>` : ""}`;
  renderInsight(); renderKpis(); renderRank(); renderHeat(); renderDetail();
}

function renderInsight() {
  const r = ui.report, t = r.total, tgt = Math.round(r.target * 100), el = $("kpInsight");
  if (!r.stores.length) {
    el.className = "kp-insight neutral";
    el.innerHTML = `<div class="kp-insight-head"><span class="kp-insight-icon" aria-hidden="true">i</span><div><strong>Belum ada slot wajib pada periode ini.</strong><p>Slot hari ini baru dihitung setelah jam filter + ${r.tol} menit lewat. Pilih periode lain.</p></div></div>`;
    return;
  }
  const bad = r.nonCompliant > 0;
  const zero = r.stores.filter((s) => s.done === 0);
  const worst = r.stores.filter((s) => !s.compliant).slice(0, 3);
  const head = bad ? `${r.nonCompliant} dari ${r.stores.length} store di bawah target ${tgt}%` : `Semua ${r.stores.length} store memenuhi target ${tgt}%`;
  const sub = bad
    ? `Compliance total ${pct(t.pctDone, 1)}${t.pctDone < r.target ? `, kurang ${poin(r.target - t.pctDone)} dari target` : ""}. Terendah: ${worst.map((s) => `<b>${esc(s.name)}</b> ${pct(s.pctDone, 1)}`).join(", ")}.`
    : `Compliance total ${pct(t.pctDone, 1)}. ${t.EARLY + t.LATE ? `Masih ada ${t.EARLY + t.LATE} slot yang tidak tepat waktu.` : "Semua slot tepat waktu."}`;
  const facts = [
    t.MISSED && ["bad", `${STATUS.MISSED.icon} ${t.MISSED} slot tidak dikerjakan`],
    zero.length && ["bad", `${zero.length} store tanpa input sama sekali${zero.length <= 3 ? `: ${zero.map((s) => esc(s.name)).join(", ")}` : ""}`],
    t.EARLY + t.LATE && ["warn", `${t.EARLY + t.LATE} slot tidak tepat waktu (${t.EARLY} awal · ${t.LATE} terlambat)`],
    t.gallery && ["warn", `${t.gallery} foto bukti dari galeri, bukan kamera`],
  ].filter(Boolean);
  el.className = `kp-insight ${bad ? "bad" : "good"}`;
  el.innerHTML = `<div class="kp-insight-head"><span class="kp-insight-icon" aria-hidden="true">${bad ? "!" : "✓"}</span>
    <div><strong>${esc(head)}</strong><p>${sub}</p></div></div>
    ${facts.length ? `<ul class="kp-facts">${facts.map(([c, txt]) => `<li class="${c}">${txt}</li>`).join("")}</ul>` : ""}`;
}

function renderKpis() {
  const r = ui.report, t = r.total, tgt = Math.round(r.target * 100);
  const below = t.pctDone !== null && t.pctDone < r.target - 1e-9;
  const fill = Math.round((t.pctDone || 0) * 100);
  $("kpKpis").innerHTML = `
    <div class="kpi kpi-compliance kp-hero${below ? " danger" : ""}">
      <span>Compliance</span><strong>${pct(t.pctDone, 1)}</strong>
      <div class="kp-meter" role="img" aria-label="Compliance ${pct(t.pctDone, 1)}, target ${tgt}%"><i style="width:${fill}%"></i><b style="left:${tgt}%"></b></div>
      <small>${t.done} dari ${t.expected} slot dikerjakan · target ${tgt}%${below ? ` · kurang ${poin(r.target - t.pctDone)}` : ""}</small>
    </div>
    <div class="kpi kpi-trust${r.nonCompliant ? " danger" : ""}"><span>Store tidak patuh</span><strong>${r.nonCompliant}<em>/${r.stores.length}</em></strong><small>compliance di bawah ${tgt}%</small></div>
    <div class="kpi kpi-missed${t.MISSED ? " danger" : ""}"><span>${STATUS.MISSED.icon} Tidak dikerjakan</span><strong>${t.MISSED}</strong><small>${pct(t.expected ? t.MISSED / t.expected : null, 1)} dari slot wajib</small></div>
    <div class="kpi kpi-variance"><span>Tidak tepat waktu</span><strong>${t.EARLY + t.LATE}</strong><small>${STATUS.EARLY.icon} ${t.EARLY} terlalu awal · ${STATUS.LATE.icon} ${t.LATE} terlambat</small></div>
    <div class="kpi kpi-ontime"><span>${STATUS.ONTIME.icon} Tepat waktu</span><strong>${t.ONTIME}</strong><small>${pct(t.pctOntime, 1)} · toleransi ±${r.tol} menit</small></div>`;
}

function renderRank() {
  const r = ui.report, tgt = r.target;
  document.querySelectorAll("#kepatuhan [data-view]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === ui.view)));
  $("kpRankLegend").hidden = ui.view !== "bar";
  if (!r.stores.length) { $("kpRank").innerHTML = `<div class="kp-empty">Tidak ada slot wajib pada periode ini.</div>`; return; }
  if (ui.view === "table") {
    const t = r.total;
    $("kpRank").innerHTML = `<div class="table-wrap"><table class="kp-rank-table"><thead><tr><th>#</th><th>Store</th><th>Area</th><th>Slot wajib</th><th>Tepat waktu</th><th>Terlalu awal</th><th>Terlambat</th><th>Tidak dikerjakan</th><th>Compliance</th><th>% Tepat waktu</th><th>Status</th><th title="Foto bukti dari galeri/berkas, bukan kamera app">Foto galeri</th></tr></thead>
      <tbody>${r.stores.map((s, i) => `<tr class="kp-row${ui.storeDetail === s.id ? " kp-selected" : ""}" data-store="${esc(s.id)}" tabindex="0">
        <td>${i + 1}</td><td><strong>${esc(s.name)}</strong></td><td>${esc(s.area)}</td><td>${s.expected}</td><td>${s.ONTIME}</td><td>${s.EARLY}</td><td>${s.LATE}</td>
        <td>${s.MISSED ? `<strong class="kp-red">${s.MISSED}</strong>` : 0}</td><td><strong>${pct(s.pctDone, 1)}</strong></td>
        <td>${pct(s.pctOntime)}</td><td>${compliantBadge(s.compliant)}</td><td>${s.gallery}</td></tr>`).join("")}</tbody>
      <tfoot><tr><td></td><td><strong>Total</strong></td><td></td><td><strong>${t.expected}</strong></td><td><strong>${t.ONTIME}</strong></td><td><strong>${t.EARLY}</strong></td><td><strong>${t.LATE}</strong></td><td><strong>${t.MISSED}</strong></td><td><strong>${pct(t.pctDone, 1)}</strong></td><td><strong>${pct(t.pctOntime)}</strong></td><td></td><td><strong>${t.gallery}</strong></td></tr></tfoot></table></div>`;
    return;
  }
  $("kpRank").innerHTML = `<div class="kp-rank" role="list">${r.stores.map((s, i) => {
    const gap = s.pctDone - tgt;
    const sel = ui.storeDetail === s.id;
    return `<div role="listitem"><button type="button" class="kp-rank-row${sel ? " kp-selected" : ""}" data-store="${esc(s.id)}" aria-pressed="${sel}">
      <span class="kp-rank-no">${i + 1}</span>
      <span class="kp-rank-name"><strong>${esc(s.name)}</strong><small>${esc(s.area || "–")} · ${s.expected} slot${s.gallery ? ` · <em>${s.gallery} foto galeri</em>` : ""}</small></span>
      ${stackHtml(s, tgt)}
      <span class="kp-rank-val ${s.compliant ? "ok" : "no"}"><strong>${pct(s.pctDone, 1)}</strong><small>${s.compliant ? `✓ ${gap > 1e-9 ? `+${poin(gap)}` : "tepat target"}` : `✕ −${poin(gap)}`}</small></span>
      <span class="kp-rank-badge">${compliantBadge(s.compliant)}</span>
    </button></div>`;
  }).join("")}</div>`;
}

function renderHeat() {
  const r = ui.report, tgt = Math.round(r.target * 100);
  const days = r.days.slice(-MAX_HEAT_DAYS);
  $("kpHeatNote").hidden = r.days.length <= MAX_HEAT_DAYS;
  $("kpHeatNote").textContent = `Menampilkan ${MAX_HEAT_DAYS} hari terakhir dari ${r.days.length} hari. File Excel memuat semua hari.`;
  $("kpLegend").innerHTML = [["good", `≥ target (${tgt}%)`], ["warning", "50% s/d di bawah target"], ["serious", "di bawah 50%"], ["critical", "0 dikerjakan"], ["none", "belum wajib"]]
    .map(([k, l]) => `<li><span class="kp-sw kp-${k}"></span>${esc(l)}</li>`).join("");
  if (!r.stores.length) { $("kpHeat").innerHTML = `<tbody><tr><td class="kp-empty">Tidak ada data.</td></tr></tbody>`; return; }
  const agg = new Map();
  for (const x of r.rows) {
    const a = agg.get(x.date) || { expected: 0, done: 0, ONTIME: 0, EARLY: 0, LATE: 0, MISSED: 0 };
    a.expected++; a[x.status]++; if (x.status !== "MISSED") a.done++;
    agg.set(x.date, a);
  }
  const cell = (label, x) => {
    if (!x || !x.expected) return `<td class="kp-none" tabindex="0" data-tip="${esc(`${label}: belum wajib`)}">–</td>`;
    const p = x.done / x.expected;
    const tip = `${label}\nDikerjakan ${x.done}/${x.expected} (${pct(p)})\n${STATUS.ONTIME.icon} tepat waktu ${x.ONTIME} · ${STATUS.EARLY.icon} awal ${x.EARLY} · ${STATUS.LATE.icon} terlambat ${x.LATE} · ${STATUS.MISSED.icon} tidak dikerjakan ${x.MISSED}`;
    return `<td class="kp-${dayTone({ expected: x.expected, pctDone: p }, r.target)}" tabindex="0" data-tip="${esc(tip)}" aria-label="${esc(tip)}">${x.done}/${x.expected}</td>`;
  };
  const totalCell = (x) => `<td class="kp-total kp-${dayTone(x, r.target)}">${pct(x.pctDone)}</td>`;
  $("kpHeat").innerHTML = `<thead><tr><th class="kp-sticky">Store</th>${days.map((d) => `<th${d === r.today ? ' class="kp-today" title="Hari ini"' : ""}>${esc(dayName(d).slice(0, 3))}<br>${short(d)}</th>`).join("")}<th class="kp-total-h">Total</th></tr></thead>
    <tbody><tr class="kp-agg"><th class="kp-sticky">Semua store</th>${days.map((d) => cell(`Semua store · ${dayName(d)} ${fmtDate(d)}`, agg.get(d))).join("")}${totalCell({ expected: r.total.expected, pctDone: r.total.pctDone })}</tr>
    ${r.stores.map((s) => `<tr><th class="kp-sticky">${esc(s.name)}</th>${days.map((d) => cell(`${s.name} · ${dayName(d)} ${fmtDate(d)}`, s.daily[d])).join("")}${totalCell(s)}</tr>`).join("")}</tbody>`;
}

function renderDetail() {
  const r = ui.report;
  const base = r.rows.filter((x) => !ui.storeDetail || x.storeId === ui.storeDetail);
  const nm = ui.storeDetail ? r.stores.find((s) => s.id === ui.storeDetail)?.name : "";
  $("kpStoreTag").innerHTML = nm ? `<button type="button" class="kp-tag" id="kpClearStore" title="Tampilkan semua store">Store: <b>${esc(nm)}</b> <span aria-hidden="true">✕</span></button>` : "";
  $("kpDetailChips").innerHTML = DETAIL_FILTERS.map((f) => `<button type="button" class="kp-chip" data-detail="${f.key}" aria-pressed="${ui.detail === f.key}">${f.icon ? `<span aria-hidden="true">${f.icon}</span> ` : ""}${f.label} <span class="kp-count">${base.filter(f.test).length}</span></button>`).join("");
  const flt = DETAIL_FILTERS.find((f) => f.key === ui.detail) || DETAIL_FILTERS[0];
  const rows = base.filter(flt.test).sort((a, b) => b.date.localeCompare(a.date) || b.planned.localeCompare(a.planned) || a.store.localeCompare(b.store, "id"));
  $("kpDetailHint").textContent = `${rows.length} slot · ${flt.label.toLowerCase()}${nm ? ` · ${nm}` : ""} · terbaru di atas`;
  const shown = rows.slice(0, ui.shown);
  const dev = (d) => (d === null ? "" : ` <small class="kp-dev">${d > 0 ? "+" : d < 0 ? "−" : "±"}${Math.abs(d)} mnt</small>`);
  const dash = `<span class="kp-muted">–</span>`;
  $("kpDetail").innerHTML = `<thead><tr><th>Tanggal</th><th>Store</th><th>Slot</th><th>Jam aktual</th><th>Status</th><th>Crew</th><th>Foto</th><th>Catatan</th></tr></thead>
    <tbody>${shown.map((x) => `<tr>
      <td data-label="Tanggal"><strong>${esc(x.day.slice(0, 3))}, ${short(x.date)}</strong><small class="kp-muted">/${x.date.slice(0, 4)}</small></td>
      <td data-label="Store">${esc(x.store)}</td>
      <td data-label="Slot">${esc(x.slot)} <small class="kp-muted">${esc(x.planned)}</small></td>
      <td data-label="Jam aktual">${x.actual ? `${esc(x.actual)}${dev(x.deviation)}` : dash}</td>
      <td data-label="Status">${statusBadge(x.status)}</td>
      <td data-label="Crew">${esc(x.crew) || dash}</td>
      <td data-label="Foto">${x.photo === "Dari galeri" ? `<span class="kp-gal">${esc(x.photo)}</span>` : esc(x.photo) || dash}</td>
      <td data-label="Catatan" class="kp-note${x.note ? "" : " kp-note-empty"}">${esc(x.note) || dash}</td></tr>`).join("") || `<tr class="kp-empty-row"><td colspan="8"><div class="kp-empty">${ui.detail === "issues" ? "👍 Tidak ada slot bermasalah." : "Tidak ada slot untuk saringan ini."}</div></td></tr>`}</tbody>`;
  $("kpMore").innerHTML = rows.length > shown.length
    ? `<span>Menampilkan ${shown.length} dari ${rows.length} slot.</span><button type="button" class="btn secondary smallbtn" id="kpShowMore">Tampilkan ${Math.min(PAGE, rows.length - shown.length)} lagi</button><span class="kp-muted">Semua baris ada di file Excel.</span>`
    : "";
}

function initPanel() {
  const sec = $("kepatuhan");
  if (!sec || sec.dataset.ready) return;
  sec.dataset.ready = "1";
  sec.innerHTML = TEMPLATE;
  const today = ymdWib(Date.now());
  $("kpFrom").value = addDays(today, -6); $("kpTo").value = today;
  $("kpTarget").value = pref.get("fo.kp.target", "95");
  syncPresets();
  let loaded = false;
  const ensure = () => { if (!loaded) { loaded = true; loadPanel(); } };
  document.querySelector('.tab[data-tab="kepatuhan"]')?.addEventListener("click", ensure);
  if (sec.classList.contains("active")) ensure();

  sec.addEventListener("click", (e) => {
    const preset = e.target.closest("[data-preset]");
    if (preset) {
      const [s, en] = PRESETS.find(([k]) => k === preset.dataset.preset)[2](ymdWib(Date.now()));
      $("kpFrom").value = s; $("kpTo").value = en; syncPresets(); loadPanel(); return;
    }
    const view = e.target.closest("[data-view]");
    if (view) { ui.view = view.dataset.view; pref.set("fo.kp.view", ui.view); if (ui.report) renderRank(); return; }
    const chip = e.target.closest("[data-detail]");
    if (chip) { ui.detail = chip.dataset.detail; ui.shown = PAGE; renderDetail(); return; }
    if (e.target.closest("#kpClearStore")) { ui.storeDetail = ""; ui.shown = PAGE; renderRank(); renderDetail(); return; }
    if (e.target.closest("#kpShowMore")) { ui.shown += PAGE; renderDetail(); return; }
    if (e.target.closest("#kpRetry")) { loadPanel(true); return; }
    const row = e.target.closest("[data-store]");
    if (row && ui.report) {
      ui.storeDetail = ui.storeDetail === row.dataset.store ? "" : row.dataset.store;
      ui.shown = PAGE; renderRank(); renderDetail();
      if (ui.storeDetail) $("kpDetailCard").scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
  sec.addEventListener("keydown", (e) => {
    const tr = e.target.closest("tr[data-store]");
    if (tr && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); tr.click(); }
  });
  for (const id of ["kpFrom", "kpTo"]) $(id).addEventListener("change", () => { syncPresets(); loadPanel(); });
  $("kpStore").addEventListener("change", () => { ui.storeDetail = ""; loadPanel(); });
  $("kpTarget").addEventListener("change", () => { pref.set("fo.kp.target", $("kpTarget").value); loadPanel(); });
  $("kpReload").addEventListener("click", () => busy($("kpReload"), "Memuat…", () => loadPanel(true)));
  $("kpExport").addEventListener("click", () => busy($("kpExport"), "Menyiapkan Excel…", async () => {
    const p = params();
    if (!p.start || !p.end) { toast("Isi tanggal Dari dan Sampai dulu."); return; }
    try { const r = await exportExcel(p, await getData(p.start, p.end)); toast(`Excel terunduh: ${r.stores.length} store, ${r.rows.length} slot.`); }
    catch (err) { toast(`Export gagal: ${err.message}`); }
  }));
  initTooltip(sec, $("kpTip"));
}

function init() {
  // Tombol Export dipasang dulu di Dashboard lama; Dashboard baru (dimuat terpisah) memindahkannya ke tata letak baru.
  // Bila dashboard.js gagal dimuat, Dashboard lama tetap jalan lengkap dengan tombol Export.
  try { initDashboardExport(); } catch (e) { console.error("kepatuhan: tombol export dashboard", e); }
  import("./dashboard.js").then((m) => m.initDashboard()).catch((e) => console.error("kepatuhan: dashboard baru", e));
  try { initPanel(); } catch (e) { console.error("kepatuhan: panel", e); }
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
