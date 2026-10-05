// Logika kepatuhan filter oil. Modul murni (tanpa DOM), dipakai halaman web dan tes Node.
//
// Aturan (mengikuti app Trecking Filter Oil, dokumen settings/app):
//   - Setiap store aktif wajib filter di setiap slot per hari (slot1..slotN, mis. 09:00, 16:00, 23:30)
//     mulai tanggal activeFrom store.
//   - Status per slot dari data filterRecords: ON TIME (|selisih| <= toleransi) skor 1,
//     EARLY / LATE skor 0,5, tidak ada data = TIDAK DIKERJAKAN skor 0.
//   - Slot hari ini baru dihitung setelah jam slot + toleransi lewat (sebelum itu "belum jatuh tempo").
//   - Skor kepatuhan store = total skor / jumlah slot wajib. Store "Tidak patuh" bila skor < target.

export const WIB_MS = 7 * 3600_000;
const DAY_MS = 86_400_000;
const DAYS = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

export const STATUS = {
  ONTIME: { key: "ONTIME", label: "Tepat waktu", score: 1, tone: "good", icon: "✓" },
  EARLY: { key: "EARLY", label: "Terlalu awal", score: 0.5, tone: "warning", icon: "↑" },
  LATE: { key: "LATE", label: "Terlambat", score: 0.5, tone: "serious", icon: "↓" },
  MISSED: { key: "MISSED", label: "Tidak dikerjakan", score: 0, tone: "critical", icon: "✕" },
};
const STATUS_RANK = { ONTIME: 3, EARLY: 2, LATE: 2, MISSED: 0 };

