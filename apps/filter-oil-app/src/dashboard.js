// Dashboard baru app Filter Oil. Menggantikan isi menu Dashboard; app.js hanya mendelegasikan loadDashboard() ke sini
// (window.foDashboard). Input tanggal/store dan tombol milik app (#dashFrom, #dashTo, #dashStore, #btnLoadDashboard)
// dipindahkan apa adanya, jadi app.js tetap bisa mengisi pilihan store dan tanggal awal seperti biasa.
// Angka memakai logika yang sama dengan menu Export Kepatuhan: slot hari ini baru dihitung setelah jam slot + toleransi.
import { STATUS, ymdWib, fmtDate, dayName, statusOf, actualTime, photoSource, toMinutes } from "./kepatuhan.js";
import { loadEvidenceImage } from "./core.js";
import {
  $, esc, pct, poin, short, PRESETS, getData, report, exportExcel, toast, busy,
  periodLabel, stackHtml, legendHtml, wibClock, initTooltip, SEGMENTS,
} from "./common.js";

const TARGET = 0.95; // target compliance Dashboard (sama dengan Dashboard lama)
const LOG_PAGE = 20;
const ui = { report: null, data: null, params: null, seq: 0, log: "all", logShown: LOG_PAGE, pending: null, width: 0 };
const imgCache = new Map();

const TEMPLATE = `
  <div class="card kp-filters fd-filters">
    <div class="kp-progress" aria-hidden="true"></div>
    <div class="kp-filters-top">
      <div class="kp-presets" role="group" aria-label="Pilih periode">
        ${PRESETS.map(([k, l]) => `<button type="button" class="kp-chip" data-fd-preset="${k}" aria-pressed="false">${l}</button>`).join("")}
      </div>
      <div class="kp-meta" id="fdMeta" aria-live="polite"></div>
    </div>
    <div class="fd-filter-grid">
      <label>Dari tanggal <span data-slot="from"></span></label>
      <label>Sampai tanggal <span data-slot="to"></span></label>
      <label class="fd-f-store">Store <span data-slot="store"></span></label>
      <div class="kp-actions"><span data-slot="load"></span><span data-slot="export"></span></div>
    </div>
  </div>
  <div id="fdError" class="kp-error" role="alert" hidden><span id="fdErrorText"></span><button type="button" class="btn secondary smallbtn" data-fd-retry>Coba lagi</button></div>
  <div id="fdBody">
    <section class="kp-insight" id="fdInsight" aria-live="polite"></section>
    <div class="kp-kpis fd-kpis" id="fdKpis"></div>
    <div class="card">
      <div class="card-head"><div><div class="section-label">Tren harian</div><h2>Compliance per Hari</h2>
        <div class="hint">Setiap kolom = 100% slot wajib hari itu. Bagian berwarna = slot dikerjakan, arsir = tidak dikerjakan.</div></div></div>
      <ul class="kp-legend">${legendHtml(false)}<li><span class="kp-sw kp-sw-target"></span>Target ${Math.round(TARGET * 100)}%</li></ul>
      <div class="fd-chart" id="fdChart"></div>
    </div>
    <div class="fd-slots" id="fdSlots"></div>
    <div class="fd-two">
      <div class="card">
        <div class="card-head"><div><div class="section-label">Peringkat</div><h2>Kepatuhan per Store</h2>
          <div class="hint">Dari yang terendah. Klik store untuk melihat Dashboard store itu saja.</div></div></div>
        <div id="fdRank"></div>
      </div>
      <div class="card">
        <div class="card-head"><div><div class="section-label">Prioritas tindakan</div><h2>Yang Perlu Ditindaklanjuti</h2>
          <div class="hint">Store dengan compliance terendah, masalah utamanya, dan langkah yang disarankan.</div></div></div>
        <div id="fdActions"></div>
      </div>
    </div>
    <div class="card" id="fdLogCard">
      <div class="card-head"><div><div class="section-label">Log evidence</div><h2>Evidence Filter</h2><div class="hint" id="fdLogHint"></div></div></div>
      <div class="kp-chips" id="fdLogChips" role="group" aria-label="Saring evidence"></div>
      <div class="table-wrap kp-detail-wrap"><table class="kp-detail fd-log" id="fdLog"></table></div>
      <div class="kp-more" id="fdLogMore"></div>
    </div>
  </div>
  <div class="kp-tip" id="fdTip" role="tooltip" hidden></div>
  <div class="fd-lightbox" id="fdLightbox" role="dialog" aria-modal="true" aria-label="Foto evidence" hidden>
    <div class="fd-lightbox-box"><button type="button" class="fd-lightbox-close" data-fd-close aria-label="Tutup">✕</button>
      <div class="fd-lightbox-img" id="fdLightboxImg"></div><div class="fd-lightbox-cap" id="fdLightboxCap"></div></div>
  </div>`;

