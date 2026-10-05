// Bagian bersama untuk tambahan app Filter Oil: data (cache), export Excel, format angka, badge, tooltip.
// Dipakai menu "Export Kepatuhan" (panel.js) dan Dashboard baru (dashboard.js). Tanpa efek samping saat di-import.
import { buildReport, STATUS, fmtDate, dayName, addDays } from "./kepatuhan.js";
import { loadStores, loadSettings, loadRecords, loadExcelJS, buildWorkbook, downloadWorkbook, wibNowLabel, exportFileName } from "./core.js";

export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const num = (x, d = 0) => Number(x).toFixed(d).replace(".", ",");
export const pct = (x, d = 0) => (x === null || x === undefined || Number.isNaN(x) ? "–" : `${num(x * 100, d)}%`);
export const poin = (x) => `${num(Math.abs(x * 100), 1)} poin`;
export const short = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
export const pref = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* mode privat / storage diblokir */ } },
};
// Urutan segmen batang = urutan status; "Tidak dikerjakan" digambar sebagai sisa bergaris (tekstur), bukan warna solid.
export const SEGMENTS = [["ONTIME", "s-ontime"], ["EARLY", "s-early"], ["LATE", "s-late"], ["MISSED", "s-missed"]];

export const PRESETS = [
  ["today", "Hari ini", (t) => [t, t]],
  ["yesterday", "Kemarin", (t) => [addDays(t, -1), addDays(t, -1)]],
  ["7", "7 hari", (t) => [addDays(t, -6), t]],
  ["30", "30 hari", (t) => [addDays(t, -29), t]],
  ["month", "Bulan ini", (t) => [`${t.slice(0, 8)}01`, t]],
];

// ---------- data (cache per sesi halaman, dipakai bersama kedua menu) ----------
const cache = { stores: null, settings: null, records: new Map(), at: new Map() };
export async function getData(start, end, force = false) {
  if (force || !cache.stores) [cache.stores, cache.settings] = await Promise.all([loadStores(), loadSettings()]);
  const key = `${start}|${end}`;
  if (force || !cache.records.has(key)) { cache.records.set(key, await loadRecords(start, end)); cache.at.set(key, Date.now()); }
  return { stores: cache.stores, settings: cache.settings || {}, records: cache.records.get(key), at: cache.at.get(key) };
}
export function report({ start, end, storeId = "", target = 0.95 }, data) {
  const stores = storeId ? data.stores.filter((s) => s.id === storeId) : data.stores;
  return buildReport({ stores, records: data.records, settings: data.settings, start, end, nowMs: Date.now(), target });
}
export async function exportExcel(params, data) {
  const r = report(params, data);
  if (!r.rows.length) throw new Error("Tidak ada slot wajib pada periode ini.");
  const ExcelJS = await loadExcelJS();
  const storeName = params.storeId ? (data.stores.find((s) => s.id === params.storeId)?.name || params.storeId) : "";
  const wb = await buildWorkbook(ExcelJS, r, { area: storeName ? `Store ${storeName}` : "", generatedAt: wibNowLabel() });
  await downloadWorkbook(wb, exportFileName(r, storeName));
  return r;
}

// ---------- UI kecil ----------
export function toast(msg) {
  const t = $("toast");
  if (!t) return;
  t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.add("hidden"), 3500);
}
export async function busy(btn, label, fn) {
  const old = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="kp-spin" aria-hidden="true"></span>${esc(label)}`;
  try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = old; }
}
export const statusBadge = (key) => {
  const s = STATUS[key] || STATUS.MISSED;
  const cls = { good: "good", warning: "early", serious: "late", critical: "bad" }[s.tone];
  return `<span class="status kp-st-${cls}"><span aria-hidden="true">${s.icon}</span>&nbsp;${esc(s.label)}</span>`;
};
export const compliantBadge = (ok) => (ok ? `<span class="status good">✓&nbsp;Patuh</span>` : `<span class="status bad">✕&nbsp;Tidak patuh</span>`);
export function dayTone(d, target) {
  if (!d || !d.expected) return "none";
  if (d.pctDone >= target - 1e-9) return "good";
  if (d.pctDone >= 0.5) return "warning";
  if (d.pctDone > 0) return "serious";
  return "critical";
}
export function periodLabel(start, end) {
  if (start === end) return `${dayName(start)}, ${fmtDate(start)}`;
  const n = Math.round((Date.parse(end) - Date.parse(start)) / 864e5) + 1;
  return `${start.slice(0, 4) === end.slice(0, 4) ? short(start) : fmtDate(start)} – ${fmtDate(end)} · ${n} hari`;
}
export function stackTip(s) {
  return `${s.name} · ${s.expected} slot wajib\n${SEGMENTS.map(([k]) => `${STATUS[k].icon} ${STATUS[k].label}: ${s[k]}`).join("\n")}\nCompliance ${pct(s.pctDone, 1)}${s.gallery ? `\nFoto dari galeri: ${s.gallery}` : ""}`;
}
/** Batang bertumpuk satu store/slot: lebar segmen = porsi slot wajib, garis putus-putus = target. */
export function stackHtml(s, target) {
  const segs = SEGMENTS.filter(([k]) => s[k] > 0).map(([k, c]) => `<i class="${c}" style="width:${(s[k] / s.expected) * 100}%"></i>`).join("");
  return `<span class="kp-stack" data-tip="${esc(stackTip(s))}" aria-label="${esc(stackTip(s))}">${segs}<b class="kp-tmark" style="left:${target * 100}%"></b></span>`;
}
export function legendHtml(withTarget = true) {
  return `${SEGMENTS.map(([k, c]) => `<li><span class="kp-sw ${c}"></span>${STATUS[k].icon} ${esc(STATUS[k].label)}</li>`).join("")}${withTarget ? `<li><span class="kp-sw kp-sw-target"></span>Target</li>` : ""}`;
}
/** Waktu data diambil (WIB, HH:MM). */
export const wibClock = (ms) => (ms ? new Date(ms + 7 * 3600_000).toISOString().slice(11, 16) : "");

// ---------- tooltip (mouse, keyboard, sentuh) untuk elemen ber-atribut data-tip di dalam root ----------
export function initTooltip(root, tip) {
  let current = null;
  const show = (el) => {
    const text = el.getAttribute("data-tip"); if (!text) return;
    current = el;
    tip.textContent = ""; text.split("\n").forEach((line, i) => { if (i) tip.appendChild(document.createElement("br")); tip.appendChild(document.createTextNode(line)); });
    tip.hidden = false;
    const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = `${Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8))}px`;
    tip.style.top = `${r.top - h - 8 < 8 ? r.bottom + 8 : r.top - h - 8}px`;
  };
  const hide = () => { tip.hidden = true; current = null; };
  root.addEventListener("mouseover", (e) => { const el = e.target.closest("[data-tip]"); if (el && el !== current && root.contains(el)) show(el); });
  root.addEventListener("mouseout", (e) => { const el = e.target.closest("[data-tip]"); if (el && !el.contains(e.relatedTarget)) hide(); });
  root.addEventListener("focusin", (e) => { const el = e.target.closest("[data-tip]"); if (el) show(el); });
  root.addEventListener("focusout", hide);
  document.addEventListener("click", (e) => { const el = e.target.closest("[data-tip]"); if (!el || !root.contains(el)) hide(); else if (el !== current) show(el); });
  window.addEventListener("scroll", hide, { passive: true });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
}
