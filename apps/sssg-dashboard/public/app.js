/* Dashboard SSSG Inti Warna — membaca Google Sheet langsung (gviz) atau via Apps Script Web App */
(function () {
  const C = window.SSSG_CONFIG;
  const MONTH_NAMES = C.MONTH_SHEETS;
  const MONTH_SHORT = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
  const $ = (id) => document.getElementById(id);

  const state = { view: "sssg", years: {}, yearList: [], year: C.YEAR, months: [], baseMonths: [], hasBase: false, baseline: null, rekap: null, mode: "yoy", month: null, charts: {}, trendKeys: new Set(), fetchedAt: null };

  // ---------- util ----------
  const norm = (v) => (v == null ? "" : String(v)).replace(/\s+/g, " ").trim().toUpperCase();
  // Header bisa kemasukan judul sheet yang di-merge (mis. "FORM TOTAL OMSET ... PERIODE JULI TGL"): cocokkan persis ATAU berakhiran " TOKEN".
  const isTok = (v, tok) => { const H = norm(v); return H === tok || H.endsWith(" " + tok); };
  // Angka bisa datang sebagai TEKS berformat Indonesia ("16.042.000", "26.263.644,13", "Rp 438.362.416") bila sel diketik manual;
  // gviz mengirimnya sebagai string. Deteksi pemisah ribuan vs desimal, dukung format ID maupun EN ("1,234.5").
  const num = (v) => {
    if (v == null || v === "") return null;
    if (typeof v === "number") return isFinite(v) ? v : null;
    let s = String(v).replace(/[^\d.,\-]/g, ""); if (!s) return null;
    const neg = s.includes("-"); s = s.replace(/-/g, "");
    const ld = s.lastIndexOf("."), lc = s.lastIndexOf(",");
    if (ld >= 0 && lc >= 0) s = lc > ld ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");      // keduanya: pemisah terakhir = desimal
    else if (lc >= 0) s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");         // hanya koma: ribuan-EN atau desimal-ID
    else if (ld >= 0 && /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");                          // hanya titik pola ribuan-ID: "16.042.000"
    const n = Number(s); return isFinite(n) ? (neg ? -n : n) : null;
  };
  const fmtRp = (v) => v == null ? "—" : "Rp " + Math.round(v).toLocaleString("id-ID");
  const fmtRpS = (v) => v == null ? "—" : (Math.abs(v) >= 1e9 ? (v / 1e9).toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " M" : (v / 1e6).toLocaleString("id-ID", { maximumFractionDigits: 1 }) + " jt");
  const fmtPct = (v, d = 1) => v == null ? "n/a" : (v > 0 ? "+" : "") + (v * 100).toLocaleString("id-ID", { minimumFractionDigits: d, maximumFractionDigits: d }) + "%";
  const cls = (v) => v == null ? "na" : v >= C.THRESHOLD.good / 100 ? "good" : v >= C.THRESHOLD.warn / 100 ? "warn" : "bad";
  const daysIn = (y, m) => new Date(y, m + 1, 0).getDate();
  const Y = () => state.year, BY = () => state.year - 1; // tahun yang ditampilkan & tahun pembanding

  function parseDate(v) {
    if (v == null || v === "") return null;
    if (v instanceof Date) return v;
    if (typeof v === "string") {
      let m = v.match(/^Date\((\d+),(\d+),(\d+)/); if (m) return new Date(+m[1], +m[2], +m[3]);
      m = v.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
      m = v.match(/^(\d{1,2})[\/\-,.](\d{1,2})[\/\-,.](\d{4})/); if (m) return new Date(+m[3], +m[2] - 1, +m[1]); // dukung "30,03,2026"
    }
    return null;
  }

  // ---------- data fetch ----------
  async function fetchSheetExact(n, opt = {}) {
    const sheetId = opt.sheetId || C.SHEET_ID;
    if (C.APPS_SCRIPT_URL && sheetId === C.SHEET_ID) {
      const r = await fetch(C.APPS_SCRIPT_URL + (C.APPS_SCRIPT_URL.includes("?") ? "&" : "?") + "sheet=" + encodeURIComponent(n));
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      return j.values;
    }
    // Tanpa headers=0: bila dipaksa 0, gviz menganggap baris header sebagai data, menebak tipe kolom (date/number),
    // lalu MEMBUANG teks header di kolom itu ("TGL","TOTAL","AKTUAL IW" -> null). Deteksi otomatis menaruhnya di cols[].label.
    // opt.headers=N memaksa N baris pertama jadi label — dipakai bila deteksi otomatis gagal (mis. tab OKTOBER 2025).
    const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json${opt.headers ? "&headers=" + opt.headers : ""}${n ? "&sheet=" + encodeURIComponent(n) : ""}`;
    const r = await fetch(url);
    const txt = await r.text();
    const j = JSON.parse(txt.substring(txt.indexOf("{"), txt.lastIndexOf("}") + 1));
    if (j.status === "error") throw new Error((j.errors || []).map(e => e.detailed_message || e.message).join("; "));
    const cols = j.table.cols || [];
    const rows = (j.table.rows || []).map(r => (r.c || []).map(c => (c ? (c.v ?? null) : null)));
    // baris header hasil deteksi otomatis gviz ada di cols[].label → kembalikan sebagai baris pertama data
    if (cols.some(c => c.label && !/^[A-Z]{1,3}$/.test(c.label))) rows.unshift(cols.map(c => c.label || null));
    return rows;
  }
  // Nama sheet dicoba dengan/tanpa spasi di akhir (di spreadsheet ada tab "JUNI "). PENTING: bila nama tidak persis,
  // gviz TIDAK error melainkan diam-diam mengembalikan tab PERTAMA (paling kiri). Karena itu tiap varian harus
  // divalidasi lewat accept(rows) — mis. parseMonth harus menghasilkan hari di bulan yang benar — bukan cuma status OK.
  async function fetchSheet(name, accept, opt = {}) {
    let lastErr = null;
    for (const n of (name ? [...new Set([name, name + " ", name.trim()])] : [""])) {
      try {
        let rows = await fetchSheetExact(n, opt); let out = accept ? accept(rows) : rows; if (out) return out;
        // Ada baris bertanggal tapi header "TGL" hilang → deteksi header otomatis gviz gagal; paksa headers=1..3.
        if (rows.some(r => parseDate(r[0])) && !rows.some(r => isTok(r[0], "TGL"))) {
          for (const hdr of [1, 2, 3]) { rows = await fetchSheetExact(n, { ...opt, headers: hdr }); out = accept ? accept(rows) : rows; if (out) return out; }
        }
      } catch (e) { lastErr = e; }
    }
    if (lastErr) throw lastErr;
    return null;
  }
  function findStore(h) {
    const H = norm(h); if (!H) return null;
    return C.STORES.find(s => s.aliases.map(norm).includes(H))
      || C.STORES.find(s => s.aliases.some(a => H.endsWith(" " + norm(a)))) || null;
  }

  // Header blok kunjungan: "<NAMA TOKO> DATANG" → toko; cocokkan alias tanpa memedulikan spasi ("UJUNGBATU" = "UJUNG BATU")
  const squash = (v) => norm(v).replace(/[^A-Z0-9]/g, "");
  function findStoreVisit(h) {
    const H = norm(h); if (!/\bDATANG$/.test(H)) return null;
    const name = squash(H.replace(/\s*DATANG$/, "")); if (!name) return null;
    return C.STORES.find(s => s.aliases.some(a => squash(a) === name)) || null;
  }

  // Parse satu sheet bulanan → {idx, days:[{d, total, act:{key:val}, tgt:{key:val}}]}
  function parseMonth(rows, idx) {
    let hr = rows.findIndex(r => isTok(r[0], "TGL"));
    if (hr < 0) return null;
    const header = rows[hr];
    const map = {}; // key -> {act:col, tgt:col}
    header.forEach((h, c) => {
      const s = findStore(h); if (!s || map[s.key]) return;
      let tgt = null;
      for (let k = c + 1; k <= c + 3 && k < header.length; k++) { if (norm(header[k]) === "TARGET") { tgt = k; break; } if (findStore(header[k])) break; }
      map[s.key] = { act: c, tgt };
    });
    const totalCol = header.findIndex(h => isTok(h, "TOTAL"));
    // blok kunjungan: grup kolom per toko mulai dari "<TOKO> DATANG", diikuti BELANJA, GAGAL, (RO, BARU) sesuai header
    const VC = C.VISIT_COLS || ["DATANG", "BELANJA", "GAGAL", "RO", "BARU"], vmap = {};
    header.forEach((h, c) => { const s = findStoreVisit(h); if (!s || vmap[s.key]) return; const cols = { DATANG: c }; for (let k = 1; k < VC.length && c + k < header.length; k++) { const hk = norm(header[c + k]); if (hk === VC[k]) cols[VC[k]] = c + k; else if (hk) break; } vmap[s.key] = cols; });
    const DAYS = ["MINGGU", "SENIN", "SELASA", "RABU", "KAMIS", "JUMAT", "SABTU"];
    const dayName = (v) => norm(v).replace(/[^A-Z]/g, ""); // "JUM'AT" → "JUMAT"
    const days = []; let prev = null;
    for (let r = hr + 1; r < rows.length; r++) {
      const row = rows[r]; if (!row) break;
      if (norm(row[1]) === "TOTAL" || norm(row[0]) === "TOTAL") break;
      let d = parseDate(row[0]);
      // Sel tanggal bisa hilang (gviz membuang teks yang tak bertipe date, mis. "30,03,2026" di kolom date).
      // Baris harian berurutan → tebak = hari sebelumnya + 1, diterima HANYA bila kolom HARI cocok dengan tebakan.
      if (!d && prev) { const g = new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() + 1); if (dayName(row[1]) === DAYS[g.getDay()]) d = g; }
      if (!d) { if (days.length) break; else continue; }
      prev = d;
      if (d.getMonth() !== idx) continue;
      const act = {}, tgt = {};
      for (const k in map) { act[k] = num(row[map[k].act]); tgt[k] = map[k].tgt != null ? num(row[map[k].tgt]) : null; }
      const visit = {}; for (const k in vmap) { const o = {}; let any = false; for (const c of VC) { const col = vmap[k][c]; const v = col == null ? null : num(row[col]); o[c] = v; if (v != null) any = true; } if (any) visit[k] = o; }
      days.push({ d: d.getDate(), total: totalCol >= 0 ? num(row[totalCol]) : null, act, tgt, visit });
    }
    return { idx, storesFound: Object.keys(map), visitStores: Object.keys(vmap), days };
  }

  // Baseline 2025 per toko: header TOKO | JANUARI ... DESEMBER
  function parseBaseline(rows) {
    const hr = rows.findIndex(r => r.some(v => norm(v) === "TOKO")); if (hr < 0) return null;
    const header = rows[hr].map(norm);
    const tokoCol = header.indexOf("TOKO");
    const mcols = MONTH_NAMES.map(m => header.findIndex(h => h === norm(m) || h === norm(m).slice(0, 3)));
    const out = {};
    for (let r = hr + 1; r < rows.length; r++) {
      const s = findStore(rows[r][tokoCol]); if (!s) continue;
      out[s.key] = mcols.map(c => (c >= 0 ? num(rows[r][c]) : null));
    }
    return Object.keys(out).length ? out : null;
  }

  // REKAP: baris "BULAN | 2026 | 2025" + 12 bulan → {y2026:[], y2025:[]}
  function parseRekap(rows) {
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r] || [];
      const cCur = row.findIndex(v => num(v) === Y()), cBase = row.findIndex(v => num(v) === BY());
      if (cCur < 0 || cBase < 0) continue;
      const cur = Array(12).fill(null), base = Array(12).fill(null);
      for (let k = 1; k <= 14 && r + k < rows.length; k++) {
        const rr = rows[r + k] || []; const mi = MONTH_NAMES.findIndex(m => rr.some(v => norm(v) === norm(m)));
        if (mi < 0) continue; cur[mi] = num(rr[cCur]); base[mi] = num(rr[cBase]);
      }
      if (base.some(v => v)) return { cur, base };
    }
    return null;
  }

  async function loadAll() {
    setStatus("Memuat data dari Google Sheet…");
    ["btnRefresh", "btnRefresh2", "btnRefresh3", "btnRefreshEx"].forEach(id => { const b = $(id); if (b) b.disabled = true; });
    const now = new Date();
    const sheets = (C.SHEETS && C.SHEETS.length) ? C.SHEETS : [{ year: C.YEAR, id: C.SHEET_ID }];
    const years = {}, jobs = [];
    const acc = (i) => rows => { const m = parseMonth(rows, i); return m && m.days.length ? m : null; };
    for (const sh of sheets) {
      // tahun berjalan: sampai bulan ini; tahun lampau: 12 bulan; tahun depan: tidak ada
      const lastIdx = sh.year === now.getFullYear() ? now.getMonth() : sh.year < now.getFullYear() ? 11 : -1;
      years[sh.year] = [];
      MONTH_NAMES.slice(0, lastIdx + 1).forEach((name, i) => jobs.push((async () => {
        try { const m = await fetchSheet(name, acc(i), { sheetId: sh.id }); if (m) years[sh.year][i] = m; }
        catch (e) { console.warn("Sheet", sh.year, name, e.message); }
      })()));
    }
    // fallback khusus tahun berjalan: sheet BASELINE (total bulanan per toko) & REKAP (level perusahaan) di spreadsheet utama
    jobs.push((async () => { try { state.baseline = await fetchSheet(C.BASELINE_SHEET, parseBaseline); } catch (e) { state.baseline = null; } })());
    jobs.push((async () => { try { state.rekap = await fetchSheet(C.REKAP_SHEET, parseRekap); } catch (e) { state.rekap = null; } })());
    if (C.SALES && C.SALES.SHEET_ID) jobs.push((async () => { try { state.salesErr = null; state.sales = await fetchSheet(C.SALES.SHEET_NAME || "", parseSales, { sheetId: C.SALES.SHEET_ID }); if (!state.sales) state.salesErr = "tab tidak berisi tabel sales"; } catch (e) { console.warn("Sheet sales", e.message); state.sales = null; state.salesErr = e.message; } })());
    await Promise.all(jobs);
    state.years = years;
    state.yearList = Object.keys(years).map(Number).filter(y => years[y].some(Boolean)).sort((a, b) => b - a);
    state.fetchedAt = new Date();
    ["btnRefresh", "btnRefresh2", "btnRefresh3", "btnRefreshEx"].forEach(id => { const b = $(id); if (b) b.disabled = false; });
    if (!state.yearList.length) {
      setStatus("Gagal membaca sheet. Pastikan spreadsheet dibagikan \"Siapa saja yang memiliki link — Viewer\", atau isi APPS_SCRIPT_URL di config.js (lihat README).", true);
      return;
    }
    selectYear(state.yearList.includes(state.year) ? state.year : state.yearList[0]);
    try { const st = new URLSearchParams(location.search).get("store"); if (st && C.STORES.some(s => s.key === st.toUpperCase())) state.execKey = st.toUpperCase(); } catch (e) { }
    // rentang dari URL (?from=YYYY-MM-DD&to=YYYY-MM-DD) → tautan yang bisa dibagikan
    try { const q = new URLSearchParams(location.search); if (q.get("from") && q.get("to")) { const a = new Date(q.get("from") + "T00:00:00"), b = new Date(q.get("to") + "T00:00:00"); if (!isNaN(a) && !isNaN(b)) { if (state.yearList.includes(a.getFullYear())) selectYear(a.getFullYear()); state.range = { a: a > b ? b : a, b: a > b ? a : b }; $("rangeFrom").value = iso(state.range.a); $("rangeTo").value = iso(state.range.b); $("rangePill").classList.add("on"); } } } catch (e) { }
    // Tanpa pembanding tahun sebelumnya, SSSG YoY semuanya n/a → buka di Growth MoM sampai pengguna memilih sendiri.
    if (!state.hasBase && !state.modeChosen && state.mode === "yoy") { state.mode = "mom"; document.querySelectorAll("#seg button").forEach(b => b.classList.toggle("on", b.dataset.mode === "mom")); }
    buildYearSelect(); buildMonthSelect(); render();
  }
  function selectYear(y) {
    state.year = y; state.months = state.years[y] || []; state.baseMonths = state.years[y - 1] || [];
    state.hasBase = state.baseMonths.some(Boolean) || (y === C.YEAR && !!state.baseline);
    state.month = null;
  }

  // ---------- perhitungan ----------
  const monthStats = (mi, upToDay) => monthStatsOf(state.months[mi], upToDay);
  function monthStatsOf(m, upToDay) {
    if (!m) return null;
    const days = upToDay ? m.days.filter(d => d.d <= upToDay) : m.days;
    const out = { days: days.length, act: {}, tgt: {}, firstSale: {}, total: 0 };
    for (const s of C.STORES) {
      let a = 0, t = 0, fs = null, has = false;
      for (const d of days) { const v = d.act[s.key]; if (v != null) { has = true; a += v; if (v > 0 && fs == null) fs = d.d; } const tv = d.tgt[s.key]; if (tv != null) t += tv; }
      out.act[s.key] = has ? a : null; out.tgt[s.key] = t || null; out.firstSale[s.key] = fs;
      if (has) out.total += a;
    }
    return out;
  }
  const lastDataDay = (mi) => { const m = state.months[mi]; if (!m) return 0; let last = 0; for (const d of m.days) if ((d.total || 0) > 0 || Object.values(d.act).some(v => v > 0)) last = Math.max(last, d.d); return last; };
  const latestIdx = () => { let x = -1; state.months.forEach((m, i) => { if (m) x = i; }); return x; };
  const isPartial = (mi) => mi === latestIdx() && lastDataDay(mi) < daysIn(Y(), mi);
  // aktif = ada omset dan sudah berjualan sejak paling lambat hari ke-MIN_ACTIVE_DAYS (toko buka pertengahan bulan tidak dibandingkan)
  const isActive = (st, key) => st && st.act[key] != null && st.act[key] > 0 && st.firstSale[key] != null && st.firstSale[key] <= Math.min(C.MIN_ACTIVE_DAYS, st.days);

  // Growth per toko untuk bulan mi (like-for-like bila bulan berjalan)
  function computeMonth(mi, mode) {
    const partial = isPartial(mi), N = partial ? lastDataDay(mi) : null;
    const cur = monthStats(mi, N); if (!cur) return null;
    const res = { mi, mode, partial, N, rows: [], cmpTotalAct: 0, cmpTotalBase: 0, allAct: 0, allBase: 0, tgtTotal: 0, tgtAct: 0 };
    let prev = null, bst = null;
    const bl = state.year === C.YEAR ? state.baseline : null, rk = state.year === C.YEAR ? state.rekap : null; // fallback hanya utk tahun berjalan
    if (mode === "mom") prev = mi > 0 ? monthStats(mi - 1, N) : null;
    else bst = monthStatsOf(state.baseMonths[mi], N); // null bila bulan tahun pembanding tidak ada
    res.baseDaily = !!bst;
    for (const s of C.STORES) {
      const a = cur.act[s.key];
      const row = { key: s.key, label: s.label, actual: a, target: cur.tgt[s.key], base: null, growth: null, comparable: false, note: "", excluded: !!s.excludeFromSSSG };
      if (row.target && a != null) { row.ach = a / row.target; if (!s.excludeFromSSSG) { res.tgtTotal += row.target; res.tgtAct += a; } }
      if (a != null && !s.excludeFromSSSG) res.allAct += a;
      if (!s.excludeFromSSSG) {
        if (mode === "mom") {
          const p = prev ? prev.act[s.key] : null;
          if (p != null) row.base = p;
          if (isActive(cur, s.key) && prev && isActive(prev, s.key)) { row.comparable = true; row.growth = a / p - 1; }
          else row.note = !prev ? "tidak ada bulan lalu" : !isActive(prev, s.key) ? "belum aktif bulan lalu" : "belum aktif";
        } else if (bst) {
          // baseline harian 2025 (like-for-like tgl 1–N bila bulan berjalan)
          const p = bst.act[s.key];
          if (p != null) { row.base = p; res.allBase += p; }
          if (p != null && p > 0 && isActive(cur, s.key) && isActive(bst, s.key)) { row.comparable = true; row.growth = a / p - 1; }
          else row.note = p == null || p === 0 ? `tidak ada di ${BY()}` : "belum aktif";
        } else {
          const full = bl && bl[s.key] ? bl[s.key][mi] : null;
          if (full != null) {
            row.base = partial ? full * N / daysIn(BY(), mi) : full;
            if (full > 0 && isActive(cur, s.key)) { row.comparable = true; row.growth = a / row.base - 1; }
            else row.note = full > 0 ? "belum aktif" : "tidak ada di 2025";
            if (full != null) res.allBase += row.base;
          } else row.note = bl ? `tidak ada di ${BY()}` : `data ${BY()} belum ada`;
        }
      } else row.note = "di luar SSSG";
      if (row.comparable) { res.cmpTotalAct += a; res.cmpTotalBase += row.base; }
      res.rows.push(row);
    }
    res.sssg = res.cmpTotalBase > 0 ? res.cmpTotalAct / res.cmpTotalBase - 1 : null;
    res.nComparable = res.rows.filter(r => r.comparable).length;
    // total perusahaan (termasuk toko baru)
    if (mode === "mom") { const pt = prev ? C.STORES.filter(s => !s.excludeFromSSSG).reduce((x, s) => x + (prev.act[s.key] || 0), 0) : 0; res.totalGrowth = pt > 0 ? res.allAct / pt - 1 : null; res.totalBase = pt || null; }
    else {
      let base2025 = null;
      if (bst) { base2025 = C.STORES.filter(s => !s.excludeFromSSSG).reduce((x, s) => x + (bst.act[s.key] || 0), 0) || null; }
      else if (bl) { base2025 = res.allBase || null; }
      else if (rk && rk.base[mi]) base2025 = partial ? rk.base[mi] * N / daysIn(BY(), mi) : rk.base[mi];
      res.totalBase = base2025;
      res.totalGrowth = base2025 ? res.allAct / base2025 - 1 : null;
      res.totalFromRekap = !bst && !bl && !!rk;
    }
    res.ach = res.tgtTotal ? res.tgtAct / res.tgtTotal : null;
    return res;
  }

  // ---------- kunjungan (absen kunjungan per hari) ----------
  // agregat per toko: datang, belanja, gagal, ro, baru, omset (utk basket size), jumlah hari dgn data
  function visitStatsOf(m, upToDay) {
    if (!m) return null;
    const days = upToDay ? m.days.filter(d => d.d <= upToDay) : m.days;
    const out = { days: days.length, st: {} };
    for (const s of C.STORES) {
      const o = { datang: 0, belanja: 0, gagal: 0, ro: 0, baru: 0, omset: 0, nDays: 0, hasRO: false };
      for (const d of days) { const v = d.visit && d.visit[s.key]; if (!v) continue; o.nDays++; o.datang += v.DATANG || 0; o.belanja += v.BELANJA || 0; o.gagal += v.GAGAL || 0; if (v.RO != null || v.BARU != null) { o.hasRO = true; o.ro += v.RO || 0; o.baru += v.BARU || 0; } o.omset += d.act[s.key] || 0; }
      if (o.nDays) out.st[s.key] = o;
    }
    return out;
  }
  const vRow = (o) => o ? { ...o, konversi: o.datang > 0 ? o.belanja / o.datang : null, gagalPct: o.datang > 0 ? o.gagal / o.datang : null, basket: o.belanja > 0 ? o.omset / o.belanja : null, perHari: o.nDays ? o.datang / o.nDays : null, roPct: o.hasRO && o.belanja > 0 ? o.ro / o.belanja : null, baruPct: o.hasRO && o.belanja > 0 ? o.baru / o.belanja : null } : null;
  const pctChg = (a, b) => a != null && b != null && b > 0 ? a / b - 1 : null;
  // kunjungan bulan mi: sekarang vs pembanding (YoY: bulan sama tahun lalu; MoM: bulan lalu), like-for-like bila bulan berjalan
  function computeVisits(mi, mode) {
    const m = state.months[mi]; if (!m) return null;
    const partial = isPartial(mi), N = partial ? lastDataDay(mi) : null;
    const cur = visitStatsOf(m, N); const cmpM = mode === "mom" ? (mi > 0 ? state.months[mi - 1] : null) : state.baseMonths[mi];
    const cmp = visitStatsOf(cmpM, N);
    return visitResult(cur, cmp, mi, mode, partial, N);
  }
  // bulan semu dari rentang tanggal: kumpulan hari (dengan .date) yang punya blok kunjungan — bisa lintas bulan/tahun
  function rangeVisitMonth(a, b) {
    const days = []; for (let d = new Date(a); d <= b; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) { const ys = state.years[d.getFullYear()]; const m = ys && ys[d.getMonth()]; const day = m && m.days.find(x => x.d === d.getDate()); if (day && day.visit && Object.keys(day.visit).length) days.push({ ...day, date: new Date(d) }); }
    return { days };
  }
  function computeVisitsRange(a, b, mode) {
    const pm = rangeVisitMonth(a, b); if (!pm.days.length) return null;
    const len = Math.round((b - a) / 864e5) + 1; const ad = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
    const [ca, cb] = mode === "mom" ? [ad(a, -len), ad(a, -1)] : [new Date(a.getFullYear() - 1, a.getMonth(), a.getDate()), new Date(b.getFullYear() - 1, b.getMonth(), b.getDate())];
    const cpm = rangeVisitMonth(ca, cb); const cur = visitStatsOf(pm), cmp = cpm.days.length ? visitStatsOf(cpm) : null;
    const res = visitResult(cur, cmp, "range", mode, false, null); if (res) { res.range = { a, b, ca, cb }; res.pseudo = pm; res.cpseudo = cpm; } return res;
  }
  function visitResult(cur, cmp, mi, mode, partial, N) {
    if (!cur) return null;
    const res = { mi, mode, partial, N, hasCmp: !!cmp, rows: [], tot: { datang: 0, belanja: 0, gagal: 0, ro: 0, baru: 0, omset: 0, nDays: 0, hasRO: false }, totCmp: cmp ? { datang: 0, belanja: 0, gagal: 0, omset: 0 } : null };
    for (const s of C.STORES) {
      const a = vRow(cur.st[s.key]), b = cmp ? vRow(cmp.st[s.key]) : null; if (!a && !b) continue;
      const row = { key: s.key, label: s.label, cur: a, cmp: b, excluded: !!s.excludeFromSSSG, g: {} };
      if (a && b) { row.g.datang = pctChg(a.datang, b.datang); row.g.belanja = pctChg(a.belanja, b.belanja); row.g.konversi = a.konversi != null && b.konversi != null ? a.konversi - b.konversi : null; row.g.basket = pctChg(a.basket, b.basket); }
      if (a) { for (const k of ["datang", "belanja", "gagal", "ro", "baru", "omset"]) res.tot[k] += a[k]; res.tot.nDays = Math.max(res.tot.nDays, a.nDays); if (a.hasRO) res.tot.hasRO = true; }
      if (b) { for (const k of ["datang", "belanja", "gagal", "omset"]) res.totCmp[k] += b[k]; }
      res.rows.push(row);
    }
    res.total = vRow(res.tot); res.totalCmp = res.totCmp && res.totCmp.datang > 0 ? vRow({ ...res.totCmp, ro: 0, baru: 0, nDays: cmp.days, hasRO: false }) : null;
    if (res.total && res.totalCmp) { res.g = { datang: pctChg(res.total.datang, res.totalCmp.datang), belanja: pctChg(res.total.belanja, res.totalCmp.belanja), konversi: res.total.konversi - res.totalCmp.konversi, basket: pctChg(res.total.basket, res.totalCmp.basket) }; } else res.g = {};
    return res.rows.length ? res : null;
  }
  // kunjungan YTD (YoY): jumlahkan semua bulan yang tersedia, pembanding = bulan-bulan yang sama tahun lalu
  function computeVisitsYTD() {
    const idxs = state.months.map((m, i) => m ? i : -1).filter(i => i >= 0);
    const per = idxs.map(i => computeVisits(i, "yoy")).filter(Boolean); if (!per.length) return null;
    const acc = () => ({ datang: 0, belanja: 0, gagal: 0, ro: 0, baru: 0, omset: 0, nDays: 0, hasRO: false });
    const add = (t, a) => { for (const k of ["datang", "belanja", "gagal", "ro", "baru", "omset", "nDays"]) t[k] += a[k] || 0; if (a.hasRO) t.hasRO = true; };
    const byStore = {}, byStoreCmp = {}, tot = acc(), totCmp = acc(); let anyCmp = false;
    for (const r of per) for (const row of r.rows) { if (row.cur) { add(byStore[row.key] = byStore[row.key] || acc(), row.cur); add(tot, row.cur); } if (row.cmp && row.cur) { add(byStoreCmp[row.key] = byStoreCmp[row.key] || acc(), row.cmp); add(totCmp, row.cmp); anyCmp = true; } }
    const res = { mi: "ytd", ytd: true, mode: "yoy", months: idxs, partial: per.some(r => r.partial), hasCmp: anyCmp, rows: [] };
    for (const s of C.STORES) { const a = vRow(byStore[s.key]), b = vRow(byStoreCmp[s.key]); if (!a && !b) continue; const row = { key: s.key, label: s.label, cur: a, cmp: b, excluded: !!s.excludeFromSSSG, g: {} }; if (a && b) { row.g.datang = pctChg(a.datang, b.datang); row.g.belanja = pctChg(a.belanja, b.belanja); row.g.konversi = a.konversi != null && b.konversi != null ? a.konversi - b.konversi : null; row.g.basket = pctChg(a.basket, b.basket); } res.rows.push(row); }
    res.total = vRow(tot); res.totalCmp = anyCmp ? vRow(totCmp) : null;
    res.g = res.total && res.totalCmp ? { datang: pctChg(res.total.datang, res.totalCmp.datang), belanja: pctChg(res.total.belanja, res.totalCmp.belanja), konversi: res.total.konversi - res.totalCmp.konversi, basket: pctChg(res.total.basket, res.totalCmp.basket) } : {};
    return res;
  }

  // Year-to-date (hanya YoY): agregat bulan-bulan yang tersedia. Growth per toko = Σ omset bulan comparable ÷ Σ pembanding
  // bulan comparable − 1 (sama dengan kolom YTD di matriks); omset & target = Σ seluruh bulan.
  function computeYTD(mode) {
    const idxs = state.months.map((m, i) => m ? i : -1).filter(i => i >= 0); if (!idxs.length) return null;
    const per = idxs.map(i => computeMonth(i, mode)).filter(Boolean);
    const res = { mi: "ytd", ytd: true, mode, months: idxs, partial: per.some(r => r.partial), N: null, rows: [], cmpTotalAct: 0, cmpTotalBase: 0, allAct: 0, allBase: 0, tgtTotal: 0, tgtAct: 0, baseDaily: per.some(r => r.baseDaily) };
    for (const s of C.STORES) {
      const row = { key: s.key, label: s.label, actual: null, target: null, base: null, growth: null, comparable: false, note: "", excluded: !!s.excludeFromSSSG };
      let ca = 0, cb = 0, sb = 0, hasBase = false, lastNote = "";
      for (const r of per) {
        const x = r.rows.find(q => q.key === s.key); if (!x) continue;
        if (x.actual != null) row.actual = (row.actual || 0) + x.actual;
        if (x.target) row.target = (row.target || 0) + x.target;
        if (x.base != null) { sb += x.base; hasBase = true; }
        if (x.comparable) { ca += x.actual; cb += x.base; } else if (x.note) lastNote = x.note;
      }
      if (row.target && row.actual != null) { row.ach = row.actual / row.target; if (!s.excludeFromSSSG) { res.tgtTotal += row.target; res.tgtAct += row.actual; } }
      if (row.actual != null && !s.excludeFromSSSG) res.allAct += row.actual;
      if (s.excludeFromSSSG) row.note = "di luar SSSG";
      else if (cb > 0) { row.comparable = true; row.base = cb; row.growth = ca / cb - 1; res.cmpTotalAct += ca; res.cmpTotalBase += cb; }
      else { if (hasBase) row.base = sb; row.note = lastNote || (hasBase ? "belum aktif" : `tidak ada di ${BY()}`); }
      res.rows.push(row);
    }
    res.sssg = res.cmpTotalBase > 0 ? res.cmpTotalAct / res.cmpTotalBase - 1 : null;
    res.nComparable = res.rows.filter(r => r.comparable).length;
    let ta = 0, tb = 0; per.forEach(r => { if (r.totalGrowth != null) { ta += r.allAct; tb += r.totalBase; } });
    res.totalBase = tb || null; res.totalGrowth = tb > 0 ? ta / tb - 1 : null; res.totalFromRekap = per.some(r => r.totalFromRekap);
    res.ach = res.tgtTotal ? res.tgtAct / res.tgtTotal : null;
    return res;
  }

  // ---------- engine: eksekutif, peringkat, pola hari, outlet baru, peringatan, insight ----------
  const DOW = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
  const activeStores = () => C.STORES.filter(s => !s.excludeFromSSSG);
  const dayTotal = (d) => activeStores().reduce((x, s) => x + (d.act[s.key] || 0), 0); // omset hari (toko aktif, tanpa Gudang)
  // seri harian satu bulan: [{d, dow, v}] sampai upTo (like-for-like)
  function dailySeries(y, m, upTo, key) { if (!m) return []; return m.days.filter(d => !upTo || d.d <= upTo).map(d => ({ d: d.d, dow: new Date(y, m.idx, d.d).getDay(), v: key ? (d.act[key] || 0) : dayTotal(d), store: d.act })); }
  // hari-hari periode terpilih (bulan atau YTD) untuk tahun y & indeks bulan
  function periodDays(y, months, idxs, partialN, key) {
    const out = []; idxs.forEach((mi, k) => { const last = k === idxs.length - 1 ? partialN : null; dailySeries(y, months[mi], last, key).forEach(o => out.push({ ...o, mi })); }); return out;
  }
  const bestWorst = (days) => { const v = days.filter(o => o.v > 0); if (!v.length) return { best: null, worst: null }; let b = v[0], w = v[0]; for (const o of v) { if (o.v > b.v) b = o; if (o.v < w.v) w = o; } return { best: b, worst: w }; };
  // pola hari: rata-rata omset per hari-dalam-minggu (0=Minggu)
  function dayPattern(days, key) { const sum = Array(7).fill(0), n = Array(7).fill(0); for (const o of days) { const v = key ? (o.store[key] || 0) : o.v; if (v > 0) { sum[o.dow] += v; n[o.dow]++; } } const avg = sum.map((s, i) => n[i] ? s / n[i] : null); const tot = avg.reduce((a, b) => a + (b || 0), 0); return { avg, n, share: avg.map(a => a == null || !tot ? null : a / tot) }; }
  const monthTotal = (m, upTo) => m ? dailySeries(0, m, upTo).reduce((x, o) => x + o.v, 0) : null; // y tidak dipakai utk total
  const yearMonthTotals = (y) => Array.from({ length: 12 }, (_, i) => state.years[y] && state.years[y][i] ? monthTotal(state.years[y][i]) : null);
  // bulan pertama toko beromset (di semua tahun yang dimuat): {y, mi} atau null
  function firstMonthOf(key) { const ys = Object.keys(state.years).map(Number).sort((a, b) => a - b); for (const y of ys) for (let i = 0; i < 12; i++) { const m = state.years[y][i]; if (m && m.days.some(d => (d.act[key] || 0) > 0)) return { y, mi: i }; } return null; }
  const monthsBetween = (a, b) => (b.y - a.y) * 12 + (b.mi - a.mi);
  // periode terpilih (bulan / YTD) → {y, idxs, partial, N, days, total, avg, best, worst}
  function periodInfo(y, months, mi, key) {
    const ytd = mi === "ytd"; const idxs = ytd ? months.map((m, i) => m ? i : -1).filter(i => i >= 0) : [mi]; if (!idxs.length || !months[idxs[idxs.length - 1]]) return null;
    const last = idxs[idxs.length - 1]; const partial = y === state.year ? isPartialOf(months, last) : false; const N = partial ? lastDataDayOf(months[last]) : null;
    const days = periodDays(y, months, idxs, N, key); const withData = days.filter(o => o.v > 0); const total = days.reduce((x, o) => x + o.v, 0);
    return { y, ytd, idxs, last, partial, N, days, total, nDays: withData.length, avg: withData.length ? total / withData.length : null, ...bestWorst(days) };
  }
  const lastDataDayOf = (m) => { let last = 0; for (const d of m.days) if ((d.total || 0) > 0 || Object.values(d.act).some(v => v > 0)) last = Math.max(last, d.d); return last; };
  const isPartialOf = (months, mi) => { let x = -1; months.forEach((m, i) => { if (m) x = i; }); return mi === x && lastDataDayOf(months[mi]) < daysIn(state.year, mi); };

  // ringkasan eksekutif untuk periode terpilih
  function computeExec(mi, key) {
    const cur = periodInfo(Y(), state.months, mi, key); if (!cur) return null;
    const ytd = mi === "ytd"; const R = ytd ? computeYTD("yoy") : computeMonth(mi, "yoy"); const M = ytd ? computeMonth(cur.last, "mom") : computeMonth(mi, "mom");
    const rowR = key && R ? R.rows.find(r => r.key === key) : null, rowM = key && M ? M.rows.find(r => r.key === key) : null;
    // pembanding tahun lalu, periode sama (like-for-like)
    const prevY = state.baseMonths; const base = prevY.some(Boolean) ? (() => { const idxs = cur.idxs.filter(i => prevY[i]); if (!idxs.length) return null; const days = periodDays(BY(), prevY, idxs, cur.partial ? cur.N : null, key); const wd = days.filter(o => o.v > 0); if (!wd.length) return null; const total = days.reduce((x, o) => x + o.v, 0); return { total, nDays: wd.length, avg: wd.length ? total / wd.length : null, ...bestWorst(days) }; })() : null;
    // pembanding bulan lalu (untuk bulan tunggal), like-for-like
    const pm = !ytd && mi > 0 && state.months[mi - 1] ? (() => { const days = dailySeries(Y(), state.months[mi - 1], cur.partial ? cur.N : null, key); const wd = days.filter(o => o.v > 0); if (!wd.length) return null; const total = days.reduce((x, o) => x + o.v, 0); return { total, nDays: wd.length, avg: wd.length ? total / wd.length : null }; })() : null;
    const yoy = key ? (rowR ? rowR.growth : null) : (R ? R.totalGrowth : null), mom = key ? (rowM ? rowM.growth : null) : (M ? M.totalGrowth : null);
    const tgtTotal = key ? (rowR && rowR.target) || 0 : (R ? R.tgtTotal : 0), tgtAct = key ? (rowR && rowR.actual) || 0 : (R ? R.tgtAct : 0);
    return { cur, base, pm, yoy, sssg: key ? null : (R ? R.sssg : null), mom, momLabel: ytd ? MONTH_SHORT[cur.last] : MONTH_SHORT[mi], ach: tgtTotal ? tgtAct / tgtTotal : null, tgtTotal, tgtAct, avgYoy: base && base.avg ? cur.avg / base.avg - 1 : null, avgMom: pm && pm.avg ? cur.avg / pm.avg - 1 : null, pattern: dayPattern(cur.days), R, M, key };
  }
  // peringkat outlet: omset, kontribusi, YoY, MoM, target
  function computeRanking(mi) {
    const ytd = mi === "ytd"; const R = ytd ? computeYTD("yoy") : computeMonth(mi, "yoy"), M = ytd ? computeYTD("mom") : computeMonth(mi, "mom"); if (!R) return null;
    const rows = R.rows.filter(r => !r.excluded && r.actual != null).map(r => { const m = M && M.rows.find(x => x.key === r.key); return { key: r.key, label: r.label, actual: r.actual, base: r.base, yoy: r.growth, yoyNote: r.note, mom: m ? m.growth : null, momNote: m ? m.note : "", target: r.target, ach: r.ach, diff: r.actual != null && r.base != null ? r.actual - r.base : null }; }).sort((a, b) => b.actual - a.actual);
    const total = rows.reduce((x, r) => x + r.actual, 0); rows.forEach((r, i) => { r.rank = i + 1; r.share = total ? r.actual / total : null; });
    return { rows, total, R, M };
  }
  // outlet baru: buka ≤ ALERTS.newOutletMonths bulan sebelum akhir periode
  function computeNewOutlets(mi) {
    const A = C.ALERTS || {}; const lim = A.newOutletMonths || 12; const ytd = mi === "ytd"; const last = ytd ? state.months.map((m, i) => m ? i : -1).filter(i => i >= 0).pop() : mi; if (last == null) return [];
    const ref = { y: Y(), mi: last }; const out = [];
    for (const s of activeStores()) {
      const f = firstMonthOf(s.key); if (!f) continue; const age = monthsBetween(f, ref); if (age < 0 || age > lim) continue;
      const cm = computeMonth(last, "mom"); const row = cm && cm.rows.find(r => r.key === s.key); if (!row || row.actual == null) continue;
      const hist = []; for (let k = 0; k <= age; k++) { const y = f.y + Math.floor((f.mi + k) / 12), m = (f.mi + k) % 12; const mo = state.years[y] && state.years[y][m]; hist.push({ y, mi: m, total: mo ? mo.days.reduce((x, d) => x + (d.act[s.key] || 0), 0) : null }); }
      const days = dailySeries(Y(), state.months[last], cm.partial ? cm.N : null); const wd = days.filter(o => (o.store[s.key] || 0) > 0);
      const V = computeVisits(last, "mom"); const vr = V && V.rows.find(r => r.key === s.key);
      const lastFull = cm.partial && age > 0 ? hist[age - 1] : hist[age]; // bulan penuh terakhir (bulan berjalan belum utuh)
      out.push({ key: s.key, label: s.label, since: f, age, hist, actual: row.actual, mom: row.growth, momNote: row.note, target: row.target, ach: row.ach, avgDay: wd.length ? wd.reduce((x, o) => x + o.store[s.key], 0) / wd.length : null, firstTotal: hist[0].total, lastFull, ramp: lastFull && lastFull.total && hist[0].total && lastFull !== hist[0] ? lastFull.total / hist[0].total - 1 : null, visit: vr && vr.cur ? vr.cur : null });
    }
    return out.sort((a, b) => b.actual - a.actual);
  }
  // peringatan otomatis
  function computeAlerts(mi) {
    const A = { declineWarn: -10, declineCrit: -25, trendMonths: 3, achWarn: 80, achCrit: 60, ...(C.ALERTS || {}) }; const out = [];
    const ytd = mi === "ytd"; const last = ytd ? state.months.map((m, i) => m ? i : -1).filter(i => i >= 0).pop() : mi; if (last == null) return out;
    const mom = computeMonth(last, "mom"), yoy = computeMonth(last, "yoy"); const mName = MONTH_SHORT[last] + " " + Y(); const lfl = mom && mom.partial ? ` (like-for-like tgl 1–${mom.N})` : "";
    const sev = (g) => g <= A.declineCrit / 100 ? "crit" : g <= A.declineWarn / 100 ? "warn" : null;
    // 1) penurunan omset — perusahaan
    if (mom && mom.totalGrowth != null && sev(mom.totalGrowth)) out.push({ type: "decline", sev: sev(mom.totalGrowth), who: "Perusahaan", title: `Omset perusahaan turun ${fmtPct(mom.totalGrowth)} vs bulan lalu`, detail: `${mName}${lfl}: ${fmtRpS(mom.allAct)} vs ${fmtRpS(mom.totalBase)}.`, action: "Cek outlet penyumbang penurunan terbesar di halaman Peringkat." });
    if (yoy && yoy.totalGrowth != null && sev(yoy.totalGrowth)) out.push({ type: "decline", sev: sev(yoy.totalGrowth), who: "Perusahaan", title: `Omset perusahaan turun ${fmtPct(yoy.totalGrowth)} vs tahun lalu`, detail: `${mName}${lfl}: ${fmtRpS(yoy.allAct)} vs ${fmtRpS(yoy.totalBase)} (${MONTH_SHORT[last]} ${BY()}).`, action: "Bandingkan SSSG per outlet — apakah penurunan merata atau terkonsentrasi." });
    // 2) penurunan per outlet (MoM & YoY)
    for (const s of activeStores()) {
      const rm = mom && mom.rows.find(r => r.key === s.key), ry = yoy && yoy.rows.find(r => r.key === s.key);
      if (rm && rm.comparable && sev(rm.growth)) out.push({ type: "decline", sev: sev(rm.growth), who: s.label, title: `${s.label}: omset turun ${fmtPct(rm.growth)} vs bulan lalu`, detail: `${mName}${lfl}: ${fmtRp(rm.actual)} vs ${fmtRp(rm.base)} (selisih ${fmtRp(rm.actual - rm.base)}).`, action: "Periksa kunjungan & konversi outlet ini di halaman Kunjungan; pastikan tidak ada masalah stok/operasional." });
      if (ry && ry.comparable && sev(ry.growth)) out.push({ type: "decline", sev: sev(ry.growth), who: s.label, title: `${s.label}: SSSG ${fmtPct(ry.growth)} vs tahun lalu`, detail: `${mName}${lfl}: ${fmtRp(ry.actual)} vs ${fmtRp(ry.base)} (${BY()}).`, action: "Bandingkan dengan tren 3 bulan terakhir: musiman atau struktural?" });
    }
    // 3) tren negatif: MoM negatif N bulan berturut (bulan penuh, di tahun terpilih)
    const full = state.months.map((m, i) => m ? i : -1).filter(i => i >= 0 && i <= last && !(i === last && isPartial(i)));
    const seq = full.slice(-A.trendMonths); if (seq.length === A.trendMonths) {
      const res = seq.map(i => computeMonth(i, "mom"));
      for (const s of activeStores()) { const gs = res.map(r => { const x = r.rows.find(q => q.key === s.key); return x && x.comparable ? x.growth : null; }); if (gs.every(g => g != null && g < 0)) out.push({ type: "trend", sev: "warn", who: s.label, title: `${s.label}: tren negatif ${A.trendMonths} bulan berturut-turut`, detail: seq.map((i, k) => `${MONTH_SHORT[i]} ${fmtPct(gs[k])}`).join(" · ") + " (MoM).", action: "Butuh intervensi terencana: promo lokal, evaluasi jam buka, atau review produk unggulan." }); }
      const cg = res.map(r => r.totalGrowth); if (cg.every(g => g != null && g < 0)) out.push({ type: "trend", sev: "crit", who: "Perusahaan", title: `Omset perusahaan turun ${A.trendMonths} bulan berturut-turut`, detail: seq.map((i, k) => `${MONTH_SHORT[i]} ${fmtPct(cg[k])}`).join(" · ") + " (MoM).", action: "Tinjau strategi di level perusahaan, bukan hanya per outlet." });
    }
    // 4) di bawah target
    const rt = ytd ? computeYTD("yoy") : yoy; if (rt) for (const r of rt.rows) { if (r.excluded || r.ach == null) continue; const sv = r.ach * 100 < A.achCrit ? "crit" : r.ach * 100 < A.achWarn ? "warn" : null; if (!sv) continue;
      let need = ""; if (!ytd && rt.partial && r.target) { const rem = daysIn(Y(), last) - rt.N, fullT = r.target / rt.N * daysIn(Y(), last); const gap = fullT - r.actual; if (rem > 0 && gap > 0) need = ` Butuh ${fmtRpS(gap / rem)}/hari selama ${rem} hari tersisa untuk mencapai perkiraan target bulan ${fmtRpS(fullT)}.`; }
      out.push({ type: "under", sev: sv, who: r.label, title: `${r.label}: pencapaian target ${(r.ach * 100).toFixed(0)}%`, detail: `${ytd ? "YTD " + Y() : mName}: ${fmtRp(r.actual)} dari target ${fmtRp(r.target)}.${need}`, action: sv === "crit" ? "Target jauh: evaluasi kewajaran target atau ada masalah operasional." : "Dorong konversi & basket size; cek pola hari lemah di Analisis Tren." }); }
    if (rt && rt.ach != null && rt.ach * 100 < A.achWarn) out.push({ type: "under", sev: rt.ach * 100 < A.achCrit ? "crit" : "warn", who: "Perusahaan", title: `Pencapaian target perusahaan ${(rt.ach * 100).toFixed(0)}%`, detail: `${fmtRpS(rt.tgtAct)} dari ${fmtRpS(rt.tgtTotal)}.`, action: "Prioritaskan outlet dengan gap Rp terbesar (bukan % terbesar)." });
    const order = { crit: 0, warn: 1, info: 2 }; return out.sort((a, b) => order[a.sev] - order[b.sev]);
  }
  // insight berbasis aturan (bukan model bahasa): membaca pola → narasi + rekomendasi
  function computeInsights(mi) {
    const out = []; const E = computeExec(mi); if (!E) return out; const K = computeRanking(mi); const ytd = mi === "ytd";
    const pName = ytd ? `YTD ${Y()}` : MONTH_SHORT[mi] + " " + Y(); const lfl = E.cur.partial ? ` (s/d tgl ${E.cur.N})` : "";
    const tone = g => g == null ? "neutral" : g >= 0.05 ? "good" : g < 0 ? "bad" : "neutral";
    // 1) headline pertumbuhan
    out.push({ cat: "Pertumbuhan", tone: tone(E.yoy ?? E.mom), title: `Omset ${pName}${lfl} ${fmtRpS(E.cur.total)}${E.yoy != null ? `, ${fmtPct(E.yoy)} vs tahun lalu` : ""}${E.mom != null ? `, ${fmtPct(E.mom)} vs bulan lalu` : ""}`, text: `Rata-rata ${fmtRpS(E.cur.avg)}/hari dari ${E.cur.nDays} hari${E.avgYoy != null ? ` (${fmtPct(E.avgYoy)} vs rata-rata harian ${BY()})` : ""}.${E.sssg != null ? ` SSSG outlet comparable ${fmtPct(E.sssg)}${E.yoy != null ? `; selisih ke total growth (${fmtPct(E.yoy - E.sssg)}) adalah kontribusi outlet baru.` : "."}` : ""}`, rec: E.ach != null ? `Pencapaian target ${(E.ach * 100).toFixed(0)}% — ${E.ach >= 1 ? "pertahankan ritme, pertimbangkan menaikkan target bulan depan." : E.ach >= .8 ? "masih terkejar; fokus pada outlet dengan gap Rp terbesar." : "gap besar; periksa apakah target realistis atau ada masalah operasional."}` : "" });
    // 2) pendorong & penahan (Δ Rp vs pembanding tahun lalu)
    if (K) { const cmp = K.rows.filter(r => r.diff != null); if (cmp.length >= 2) { const up = cmp.filter(r => r.diff > 0).sort((a, b) => b.diff - a.diff), dn = cmp.filter(r => r.diff < 0).sort((a, b) => a.diff - b.diff); const sumUp = up.reduce((x, r) => x + r.diff, 0), sumDn = dn.reduce((x, r) => x + r.diff, 0);
      out.push({ cat: "Outlet", tone: sumUp + sumDn >= 0 ? "good" : "bad", title: up.length ? `${up[0].label} pendorong terbesar (+${fmtRpS(up[0].diff)} vs ${BY()})${dn.length ? `, ${dn[0].label} penahan terbesar (${fmtRpS(dn[0].diff)})` : ""}` : `Semua outlet comparable turun vs ${BY()}`, text: `${up.length} outlet naik total +${fmtRpS(sumUp)}, ${dn.length} outlet turun total ${fmtRpS(sumDn)}.${dn.length && sumUp > 0 && Math.abs(sumDn) > sumUp * .6 ? " Penurunan menggerus sebagian besar kenaikan." : ""}`, rec: dn.length ? `Prioritaskan ${dn.slice(0, 2).map(r => r.label).join(" dan ")}: cek kunjungan, konversi, dan basket size-nya di halaman Kunjungan.` : "Replikasi praktik outlet pendorong ke outlet lain." }); } }
    // 3) konsentrasi
    if (K && K.rows.length >= 3) { const top2 = K.rows.slice(0, 2), sh = top2.reduce((x, r) => x + (r.share || 0), 0); out.push({ cat: "Kontribusi", tone: sh > .6 ? "bad" : "neutral", title: `${top2.map(r => r.label).join(" + ")} = ${(sh * 100).toFixed(0)}% omset`, text: `${K.rows[0].label} sendiri ${(K.rows[0].share * 100).toFixed(0)}%. ${K.rows.length - 2} outlet lain berbagi ${((1 - sh) * 100).toFixed(0)}%.`, rec: sh > .6 ? "Ketergantungan tinggi pada dua outlet — gangguan di salah satunya langsung terasa di total. Dorong outlet menengah." : "Distribusi cukup sehat." }); }
    // 4) pola hari
    const P = E.pattern; const idx = P.avg.map((a, i) => [a, i]).filter(x => x[0] != null); if (idx.length >= 5) { idx.sort((a, b) => b[0] - a[0]); const best = idx[0], worst = idx[idx.length - 1]; const wk = [1, 2, 3, 4, 5].map(i => P.avg[i]).filter(v => v != null), we = [0, 6].map(i => P.avg[i]).filter(v => v != null); const wkA = wk.reduce((a, b) => a + b, 0) / (wk.length || 1), weA = we.reduce((a, b) => a + b, 0) / (we.length || 1);
      out.push({ cat: "Pola hari", tone: "neutral", title: `${DOW[best[1]]} hari terkuat (${fmtRpS(best[0])}/hari), ${DOW[worst[1]]} terlemah (${fmtRpS(worst[0])})`, text: `Selisih ${((best[0] / worst[0] - 1) * 100).toFixed(0)}%. Akhir pekan rata-rata ${fmtRpS(weA)} vs hari kerja ${fmtRpS(wkA)} (${fmtPct(weA / wkA - 1)}).${E.cur.best ? ` Hari terbaik periode: ${E.cur.best.d} ${MONTH_SHORT[E.cur.best.mi]} (${DOW[E.cur.best.dow]}) ${fmtRpS(E.cur.best.v)}.` : ""}`, rec: `Jadwalkan promo/aktivasi di ${DOW[worst[1]]}${idx.length > 1 ? ` dan ${DOW[idx[idx.length - 2][1]]}` : ""}; pastikan stok & staf penuh menjelang ${DOW[best[1]]}.` }); }
    // 5) kunjungan × basket × konversi
    const V = ytd ? computeVisitsYTD() : computeVisits(mi, "yoy"); if (V && V.total && V.g && V.g.datang != null) { const g = V.g; const drv = Math.abs(g.datang) >= Math.abs(g.basket || 0) ? "traffic" : "basket";
      out.push({ cat: "Kunjungan", tone: tone(E.yoy), title: `Kunjungan ${fmtPct(g.datang)}, basket size ${fmtPct(g.basket)}, konversi ${fmtPts(g.konversi)} vs ${BY()}`, text: `Omset ${E.yoy != null ? fmtPct(E.yoy) : "—"} lebih ditentukan oleh ${drv === "traffic" ? "jumlah pengunjung" : "nilai transaksi"}. Konversi ${fmtPct(V.total.konversi).replace("+", "")}, gagal ${fmtN(V.total.gagal)} kunjungan (${fmtPct(V.total.gagalPct).replace("+", "")}).${V.total.hasRO ? ` Repeat order ${fmtPct(V.total.roPct).replace("+", "")}, pelanggan baru ${fmtPct(V.total.baruPct).replace("+", "")}.` : ""}`, rec: g.datang < 0 && (g.basket || 0) > 0 ? "Traffic turun tapi nilai belanja naik: pertumbuhan rapuh — gencarkan akuisisi pengunjung (promo, kunjungan sales)." : g.datang > 0 && (g.konversi || 0) < 0 ? "Pengunjung bertambah tapi konversi turun: perbaiki closing di toko (stok, pelayanan, harga)." : "Jaga keseimbangan traffic dan basket; pantau outlet dengan gagal tertinggi." }); }
    // 6) outlet baru
    const NO = computeNewOutlets(mi); if (NO.length) { const r = NO[0], tot = NO.reduce((x, r) => x + r.actual, 0); const strong = NO.filter(r => r.mom != null && r.mom > .1), weak = NO.filter(r => r.ach != null && r.ach < .6);
      out.push({ cat: "Outlet baru", tone: weak.length > strong.length ? "bad" : "good", title: `${NO.length} outlet baru menyumbang ${fmtRpS(tot)}${K ? ` (${(tot / K.total * 100).toFixed(0)}% omset)` : ""}`, text: NO.map(r => `${r.label} (buka ${MONTH_SHORT[r.since.mi]} ${r.since.y}, ${r.age + 1} bln): ${fmtRpS(r.actual)}${r.mom != null ? ` MoM ${fmtPct(r.mom)}` : ""}${r.ach != null ? `, target ${(r.ach * 100).toFixed(0)}%` : ""}`).join(" · ") + ".", rec: weak.length ? `${weak.map(r => r.label).join(", ")} masih jauh dari target — cek lokasi/awareness, pertimbangkan program pembukaan lanjutan.` : "Ramp-up berjalan; tetapkan target bertahap per bulan sejak buka." }); }
    // 7) kekurangan target per hari (bulan berjalan)
    if (!ytd && E.cur.partial && E.tgtTotal && E.ach != null) { const rem = daysIn(Y(), mi) - E.cur.N, fullT = E.tgtTotal / E.cur.N * daysIn(Y(), mi), gap = fullT - E.tgtAct; if (rem > 0 && gap > 0) out.push({ cat: "Target", tone: gap / rem > (E.cur.avg || 0) * 1.3 ? "bad" : "neutral", title: `Butuh ${fmtRpS(gap / rem)}/hari selama ${rem} hari tersisa untuk mencapai target ${MONTH_SHORT[mi]}`, text: `Realisasi ${fmtRpS(E.tgtAct)} dari perkiraan target bulan penuh ${fmtRpS(fullT)} (target harian × ${daysIn(Y(), mi)} hari); rata-rata saat ini ${fmtRpS(E.cur.avg)}/hari, laju yang dibutuhkan ${fmtPct(gap / rem / (E.cur.avg || 1) - 1)} dari laju sekarang.`, rec: gap / rem > (E.cur.avg || 0) * 1.3 ? "Laju sekarang tidak cukup: butuh aksi promosi terjadwal, bukan sekadar menunggu akhir pekan." : "Masih terjangkau dengan laju normal plus akhir pekan yang kuat." }); }
    // 8) tren negatif
    const AL = computeAlerts(mi).filter(a => a.type === "trend"); if (AL.length) out.push({ cat: "Tren", tone: "bad", title: AL.map(a => a.who).join(", ") + ` dalam tren negatif ${(C.ALERTS || {}).trendMonths || 3} bulan`, text: AL.map(a => a.detail).join(" "), rec: "Ini bukan fluktuasi bulanan — rencanakan intervensi dengan tenggat dan target pemulihan." });
    return out;
  }

  // ---------- render ----------
  const BRAND = "#158F5A", BRAND_2 = "#0F6E44", GHOST = "#D9E3DD", GHOST_2 = "#C5D6CC";
  function setStatus(msg, err) { const el = $("status"); el.textContent = msg; el.className = "status" + (err ? " err" : ""); }
  const greet = () => { const h = new Date().getHours(); return h < 11 ? "Selamat pagi" : h < 15 ? "Selamat siang" : h < 18 ? "Selamat sore" : "Selamat malam"; };

  // kerangka halaman: sapaan, sidebar, menu aktif, default Chart.js
  function initChrome() {
    const o = C.OWNER || {}; const name = o.name || "", org = o.org || "Inti Warna";
    $("greet").innerHTML = `${greet()}, <span class="light">${name || org}</span> 👋`;
    const set = (id, v) => { const el = $(id); if (el) el.textContent = v; }; set("whoName", name || org); set("whoOrg", org); set("orgName", org); set("avatar", (name || org).charAt(0).toUpperCase());
    $("sheetLinks").innerHTML = ((C.SHEETS && C.SHEETS.length) ? C.SHEETS : [{ year: C.YEAR, id: C.SHEET_ID }]).map(sh => `<a href="https://docs.google.com/spreadsheets/d/${sh.id}/edit" target="_blank" rel="noopener" title="Buka Sheet ${sh.year}"><svg><use href="#i-ext"/></svg></a>`).join("");
    Chart.defaults.font.family = "'Plus Jakarta Sans', Inter, 'Segoe UI', sans-serif"; Chart.defaults.font.size = 11.5; Chart.defaults.color = "#8A94A6"; Chart.defaults.maintainAspectRatio = false;
    const tt = Chart.defaults.plugins.tooltip; tt.backgroundColor = "#14162B"; tt.padding = 10; tt.cornerRadius = 10; tt.boxPadding = 4; tt.titleFont = { weight: "700" };
  }

  function buildYearSelect() {
    const sel = $("selYear"); sel.innerHTML = "";
    state.yearList.forEach(y => { const o = document.createElement("option"); o.value = y; o.textContent = y; sel.appendChild(o); });
    sel.value = state.year; $("yearPill").classList.toggle("hidden", state.yearList.length < 2);
  }
  function buildMonthSelect() {
    const sel = $("selMonth"); sel.innerHTML = "";
    const avail = state.months.map((m, i) => m ? i : -1).filter(i => i >= 0);
    if (state.mode === "yoy" && avail.length) { const o = document.createElement("option"); o.value = "ytd"; o.textContent = `Year to date · Jan–${MONTH_SHORT[avail[avail.length - 1]]} ${Y()}`; sel.appendChild(o); }
    if (state.mode !== "yoy" && state.month === "ytd") state.month = null;
    state.months.forEach((m, i) => { if (!m) return; const o = document.createElement("option"); o.value = i; o.textContent = MONTH_NAMES[i].charAt(0) + MONTH_NAMES[i].slice(1).toLowerCase() + " " + Y() + (isPartial(i) ? " · s/d tgl " + lastDataDay(i) : ""); sel.appendChild(o); });
    if (["exec", "visit"].includes(state.view)) { const o = document.createElement("option"); o.value = "range"; o.textContent = "Rentang tanggal…"; sel.appendChild(o); }
    if (state.month !== "ytd" && (state.month == null || !state.months[state.month])) state.month = avail[avail.length - 1];
    sel.value = state.range && ["exec", "visit"].includes(state.view) ? "range" : state.month;
    $("rangePill").classList.toggle("hidden", !(state.range || sel.value === "range") || !["exec", "visit"].includes(state.view));
  }

  const pillPct = (v) => v == null ? `<span class="pill na">n/a</span>` : `<span class="pill ${cls(v)}">${fmtPct(v)}</span>`;

  function renderSssg() {
    const mi = state.month, mode = state.mode, ytd = mi === "ytd";
    const R = ytd ? computeYTD(mode) : computeMonth(mi, mode); if (!R) return;
    const lastMi = ytd ? R.months[R.months.length - 1] : mi, lastN = ytd && R.partial ? lastDataDay(lastMi) : R.N;
    const span = ytd ? `Jan–${MONTH_SHORT[lastMi]}` : MONTH_SHORT[mi];
    const mName = ytd ? `YTD ${Y()}` : MONTH_SHORT[mi] + " " + Y();
    const cmpName = mode === "mom" ? (mi > 0 ? MONTH_SHORT[mi - 1] + " " + Y() : "—") : ytd ? `YTD ${BY()}` : MONTH_SHORT[mi] + " " + BY();
    const lfl = R.partial ? (ytd ? ` · ${MONTH_SHORT[lastMi]} like-for-like tgl 1–${lastN}` : ` · like-for-like tgl 1–${R.N}`) : "";
    const label = mode === "yoy" ? "SSSG" : "Growth MoM";
    // toko yang beromset di bulan ini (di luar Gudang); toko tanpa data di kedua periode (mis. toko yang sudah tutup) disembunyikan
    const nStores = R.rows.filter(r => !r.excluded && r.actual != null).length;
    const visRows = R.rows.filter(r => r.actual != null || r.base != null);
    $("app").classList.remove("hidden");

    const banner = $("banner");
    if (mode === "yoy" && !R.baseDaily && !(state.year === C.YEAR && state.baseline)) {
      banner.classList.remove("hidden");
      banner.innerHTML = state.year !== Y() ? `<b>Data ${BY()} belum tersedia</b> — tambahkan spreadsheet omset ${BY()} ke daftar <code>SHEETS</code> di config.js agar SSSG ${Y()} vs ${BY()} bisa dihitung. Sementara itu pakai mode <b>Growth MoM</b>.` : `<b>SSSG per toko belum bisa dihitung</b> — sheet Google "${C.BASELINE_SHEET}" belum ada. Data 2025 di spreadsheet hanya level perusahaan (sheet REKAP), sehingga kartu di atas memakai angka perusahaan. Buat sheet baru bernama <code>${C.BASELINE_SHEET}</code> berisi kolom <code>TOKO | JANUARI | … | DESEMBER</code> dengan omset 2025 per toko (template ada di file BASELINE_2025_template.csv), lalu klik Refresh. Sementara itu pakai mode <b>Growth MoM</b> untuk membandingkan per toko.`;
    } else banner.classList.add("hidden");

    // ---- hero (kartu indigo): growth perusahaan; fallback ke total growth / omset bila belum bisa dihitung
    let hl, hv, hs, hb;
    if (R.sssg != null) { hl = `${label} perusahaan`; hv = fmtPct(R.sssg); hs = `${fmtRpS(R.cmpTotalAct)} vs ${fmtRpS(R.cmpTotalBase)} (${cmpName})${lfl}`; hb = `${R.nComparable} toko`; }
    else if (R.totalGrowth != null) { hl = "Total growth perusahaan (semua toko)"; hv = fmtPct(R.totalGrowth); hs = `${fmtRpS(R.allAct)} vs ${fmtRpS(R.totalBase)} (${cmpName})${R.totalFromRekap ? " · sumber REKAP" : ""}${lfl}`; hb = "REKAP"; }
    else { hl = `Omset ${mName}${R.partial ? " (MTD)" : ""}`; hv = fmtRpS(R.allAct); hs = mode === "yoy" ? "baseline 2025 belum diisi — growth belum bisa dihitung" : "tidak ada bulan pembanding"; hb = "—"; }
    $("heroLabel").textContent = hl; $("heroVal").textContent = hv; $("heroSub").textContent = hs; $("heroBadge").textContent = hb;

    // ---- tiles ringkasan
    const up = R.rows.filter(r => r.comparable && r.growth > 0).length, down = R.rows.filter(r => r.comparable && r.growth < 0).length;
    const tiles = [
      { i: "i-store", l: ytd ? `Omset ${span} ${Y()}` : `Omset ${mName}${R.partial ? " (MTD)" : ""}`, v: fmtRpS(R.allAct), p: pillPct(R.totalGrowth), s: `${fmtRp(R.allAct)} · ${nStores} toko` },
      { i: "i-target", l: "Pencapaian target", v: R.ach == null ? "n/a" : (R.ach * 100).toFixed(1) + "%", p: R.ach == null ? `<span class="pill na">—</span>` : `<span class="pill ${R.ach >= 1 ? "good" : R.ach >= .8 ? "warn" : "bad"}">${fmtPct(R.ach - 1)}</span>`, s: `${fmtRpS(R.tgtAct)} dari target ${fmtRpS(R.tgtTotal)}` },
      { i: "i-check", l: "Toko comparable", v: `${R.nComparable}<small>/${nStores}</small>`, p: R.nComparable ? `<span class="pill ${up >= down ? "good" : "bad"}">${up} naik · ${down} turun</span>` : `<span class="pill na">—</span>`, s: mode === "yoy" ? `beroperasi di ${BY()} & ${Y()}` : `aktif ≤ tgl ${C.MIN_ACTIVE_DAYS} di kedua bulan` },
    ];
    $("tiles").innerHTML = tiles.map(t => `<div class="tile"><div class="t-label"><i><svg><use href="#${t.i}"/></svg></i>${t.l}</div><div class="t-row"><div class="t-val">${t.v}</div>${t.p}</div><div class="t-sub">${t.s}</div></div>`).join("");
    $("kpiSub").textContent = ytd ? `${span} ${Y()} vs ${span} ${BY()}` : `${mName} vs ${cmpName}`;

    // ---- kartu pencapaian: mini-bar omset harian, abu-abu untuk hari tersisa
    $("achBig").textContent = R.ach == null ? "n/a" : (R.ach * 100).toFixed(1) + "%";
    $("achSub").textContent = ytd ? `${R.months.length} bulan${R.partial ? " · " + MONTH_SHORT[lastMi] + " s/d tgl " + lastN : ""}` : R.partial ? `s/d tgl ${R.N} dari ${daysIn(Y(), mi)} hari` : `bulan penuh · ${daysIn(Y(), mi)} hari`;
    drawMini(mi, R);

    // ---- tabel rincian
    const rows = visRows.slice().sort((a, b) => (b.growth ?? -9) - (a.growth ?? -9));
    const baseHead = mode === "mom" ? `Omset ${cmpName}` : ytd ? `Omset ${cmpName} (bulan comparable)` : `Omset ${cmpName}${R.partial ? (R.baseDaily ? " (tgl 1–" + R.N + ")" : " (prorata)") : ""}`;
    let h = `<tr><th>Toko</th><th>Omset ${mName}${R.partial && !ytd ? " MTD" : ""}</th><th>${baseHead}</th><th>${label} %</th><th>Selisih Rp</th><th>Target</th><th>Ach %</th><th style="text-align:left">Status</th></tr>`;
    for (const r of rows) {
      const diff = r.actual != null && r.base != null ? r.actual - r.base : null;
      h += `<tr data-name="${r.label.toLowerCase()}"><td>${r.label}</td><td>${fmtRp(r.actual)}</td><td>${fmtRp(r.base)}</td><td class="${cls(r.growth)}">${fmtPct(r.growth)}</td><td class="${diff == null ? "" : diff >= 0 ? "good" : "bad"}">${diff == null ? "—" : fmtRp(diff)}</td><td>${fmtRp(r.target)}</td><td>${r.ach == null ? "—" : (r.ach * 100).toFixed(1) + "%"}</td><td class="st">${r.comparable ? '<span class="pill good">Comparable</span>' : `<span class="pill ${r.excluded ? "na" : "brand"}">${r.note}</span>`}</td></tr>`;
    }
    h += `<tr class="total"><td>TOTAL comparable</td><td>${fmtRp(R.cmpTotalAct)}</td><td>${fmtRp(R.cmpTotalBase)}</td><td class="${cls(R.sssg)}">${fmtPct(R.sssg)}</td><td>${fmtRp(R.cmpTotalAct - R.cmpTotalBase)}</td><td>${fmtRp(R.tgtTotal)}</td><td>${R.ach == null ? "—" : (R.ach * 100).toFixed(1) + "%"}</td><td></td></tr>`;
    $("tblStore").innerHTML = h; applyFilter();
    $("tableSub").textContent = ytd ? `${span} ${Y()} vs ${span} ${BY()}${lfl} · SSSG % dihitung dari bulan-bulan comparable saja` : R.partial ? `Bulan berjalan: tgl 1–${R.N} ${mName} vs tgl 1–${R.N} ${cmpName}` : `Bulan penuh ${mName} vs ${cmpName}`;

    // ---- matriks per bulan
    const monthsAvail = state.months.map((m, i) => m ? i : -1).filter(i => i >= 0);
    const all = monthsAvail.map(i => computeMonth(i, mode));
    let mh = `<tr><th>Toko</th>${monthsAvail.map((i, k) => `<th>${MONTH_SHORT[i]}${all[k].partial ? "*" : ""}</th>`).join("")}<th>YTD</th></tr>`;
    for (const s of C.STORES.filter(s => !s.excludeFromSSSG)) {
      if (!all.some(res => { const r = res.rows.find(x => x.key === s.key); return r.actual != null || r.base != null; })) continue; // tidak ada data setahun penuh
      let ya = 0, yb = 0;
      mh += `<tr><td>${s.label}</td>`;
      all.forEach(res => { const r = res.rows.find(x => x.key === s.key); mh += `<td class="${cls(r.growth)}">${fmtPct(r.growth)}</td>`; if (r.comparable) { ya += r.actual; yb += r.base; } });
      const g = yb > 0 ? ya / yb - 1 : null;
      mh += `<td class="${cls(g)}">${fmtPct(g)}</td></tr>`;
    }
    let ta = 0, tb = 0; all.forEach(res => { ta += res.cmpTotalAct; tb += res.cmpTotalBase; });
    mh += `<tr class="total"><td>${label} perusahaan</td>${all.map(res => `<td class="${cls(res.sssg)}">${fmtPct(res.sssg)}</td>`).join("")}<td class="${cls(tb > 0 ? ta / tb - 1 : null)}">${fmtPct(tb > 0 ? ta / tb - 1 : null)}</td></tr>`;
    let ga = 0, gb = 0; all.forEach(res => { if (res.totalGrowth != null) { ga += res.allAct; gb += res.totalBase; } });
    mh += `<tr class="total"><td>Total growth (semua toko)</td>${all.map(res => `<td class="${cls(res.totalGrowth)}">${fmtPct(res.totalGrowth)}</td>`).join("")}<td class="${cls(gb > 0 ? ga / gb - 1 : null)}">${fmtPct(gb > 0 ? ga / gb - 1 : null)}</td></tr>`;
    $("tblMatrix").innerHTML = mh;
    $("matrixTitle").textContent = `Matriks ${label} % per bulan per toko` + (all.some(r => r.partial) ? " (* = bulan berjalan, like-for-like)" : "");

    // ---- grafik omset, peringkat, sorotan
    $("legA").textContent = mName; $("legB").textContent = cmpName + (mode === "yoy" && R.partial && !ytd ? (R.baseDaily ? ` (tgl 1–${R.N})` : " (prorata)") : ""); $("legNote").textContent = mode === "yoy" ? "angka di atas batang = SSSG %" : "angka di atas batang = growth MoM %";
    $("omsetSub").textContent = ytd ? `YTD · ${span}` : R.partial ? `MTD · tgl 1–${R.N}` : "bulan penuh";
    drawOmset(visRows.filter(r => !r.excluded), mName, cmpName);
    drawRankList(R, label);
    const best = R.rows.filter(r => r.comparable).sort((a, b) => b.growth - a.growth);
    $("insightMode").textContent = `${label} · ${mName}`;
    if (best.length) {
      const b = best[0], w = best[best.length - 1];
      $("insightQ").innerHTML = `${b.label} tumbuh paling kuat <span class="good">${fmtPct(b.growth)}</span>, ${w.label} paling lemah <span class="bad">${fmtPct(w.growth)}</span>.<small>vs ${cmpName}${lfl}</small>`;
      const chips = [`${up} toko naik`, `${down} toko turun`];
      if (R.sssg != null && R.totalGrowth != null) chips.push(`Kontribusi toko baru ${fmtPct(R.totalGrowth - R.sssg)}`);
      if (R.ach != null) chips.push(`Target ${(R.ach * 100).toFixed(0)}%`);
      $("insightChips").innerHTML = chips.map(c => `<span class="chip">${c}</span>`).join("");
    } else {
      $("insightQ").innerHTML = mode === "yoy" ? `Belum ada toko yang bisa dibandingkan.<small>${R.baseDaily ? "Toko belum aktif di kedua tahun untuk bulan ini." : `Data ${BY()} untuk bulan ini tidak tersedia.`} Lihat Growth MoM.</small>` : `Belum ada bulan pembanding.<small>Pilih bulan lain.</small>`;
      $("insightChips").innerHTML = mode === "yoy" ? `<span class="chip clk on" data-mode="mom">Lihat Growth MoM →</span>` : "";
    }
    drawTrend(monthsAvail, all, label);
    $("minDays").textContent = C.MIN_ACTIVE_DAYS; $("baseName").textContent = C.BASELINE_SHEET;
    $("footInfo").textContent = `${(C.SHEETS || []).map(sh => `Sheet ${sh.year}: ${sh.id}`).join(" · ")} · Sumber: ${C.APPS_SCRIPT_URL ? "Apps Script Web App" : "Google Sheets (gviz)"} · Toko dikeluarkan dari SSSG: ${C.STORES.filter(s => s.excludeFromSSSG).map(s => s.label).join(", ")}`;
    state.lastResult = R;
  }

  function applyFilter() { const q = $("storeFilter").value.trim().toLowerCase(); document.querySelectorAll("#tblStore tr[data-name]").forEach(tr => tr.classList.toggle("hide", !!q && !tr.dataset.name.includes(q))); }
  function kill(id) { if (state.charts[id]) { state.charts[id].destroy(); delete state.charts[id]; } }
  const gridY = { beginAtZero: true, grid: { color: "#EEF0F6" }, border: { display: false } };
  const gridX = { grid: { display: false }, border: { display: false } };

  // mini-bar omset harian (kartu pencapaian): indigo = hari dengan data, abu = hari tersisa (setinggi maksimum)
  function drawMini(mi, R, cid = "chartMini", key = "mini") {
    kill(key);
    const vals = [], ghost = []; let maxV = 0, labels = [], ttl = i => `Tgl ${i}`;
    if (R.ytd) { // YTD: satu batang per bulan (omset bulan), abu = bulan yang belum ada
      labels = MONTH_SHORT.slice(); ttl = i => i;
      for (let i = 0; i < 12; i++) { const m = state.months[i]; const v = m ? m.days.reduce((x, d) => x + (d.total != null ? d.total : Object.values(d.act).reduce((a, b) => a + (b || 0), 0)), 0) : null; vals.push(v == null ? null : +(v / 1e6).toFixed(1)); if (v > maxV) maxV = v; }
    } else {
      const m = state.months[mi]; if (!m) return;
      const n = daysIn(Y(), mi), byDay = {}; m.days.forEach(d => byDay[d.d] = d); labels = Array.from({ length: n }, (_, i) => String(i + 1));
      for (let d = 1; d <= n; d++) { const x = byDay[d]; const v = x ? (x.total != null ? x.total : Object.values(x.act).reduce((a, b) => a + (b || 0), 0)) : 0; const has = R.partial ? d <= R.N : true; vals.push(has ? +(v / 1e6).toFixed(1) : null); if (has && v > maxV) maxV = v; }
    }
    const g = +(maxV / 1e6).toFixed(1) || 1; vals.forEach(v => ghost.push(v == null ? g : null));
    state.charts[key] = new Chart($(cid), { type: "bar", data: { labels, datasets: [
      { label: "Omset", data: vals, backgroundColor: BRAND, hoverBackgroundColor: BRAND_2, borderRadius: 6, borderSkipped: false, barPercentage: .72, categoryPercentage: .9 },
      { label: "Sisa", data: ghost, backgroundColor: GHOST, hoverBackgroundColor: GHOST, borderRadius: 6, borderSkipped: false, barPercentage: .72, categoryPercentage: .9 }] },
      options: { plugins: { legend: { display: false }, tooltip: { filter: i => i.datasetIndex === 0, callbacks: { title: i => ttl(i[0].label), label: c => "Rp " + c.raw.toLocaleString("id-ID") + " jt" } } }, scales: { x: { display: false, stacked: true }, y: { display: false, stacked: true, beginAtZero: true } }, animation: { duration: 400 } } });
  }

  // plugin: tulis growth % (SSSG / MoM) di atas tiap pasangan batang, warna sesuai ambang; "n/a" bila tidak comparable
  const growthLabels = { id: "growthLabels", afterDatasetsDraw(chart, _, o) {
    const rows = o.labels || o.rows || [], { ctx } = chart, m0 = chart.getDatasetMeta(0), m1 = chart.getDatasetMeta(1);
    ctx.save(); ctx.font = "700 11px 'Plus Jakarta Sans', Inter, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    rows.forEach((r, i) => {
      if (r && r.text != null) { const b0 = m0.data[i], b1 = m1 && !m1.hidden ? m1.data[i] : null; if (!b0 || b0.skip) return; const y1 = b1 && !b1.skip && isFinite(b1.y) ? b1.y : Infinity; ctx.fillStyle = r.color; ctx.fillText(r.text, b1 && isFinite(y1) ? (b0.x + b1.x) / 2 : b0.x, Math.min(b0.y, y1) - 5); return; }
      const b0 = m0.data[i], b1 = m1 && !m1.hidden ? m1.data[i] : null; if (!b0 || b0.skip) return;
      const y1 = b1 && !b1.skip && isFinite(b1.y) ? b1.y : Infinity, top = Math.min(b0.y, y1), x = b1 && isFinite(y1) ? (b0.x + b1.x) / 2 : b0.x;
      const v = r.growth; ctx.fillStyle = v == null ? "#8A94A6" : v >= C.THRESHOLD.good / 100 ? "#15803D" : v >= C.THRESHOLD.warn / 100 ? "#B45309" : "#B91C1C";
      ctx.fillText(v == null ? "n/a" : fmtPct(v), x, top - 5);
    });
    ctx.restore();
  } };
  // grafik utama: omset per toko, bulan terpilih (indigo) vs pembanding (abu), label growth % di atas
  function drawOmset(rows, a, b) {
    kill("omset"); const short = Object.fromEntries(C.STORES.map(s => [s.key, s.short]));
    state.charts.omset = new Chart($("chartOmset"), { type: "bar", plugins: [growthLabels], data: { labels: rows.map(r => short[r.key] || r.label), datasets: [
      { label: a, data: rows.map(r => +((r.actual || 0) / 1e6).toFixed(1)), backgroundColor: BRAND, hoverBackgroundColor: BRAND_2, borderRadius: 10, borderSkipped: false, barPercentage: .82, categoryPercentage: .62 },
      { label: b, data: rows.map(r => r.base == null ? null : +(r.base / 1e6).toFixed(1)), backgroundColor: GHOST, hoverBackgroundColor: GHOST_2, borderRadius: 10, borderSkipped: false, barPercentage: .82, categoryPercentage: .62 }] },
      options: { layout: { padding: { top: 22 } }, plugins: { growthLabels: { rows }, legend: { display: false }, tooltip: { callbacks: { title: i => rows[i[0].dataIndex].label, label: c => `${c.dataset.label}: ${c.raw == null ? "—" : "Rp " + c.raw.toLocaleString("id-ID") + " jt"}`, afterBody: i => { const r = rows[i[0].dataIndex]; return r.growth == null ? (r.note ? [r.note] : []) : [(state.mode === "yoy" ? "SSSG " : "MoM ") + fmtPct(r.growth)]; } } } }, scales: { x: gridX, y: { ...gridY, ticks: { callback: v => v.toLocaleString("id-ID") + " jt", maxTicksLimit: 6 } } } } });
  }

  // daftar peringkat (gaya "Quick Log"): 5 terbaik / 5 terlemah, ditukar dengan tombol
  function drawRankList(R, label) {
    const cmp = R.rows.filter(r => r.comparable).sort((a, b) => b.growth - a.growth);
    const list = state.rankWorst ? cmp.slice().reverse().slice(0, 5) : cmp.slice(0, 5);
    $("rankTitle").textContent = (state.rankWorst ? "5 toko terlemah" : "5 toko terbaik") + ` · ${label}`;
    $("rankList").innerHTML = list.length ? list.map((r, i) => `<div class="rk"><div class="av ${cls(r.growth)}">${state.rankWorst ? cmp.length - i : i + 1}</div><div class="nm"><b>${r.label}</b><span>${fmtRpS(r.actual)} vs ${fmtRpS(r.base)}</span></div><div class="vl ${cls(r.growth)}">${fmtPct(r.growth)}</div></div>`).join("") : `<div class="muted" style="padding:12px 0">Belum ada toko comparable untuk ${label}.</div>`;
    $("rankFoot").textContent = cmp.length ? `${cmp.length} toko comparable · klik ⇅ untuk menukar terbaik/terlemah` : "";
  }

  // palet tren per toko: urutan TETAP per toko, sudah divalidasi buta-warna (validate_palette.js: ALL PASS)
  const TREND_PALETTE = ["#158F5A", "#4C33EA", "#C96A00", "#D6336C", "#1D8BD8", "#7A8A12", "#8B3FD9", "#A88200", "#3F5F9E", "#9A5B2B"];
  function drawTrend(monthsAvail, all, label) {
    const stores = C.STORES.filter(s => !s.excludeFromSSSG && state.months.some(m => m && m.days.some(d => d.act[s.key] != null)));
    const chips = $("chips");
    if (chips.dataset.year !== String(state.year)) {
      chips.innerHTML = ""; chips.dataset.year = String(state.year);
      state.trendKeys = new Set(["__ALL__", ...stores.slice(0, 4).map(s => s.key)]);
      const mk = (key, txt) => { const b = document.createElement("span"); b.className = "chip clk" + (state.trendKeys.has(key) ? " on" : ""); b.textContent = txt; b.onclick = () => { state.trendKeys.has(key) ? state.trendKeys.delete(key) : state.trendKeys.add(key); b.classList.toggle("on"); render(); }; chips.appendChild(b); };
      mk("__ALL__", "Perusahaan"); stores.forEach(s => mk(s.key, s.short));
    }
    const ds = [];
    if (state.trendKeys.has("__ALL__")) ds.push({ label: label + " perusahaan", data: all.map(r => r.sssg == null ? null : +(r.sssg * 100).toFixed(1)), borderColor: BRAND_2, backgroundColor: areaFill(BRAND_2), fill: true, borderWidth: 2.5, pointRadius: 3.5, tension: .35, spanGaps: true });
    stores.forEach((s, i) => { if (!state.trendKeys.has(s.key)) return; const col = TREND_PALETTE[i % TREND_PALETTE.length]; ds.push({ label: s.label, data: all.map(r => { const x = r.rows.find(q => q.key === s.key); return x.growth == null ? null : +(x.growth * 100).toFixed(1); }), borderColor: col, backgroundColor: col, borderWidth: 2, pointRadius: 3, tension: .35, spanGaps: true }); });
    kill("trend");
    state.charts.trend = new Chart($("chartTrend"), { type: "line", data: { labels: monthsAvail.map(i => MONTH_SHORT[i]), datasets: ds }, options: { interaction: { mode: "index", intersect: false }, plugins: { legend: { position: "bottom", labels: { usePointStyle: true, pointStyle: "circle", boxWidth: 8, padding: 14 } }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.raw == null ? "n/a" : (c.raw > 0 ? "+" : "") + c.raw + "%"}` } } }, scales: { x: gridX, y: { grid: { color: "#EEF0F6" }, border: { display: false }, ticks: { callback: v => v + "%" } } } } });
  }

  function exportCsv() {
    const R = state.lastResult; if (!R) return;
    const mName = R.ytd ? "YTD" : MONTH_NAMES[R.mi], cmp = R.mode === "mom" ? MONTH_NAMES[R.mi - 1] + " " + Y() : mName + " " + BY();
    const lines = [["Toko", "Omset " + mName + " " + Y() + (R.partial && !R.ytd ? " MTD s/d " + R.N : ""), "Omset " + cmp, (R.mode === "mom" ? "MoM" : "SSSG") + " %", "Target", "Ach %", "Status"]];
    for (const r of R.rows) lines.push([r.label, r.actual ?? "", r.base != null ? Math.round(r.base) : "", r.growth == null ? "" : (r.growth * 100).toFixed(2), r.target ? Math.round(r.target) : "", r.ach == null ? "" : (r.ach * 100).toFixed(1), r.comparable ? "comparable" : r.note]);
    lines.push(["TOTAL comparable", R.cmpTotalAct, Math.round(R.cmpTotalBase), R.sssg == null ? "" : (R.sssg * 100).toFixed(2), Math.round(R.tgtTotal), R.ach == null ? "" : (R.ach * 100).toFixed(1), ""]);
    const csv = lines.map(l => l.map(v => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" })); a.download = `SSSG_${mName}_${Y()}.csv`; a.click();
  }

  // ---------- render: KUNJUNGAN ----------
  const TEAL = "#8FCBA9", TEAL_2 = "#5FB388"; // hijau muda (belanja / bulan lalu)
  const fmtN = (v) => v == null ? "—" : Math.round(v).toLocaleString("id-ID");
  const fmtPts = (v, d = 1) => v == null ? "n/a" : (v > 0 ? "+" : "") + (v * 100).toFixed(d) + " pts";
  const fmtRb = (v) => v == null ? "—" : "Rp " + Math.round(v / 1000).toLocaleString("id-ID") + " rb";
  const konvCls = (v) => { const T = C.THRESHOLD_KONVERSI || { good: 80, warn: 60 }; return v == null ? "na" : v >= T.good / 100 ? "good" : v >= T.warn / 100 ? "warn" : "bad"; };
  const pillG = (v, f = fmtPct) => v == null ? `<span class="pill na">n/a</span>` : `<span class="pill ${cls(v)}">${f(v)}</span>`;
  const pillPts = (v) => v == null ? `<span class="pill na">n/a</span>` : `<span class="pill ${v > 0.005 ? "good" : v < -0.005 ? "bad" : "warn"}">${fmtPts(v)}</span>`;
  // agregat harian perusahaan (datang/belanja/gagal per tgl) utk mini-bar & tren
  function visitDaily(m, keys) {
    if (!m) return []; const out = [];
    for (const d of m.days) { const o = { d: d.d, datang: 0, belanja: 0, gagal: 0, any: false }; for (const k in d.visit) { if (keys && !keys.has(k)) continue; const v = d.visit[k]; o.datang += v.DATANG || 0; o.belanja += v.BELANJA || 0; o.gagal += v.GAGAL || 0; o.any = true; } out.push(o); }
    return out;
  }

  function renderVisits() {
    const mi = state.month, mode = state.mode, ytd = mi === "ytd", rng = state.range;
    const R = rng ? computeVisitsRange(rng.a, rng.b, mode) : ytd ? computeVisitsYTD() : computeVisits(mi, mode);
    const lastMi = ytd && R ? R.months[R.months.length - 1] : mi, lastN = R && ytd && R.partial ? lastDataDay(lastMi) : (R ? R.N : null);
    const span = rng ? fmtRange(rng.a, rng.b) : ytd ? `Jan–${MONTH_SHORT[lastMi]}` : MONTH_SHORT[mi];
    const mName = rng ? fmtRange(rng.a, rng.b) : ytd ? `YTD ${Y()}` : MONTH_SHORT[mi] + " " + Y();
    const cmpName = rng ? (R && R.range ? fmtRange(R.range.ca, R.range.cb) : "—") : mode === "mom" ? (mi > 0 ? MONTH_SHORT[mi - 1] + " " + Y() : "—") : ytd ? `YTD ${BY()}` : MONTH_SHORT[mi] + " " + BY();
    const lfl = R && R.partial && !rng ? (ytd ? ` · ${MONTH_SHORT[lastMi]} like-for-like tgl 1–${lastN}` : ` · like-for-like tgl 1–${R.N}`) : "";
    if (!R || !R.total || !R.total.datang) {
      $("vHeroLabel").textContent = `Kunjungan ${mName}`; $("vHeroVal").textContent = "—"; $("vHeroSub").textContent = "Blok ABSEN KUNJUNGAN PER HARI tidak ditemukan untuk periode ini."; $("vHeroBadge").textContent = "—";
      $("vTiles").innerHTML = ""; $("tblVisit").innerHTML = ""; $("vRankList").innerHTML = ""; $("vInsightQ").textContent = "Tidak ada data kunjungan."; $("vInsightChips").innerHTML = ""; ["visitMini", "visitBars", "visitTrend"].forEach(kill); return;
    }
    const T = R.total, Cc = R.totalCmp, g = R.g || {};
    // hero
    $("vHeroLabel").textContent = `Kunjungan ${ytd ? span + " " + Y() : mName}`;
    $("vHeroVal").textContent = fmtN(T.datang);
    $("vHeroSub").textContent = `${fmtN(T.belanja)} belanja · konversi ${fmtPct(T.konversi, 1).replace("+", "")}${Cc ? ` · vs ${fmtN(Cc.datang)} (${cmpName})` : ""}${lfl}`;
    $("vHeroBadge").textContent = g.datang == null ? (Cc ? "n/a" : "—") : fmtPct(g.datang);
    $("vHeroBadge").className = "hero-badge";
    // tiles
    const tiles = [
      { i: "i-check", l: "Belanja (transaksi)", v: fmtN(T.belanja), p: pillG(g.belanja), s: `${fmtN(T.gagal)} gagal · ${fmtPct(T.gagalPct).replace("+", "")} dari datang` },
      { i: "i-target", l: "Konversi belanja", v: fmtPct(T.konversi).replace("+", ""), p: pillPts(g.konversi), s: Cc ? `${cmpName}: ${fmtPct(Cc.konversi).replace("+", "")}` : "belanja ÷ datang" },
      { i: "i-store", l: "Basket size", v: fmtRb(T.basket), p: pillG(g.basket), s: Cc ? `${cmpName}: ${fmtRb(Cc.basket)}` : "omset ÷ belanja" },
      { i: "i-bars", l: "Rata-rata datang / hari", v: fmtN(T.perHari), p: `<span class="pill teal">${T.nDays} hari</span>`, s: `${fmtN(T.datang)} datang · ${ytd ? R.months.length + " bulan" : mName}` },
    ];
    if (T.hasRO) tiles.push({ i: "i-list", l: "Repeat order", v: fmtPct(T.roPct).replace("+", ""), p: `<span class="pill teal">${fmtN(T.ro)}</span>`, s: "porsi dari belanja" }, { i: "i-info", l: "Pelanggan baru", v: fmtPct(T.baruPct).replace("+", ""), p: `<span class="pill teal">${fmtN(T.baru)}</span>`, s: "porsi dari belanja" });
    $("vTiles").innerHTML = tiles.map(t => `<div class="tile"><div class="t-label"><i class="teal"><svg><use href="#${t.i}"/></svg></i>${t.l}</div><div class="t-row"><div class="t-val">${t.v}</div>${t.p}</div><div class="t-sub">${t.s}</div></div>`).join("");
    $("vKpiSub").textContent = Cc ? `${ytd ? span + " " + Y() : mName} vs ${cmpName}` : `${ytd ? span + " " + Y() : mName} · tanpa pembanding`;
    $("vInsightMode").textContent = `${mode === "yoy" ? "vs tahun lalu" : "vs bulan lalu"} · ${mName}`;
    // konversi mini
    $("vKonvBig").textContent = fmtPct(T.konversi).replace("+", "");
    $("vKonvSub").textContent = rng ? `${T.nDays} hari` : ytd ? `${R.months.length} bulan` : R.partial ? `s/d tgl ${R.N}` : `bulan penuh · ${T.nDays} hari`;
    drawVisitMini(mi, R);
    // tabel
    const rows = R.rows.filter(r => r.cur).sort((a, b) => (b.cur.konversi ?? -1) - (a.cur.konversi ?? -1));
    const hasRO = rows.some(r => r.cur.hasRO);
    let h = `<tr><th>Toko</th><th>Datang</th><th>Belanja</th><th>Gagal</th><th>Konversi</th>${hasRO ? "<th>RO</th><th>Baru</th>" : ""}<th>Basket size</th><th>Datang vs ${cmpName}</th><th>Konversi vs ${cmpName}</th></tr>`;
    for (const r of rows) { const a = r.cur; h += `<tr><td>${r.label}</td><td>${fmtN(a.datang)}</td><td>${fmtN(a.belanja)}</td><td>${fmtN(a.gagal)}</td><td class="${konvCls(a.konversi)}">${fmtPct(a.konversi).replace("+", "")}</td>${hasRO ? `<td>${a.hasRO ? fmtPct(a.roPct).replace("+", "") : "—"}</td><td>${a.hasRO ? fmtPct(a.baruPct).replace("+", "") : "—"}</td>` : ""}<td>${fmtRb(a.basket)}</td><td class="${cls(r.g.datang)}">${r.cmp ? fmtPct(r.g.datang) : "—"}</td><td class="${r.g.konversi == null ? "na" : r.g.konversi > 0.005 ? "good" : r.g.konversi < -0.005 ? "bad" : "warn"}">${r.cmp ? fmtPts(r.g.konversi) : "—"}</td></tr>`; }
    h += `<tr class="total"><td>TOTAL</td><td>${fmtN(T.datang)}</td><td>${fmtN(T.belanja)}</td><td>${fmtN(T.gagal)}</td><td class="${konvCls(T.konversi)}">${fmtPct(T.konversi).replace("+", "")}</td>${hasRO ? `<td>${fmtPct(T.roPct).replace("+", "")}</td><td>${fmtPct(T.baruPct).replace("+", "")}</td>` : ""}<td>${fmtRb(T.basket)}</td><td class="${cls(g.datang)}">${Cc ? fmtPct(g.datang) : "—"}</td><td>${Cc ? fmtPts(g.konversi) : "—"}</td></tr>`;
    $("tblVisit").innerHTML = h;
    $("vTableSub").textContent = `${ytd ? span + " " + Y() : mName}${Cc ? ` vs ${cmpName}` : ""}${lfl} · konversi hijau ≥ ${(C.THRESHOLD_KONVERSI || { good: 80 }).good}% · kuning ≥ ${(C.THRESHOLD_KONVERSI || { warn: 60 }).warn}%`;
    // bar per toko
    $("vBarSub").textContent = rng ? "rentang tanggal" : ytd ? `YTD · ${span}` : R.partial ? `MTD · tgl 1–${R.N}` : "bulan penuh";
    drawVisitBars(R.rows.filter(r => r.cur));
    // peringkat & sorotan
    drawVisitRank(R);
    const ranked = R.rows.filter(r => r.cur && r.cur.datang >= 20 && r.cur.konversi != null).sort((a, b) => b.cur.konversi - a.cur.konversi);
    if (ranked.length) {
      const b = ranked[0], w = ranked[ranked.length - 1];
      $("vInsightQ").innerHTML = `${b.label} konversi tertinggi <span class="good">${fmtPct(b.cur.konversi).replace("+", "")}</span>, ${w.label} terendah <span class="bad">${fmtPct(w.cur.konversi).replace("+", "")}</span>.<small>${fmtN(T.datang)} datang · ${fmtN(T.gagal)} gagal (${fmtPct(T.gagalPct).replace("+", "")})</small>`;
      const chips = []; if (Cc) chips.push(`Datang ${fmtPct(g.datang)} vs ${cmpName}`, `Konversi ${fmtPts(g.konversi)}`); chips.push(`Basket ${fmtRb(T.basket)}`); if (T.hasRO) chips.push(`RO ${fmtPct(T.roPct).replace("+", "")}`, `Baru ${fmtPct(T.baruPct).replace("+", "")}`);
      $("vInsightChips").innerHTML = chips.map(c => `<span class="chip">${c}</span>`).join("");
    } else { $("vInsightQ").textContent = "Belum cukup data kunjungan."; $("vInsightChips").innerHTML = ""; }
    // tren
    drawVisitTrend(mi, R, cmpName);
    state.lastVisit = R;
  }

  function drawVisitMini(mi, R) {
    kill("visitMini"); let labels, bel = [], gag = [], ttl;
    if (R.range) { const dd = visitDaily(R.pseudo); labels = R.pseudo.days.map(d => `${d.date.getDate()} ${MONTH_SHORT[d.date.getMonth()]}`); ttl = i => i; dd.forEach(o => { bel.push(o.any ? o.belanja : null); gag.push(o.any ? o.gagal : null); }); }
    else if (R.ytd) { labels = MONTH_SHORT.slice(); ttl = i => i; for (let i = 0; i < 12; i++) { const r = state.months[i] ? computeVisits(i, "yoy") : null; bel.push(r && r.total ? r.total.belanja : null); gag.push(r && r.total ? r.total.gagal : null); } }
    else { const dd = visitDaily(state.months[mi]); labels = dd.map(o => String(o.d)); ttl = i => `Tgl ${i}`; dd.forEach(o => { const has = o.any && (!R.partial || o.d <= R.N); bel.push(has ? o.belanja : null); gag.push(has ? o.gagal : null); }); }
    const maxD = Math.max(1, ...bel.map((b, i) => (b || 0) + (gag[i] || 0))); const rest = bel.map(b => b == null ? maxD : null);
    state.charts.visitMini = new Chart($("chartVisitMini"), { type: "bar", data: { labels, datasets: [
      { label: "Belanja", data: bel, backgroundColor: TEAL, hoverBackgroundColor: TEAL_2, borderRadius: 6, borderSkipped: false, barPercentage: .72, categoryPercentage: .9 },
      { label: "Gagal", data: gag, backgroundColor: "#CFE3D7", hoverBackgroundColor: "#BFD9C9", borderRadius: 6, borderSkipped: false, barPercentage: .72, categoryPercentage: .9 },
      { label: "Sisa", data: rest, backgroundColor: GHOST, hoverBackgroundColor: GHOST, borderRadius: 6, borderSkipped: false, barPercentage: .72, categoryPercentage: .9 }] },
      options: { plugins: { legend: { display: false }, tooltip: { filter: i => i.datasetIndex < 2, callbacks: { title: i => ttl(i[0].label), label: c => `${c.dataset.label}: ${fmtN(c.raw)}`, afterBody: i => { const b = bel[i[0].dataIndex] || 0, gg = gag[i[0].dataIndex] || 0; return b + gg ? [`Datang ${fmtN(b + gg)} · konversi ${(b / (b + gg) * 100).toFixed(0)}%`] : []; } } } }, scales: { x: { display: false, stacked: true }, y: { display: false, stacked: true, beginAtZero: true } }, animation: { duration: 400 } } });
  }
  function drawVisitBars(rows) {
    kill("visitBars"); const short = Object.fromEntries(C.STORES.map(s => [s.key, s.short]));
    const labels = rows.map(r => ({ text: r.cur.konversi == null ? "n/a" : fmtPct(r.cur.konversi, 0).replace("+", ""), color: { good: "#15803D", warn: "#B45309", bad: "#B91C1C", na: "#9AA0B5" }[konvCls(r.cur.konversi)] }));
    state.charts.visitBars = new Chart($("chartVisitBars"), { type: "bar", plugins: [growthLabels], data: { labels: rows.map(r => short[r.key] || r.label), datasets: [
      { label: "Datang", data: rows.map(r => r.cur.datang), backgroundColor: BRAND, hoverBackgroundColor: BRAND_2, borderRadius: 10, borderSkipped: false, barPercentage: .82, categoryPercentage: .62 },
      { label: "Belanja", data: rows.map(r => r.cur.belanja), backgroundColor: TEAL, hoverBackgroundColor: TEAL_2, borderRadius: 10, borderSkipped: false, barPercentage: .82, categoryPercentage: .62 }] },
      options: { layout: { padding: { top: 22 } }, plugins: { growthLabels: { labels }, legend: { display: false }, tooltip: { callbacks: { title: i => rows[i[0].dataIndex].label, label: c => `${c.dataset.label}: ${fmtN(c.raw)}`, afterBody: i => { const a = rows[i[0].dataIndex].cur; return [`Konversi ${fmtPct(a.konversi).replace("+", "")} · gagal ${fmtN(a.gagal)} · basket ${fmtRb(a.basket)}`]; } } } }, scales: { x: gridX, y: { ...gridY, ticks: { callback: v => v.toLocaleString("id-ID"), maxTicksLimit: 6 } } } } });
  }
  function drawVisitRank(R) {
    const list0 = R.rows.filter(r => r.cur && r.cur.konversi != null && r.cur.datang >= 20).sort((a, b) => b.cur.konversi - a.cur.konversi);
    const list = state.visitRankWorst ? list0.slice().reverse().slice(0, 5) : list0.slice(0, 5);
    $("vRankTitle").textContent = state.visitRankWorst ? "Konversi terendah" : "Konversi tertinggi";
    $("vRankList").innerHTML = list.length ? list.map((r, i) => `<div class="rk"><div class="av ${konvCls(r.cur.konversi)}">${state.visitRankWorst ? list0.length - i : i + 1}</div><div class="nm"><b>${r.label}</b><span>${fmtN(r.cur.belanja)} dari ${fmtN(r.cur.datang)} datang · basket ${fmtRb(r.cur.basket)}</span></div><div class="vl ${konvCls(r.cur.konversi)}">${fmtPct(r.cur.konversi).replace("+", "")}</div></div>`).join("") : `<div class="muted" style="padding:12px 0">Belum ada data.</div>`;
    $("vRankFoot").textContent = list0.length ? `${list0.length} toko (≥ 20 kunjungan) · klik ⇅ untuk menukar` : "";
  }
  function drawVisitTrend(mi, R, cmpName) {
    const stores = C.STORES.filter(s => !s.excludeFromSSSG && state.months.some(m => m && m.days.some(d => d.visit && d.visit[s.key]))), chips = $("vChips");
    if (chips.dataset.year !== String(state.year)) {
      chips.innerHTML = ""; chips.dataset.year = String(state.year);
      state.visitKeys = new Set(["__ALL__"]);
      const mk = (key, txt) => { const b = document.createElement("span"); b.className = "chip clk" + (state.visitKeys.has(key) ? " on" : ""); b.textContent = txt; b.onclick = () => { state.visitKeys.has(key) ? state.visitKeys.delete(key) : state.visitKeys.add(key); b.classList.toggle("on"); renderVisits(); }; chips.appendChild(b); };
      mk("__ALL__", "Perusahaan"); stores.forEach(s => mk(s.key, s.short));
    }
    let labels, series = {};
    if (R.range) {
      labels = R.pseudo.days.map(d => `${d.date.getDate()} ${MONTH_SHORT[d.date.getMonth()]}`); const dd = visitDaily(R.pseudo), cd = visitDaily(R.cpseudo);
      series.all = { datang: dd.map(o => o.any ? o.datang : null), belanja: dd.map(o => o.any ? o.belanja : null), cmp: labels.map((_, i) => cd[i] && cd[i].any ? cd[i].datang : null) };
      stores.forEach(s => { series[s.key] = R.pseudo.days.map(d => { const v = d.visit[s.key]; return v ? v.DATANG : null; }); });
      $("vTrendTitle").textContent = "Tren kunjungan harian"; $("vTrendSub").textContent = `${fmtRange(R.range.a, R.range.b)} per tanggal · abu putus-putus = datang ${cmpName} (disandingkan urut hari)`;
    } else if (R.ytd) {
      labels = R.months.map(i => MONTH_SHORT[i]);
      const per = R.months.map(i => computeVisits(i, "yoy"));
      series.all = { datang: per.map(r => r && r.total ? r.total.datang : null), belanja: per.map(r => r && r.total ? r.total.belanja : null), cmp: per.map(r => r && r.totalCmp ? r.totalCmp.datang : null) };
      stores.forEach(s => { series[s.key] = per.map(r => { const x = r && r.rows.find(q => q.key === s.key); return x && x.cur ? x.cur.datang : null; }); });
      $("vTrendTitle").textContent = "Tren kunjungan per bulan"; $("vTrendSub").textContent = `${labels[0]}–${labels[labels.length - 1]} ${Y()} · datang & belanja perusahaan, datang per toko`;
    } else {
      const m = state.months[mi], cm = R.mode === "mom" ? (mi > 0 ? state.months[mi - 1] : null) : state.baseMonths[mi];
      const dd = visitDaily(m), cd = visitDaily(cm); const n = daysIn(Y(), mi); labels = Array.from({ length: n }, (_, i) => String(i + 1));
      const at = (arr, d, k) => { const o = arr.find(x => x.d === d); return o && o.any ? o[k] : null; };
      series.all = { datang: labels.map((_, i) => (R.partial && i + 1 > R.N) ? null : at(dd, i + 1, "datang")), belanja: labels.map((_, i) => (R.partial && i + 1 > R.N) ? null : at(dd, i + 1, "belanja")), cmp: labels.map((_, i) => at(cd, i + 1, "datang")) };
      stores.forEach(s => { series[s.key] = labels.map((_, i) => { if (R.partial && i + 1 > R.N) return null; const d = m.days.find(x => x.d === i + 1); const v = d && d.visit[s.key]; return v ? v.DATANG : null; }); });
      $("vTrendTitle").textContent = "Tren kunjungan harian"; $("vTrendSub").textContent = `${MONTH_SHORT[mi]} ${Y()} per tanggal · abu putus-putus = datang ${cmpName}`;
    }
    const ds = [];
    if (state.visitKeys.has("__ALL__")) { ds.push({ label: "Datang", data: series.all.datang, borderColor: BRAND_2, backgroundColor: areaFill(BRAND_2), fill: true, borderWidth: 2.5, pointRadius: 3, tension: .35, spanGaps: true }, { label: "Belanja", data: series.all.belanja, borderColor: TEAL_2, backgroundColor: TEAL_2, borderWidth: 2, pointRadius: 3, tension: .35, spanGaps: true }); if (series.all.cmp.some(v => v != null)) ds.push({ label: `Datang ${cmpName}`, data: series.all.cmp, borderColor: "#9AA0B5", backgroundColor: "#9AA0B5", borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, tension: .35, spanGaps: true }); }
    stores.forEach((s, i) => { if (!state.visitKeys.has(s.key)) return; const col = TREND_PALETTE[i % TREND_PALETTE.length]; ds.push({ label: s.label + " (datang)", data: series[s.key], borderColor: col, backgroundColor: col, borderWidth: 2, pointRadius: 2.5, tension: .35, spanGaps: true }); });
    kill("visitTrend");
    state.charts.visitTrend = new Chart($("chartVisitTrend"), { type: "line", data: { labels, datasets: ds }, options: { interaction: { mode: "index", intersect: false }, plugins: { legend: { position: "bottom", labels: { usePointStyle: true, pointStyle: "circle", boxWidth: 8, padding: 14 } }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmtN(c.raw)}` } } }, scales: { x: gridX, y: { ...gridY, ticks: { callback: v => v.toLocaleString("id-ID") } } } } });
  }
  function exportVisitCsv() {
    const R = state.lastVisit; if (!R) return;
    const name = R.range ? "rentang" : R.ytd ? "YTD" : MONTH_NAMES[R.mi];
    const lines = [["Toko", "Datang", "Belanja", "Gagal", "Konversi %", "RO", "Baru", "Basket size (Rp)", "Datang pembanding", "Datang vs pembanding %", "Konversi vs pembanding (pts)"]];
    for (const r of R.rows) { if (!r.cur) continue; const a = r.cur; lines.push([r.label, a.datang, a.belanja, a.gagal, a.konversi == null ? "" : (a.konversi * 100).toFixed(1), a.hasRO ? a.ro : "", a.hasRO ? a.baru : "", a.basket == null ? "" : Math.round(a.basket), r.cmp ? r.cmp.datang : "", r.g.datang == null ? "" : (r.g.datang * 100).toFixed(1), r.g.konversi == null ? "" : (r.g.konversi * 100).toFixed(1)]); }
    const T = R.total; lines.push(["TOTAL", T.datang, T.belanja, T.gagal, (T.konversi * 100).toFixed(1), T.hasRO ? T.ro : "", T.hasRO ? T.baru : "", Math.round(T.basket), R.totalCmp ? R.totalCmp.datang : "", R.g.datang == null ? "" : (R.g.datang * 100).toFixed(1), R.g.konversi == null ? "" : (R.g.konversi * 100).toFixed(1)]);
    const csv = lines.map(l => l.map(v => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" })); a.download = `Kunjungan_${name}_${Y()}.csv`; a.click();
  }

  // ---------- render: komponen bersama ----------
  const tileHTML = (t) => `<div class="tile"><div class="t-label"><i class="${t.c || ""}"><svg><use href="#${t.i}"/></svg></i>${t.l}</div><div class="t-row"><div class="t-val">${t.v}</div>${t.p || ""}</div><div class="t-sub">${t.s || ""}</div></div>`;
  const periodName = (mi) => mi === "ytd" ? `YTD ${Y()}` : MONTH_SHORT[mi] + " " + Y();
  const SEV = { crit: "Kritis", warn: "Peringatan", info: "Info" }, TYPE = { decline: "Penurunan omset", trend: "Tren negatif", under: "Di bawah target" };
  const storeColor = (key) => { const i = activeStores().findIndex(s => s.key === key); return TREND_PALETTE[(i < 0 ? 0 : i) % TREND_PALETTE.length]; };
  // plugin label di ujung batang horizontal
  const hbarLabels = { id: "hbarLabels", afterDatasetsDraw(chart, _, o) { const L = o.labels || []; const m = chart.getDatasetMeta(0); const { ctx } = chart; ctx.save(); ctx.font = "600 11px 'Plus Jakarta Sans', Inter, sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "middle"; L.forEach((l, i) => { const b = m.data[i]; if (!b || b.skip) return; ctx.fillStyle = l.color; ctx.fillText(l.text, b.x + 8, b.y); }); ctx.restore(); } };
  const areaFill = (hex) => (ctx) => { const ch = ctx.chart; const { ctx: c, chartArea: ca } = ch; if (!ca) return "transparent"; const g = c.createLinearGradient(0, ca.top, 0, ca.bottom); g.addColorStop(0, hex + "55"); g.addColorStop(1, hex + "00"); return g; };
  const lineDs = (label, data, color, dash, area) => ({ label, data, borderColor: color, backgroundColor: area ? areaFill(color) : color, fill: !!area, borderWidth: dash ? 1.5 : 2.5, borderDash: dash || [], pointRadius: dash ? 0 : 3, tension: .35, spanGaps: true });
  const lineOpts = (fmt) => ({ interaction: { mode: "index", intersect: false }, plugins: { legend: { position: "bottom", labels: { usePointStyle: true, pointStyle: "circle", boxWidth: 8, padding: 14 } }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.raw == null ? "—" : fmt(c.raw)}` } } }, scales: { x: gridX, y: { ...gridY, ticks: { callback: v => fmt(v) } } } });
  const jt = v => "Rp " + (+v).toLocaleString("id-ID", { maximumFractionDigits: 1 }) + " jt";
  // seri harian (jt) satu bulan utk entitas (perusahaan / satu toko), dipotong ke upTo
  const dailyJt = (y, m, key, upTo) => { if (!m) return null; const n = daysIn(y, m.idx), arr = Array(n).fill(null); dailySeries(y, m, upTo).forEach(o => { const v = key ? (o.store[key] || 0) : o.v; arr[o.d - 1] = (v > 0 || !upTo) ? +(v / 1e6).toFixed(1) : null; }); return arr; };
  const monthlyJt = (y, key) => Array.from({ length: 12 }, (_, i) => { const m = state.years[y] && state.years[y][i]; if (!m) return null; const v = key ? m.days.reduce((x, d) => x + (d.act[key] || 0), 0) : monthTotal(m); return +(v / 1e6).toFixed(1); });

  // grafik harian: periode terpilih vs bulan lalu vs tahun lalu (like-for-like)
  function drawDaily(cid, key, mi, subId, entity) {
    kill(cid); const ytd = mi === "ytd"; let labels, ds = [];
    if (ytd) { labels = MONTH_SHORT.slice(); ds.push(lineDs(`${Y()}`, monthlyJt(Y(), key), BRAND, null, true)); if (state.years[BY()]) ds.push(lineDs(`${BY()}`, monthlyJt(BY(), key), "#9AA0B5", [5, 4])); if (subId) $(subId).textContent = `${entity} · omset per bulan ${Y()} vs ${BY()}`; }
    else { const n = daysIn(Y(), mi); labels = Array.from({ length: n }, (_, i) => String(i + 1)); const partial = isPartial(mi), N = partial ? lastDataDay(mi) : null;
      ds.push(lineDs(`${MONTH_SHORT[mi]} ${Y()}`, dailyJt(Y(), state.months[mi], key, N), BRAND, null, true));
      if (mi > 0 && state.months[mi - 1]) ds.push(lineDs(`${MONTH_SHORT[mi - 1]} ${Y()} (bulan lalu)`, dailyJt(Y(), state.months[mi - 1], key), TEAL, [6, 4]));
      if (state.baseMonths[mi]) ds.push(lineDs(`${MONTH_SHORT[mi]} ${BY()} (tahun lalu)`, dailyJt(BY(), state.baseMonths[mi], key), "#9AA0B5", [3, 3]));
      if (subId) $(subId).textContent = `${entity} · omset per tanggal${partial ? ` · data s/d tgl ${N}` : ""} · garis putus = pembanding`; }
    state.charts[cid] = new Chart($(cid), { type: "line", data: { labels, datasets: ds }, options: lineOpts(jt) });
  }
  // grafik bulanan: tahun ini vs tahun lalu + label YoY %
  function drawMonthly(cid, key, subId, entity) {
    kill(cid); const cur = monthlyJt(Y(), key), prev = state.years[BY()] ? monthlyJt(BY(), key) : Array(12).fill(null);
    const labels = MONTH_SHORT.map((m, i) => { if (cur[i] == null) return { text: "", color: "" }; const r = computeMonth(i, "yoy"); let g = null; if (r) { if (key) { const x = r.rows.find(q => q.key === key); g = x ? x.growth : null; } else g = r.totalGrowth; } return { text: g == null ? "" : fmtPct(g, 0) + (r && r.partial ? "*" : ""), color: g == null ? "#9AA0B5" : g >= .05 ? "#15803D" : g >= 0 ? "#B45309" : "#B91C1C" }; });
    state.charts[cid] = new Chart($(cid), { type: "bar", plugins: [growthLabels], data: { labels: MONTH_SHORT, datasets: [{ label: `${Y()}`, data: cur, backgroundColor: BRAND, hoverBackgroundColor: BRAND_2, borderRadius: 8, borderSkipped: false, barPercentage: .85, categoryPercentage: .62 }, { label: `${BY()}`, data: prev, backgroundColor: GHOST, hoverBackgroundColor: GHOST_2, borderRadius: 8, borderSkipped: false, barPercentage: .85, categoryPercentage: .62 }] }, options: { layout: { padding: { top: 22 } }, plugins: { growthLabels: { labels }, legend: { position: "bottom", labels: { usePointStyle: true, pointStyle: "circle", boxWidth: 8 } }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.raw == null ? "—" : jt(c.raw)}` } } }, scales: { x: gridX, y: { ...gridY, ticks: { callback: v => v.toLocaleString("id-ID") + " jt" } } } } });
    if (subId) $(subId).textContent = `${entity} · label = growth YoY (like-for-like utk bulan berjalan*)`;
  }

  // ---------- target harian & grafik "realisasi vs target" (satu pembanding, warna satu arti) ----------
  const dayTarget = (d, key) => key ? (d.tgt[key] || 0) : activeStores().reduce((x, s) => x + (d.tgt[s.key] || 0), 0);
  const targetJt = (y, m, key) => { if (!m) return null; const n = daysIn(y, m.idx), arr = Array(n).fill(null); m.days.forEach(d => { const t = dayTarget(d, key); arr[d.d - 1] = t > 0 ? +(t / 1e6).toFixed(1) : null; }); return arr; };
  const monthTargetJt = (y, key) => Array.from({ length: 12 }, (_, i) => { const m = state.years[y] && state.years[y][i]; if (!m) return null; const upTo = y === state.year && isPartialOf(state.years[y], i) ? lastDataDayOf(m) : null; const t = m.days.reduce((x, d) => x + (!upTo || d.d <= upTo ? dayTarget(d, key) : 0), 0); return t > 0 ? +(t / 1e6).toFixed(1) : null; });
  const BELOW = "#CFE3D7", TARGET_INK = "#0F6E44";
  const cmpName = { target: "Target", pm: "Bulan lalu", py: "Tahun lalu" };
  // batang realisasi + SATU garis pembanding (target / bulan lalu / tahun lalu)
  function drawRealisasi(cid, key, mi, cmp, subId, entity) {
    kill(cid); const ytd = mi === "ytd"; let labels, act, line, lineLabel, lineColor;
    if (ytd) { labels = MONTH_SHORT.slice(); act = monthlyJt(Y(), key); if (cmp === "py" && state.years[BY()]) { line = monthlyJt(BY(), key); lineLabel = `Omset ${BY()}`; lineColor = "#9AA0B5"; } else { line = monthTargetJt(Y(), key); lineLabel = "Target bulanan"; lineColor = TARGET_INK; cmp = "target"; } }
    else { const n = daysIn(Y(), mi); labels = Array.from({ length: n }, (_, i) => String(i + 1)); const partial = isPartial(mi), N = partial ? lastDataDay(mi) : null; act = dailyJt(Y(), state.months[mi], key, N);
      if (cmp === "pm" && mi > 0 && state.months[mi - 1]) { line = dailyJt(Y(), state.months[mi - 1], key); lineLabel = `Omset ${MONTH_SHORT[mi - 1]} ${Y()}`; lineColor = TEAL; }
      else if (cmp === "py" && state.baseMonths[mi]) { line = dailyJt(BY(), state.baseMonths[mi], key); lineLabel = `Omset ${MONTH_SHORT[mi]} ${BY()}`; lineColor = "#9AA0B5"; }
      else { line = targetJt(Y(), state.months[mi], key); lineLabel = "Target harian"; lineColor = TARGET_INK; cmp = "target"; } }
    const colors = act.map((v, i) => v == null ? BRAND : (line && line[i] != null && v < line[i]) ? BELOW : BRAND);
    const hit = act.filter((v, i) => v != null && line && line[i] != null && v >= line[i]).length, tot = act.filter((v, i) => v != null && line && line[i] != null).length;
    state.charts[cid] = new Chart($(cid), { type: "bar", data: { labels, datasets: [
      { type: "bar", label: "Realisasi", data: act, backgroundColor: colors, hoverBackgroundColor: BRAND_2, borderRadius: 6, borderSkipped: false, barPercentage: .7, categoryPercentage: .85, order: 2 },
      { type: "line", label: lineLabel, data: line, borderColor: lineColor, backgroundColor: lineColor, borderWidth: 2, borderDash: cmp === "target" ? [6, 4] : [], pointRadius: 0, pointHoverRadius: 4, tension: .3, spanGaps: true, order: 1 }] },
      options: { plugins: { legend: { display: false }, tooltip: { callbacks: { title: i => (ytd ? "" : "Tgl ") + i[0].label, label: c => `${c.dataset.label}: ${c.raw == null ? "—" : jt(c.raw)}`, afterBody: i => { const a = act[i[0].dataIndex], l = line && line[i[0].dataIndex]; return a != null && l ? [`${a >= l ? "Di atas" : "Di bawah"} ${lineLabel.toLowerCase()} (${(a / l * 100).toFixed(0)}%)`] : []; } } } }, scales: { x: gridX, y: { ...gridY, ticks: { callback: v => v.toLocaleString("id-ID") + " jt" } } } } });
    if (subId) $(subId).textContent = `${entity} · ${ytd ? "per bulan " + Y() : MONTH_SHORT[mi] + " " + Y() + " per tanggal"} · pembanding: ${lineLabel.toLowerCase()}${cmp === "target" && tot ? ` · ${hit} dari ${tot} ${ytd ? "bulan" : "hari"} mencapai target` : ""}`;
    return { hit, tot, cmp };
  }
  // batang realisasi bulanan + garis target bulanan, label = pencapaian % (atau YoY % bila pembanding tahun lalu)
  function drawBulanan(cid, key, cmp, subId, entity) {
    kill(cid); const act = monthlyJt(Y(), key); let line, lineLabel, lineColor, labels;
    if (cmp === "py" && state.years[BY()]) { line = monthlyJt(BY(), key); lineLabel = `Omset ${BY()}`; lineColor = "#9AA0B5"; labels = act.map((a, i) => a == null || line[i] == null ? { text: "", color: "" } : { text: fmtPct(a / line[i] - 1, 0), color: a >= line[i] ? "#15803D" : "#B91C1C" }); }
    else { line = monthTargetJt(Y(), key); lineLabel = "Target bulanan"; lineColor = TARGET_INK; cmp = "target"; labels = act.map((a, i) => a == null || !line[i] ? { text: "", color: "" } : { text: (a / line[i] * 100).toFixed(0) + "%" + (isPartial(i) ? "*" : ""), color: a >= line[i] ? "#15803D" : "#B91C1C" }); }
    const colors = act.map((v, i) => v == null ? BRAND : line[i] != null && v < line[i] ? BELOW : BRAND);
    state.charts[cid] = new Chart($(cid), { type: "bar", plugins: [growthLabels], data: { labels: MONTH_SHORT, datasets: [
      { type: "bar", label: "Realisasi", data: act, backgroundColor: colors, hoverBackgroundColor: BRAND_2, borderRadius: 8, borderSkipped: false, barPercentage: .7, categoryPercentage: .8, order: 2 },
      { type: "line", label: lineLabel, data: line, borderColor: lineColor, backgroundColor: lineColor, borderWidth: 2, borderDash: cmp === "target" ? [6, 4] : [], pointRadius: 3, tension: .3, spanGaps: true, order: 1 }] },
      options: { layout: { padding: { top: 22 } }, plugins: { growthLabels: { labels }, legend: { display: false }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.raw == null ? "—" : jt(c.raw)}` } } }, scales: { x: gridX, y: { ...gridY, ticks: { callback: v => v.toLocaleString("id-ID") + " jt" } } } } });
    if (subId) $(subId).textContent = `${entity} · ${Y()} · label = ${cmp === "target" ? "pencapaian target" : "growth vs " + BY()} · * bulan berjalan: target dihitung s/d hari terakhir berdata`;
  }
  const legendHTML = (cmp) => `<span><i class="dot brand"></i>Realisasi mencapai ${cmp === "target" ? "target" : "pembanding"}</span><span><i class="dot below"></i>Di bawah</span><span><i class="dash ${cmp === "target" ? "ink" : cmp === "pm" ? "teal" : "grey"}"></i>${cmpName[cmp]}</span>`;

  // ---------- rentang tanggal (Ringkasan Eksekutif) ----------
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const fmtRange = (a, b) => a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear() ? `${a.getDate()}–${b.getDate()} ${MONTH_SHORT[a.getMonth()]} ${a.getFullYear()}` : `${a.getDate()} ${MONTH_SHORT[a.getMonth()]}${a.getFullYear() !== b.getFullYear() ? " " + a.getFullYear() : ""} – ${b.getDate()} ${MONTH_SHORT[b.getMonth()]} ${b.getFullYear()}`;
  // hari-hari dalam rentang [a,b]: {date, dow, v (omset), t (target), has (ada data)}
  function rangeDays(a, b, key) {
    const out = []; for (let d = new Date(a); d <= b; d = addDays(d, 1)) { const ys = state.years[d.getFullYear()]; const m = ys && ys[d.getMonth()]; const day = m && m.days.find(x => x.d === d.getDate()); const v = day ? (key ? (day.act[key] || 0) : dayTotal(day)) : 0; const has = !!day && (key ? day.act[key] != null && v > 0 : (v > 0 || Object.values(day.act).some(x => x > 0))); out.push({ date: new Date(d), dow: d.getDay(), v: has ? v : null, t: day ? dayTarget(day, key) : 0, has }); }
    return out;
  }
  const sumRange = (days) => { const wd = days.filter(o => o.has); const total = wd.reduce((x, o) => x + o.v, 0); return { days, total, nDays: wd.length, avg: wd.length ? total / wd.length : null, target: days.filter(o => o.has).reduce((x, o) => x + o.t, 0), targetAll: days.reduce((x, o) => x + o.t, 0), ...bestWorst(wd.map(o => ({ v: o.v, dow: o.dow, date: o.date }))) }; };
  function computeExecRange(a, b, key) {
    const cur = sumRange(rangeDays(a, b, key)); if (!cur.nDays) return null;
    const len = Math.round((b - a) / 864e5) + 1; const pa = addDays(a, -len), pb = addDays(a, -1); const prev = sumRange(rangeDays(pa, pb, key));
    const la = new Date(a.getFullYear() - 1, a.getMonth(), a.getDate()), lb = new Date(b.getFullYear() - 1, b.getMonth(), b.getDate()); const last = sumRange(rangeDays(la, lb, key));
    // pembanding like-for-like: hanya hari yang ada datanya di periode ini
    const pattern = dayPattern(cur.days.filter(o => o.has).map(o => ({ v: o.v, dow: o.dow, store: {} })));
    return { a, b, cur, prev: prev.nDays ? { ...prev, a: pa, b: pb } : null, last: last.nDays ? { ...last, a: la, b: lb } : null, mom: prev.nDays ? cur.total / prev.total - 1 : null, yoy: last.nDays ? cur.total / last.total - 1 : null, ach: cur.target ? cur.total / cur.target : null, pattern };
  }
  // hero: badge status, kotak fakta, bar progres dengan penanda waktu berjalan
  const achCls = (a) => a == null ? "" : a >= 1 ? "good" : a * 100 >= ((C.ALERTS || {}).achWarn ?? 80) ? "warn" : "bad";
  function renderHeroFacts(o) {
    // o: { ach, tgtNow, actual, fullT, remDays, timePct, progPct, unitLabel, partialTxt, hasTarget }
    const badge = $("exHeroBadge"); badge.className = "hero-badge " + achCls(o.ach); badge.textContent = o.ach == null ? "target belum diisi" : `${(o.ach * 100).toFixed(0)}% dari target`;
    const gap = o.hasTarget ? o.tgtNow - o.actual : null; const fullGap = o.fullT ? o.fullT - o.actual : null; const need = o.remDays > 0 && fullGap > 0 ? fullGap / o.remDays : null;
    const f = (l, v, sub, cl) => `<div class="hf ${cl || ""}"><span>${l}</span><b>${v}</b>${sub ? `<small>${sub}</small>` : ""}</div>`;
    $("exHeroFacts").innerHTML = !o.hasTarget ? "" : [
      f(`Target ${o.partialTxt || o.unitLabel}`, fmtRpS(o.tgtNow), o.fullT && o.fullT !== o.tgtNow ? `target ${o.unitLabel} ${fmtRpS(o.fullT)}` : ""),
      gap > 0 ? f("Kekurangan", fmtRpS(gap), o.partialTxt ? "dari target s/d hari ini" : "belum tercapai", "bad") : f("Lebih dari target", "+" + fmtRpS(-gap), o.partialTxt ? "di atas target s/d hari ini" : "target terlampaui", "good"),
      need != null ? f(`Butuh per hari`, fmtRpS(need), `${o.remDays} hari tersisa agar target ${o.unitLabel} tercapai`, need > (o.avg || 0) * 1.3 ? "bad" : "") : o.remDays > 0 ? f("Sisa hari", `${o.remDays} hari`, "target sudah terlampaui", "good") : f("Rata-rata/hari", fmtRpS(o.avg), `${o.nDays} hari berdata`),
    ].join("");
    const bar = $("exProgBar"); bar.style.width = (Math.min(1, o.progPct) * 100).toFixed(1) + "%"; bar.className = o.ach == null ? "" : o.ach < .8 ? "bad" : o.ach < 1 ? "low" : "";
    const tm = $("exProgTime"); if (o.timePct != null && o.timePct < 1) { tm.classList.remove("hidden"); tm.style.left = (o.timePct * 100).toFixed(1) + "%"; } else tm.classList.add("hidden");
    $("exProgLbl").innerHTML = o.hasTarget ? `<span>Progres target ${o.unitLabel}</span><span>${(o.progPct * 100).toFixed(0)}%${o.timePct != null && o.timePct < 1 ? ` · garis putih = waktu berjalan ${(o.timePct * 100).toFixed(0)}%` : ""}</span>` : "";
    $("exProgTxt").innerHTML = !o.hasTarget ? "Target belum diisi di sheet (kolom TARGET di samping kolom outlet)." : o.timePct != null && o.timePct < 1 ? (o.progPct >= o.timePct ? `Realisasi <b>di depan</b> jadwal: ${(o.progPct * 100).toFixed(0)}% target sudah masuk pada ${(o.timePct * 100).toFixed(0)}% waktu.` : `Realisasi <b>tertinggal</b> dari jadwal: baru ${(o.progPct * 100).toFixed(0)}% target pada ${(o.timePct * 100).toFixed(0)}% waktu${need != null ? `, perlu ${fmtRpS(need)}/hari (rata-rata sekarang ${fmtRpS(o.avg)}/hari)` : ""}.`) : o.ach >= 1 ? `Target ${o.unitLabel} <b>tercapai</b> ${(o.ach * 100).toFixed(0)}%.` : `Target ${o.unitLabel} <b>tidak tercapai</b>: ${(o.ach * 100).toFixed(0)}% dari ${fmtRpS(o.tgtNow)}.`;
  }
  function renderExecRange(R, key, ent) {
    const c = R.cur, name = fmtRange(R.a, R.b);
    $("exHeroLabel").textContent = `Realisasi omset ${key ? ent + " · " : ""}${name}`; $("exHeroVal").textContent = fmtRpS(c.total);
    $("exHeroSub").textContent = `${fmtRp(c.total)} · rata-rata ${fmtRpS(c.avg)} per hari (${c.nDays} dari ${c.days.length} hari berdata)`;
    const remR = c.days.length - c.nDays, partialR = c.nDays < c.days.length && R.b >= new Date(new Date().setHours(0, 0, 0, 0) - 864e5);
    renderHeroFacts({ ach: R.ach, tgtNow: c.target, actual: c.total, fullT: c.targetAll, remDays: partialR ? remR : 0, timePct: partialR ? c.nDays / c.days.length : null, progPct: c.targetAll ? c.total / c.targetAll : 0, unitLabel: "rentang", partialTxt: partialR ? "s/d hari berdata" : "", hasTarget: !!c.target, avg: c.avg, nDays: c.nDays });
    const tile = (l, v, p, s, cl) => `<div class="tile ${cl || ""}"><div class="t-label">${l}</div><div class="t-row"><div class="t-val">${v}</div>${p || ""}</div><div class="t-sub">${s}</div></div>`;
    $("exTiles").innerHTML = [
      tile("Dibanding periode sebelumnya", fmtPct(R.mom), "", R.prev ? `${fmtRpS(c.total)} vs ${fmtRpS(R.prev.total)} (${fmtRange(R.prev.a, R.prev.b)})` : "data periode sebelumnya belum ada", R.mom == null ? "" : R.mom >= 0 ? "up" : "down"),
      tile("Dibanding tahun lalu", fmtPct(R.yoy), "", R.last ? `${fmtRpS(c.total)} vs ${fmtRpS(R.last.total)} (${fmtRange(R.last.a, R.last.b)})` : `data ${R.a.getFullYear() - 1} belum ada`, R.yoy == null ? "" : R.yoy >= 0 ? "up" : "down"),
      tile("Hari terbaik", c.best ? fmtRpS(c.best.v) : "—", c.best ? `<span class="pill good">${DOW[c.best.dow]}</span>` : "", c.best ? `${c.best.date.getDate()} ${MONTH_SHORT[c.best.date.getMonth()]} ${c.best.date.getFullYear()}` : ""),
      tile("Hari terlemah", c.worst ? fmtRpS(c.worst.v) : "—", c.worst ? `<span class="pill bad">${DOW[c.worst.dow]}</span>` : "", c.worst ? `${c.worst.date.getDate()} ${MONTH_SHORT[c.worst.date.getMonth()]} ${c.worst.date.getFullYear()}` : ""),
    ].join("");
    // grafik harian: batang per tanggal dalam rentang + garis target
    kill("chartExDaily"); const labels = c.days.map(o => `${o.date.getDate()} ${MONTH_SHORT[o.date.getMonth()]}`); const act = c.days.map(o => o.has ? +(o.v / 1e6).toFixed(1) : null), line = c.days.map(o => o.t > 0 ? +(o.t / 1e6).toFixed(1) : null);
    const hit = c.days.filter(o => o.has && o.t > 0 && o.v >= o.t).length, tot = c.days.filter(o => o.has && o.t > 0).length;
    state.charts.chartExDaily = new Chart($("chartExDaily"), { type: "bar", data: { labels, datasets: [
      { type: "bar", label: "Realisasi", data: act, backgroundColor: act.map((v, i) => v != null && line[i] != null && v < line[i] ? BELOW : BRAND), hoverBackgroundColor: BRAND_2, borderRadius: 6, borderSkipped: false, barPercentage: .7, categoryPercentage: .85, order: 2 },
      { type: "line", label: "Target harian", data: line, borderColor: TARGET_INK, backgroundColor: TARGET_INK, borderWidth: 2, borderDash: [6, 4], pointRadius: 0, pointHoverRadius: 4, tension: .3, spanGaps: true, order: 1 }] },
      options: { plugins: { legend: { display: false }, tooltip: { callbacks: { title: i => `${labels[i[0].dataIndex]} (${DOW[c.days[i[0].dataIndex].dow]})`, label: cc => `${cc.dataset.label}: ${cc.raw == null ? "—" : jt(cc.raw)}` } } }, scales: { x: { ...gridX, ticks: { maxTicksLimit: 16 } }, y: { ...gridY, ticks: { callback: v => v.toLocaleString("id-ID") + " jt" } } } } });
    $("exDailySub").textContent = `${ent} · ${name} per tanggal · pembanding: target harian${tot ? ` · ${hit} dari ${tot} hari mencapai target` : ""}`; $("exDailyLegend").innerHTML = legendHTML("target");
    $("exDailyHow").textContent = "Setiap batang = omset satu hari dalam rentang; garis putus-putus = target hari itu. Batang hijau pucat berarti hari itu di bawah target. Tanggal tanpa batang = belum ada data.";
    drawBulanan("chartExMonthly", key, "target", "exMonthlySub", ent); $("exMonthlyLegend").innerHTML = legendHTML("target");
    let AL = computeAlerts(state.month); if (key) AL = AL.filter(x => x.who === ent); const cnt = { crit: 0, warn: 0, info: 0 }; AL.forEach(x => cnt[x.sev]++); $("exAlertSum").textContent = (AL.length ? `${cnt.crit} kritis · ${cnt.warn} peringatan` : "tidak ada") + ` · berdasarkan ${periodName(state.month)}${key ? " · " + ent : ""}`;
    $("exAlertList").innerHTML = AL.slice(0, 5).map(x => `<div class="al al-${x.sev}"><span class="al-sev">${SEV[x.sev]}</span><div><b>${x.title}</b></div></div>`).join("") || `<div class="muted">Semua outlet dalam batas normal.</div>`;
    const IN = computeInsights(state.month).slice(0, 3); $("exInsightList").innerHTML = IN.map(i => `<div class="ins ins-${i.tone}"><b>${i.title}</b><p>${i.rec}</p></div>`).join("") || `<div class="muted">Belum ada insight.</div>`;
  }
  function setRange(a, b) {
    if (!a || !b || isNaN(a) || isNaN(b)) return clearRange();
    if (a > b) [a, b] = [b, a]; state.range = { a, b }; $("rangeFrom").value = iso(a); $("rangeTo").value = iso(b); $("rangePill").classList.add("on"); $("rangePill").classList.remove("hidden"); if ($("selMonth").querySelector('option[value="range"]')) $("selMonth").value = "range"; if (state.months.length) render();
  }
  function clearRange() { state.range = null; $("rangeFrom").value = ""; $("rangeTo").value = ""; $("rangePill").classList.remove("on"); $("rangePill").classList.add("hidden"); if (state.months.length) render(); }
  const latestDate = () => { const li = latestIdx(); return li < 0 ? new Date() : new Date(Y(), li, lastDataDay(li)); };
  function quickRange(v) {
    const end = latestDate(); let a;
    if (v === "week") { a = addDays(end, -((end.getDay() + 6) % 7)); } else if (v === "month") { a = new Date(end.getFullYear(), end.getMonth(), 1); } else if (v === "ytd") { a = new Date(end.getFullYear(), 0, 1); } else { const n = +v; if (!n) return; a = addDays(end, -(n - 1)); }
    setRange(a, end);
  }
  // ---------- 1. Ringkasan Eksekutif (versi ringkas) ----------
  const execEntity = () => state.execKey ? ((C.STORES.find(s => s.key === state.execKey) || {}).label || state.execKey) : "Perusahaan";
  function buildExecChips() {
    const sel = $("selStore"); const stores = activeStores().filter(s => state.months.some(m => m && m.days.some(d => d.act[s.key] != null)));
    if (state.execKey && !stores.some(s => s.key === state.execKey)) state.execKey = null;
    if (sel.dataset.year !== String(state.year) || sel.options.length !== stores.length + 1) { sel.innerHTML = ""; sel.dataset.year = String(state.year); const o0 = document.createElement("option"); o0.value = ""; o0.textContent = "Semua outlet (perusahaan)"; sel.appendChild(o0); stores.forEach(s => { const o = document.createElement("option"); o.value = s.key; o.textContent = s.label; sel.appendChild(o); }); }
    sel.value = state.execKey || "";
  }
  // tile kunjungan di Ringkasan Eksekutif: basket size, frekuensi transaksi, konversi (periode/rentang & outlet terpilih)
  function renderExecVisitTiles(key, ent) {
    const mi = state.month, rng = state.range;
    const get = (mode) => { const R = rng ? computeVisitsRange(rng.a, rng.b, mode) : mi === "ytd" ? computeVisitsYTD() : computeVisits(mi, mode); if (!R) return null; if (!key) return { cur: R.total, cmp: R.totalCmp, g: R.g || {} }; const r = R.rows.find(x => x.key === key); return r && r.cur ? { cur: r.cur, cmp: r.cmp, g: r.g || {} } : null; };
    const Y1 = get("yoy"), M1 = get("mom"); const V = Y1 || M1;
    const box = $("exTiles2"); if (!V) { box.innerHTML = ""; box.classList.add("hidden"); return; } box.classList.remove("hidden");
    const c = V.cur, gy = Y1 ? Y1.g : {}, gm = M1 ? M1.g : {}, cy = Y1 && Y1.cmp, cm = M1 && M1.cmp;
    const tile = (l, v, p, s) => `<div class="tile"><div class="t-label">${l}</div><div class="t-row"><div class="t-val">${v}</div>${p || ""}</div><div class="t-sub">${s}</div></div>`;
    const cmpTxt = (fy, fm) => [cy ? `tahun lalu ${fy(cy)}` : null, cm ? `bulan lalu ${fm(cm)}` : null].filter(Boolean).join(" · ") || "tanpa pembanding";
    box.innerHTML = [
      tile("Basket size (omset ÷ transaksi)", fmtRb(c.basket), pillG(gy.basket), `${cmpTxt(x => fmtRb(x.basket), x => fmtRb(x.basket))}${cm && gm.basket != null ? ` (${fmtPct(gm.basket)})` : ""}`),
      tile("Frekuensi transaksi", fmtN(c.belanja), pillG(gy.belanja), `${fmtN(c.datang)} kunjungan · ${c.nDays ? fmtN(c.belanja / c.nDays) + " transaksi/hari" : ""}${cm && gm.belanja != null ? ` · bulan lalu ${fmtPct(gm.belanja)}` : ""}`),
      tile("Konversi (belanja ÷ datang)", fmtPct(c.konversi).replace("+", ""), pillPts(gy.konversi), `${cmpTxt(x => fmtPct(x.konversi).replace("+", ""), x => fmtPct(x.konversi).replace("+", ""))}${cm && gm.konversi != null ? ` (${fmtPts(gm.konversi)})` : ""}`),
    ].join("");
  }
  // ---------- papan target per outlet (Ringkasan): semua outlet vs target periode terpilih, tanpa memilih outlet ----------
  function computeTargetBoard() {
    const A = { achWarn: 80, achCrit: 60, ...(C.ALERTS || {}) }; const mi = state.month, ytd = mi === "ytd", rng = state.range; const rows = [];
    let pName, partial = false, remDays = 0, N = null;
    if (rng) {
      pName = fmtRange(rng.a, rng.b);
      for (const s of activeStores()) { const c = sumRange(rangeDays(rng.a, rng.b, s.key)); if (!c.nDays && !c.targetAll) continue; rows.push({ key: s.key, label: s.label, actual: c.total, target: c.target, fullTarget: c.targetAll, nDays: c.nDays }); }
    } else {
      const R = ytd ? computeYTD("yoy") : computeMonth(mi, "yoy"); if (!R) return null; pName = periodName(mi);
      const idxs = ytd ? state.months.map((m, i) => m ? i : -1).filter(i => i >= 0) : [mi]; const last = idxs[idxs.length - 1];
      partial = !ytd && R.partial; N = partial ? R.N : null; remDays = partial ? daysIn(Y(), mi) - N : 0;
      for (const r of R.rows) { if (r.excluded) continue; const full = idxs.reduce((x, i) => x + (state.months[i] ? state.months[i].days.reduce((y, d) => y + (d.tgt[r.key] || 0), 0) : 0), 0); if (r.actual == null && !full) continue; rows.push({ key: r.key, label: r.label, actual: r.actual || 0, target: r.target || 0, fullTarget: full, nDays: null }); }
      void last;
    }
    for (const r of rows) {
      r.ach = r.target ? r.actual / r.target : null;               // pencapaian vs target s/d hari berdata (like-for-like)
      r.gap = r.target ? r.target - r.actual : null;                // kekurangan terhadap target s/d hari berdata
      r.gapFull = r.fullTarget ? r.fullTarget - r.actual : null;    // kekurangan terhadap target periode penuh
      r.needPerDay = partial && remDays > 0 && r.gapFull > 0 ? r.gapFull / remDays : null;
      r.status = r.ach == null ? "na" : r.ach >= 1 ? "ok" : r.ach * 100 >= A.achWarn ? "warn" : "bad";
    }
    const order = { bad: 0, warn: 1, ok: 2, na: 3 };
    rows.sort((a, b) => order[a.status] - order[b.status] || (a.ach ?? 9) - (b.ach ?? 9) || b.actual - a.actual);
    const withT = rows.filter(r => r.ach != null), below = withT.filter(r => r.ach < 1);
    return { rows, pName, partial, N, remDays, nTarget: withT.length, nBelow: below.length, gapBelow: below.reduce((x, r) => x + r.gap, 0), gapFullBelow: below.reduce((x, r) => x + (r.gapFull > 0 ? r.gapFull : 0), 0) };
  }
  // ---------- Kirim ke WhatsApp: ringkasan pencapaian target per outlet ----------
  const waRp = (v) => v == null ? "-" : fmtRpS(v).replace(/ /g, " ");
  const waFull = (v) => v == null ? "-" : "Rp " + Math.round(v).toLocaleString("id-ID");
  const waIco = (st) => st === "ok" ? "🟢" : st === "warn" ? "🟠" : st === "bad" ? "🔴" : "⚪";
  function buildWaMessage(compact) {
    const B = computeTargetBoard(); if (!B || !B.rows.length) return null;
    const E = state.range ? computeExecRange(state.range.a, state.range.b, null) : computeExec(state.month, null);
    const org = (C.OWNER && C.OWNER.org) || "Perusahaan"; const A = C.ALERTS || {}; const warnAt = A.achWarn ?? 80;
    const ytd = !state.range && state.month === "ytd"; const mi = state.range ? null : state.month;
    const totalDays = B.partial ? B.N + B.remDays : null;
    const periode = state.range ? `Periode: ${fmtRange(state.range.a, state.range.b)}` : ytd ? `Periode: Januari–${MONTH_NAMES[E && E.cur ? E.cur.last : 0].toLowerCase().replace(/^./, c => c.toUpperCase())} ${Y()} (year to date)` : `Periode: ${MONTH_NAMES[mi].toLowerCase().replace(/^./, c => c.toUpperCase())} ${Y()}${B.partial ? `, data sampai tanggal ${B.N} (hari ke-${B.N} dari ${totalDays})` : " (bulan penuh)"}`;
    const below = B.rows.filter(r => r.status === "bad" || r.status === "warn"), ok = B.rows.filter(r => r.status === "ok"), na = B.rows.filter(r => r.status === "na");
    const L = [];
    L.push(compact ? `📊 *PENCAPAIAN TARGET OUTLET*` : `📊 *LAPORAN PENCAPAIAN TARGET OUTLET*`); L.push(org); L.push(periode); L.push("");
    // ---- ringkasan perusahaan ----
    if (E && E.cur) {
      const tot = E.cur.total, tgt = state.range ? E.cur.target : E.tgtTotal, ach = E.ach; const fullT = state.range ? E.cur.targetAll : (E.cur.idxs || []).reduce((x, i) => x + (state.months[i] ? state.months[i].days.reduce((y, d) => y + dayTarget(d, null), 0) : 0), 0);
      const st = ach == null ? "na" : ach >= 1 ? "ok" : ach * 100 >= warnAt ? "warn" : "bad";
      if (compact) {
        L.push(`${waIco(st)} *Total ${org}*: ${waRp(tot)}${tgt ? ` dari target ${waRp(tgt)} (${(ach * 100).toFixed(0)}%)` : ""}${tgt && tot < tgt ? ` · kurang ${waRp(tgt - tot)}` : tgt ? ` · lebih ${waRp(tot - tgt)}` : ""}`);
        if (B.partial && B.remDays > 0 && fullT > tot) L.push(`⏱ Sisa ${B.remDays} hari · perlu ${waRp((fullT - tot) / B.remDays)}/hari untuk target bulan ${waRp(fullT)}`);
      } else {
        L.push(`*RINGKASAN ${org.toUpperCase()}*`);
        L.push(`• Omset sampai ${B.partial ? "hari ini" : "akhir periode"}: ${waFull(tot)}`);
        if (tgt) { L.push(`• Target sampai ${B.partial ? "hari ini" : "akhir periode"}: ${waFull(tgt)}`); L.push(`• Pencapaian: *${(ach * 100).toFixed(0)}%* ${tot < tgt ? `(kurang ${waFull(tgt - tot)})` : `(lebih ${waFull(tot - tgt)})`}`); }
        if (fullT && fullT !== tgt) L.push(`• Target ${ytd ? "periode" : "bulan"} penuh: ${waFull(fullT)}`);
        if (B.partial && B.remDays > 0) { const gapF = fullT - tot; L.push(gapF > 0 ? `• Sisa ${B.remDays} hari. Perlu *${waFull(gapF / B.remDays)} per hari* supaya target bulan tercapai (rata-rata saat ini ${waFull(E.cur.avg)} per hari)` : `• Sisa ${B.remDays} hari. Target bulan sudah terlampaui`); const tp = B.N / totalDays, pp = fullT ? tot / fullT : null; if (pp != null) L.push(`• Status: ${waIco(st)} ${pp >= tp ? "di depan jadwal" : "tertinggal dari jadwal"} (${(pp * 100).toFixed(0)}% target terkumpul pada ${(tp * 100).toFixed(0)}% waktu)`); }
        else if (tgt) L.push(`• Status: ${waIco(st)} ${ach >= 1 ? "target tercapai" : "target tidak tercapai"}`);
      }
      L.push("");
    }
    // ---- per outlet ----
    const block = (r, i) => {
      if (compact) { const base = `${i}. ${waIco(r.status)} *${r.label}* ${r.ach == null ? "" : (r.ach * 100).toFixed(0) + "%"}`; if (r.ach == null) return `${base}${waRp(r.actual)} (target belum diisi)`; return r.ach >= 1 ? `${base} · ${waRp(r.actual)} / ${waRp(r.target)} · lebih ${waRp(r.actual - r.target)}` : `${base} · ${waRp(r.actual)} / ${waRp(r.target)} · kurang ${waRp(r.gap)}${r.needPerDay ? ` · perlu ${waRp(r.needPerDay)}/hari` : ""}`; }
      const o = [`${i}. ${waIco(r.status)} *${r.label}* — ${r.ach == null ? "tanpa target" : (r.ach * 100).toFixed(0) + "%"}`];
      o.push(`   Omset: ${waFull(r.actual)}`);
      if (r.ach != null) { o.push(`   Target${B.partial ? " s/d hari ini" : ""}: ${waFull(r.target)}`); if (r.ach >= 1) o.push(`   Lebih dari target: ${waFull(r.actual - r.target)} 👍`); else { o.push(`   Kekurangan: *${waFull(r.gap)}*`); if (r.needPerDay) o.push(`   Perlu: ${waFull(r.needPerDay)} per hari selama ${B.remDays} hari tersisa`); } }
      else o.push(`   Target belum diisi di sheet`);
      return o.join("\n");
    };
    if (below.length) { L.push(`*OUTLET BELUM MENCAPAI TARGET (${below.length} dari ${B.nTarget})*`); if (!compact) L.push(`Urutan dari yang paling tertinggal.`); below.forEach((r, i) => { L.push(block(r, i + 1)); if (!compact) L.push(""); }); if (compact) L.push(""); }
    if (ok.length) { L.push(`*OUTLET SUDAH MENCAPAI TARGET (${ok.length} dari ${B.nTarget})*`); ok.forEach((r, i) => { L.push(block(r, i + 1)); if (!compact) L.push(""); }); if (compact) L.push(""); }
    if (na.length) { L.push(`*OUTLET TANPA TARGET (${na.length})*`); na.forEach(r => L.push(`• ${r.label}: omset ${compact ? waRp(r.actual) : waFull(r.actual)}, target belum diisi di sheet`)); L.push(""); }
    L.push(...waSalesLines(compact ? "compact" : "detail"));
    // ---- fokus ----
    const top = below.slice().sort((a, b) => b.gap - a.gap)[0];
    if (top) { L.push(`🎯 *FOKUS UTAMA*`); L.push(compact ? `${top.label}: kekurangan terbesar ${waRp(top.gap)} (${(top.gap / B.gapBelow * 100).toFixed(0)}% dari total kekurangan ${waRp(B.gapBelow)})` : `${top.label} menyumbang kekurangan terbesar, ${waFull(top.gap)} atau ${(top.gap / B.gapBelow * 100).toFixed(0)}% dari total kekurangan semua outlet (${waFull(B.gapBelow)}). Menutup gap di outlet ini paling besar pengaruhnya ke total ${org}.`); }
    else if (B.nTarget) L.push(`🎉 Semua outlet mencapai target. Pertahankan!`);
    L.push("");
    if (!compact) { L.push(`*CARA MEMBACA*`); L.push(`• Persen = omset dibagi target${B.partial ? " sampai tanggal yang sama, jadi adil walaupun bulan belum selesai" : ""}.`); L.push(`• 🔴 di bawah ${warnAt}% · 🟠 ${warnAt}–99% · 🟢 100% ke atas.`); if (B.partial) L.push(`• "Perlu per hari" = kekurangan ke target bulan penuh dibagi sisa hari.`); L.push(""); }
    L.push(`Dashboard lengkap: ${location.origin}${location.pathname}`);
    return L.join("\n");
  }
  function buildWaPercent() {
    const B = computeTargetBoard(); if (!B || !B.rows.length) return null;
    const E = state.range ? computeExecRange(state.range.a, state.range.b, null) : computeExec(state.month, null);
    const org = (C.OWNER && C.OWNER.org) || "Perusahaan"; const warnAt = (C.ALERTS || {}).achWarn ?? 80;
    const ytd = !state.range && state.month === "ytd"; const mi = state.range ? null : state.month; const totalDays = B.partial ? B.N + B.remDays : null;
    const bulan = ytd ? "periode" : "bulan";
    const periode = state.range ? fmtRange(state.range.a, state.range.b) : ytd ? `Januari–${MONTH_SHORT[E && E.cur ? E.cur.last : 0]} ${Y()} (YTD)` : `${MONTH_NAMES[mi].toLowerCase().replace(/^./, c => c.toUpperCase())} ${Y()}${B.partial ? `, data sampai tanggal ${B.N}` : " (bulan penuh)"}`;
    const below = B.rows.filter(r => r.status === "bad" || r.status === "warn"), ok = B.rows.filter(r => r.status === "ok"), na = B.rows.filter(r => r.status === "na");
    const x = (v) => v.toLocaleString("id-ID", { maximumFractionDigits: 1 });
    const L = [`📊 *PENCAPAIAN TARGET OUTLET*`, `${org} · ${periode}`, ""];
    if (B.partial) L.push(`⏱ Waktu berjalan: hari ke-${B.N} dari ${totalDays} (${(B.N / totalDays * 100).toFixed(0)}% ${bulan} sudah lewat).`);
    if (E && E.ach != null) { const st = E.ach >= 1 ? "ok" : E.ach * 100 >= warnAt ? "warn" : "bad"; L.push(`🏢 Pencapaian ${org} keseluruhan: ${waIco(st)} *${(E.ach * 100).toFixed(0)}%* dari target${B.partial ? " sampai hari ini" : ""}.`); }
    L.push("");
    L.push(`*Cara membaca:* angka % = seberapa besar target${B.partial ? " sampai hari ini" : ""} yang sudah tercapai. 100% berarti tepat sesuai target.`);
    L.push(`🔴 di bawah ${warnAt}% = jauh tertinggal · 🟠 ${warnAt}–99% = hampir tercapai · 🟢 100% ke atas = tercapai`);
    L.push("");
    const perDay = (r) => { if (!B.partial || !r.needPerDay || !r.actual || !B.N) return ""; const avg = r.actual / B.N; const k = r.needPerDay / avg; return k <= 1.05 ? ` Dengan ritme sekarang target ${bulan} masih bisa terkejar, jaga konsistensi.` : ` Untuk mengejar target ${bulan}, omset harian ${B.remDays} hari ke depan harus sekitar *${x(k)}×* rata-rata harian sekarang${k >= 2 ? " (butuh usaha ekstra)" : ""}.`; };
    const blk = (r, i) => { const pct = r.ach * 100; if (r.ach >= 1) return `${i}. ${waIco(r.status)} *${r.label}* — ${pct.toFixed(0)}%\n   Sudah ${(pct - 100).toFixed(0)}% di atas target${B.partial ? " sampai hari ini" : ""}. Pertahankan ritme sampai akhir ${bulan}. 👏`; return `${i}. ${waIco(r.status)} *${r.label}* — ${pct.toFixed(0)}%\n   Baru ${pct.toFixed(0)}% dari target${B.partial ? " sampai hari ini" : ""}, masih kurang ${(100 - pct).toFixed(0)}%.${perDay(r)}`; };
    if (below.length) { L.push(`*BELUM MENCAPAI TARGET (${below.length} outlet)*`); L.push(`Urutan dari yang paling tertinggal.`); below.forEach((r, i) => { L.push(blk(r, i + 1)); L.push(""); }); }
    if (ok.length) { L.push(`*SUDAH MENCAPAI TARGET (${ok.length} outlet)* 👏`); ok.forEach((r, i) => { L.push(blk(r, i + 1)); L.push(""); }); }
    if (na.length) { na.forEach(r => L.push(`⚪ *${r.label}* — target belum diisi di sistem, mohon hubungi admin agar pencapaiannya bisa dihitung.`)); L.push(""); }
    L.push(...waSalesLines("pct"));
    if (B.partial && B.remDays > 0) L.push(below.length ? `⏱ Sisa *${B.remDays} hari*. Setiap hari tanpa kejar-target membuat gap makin besar. Fokus harian: tambah kunjungan, follow-up pelanggan, dan closing. 💪` : `⏱ Sisa *${B.remDays} hari*. Semua outlet sudah di jalur target, pertahankan sampai akhir ${bulan}! 💪`);
    else L.push(below.length ? `Periode sudah berakhir. Outlet yang belum tercapai: evaluasi penyebabnya dan susun rencana kejar untuk ${bulan} berikutnya.` : `Periode sudah berakhir dengan semua outlet mencapai target. Kerja bagus! 👏`);
    return L.join("\n");
  }
  function waFill() { const m = state.waMode || "detail"; const msg = m === "pct" ? buildWaPercent() : buildWaMessage(m === "compact"); if (!msg) return false; $("waText").value = msg; $("waStatus").textContent = `${msg.length} karakter · pesan bisa diedit sebelum dikirim`; $("waText").scrollTop = 0; document.querySelectorAll("#waMode button").forEach(b => b.classList.toggle("on", b.dataset.m === m)); $("waHint").textContent = m === "pct" ? "Untuk Grup Leader: pencapaian per outlet dalam persen dengan penjelasan singkat, tanpa angka rupiah." : m === "compact" ? "Versi singkat satu baris per outlet, angka disingkat (jt/M)." : "Untuk BOD/manajemen: omset, target, kekurangan, dan kebutuhan per hari setiap outlet, angka rupiah penuh."; return true; }
  function openWa() {
    if (!waFill()) { alert("Belum ada data target untuk periode ini."); return; }
    $("waModal").classList.remove("hidden"); $("waText").focus(); $("waText").scrollTop = 0; $("waText").setSelectionRange(0, 0);
  }
  function closeWa() { $("waModal").classList.add("hidden"); }
  async function waCopy() { const t = $("waText").value; try { await navigator.clipboard.writeText(t); $("waStatus").textContent = "Tersalin. Buka grup WhatsApp lalu tempel (paste)."; } catch (e) { $("waText").select(); document.execCommand("copy"); $("waStatus").textContent = "Tersalin (mode lama). Tempel di grup WhatsApp."; } }
  function waOpen() { const t = $("waText").value; window.open("https://wa.me/?text=" + encodeURIComponent(t), "_blank", "noopener"); $("waStatus").textContent = "WhatsApp dibuka. Pilih grup tujuan lalu kirim."; }

  // ---------- Pencapaian sales (spreadsheet terpisah) ----------
  const MON3 = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MEI: 4, MAY: 4, JUN: 5, JUL: 6, AGU: 7, AUG: 7, AGS: 7, SEP: 8, SEPT: 8, OKT: 9, OCT: 9, NOV: 10, DES: 11, DEC: 11 };
  const parseSalesDate = (v) => { if (v == null) return null; const d = parseDate(v); if (d) return d; const m = String(v).trim().match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/); if (!m) return null; const k = m[2].toUpperCase(); const mi = k in MON3 ? MON3[k] : MONTH_NAMES.findIndex(n => norm(n) === k); return mi < 0 ? null : new Date(+m[3], mi, +m[1]); };
  function parseSales(rows) {
    // Header bisa digabung gviz dengan baris tanggal di atasnya (mis. "23 Sep 2026 Total Price"), jadi cocokkan dengan "mengandung", bukan sama persis.
    const hi = rows.findIndex(r => r && r.some(v => /\bNAMA\b/.test(norm(v))) && r.some(v => /\bTARGET\b/.test(norm(v))) && r.some(v => /TOTAL PRICE/.test(norm(v))));
    if (hi < 0) throw new Error("baris header (Nama | Target | Total Price) tidak ditemukan di tab pertama");
    const H = rows[hi].map(norm);
    const cName = H.findIndex(h => /\bNAMA\b/.test(h)), cTarget = H.findIndex(h => /\bTARGET\b/.test(h) && !/HARI/.test(h)), cTotal = H.findIndex(h => /TOTAL PRICE/.test(h)), cMtd = H.findIndex(h => /MONTH TO DATE/.test(h));
    if (cName < 0 || cTarget < 0 || cTotal < 0) throw new Error("kolom Nama/Target/Total Price tidak lengkap");
    let mi = -1, year = null; const m = H[cTarget].match(/TARGET\s+([A-Z]+)/); if (m) mi = MONTH_NAMES.findIndex(n => norm(n) === m[1]);
    const findDate = (v) => { if (v == null) return null; const d = parseDate(v); if (d) return d; const mm = String(v).match(/(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/); return mm ? parseSalesDate(`${mm[1]} ${mm[2]} ${mm[3]}`) : null; };
    const dayCols = []; const seen = new Set();
    for (const r of [hi, hi - 1, hi - 2]) { if (r < 0) continue; (rows[r] || []).forEach((v, c) => { if (c <= Math.max(cTotal, cMtd)) return; const d = findDate(v); if (d) { const key = d.getDate() + "-" + d.getMonth(); if (!seen.has(key)) { seen.add(key); dayCols.push({ c, d: d.getDate(), mi: d.getMonth(), y: d.getFullYear() }); } } }); }
    if (dayCols.length) { year = dayCols[0].y; if (mi < 0) mi = dayCols[0].mi; }
    if (mi < 0) mi = new Date().getMonth(); if (year == null) year = new Date().getFullYear();
    const out = []; let lastDay = 0;
    for (let r = hi + 1; r < rows.length; r++) {
      const row = rows[r] || []; const name = String(row[cName] ?? "").trim(); if (!name || /^\d+$/.test(name)) { if (out.length && !name) break; else continue; }
      if (/^(total|jumlah|grand total)$/i.test(name)) break;
      const target = num(row[cTarget]) || 0, total = num(row[cTotal]) || 0; const days = {};
      for (const dc of dayCols) { if (dc.mi !== mi) continue; const v = num(row[dc.c]); if (v != null && v !== 0) { days[dc.d] = v; if (v > 0) lastDay = Math.max(lastDay, dc.d); } }
      out.push({ name: name.replace(/\s+/g, " "), target, total, mtdSheet: num(row[cMtd]), days });
    }
    if (!out.length) throw new Error("tidak ada baris sales di bawah header");
    const dim = daysIn(year, mi);
    return { mi, year, dim, lastDay: lastDay || dim, rows: out, fetchedAt: Date.now() };
  }
  function computeSales() {
    const S = state.sales; if (!S) return null; const A = { achWarn: 80, achCrit: 60, ...(C.ALERTS || {}) };
    const N = S.lastDay, dim = S.dim, partial = N < dim, rem = partial ? dim - N : 0;
    const rows = S.rows.map(r => { const dailyT = r.target ? r.target / dim : 0, tgtNow = dailyT * N; const ach = tgtNow ? r.total / tgtNow : null, achMonth = r.target ? r.total / r.target : null; const gap = tgtNow ? tgtNow - r.total : null, gapFull = r.target ? r.target - r.total : null; const nAct = Object.values(r.days).filter(v => v > 0).length; return { ...r, dailyT, tgtNow, ach, achMonth, gap, gapFull, needPerDay: rem > 0 && gapFull > 0 ? gapFull / rem : null, avgDay: N ? r.total / N : null, activeDays: nAct, status: ach == null ? "na" : ach >= 1 ? "ok" : ach * 100 >= A.achWarn ? "warn" : "bad" }; });
    const withT = rows.filter(r => r.ach != null); const below = withT.filter(r => r.ach < 1), ok = withT.filter(r => r.ach >= 1), na = rows.filter(r => r.ach == null);
    const tTarget = withT.reduce((x, r) => x + r.target, 0), tTotal = rows.reduce((x, r) => x + r.total, 0), tNow = withT.reduce((x, r) => x + r.tgtNow, 0), tTotalT = withT.reduce((x, r) => x + r.total, 0);
    const same = !state.range && state.month !== "ytd" && state.month === S.mi && Y() === S.year;
    return { S, N, dim, partial, rem, rows, below, ok, na, same, pName: `${MONTH_NAMES[S.mi].toLowerCase().replace(/^./, c => c.toUpperCase())} ${S.year}`, tot: { target: tTarget, total: tTotal, tgtNow: tNow, ach: tNow ? tTotalT / tNow : null, achMonth: tTarget ? tTotalT / tTarget : null, gap: tNow - tTotalT, gapFull: tTarget - tTotalT, needPerDay: rem > 0 && tTarget - tTotalT > 0 ? (tTarget - tTotalT) / rem : null, avgDay: N ? tTotalT / N : null }, gapBelow: below.reduce((x, r) => x + r.gap, 0) };
  }
  function renderSales() {
    const R = computeSales(); const list = $("salesList"), kpi = $("salesKpi"), prio = $("salesPrio");
    if (!R) { $("salesSub").textContent = "Data sales belum terbaca."; kpi.innerHTML = ""; prio.classList.add("hidden"); list.innerHTML = `<div class="tg-empty">Spreadsheet pencapaian sales tidak terbaca${state.salesErr ? `: <b>${String(state.salesErr).replace(/</g, "&lt;").slice(0, 300)}</b>` : ""}. Pastikan dibagikan "Siapa saja yang memiliki link — Viewer" dan ID di <code>config.js</code> (SALES.SHEET_ID) benar.</div>`; $("salesFoot").textContent = ""; return; }
    const warnAt = (C.ALERTS || {}).achWarn ?? 80; const lfl = R.partial ? ` · data s/d tgl ${R.N} (hari ke-${R.N} dari ${R.dim})` : " · bulan penuh";
    $("salesSub").innerHTML = `${R.pName}${lfl} · ${R.rows.length} sales · pencapaian = omset ÷ target ${R.partial ? "s/d hari berdata" : "bulan"}${R.same ? "" : ` · <b>catatan:</b> sheet sales hanya berisi ${R.pName}, tidak mengikuti periode yang dipilih di atas`}`;
    const k = (n, l, cl, sub) => `<div class="tg-kpi ${cl}"><b>${n}</b><span>${l}</span>${sub ? `<small>${sub}</small>` : ""}</div>`;
    kpi.innerHTML = k(R.tot.ach == null ? "—" : (R.tot.ach * 100).toFixed(0) + "%", "pencapaian tim sales", R.tot.ach == null ? "muted" : R.tot.ach >= 1 ? "good" : R.tot.ach * 100 >= warnAt ? "warn" : "bad", `${fmtRpS(R.tot.total)} dari target ${R.partial ? "s/d hari ini " : ""}${fmtRpS(R.tot.tgtNow)}${R.tot.achMonth != null ? ` · ${(R.tot.achMonth * 100).toFixed(0)}% dari target bulan ${fmtRpS(R.tot.target)}` : ""}`)
      + k(R.below.length, "belum mencapai target", R.below.length ? "bad" : "muted", `dari ${R.below.length + R.ok.length} sales bertarget`)
      + k(R.ok.length, "sudah mencapai target", R.ok.length ? "good" : "muted", R.ok.length ? `lebih ${fmtRpS(R.ok.reduce((x, r) => x + (r.total - r.tgtNow), 0))}` : "")
      + k(fmtRpS(R.gapBelow), "total kekurangan", R.below.length ? "bad" : "muted", R.partial && R.tot.needPerDay ? `perlu ${fmtRpS(R.tot.needPerDay)}/hari tim × ${R.rem} hari tersisa` : "")
      + (R.na.length ? k(R.na.length, "tanpa target", "muted", "isi kolom Target di sheet") : "");
    const top = R.below.slice().sort((a, b) => b.gap - a.gap)[0]; const best = R.rows.filter(r => r.ach != null).sort((a, b) => b.ach - a.ach)[0];
    if (best || top) { prio.classList.remove("hidden"); prio.innerHTML = `<svg><use href="#i-target"/></svg><div>${best ? `<b>Terbaik: ${best.name}</b> ${(best.ach * 100).toFixed(0)}% (${fmtRpS(best.total)}).` : ""}${top ? ` <b>Kekurangan terbesar: ${top.name}</b> ${fmtRpS(top.gap)} (${(top.gap / R.gapBelow * 100).toFixed(0)}% dari total kekurangan)${top.needPerDay ? `, perlu ${fmtRpS(top.needPerDay)}/hari` : ""}.` : ""}</div>`; } else prio.classList.add("hidden");
    const f = state.salesFilter || "all", srt = state.salesSort || "best";
    document.querySelectorAll("#slFilter button").forEach(b => { b.classList.toggle("on", b.dataset.f === f); const n = b.dataset.f === "all" ? R.rows.length : b.dataset.f === "below" ? R.below.length : R.ok.length; b.querySelector("i").textContent = n; });
    document.querySelectorAll("#slSort button").forEach(b => b.classList.toggle("on", b.dataset.s === srt));
    let rows = f === "below" ? R.below : f === "ok" ? R.ok : R.rows.slice();
    const order = { bad: 0, warn: 1, ok: 2, na: 3 };
    if (srt === "best") rows = rows.slice().sort((a, b) => (b.ach ?? -1) - (a.ach ?? -1) || b.total - a.total);
    else if (srt === "worst") rows = rows.slice().sort((a, b) => order[a.status] - order[b.status] || (a.ach ?? 9) - (b.ach ?? 9));
    else if (srt === "gap") rows = rows.slice().sort((a, b) => (b.gap ?? -Infinity) - (a.gap ?? -Infinity));
    else rows = rows.slice().sort((a, b) => b.total - a.total);
    const maxPct = Math.max(1.2, ...rows.map(r => r.ach || 0));
    list.innerHTML = rows.length ? rows.map((r, i) => { const w = r.ach == null ? 0 : Math.min(100, r.ach / maxPct * 100), mark = 100 / maxPct; const pct = r.ach == null ? "—" : (r.ach * 100).toFixed(0) + "%";
      const sub = r.ach == null ? `${fmtRpS(r.total)} · target belum diisi` : r.ach >= 1 ? `${fmtRpS(r.total)} dari ${fmtRpS(r.tgtNow)} · <span class="good">lebih ${fmtRpS(r.total - r.tgtNow)}</span> · ${(r.achMonth * 100).toFixed(0)}% target bulan` : `${fmtRpS(r.total)} dari ${fmtRpS(r.tgtNow)} · <span class="${r.status}">kurang ${fmtRpS(r.gap)}</span>${r.needPerDay ? ` · perlu <b>${fmtRpS(r.needPerDay)}/hari</b> × ${R.rem} hari` : ""} · ${(r.achMonth * 100).toFixed(0)}% target bulan`;
      return `<div class="tg tg-${r.status}"><span class="tg-rank">${i + 1}</span><span class="tg-body"><span class="tg-top"><b>${r.name}</b><span class="tg-pct">${pct}</span></span><span class="tg-bar"><i style="width:${w.toFixed(1)}%"></i><em style="left:${mark.toFixed(1)}%"></em></span><span class="tg-sub">${sub}</span></span></div>`; }).join("") : `<div class="tg-empty">Tidak ada sales pada filter ini.</div>`;
    $("salesFoot").innerHTML = `<span class="lg lg-bad">&lt; ${warnAt}%</span><span class="lg lg-warn">${warnAt}–99%</span><span class="lg lg-good">≥ 100%</span><span class="lg lg-na">tanpa target</span><span>garis tipis = 100% target · target s/d hari ini = target bulan ÷ ${R.dim} hari × ${R.N} hari berdata · "% target bulan" = omset ÷ target bulan penuh (angka Month to Date di sheet) · sumber: Google Sheet pencapaian sales</span>`;
  }
  // bagian sales untuk pesan WhatsApp (mode: detail | compact | pct)
  function waSalesLines(mode) {
    const R = computeSales(); if (!R || !R.same) return [];
    const L = []; const warnAt = (C.ALERTS || {}).achWarn ?? 80;
    const rows = R.rows.filter(r => r.ach != null).sort((a, b) => b.ach - a.ach);
    const st = R.tot.ach == null ? "na" : R.tot.ach >= 1 ? "ok" : R.tot.ach * 100 >= warnAt ? "warn" : "bad";
    if (mode === "pct") {
      L.push(`*PENCAPAIAN SALES (${rows.length} orang)*`);
      L.push(`Tim sales keseluruhan: ${waIco(st)} *${R.tot.ach == null ? "-" : (R.tot.ach * 100).toFixed(0) + "%"}* dari target${R.partial ? " sampai hari ini" : ""}. ${R.ok.length} sales sudah mencapai target, ${R.below.length} belum.`);
      L.push(`Urutan dari pencapaian tertinggi.`);
      rows.forEach((r, i) => L.push(`${i + 1}. ${waIco(r.status)} ${r.name} — *${(r.ach * 100).toFixed(0)}%*`));
      R.na.forEach(r => L.push(`⚪ ${r.name} — target belum diisi`));
      if (rows.length) { const b = rows[0]; L.push(""); L.push(`🏆 Sales terbaik ${R.pName}: *${b.name}* (${(b.ach * 100).toFixed(0)}%). ${R.below.length ? "Yang masih di bawah target: fokus kunjungan dan closing setiap hari." : "Semua sales di jalur target!"}`); }
    } else if (mode === "compact") {
      L.push(`*PENCAPAIAN SALES (${rows.length} orang)*`);
      L.push(`${waIco(st)} Tim: ${waRp(R.tot.total)} / ${waRp(R.tot.tgtNow)} (${R.tot.ach == null ? "-" : (R.tot.ach * 100).toFixed(0) + "%"}) · ${R.ok.length} tercapai, ${R.below.length} belum`);
      rows.forEach((r, i) => L.push(`${i + 1}. ${waIco(r.status)} *${r.name}* ${(r.ach * 100).toFixed(0)}% · ${waRp(r.total)} / ${waRp(r.tgtNow)}${r.ach < 1 ? ` · kurang ${waRp(r.gap)}` : ""}`));
      R.na.forEach(r => L.push(`⚪ ${r.name} — ${waRp(r.total)} (target belum diisi)`));
    } else {
      L.push(`*PENCAPAIAN SALES (${rows.length} orang)*`);
      L.push(`• Omset tim sales${R.partial ? " sampai hari ini" : ""}: ${waFull(R.tot.total)}`);
      L.push(`• Target${R.partial ? " sampai hari ini" : ""}: ${waFull(R.tot.tgtNow)} (target bulan ${waFull(R.tot.target)})`);
      L.push(`• Pencapaian tim: ${waIco(st)} *${R.tot.ach == null ? "-" : (R.tot.ach * 100).toFixed(0) + "%"}* · ${R.ok.length} sales tercapai, ${R.below.length} belum${R.tot.gap > 0 ? ` · kekurangan ${waFull(R.tot.gap)}` : ""}`);
      if (R.partial && R.tot.needPerDay) L.push(`• Sisa ${R.rem} hari, tim perlu ${waFull(R.tot.needPerDay)} per hari untuk target bulan`);
      L.push(`Urutan dari pencapaian tertinggi.`);
      rows.forEach((r, i) => L.push(`${i + 1}. ${waIco(r.status)} *${r.name}* — ${(r.ach * 100).toFixed(0)}%\n   Omset ${waFull(r.total)} dari target ${waFull(r.tgtNow)}${r.ach >= 1 ? ` · lebih ${waFull(r.total - r.tgtNow)}` : ` · kurang ${waFull(r.gap)}${r.needPerDay ? ` · perlu ${waFull(r.needPerDay)}/hari` : ""}`}`));
      R.na.forEach(r => L.push(`⚪ *${r.name}* — omset ${waFull(r.total)}, target belum diisi`));
    }
    L.push("");
    return L;
  }
  function renderTargetBoard() {
    const B = computeTargetBoard(); const list = $("exTargetList"), kpi = $("exTargetKpi"), prio = $("exTargetPrio");
    const empty = (msg) => { kpi.innerHTML = ""; prio.classList.add("hidden"); list.innerHTML = `<div class="tg-empty">${msg}</div>`; $("exTargetSum").textContent = ""; $("exTargetFoot").textContent = ""; };
    if (!B || !B.rows.length) return empty("Belum ada data untuk periode ini.");
    const A = (C.ALERTS || {}); const warnAt = A.achWarn ?? 80; const lfl = B.partial ? ` · s/d tgl ${B.N}` : "";
    const ok = B.rows.filter(r => r.status === "ok"), below = B.rows.filter(r => r.status === "bad" || r.status === "warn"), na = B.rows.filter(r => r.status === "na");
    $("exTargetSum").textContent = `${B.pName}${lfl} · ${B.partial ? "pencapaian s/d hari berdata (like-for-like)" : "pencapaian target periode"}`;
    // KPI ringkas
    const k = (n, l, cl, sub) => `<div class="tg-kpi ${cl}"><b>${n}</b><span>${l}</span>${sub ? `<small>${sub}</small>` : ""}</div>`;
    kpi.innerHTML = k(below.length, "belum tercapai", below.length ? "bad" : "muted", B.nTarget ? `dari ${B.nTarget} outlet bertarget` : "") + k(ok.length, "tercapai", ok.length ? "good" : "muted", ok.length ? `lebih ${fmtRpS(ok.reduce((x, r) => x + (r.actual - r.target), 0))}` : "") + k(fmtRpS(B.gapBelow), "total kekurangan", below.length ? "bad" : "muted", B.partial && B.gapFullBelow ? `${fmtRpS(B.gapFullBelow)} ke target bulan penuh` : "") + (na.length ? k(na.length, "tanpa target", "muted", "isi kolom TARGET di sheet") : "");
    // prioritas: gap Rp terbesar (bukan % terbesar)
    const top = below.slice().sort((a, b) => b.gap - a.gap)[0];
    if (top) { prio.classList.remove("hidden"); prio.innerHTML = `<svg><use href="#i-target"/></svg><div><b>Prioritas: ${top.label}</b> menyumbang kekurangan terbesar, <b>${fmtRpS(top.gap)}</b> (${(top.gap / B.gapBelow * 100).toFixed(0)}% dari total kekurangan)${top.needPerDay ? ` · butuh ${fmtRpS(top.needPerDay)}/hari pada ${B.remDays} hari tersisa` : ""}.</div>`; } else prio.classList.add("hidden");
    // filter & urutan
    const f = state.targetFilter || "all", srt = state.targetSort || "pct";
    document.querySelectorAll("#tgFilter button").forEach(b => { b.classList.toggle("on", b.dataset.f === f); const n = b.dataset.f === "all" ? B.rows.length : b.dataset.f === "below" ? below.length : ok.length; b.querySelector("i").textContent = n; });
    document.querySelectorAll("#tgSort button").forEach(b => b.classList.toggle("on", b.dataset.s === srt));
    let rows = f === "below" ? below : f === "ok" ? ok : B.rows;
    if (srt === "gap") rows = rows.slice().sort((a, b) => (b.gap ?? -Infinity) - (a.gap ?? -Infinity));
    const maxPct = Math.max(1.2, ...rows.map(r => r.ach || 0)); // skala bar: 100% = tanda garis, lebih dari itu tetap terlihat
    list.innerHTML = rows.length ? rows.map((r, i) => {
      const w = r.ach == null ? 0 : Math.min(100, r.ach / maxPct * 100), mark = 100 / maxPct;
      const pct = r.ach == null ? "—" : (r.ach * 100).toFixed(0) + "%";
      const sub = r.ach == null ? `${fmtRpS(r.actual)} · target belum diisi di sheet` : r.ach >= 1 ? `${fmtRpS(r.actual)} dari ${fmtRpS(r.target)} · <span class="good">lebih ${fmtRpS(r.actual - r.target)}</span>` : `${fmtRpS(r.actual)} dari ${fmtRpS(r.target)} · <span class="${r.status}">kurang ${fmtRpS(r.gap)}</span>${r.needPerDay ? ` · butuh <b>${fmtRpS(r.needPerDay)}/hari</b> × ${B.remDays} hari` : ""}`;
      const sel = state.execKey === r.key ? " sel" : "";
      return `<button type="button" class="tg tg-${r.status}${sel}" data-key="${r.key}" title="Lihat rincian ${r.label}"><span class="tg-rank">${i + 1}</span><span class="tg-body"><span class="tg-top"><b>${r.label}</b><span class="tg-pct">${pct}</span></span><span class="tg-bar"><i style="width:${w.toFixed(1)}%"></i><em style="left:${mark.toFixed(1)}%"></em></span><span class="tg-sub">${sub}</span></span><svg class="tg-go"><use href="#i-chev"/></svg></button>`;
    }).join("") : `<div class="tg-empty">${f === "below" ? "Semua outlet bertarget sudah mencapai target." : "Belum ada outlet yang mencapai target."}</div>`;
    list.querySelectorAll(".tg[data-key]").forEach(el => el.addEventListener("click", () => { state.execKey = el.dataset.key; $("selStore").value = state.execKey; render(); $("exHeroLabel").scrollIntoView({ behavior: "smooth", block: "center" }); }));
    $("exTargetFoot").innerHTML = `<span class="lg lg-bad">&lt; ${warnAt}%</span><span class="lg lg-warn">${warnAt}–99%</span><span class="lg lg-good">≥ 100%</span><span class="lg lg-na">tanpa target</span><span>garis tipis = 100% target${B.partial ? ` · "butuh/hari" = sisa ke target bulan penuh ÷ ${B.remDays} hari tersisa` : ""} · klik outlet untuk rinciannya</span>`;
  }
  function renderExec() {
    buildExecChips(); renderTargetBoard(); renderExecVisitTiles(state.execKey || null, execEntity()); const key = state.execKey || null, ent = execEntity();
    if (state.range) { const R = computeExecRange(state.range.a, state.range.b, key); if (R) return renderExecRange(R, key, ent); $("exHeroLabel").textContent = `${ent}: tidak ada data pada rentang ini`; $("exHeroVal").textContent = "—"; }
    const mi = state.month, ytd = mi === "ytd"; const E = computeExec(mi, key); if (!E) { $("exHeroLabel").textContent = `${ent}: tidak ada data`; $("exHeroVal").textContent = "—"; $("exHeroSub").textContent = ""; $("exTiles").innerHTML = ""; return; } const c = E.cur, pName = periodName(mi);
    // target bulan penuh (Σ target harian seluruh bulan) & target s/d hari ini
    const idxs = c.idxs; const fullT = idxs.reduce((x, i) => x + (state.months[i] ? state.months[i].days.reduce((y, d) => y + dayTarget(d, key), 0) : 0), 0); const tgtNow = E.tgtTotal;
    $("exHeroLabel").textContent = `Realisasi omset ${key ? ent + " · " : ""}${ytd ? "Jan–" + MONTH_SHORT[c.last] + " " + Y() : pName}${c.partial ? ` (s/d tgl ${c.N})` : ""}`; $("exHeroVal").textContent = fmtRpS(c.total);
    $("exHeroSub").textContent = `${fmtRp(c.total)} · rata-rata ${fmtRpS(c.avg)} per hari (${c.nDays} hari)`;
    const dim = ytd ? null : daysIn(Y(), mi); const remDays = c.partial && !ytd ? dim - c.N : 0;
    renderHeroFacts({ ach: E.ach, tgtNow, actual: c.total, fullT, remDays, timePct: c.partial && !ytd ? c.N / dim : null, progPct: fullT ? c.total / fullT : 0, unitLabel: ytd ? "YTD" : "bulan", partialTxt: c.partial ? "s/d hari ini" : "", hasTarget: !!tgtNow || !!fullT, avg: c.avg, nDays: c.nDays });
    const tile = (l, v, p, s, cl) => `<div class="tile ${cl || ""}"><div class="t-label">${l}</div><div class="t-row"><div class="t-val">${v}</div>${p || ""}</div><div class="t-sub">${s}</div></div>`;
    $("exTiles").innerHTML = [
      tile("Dibanding bulan lalu", fmtPct(E.mom), "", E.pm ? `${fmtRpS(c.total)} vs ${fmtRpS(E.pm.total)}${c.partial ? " (tgl 1–" + c.N + ")" : ""}` : ytd ? `${E.momLabel} vs bulan sebelumnya` : "tidak ada bulan lalu", E.mom == null ? "" : E.mom >= 0 ? "up" : "down"),
      tile("Dibanding tahun lalu", fmtPct(E.yoy), E.sssg != null ? `<span class="pill ${cls(E.sssg)}" title="Pertumbuhan toko lama saja">toko lama ${fmtPct(E.sssg)}</span>` : "", E.base ? `${fmtRpS(c.total)} vs ${fmtRpS(E.base.total)} (${BY()})` : key ? `${ent} belum ada di ${BY()}` : `data ${BY()} belum ada`, E.yoy == null ? "" : E.yoy >= 0 ? "up" : "down"),
      tile("Hari terbaik", c.best ? fmtRpS(c.best.v) : "—", c.best ? `<span class="pill good">${DOW[c.best.dow]}</span>` : "", c.best ? `${c.best.d} ${MONTH_SHORT[c.best.mi]} ${Y()}` : ""),
      tile("Hari terlemah", c.worst ? fmtRpS(c.worst.v) : "—", c.worst ? `<span class="pill bad">${DOW[c.worst.dow]}</span>` : "", c.worst ? `${c.worst.d} ${MONTH_SHORT[c.worst.mi]} ${Y()}` : ""),
    ].join("");
    const r = drawRealisasi("chartExDaily", key, mi, "target", "exDailySub", ent); $("exDailyLegend").innerHTML = legendHTML("target");
    $("exDailyHow").textContent = ytd ? "Setiap batang = omset satu bulan; garis putus-putus = target bulan itu. Batang hijau pucat berarti bulan itu di bawah target." : "Setiap batang = omset satu hari; garis putus-putus = target hari itu. Batang hijau pucat berarti hari itu di bawah target.";
    drawBulanan("chartExMonthly", key, "target", "exMonthlySub", ent); $("exMonthlyLegend").innerHTML = legendHTML("target");
    let AL = computeAlerts(mi); if (key) AL = AL.filter(a => a.who === ent); const cnt = { crit: 0, warn: 0, info: 0 }; AL.forEach(a => cnt[a.sev]++); $("exAlertSum").textContent = (AL.length ? `${cnt.crit} kritis · ${cnt.warn} peringatan` : "tidak ada") + (key ? ` · ${ent}` : "");
    $("exAlertList").innerHTML = AL.slice(0, 5).map(a => `<div class="al al-${a.sev}"><span class="al-sev">${SEV[a.sev]}</span><div><b>${a.title}</b></div></div>`).join("") || `<div class="muted">Semua outlet dalam batas normal.</div>`;
    const IN = computeInsights(mi).slice(0, 3); $("exInsightList").innerHTML = IN.map(i => `<div class="ins ins-${i.tone}"><b>${i.title}</b><p>${i.rec}</p></div>`).join("") || `<div class="muted">Belum ada insight.</div>`;
  }

  // ---------- 3. Analisis Tren (satu pembanding, dipilih tombol) ----------
  function renderTrend() {
    const mi = state.month; const stores = activeStores().filter(s => state.months.some(m => m && m.days.some(d => d.act[s.key] != null)));
    const chips = $("trChips"); if (chips.dataset.year !== String(state.year)) { chips.innerHTML = ""; chips.dataset.year = String(state.year); state.trendEntity = "__ALL__"; const mk = (key, txt) => { const b = document.createElement("span"); b.className = "chip clk" + (state.trendEntity === key ? " on" : ""); b.textContent = txt; b.dataset.key = key; b.onclick = () => { state.trendEntity = key; chips.querySelectorAll(".chip").forEach(x => x.classList.toggle("on", x.dataset.key === key)); renderTrend(); }; chips.appendChild(b); }; mk("__ALL__", "Perusahaan"); stores.forEach(s => mk(s.key, s.short)); }
    const key = state.trendEntity === "__ALL__" ? null : state.trendEntity; const ent = key ? (C.STORES.find(s => s.key === key) || {}).label : "Perusahaan";
    const cmp = state.trendCmp || "target"; document.querySelectorAll("#trCmp button").forEach(b => b.classList.toggle("on", b.dataset.cmp === cmp));
    const r = drawRealisasi("chartTrDaily", key, mi, cmp, "trDailySub", ent); $("trDailyLegend").innerHTML = legendHTML(r.cmp);
    drawBulanan("chartTrMonthly", key, cmp === "py" ? "py" : "target", "trMonthlySub", ent); $("trMonthlyLegend").innerHTML = legendHTML(cmp === "py" ? "py" : "target");
    let P = periodInfo(Y(), state.months, mi), note = periodName(mi); if (!P || P.nDays < 14) { P = periodInfo(Y(), state.months, "ytd"); note = `${MONTH_SHORT[0]}–${MONTH_SHORT[P.last]} ${Y()} (periode terpilih terlalu pendek)`; }
    const pat = dayPattern(P.days, key); const order = [1, 2, 3, 4, 5, 6, 0]; const vals = order.map(i => pat.avg[i] == null ? null : +(pat.avg[i] / 1e6).toFixed(1)); const mx = Math.max(...vals.filter(v => v != null)), mn = Math.min(...vals.filter(v => v != null));
    kill("trDow"); state.charts.trDow = new Chart($("chartTrDow"), { type: "bar", plugins: [growthLabels], data: { labels: order.map(i => DOW[i]), datasets: [{ label: "Rata-rata omset", data: vals, backgroundColor: vals.map(v => v === mx ? BRAND_2 : v === mn ? BELOW : BRAND), borderRadius: 10, borderSkipped: false, barPercentage: .7, categoryPercentage: .7 }] },
      options: { layout: { padding: { top: 22 } }, plugins: { growthLabels: { labels: vals.map(v => ({ text: v == null ? "" : jt(v).replace("Rp ", ""), color: "#2B2F45" })) }, legend: { display: false }, tooltip: { callbacks: { label: c => `${jt(c.raw)} per hari · ${pat.n[order[c.dataIndex]]} hari` } } }, scales: { x: gridX, y: { ...gridY, ticks: { callback: v => v.toLocaleString("id-ID") + " jt" } } } } });
    $("trDowSub").textContent = `${ent} · ${note} · batang gelap = hari terkuat, pucat = terlemah`;
    let h = `<tr><th style="text-align:left">Outlet</th>${order.map(i => `<th>${DOW[i].slice(0, 3)}</th>`).join("")}<th>Terkuat</th><th>Terlemah</th></tr>`;
    for (const s of [{ key: null, label: "Perusahaan" }, ...stores]) { const p = dayPattern(P.days, s.key); const a = p.avg.map((v, i) => [v, i]).filter(x => x[0] != null); if (!a.length) continue; a.sort((x, y) => y[0] - x[0]); h += `<tr${s.key ? "" : ' class="total"'}><td style="text-align:left">${s.label}</td>${order.map(i => `<td class="${p.avg[i] != null && a[0][1] === i ? "good" : p.avg[i] != null && a[a.length - 1][1] === i ? "bad" : ""}">${p.avg[i] == null ? "—" : fmtRpS(p.avg[i])}</td>`).join("")}<td class="good">${DOW[a[0][1]]}</td><td class="bad">${DOW[a[a.length - 1][1]]}</td></tr>`; }
    $("tblDow").innerHTML = h;
  }
  // ---------- 2. Peringkat Outlet ----------
  function renderRank() {
    const mi = state.month; const K = computeRanking(mi); if (!K) return; const rows = K.rows, pName = periodName(mi), lfl = K.R.partial && mi !== "ytd" ? ` · s/d tgl ${K.R.N}` : "";
    $("rankSub").textContent = `${pName}${lfl} · ${rows.length} outlet · total ${fmtRpS(K.total)}`;
    kill("rankRev"); state.charts.rankRev = new Chart($("chartRankRev"), { type: "bar", plugins: [hbarLabels], data: { labels: rows.map(r => r.label), datasets: [{ label: "Omset", data: rows.map(r => +(r.actual / 1e6).toFixed(1)), backgroundColor: rows.map((r, i) => i === 0 ? BRAND_2 : BRAND), borderRadius: 8, borderSkipped: false, barPercentage: .72, categoryPercentage: .85 }] },
      options: { indexAxis: "y", layout: { padding: { right: 120 } }, plugins: { hbarLabels: { labels: rows.map(r => ({ text: `${fmtRpS(r.actual)} · ${(r.share * 100).toFixed(1)}%`, color: "#2B2F45" })) }, legend: { display: false }, tooltip: { callbacks: { label: c => `${jt(c.raw)} · kontribusi ${(rows[c.dataIndex].share * 100).toFixed(1)}%` } } }, scales: { x: { ...gridY, ticks: { callback: v => v.toLocaleString("id-ID") + " jt" } }, y: { grid: { display: false }, border: { display: false } } } } });
    let h = `<tr><th>#</th><th style="text-align:left">Outlet</th><th>Omset</th><th>Kontribusi</th><th>YoY</th><th>MoM</th><th>Target</th><th>Ach %</th></tr>`;
    for (const r of rows) h += `<tr><td>${r.rank}</td><td style="text-align:left;font-weight:600">${r.label}</td><td>${fmtRp(r.actual)}</td><td><span class="pill brand">${(r.share * 100).toFixed(1)}%</span></td><td class="${cls(r.yoy)}">${r.yoy == null ? `<span class="muted">${r.yoyNote || "n/a"}</span>` : fmtPct(r.yoy)}</td><td class="${cls(r.mom)}">${r.mom == null ? `<span class="muted">${r.momNote || "n/a"}</span>` : fmtPct(r.mom)}</td><td>${fmtRp(r.target)}</td><td class="${r.ach == null ? "" : r.ach >= 1 ? "good" : r.ach >= .8 ? "warn" : "bad"}">${r.ach == null ? "—" : (r.ach * 100).toFixed(1) + "%"}</td></tr>`;
    h += `<tr class="total"><td></td><td style="text-align:left">TOTAL</td><td>${fmtRp(K.total)}</td><td>100%</td><td class="${cls(K.R.totalGrowth)}">${fmtPct(K.R.totalGrowth)}</td><td class="${cls(K.M && K.M.totalGrowth)}">${K.M ? fmtPct(K.M.totalGrowth) : "—"}</td><td>${fmtRp(K.R.tgtTotal)}</td><td>${K.R.ach == null ? "—" : (K.R.ach * 100).toFixed(1) + "%"}</td></tr>`;
    $("tblRank").innerHTML = h;
    const short = Object.fromEntries(C.STORES.map(s => [s.key, s.short]));
    const yoyMode = state.mode === "yoy"; const gv = rows.map(r => (yoyMode ? r.yoy : r.mom));
    kill("rankGrowth"); state.charts.rankGrowth = new Chart($("chartRankGrowth"), { type: "bar", plugins: [growthLabels], data: { labels: rows.map(r => short[r.key] || r.label), datasets: [{ label: yoyMode ? `Growth vs ${BY()}` : "Growth vs bulan lalu", data: gv.map(g => g == null ? null : Math.max(-100, Math.min(150, +(g * 100).toFixed(1)))), backgroundColor: gv.map(g => g == null ? BELOW : g >= 0 ? "#15803D" : "#B91C1C"), borderRadius: 6, borderSkipped: false, barPercentage: .6, categoryPercentage: .7 }] },
      options: { layout: { padding: { top: 22 } }, plugins: { growthLabels: { labels: gv.map(g => ({ text: g == null ? "n/a" : fmtPct(g, 0), color: g == null ? "#9AA0B5" : g >= 0 ? "#15803D" : "#B91C1C" })) }, legend: { display: false }, tooltip: { callbacks: { title: i => rows[i[0].dataIndex].label, label: c => { const g = gv[c.dataIndex]; return g == null ? (yoyMode ? rows[c.dataIndex].yoyNote : rows[c.dataIndex].momNote) || "n/a" : fmtPct(g); } } } }, scales: { x: gridX, y: { min: -100, max: 150, grid: { color: "#EEF0F6" }, border: { display: false }, ticks: { callback: v => v + "%" } } } } });
    $("rankGrowthSub").textContent = `${pName}${lfl} · ${yoyMode ? "dibanding bulan yang sama tahun lalu" : "dibanding bulan lalu"} · hijau naik, merah turun · sumbu dibatasi −100…+150%`;
    const cols = rows.map(r => storeColor(r.key));
    kill("contrib"); state.charts.contrib = new Chart($("chartContrib"), { type: "doughnut", data: { labels: rows.map(r => r.label), datasets: [{ data: rows.map(r => +(r.share * 100).toFixed(1)), backgroundColor: cols, borderColor: "#fff", borderWidth: 2, hoverOffset: 6 }] }, options: { cutout: "62%", plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${c.label}: ${c.raw}% · ${fmtRpS(rows[c.dataIndex].actual)}` } } } } });
    $("contribList").innerHTML = rows.map((r, i) => `<div class="cl"><i style="background:${cols[i]}"></i><span>${r.label}</span><b>${(r.share * 100).toFixed(1)}%</b><small>${fmtRpS(r.actual)}</small></div>`).join("");
  }

  // ---------- 5. Outlet Baru ----------
  function renderNewOut() {
    const mi = state.month; const NO = computeNewOutlets(mi); const K = computeRanking(mi); const lim = (C.ALERTS || {}).newOutletMonths || 12; const last = mi === "ytd" ? state.months.map((m, i) => m ? i : -1).filter(i => i >= 0).pop() : mi;
    $("newSub").textContent = `Outlet yang buka ≤ ${lim} bulan sebelum ${MONTH_SHORT[last]} ${Y()} · ${NO.length} outlet`;
    if (!NO.length) { $("newTiles").innerHTML = ""; $("tblNew").innerHTML = ""; kill("newChart"); $("newEmpty").classList.remove("hidden"); return; } $("newEmpty").classList.add("hidden");
    const tot = NO.reduce((x, r) => x + r.actual, 0), achs = NO.filter(r => r.ach != null); const avgAch = achs.length ? achs.reduce((x, r) => x + r.ach, 0) / achs.length : null;
    $("newTiles").innerHTML = [
      { i: "i-store", l: "Outlet baru", v: NO.length, s: NO.map(r => r.label.replace("IW ", "")).join(", ") },
      { i: "i-bars", l: `Omset ${MONTH_SHORT[last]} ${Y()}`, v: fmtRpS(tot), p: K ? `<span class="pill brand">${(tot / K.total * 100).toFixed(1)}% total</span>` : "", s: "kontribusi ke omset perusahaan" },
      { i: "i-target", l: "Rata-rata pencapaian target", v: avgAch == null ? "n/a" : (avgAch * 100).toFixed(0) + "%", p: avgAch == null ? "" : `<span class="pill ${avgAch >= 1 ? "good" : avgAch >= .8 ? "warn" : "bad"}">${achs.length} outlet</span>`, s: "rata-rata sederhana per outlet" },
      { i: "i-trend", l: "Ramp-up terbaik", v: (() => { const r = NO.filter(r => r.mom != null).sort((a, b) => b.mom - a.mom)[0]; return r ? r.label.replace("IW ", "") : "—"; })(), p: (() => { const r = NO.filter(r => r.mom != null).sort((a, b) => b.mom - a.mom)[0]; return r ? `<span class="pill ${cls(r.mom)}">${fmtPct(r.mom)} MoM</span>` : ""; })(), s: "growth vs bulan lalu tertinggi" },
    ].map(tileHTML).join("");
    let h = `<tr><th style="text-align:left">Outlet</th><th>Buka sejak</th><th>Bulan ke-</th><th>Omset ${MONTH_SHORT[last]}</th><th>MoM</th><th>Rata-rata/hari</th><th>Target</th><th>Ach %</th><th>Bulan pertama</th><th>Bulan penuh terakhir</th><th>Ramp-up</th><th>Kunjungan</th><th>Konversi</th></tr>`;
    for (const r of NO) { const ramp = r.ramp; h += `<tr><td style="text-align:left;font-weight:600">${r.label}</td><td>${MONTH_SHORT[r.since.mi]} ${r.since.y}</td><td>${r.age + 1}</td><td>${fmtRp(r.actual)}</td><td class="${cls(r.mom)}">${r.mom == null ? `<span class="muted">${r.momNote}</span>` : fmtPct(r.mom)}</td><td>${fmtRpS(r.avgDay)}</td><td>${fmtRp(r.target)}</td><td class="${r.ach == null ? "" : r.ach >= 1 ? "good" : r.ach >= .8 ? "warn" : "bad"}">${r.ach == null ? "—" : (r.ach * 100).toFixed(0) + "%"}</td><td>${fmtRpS(r.firstTotal)}</td><td>${r.lastFull && r.lastFull.total != null ? fmtRpS(r.lastFull.total) + " (" + MONTH_SHORT[r.lastFull.mi] + ")" : "—"}</td><td class="${cls(ramp)}">${fmtPct(ramp)}</td><td>${r.visit ? fmtN(r.visit.datang) : "—"}</td><td>${r.visit && r.visit.konversi != null ? (r.visit.konversi * 100).toFixed(0) + "%" : "—"}</td></tr>`; }
    $("tblNew").innerHTML = h;
    const maxAge = Math.max(...NO.map(r => r.age)); const labels = Array.from({ length: maxAge + 1 }, (_, i) => "Bln " + (i + 1));
    kill("newChart"); state.charts.newChart = new Chart($("chartNew"), { type: "line", data: { labels, datasets: NO.map(r => lineDs(`${r.label} (${MONTH_SHORT[r.since.mi]} ${r.since.y})`, r.hist.map(h => h.total == null ? null : +(h.total / 1e6).toFixed(1)), storeColor(r.key))) }, options: lineOpts(jt) });
    $("newChartSub").textContent = "Omset per bulan sejak bulan pembukaan (bulan ke-1 = bulan buka; bulan berjalan belum penuh)";
  }

  // ---------- 6. Peringatan Otomatis ----------
  function renderAlerts() {
    const mi = state.month; const AL = computeAlerts(mi); const A = C.ALERTS || {}; const last = mi === "ytd" ? state.months.map((m, i) => m ? i : -1).filter(i => i >= 0).pop() : mi; const part = isPartial(last);
    const cnt = { crit: 0, warn: 0 }; const byType = { decline: 0, trend: 0, under: 0 }; AL.forEach(a => { cnt[a.sev]++; byType[a.type]++; });
    $("alertSub").textContent = `${MONTH_SHORT[last]} ${Y()}${part ? ` · bulan berjalan, berdasarkan tgl 1–${lastDataDay(last)} (like-for-like)` : ""} · ${AL.length} peringatan`;
    $("alertTiles").innerHTML = [
      { i: "i-info", l: "Kritis", v: cnt.crit, c: "bad", s: `penurunan ≤ ${A.declineCrit}% atau target < ${A.achCrit}%` },
      { i: "i-info", l: "Peringatan", v: cnt.warn, c: "warn", s: `penurunan ≤ ${A.declineWarn}% atau target < ${A.achWarn}%` },
      { i: "i-trend", l: "Penurunan omset", v: byType.decline, s: "MoM / YoY like-for-like" },
      { i: "i-trend", l: "Tren negatif", v: byType.trend, s: `${A.trendMonths} bulan MoM negatif berturut` },
      { i: "i-target", l: "Di bawah target", v: byType.under, s: "pencapaian target periode" },
    ].map(tileHTML).join("");
    const groups = ["decline", "trend", "under"]; $("alertList").innerHTML = groups.map(t => { const items = AL.filter(a => a.type === t); return `<div class="al-group"><h4>${TYPE[t]} <span class="pill ${items.length ? (items.some(a => a.sev === "crit") ? "bad" : "warn") : "good"}">${items.length}</span></h4>${items.length ? items.map(a => `<div class="al al-${a.sev} big"><span class="al-sev">${SEV[a.sev]}</span><div><b>${a.title}</b><div class="al-detail">${a.detail}</div><div class="al-action">→ ${a.action}</div></div></div>`).join("") : `<div class="muted" style="padding:6px 0 12px">Tidak ada.</div>`}</div>`; }).join("");
    $("alertRules").textContent = `Ambang (config.js › ALERTS): penurunan peringatan ≤ ${A.declineWarn}%, kritis ≤ ${A.declineCrit}%; tren negatif ${A.trendMonths} bulan; target peringatan < ${A.achWarn}%, kritis < ${A.achCrit}%. Outlet yang tidak comparable (baru/tutup) tidak dinilai pada growth.`;
  }

  // ---------- Narasi AI (opsional, kunci milik pengguna, tersimpan di browser) ----------
  const AI = { base: "https://api.sylorapi.com/v1", model: "gpt-4o-mini", key: "" };
  const aiProxy = () => (C.AI_PROXY_URL || "").trim();
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const isTransient = (msg, status) => status >= 500 || status === 429 || /超时|timeout|timed out|overloaded|temporar|ECONNRESET|network/i.test(msg || "");
  // satu panggilan chat: via proxy Apps Script (token di server) atau langsung (token di browser); coba ulang bila transient
  const AI_TIMEOUT_MS = 330000, AI_TRIES = 1; // relay claude-fable-5 lambat (±1–3 menit); Apps Script maks 6 menit
  async function aiChat(messages, st, opts = {}) {
    const body = { model: AI.model, temperature: opts.temperature != null ? opts.temperature : 0.3, max_tokens: opts.max_tokens || 520, messages }; let lastErr = ""; const t0 = Date.now();
    for (let attempt = 1; attempt <= AI_TRIES; attempt++) {
      const ctl = new AbortController(); AI.abort = ctl; const timer = setTimeout(() => ctl.abort("timeout"), AI_TIMEOUT_MS);
      const tick = setInterval(() => { const s = Math.round((Date.now() - t0) / 1000); st.textContent = `${opts.label || "Meminta narasi"} ke ${AI.model}${aiProxy() ? " via proxy tim" : ""}… ${s} dtk${s > 40 ? " · model ini lambat — boleh tunggu, batalkan, atau ganti model cepat (deepseek/flash) di Pengaturan" : ""}`; }, 1000);
      try {
        let r, j;
        if (aiProxy()) { r = await fetch(aiProxy(), { method: "POST", redirect: "follow", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body), signal: ctl.signal }); j = await r.json().catch(() => ({})); }
        else { r = await fetch(AI.base.replace(/\/+$/, "") + "/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + AI.key }, body: JSON.stringify(body), signal: ctl.signal }); j = await r.json().catch(() => ({})); }
        clearTimeout(timer); clearInterval(tick);
        const err = j && j.error ? (j.error.message || j.error.code || JSON.stringify(j.error)) : (!r.ok ? `HTTP ${r.status}` : "");
        if (err) { lastErr = err; if (attempt < AI_TRIES && isTransient(err, r.status)) { st.textContent = `Relay lambat/timeout — mencoba sekali lagi…`; await sleep(1500); continue; } throw new Error(err); }
        return j;
      } catch (e) {
        clearTimeout(timer); clearInterval(tick);
        if (ctl.signal.aborted && ctl.signal.reason !== "timeout") throw new Error("dibatalkan");
        lastErr = ctl.signal.aborted ? `tidak ada jawaban dalam ${AI_TIMEOUT_MS / 1000} dtk` : (e.message || String(e));
        if (attempt < AI_TRIES && (ctl.signal.aborted || isTransient(lastErr, 0))) { st.textContent = `${lastErr} — mencoba sekali lagi…`; await sleep(1500); continue; }
        throw new Error(lastErr);
      }
    }
    throw new Error(lastErr || "gagal");
  }
  const aiLoad = () => { try { const j = JSON.parse(localStorage.getItem("sssg.ai") || "{}"); Object.assign(AI, j); } catch (e) { } };
  const aiSave = () => { try { localStorage.setItem("sssg.ai", JSON.stringify(AI)); } catch (e) { } };
  const esc = (t) => String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  // markdown ringan → HTML aman (heading, bold, daftar, paragraf)
  function mdLite(t) {
    const lines = esc(t).replace(/\r/g, "").split("\n"); let html = "", list = null;
    const inline = (x) => x.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`(.+?)`/g, "<code>$1</code>");
    const close = () => { if (list) { html += `</${list}>`; list = null; } };
    for (const raw of lines) { const l = raw.trim(); if (!l) { close(); continue; }
      let m; if ((m = l.match(/^#{1,3}\s+(.*)/))) { close(); html += `<h3>${inline(m[1])}</h3>`; continue; }
      if ((m = l.match(/^[-*•]\s+(.*)/))) { if (list !== "ul") { close(); html += "<ul>"; list = "ul"; } html += `<li>${inline(m[1])}</li>`; continue; }
      if ((m = l.match(/^\d+[.)]\s+(.*)/))) { if (list !== "ol") { close(); html += "<ol>"; list = "ol"; } html += `<li>${inline(m[1])}</li>`; continue; }
      close(); html += `<p>${inline(l)}</p>`; }
    close(); return html;
  }
  // ringkasan angka yang dikirim ke model (bukan data mentah sheet)
  function aiPayload(verbose) {
    const mi = state.month, key = state.execKey || null, ent = key ? execEntity() : "Perusahaan"; const E = state.range ? computeExecRange(state.range.a, state.range.b, key) : computeExec(mi, key);
    const K = computeRanking(mi), AL = computeAlerts(mi), NO = computeNewOutlets(mi);
    const V = state.range ? computeVisitsRange(state.range.a, state.range.b, "yoy") : mi === "ytd" ? computeVisitsYTD() : computeVisits(mi, "yoy");
    const jt = v => v == null ? null : +(v / 1e6).toFixed(1); const pc = v => v == null ? null : +(v * 100).toFixed(1);
    const periode = state.range ? fmtRange(state.range.a, state.range.b) : periodName(mi) + (E && E.cur && E.cur.partial ? ` s/d tgl ${E.cur.N} (like-for-like)` : "");
    const out = { perusahaan: (C.OWNER || {}).org || "Inti Warna", entitas: ent, periode, satuan: "jt = juta rupiah", tahun_pembanding: BY() };
    if (E && E.cur) out.omset = { total_jt: jt(E.cur.total), rata_rata_harian_jt: jt(E.cur.avg), hari: E.cur.nDays, vs_tahun_lalu_pct: pc(E.yoy), vs_bulan_lalu_pct: pc(E.mom), sssg_toko_lama_pct: pc(E.sssg), target_pct: pc(E.ach), hari_terbaik: E.cur.best ? `${DOW[E.cur.best.dow]} ${jt(E.cur.best.v)} jt` : null, hari_terlemah: E.cur.worst ? `${DOW[E.cur.worst.dow]} ${jt(E.cur.worst.v)} jt` : null };
    if (K) { if (verbose) out.outlet = K.rows.map(r => ({ nama: r.label, omset_jt: jt(r.actual), kontribusi_pct: pc(r.share), vs_tahun_lalu_pct: pc(r.yoy), vs_bulan_lalu_pct: pc(r.mom), pencapaian_target_pct: pc(r.ach) })); else { out.kolom_outlet = ["nama", "omset_jt", "kontribusi_pct", "vs_tahun_lalu_pct", "vs_bulan_lalu_pct", "target_pct"]; out.outlet = K.rows.map(r => [r.label, jt(r.actual), pc(r.share), pc(r.yoy), pc(r.mom), pc(r.ach)]); } }
    if (V && V.total) out.kunjungan = { datang: V.total.datang, transaksi: V.total.belanja, konversi_pct: pc(V.total.konversi), basket_rp: Math.round(V.total.basket || 0), gagal_pct: pc(V.total.gagalPct), repeat_order_pct: V.total.hasRO ? pc(V.total.roPct) : undefined, vs_tahun_lalu: V.g ? { datang_pct: pc(V.g.datang), basket_pct: pc(V.g.basket), konversi_pts: pc(V.g.konversi) } : undefined };
    if (NO.length) out.outlet_baru = NO.map(r => `${r.label} buka ${MONTH_SHORT[r.since.mi]} ${r.since.y}, omset ${jt(r.actual)} jt, target ${pc(r.ach)}%`);
    out.peringatan = AL.slice(0, 8).map(a => `[${a.sev}] ${a.title}`);
    return out;
  }
  const AI_SYSTEM = `Anda analis bisnis ritel senior (jaringan toko cat/bangunan, Indonesia). Input: JSON angka yang sudah dihitung dashboard. Tulis Bahasa Indonesia untuk pemilik bisnis, HANYA dari angka yang ada — jangan mengarang angka atau sebab. Format markdown padat, MAKSIMAL 180 kata total: "## Ringkasan" (2 kalimat), "## Temuan" (3 butir singkat dengan angka), "## Rekomendasi" (3 butir prioritas, satu kalimat: tindakan + alasan angka + outlet). jt = juta rupiah. Langsung ke isi, tanpa penutup.`;
  const aiCacheKey = () => `${state.year}|${state.range ? iso(state.range.a) + "-" + iso(state.range.b) : state.month}|${state.execKey || "all"}`;
  function aiShowCached() { try { const c = JSON.parse(localStorage.getItem("sssg.ai.cache:" + aiCacheKey()) || "null"); const out = $("aiOut"); if (c && c.text) { out.innerHTML = mdLite(c.text) + `<div class="ai-meta">${c.meta} · tersimpan di browser</div>`; out.classList.remove("hidden"); } else if (!AI.abort) { out.classList.add("hidden"); } } catch (e) { } }
  async function aiRun(retry) {
    aiLoad(); const btn = $("aiRun"), st = $("aiStatus"), out = $("aiOut");
    if (!aiProxy() && !AI.key) { $("aiSettings").classList.remove("hidden"); st.textContent = "Isi token API dulu di Pengaturan."; $("aiKey").focus(); return; }
    if (!state.months.length) { st.textContent = "Data belum termuat."; return; }
    btn.disabled = true; $("aiCancel").classList.remove("hidden"); st.textContent = `Meminta narasi ke ${AI.model}${aiProxy() ? " via proxy tim" : ""}…`; const t0 = Date.now();
    try {
      const payload = aiPayload();
      const j = await aiChat([{ role: "system", content: AI_SYSTEM }, { role: "user", content: "Data periode:\n```json\n" + JSON.stringify(payload) + "\n```\nBuat analisis sesuai format." }], st);
      let text = j.choices && j.choices[0] && j.choices[0].message ? j.choices[0].message.content : ""; if (!text) throw new Error("respons kosong");
      if (j.choices[0].finish_reason === "length") text += "\n\n_(Jawaban terpotong oleh batas panjang — bagian akhir tidak lengkap.)_";
      const meta = `Model ${esc(j.model || AI.model)} · ${((Date.now() - t0) / 1000).toFixed(0)} dtk · ${j.usage ? (j.usage.total_tokens || 0) + " token" : ""} · periode ${esc(payload.periode)} · ${esc(payload.entitas)} · ${new Date().toLocaleString("id-ID")}`;
      out.innerHTML = mdLite(text) + `<div class="ai-meta">${meta}</div>`; out.classList.remove("hidden"); st.textContent = "";
      try { localStorage.setItem("sssg.ai.cache:" + aiCacheKey(), JSON.stringify({ text, meta })); } catch (e) { }
    } catch (e) {
      const msg = String(e.message || e);
      if (!retry && /no access to model|model.*not (found|exist)|does not exist|invalid model|unsupported model/i.test(msg)) {
        st.textContent = `Model ${AI.model} tidak tersedia untuk token ini — memilih model lain…`; const before = AI.model; const ids = await aiLoadModels(true);
        if (ids.length && AI.model !== before) { btn.disabled = false; return aiRun(true); }
        st.textContent = "Gagal: " + msg + " · pilih model lain di Pengaturan (klik Muat daftar model).";
      } else st.textContent = "Gagal: " + msg;
      console.warn("AI", e);
    }
    btn.disabled = false; $("aiCancel").classList.add("hidden"); AI.abort = null;
  }
  // urutan preferensi model bila yang tersimpan tidak tersedia untuk token ini
  // urutan preferensi model: yang cepat & murah dulu (narasi ringkasan tidak butuh model penalaran berat)
  const AI_PREF = ["deepseek-v4-flash", "deepseek-flash", "gemini-3.1-flash", "gemini-3-flash", "gemini-2.5-flash", "gemini-2.0-flash", "gemini-flash", "gpt-4o-mini", "gpt-4.1-mini", "gpt-5-mini", "claude-haiku", "claude-3-5-haiku", "deepseek-chat", "deepseek-v4", "claude-sonnet-4-6", "claude-sonnet-4", "claude-sonnet-5", "gpt-4o", "gpt-4.1", "qwen", "glm"];
  const pickModel = (ids) => { const slow = /fable|opus|-pro|reason|o1|o3|codex/i; if (ids.includes(AI.model) && !slow.test(AI.model)) return AI.model; for (const p of AI_PREF) { const hit = ids.find(id => id === p) || ids.find(id => id.startsWith(p)) || ids.find(id => id.includes(p)); if (hit) return hit; } return ids.find(id => !slow.test(id)) || ids[0]; };
  async function aiLoadModels(quiet) {
    aiLoad(); const sel = $("aiModel"), note = $("aiSettingsNote"); if (!aiProxy() && !AI.key) { if (!quiet) note.textContent = "Isi token dulu."; return []; }
    note.textContent = "Memuat daftar model…";
    try { const r = aiProxy() ? await fetch(aiProxy(), { method: "POST", redirect: "follow", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action: "models" }) }) : await fetch(AI.base.replace(/\/+$/, "") + "/models", { headers: { Authorization: "Bearer " + AI.key } }); const j = await r.json(); if (j.error) throw new Error(j.error.message || j.error.code); if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const ids = (j.data || []).map(m => m.id).filter(Boolean).sort(); if (!ids.length) throw new Error("daftar model kosong");
      sel.innerHTML = ""; ids.forEach(id => { const o = document.createElement("option"); o.value = id; o.textContent = id; sel.appendChild(o); });
      const chosen = pickModel(ids); const changed = chosen !== AI.model; AI.model = chosen; sel.value = chosen; aiSave(); note.textContent = `${ids.length} model tersedia untuk token ini · dipakai: ${chosen}${changed ? " (dipilih otomatis)" : ""}`; return ids; }
    catch (e) { note.textContent = "Gagal memuat model: " + e.message; return []; }
  }
  function aiInit() {
    aiLoad(); $("aiBase").value = AI.base; $("aiKey").value = AI.key; const sel = $("aiModel"); sel.innerHTML = ""; const o = document.createElement("option"); o.value = AI.model; o.textContent = AI.model; sel.appendChild(o);
    $("aiToggle").addEventListener("click", () => $("aiSettings").classList.toggle("hidden"));
    $("aiSave").addEventListener("click", async () => { AI.base = $("aiBase").value.trim() || "https://api.sylorapi.com/v1"; AI.key = $("aiKey").value.trim(); AI.model = $("aiModel").value || AI.model; aiSave(); $("aiSettingsNote").textContent = AI.key ? "Tersimpan di browser ini." : "Token kosong."; if (AI.key) await aiLoadModels(true); });
    $("aiForget").addEventListener("click", () => { AI.key = ""; $("aiKey").value = ""; aiSave(); $("aiSettingsNote").textContent = "Token dihapus dari browser."; });
    $("aiLoadModels").addEventListener("click", aiLoadModels); $("aiModel").addEventListener("change", e => { AI.model = e.target.value; aiSave(); });
    $("aiRun").addEventListener("click", aiRun);
    $("aiCancel").addEventListener("click", () => { if (AI.abort) AI.abort.abort("user"); });
    if (aiProxy()) { $("aiBase").parentElement.classList.add("hidden"); $("aiKey").parentElement.classList.add("hidden"); $("aiForget").classList.add("hidden"); $("aiSub").textContent = "Token dikelola terpusat lewat proxy Apps Script — tim tidak perlu memasukkan token"; if (!AI.modelFromProxy) aiLoadModels(true).then(ids => { if (ids.length) { AI.modelFromProxy = true; aiSave(); } if (chat.open && state.months.length) renderChat(); }); }
    else if (!AI.key) $("aiSettings").classList.remove("hidden");
  }
  // ---------- 7. AI Insight ----------
  function renderInsight() {
    const mi = state.month; const IN = computeInsights(mi); const pName = periodName(mi);
    $("insightSub").textContent = `${pName} · ${IN.length} insight · dihasilkan otomatis dari pola data (berbasis aturan)`;
    $("aiSub").textContent = `Analisis naratif oleh model bahasa dari angka ${pName}${state.execKey ? " · " + execEntity() : ""} · ${aiProxy() ? "token dikelola terpusat (proxy tim)" : "token disimpan hanya di browser ini"}`;
    aiShowCached();
    const lead = IN.find(i => i.cat === "Pertumbuhan"), out = IN.find(i => i.cat === "Outlet"), day = IN.find(i => i.cat === "Pola hari"), vis = IN.find(i => i.cat === "Kunjungan");
    $("insightSummary").innerHTML = IN.length ? `<p>${lead ? lead.title + ". " + lead.text : ""}</p>${out ? `<p>${out.title}. ${out.text}</p>` : ""}${vis ? `<p>${vis.title}. ${vis.text}</p>` : ""}${day ? `<p>${day.title}. ${day.text}</p>` : ""}` : `<p class="muted">Belum cukup data untuk periode ini.</p>`;
    $("insightCards").innerHTML = IN.map((i, k) => `<div class="ins-card ins-${i.tone}"><div class="ins-head"><span class="ins-cat">${i.cat}</span><span class="ins-no">${k + 1}</span></div><h4>${i.title}</h4><p>${i.text}</p><div class="ins-rec"><b>Rekomendasi</b>${i.rec || "—"}</div></div>`).join("");
  }


  // ---------- Chat AI (brainstorm bebas dengan konteks angka periode) ----------
  const CHAT_SYSTEM = () => `Anda rekan diskusi bisnis untuk pemilik ${(C.OWNER || {}).org || "Inti Warna"} (jaringan toko cat & bahan bangunan di Indonesia). Jawab dalam Bahasa Indonesia yang ringkas, praktis, dan spesifik untuk ritel toko cat: strategi outlet, promo, stok, tenaga penjual, target, kunjungan/konversi/basket size. Bila ada pesan "Data dashboard" (JSON), pakai angkanya dan sebut nama outlet secara eksplisit; JANGAN mengarang angka yang tidak ada — bila data tidak cukup, katakan lalu ajukan pertanyaan balik yang tajam. Format markdown ringan: paragraf pendek, daftar bernomor untuk langkah; maksimal ±200 kata kecuali diminta lebih panjang. jt = juta rupiah. Tanpa basa-basi pembuka/penutup.`;
  const CHAT_MAX = 40, CHAT_CTX = 12;
  const chat = { msgs: [], busy: false, ctx: true, err: null, lastText: "", open: false, unread: false };
  const chatLoad = () => { try { const j = JSON.parse(localStorage.getItem("sssg.chat") || "{}"); if (Array.isArray(j.msgs)) chat.msgs = j.msgs; if (typeof j.ctx === "boolean") chat.ctx = j.ctx; } catch (e) { } };
  const chatSave = () => { try { localStorage.setItem("sssg.chat", JSON.stringify({ msgs: chat.msgs.slice(-CHAT_MAX), ctx: chat.ctx })); } catch (e) { } };
  const chatPeriod = () => (state.range ? fmtRange(state.range.a, state.range.b) : periodName(state.month)) + (state.execKey ? " · " + execEntity() : "");
  function chatChips() {
    const p = state.range ? fmtRange(state.range.a, state.range.b) : periodName(state.month); let worst = null, best = null;
    try { const K = computeRanking(state.month); const rows = (K ? K.rows : []).filter(r => r.ach != null); if (rows.length) { worst = rows.reduce((m, r) => r.ach < m.ach ? r : m); best = rows.reduce((m, r) => r.ach > m.ach ? r : m); } } catch (e) { }
    const q = [];
    if (worst) q.push(`Kenapa ${worst.label} di bawah target, dan apa 3 langkah cepat untuk minggu ini?`);
    q.push(`Ide promo akhir pekan untuk menaikkan omset ${p}`);
    q.push("Bagaimana menaikkan konversi kunjungan menjadi transaksi?");
    if (best && best !== worst) q.push(`Apa yang bisa ditiru outlet lain dari ${best.label}?`);
    q.push(`Ringkas kondisi ${p} dalam 3 kalimat untuk grup WhatsApp tim`);
    return q;
  }
  function chatDraw() {
    const log = $("chatLog"); if (!log) return;
    let html = chat.msgs.length ? chat.msgs.map(m => m.role === "user" ? `<div class="msg user">${esc(m.content)}</div>` : `<div class="msg ai">${mdLite(m.content)}${m.meta ? `<div class="msg-meta">${esc(m.meta)}</div>` : ""}</div>`).join("") : "";
    if (!chat.msgs.length && !chat.busy && !chat.err) html = `<div class="chat-empty"><b>Mulai brainstorm</b>Tanya apa saja soal kinerja toko — AI sudah memegang angka ${esc(chatPeriod())}. Coba salah satu pertanyaan di bawah.</div>`;
    if (chat.busy) html += `<div class="msg ai typing"><span></span><span></span><span></span></div>`;
    if (chat.err) html += `<div class="msg err">${esc(chat.err)}${chat.lastText ? ` <button class="link" id="chatRetry" type="button">Coba lagi</button>` : ""}</div>`;
    log.innerHTML = html; log.scrollTop = log.scrollHeight;
    document.querySelectorAll("#chatChips button").forEach(b => b.disabled = chat.busy);
  }
  function renderChat() {
    $("chatSub").textContent = `Konteks: ${chatPeriod()} · ${AI.model}`;
    $("chatChips").innerHTML = chatChips().map(q => `<button type="button" data-q="${esc(q)}" title="${esc(q)}">${esc(q)}</button>`).join("");
    chatDraw();
  }
  function chatOpen(open) {
    chat.open = open == null ? !chat.open : !!open;
    $("chatPanel").classList.toggle("hidden", !chat.open); $("chatFab").classList.toggle("open", chat.open); $("chatFab").title = chat.open ? "Tutup chat" : "Chat AI";
    if (chat.open) { chat.unread = false; $("chatDot").classList.add("hidden"); if (state.months.length) renderChat(); else chatDraw(); setTimeout(() => $("chatInput").focus(), 50); }
  }
  async function chatSend(text, retry) {
    text = (text || "").trim(); if (!text || chat.busy) return;
    aiLoad();
    if (!aiProxy() && !AI.key) { chat.err = "Token AI belum diatur — buka AI Insight → Pengaturan, simpan token, lalu kembali ke sini."; chatDraw(); return; }
    if (aiProxy() && !AI.modelFromProxy) { try { const ids = await aiLoadModels(true); if (ids.length) { AI.modelFromProxy = true; aiSave(); } } catch (e) { } }
    if (!retry) { chat.msgs.push({ role: "user", content: text }); chat.msgs = chat.msgs.slice(-CHAT_MAX); chatSave(); }
    chat.lastText = text; chat.err = null; chat.busy = true; const inp = $("chatInput"); inp.value = ""; inp.style.height = ""; $("chatSend").disabled = true; $("chatStop").classList.remove("hidden"); chatDraw();
    const st = $("chatStatusText"), t0 = Date.now();
    try {
      const sys = [{ role: "system", content: CHAT_SYSTEM() }];
      if (chat.ctx && state.months.length) { try { sys.push({ role: "system", content: "Data dashboard (periode & outlet yang sedang dipilih pengguna):\n" + JSON.stringify(aiPayload(true)) }); } catch (e) { console.warn("chat ctx", e); } }
      const hist = chat.msgs.slice(-CHAT_CTX).map(m => ({ role: m.role, content: m.content }));
      const j = await aiChat(sys.concat(hist), st, { max_tokens: 700, temperature: 0.5, label: "Bertanya" });
      const ch = j.choices && j.choices[0]; let out = ch && ch.message && ch.message.content ? ch.message.content.trim() : ""; if (!out) throw new Error("jawaban kosong");
      if (ch.finish_reason === "length") out += "\n\n_(Jawaban terpotong — ketik \"lanjutkan\" untuk sisanya.)_";
      chat.msgs.push({ role: "assistant", content: out, meta: `${j.model || AI.model} · ${((Date.now() - t0) / 1000).toFixed(0)} dtk` }); chat.msgs = chat.msgs.slice(-CHAT_MAX); chatSave(); chat.lastText = "";
    } catch (e) {
      const msg = String(e.message || e);
      if (!retry && /no access to model|model.*not (found|exist)|does not exist|invalid model|unsupported model/i.test(msg)) {
        st.textContent = `Model ${AI.model} tidak tersedia untuk token ini — memilih model lain…`; const before = AI.model; const ids = await aiLoadModels(true);
        if (ids.length && AI.model !== before) { chat.busy = false; $("chatSend").disabled = false; return chatSend(text, true); }
      }
      chat.err = msg === "dibatalkan" ? "Dibatalkan." : "Gagal: " + msg;
    }
    chat.busy = false; AI.abort = null; st.textContent = ""; $("chatSend").disabled = false; $("chatStop").classList.add("hidden"); chatDraw(); if (chat.open) inp.focus(); else if (!chat.err) { chat.unread = true; $("chatDot").classList.remove("hidden"); }
  }
  function chatInit() {
    chatLoad(); $("chatCtx").checked = chat.ctx;
    $("chatCtx").addEventListener("change", e => { chat.ctx = e.target.checked; chatSave(); });
    $("chatFab").addEventListener("click", () => chatOpen());
    $("chatClose").addEventListener("click", () => chatOpen(false));
    document.addEventListener("keydown", e => { if (e.key === "Escape" && chat.open) chatOpen(false); });
    $("chatPanel").querySelector('a[data-view="insight"]').addEventListener("click", () => chatOpen(false));
    $("chatSend").addEventListener("click", () => chatSend($("chatInput").value));
    $("chatStop").addEventListener("click", () => { if (AI.abort) AI.abort.abort("user"); });
    $("chatClear").addEventListener("click", () => { if (chat.busy && AI.abort) AI.abort.abort("user"); chat.msgs = []; chat.err = null; chat.lastText = ""; chatSave(); chatDraw(); });
    $("chatChips").addEventListener("click", e => { const b = e.target.closest("button[data-q]"); if (b && !b.disabled) chatSend(b.dataset.q); });
    $("chatLog").addEventListener("click", e => { if (e.target.id === "chatRetry") chatSend(chat.lastText, true); });
    const inp = $("chatInput");
    inp.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); chatSend(inp.value); } });
    inp.addEventListener("input", () => { inp.style.height = ""; inp.style.height = Math.min(160, inp.scrollHeight) + "px"; });
  }

  // ---------- view switch & render ----------
  const VIEWS = { exec: renderExec, rank: renderRank, trend: renderTrend, sssg: renderSssg, newout: renderNewOut, alerts: renderAlerts, insight: renderInsight, visit: renderVisits, sales: renderSales };
  function setView(v) {
    if (!VIEWS[v]) v = "exec"; state.view = v;
    document.querySelectorAll(".view").forEach(el => el.classList.toggle("hidden", el.id !== "view-" + v));
    document.querySelectorAll("a[data-view]").forEach(a => { if (a.closest(".topnav") || a.closest(".rail")) a.classList.toggle("on", a.dataset.view === v); });
    $("seg").classList.toggle("hidden", !["sssg", "rank", "visit"].includes(v)); $("storePill").classList.toggle("hidden", v !== "exec"); if (state.months.length) buildMonthSelect();
    const segLbl = v === "sssg" ? ["SSSG YoY", "Growth MoM"] : ["vs Tahun lalu", "vs Bulan lalu"]; document.querySelectorAll("#seg button").forEach((b, i) => b.textContent = segLbl[i]);
    try { history.replaceState(null, "", "#" + v); localStorage.setItem("sssg.view", v); } catch (e) { }
    if (state.months.length) render(); window.scrollTo({ top: 0 });
  }
  function updateStatus() {
    setStatus(`Data ${state.months.filter(Boolean).length} bulan terbaca · tahun ${Y()}${state.baseMonths.some(Boolean) ? " · pembanding " + BY() + " harian: " + state.baseMonths.filter(Boolean).length + " bulan" : (state.year === C.YEAR && state.baseline) ? " · baseline " + BY() + " per toko: ADA" : " · data " + BY() + ": BELUM ADA"} · diperbarui ${state.fetchedAt.toLocaleString("id-ID")}`);
  }
  function render() {
    $("app").classList.remove("hidden"); updateStatus(); $("banner").classList.add("hidden");
    try { const n = computeAlerts(state.month).filter(a => a.sev === "crit").length; const b = $("bellBadge"); b.textContent = n; b.classList.toggle("hidden", !n); } catch (e) { }
    try { (VIEWS[state.view] || renderExec)(); } catch (e) { console.error("render", state.view, e); setStatus("Gagal merender halaman " + state.view + ": " + e.message, true); }
    try { let want = false; try { want = localStorage.getItem("sssg.chat.open") === "1"; localStorage.removeItem("sssg.chat.open"); } catch (e) { } if (want && !chat.open) chatOpen(true); else if (chat.open) renderChat(); } catch (e) { console.warn("chat render", e); }
  }

  // ---------- events ----------
  initChrome(); aiInit(); chatInit();
  document.querySelectorAll("a[data-view]").forEach(a => a.addEventListener("click", e => { e.preventDefault(); if (a.dataset.view === "chat") { chatOpen(true); return; } setView(a.dataset.view); }));
  { const h = location.hash.replace("#", ""); if (h === "chat") { try { localStorage.setItem("sssg.chat.open", "1"); } catch (e) { } } let v = VIEWS[h] ? h : /^sec-visit/.test(h) ? "visit" : /^sec-/.test(h) ? "sssg" : null; if (!v) { try { v = localStorage.getItem("sssg.view"); } catch (e) { } } state.view = VIEWS[v] ? v : "exec"; document.querySelectorAll(".view").forEach(el => el.classList.toggle("hidden", el.id !== "view-" + state.view)); document.querySelectorAll("a[data-view]").forEach(a => { if (a.closest(".topnav") || a.closest(".rail")) a.classList.toggle("on", a.dataset.view === state.view); }); $("seg").classList.toggle("hidden", !["sssg", "rank", "visit"].includes(state.view)); $("storePill").classList.toggle("hidden", state.view !== "exec"); const segLbl = state.view === "sssg" ? ["SSSG YoY", "Growth MoM"] : ["vs Tahun lalu", "vs Bulan lalu"]; document.querySelectorAll("#seg button").forEach((b, i) => b.textContent = segLbl[i]); }
  const setMode = (m) => { state.mode = m; document.querySelectorAll("#seg button").forEach(b => b.classList.toggle("on", b.dataset.mode === m)); if (state.months.length) { buildMonthSelect(); render(); } };
  document.querySelectorAll("#seg button").forEach(b => b.addEventListener("click", () => { state.modeChosen = true; setMode(b.dataset.mode); }));
  document.querySelectorAll("#trCmp button").forEach(b => b.addEventListener("click", () => { state.trendCmp = b.dataset.cmp; renderTrend(); }));
  $("insightChips").addEventListener("click", e => { const m = e.target.dataset ? e.target.dataset.mode : null; if (m) setMode(m); });
  $("selYear").addEventListener("change", e => { selectYear(+e.target.value); state.range = null; $("rangePill").classList.remove("on"); $("rangeFrom").value = ""; $("rangeTo").value = ""; buildMonthSelect(); render(); });
  const onRangeInput = () => { const a = $("rangeFrom").value, b = $("rangeTo").value; if (a && b) setRange(new Date(a + "T00:00:00"), new Date(b + "T00:00:00")); };
  $("selStore").addEventListener("change", e => { state.execKey = e.target.value || null; render(); });
  try { state.targetFilter = localStorage.getItem("sssg.tgFilter") || "all"; state.targetSort = localStorage.getItem("sssg.tgSort") || "pct"; } catch (e) { }
  document.querySelectorAll("#tgFilter button").forEach(b => b.addEventListener("click", () => { state.targetFilter = b.dataset.f; try { localStorage.setItem("sssg.tgFilter", b.dataset.f); } catch (e) { } renderTargetBoard(); }));
  $("btnWa").addEventListener("click", openWa); document.querySelectorAll("#waMode button").forEach(b => b.addEventListener("click", () => { state.waMode = b.dataset.m; try { localStorage.setItem("sssg.waMode", b.dataset.m); } catch (e) { } waFill(); })); try { state.waMode = localStorage.getItem("sssg.waMode") || "detail"; } catch (e) { } $("waClose").addEventListener("click", closeWa); $("waCopy").addEventListener("click", waCopy); $("waOpen").addEventListener("click", waOpen);
  $("waModal").addEventListener("click", e => { if (e.target === $("waModal")) closeWa(); }); document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("waModal").classList.contains("hidden")) closeWa(); });
  try { state.salesFilter = localStorage.getItem("sssg.slFilter") || "all"; state.salesSort = localStorage.getItem("sssg.slSort") || "best"; } catch (e) { }
  document.querySelectorAll("#slFilter button").forEach(b => b.addEventListener("click", () => { state.salesFilter = b.dataset.f; try { localStorage.setItem("sssg.slFilter", b.dataset.f); } catch (e) { } renderSales(); }));
  document.querySelectorAll("#slSort button").forEach(b => b.addEventListener("click", () => { state.salesSort = b.dataset.s; try { localStorage.setItem("sssg.slSort", b.dataset.s); } catch (e) { } renderSales(); }));
  $("btnWaSales").addEventListener("click", openWa);
  document.querySelectorAll("#tgSort button").forEach(b => b.addEventListener("click", () => { state.targetSort = b.dataset.s; try { localStorage.setItem("sssg.tgSort", b.dataset.s); } catch (e) { } renderTargetBoard(); }));
  $("btnBell").addEventListener("click", () => setView("alerts"));
  $("rangeFrom").addEventListener("change", onRangeInput); $("rangeTo").addEventListener("change", onRangeInput);
  $("rangeClear").addEventListener("click", () => { clearRange(); buildMonthSelect(); });
  $("selMonth").addEventListener("change", e => { const v = e.target.value; if (v === "range") { $("rangePill").classList.remove("hidden"); if (!state.range) { const end = latestDate(); setRange(addDays(end, -6), end); } $("rangeFrom").focus(); return; } state.range = null; $("rangePill").classList.add("hidden"); $("rangePill").classList.remove("on"); state.month = v === "ytd" ? "ytd" : +v; render(); });
  ["btnRefresh", "btnRefresh2", "btnRefresh3", "btnRefreshEx"].forEach(id => { const b = $(id); if (b) b.addEventListener("click", loadAll); });
  $("btnCsv").addEventListener("click", exportCsv); $("btnCsvVisit").addEventListener("click", exportVisitCsv);
  $("btnSwap").addEventListener("click", () => { state.rankWorst = !state.rankWorst; if (state.lastResult) drawRankList(state.lastResult, state.mode === "yoy" ? "SSSG" : "Growth MoM"); });
  $("btnSwapVisit").addEventListener("click", () => { state.visitRankWorst = !state.visitRankWorst; if (state.lastVisit) drawVisitRank(state.lastVisit); });
  $("storeFilter").addEventListener("input", applyFilter); $("btnClearFilter").addEventListener("click", () => { $("storeFilter").value = ""; applyFilter(); });
  loadAll();
})();