// ---------- pasang ----------
export function initDashboard() {
  const sec = $("dashboard");
  const nodes = { from: $("dashFrom"), to: $("dashTo"), store: $("dashStore"), load: $("btnLoadDashboard") };
  if (!sec || sec.dataset.fd || Object.values(nodes).some((n) => !n)) return false;
  nodes.export = $("btnExportDashboard") || makeExportButton();

  // Susun tata letak baru di luar dokumen dulu, lalu tukar sekaligus (kalau gagal, Dashboard lama tidak tersentuh).
  const box = document.createElement("div");
  box.innerHTML = TEMPLATE;
  nodes.load.className = "btn ghost"; nodes.load.type = "button";
  nodes.load.innerHTML = "⟳ Muat ulang"; nodes.load.title = "Ambil data terbaru dari server";
  nodes.export.className = "btn primary";
  for (const [k, n] of Object.entries(nodes)) box.querySelector(`[data-slot="${k}"]`).replaceWith(n);
  sec.replaceChildren(...box.childNodes);
  sec.dataset.fd = "1";
  sec.classList.add("fd");

  window.foDashboard = { load: (force = false) => schedule(force) };
  nodes.load.addEventListener("click", () => schedule(true));
  for (const n of [nodes.from, nodes.to, nodes.store]) n.addEventListener("change", () => schedule());
  sec.addEventListener("click", onClick);
  sec.addEventListener("keydown", (e) => { if (e.key === "Escape") closeLightbox(); });
  initTooltip(sec, $("fdTip"));
  if ("ResizeObserver" in window) {
    new ResizeObserver(() => {
      const w = $("fdChart")?.clientWidth || 0;
      if (ui.report && w && Math.abs(w - ui.width) > 8) renderChart();
    }).observe($("fdChart"));
  }
  syncPresets();
  if (sec.classList.contains("active")) schedule();
  return true;
}

function makeExportButton() {
  const btn = document.createElement("button");
  btn.id = "btnExportDashboard"; btn.type = "button"; btn.innerHTML = "⬇ Export Excel";
  btn.addEventListener("click", () => busy(btn, "Menyiapkan Excel…", async () => {
    const p = readParams(); if (!p) return;
    try { const r = await exportExcel({ ...p, target: TARGET }, await getData(p.start, p.end)); toast(`Excel terunduh: ${r.stores.length} store, ${r.rows.length} slot.`); }
    catch (err) { toast(`Export gagal: ${err.message}`); }
  }));
  return btn;
}

function readParams() {
  let a = $("dashFrom").value, b = $("dashTo").value;
  if (!a || !b) return null;
  if (a > b) { [a, b] = [b, a]; $("dashFrom").value = a; $("dashTo").value = b; }
  const s = $("dashStore").value;
  return { start: a, end: b, storeId: s && s !== "ALL" ? s : "" };
}
function syncPresets() {
  const today = ymdWib(Date.now()), a = $("dashFrom").value, b = $("dashTo").value;
  for (const [k, , f] of PRESETS) {
    const [s, e] = f(today);
    document.querySelector(`#dashboard [data-fd-preset="${k}"]`)?.setAttribute("aria-pressed", String(s === a && e === b));
  }
}

// app.js (klik menu / tombol) dan pengendali kita bisa memanggil bersamaan: digabung jadi satu muat.
function schedule(force = false) {
  if (ui.pending) { ui.pending.force = ui.pending.force || force; return ui.pending.promise; }
  const job = { force };
  job.promise = new Promise((resolve) => setTimeout(() => { ui.pending = null; load(job.force).then(resolve, resolve); }, 0));
  ui.pending = job;
  return job.promise;
}

function skeleton() {
  $("fdInsight").className = "kp-insight neutral";
  $("fdInsight").innerHTML = `<div class="kp-skel" style="width:55%"></div><div class="kp-skel" style="width:35%;margin-top:10px"></div>`;
  $("fdKpis").innerHTML = Array.from({ length: 5 }, () => `<div class="kpi"><div class="kp-skel" style="width:60%"></div><div class="kp-skel kp-skel-lg"></div></div>`).join("");
  $("fdChart").innerHTML = `<div class="kp-skel" style="height:220px"></div>`;
}
async function load(force) {
  const p = readParams();
  syncPresets();
  if (!p) return;
  const sec = $("dashboard"), seq = ++ui.seq;
  $("fdError").hidden = true;
  sec.classList.add("kp-busy");
  if (!ui.report) skeleton();
  try {
    const data = await getData(p.start, p.end, force);
    if (seq !== ui.seq) return;
    ui.data = data; ui.params = p;
    ui.report = report({ ...p, target: TARGET }, data);
    ui.logShown = LOG_PAGE;
    render();
  } catch (e) {
    if (seq !== ui.seq) return;
    $("fdErrorText").textContent = `Data gagal dimuat (${e.message}). Cek koneksi internet lalu coba lagi.`;
    $("fdError").hidden = false;
    if (!ui.report) $("fdBody").hidden = true;
  } finally {
    if (seq === ui.seq) sec.classList.remove("kp-busy");
  }
}