export const ymdWib = (ms) => new Date(ms + WIB_MS).toISOString().slice(0, 10);
export const minutesWib = (ms) => { const d = new Date(ms + WIB_MS); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
export const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
export const dayName = (ymd) => DAYS[new Date(`${ymd}T00:00:00Z`).getUTCDay()];
export const fmtDate = (ymd) => (ymd ? `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}` : "");
export function dateRange(start, end) {
  const out = [];
  if (!start || !end || start > end) return out;
  for (let d = start; d <= end && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}
export const toMinutes = (hhmm) => {
  const m = /^(\d{1,2})[:.](\d{2})/.exec(String(hhmm ?? "").trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** Slot dari settings/app: { slot1: "09:00", slot2: "16:00", ... } → [{ id: "FILTER-1", label: "FILTER 1", time: "09:00" }, ...] */
export function slotsFromSettings(settings = {}) {
  const slots = Object.keys(settings)
    .filter((k) => /^slot\d+$/.test(k) && toMinutes(settings[k]) !== null)
    .sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)))
    .map((k) => {
      const n = k.slice(4);
      const min = toMinutes(settings[k]);
      return { id: `FILTER-${n}`, label: `FILTER ${n}`, time: `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}` };
    });
  return slots.length ? slots : [
    { id: "FILTER-1", label: "FILTER 1", time: "09:00" },
    { id: "FILTER-2", label: "FILTER 2", time: "16:00" },
    { id: "FILTER-3", label: "FILTER 3", time: "23:30" },
  ];
}

/** Status satu catatan filter. Pakai status dari app; bila kosong, hitung dari selisih menit dan toleransi. */
export function statusOf(rec, tol = 30) {
  const s = String(rec.status || "").toUpperCase().replace(/[\s_-]+/g, "");
  if (s === "ONTIME") return STATUS.ONTIME;
  if (s === "EARLY") return STATUS.EARLY;
  if (s === "LATE") return STATUS.LATE;
  const dev = Number(rec.deviationMin);
  if (!Number.isFinite(dev)) return STATUS.ONTIME;
  return Math.abs(dev) <= tol ? STATUS.ONTIME : dev < 0 ? STATUS.EARLY : STATUS.LATE;
}

/** Jam aktual dari bukti foto (waktu lokal) atau waktu submit (WIB). Tanggal ikut ditulis bila beda hari. */
export function actualTime(rec, dateKey) {
  let iso = "";
  if (typeof rec.evidenceLocalIso === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(rec.evidenceLocalIso)) iso = rec.evidenceLocalIso;
  else if (rec.submittedAt && !Number.isNaN(Date.parse(rec.submittedAt))) iso = new Date(Date.parse(rec.submittedAt) + WIB_MS).toISOString();
  if (!iso) return "";
  const hm = iso.slice(11, 16);
  return iso.slice(0, 10) === dateKey ? hm : `${fmtDate(iso.slice(0, 10)).slice(0, 5)} ${hm}`;
}

/** Sumber foto: diambil langsung di app (Capture Session) atau berkas/galeri (File lastModified, trust LOW). */
export function photoSource(rec) {
  const src = String(rec.evidenceTimeSource || "").toLowerCase();
  if (src.includes("capture")) return "Kamera app";
  if (src.includes("file") || String(rec.metadataTrust || "").toUpperCase() === "LOW") return "Dari galeri";
  return rec.evidenceTimeSource ? String(rec.evidenceTimeSource) : "";
}

/**
 * Susun laporan kepatuhan.
 * @param {object} p
 * @param {Array<{id,name,area,active,activeFrom}>} p.stores
 * @param {Array<object>} p.records  dokumen filterRecords (nilai sudah diratakan)
 * @param {object} p.settings        dokumen settings/app
 * @param {string} p.start           YYYY-MM-DD
 * @param {string} p.end             YYYY-MM-DD
 * @param {number} p.nowMs
 * @param {string} [p.area]          kosong = semua area
 * @param {number} [p.target]        0..1, default 0.9
 */
export function buildReport({ stores, records, settings = {}, start, end, nowMs, area = "", target = 0.9 }) {
  const tol = Number.isFinite(Number(settings.toleranceMin)) ? Number(settings.toleranceMin) : 30;
  const slots = slotsFromSettings(settings);
  const today = ymdWib(nowMs);
  const nowMin = minutesWib(nowMs);
  const last = end > today ? today : end;

  // satu catatan per store-tanggal-slot; bila dobel, ambil yang statusnya terbaik lalu yang paling awal dikirim
  const byKey = new Map();
  for (const r of records) {
    if (r.dedupArchived === true || !r.storeId || !r.dateKey || !r.slotId) continue;
    const k = `${r.storeId}|${r.dateKey}|${r.slotId}`;
    const prev = byKey.get(k);
    if (!prev) { byKey.set(k, r); continue; }
    const a = STATUS_RANK[statusOf(r, tol).key], b = STATUS_RANK[statusOf(prev, tol).key];
    if (a > b || (a === b && String(r.submittedAt || "") < String(prev.submittedAt || ""))) byKey.set(k, r);
  }

  const storeList = stores
    .filter((s) => s.active !== false && (!area || s.area === area))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), "id"));
  const days = dateRange(start, last);
  const rows = [];
  let pending = 0;
  for (const s of storeList) {
    for (const d of days) {
      if (s.activeFrom && d < String(s.activeFrom).slice(0, 10)) continue;
      for (const sl of slots) {
        const r = byKey.get(`${s.id}|${d}|${sl.id}`);
        const due = d < today || nowMin >= toMinutes(sl.time) + tol;
        if (!r && !due) { pending++; continue; }
        const st = r ? statusOf(r, tol) : STATUS.MISSED;
        const appScore = r ? Number(r.complianceScore) : NaN;
        rows.push({
          date: d, day: dayName(d), storeId: s.id, store: s.name, area: s.area || "",
          slotId: sl.id, slot: sl.label, planned: sl.time,
          actual: r ? actualTime(r, d) : "",
          deviation: r && r.deviationMin !== undefined && r.deviationMin !== null && r.deviationMin !== "" && Number.isFinite(Number(r.deviationMin)) ? Number(r.deviationMin) : null,
          status: st.key, statusLabel: st.label,
          score: r ? (Number.isFinite(appScore) ? appScore : st.score) : 0,
          crew: r ? String(r.crewName || "") : "",
          photo: r ? photoSource(r) : "",
          note: r ? String(r.note || "") : "",
        });
      }
    }
  }

  const blank = () => ({ expected: 0, ONTIME: 0, EARLY: 0, LATE: 0, MISSED: 0, scoreSum: 0, gallery: 0 });
  const add = (acc, row) => { acc.expected++; acc[row.status]++; acc.scoreSum += row.score; if (row.photo === "Dari galeri") acc.gallery++; };
  const finish = (acc) => {
    const done = acc.expected - acc.MISSED;
    const score = acc.expected ? acc.scoreSum / acc.expected : null;
    return { ...acc, done, pctDone: acc.expected ? done / acc.expected : null, pctOntime: acc.expected ? acc.ONTIME / acc.expected : null, score, compliant: score === null ? null : score >= target - 1e-9 };
  };

  const perStore = new Map(storeList.map((s) => [s.id, { store: s, acc: blank(), daily: new Map() }]));
  const total = blank();
  for (const row of rows) {
    const p = perStore.get(row.storeId);
    add(p.acc, row); add(total, row);
    if (!p.daily.has(row.date)) p.daily.set(row.date, blank());
    add(p.daily.get(row.date), row);
  }
  const summaries = [...perStore.values()]
    .filter((p) => p.acc.expected > 0)
    .map((p) => ({
      id: p.store.id, name: p.store.name, area: p.store.area || "",
      ...finish(p.acc),
      daily: Object.fromEntries([...p.daily.entries()].map(([d, a]) => [d, finish(a)])),
    }))
    .sort((a, b) => a.score - b.score || b.MISSED - a.MISSED || a.name.localeCompare(b.name, "id"));

  return {
    start, end: last, today, days, slots, tol, target, rows, pending,
    stores: summaries,
    total: finish(total),
    nonCompliant: summaries.filter((s) => s.compliant === false).length,
    areas: [...new Set(stores.filter((s) => s.active !== false).map((s) => s.area).filter(Boolean))].sort(),
  };
}