// ---------- ringkasan data ----------
const blank = () => ({ expected: 0, done: 0, ONTIME: 0, EARLY: 0, LATE: 0, MISSED: 0, gallery: 0, camera: 0, high: 0 });
function add(a, x) {
  a.expected++; a[x.status]++;
  if (x.status !== "MISSED") { a.done++; if (x.photo === "Dari galeri") a.gallery++; if (x.photo === "Kamera app") a.camera++; if (x.trust === "HIGH") a.high++; }
}
const fin = (a) => ({ ...a, pctDone: a.expected ? a.done / a.expected : null });
function group(rows, keyFn) {
  const m = new Map();
  for (const x of rows) { const k = keyFn(x); if (!m.has(k)) m.set(k, blank()); add(m.get(k), x); }
  return m;
}
const shiftName = (time) => { const m = toMinutes(time); return m >= 20 * 60 || m < 5 * 60 ? "shift malam" : m < 12 * 60 ? "shift pagi" : "shift siang"; };

function render() {
  const r = ui.report, p = ui.params;
  $("fdBody").hidden = false;
  const storeName = p.storeId ? (ui.data.stores.find((s) => s.id === p.storeId)?.name || p.storeId) : "";
  $("fdMeta").innerHTML = `<strong>${esc(periodLabel(p.start, r.end))}</strong>${storeName ? ` · <button type="button" class="kp-tag" data-fd-allstores title="Tampilkan semua store">Store: <b>${esc(storeName)}</b> ✕</button>` : ""}`
    + `${ui.data.at ? ` · data ${wibClock(ui.data.at)} WIB` : ""}${r.pending ? ` · <span title="Slot hari ini yang jamnya belum lewat (jam filter + toleransi) belum dihitung">${r.pending} slot hari ini belum jatuh tempo</span>` : ""}`;
  ui.total = fin(r.rows.reduce((a, x) => (add(a, x), a), blank()));
  ui.days = r.days.map((d) => ({ date: d, ...fin(group(r.rows.filter((x) => x.date === d), () => 1).get(1) || blank()) }));
  const slotAgg = group(r.rows, (x) => x.slotId);
  ui.slots = r.slots.map((s) => ({ ...s, name: `${s.label} · ${s.time}`, ...fin(slotAgg.get(s.id) || blank()) }));
  renderInsight(); renderKpis(); renderChart(); renderSlots(); renderRank(); renderActions(); renderLog();
}

function renderInsight() {
  const r = ui.report, t = ui.total, tgt = Math.round(TARGET * 100), el = $("fdInsight");
  if (!t.expected) {
    el.className = "kp-insight neutral";
    el.innerHTML = `<div class="kp-insight-head"><span class="kp-insight-icon" aria-hidden="true">i</span><div><strong>Belum ada slot wajib pada periode ini.</strong><p>Slot hari ini baru dihitung setelah jam filter + ${r.tol} menit lewat. Pilih periode lain.</p></div></div>`;
    return;
  }
  const below = t.pctDone < TARGET - 1e-9;
  const head = below ? `Compliance ${pct(t.pctDone, 1)}, ${poin(TARGET - t.pctDone)} di bawah target ${tgt}%` : `Compliance ${pct(t.pctDone, 1)}, target ${tgt}% tercapai`;
  const sub = `${t.done} dari ${t.expected} slot filter dikerjakan. ${r.stores.length > 1 ? `${r.nonCompliant} dari ${r.stores.length} store di bawah target.` : ""}`;
  const facts = [];
  const worstSlot = [...ui.slots].filter((s) => s.expected).sort((a, b) => b.MISSED / b.expected - a.MISSED / a.expected)[0];
  if (worstSlot && worstSlot.MISSED) facts.push(["bad", `${STATUS.MISSED.icon} Paling sering terlewat: ${worstSlot.label} (${worstSlot.time}), ${pct(worstSlot.MISSED / worstSlot.expected)} tidak dikerjakan`]);
  const days = ui.days.filter((d) => d.expected);
  if (days.length >= 2) {
    const worst = [...days].sort((a, b) => a.pctDone - b.pctDone)[0];
    facts.push(["warn", `Hari terendah: ${dayName(worst.date).slice(0, 3)} ${short(worst.date)} (${pct(worst.pctDone)})`]);
  }
  if (days.length >= 4) {
    const half = Math.floor(days.length / 2);
    const rate = (arr) => arr.reduce((s, d) => s + d.done, 0) / Math.max(1, arr.reduce((s, d) => s + d.expected, 0));
    const diff = rate(days.slice(-half)) - rate(days.slice(0, half));
    facts.push(Math.abs(diff) < 0.05 ? ["neutral", `Tren stabil (${diff >= 0 ? "+" : "−"}${poin(diff)})`] : diff > 0 ? ["good", `↗ Tren naik ${poin(diff)} dibanding awal periode`] : ["bad", `↘ Tren turun ${poin(diff)} dibanding awal periode`]);
  }
  const zero = r.stores.filter((s) => s.done === 0);
  if (zero.length) facts.push(["bad", `${zero.length} store tanpa input${zero.length <= 3 ? `: ${zero.map((s) => esc(s.name)).join(", ")}` : ""}`]);
  if (t.gallery) facts.push(["warn", `${t.gallery} dari ${t.done} foto dari galeri`]);
  el.className = `kp-insight ${below ? "bad" : "good"}`;
  el.innerHTML = `<div class="kp-insight-head"><span class="kp-insight-icon" aria-hidden="true">${below ? "!" : "✓"}</span><div><strong>${esc(head)}</strong><p>${esc(sub)}</p></div></div>
    ${facts.length ? `<ul class="kp-facts">${facts.slice(0, 5).map(([c, txt]) => `<li class="${c}">${txt}</li>`).join("")}</ul>` : ""}`;
}

function renderKpis() {
  const t = ui.total, r = ui.report, tgt = Math.round(TARGET * 100);
  const below = t.pctDone !== null && t.pctDone < TARGET - 1e-9;
  const ontime = t.expected ? t.ONTIME / t.expected : 0, high = t.done ? t.high / t.done : 0;
  const score = Math.round((t.pctDone || 0) * 60 + ontime * 20 + high * 20);
  const label = score >= 85 ? "Sangat efektif" : score >= 70 ? "Efektif" : score >= 50 ? "Perlu perhatian" : "Kritis";
  const scoreTip = `Skor operasional = 60% compliance (${pct(t.pctDone, 1)}) + 20% tepat waktu (${pct(ontime, 1)}) + 20% trust tinggi (${pct(high, 1)}).\nTrust tinggi = waktu foto terbaca dari EXIF kamera.`;
  $("fdKpis").innerHTML = `
    <div class="kpi kpi-compliance kp-hero${below ? " danger" : ""}">
      <span>Compliance</span><strong>${pct(t.pctDone, 1)}</strong>
      <div class="kp-meter" role="img" aria-label="Compliance ${pct(t.pctDone, 1)}, target ${tgt}%"><i style="width:${Math.round((t.pctDone || 0) * 100)}%"></i><b style="left:${tgt}%"></b></div>
      <small>${t.done} dari ${t.expected} slot dikerjakan · target ${tgt}%</small>
    </div>
    <div class="kpi kpi-missed${t.MISSED ? " danger" : ""}"><span>${STATUS.MISSED.icon} Tidak dikerjakan</span><strong>${t.MISSED}</strong><small>${pct(t.expected ? t.MISSED / t.expected : null, 1)} dari slot wajib</small></div>
    <div class="kpi kpi-variance"><span>Tidak tepat waktu</span><strong>${t.EARLY + t.LATE}</strong><small>${STATUS.EARLY.icon} ${t.EARLY} terlalu awal · ${STATUS.LATE.icon} ${t.LATE} terlambat · toleransi ±${r.tol} mnt</small></div>
    <div class="kpi kpi-ontime"><span>Foto dari kamera app</span><strong>${t.done ? pct(t.camera / t.done) : "–"}</strong><small>${t.gallery} dari ${t.done} foto dari galeri (trust rendah)</small></div>
    <div class="kpi kpi-trust" tabindex="0" data-tip="${esc(scoreTip)}"><span>Skor operasional ⓘ</span><strong>${score}<em>/100</em></strong><small>${label} · 60% compliance, 20% tepat waktu, 20% trust tinggi</small></div>`;
}

// ---------- grafik tren (SVG) ----------
function renderChart() {
  const el = $("fdChart"), days = ui.days;
  const W = Math.max(300, el.clientWidth || 600); ui.width = W;
  if (!days.some((d) => d.expected)) { el.innerHTML = `<div class="kp-empty">Belum ada slot wajib pada periode ini.</div>`; return; }
  const H = W < 600 ? 230 : 270, m = { t: 26, r: 10, b: 40, l: 40 };
  const cw = W - m.l - m.r, ch = H - m.t - m.b, n = days.length, band = cw / n;
  const bw = Math.max(3, Math.min(40, band * 0.64)), y = (v) => m.t + ch * (1 - v);
  const showVal = n <= (W < 600 ? 8 : 16), every = Math.ceil(n / (W < 600 ? 6 : 14));
  const today = ui.report.today;
  let svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Grafik compliance per hari"><defs>
    <pattern id="fdHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#fde4e1"/><rect width="2" height="6" fill="#eea59d"/></pattern></defs>`;
  for (const v of [0, 0.25, 0.5, 0.75, 1]) svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" stroke="${v ? "#edf1f5" : "#c9d3de"}"/><text x="${m.l - 8}" y="${y(v)}" text-anchor="end" dominant-baseline="middle" class="fd-ax">${v * 100}%</text>`;
  days.forEach((d, i) => {
    const x = m.l + i * band + (band - bw) / 2, cx = m.l + i * band + band / 2;
    if (d.expected) {
      let top = y(0);
      const segs = SEGMENTS.map(([k]) => [k, d[k]]).filter(([, v]) => v > 0);
      svg += `<g>`;
      segs.forEach(([k, v], j) => {
        const h = (ch * v) / d.expected, yTop = top - h, last = j === segs.length - 1;
        const fill = k === "MISSED" ? "url(#fdHatch)" : { ONTIME: "#15a36d", EARLY: "#d99a0b", LATE: "#a14d0c" }[k];
        const hh = Math.max(0, h - (last ? 0 : 2)), r4 = Math.min(4, bw / 2, h);
        svg += last
          ? `<path d="M${x},${top} V${yTop + r4} Q${x},${yTop} ${x + r4},${yTop} H${x + bw - r4} Q${x + bw},${yTop} ${x + bw},${yTop + r4} V${top} Z" fill="${fill}"/>`
          : `<rect x="${x}" y="${top - hh}" width="${bw}" height="${hh}" fill="${fill}"/>`;
        top = yTop;
      });
      svg += `</g>`;
      if (showVal) svg += `<text x="${cx}" y="${m.t - 8}" text-anchor="middle" class="fd-val${d.pctDone < TARGET ? " bad" : ""}">${pct(d.pctDone)}</text>`;
    } else svg += `<text x="${cx}" y="${y(0) - 8}" text-anchor="middle" class="fd-ax">–</text>`;
    if (i % every === 0 || i === n - 1) svg += `<text x="${cx}" y="${H - m.b + 16}" text-anchor="middle" class="fd-ax${d.date === today ? " fd-today" : ""}">${esc(dayName(d.date).slice(0, 3))}</text><text x="${cx}" y="${H - m.b + 30}" text-anchor="middle" class="fd-ax${d.date === today ? " fd-today" : ""}">${short(d.date)}</text>`;
    const tip = d.expected
      ? `${dayName(d.date)}, ${fmtDate(d.date)}${d.date === today ? " (hari ini, slot jatuh tempo saja)" : ""}\nCompliance ${pct(d.pctDone, 1)} · ${d.done}/${d.expected} slot\n${SEGMENTS.map(([k]) => `${STATUS[k].icon} ${STATUS[k].label}: ${d[k]}`).join("\n")}`
      : `${dayName(d.date)}, ${fmtDate(d.date)}: belum ada slot wajib`;
    svg += `<rect x="${m.l + i * band}" y="${m.t}" width="${band}" height="${ch}" fill="transparent" class="fd-hit" tabindex="0" data-tip="${esc(tip)}"><title>${esc(tip.split("\n")[0])}</title></rect>`;
  });
  const ty = y(TARGET);
  svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${ty}" y2="${ty}" stroke="#1f2a37" stroke-width="1.5" stroke-dasharray="6 4" pointer-events="none"/></svg>`;
  el.innerHTML = svg;
}

function renderSlots() {
  const worst = [...ui.slots].filter((s) => s.expected && s.MISSED).sort((a, b) => b.MISSED / b.expected - a.MISSED / a.expected)[0];
  $("fdSlots").innerHTML = ui.slots.map((s) => {
    const ok = s.expected && s.pctDone >= TARGET - 1e-9;
    return `<div class="card fd-slot${worst && worst.id === s.id ? " fd-worst" : ""}">
      <div class="fd-slot-head"><div><div class="section-label">${esc(s.label)}</div><span class="fd-slot-time">Jam ${esc(s.time)} · ${shiftName(s.time)}</span></div>
        ${worst && worst.id === s.id ? `<span class="status bad">✕&nbsp;Paling sering terlewat</span>` : ""}</div>
      <strong class="fd-slot-val ${s.expected ? (ok ? "ok" : "no") : ""}">${s.expected ? pct(s.pctDone, 1) : "–"}</strong>
      ${s.expected ? stackHtml(s, TARGET) : `<span class="hint">Belum ada slot wajib.</span>`}
      <small class="fd-slot-sub">${s.done}/${s.expected} dikerjakan · ${STATUS.MISSED.icon} ${s.MISSED} tidak · ${STATUS.EARLY.icon} ${s.EARLY} awal · ${STATUS.LATE.icon} ${s.LATE} terlambat</small>
    </div>`;
  }).join("");
}

function renderRank() {
  const r = ui.report;
  if (!r.stores.length) { $("fdRank").innerHTML = `<div class="kp-empty">Tidak ada slot wajib pada periode ini.</div>`; return; }
  $("fdRank").innerHTML = `<ul class="kp-legend">${legendHtml()}</ul><div class="kp-rank fd-rank" role="list">${r.stores.map((s, i) => `<div role="listitem">
    <button type="button" class="kp-rank-row" data-fd-store="${esc(s.id)}" title="Lihat Dashboard ${esc(s.name)} saja">
      <span class="kp-rank-no">${i + 1}</span>
      <span class="kp-rank-name"><strong>${esc(s.name)}</strong><small>${esc(s.area || "–")} · ${s.expected} slot</small></span>
      ${stackHtml(s, TARGET)}
      <span class="kp-rank-val ${s.compliant ? "ok" : "no"}"><strong>${pct(s.pctDone, 1)}</strong><small>${s.compliant ? "✓ Patuh" : "✕ Tidak patuh"}</small></span>
    </button></div>`).join("")}</div>`;
}

function storeActions() {
  const r = ui.report;
  const bySlot = new Map();
  for (const x of r.rows) {
    const k = `${x.storeId}|${x.slotId}`;
    if (!bySlot.has(k)) bySlot.set(k, { label: x.slot, time: x.planned, expected: 0, MISSED: 0 });
    const a = bySlot.get(k); a.expected++; if (x.status === "MISSED") a.MISSED++;
  }
  const items = [];
  for (const s of r.stores) {
    const probs = [];
    if (s.done === 0) probs.push({ sev: 3, text: `Tidak ada input sama sekali (${s.expected} slot)`, act: "Hubungi store hari ini: cek crew bertugas, akses app, dan HP untuk foto." });
    else {
      if (s.MISSED > 0) {
        const w = r.slots.map((sl) => bySlot.get(`${s.id}|${sl.id}`)).filter(Boolean).sort((a, b) => b.MISSED - a.MISSED)[0];
        if (w && w.MISSED >= Math.max(2, s.MISSED * 0.5)) probs.push({ sev: 2, text: `${w.MISSED} dari ${w.expected} slot ${w.label} (${w.time}) terlewat`, act: `Tunjuk PIC ${shiftName(w.time)} dan pasang pengingat 15 menit sebelum ${w.time}.` });
        else probs.push({ sev: 2, text: `${s.MISSED} dari ${s.expected} slot tidak dikerjakan`, act: "Masukkan 3 slot filter ke checklist serah-terima shift." });
      }
      const off = s.EARLY + s.LATE;
      if (off >= Math.max(2, s.done * 0.3)) probs.push({ sev: 1, text: `${off} dari ${s.done} input tidak tepat waktu (${s.EARLY} awal · ${s.LATE} terlambat)`, act: `Kerjakan filter dalam ±${r.tol} menit dari jam slot, jangan dirapel.` });
      if (s.gallery >= Math.max(2, s.done * 0.5)) probs.push({ sev: 1, text: `${s.gallery} dari ${s.done} foto dari galeri`, act: "Wajibkan foto langsung dari kamera app saat filter dikerjakan." });
    }
    if (probs.length && !(s.compliant && probs.every((p) => p.sev < 2))) items.push({ s, probs: probs.slice(0, 2) });
  }
  return items.sort((a, b) => a.s.pctDone - b.s.pctDone);
}
function renderActions() {
  const items = storeActions(), shown = items.slice(0, 5);
  if (!items.length) { $("fdActions").innerHTML = `<div class="kp-empty">👍 Tidak ada store yang perlu ditindaklanjuti.</div>`; return; }
  $("fdActions").innerHTML = `<ol class="fd-acts">${shown.map(({ s, probs }) => `<li class="fd-act">
      <div class="fd-act-head"><button type="button" class="fd-link" data-fd-store="${esc(s.id)}">${esc(s.name)}</button><span class="kp-rank-val no"><strong>${pct(s.pctDone, 1)}</strong></span></div>
      <ul>${probs.map((p) => `<li class="sev-${p.sev}"><span class="fd-act-prob">${p.sev >= 2 ? "✕" : "!"} ${esc(p.text)}</span><span class="fd-act-do">→ ${esc(p.act)}</span></li>`).join("")}</ul>
    </li>`).join("")}</ol>${items.length > shown.length ? `<div class="kp-more"><span>+${items.length - shown.length} store lain perlu tindak lanjut.</span><button type="button" class="btn secondary smallbtn" data-fd-goto="kepatuhan">Lihat semua di Export Kepatuhan</button></div>` : ""}`;
}

// ---------- log evidence (foto dimuat saat terlihat) ----------
const LOG_FILTERS = [
  { key: "all", label: "Semua", test: () => true },
  { key: "off", label: "Tidak tepat waktu", test: (x) => x.status === "EARLY" || x.status === "LATE" },
  { key: "gallery", label: "Foto galeri", test: (x) => x.photo === "Dari galeri" },
  { key: "review", label: "Perlu review", test: (x) => x.review, hideEmpty: true },
];
function logRows() {
  const r = ui.report, p = ui.params, names = new Map(ui.data.stores.map((s) => [s.id, s.name]));
  const slotTime = new Map(r.slots.map((s) => [s.id, s]));
  return ui.data.records
    .filter((x) => x.dedupArchived !== true && x.dateKey >= p.start && x.dateKey <= r.end && (!p.storeId || x.storeId === p.storeId))
    .map((x) => ({
      id: x.id, date: x.dateKey, time: actualTime(x, x.dateKey), sort: String(x.evidenceLocalIso || x.submittedAt || x.dateKey),
      store: names.get(x.storeId) || x.storeName || x.storeId, crew: String(x.crewName || ""),
      slot: slotTime.get(x.slotId)?.label || x.slotId, planned: slotTime.get(x.slotId)?.time || "",
      status: statusOf(x, r.tol).key, review: x.integrity === "REVIEW" || String(x.status || "").toUpperCase() === "REVIEW",
      photo: photoSource(x), trust: String(x.metadataTrust || "").toUpperCase(), note: String(x.note || ""),
    }))
    .sort((a, b) => b.sort.localeCompare(a.sort));
}
const TRUST = { HIGH: ["good", "Tinggi"], MEDIUM: ["warn", "Sedang"], LOW: ["bad", "Rendah"] };
function renderLog() {
  const all = logRows();
  const flt = LOG_FILTERS.find((f) => f.key === ui.log) || LOG_FILTERS[0];
  $("fdLogChips").innerHTML = LOG_FILTERS.map((f) => [f, all.filter(f.test).length]).filter(([f, n]) => !f.hideEmpty || n || f.key === ui.log)
    .map(([f, n]) => `<button type="button" class="kp-chip" data-fd-log="${f.key}" aria-pressed="${f.key === flt.key}">${f.label} <span class="kp-count">${n}</span></button>`).join("");
  const rows = all.filter(flt.test), shown = rows.slice(0, ui.logShown);
  $("fdLogHint").textContent = `${rows.length} evidence · terbaru di atas · foto dimuat saat terlihat`;
  const dash = `<span class="kp-muted">–</span>`;
  $("fdLog").innerHTML = `<thead><tr><th>Foto</th><th>Waktu</th><th>Store</th><th>Slot</th><th>Status</th><th>Crew</th><th>Sumber foto</th><th>Trust</th><th>Catatan</th></tr></thead><tbody>${
    shown.map((x) => {
      const st = STATUS[x.status], cls = { good: "good", warning: "early", serious: "late", critical: "bad" }[st.tone];
      const [tc, tl] = TRUST[x.trust] || ["neutral", x.trust || "–"];
      const cap = `${x.store} · ${x.slot} ${x.planned} · ${dayName(x.date)} ${fmtDate(x.date)} ${x.time} · ${x.crew}`;
      return `<tr>
        <td data-label="Foto"><button type="button" class="fd-thumb" data-fd-img="${esc(x.id)}" data-cap="${esc(cap)}" aria-label="Lihat foto ${esc(cap)}"><span class="kp-spin" aria-hidden="true"></span></button></td>
        <td data-label="Waktu"><strong>${esc(dayName(x.date).slice(0, 3))}, ${short(x.date)}</strong> <small class="kp-muted">${esc(x.time)}</small></td>
        <td data-label="Store">${esc(x.store)}</td>
        <td data-label="Slot">${esc(x.slot)} <small class="kp-muted">${esc(x.planned)}</small></td>
        <td data-label="Status"><span class="status kp-st-${cls}"><span aria-hidden="true">${st.icon}</span>&nbsp;${esc(st.label)}</span>${x.review ? ` <span class="status kp-st-early">⚠&nbsp;Review</span>` : ""}</td>
        <td data-label="Crew">${esc(x.crew) || dash}</td>
        <td data-label="Sumber foto">${x.photo === "Dari galeri" ? `<span class="kp-gal">${esc(x.photo)}</span>` : esc(x.photo) || dash}</td>
        <td data-label="Trust"><span class="badge ${tc}" title="Trust = keandalan waktu foto: Tinggi (EXIF kamera), Sedang (kamera app), Rendah (file/galeri)">${esc(tl)}</span></td>
        <td data-label="Catatan" class="kp-note${x.note ? "" : " kp-note-empty"}">${esc(x.note) || dash}</td></tr>`;
    }).join("") || `<tr class="kp-empty-row"><td colspan="9"><div class="kp-empty">Belum ada evidence untuk saringan ini.</div></td></tr>`}</tbody>`;
  $("fdLogMore").innerHTML = rows.length > shown.length
    ? `<span>Menampilkan ${shown.length} dari ${rows.length} evidence.</span><button type="button" class="btn secondary smallbtn" data-fd-more>Tampilkan ${Math.min(LOG_PAGE, rows.length - shown.length)} lagi</button>` : "";
  observeThumbs();
}

let observer = null;
const queue = [];
let active = 0;
function observeThumbs() {
  const thumbs = document.querySelectorAll("#fdLog .fd-thumb[data-fd-img]:not([data-seen])");
  if (!("IntersectionObserver" in window)) { thumbs.forEach(enqueue); return; }
  observer = observer || new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { observer.unobserve(e.target); enqueue(e.target); } }), { rootMargin: "200px" });
  thumbs.forEach((t) => observer.observe(t));
}
function enqueue(btn) { btn.dataset.seen = "1"; queue.push(btn); pump(); }
function pump() {
  while (active < 3 && queue.length) {
    const btn = queue.shift();
    if (!btn.isConnected) continue;
    active++;
    imageOf(btn.dataset.fdImg)
      .then((src) => { btn.innerHTML = src ? `<img alt="" src="${esc(src)}">` : `<span class="kp-muted">tidak ada</span>`; })
      .catch(() => { btn.innerHTML = `<span class="kp-muted">gagal</span>`; })
      .finally(() => { active--; pump(); });
  }
}
function imageOf(id) {
  if (!imgCache.has(id)) imgCache.set(id, loadEvidenceImage(id).catch((e) => { imgCache.delete(id); throw e; }));
  return imgCache.get(id);
}
let lastFocus = null;
async function openLightbox(btn) {
  lastFocus = btn;
  const box = $("fdLightbox");
  $("fdLightboxCap").textContent = btn.dataset.cap || "";
  $("fdLightboxImg").innerHTML = `<span class="kp-spin" aria-hidden="true"></span>`;
  box.hidden = false;
  box.querySelector("[data-fd-close]").focus();
  try {
    const src = await imageOf(btn.dataset.fdImg);
    $("fdLightboxImg").innerHTML = src ? `<img alt="${esc(btn.dataset.cap || "Foto evidence")}" src="${esc(src)}">` : `<span>Foto tidak tersedia.</span>`;
  } catch (e) { $("fdLightboxImg").textContent = `Foto gagal dimuat: ${e.message}`; }
}
function closeLightbox() {
  const box = $("fdLightbox");
  if (!box || box.hidden) return;
  box.hidden = true;
  lastFocus?.focus();
}

// ---------- klik ----------
function onClick(e) {
  const t = e.target;
  const preset = t.closest("[data-fd-preset]");
  if (preset) {
    const [s, en] = PRESETS.find(([k]) => k === preset.dataset.fdPreset)[2](ymdWib(Date.now()));
    $("dashFrom").value = s; $("dashTo").value = en; schedule(); return;
  }
  const store = t.closest("[data-fd-store]");
  if (store) { $("dashStore").value = store.dataset.fdStore; schedule(); $("dashboard").scrollIntoView({ behavior: "smooth", block: "start" }); return; }
  if (t.closest("[data-fd-allstores]")) { $("dashStore").value = "ALL"; schedule(); return; }
  const chip = t.closest("[data-fd-log]");
  if (chip) { ui.log = chip.dataset.fdLog; ui.logShown = LOG_PAGE; renderLog(); return; }
  if (t.closest("[data-fd-more]")) { ui.logShown += LOG_PAGE; renderLog(); return; }
  if (t.closest("[data-fd-retry]")) { schedule(true); return; }
  const thumb = t.closest("[data-fd-img]");
  if (thumb) { openLightbox(thumb); return; }
  if (t.closest("[data-fd-close]") || t.id === "fdLightbox") { closeLightbox(); return; }
  const go = t.closest("[data-fd-goto]");
  if (go) document.querySelector(`.tab[data-tab="${go.dataset.fdGoto}"]`)?.click();
}
